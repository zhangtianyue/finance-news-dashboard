#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const primaryCode = "513500";
const alternateCode = "159612";
const statePath = resolve("data/runtime/qdii-sp500-rotation-state.json");
const switchToAlternateThreshold = -2.0;
const switchBackThreshold = -0.2;
const validTargets = new Set([primaryCode, alternateCode]);
const tencentUrl = "https://qt.gtimg.cn/q=sh513500,sz159612";

// 这个脚本刻意保持“单一策略、单一输出”：
// 1. 只比较 513500 和 159612 两只跟踪标普 500 的场内 ETF。
// 2. 只输出目标持仓，不生成订单数量、价格或买卖方向。
// 3. 只在 A 股交易时段允许切换，避免夜间或周末拿到旧行情后误触发。
// 这样交易系统接入时，只需要轮询 JSON 并判断 action 是否为 switch。

function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function shanghaiParts(date = new Date()) {
  // Node 进程可能运行在任意系统时区。所有交易窗口、日期一致性判断都用
  // Asia/Shanghai，避免服务器时区不是中国时间时把盘中误判成盘外。
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
  };
}

function shanghaiDate(date = new Date()) {
  const parts = shanghaiParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shanghaiIso(date = new Date()) {
  const parts = shanghaiParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${String(parts.hour).padStart(2, "0")}:${String(
    parts.minute,
  ).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}+08:00`;
}

function parseTencentDateTime(value) {
  // 腾讯字段 30 是类似 20260616101500 的 14 位时间戳。
  // 如果格式不满足预期，后续 quoteDataIssue 会把它视为异常数据，
  // 策略只观察不切仓。
  if (!value || !/^\d{14}$/.test(value)) return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)} ${value.slice(
    8,
    10,
  )}:${value.slice(10, 12)}`;
}

function isAshareTradingWindow(date = new Date()) {
  // 这里只判断连续竞价时间，不覆盖集合竞价和盘后。
  // 目标是让交易系统在最普通、流动性最稳定的时间段里接收 switch。
  const parts = shanghaiParts(date);
  const minutes = parts.hour * 60 + parts.minute;
  const morningOpen = 9 * 60 + 30;
  const morningClose = 11 * 60 + 30;
  const afternoonOpen = 13 * 60;
  const afternoonClose = 15 * 60;

  return (
    (minutes >= morningOpen && minutes <= morningClose) ||
    (minutes >= afternoonOpen && minutes <= afternoonClose)
  );
}

function parseTencentQuotes(text) {
  // 腾讯接口返回的是一行一个标的的波浪号分隔字符串。
  // 当前策略依赖的关键字段：
  // fields[3]  = 最新价
  // fields[30] = 行情时间
  // fields[77] = 溢价率，单位是百分比点，例如 7 表示 7%
  // fields[78] = IOPV/实时估值，用于输出诊断，不参与切换阈值
  const quotes = {};

  for (const line of text.split("\n")) {
    const match = line.match(/v_(?:sh|sz)(\d{6})="([^"]*)"/);
    if (!match) continue;

    const [, code, payload] = match;
    const fields = payload.split("~");
    quotes[code] = {
      code,
      price: numberOrNull(fields[3]),
      changePct: numberOrNull(fields[32]),
      amount: numberOrNull(fields[57]) != null ? numberOrNull(fields[57]) * 10000 : null,
      premiumRate: numberOrNull(fields[77]),
      realtimeEstimate: numberOrNull(fields[78]),
      time: parseTencentDateTime(fields[30]),
      source: "Tencent",
    };
  }

  return quotes;
}

