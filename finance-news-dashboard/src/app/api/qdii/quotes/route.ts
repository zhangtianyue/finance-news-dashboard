import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { QdiiEtfQuote } from "@/lib/global-valuations";
import { qdiiGroups } from "@/lib/global-valuations";

type EastmoneyQuote = {
  f2?: number;
  f3?: number;
  f6?: number;
  f12?: string;
  f124?: number;
  f297?: number;
};

type EastmoneyShareInfo = {
  totalShares: number | null;
  sourceTime: string | null;
};

type FundEstimate = {
  fundcode?: string;
  dwjz?: string;
  gsz?: string;
  gztime?: string;
  jzrq?: string;
};

type DailyQuote = {
  price: number | null;
  priceDate: string | null;
  priceTime?: string | null;
  changePct: number | null;
  amount: number | null;
  realtimeEstimate?: number | null;
  premiumRate?: number | null;
  sourceName?: string;
};

type EastmoneyMobileFundInfo = {
  Datas?: {
    DWJZ?: string;
    LJJZ?: string;
  } | null;
};

type FundApplyStatus = {
  subscriptionStatus: string | null;
  redemptionStatus: string | null;
  subscriptionOpen: boolean | null;
  subscriptionDate: string | null;
  subscriptionMinAmount: string | null;
  dailySubscriptionCount: string | null;
  dailySubscriptionLimit: string | null;
  subscriptionSource: string;
  subscriptionSourceUrl: string;
  subscriptionNote: string | null;
};

type ShareSnapshot = {
  date: string;
  totalShares: number;
  sourceTime: string | null;
  recordedAt: string;
};

type ShareSnapshotFile = {
  version: 1;
  updatedAt: string;
  entries: Record<string, ShareSnapshot[]>;
};

const timeoutMs = 8000;
const execFileAsync = promisify(execFile);
const shareSnapshotPath = join(process.cwd(), "data/runtime/qdii-share-snapshots.json");
const shareSnapshotRedisKey = "qdii:share-snapshots:v1";
const eastmoneyStockDetailFields = [
  "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13,f14,f15,f16,f17,f18",
  "f20,f21,f23,f38,f39,f40,f43,f44,f45,f46,f47,f48,f49,f50,f51,f52",
  "f57,f58,f59,f60,f71,f84,f85,f86,f116,f117,f124",
  "f127,f128,f129,f130,f131,f132,f133,f134,f135,f136,f137,f138,f139,f140,f141,f142,f143,f144,f145,f146,f147,f148,f149,f150",
  "f161,f162,f163,f164,f165,f166,f167,f168,f169,f170,f171,f172,f173,f174,f175,f176,f177,f178,f179,f180,f181,f182,f183,f184,f185,f186,f187,f188,f189,f190,f191,f192,f193,f194,f195,f196,f197,f198,f199",
  "f200,f201,f202,f203,f204,f205,f206,f207,f208,f209,f210,f211,f212,f213,f214,f215,f216,f217,f218,f219,f220,f221,f222,f223,f224,f225,f226,f227,f228,f229,f230,f231,f232,f233,f234,f235,f236,f237,f238,f239,f240,f241,f242,f243,f244,f245,f246,f247,f248,f249,f250,f251,f252,f253,f254,f255,f256,f257,f258,f259,f260,f261,f262,f263,f264,f265,f266,f267,f268,f269,f270,f271,f272,f273,f274,f275,f276,f277,f278,f279,f280,f281,f282,f283,f284,f285,f286,f287,f288,f289,f290,f291,f292,f293,f294,f295,f296,f297,f298,f299",
].join(",");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withTimeout() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, done: () => clearTimeout(timeout) };
}

function secid(code: string) {
  return `${code.startsWith("5") ? "1" : "0"}.${code}`;
}

function sinaSymbol(code: string) {
  return `${code.startsWith("5") ? "sh" : "sz"}${code}`;
}

function tencentSymbol(code: string) {
  return `${code.startsWith("5") ? "sh" : "sz"}${code}`;
}

