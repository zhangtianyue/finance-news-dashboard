import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { QdiiEtfQuote } from "@/lib/global-valuations";
import { qdiiGroups } from "@/lib/global-valuations";
import { datePart, numberOrNull, positiveNumber, qdiiPremium, selectQdiiPrice,
  shanghaiDateTimeFromSeconds, shareMetrics, validDate } from "@/lib/qdii-metrics";
import { readQdiiShareHistory } from "@/lib/qdii-share-store";
import { refreshQdiiShares } from "@/lib/qdii-shares";

type EastmoneyQuote = {
  f2?: number;
  f3?: number;
  f6?: number;
  f12?: string;
  f124?: number;
  f297?: number;
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

type QdiiQuotesResponse = {
  updatedAt: string;
  quotes: Record<string, QdiiEtfQuote>;
  mode: "fast" | "full";
  cached?: boolean;
  shareHistoryDegraded?: boolean;
};

const timeoutMs = 8000;
const fastSourceTimeoutMs = 2000;
const quoteCacheTtlMs = 45000;
const applyStatusCacheTtlMs = 10 * 60 * 1000;
const applyStatusFallbackTtlMs = 60 * 1000;
const execFileAsync = promisify(execFile);
const curlBinaryPath = "/usr/bin/curl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const qdiiQuoteCache = new Map<string, { expiresAt: number; payload: QdiiQuotesResponse }>();
const qdiiQuoteRequests = new Map<string, Promise<QdiiQuotesResponse>>();
let quoteCacheGeneration = 0;
let applyStatusCache: { expiresAt: number; statuses: Map<string, FundApplyStatus> } | null = null;
let applyStatusRefreshPromise: Promise<Map<string, FundApplyStatus>> | null = null;
let curlAvailability: Promise<boolean> | null = null;

function withTimeout(durationMs = timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), durationMs);
  return { controller, done: () => clearTimeout(timeout) };
}

async function hasCurlBinary() {
  curlAvailability ??= access(curlBinaryPath).then(
    () => true,
    () => false,
  );
  return curlAvailability;
}

async function fetchWithCurl(
  url: string,
  headers: Record<string, string>,
  maxBuffer: number,
  durationMs = timeoutMs,
) {
  if (!(await hasCurlBinary())) {
    throw new Error("curl fallback is unavailable");
  }

  const headerArgs = Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);
  const args = [
    "-sS",
    "--fail-with-body",
    "--http1.1",
    "--compressed",
    "--max-time",
    String(Math.ceil(durationMs / 1000)),
    ...headerArgs,
    url,
  ];
  const { stdout } = await execFileAsync(curlBinaryPath, args, {
    maxBuffer,
  });
  return stdout;
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

function eastmoneyDate(value: unknown) {
  const raw = String(value ?? "");
  if (!/^\d{8}$/.test(raw)) return null;
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return validDate(date) ? date : null;
}

function tencentDateTime(value: string | undefined) {
  if (!value || !/^\d{8}(?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(value)) {
    return { date: null, time: null };
  }

  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (!validDate(date)) return { date: null, time: null };
  const time = `${date} ${value.slice(8, 10)}:${value.slice(10, 12)}`;
  return { date, time };
}

async function fetchJson<T>(
  url: string,
  headers: Record<string, string>,
  options: { timeoutMs?: number; curlFallback?: boolean } = {},
) {
  try {
    const { controller, done } = withTimeout(options.timeoutMs);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers,
      });
      if (!response.ok) throw new Error(`request failed with HTTP ${response.status}`);
      return (await response.json()) as T;
    } finally {
      done();
    }
  } catch (error) {
    if (options.curlFallback === false) {
      throw error instanceof Error ? error : new Error("request failed");
    }
    const stdout = await fetchWithCurl(url, headers, 1024 * 1024 * 4, options.timeoutMs);
    return JSON.parse(stdout) as T;
  }
}

async function fetchText(
  url: string,
  headers: Record<string, string>,
  options: { timeoutMs?: number; curlFallback?: boolean } = {},
) {
  try {
    const { controller, done } = withTimeout(options.timeoutMs);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers,
      });
      if (!response.ok) throw new Error(`request failed with HTTP ${response.status}`);
      return await response.text();
    } finally {
      done();
    }
  } catch (error) {
    if (options.curlFallback === false) {
      throw error instanceof Error ? error : new Error("request failed");
    }
    return fetchWithCurl(url, headers, 1024 * 1024 * 8, options.timeoutMs);
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

function isAuthorizedShareRefresh(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return true;

  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
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

async function fetchFundApplyStatusesFromSources(
  codes: string[],
  options: { allowFallback?: boolean; timeoutMs?: number } = {},
) {
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
    }, {
      timeoutMs: options.timeoutMs,
      curlFallback: options.timeoutMs == null,
    });
    const statuses = parseApplyStatusRows(text, codes);
    const missingCodes = options.allowFallback
      ? codes.filter((code) => !statuses.has(code))
      : [];

    if (missingCodes.length > 0) {
      const fallbackStatuses = await runLimited(missingCodes, 6, fetchF10TradingStatus);
      for (const [code, status] of fallbackStatuses) {
        if (status) statuses.set(code, status);
      }
    }

    return statuses;
  } catch {
    if (!options.allowFallback) return new Map<string, FundApplyStatus>();
    const fallbackStatuses = await runLimited(codes, 6, fetchF10TradingStatus);
    return new Map(fallbackStatuses.filter((entry): entry is readonly [string, FundApplyStatus] => entry[1] != null));
  }
}