async function fetchTencentQuotes() {
  // 不再混用东方财富或天天基金口径做决策。它们可以作为网页展示兜底，
  // 但交易脚本需要一个稳定口径，否则同一时刻可能因为数据源差异产生假信号。
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(tencentUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Referer: "https://gu.qq.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Tencent quote request failed: HTTP ${response.status}`);
    }

    return parseTencentQuotes(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

async function readState() {
  // 本地状态文件代表“交易系统上一次接受的目标持仓”。
  // 文件不存在或内容异常时，保守回到默认目标 513500。
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    return validTargets.has(state.currentTarget) ? state : { currentTarget: primaryCode };
  } catch {
    return { currentTarget: primaryCode };
  }
}

async function writeState(state) {
  // 先写临时文件再 rename，降低进程中断时写出半截 JSON 的概率。
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(`${statePath}.tmp`, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(`${statePath}.tmp`, statePath);
}

function quoteDataIssue(quotes, today) {
  // 任何关键数据缺失都不能触发切仓：
  // - 没有 quote：腾讯没有返回该标的
  // - 没有 premiumRate：没有可比较的溢价率
  // - 没有 time 或不是今天：可能是旧行情或接口字段变化
  for (const code of [primaryCode, alternateCode]) {
    const quote = quotes[code];
    if (!quote) return `missing Tencent quote for ${code}`;
    if (quote.premiumRate == null) return `missing Tencent premiumRate for ${code}`;
    if (!quote.time) return `invalid Tencent quote time for ${code}`;
    if (quote.time.slice(0, 10) !== today) {
      return `stale Tencent quote time for ${code}: ${quote.time}`;
    }
  }

  return null;
}

function decideTarget(currentTarget, spread) {
  // 状态机的核心：
  // - 从 513500 切到 159612，需要 159612 至少便宜 2 个百分点。
  // - 从 159612 切回 513500，只要优势缩小到 0.20 个百分点以内。
  // 这形成了滞回区间，避免在 -2% 附近频繁来回切。
  if (currentTarget === primaryCode && spread <= switchToAlternateThreshold) {
    return {
      target: alternateCode,
      reason: `${alternateCode} premium is ${Math.abs(spread).toFixed(
        2,
      )} percentage points lower than ${primaryCode}`,
    };
  }

  if (currentTarget === alternateCode && spread >= switchBackThreshold) {
    return {
      target: primaryCode,
      reason: `${alternateCode} premium advantage is within 0.20 percentage points; switch back to ${primaryCode}`,
    };
  }

  return {
    target: currentTarget,
    reason: `spread ${spread.toFixed(2)} does not cross rotation threshold`,
  };
}

function buildDecision({ currentTarget, quotes, now = new Date() }) {
  // buildDecision 是纯决策函数。它不读写文件，也不请求网络。
  // 这样可以用固定样例覆盖边界条件，后续如果接真实交易系统，
  // 也能单独测试策略逻辑而不依赖行情接口。
  const asOf = shanghaiIso(now);
  const today = shanghaiDate(now);
  const base = quotes[primaryCode];
  const alt = quotes[alternateCode];
  const dataIssue = quoteDataIssue(quotes, today);
  const allowedToTrade = !dataIssue && isAshareTradingWindow(now);
  const spread =
    base?.premiumRate != null && alt?.premiumRate != null
      ? Number((alt.premiumRate - base.premiumRate).toFixed(4))
      : null;

  if (dataIssue || spread == null) {
    // 数据异常时输出 observe，而不是 switch。
    // 交易系统可以记录 reason，但不应该因此调仓。
    return {
      asOf,
      mode: "live",
      allowedToTrade: false,
      currentTarget,
      target: currentTarget,
      action: "observe",
      reason: dataIssue ?? "premium spread unavailable",
      quotes,
      spread,
    };
  }

  if (!allowedToTrade) {
    // 非交易时段仍然输出 spread 和 quotes，方便你观察盘后溢价差，
    // 但 allowedToTrade=false 且 action=observe，交易系统不应执行。
    return {
      asOf,
      mode: "live",
      allowedToTrade: false,
      currentTarget,
      target: currentTarget,
      action: "observe",
      reason: "outside A-share trading window",
      quotes,
      spread,
    };
  }

  const decision = decideTarget(currentTarget, spread);
  return {
    asOf,
    mode: "live",
    allowedToTrade: true,
    currentTarget,
    target: decision.target,
    action: decision.target === currentTarget ? "hold" : "switch",
    reason: decision.reason,
    quotes,
    spread,
  };
}

function compactQuotes(quotes) {
  // 输出只保留交易系统和人工复核需要的字段。
  // 原始腾讯长字段不进入 JSON，避免接入方依赖不稳定的字段序号。
  return Object.fromEntries(
    [primaryCode, alternateCode].map((code) => [
      code,
      {
        premiumRate: quotes[code]?.premiumRate ?? null,
        price: quotes[code]?.price ?? null,
        time: quotes[code]?.time ?? null,
        realtimeEstimate: quotes[code]?.realtimeEstimate ?? null,
        source: quotes[code]?.source ?? "Tencent",
      },
    ]),
  );
}

function stateFromDecision(previousState, decision) {
  // 只有 action=switch 时才更新 currentTarget。
  // observe/error 不改变目标持仓，避免行情异常把状态文件污染掉。
  const nextTarget = decision.action === "switch" ? decision.target : previousState.currentTarget;
  return {
    ...previousState,
    currentTarget: nextTarget,
    lastObservedAt: decision.asOf,
    lastSwitchAt: decision.action === "switch" ? decision.asOf : previousState.lastSwitchAt ?? null,
    lastAction: decision.action,
    lastReason: decision.reason,
    lastSpread: decision.spread,
    lastQuotes: decision.quotes,
  };
}

async function run() {
  // 主流程：读取状态 -> 拉腾讯行情 -> 生成决策 -> 写状态 -> 输出 JSON。
  // 标准输出只打印 JSON，便于交易系统直接解析。
  const state = await readState();

  try {
    const quotes = compactQuotes(await fetchTencentQuotes());
    const decision = buildDecision({
      currentTarget: state.currentTarget,
      quotes,
    });
    await writeState(stateFromDecision(state, decision));
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  } catch (error) {
    // 网络失败或接口异常时也输出符合接口形状的 JSON。
    // 这里 action=error，target 维持原目标，交易系统应当跳过下单。
    const message = error instanceof Error ? error.message : String(error);
    const asOf = shanghaiIso();
    const decision = {
      asOf,
      mode: "live",
      allowedToTrade: false,
      currentTarget: state.currentTarget,
      target: state.currentTarget,
      action: "error",
      reason: message,
      quotes: {},
      spread: null,
    };
    await writeState(stateFromDecision(state, decision));
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
    process.exitCode = 1;
  }
}

function quoteFixture(premium500, premium159612, time = "2026-06-16 10:15") {
  // 自测用的最小行情样例，模拟腾讯已经解析后的结果。
  return compactQuotes({
    [primaryCode]: {
      premiumRate: premium500,
      price: 1.234,
      time,
      realtimeEstimate: 1.152,
      source: "Tencent",
    },
    [alternateCode]: {
      premiumRate: premium159612,
      price: 1.111,
      time,
      realtimeEstimate: 1.058,
      source: "Tencent",
    },
  });
}

function runSelfTest() {
  // 这些断言覆盖策略最容易出错的阈值边界：
  // -2.00 必须切，-1.99 不能切；
  // -0.20 必须切回，-0.30 继续持有 159612。
  const tradingTime = new Date("2026-06-16T02:15:00.000Z");

  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 5),
      now: tradingTime,
    }).target,
    alternateCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 5.01),
      now: tradingTime,
    }).target,
    primaryCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: alternateCode,
      quotes: quoteFixture(7, 6.8),
      now: tradingTime,
    }).target,
    primaryCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: alternateCode,
      quotes: quoteFixture(7, 6.7),
      now: tradingTime,
    }).target,
    alternateCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, null),
      now: tradingTime,
    }).action,
    "observe",
  );
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 5),
      now: new Date("2026-06-16T08:15:00.000Z"),
    }).action,
    "observe",
  );

  process.stdout.write("qdii-sp500-rotation self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await run();
}