function eastmoneyPush2Hosts(code: string) {
  const codeHost = `${(Number(code.slice(-2)) % 90) + 1}.push2.eastmoney.com`;
  return [codeHost, "19.push2.eastmoney.com", "38.push2.eastmoney.com", "push2.eastmoney.com"];
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function eastmoneyDate(value: unknown) {
  const raw = String(value ?? "");
  if (!/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function shanghaiDateTimeFromSeconds(value: unknown) {
  const seconds = numberOrNull(value);
  if (seconds == null || seconds <= 0) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(seconds * 1000));

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function datePart(value: string | null) {
  return value?.slice(0, 10) ?? null;
}

function shanghaiDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function tencentDateTime(value: string | undefined) {
  if (!value || !/^\d{14}$/.test(value)) {
    return { date: null, time: null };
  }

  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const time = `${date} ${value.slice(8, 10)}:${value.slice(10, 12)}`;
  return { date, time };
}

async function fetchJson<T>(url: string, headers: Record<string, string>) {
  try {
    const { controller, done } = withTimeout();
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers,
      });
      return (await response.json()) as T;
    } finally {
      done();
    }
  } catch {
    const headerArgs = Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);
    const args = [
      "-sS",
      "--http1.1",
      "--compressed",
      "--max-time",
      String(Math.ceil(timeoutMs / 1000)),
      ...headerArgs,
      url,
    ];
    const { stdout } = await execFileAsync("/usr/bin/curl", args, {
      maxBuffer: 1024 * 1024 * 4,
    });
    return JSON.parse(stdout) as T;
  }
}

async function fetchText(url: string, headers: Record<string, string>) {
  try {
    const { controller, done } = withTimeout();
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers,
      });
      return await response.text();
    } finally {
      done();
    }
  } catch {
    const headerArgs = Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);
    const args = [
      "-sS",
      "--http1.1",
      "--compressed",
      "--max-time",
      String(Math.ceil(timeoutMs / 1000)),
      ...headerArgs,
      url,
    ];
    const { stdout } = await execFileAsync("/usr/bin/curl", args, {
      maxBuffer: 1024 * 1024 * 8,
    });
    return stdout;
  }
}

async function runLimited<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    }),
  );

  return results;
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#40;/g, "(")
    .replace(/&#41;/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTrailingZeros(value: number) {
  return value
    .toFixed(value >= 100 ? 0 : 2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

function formatFundAmount(value: unknown) {
  const amount = numberOrNull(value);
  if (amount == null || amount < 0) return null;
  if (amount >= 800000000) return "无限额";
  if (amount < 10000) return `${stripTrailingZeros(amount)}元`;
  if (amount < 100000000) return `${stripTrailingZeros(amount / 10000)}万`;
  return `${stripTrailingZeros(amount / 100000000)}亿`;
}

function formatSubscriptionCount(value: unknown) {
  const count = numberOrNull(value);
  if (count == null || count <= 0) return null;
  return `${stripTrailingZeros(count)}笔`;
}

function validShareCount(value: unknown) {
  const shares = numberOrNull(value);
  return shares != null && shares > 0 ? shares : null;
}

function emptyShareSnapshotFile(): ShareSnapshotFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: {},
  } satisfies ShareSnapshotFile;
}

function parseShareSnapshotFile(value: unknown) {
  const parsed =
    typeof value === "string" && value.length > 0
      ? (JSON.parse(value) as ShareSnapshotFile)
      : value;

  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as ShareSnapshotFile).version === 1 &&
    typeof (parsed as ShareSnapshotFile).entries === "object"
  ) {
    return parsed as ShareSnapshotFile;
  }

  return emptyShareSnapshotFile();
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

async function upstashCommand<T>(command: unknown[]) {
  const config = redisConfig();
  if (!config) return null;

  const response = await fetch(config.url, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const payload = (await response.json()) as { result?: T; error?: string };
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `Upstash request failed: ${response.status}`);
  }
  return payload.result ?? null;
}

