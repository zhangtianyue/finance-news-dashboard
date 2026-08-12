#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const primaryCode = "513500";
const alternateCode = "159612";
const statePath = resolve("data/runtime/qdii-sp500-rotation-state.json");
const strategyConfigPath = resolve("data/runtime/qdii-sp500-rotation-config.json");
const validTargets = new Set([primaryCode, alternateCode]);
const validRiskModes = new Set(["risk_on", "neutral", "risk_off", "symmetric"]);
const tencentUrl = "https://qt.gtimg.cn/q=sh513500,sz159612";
const riskModeProfiles = {
  risk_on: {
    label: "乐观",
    // 乐观模式：你主观认为 QDII 溢价弹性还在，愿意多拿一段 159612。
    // 159612 只要明显便宜 1.50 个百分点就可切入；等它反过来贵 0.80 个百分点再切回 513500。
    switchToAlternateThreshold: -1.5,
    switchBackThreshold: 0.8,
  },
  neutral: {
    label: "中性",
    // 中性模式：沿用原来的保守轮动思路。
    // 159612 至少便宜 2.00 个百分点才切入；优势缩小到 0.50 个百分点以内切回 513500。
    switchToAlternateThreshold: -2.0,
    switchBackThreshold: -0.5,
  },
  risk_off: {
    label: "防守",
    // 防守模式：你主观认为美股或 QDII 溢价处于退潮期，159612 需要给更多补偿。
    // 159612 至少便宜 2.50 个百分点才切入；只要优势小于 1.00 个百分点就回 513500。
    switchToAlternateThreshold: -2.5,
    switchBackThreshold: -1.0,
  },
  symmetric: {
    label: "对称轮动",
    // 对称轮动模式：只看两只 ETF 的相对溢价，不再偏好某一只。
    // spread = 159612溢价 - 513500溢价，所以：
    // - spread <= -1.00：513500 至少贵 1.00 个百分点，切到 159612。
    // - spread >= +1.00：159612 至少贵 1.00 个百分点，切回 513500。
    // 两条触发线相距 2.00 个百分点，但实际收益还会受买卖价差、滑点和交易费用影响。
    switchToAlternateThreshold: -1.0,
    switchBackThreshold: 1.0,
  },
};
const defaultRiskMode = "neutral";

// 这个脚本刻意保持“单一策略、单一输出”：
// 1. 只比较 513500 和 159612 两只跟踪标普 500 的场内 ETF。
// 2. 只输出目标持仓，不生成订单数量、价格或买卖方向。
// 3. 只在 A 股交易时段允许切换，避免夜间或周末拿到旧行情后误触发。
// 这样交易系统接入时，只需要轮询 JSON 并判断 action 是否为 switch。
//
// 主观周期判断不写死在代码里，而是放在 data/runtime/qdii-sp500-rotation-config.json：
// - risk_on：更愿意持有 159612，赚小盘溢价弹性。
// - neutral：中性，不主动押注弹性。
// - risk_off：更愿意回到 513500，减少 159612 溢价回落风险。
// - symmetric：对称高切低，价差到 -1.00/+1.00 个百分点时双向轮动。
//
// “已持仓轮动”和“空仓首次建仓”是两套规则：
// - 已持仓：按当前模式的双阈值状态机执行，防止频繁切换。
// - 空仓：没有历史仓位需要继承，直接比较两只 ETF 的“卖一价 / 实时估值 - 1”。

function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function calculateExecutableBuyPremium(askPrice, realtimeEstimate) {
  // 空仓建仓看的不是“上一笔成交价”，而是此刻能够买到的卖一价。
  // 例如：卖一价 1.050，实时估值 1.000，可成交买入溢价就是 5.00%。
  if (askPrice == null || realtimeEstimate == null || askPrice <= 0 || realtimeEstimate <= 0) {
    return null;
  }

  return Number((((askPrice / realtimeEstimate) - 1) * 100).toFixed(4));
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
  // fields[9]  = 买一价，未来卖出执行时可用于评估滑点
  // fields[19] = 卖一价，空仓买入时用它计算可成交溢价
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
      bidPrice: numberOrNull(fields[9]),
      askPrice: numberOrNull(fields[19]),
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
  // currentTarget=null 明确表示账户空仓；文件不存在时也按首次空仓处理。
  // 接入 QMT 后，应当用券商查到的真实持仓覆盖这个本地值。
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    return state.currentTarget === null || validTargets.has(state.currentTarget)
      ? state
      : { currentTarget: null };
  } catch {
    return { currentTarget: null };
  }
}