function selectApplyStatuses(statuses: Map<string, FundApplyStatus>, codes: string[]) {
  return new Map(
    codes.flatMap((code) => {
      const status = statuses.get(code);
      return status ? ([[code, status]] as const) : [];
    }),
  );
}

async function readSeedApplyStatuses(codes: string[]) {
  let seed: QdiiQuotesResponse | null = null;
  try {
    const parsed = JSON.parse(await readFile(join(process.cwd(), "data/seeds/qdii-quotes.json"), "utf8")) as QdiiQuotesResponse;
    const age = Date.now() - Date.parse(parsed.updatedAt);
    if (parsed.quotes && Number.isFinite(age) && age >= -60_000 && age <= 3 * 86400_000) seed = parsed;
  } catch {
    // Only recent subscription metadata can be used; never restore seed prices or premiums.
  }
  const seedDate = seed?.updatedAt?.slice(0, 10) ?? null;
  const statuses = new Map<string, FundApplyStatus>();

  for (const code of codes) {
    const quote = seed?.quotes[code];
    if (!quote || (!quote.subscriptionStatus && !quote.redemptionStatus)) continue;

    statuses.set(code, {
      subscriptionStatus: quote.subscriptionStatus,
      redemptionStatus: quote.redemptionStatus,
      subscriptionOpen: quote.subscriptionOpen,
      subscriptionDate: quote.subscriptionDate ?? seedDate,
      subscriptionMinAmount: quote.subscriptionMinAmount,
      dailySubscriptionCount: quote.dailySubscriptionCount,
      dailySubscriptionLimit: quote.dailySubscriptionLimit,
      subscriptionSource: quote.subscriptionSource ?? "最近申购状态快照",
      subscriptionSourceUrl: quote.subscriptionSourceUrl ?? "https://fund.eastmoney.com/",
      subscriptionNote: quote.subscriptionNote
        ? `批量接口暂时不可用，已保留最近快照：${quote.subscriptionNote}`
        : "批量接口暂时不可用，已保留最近申购状态快照",
    });
  }

  return statuses;
}

async function fetchFundApplyStatuses(
  codes: string[],
  options: { allowFallback?: boolean; timeoutMs?: number } = {},
) {
  if (applyStatusCache && applyStatusCache.expiresAt > Date.now()) {
    return selectApplyStatuses(applyStatusCache.statuses, codes);
  }

  if (!applyStatusRefreshPromise) {
    const previousStatuses = applyStatusCache?.statuses ?? new Map<string, FundApplyStatus>();
    applyStatusRefreshPromise = (async () => {
      const freshStatuses = await fetchFundApplyStatusesFromSources(codes, options);
      const mergedStatuses = new Map(previousStatuses);
      const seedStatuses = await readSeedApplyStatuses(codes);
      for (const [code, status] of seedStatuses) {
        if (!mergedStatuses.has(code)) mergedStatuses.set(code, status);
      }
      for (const [code, status] of freshStatuses) mergedStatuses.set(code, status);

      if (mergedStatuses.size > 0) {
        applyStatusCache = {
          expiresAt:
            Date.now() +
            (freshStatuses.size > 0 ? applyStatusCacheTtlMs : applyStatusFallbackTtlMs),
          statuses: mergedStatuses,
        };
      }
      return mergedStatuses;
    })().finally(() => {
      applyStatusRefreshPromise = null;
    });
  }

  return selectApplyStatuses(await applyStatusRefreshPromise, codes);
}

async function fetchMarketQuotes(codes: string[], options: { timeoutMs?: number } = {}) {
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
      {
        timeoutMs: options.timeoutMs,
        curlFallback: options.timeoutMs == null,
      },
    );
    return new Map((data.data?.diff ?? []).map((item) => [item.f12 ?? "", item]));
  } catch {
    return new Map<string, EastmoneyQuote>();
  }
}