function normalizeSubscriptionOpen(status: string | null) {
  if (!status) return null;
  if (/开放申购|限大额/.test(status)) return true;
  if (/暂停|停止|封闭|终止|发行失败|不支持/.test(status)) return false;
  return null;
}

function subscriptionLimitNote(status: string | null, hasTradeRule: boolean) {
  if (hasTradeRule) return null;
  if (status === "场内交易") return "仅披露场内交易，未披露申购额度";
  if (status && /暂停|停止|封闭|终止/.test(status)) return "当前未披露申购额度";
  return "东财暂未披露申购额度";
}

function parseApplyStatusRows(text: string, codes: string[]) {
  const match = text.match(/datas:(\[[\s\S]*?\]),record:/);
  if (!match) return new Map<string, FundApplyStatus>();

  const codeSet = new Set(codes);
  const rows = JSON.parse(match[1]) as unknown[][];
  const statuses = new Map<string, FundApplyStatus>();

  for (const row of rows) {
    const code = cleanText(row[0]);
    if (!codeSet.has(code)) continue;

    const subscriptionStatus = cleanText(row[5]) || null;
    const redemptionStatus = cleanText(row[6]) || null;
    const subscriptionDate = cleanText(row[4]) || null;
    const tradeRuleCode = cleanText(row[11]);
    const hasTradeRule = tradeRuleCode.length > 0;

    statuses.set(code, {
      subscriptionStatus,
      redemptionStatus,
      subscriptionOpen: normalizeSubscriptionOpen(subscriptionStatus),
      subscriptionDate,
      subscriptionMinAmount: hasTradeRule ? formatFundAmount(row[8]) : null,
      dailySubscriptionCount: formatSubscriptionCount(row[10]),
      dailySubscriptionLimit: hasTradeRule ? formatFundAmount(row[9]) : null,
      subscriptionSource: "东方财富申购状态",
      subscriptionSourceUrl: "https://fund.eastmoney.com/Fund_sgzt_bzdm.html",
      subscriptionNote: subscriptionLimitNote(subscriptionStatus, hasTradeRule),
    });
  }

  return statuses;
}

function extractCellAfterLabel(html: string, label: string) {
  const match = html.match(
    new RegExp(`<td[^>]*>\\s*${label}\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i"),
  );
  return match ? cleanText(match[1]) || null : null;
}

function parseF10TradingStatus(code: string, html: string): FundApplyStatus {
  const tradingStatus = cleanText(html.match(/交易状态：\s*<span[^>]*>([\s\S]*?)<\/span>/)?.[1]);
  const subscriptionStatus =
    extractCellAfterLabel(html, "申购状态") ?? (tradingStatus.length > 0 ? tradingStatus : null);

  return {
    subscriptionStatus,
    redemptionStatus: extractCellAfterLabel(html, "赎回状态"),
    subscriptionOpen: normalizeSubscriptionOpen(subscriptionStatus),
    subscriptionDate: null,
    subscriptionMinAmount: null,
    dailySubscriptionCount: null,
    dailySubscriptionLimit: null,
    subscriptionSource: "东方财富基金 F10",
    subscriptionSourceUrl: `https://fundf10.eastmoney.com/jjfl_${code}.html`,
    subscriptionNote: "F10 未披露单日申购额度",
  };
}

async function fetchF10TradingStatus(code: string) {
  try {
    const html = await fetchText(`https://fundf10.eastmoney.com/jjfl_${code}.html`, {
      Referer: "https://fundf10.eastmoney.com/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    });
    return [code, parseF10TradingStatus(code, html)] as const;
  } catch {
    return [code, null] as const;
  }
}

async function fetchFundApplyStatuses(codes: string[]) {
  try {
    const params = [
      "t=8",
      "page=1,50000",
      "js=reData",
      "sort=fcode,asc",
    ].join("&");
    const text = await fetchText(`https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx?${params}`, {
      Referer: "https://fund.eastmoney.com/Fund_sgzt_bzdm.html",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    });
    const statuses = parseApplyStatusRows(text, codes);
    const missingCodes = codes.filter((code) => !statuses.has(code));

    if (missingCodes.length > 0) {
      const fallbackStatuses = await runLimited(missingCodes, 6, fetchF10TradingStatus);
      for (const [code, status] of fallbackStatuses) {
        if (status) statuses.set(code, status);
      }
    }

    return statuses;
  } catch {
    const fallbackStatuses = await runLimited(codes, 6, fetchF10TradingStatus);
    return new Map(fallbackStatuses.filter((entry): entry is readonly [string, FundApplyStatus] => entry[1] != null));
  }
}

async function readShareSnapshots() {
  if (redisConfig()) {
    try {
      const value = await upstashCommand<string | null>(["GET", shareSnapshotRedisKey]);
      return value ? parseShareSnapshotFile(value) : emptyShareSnapshotFile();
    } catch {
      // Fall through to the local file cache so the quote API can still render.
    }
  }

  try {
    const text = await readFile(shareSnapshotPath, "utf8");
    return parseShareSnapshotFile(text);
  } catch {
    return emptyShareSnapshotFile();
  }
}

function latestPreviousShareSnapshot(snapshots: ShareSnapshot[], date: string) {
  return snapshots
    .filter((snapshot) => snapshot.date < date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt))[0] ?? null;
}

function latestShareSnapshot(snapshots: ShareSnapshot[]) {
  return [...snapshots].sort(
    (a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt),
  )[0] ?? null;
}

function upsertShareSnapshot(
  file: ShareSnapshotFile,
  code: string,
  snapshot: ShareSnapshot | null,
) {
  if (!snapshot) return;

  const snapshots = file.entries[code] ?? [];
  const nextSnapshots = snapshots
    .filter((item) => item.date !== snapshot.date)
    .concat(snapshot)
    .sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt))
    .slice(-120);

  file.entries[code] = nextSnapshots;
  file.updatedAt = snapshot.recordedAt;
}