async function readStrategyConfig() {
  try {
    const config = JSON.parse(await readFile(strategyConfigPath, "utf8"));
    return validRiskModes.has(config.riskMode) ? config : { riskMode: defaultRiskMode };
  } catch {
    return { riskMode: defaultRiskMode };
  }
}

async function writeStrategyConfig(config) {
  await mkdir(dirname(strategyConfigPath), { recursive: true });
  await writeFile(
    `${strategyConfigPath}.tmp`,
    `${JSON.stringify(
      {
        riskMode: config.riskMode,
        updatedAt: shanghaiIso(),
        note: config.note ?? "manual risk mode switch",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await rename(`${strategyConfigPath}.tmp`, strategyConfigPath);
}

function getRiskProfile(config) {
  return riskModeProfiles[config.riskMode] ?? riskModeProfiles[defaultRiskMode];
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

function emptyAccountDataIssue(quotes) {
  // 已持仓轮动可以继续使用腾讯溢价率字段；但空仓需要真正买入，
  // 因此卖一价或实时估值缺失时必须停止，不能退回到最新成交价猜测。
  for (const code of [primaryCode, alternateCode]) {
    const quote = quotes[code];
    if (quote?.askPrice == null) return `missing Tencent askPrice for empty-account entry: ${code}`;
    if (quote?.realtimeEstimate == null) {
      return `missing Tencent realtimeEstimate for empty-account entry: ${code}`;
    }
    if (quote?.executableBuyPremium == null) {
      return `invalid executable buy premium for empty-account entry: ${code}`;
    }
  }

  return null;
}

function decideTarget(currentTarget, spread, profile) {
  // 状态机的核心：
  // - 从 513500 切到 159612：spread 必须低于当前风险模式的切入阈值。
  // - 从 159612 切回 513500：spread 必须高于当前风险模式的切回阈值。
  // spread = 159612溢价率 - 513500溢价率；负数代表 159612 更便宜。
  if (currentTarget === primaryCode && spread <= profile.switchToAlternateThreshold) {
    return {
      target: alternateCode,
      reason: `${alternateCode} premium is ${Math.abs(spread).toFixed(
        2,
      )} percentage points lower than ${primaryCode}; ${profile.label} mode threshold is ${profile.switchToAlternateThreshold.toFixed(
        2,
      )}`,
    };
  }

  if (currentTarget === alternateCode && spread >= profile.switchBackThreshold) {
    return {
      target: primaryCode,
      reason: `${alternateCode} premium advantage crossed ${profile.label} mode switch-back threshold ${profile.switchBackThreshold.toFixed(
        2,
      )}; switch back to ${primaryCode}`,
    };
  }

  return {
    target: currentTarget,
    reason: `spread ${spread.toFixed(2)} does not cross ${profile.label} mode rotation thresholds`,
  };
}

function decideInitialTarget(entrySpread) {
  // entrySpread = 159612可成交买入溢价 - 513500可成交买入溢价。
  // 负数代表空仓买入 159612 更便宜，正数代表买入 513500 更便宜。
  // 不设人为容差：谁的可成交买入溢价更低就买谁；数值完全相同才选 513500。
  if (entrySpread === 0) {
    return {
      target: primaryCode,
      reason: `empty account: executable buy premiums are equal; prefer liquid ${primaryCode}`,
    };
  }

  const target = entrySpread < 0 ? alternateCode : primaryCode;
  return {
    target,
    reason: `empty account: ${target} has the lower executable buy premium by ${Math.abs(
      entrySpread,
    ).toFixed(2)} percentage points`,
  };
}

function buildDecision({ currentTarget, quotes, riskMode = defaultRiskMode, now = new Date() }) {
  // buildDecision 是纯决策函数。它不读写文件，也不请求网络。
  // 这样可以用固定样例覆盖边界条件，后续如果接真实交易系统，
  // 也能单独测试策略逻辑而不依赖行情接口。
  const profile = getRiskProfile({ riskMode });
  const asOf = shanghaiIso(now);
  const today = shanghaiDate(now);
  const base = quotes[primaryCode];
  const alt = quotes[alternateCode];
  const positionState = currentTarget === null ? "empty" : "holding";
  const dataIssue =
    quoteDataIssue(quotes, today) ??
    (currentTarget === null ? emptyAccountDataIssue(quotes) : null);
  const allowedToTrade = !dataIssue && isAshareTradingWindow(now);
  const spread =
    base?.premiumRate != null && alt?.premiumRate != null
      ? Number((alt.premiumRate - base.premiumRate).toFixed(4))
      : null;
  const entrySpread =
    base?.executableBuyPremium != null && alt?.executableBuyPremium != null
      ? Number((alt.executableBuyPremium - base.executableBuyPremium).toFixed(4))
      : null;

  if (dataIssue || spread == null) {
    // 数据异常时输出 observe，而不是 switch。
    // 交易系统可以记录 reason，但不应该因此调仓。
    return {
      asOf,
      mode: "live",
      positionState,
      riskMode,
      riskModeLabel: profile.label,
      thresholds: {
        switchToAlternate: profile.switchToAlternateThreshold,
        switchBackToPrimary: profile.switchBackThreshold,
      },
      allowedToTrade: false,
      currentTarget,
      target: currentTarget,
      action: "observe",
      reason: dataIssue ?? "premium spread unavailable",
      quotes,
      spread,
      entrySpread,
    };
  }

  if (!allowedToTrade) {
    // 非交易时段仍然输出 spread 和 quotes，方便你观察盘后溢价差，
    // 但 allowedToTrade=false 且 action=observe，交易系统不应执行。
    return {
      asOf,
      mode: "live",
      positionState,
      riskMode,
      riskModeLabel: profile.label,
      thresholds: {
        switchToAlternate: profile.switchToAlternateThreshold,
        switchBackToPrimary: profile.switchBackThreshold,
      },
      allowedToTrade: false,
      currentTarget,
      target: currentTarget,
      action: "observe",
      reason: "outside A-share trading window",
      quotes,
      spread,
      entrySpread,
    };
  }

  // 空仓没有“当前持有哪只”，所以直接做一次初始选择。
  // 已持仓时才使用对称轮动或其他风险模式的滞回阈值。
  const decision =
    currentTarget === null
      ? decideInitialTarget(entrySpread)
      : decideTarget(currentTarget, spread, profile);
  return {
    asOf,
    mode: "live",
    positionState,
    riskMode,
    riskModeLabel: profile.label,
    thresholds: {
      switchToAlternate: profile.switchToAlternateThreshold,
      switchBackToPrimary: profile.switchBackThreshold,
    },
    allowedToTrade: true,
    currentTarget,
    target: decision.target,
    action: decision.target === currentTarget ? "hold" : "switch",
    reason: decision.reason,
    quotes,
    spread,
    entrySpread,
  };
}

function compactQuotes(quotes) {
  // 输出只保留交易系统和人工复核需要的字段。
  // 原始腾讯长字段不进入 JSON，避免接入方依赖不稳定的字段序号。
  return Object.fromEntries(
    [primaryCode, alternateCode].map((code) => {
      const quote = quotes[code];
      const askPrice = quote?.askPrice ?? null;
      const realtimeEstimate = quote?.realtimeEstimate ?? null;
      return [
        code,
        {
          premiumRate: quote?.premiumRate ?? null,
          price: quote?.price ?? null,
          bidPrice: quote?.bidPrice ?? null,
          askPrice,
          // executableBuyPremium 专供空仓建仓决策与事后审计使用。
          executableBuyPremium: calculateExecutableBuyPremium(askPrice, realtimeEstimate),
          time: quote?.time ?? null,
          realtimeEstimate,
          source: quote?.source ?? "Tencent",
        },
      ];
    }),
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

function parseCurrentHoldingOverride(args) {
  // 这个参数是为 QMT/PTrade 接入预留的边界：
  // 券商系统应先查询真实持仓，再传入 none、513500 或 159612。
  // 不传参数时仍读取本地状态，便于现在独立运行脚本。
  const index = args.indexOf("--current-holding");
  if (index === -1) return { provided: false, currentTarget: undefined };

  const value = args[index + 1];
  if (value === "none") return { provided: true, currentTarget: null };
  if (validTargets.has(value)) return { provided: true, currentTarget: value };

  throw new Error("--current-holding must be one of: none, 513500, 159612");
}

async function run({ holdingOverride = { provided: false, currentTarget: undefined } } = {}) {
  // 主流程：读取状态 -> 拉腾讯行情 -> 生成决策 -> 写状态 -> 输出 JSON。
  // 标准输出只打印 JSON，便于交易系统直接解析。
  const state = await readState();
  const config = await readStrategyConfig();
  const currentTarget = holdingOverride.provided
    ? holdingOverride.currentTarget
    : state.currentTarget;
  // 如果券商或命令行明确告诉我们“空仓”，后续 observe/error 也应保留空仓事实，
  // 不能再被本地文件中的旧目标覆盖。
  const effectiveState = { ...state, currentTarget };

  try {
    const quotes = compactQuotes(await fetchTencentQuotes());
    const decision = buildDecision({
      currentTarget,
      quotes,
      riskMode: config.riskMode,
    });
    await writeState(stateFromDecision(effectiveState, decision));
    process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
  } catch (error) {
    // 网络失败或接口异常时也输出符合接口形状的 JSON。
    // 这里 action=error，target 维持原目标，交易系统应当跳过下单。
    const message = error instanceof Error ? error.message : String(error);
    const asOf = shanghaiIso();
    const decision = {
      asOf,
      mode: "live",
      positionState: currentTarget === null ? "empty" : "holding",
      riskMode: config.riskMode,
      riskModeLabel: getRiskProfile(config).label,
      thresholds: {
        switchToAlternate: getRiskProfile(config).switchToAlternateThreshold,
        switchBackToPrimary: getRiskProfile(config).switchBackThreshold,
      },
      allowedToTrade: false,
      currentTarget,
      target: currentTarget,
      action: "error",
      reason: message,
      quotes: {},
      spread: null,
      entrySpread: null,
    };
    await writeState(stateFromDecision(effectiveState, decision));
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
      bidPrice: premium500 == null ? null : 1.152 * (1 + premium500 / 100),
      askPrice: premium500 == null ? null : 1.152 * (1 + premium500 / 100),
      time,
      realtimeEstimate: 1.152,
      source: "Tencent",
    },
    [alternateCode]: {
      premiumRate: premium159612,
      price: 1.111,
      bidPrice: premium159612 == null ? null : 1.058 * (1 + premium159612 / 100),
      askPrice: premium159612 == null ? null : 1.058 * (1 + premium159612 / 100),
      time,
      realtimeEstimate: 1.058,
      source: "Tencent",
    },
  });
}

function runSelfTest() {
  // 这些断言覆盖策略最容易出错的阈值边界，并且覆盖四个策略模式。
  const tradingTime = new Date("2026-06-16T02:15:00.000Z");

  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 5),
      riskMode: "neutral",
      now: tradingTime,
    }).target,
    alternateCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 5.01),
      riskMode: "neutral",
      now: tradingTime,
    }).target,
    primaryCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: alternateCode,
      quotes: quoteFixture(7, 6.5),
      riskMode: "neutral",
      now: tradingTime,
    }).target,
    primaryCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: alternateCode,
      quotes: quoteFixture(7, 6.4),
      riskMode: "neutral",
      now: tradingTime,
    }).target,
    alternateCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, null),
      riskMode: "neutral",
      now: tradingTime,
    }).action,
    "observe",
  );
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 5),
      riskMode: "neutral",
      now: new Date("2026-06-16T08:15:00.000Z"),
    }).action,
    "observe",
  );
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 5.5),
      riskMode: "risk_on",
      now: tradingTime,
    }).target,
    alternateCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: alternateCode,
      quotes: quoteFixture(7, 7.8),
      riskMode: "risk_on",
      now: tradingTime,
    }).target,
    primaryCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 4.5),
      riskMode: "risk_off",
      now: tradingTime,
    }).target,
    alternateCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 4.51),
      riskMode: "risk_off",
      now: tradingTime,
    }).target,
    primaryCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: alternateCode,
      quotes: quoteFixture(7, 6),
      riskMode: "risk_off",
      now: tradingTime,
    }).target,
    primaryCode,
  );
  // 对称轮动的四个边界：-1.00 触发、-0.99 不触发；+1.00 触发、+0.99 不触发。
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 6),
      riskMode: "symmetric",
      now: tradingTime,
    }).target,
    alternateCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: primaryCode,
      quotes: quoteFixture(7, 6.01),
      riskMode: "symmetric",
      now: tradingTime,
    }).target,
    primaryCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: alternateCode,
      quotes: quoteFixture(7, 8),
      riskMode: "symmetric",
      now: tradingTime,
    }).target,
    primaryCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: alternateCode,
      quotes: quoteFixture(7, 7.99),
      riskMode: "symmetric",
      now: tradingTime,
    }).target,
    alternateCode,
  );

  // 空仓首次建仓不设容差：即使只低 0.01 个百分点也选低溢价，完全相同才选 513500。
  const emptyChooses159612 = buildDecision({
    currentTarget: null,
    quotes: quoteFixture(7, 6.7),
    riskMode: "symmetric",
    now: tradingTime,
  });
  assert.equal(emptyChooses159612.target, alternateCode);
  assert.equal(emptyChooses159612.action, "switch");
  assert.equal(emptyChooses159612.positionState, "empty");
  assert.equal(emptyChooses159612.entrySpread, -0.3);

  assert.equal(
    buildDecision({
      currentTarget: null,
      quotes: quoteFixture(7, 6.81),
      riskMode: "symmetric",
      now: tradingTime,
    }).target,
    alternateCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: null,
      quotes: quoteFixture(7, 6.8),
      riskMode: "symmetric",
      now: tradingTime,
    }).target,
    alternateCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: null,
      quotes: quoteFixture(7, 7),
      riskMode: "symmetric",
      now: tradingTime,
    }).target,
    primaryCode,
  );
  assert.equal(
    buildDecision({
      currentTarget: null,
      quotes: quoteFixture(6.99, 7),
      riskMode: "symmetric",
      now: tradingTime,
    }).target,
    primaryCode,
  );

  const missingAskQuotes = quoteFixture(7, 6.5);
  missingAskQuotes[alternateCode] = {
    ...missingAskQuotes[alternateCode],
    askPrice: null,
    executableBuyPremium: null,
  };
  assert.equal(
    buildDecision({
      currentTarget: null,
      quotes: missingAskQuotes,
      riskMode: "symmetric",
      now: tradingTime,
    }).action,
    "observe",
  );
  assert.equal(
    buildDecision({
      currentTarget: null,
      quotes: quoteFixture(7, 6.5),
      riskMode: "symmetric",
      now: new Date("2026-06-16T08:15:00.000Z"),
    }).target,
    null,
  );

  assert.deepEqual(parseCurrentHoldingOverride(["node", "script", "--current-holding", "none"]), {
    provided: true,
    currentTarget: null,
  });
  assert.deepEqual(
    parseCurrentHoldingOverride(["node", "script", "--current-holding", alternateCode]),
    { provided: true, currentTarget: alternateCode },
  );
  assert.throws(
    () => parseCurrentHoldingOverride(["node", "script", "--current-holding", "invalid"]),
    /must be one of/,
  );

  process.stdout.write("qdii-sp500-rotation self-test passed\n");
}

if (process.argv.includes("--set-risk-mode")) {
  const riskMode = process.argv[process.argv.indexOf("--set-risk-mode") + 1];
  if (!validRiskModes.has(riskMode)) {
    process.stderr.write("riskMode must be one of: risk_on, neutral, risk_off, symmetric\n");
    process.exit(1);
  }
  await writeStrategyConfig({ riskMode, note: `set by CLI to ${riskMode}` });
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        riskMode,
        riskModeLabel: getRiskProfile({ riskMode }).label,
        thresholds: {
          switchToAlternate: getRiskProfile({ riskMode }).switchToAlternateThreshold,
          switchBackToPrimary: getRiskProfile({ riskMode }).switchBackThreshold,
        },
        configPath: strategyConfigPath,
      },
      null,
      2,
    )}\n`,
  );
} else if (process.argv.includes("--self-test")) {
  runSelfTest();
} else if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await run({ holdingOverride: parseCurrentHoldingOverride(process.argv) });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
