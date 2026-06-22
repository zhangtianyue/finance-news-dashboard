import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
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

const timeoutMs = 8000;
const execFileAsync = promisify(execFile);

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
    const args = [
      "-sS",
      "--max-time",
      String(Math.ceil(timeoutMs / 1000)),
      url,
      ...Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]),
    ];
    const { stdout } = await execFileAsync("/usr/bin/curl", args, {
      maxBuffer: 1024 * 1024 * 4,
    });
    return JSON.parse(stdout) as T;
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
  const marketQuotes = await fetchMarketQuotes(codes);
  const [tencentQuotes, sinaQuotes, dailyQuotes, mobileEstimates, estimates] = await Promise.all([
    fetchTencentQuotes(codes),
    fetchSinaQuotes(codes),
    runLimited(codes, 8, async (code) => [code, await fetchDailyQuote(code)] as const),
    runLimited(codes, 8, async (code) => [code, await fetchEastmoneyMobileEstimate(code)] as const),
    runLimited(codes, 8, async (code) => [code, await fetchFundEstimate(code)] as const),
  ]);
  const dailyQuoteMap = new Map(dailyQuotes);
  const mobileEstimateMap = new Map(mobileEstimates);
  const estimateMap = new Map(estimates);
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
      updatedAt,
      status: price != null && nav != null ? "ok" : price != null || nav != null ? "partial" : "missing",
    };
  }

  return NextResponse.json(
    { updatedAt, quotes },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