async function writeShareSnapshots(file: ShareSnapshotFile) {
  if (redisConfig()) {
    try {
      await upstashCommand<string>(["SET", shareSnapshotRedisKey, JSON.stringify(file)]);
      return;
    } catch {
      // Fall through to local write. Vercel storage must be configured for persistence.
    }
  }

  try {
    await mkdir(dirname(shareSnapshotPath), { recursive: true });
    await writeFile(shareSnapshotPath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  } catch {
    // Vercel/serverless environments may not have persistent writable project storage.
  }
}

async function fetchMarketQuotes(codes: string[]) {
  try {
    const params = [
      "fltt=2",
      "invt=2",
      `secids=${codes.map(secid).join(",")}`,
      "fields=f12,f14,f2,f3,f4,f5,f6,f17,f18,f124,f297",
    ].join("&");
    const data = await fetchJson<{ data?: { diff?: EastmoneyQuote[] } }>(
      `https://push2.eastmoney.com/api/qt/ulist.np/get?${params}`,
      {
        Referer: "https://quote.eastmoney.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    );
    return new Map((data.data?.diff ?? []).map((item) => [item.f12 ?? "", item]));
  } catch {
    return new Map<string, EastmoneyQuote>();
  }
}

async function fetchEastmoneyShareInfo(code: string) {
  const params = [
    `secid=${secid(code)}`,
    `fields=${eastmoneyStockDetailFields}`,
  ].join("&");
  const headers = {
    Referer: `https://quote.eastmoney.com/${code.startsWith("5") ? "sh" : "sz"}${code}.html`,
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  };

  for (const host of eastmoneyPush2Hosts(code)) {
    try {
      const data = await fetchJson<{ data?: { f84?: number; f85?: number; f86?: number } }>(
        `https://${host}/api/qt/stock/get?${params}`,
        headers,
      );
      const item = data.data;
      const totalShares = validShareCount(item?.f84) ?? validShareCount(item?.f85);
      if (totalShares != null) {
        return {
          totalShares,
          sourceTime: shanghaiDateTimeFromSeconds(item?.f86),
        } satisfies EastmoneyShareInfo;
      }
    } catch {
      // Try the next push2 host; Eastmoney intermittently closes some connections.
    }
  }

  return {
    totalShares: null,
    sourceTime: null,
  } satisfies EastmoneyShareInfo;
}

async function fetchTencentQuotes(codes: string[]) {
  const { controller, done } = withTimeout();
  try {
    const response = await fetch(
      `https://qt.gtimg.cn/q=${codes.map(tencentSymbol).join(",")}`,
      {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Referer: "https://gu.qq.com/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      },
    );
    const text = await response.text();
    const quotes = new Map<string, DailyQuote>();

    for (const line of text.split("\n")) {
      const match = line.match(/v_(?:sh|sz)(\d{6})="([^"]*)"/);
      if (!match) continue;

      const [, code, payload] = match;
      const fields = payload.split("~");
      const amountFromDetail = numberOrNull(fields[35]?.split("/")?.[2]);
      const amountInWan = numberOrNull(fields[57]);
      const { date, time } = tencentDateTime(fields[30]);

      quotes.set(code, {
        price: numberOrNull(fields[3]),
        priceDate: date,
        priceTime: time,
        changePct: numberOrNull(fields[32]),
        amount: amountFromDetail ?? (amountInWan != null ? amountInWan * 10000 : null),
        realtimeEstimate: numberOrNull(fields[78]),
        premiumRate: numberOrNull(fields[77]),
        sourceName: "腾讯行情 IOPV",
      });
    }

    return quotes;
  } catch {
    return new Map<string, DailyQuote>();
  } finally {
    done();
  }
}

async function fetchSinaQuotes(codes: string[]) {
  const { controller, done } = withTimeout();
  try {
    const response = await fetch(
      `https://hq.sinajs.cn/list=${codes.map(sinaSymbol).join(",")}`,
      {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Referer: "https://finance.sina.com.cn/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      },
    );
    const text = await response.text();
    const quotes = new Map<string, DailyQuote>();
    for (const line of text.split("\n")) {
      const match = line.match(/hq_str_(?:sh|sz)(\d{6})="([^"]*)"/);
      if (!match) continue;
      const [, code, payload] = match;
      const fields = payload.split(",");
      const price = numberOrNull(fields[3]);
      const previousClose = numberOrNull(fields[2]);
      const changePct =
        price != null && previousClose != null && previousClose > 0
          ? ((price - previousClose) / previousClose) * 100
          : null;
      quotes.set(code, {
        price,
        priceDate: fields[30] || null,
        changePct,
        amount: numberOrNull(fields[9]),
      });
    }
    return quotes;
  } catch {
    return new Map<string, DailyQuote>();
  } finally {
    done();
  }
}

async function fetchDailyQuote(code: string) {
  try {
    const params = [
      `secid=${secid(code)}`,
      "fields1=f1,f2,f3,f4,f5,f6",
      "fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
      "klt=101",
      "fqt=1",
      "end=20500101",
      "lmt=1",
    ].join("&");
    const data = await fetchJson<{ data?: { klines?: string[] } }>(
      `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params}`,
      {
        Referer: "https://quote.eastmoney.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    );
    const latest = data.data?.klines?.[0];
    if (!latest) return null;

    const [priceDate, , close, , , , amount, , changePct] = latest.split(",");
    return {
      price: numberOrNull(close),
      priceDate,
      changePct: numberOrNull(changePct),
      amount: numberOrNull(amount),
    } satisfies DailyQuote;
  } catch {
    return null;
  }
}

async function fetchFundEstimate(code: string) {
  const { controller, done } = withTimeout();
  try {
    const response = await fetch(
      `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`,
      {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Referer: "https://fund.eastmoney.com/",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      },
    );
    const text = await response.text();
    const match = text.match(/^jsonpgz\((.*)\);?$/);
    if (!match) return null;
    return JSON.parse(match[1]) as FundEstimate;
  } catch {
    return null;
  } finally {
    done();
  }
}

async function fetchEastmoneyMobileEstimate(code: string) {
  const { controller, done } = withTimeout();
  try {
    const params = new URLSearchParams({
      FCODE: code,
      deviceid: "Wap",
      plat: "Wap",
      product: "EFund",
      version: "2.0.0",
    });
    const response = await fetch(
      `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNBaseInfo?${params.toString()}`,
      {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Referer: "https://m.1234567.com.cn/",
          "User-Agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        },
      },
    );
    const data = (await response.json()) as EastmoneyMobileFundInfo;
    return data.Datas ?? null;
  } catch {
    return null;
  } finally {
    done();
  }
}

export async function GET() {
  const codes = [...new Set(qdiiGroups.flatMap((group) => group.items.map((item) => item.code)))];
  const [marketQuotes, shareSnapshots] = await Promise.all([
    fetchMarketQuotes(codes),
    readShareSnapshots(),
  ]);
  const [tencentQuotes, sinaQuotes, dailyQuotes, mobileEstimates, estimates, shareInfos, applyStatuses] = await Promise.all([
    fetchTencentQuotes(codes),
    fetchSinaQuotes(codes),
    runLimited(codes, 8, async (code) => [code, await fetchDailyQuote(code)] as const),
    runLimited(codes, 8, async (code) => [code, await fetchEastmoneyMobileEstimate(code)] as const),
    runLimited(codes, 8, async (code) => [code, await fetchFundEstimate(code)] as const),
    runLimited(codes, 3, async (code) => [code, await fetchEastmoneyShareInfo(code)] as const),
    fetchFundApplyStatuses(codes),
  ]);
  const dailyQuoteMap = new Map(dailyQuotes);
  const mobileEstimateMap = new Map(mobileEstimates);
  const estimateMap = new Map(estimates);
  const shareInfoMap = new Map(shareInfos);
  const updatedAt = new Date().toISOString();

  const quotes: Record<string, QdiiEtfQuote> = {};
  for (const code of codes) {
    const market = marketQuotes.get(code);
    const tencentQuote = tencentQuotes.get(code);
    const sinaQuote = sinaQuotes.get(code);
    const dailyQuote = dailyQuoteMap.get(code);
    const estimate = estimateMap.get(code);
    const price =
      tencentQuote?.price ?? numberOrNull(market?.f2) ?? sinaQuote?.price ?? dailyQuote?.price ?? null;
    const changePct =
      tencentQuote?.changePct ??
      numberOrNull(market?.f3) ??
      sinaQuote?.changePct ??
      dailyQuote?.changePct ??
      null;
    const amount =
      tencentQuote?.amount ?? numberOrNull(market?.f6) ?? sinaQuote?.amount ?? dailyQuote?.amount ?? null;
    const mobileEstimate = mobileEstimateMap.get(code);
    const eastmoneyEstimate =
      numberOrNull(mobileEstimate?.DWJZ) ?? numberOrNull(mobileEstimate?.LJJZ);
    const tiantianEstimate = numberOrNull(estimate?.gsz) ?? numberOrNull(estimate?.dwjz);
    const estimatedNav = tencentQuote?.realtimeEstimate ?? eastmoneyEstimate ?? tiantianEstimate;
    const nav = estimatedNav;
    const priceTime = tencentQuote?.priceTime ?? shanghaiDateTimeFromSeconds(market?.f124);
    const priceDate =
      tencentQuote?.priceDate ??
      eastmoneyDate(market?.f297) ??
      datePart(priceTime) ??
      sinaQuote?.priceDate ??
      dailyQuote?.priceDate ??
      null;
    const navTime =
      tencentQuote?.realtimeEstimate != null
        ? tencentQuote.priceTime ?? null
        : eastmoneyEstimate != null
          ? null
          : estimate?.gztime ?? estimate?.jzrq ?? null;
    const navDate = datePart(navTime);
    const navSource =
      tencentQuote?.realtimeEstimate != null
        ? "腾讯行情 IOPV"
        : eastmoneyEstimate != null
          ? "东方财富移动端估值"
          : tiantianEstimate != null
            ? "天天基金估算"
            : "无数据";
    const premiumRate =
      tencentQuote?.premiumRate ?? (price != null && nav && nav > 0 ? (price / nav - 1) * 100 : null);
    const applyStatus = applyStatuses.get(code);
    const shareInfo = shareInfoMap.get(code);
    const liveTotalShares = shareInfo?.totalShares ?? null;
    const liveShareSourceTime = shareInfo?.sourceTime ?? null;
    const snapshotsForCode = shareSnapshots.entries[code] ?? [];
    const latestStoredShareSnapshot = latestShareSnapshot(snapshotsForCode);
    const liveTotalSharesDate =
      liveTotalShares != null ? priceDate ?? datePart(liveShareSourceTime) ?? shanghaiDate() : null;
    const shareSourceTime = liveShareSourceTime ?? latestStoredShareSnapshot?.sourceTime ?? null;
    const totalShares = liveTotalShares ?? latestStoredShareSnapshot?.totalShares ?? null;
    const totalSharesDate = liveTotalShares != null ? liveTotalSharesDate : latestStoredShareSnapshot?.date ?? null;
    const previousShareSnapshot =
      totalSharesDate != null
        ? latestPreviousShareSnapshot(snapshotsForCode, totalSharesDate)
        : null;
    const netShareChange =
      totalShares != null && previousShareSnapshot ? totalShares - previousShareSnapshot.totalShares : null;
    const netShareChangePct =
      netShareChange != null && previousShareSnapshot && previousShareSnapshot.totalShares > 0
        ? (netShareChange / previousShareSnapshot.totalShares) * 100
        : null;
    const shareSnapshotNote =
      liveTotalShares != null
        ? previousShareSnapshot
          ? `对比 ${previousShareSnapshot.date} 总份额`
          : "已记录总份额，下一次有历史快照后可计算净申赎"
        : latestStoredShareSnapshot
          ? `使用 ${latestStoredShareSnapshot.date} 总份额快照，实时抓取暂未返回`
          : "东财未返回总份额";

    upsertShareSnapshot(
      shareSnapshots,
      code,
      liveTotalShares != null && liveTotalSharesDate
        ? {
            date: liveTotalSharesDate,
            totalShares: liveTotalShares,
            sourceTime: liveShareSourceTime,
            recordedAt: updatedAt,
          }
        : null,
    );

    const shareChangeSource =
      liveTotalShares != null
        ? "东方财富总份额 f84/f85"
        : latestStoredShareSnapshot
          ? "东方财富总份额快照"
          : null;

    quotes[code] = {
      code,
      price,
      priceDate,
      priceTime,
      changePct,
      amount,
      nav,
      navDate,
      navTime,
      navSource,
      premiumRate,
      sourceName: tencentQuote?.sourceName ?? "东方财富行情 / 东方财富移动端估值",
      subscriptionStatus: applyStatus?.subscriptionStatus ?? null,
      redemptionStatus: applyStatus?.redemptionStatus ?? null,
      subscriptionOpen: applyStatus?.subscriptionOpen ?? null,
      subscriptionDate: applyStatus?.subscriptionDate ?? null,
      subscriptionMinAmount: applyStatus?.subscriptionMinAmount ?? null,
      dailySubscriptionCount: applyStatus?.dailySubscriptionCount ?? null,
      dailySubscriptionLimit: applyStatus?.dailySubscriptionLimit ?? null,
      subscriptionSource: applyStatus?.subscriptionSource ?? null,
      subscriptionSourceUrl: applyStatus?.subscriptionSourceUrl ?? null,
      subscriptionNote: applyStatus?.subscriptionNote ?? null,
      totalShares,
      totalSharesDate,
      totalSharesTime: shareSourceTime,
      previousTotalShares: previousShareSnapshot?.totalShares ?? null,
      previousTotalSharesDate: previousShareSnapshot?.date ?? null,
      netShareChange,
      netShareChangePct,
      shareChangeSource,
      shareSnapshotNote,
      updatedAt,
      status: price != null && nav != null ? "ok" : price != null || nav != null ? "partial" : "missing",
    };
  }

  await writeShareSnapshots(shareSnapshots);

  return NextResponse.json(
    { updatedAt, quotes },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