async function fetchTencentQuotes(codes: string[], options: { timeoutMs?: number } = {}) {
  const { controller, done } = withTimeout(options.timeoutMs);
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
    if (!response.ok) return new Map<string, DailyQuote>();
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
        price: positiveNumber(fields[3]),
        priceDate: date,
        priceTime: time,
        changePct: numberOrNull(fields[32]),
        amount: amountFromDetail ?? (amountInWan != null ? amountInWan * 10000 : null),
        realtimeEstimate: positiveNumber(fields[78]),
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

async function loadQdiiQuotes(loadSlowFallbacks: boolean): Promise<QdiiQuotesResponse> {
  const codes = [...new Set(qdiiGroups.flatMap((group) => group.items.map((item) => item.code)))];
  const sourceTimeout = loadSlowFallbacks ? timeoutMs : fastSourceTimeoutMs;
  const fallbackQuoteTask = loadSlowFallbacks
    ? Promise.all([
        fetchSinaQuotes(codes),
        runLimited(codes, 8, async (code) => [code, await fetchDailyQuote(code)] as const),
        runLimited(codes, 8, async (code) => [code, await fetchFundEstimate(code)] as const),
      ] as const)
    : Promise.resolve([
        new Map<string, DailyQuote>(),
        codes.map((code) => [code, null] as const),
        codes.map((code) => [code, null] as const),
      ] as const);
  const [marketQuotes, shareSnapshots, tencentQuotes, fallbackQuotes, applyStatuses] = await Promise.all([
    fetchMarketQuotes(codes, { timeoutMs: sourceTimeout }),
    readQdiiShareHistory(codes),
    fetchTencentQuotes(codes, { timeoutMs: sourceTimeout }),
    fallbackQuoteTask,
    fetchFundApplyStatuses(codes, { timeoutMs: sourceTimeout, allowFallback: loadSlowFallbacks }),
  ]);
  const [sinaQuotes, dailyQuotes, estimates] = fallbackQuotes;
  const dailyQuoteMap = new Map(dailyQuotes);
  const estimateMap = new Map(estimates);
  const updatedAt = new Date().toISOString();
  const quotes: Record<string, QdiiEtfQuote> = {};
  for (const code of codes) {
    const market = marketQuotes.get(code);
    const tencentQuote = tencentQuotes.get(code);
    const estimate = estimateMap.get(code);
    const marketTime = shanghaiDateTimeFromSeconds(market?.f124);
    const selected = selectQdiiPrice([
      tencentQuote,
      { price: positiveNumber(market?.f2), priceTime: marketTime,
        priceDate: eastmoneyDate(market?.f297) ?? datePart(marketTime),
        changePct: numberOrNull(market?.f3), amount: numberOrNull(market?.f6), sourceName: "东方财富行情" },
      sinaQuotes.get(code), dailyQuoteMap.get(code),
    ]);
    const { price, priceDate, priceTime, changePct, amount } = selected;
    const reference = positiveNumber(tencentQuote?.realtimeEstimate);
    const estimated = positiveNumber(estimate?.gsz);
    const nav = reference ?? estimated;
    const navTime = reference != null ? tencentQuote?.priceTime ?? null : estimated != null ? estimate?.gztime ?? null : null;
    const navDate = datePart(navTime);
    const navKind = reference != null ? "reference" : estimated != null ? "estimate" : "missing";
    const navSource = reference != null ? "腾讯行情参考估值" : estimated != null ? "天天基金估算" : "无数据";
    const premium = qdiiPremium({ price, nav, priceDate, navDate, priceTime, navTime,
      quotedRate: tencentQuote?.premiumRate, sameProvider: reference != null && selected.sourceName === tencentQuote?.sourceName });
    const applyStatus = applyStatuses.get(code);
    const shares = shareMetrics(shareSnapshots.entries[code] ?? []);
    quotes[code] = {
      code, price, priceDate, priceTime: priceTime ?? null, changePct, amount,
      nav, navDate, navTime, navSource, navKind, ...premium,
      sourceName: selected.sourceName ?? "无数据",
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
      ...shares, updatedAt,
      status: premium.premiumRate != null && premium.premiumQuality !== "mismatch" ? "ok"
        : price != null || nav != null ? "partial" : "missing",
    };
  }
  return { updatedAt, quotes, mode: loadSlowFallbacks ? "full" : "fast",
    shareHistoryDegraded: shareSnapshots.degraded } satisfies QdiiQuotesResponse;
}

export async function GET(request: NextRequest) {
  const refreshShares = request.nextUrl.searchParams.get("refreshShares") === "1";
  if (refreshShares && !isAuthorizedShareRefresh(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const refresh = refreshShares ? await refreshQdiiShares() : null;
  if (refresh) { quoteCacheGeneration++; qdiiQuoteCache.clear(); }
  const details = request.nextUrl.searchParams.get("details") === "1";
  const generation = quoteCacheGeneration;
  const key = `${details ? "full" : "fast"}:${generation}`;
  const cached = qdiiQuoteCache.get(key);
  let payload: QdiiQuotesResponse;
  if (cached && cached.expiresAt > Date.now()) {
    payload = { ...cached.payload, cached: true };
  } else {
    let pending = qdiiQuoteRequests.get(key);
    if (!pending) {
      pending = loadQdiiQuotes(details).then((data) => {
        const hasQuotes = Object.values(data.quotes).some((quote) => quote.price != null);
        if (generation === quoteCacheGeneration) {
          qdiiQuoteCache.set(key, { expiresAt: Date.now() + (hasQuotes ? quoteCacheTtlMs : 5000), payload: data });
        }
        return data;
      }).finally(() => { qdiiQuoteRequests.delete(key); });
      qdiiQuoteRequests.set(key, pending);
    }
    payload = await pending;
  }
  return NextResponse.json({ ...payload, ...(refresh ? { shareRefresh: refresh } : {}) }, {
    status: refresh?.status === "storage-failed" ? 503 : refresh?.status === "upstream-failed" ? 502 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
