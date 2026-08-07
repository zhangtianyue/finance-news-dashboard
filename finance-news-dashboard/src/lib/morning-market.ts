export type MarketPulseItem = {
  id: string;
  label: string;
  group: "美股" | "利率汇率" | "商品";
  displayValue: string;
  changeLabel: string;
  changePercent: number;
  tone: "up" | "down" | "flat";
  asOfLabel: string;
};

export type MorningCalendarItem = {
  id: string;
  timeLabel: string;
  category: string;
  title: string;
  detail: string;
  importance: "high" | "medium" | "normal";
  url: string;
};

export type MorningMarketContext = {
  marketPulse: MarketPulseItem[];
  macroCalendar: MorningCalendarItem[];
  earningsCalendar: MorningCalendarItem[];
};

type PulseDefinition = {
  symbol: string;
  label: string;
  group: MarketPulseItem["group"];
  format: "index" | "yield" | "dxy" | "cnh" | "gold" | "energy" | "copper";
};

const pulseDefinitions: PulseDefinition[] = [
  { symbol: "^GSPC", label: "标普500", group: "美股", format: "index" },
  { symbol: "^NDX", label: "纳指100", group: "美股", format: "index" },
  { symbol: "^SOX", label: "费城半导体", group: "美股", format: "index" },
  { symbol: "^VIX", label: "VIX", group: "美股", format: "dxy" },
  { symbol: "^TNX", label: "美债10年", group: "利率汇率", format: "yield" },
  { symbol: "DX-Y.NYB", label: "美元指数", group: "利率汇率", format: "dxy" },
  { symbol: "CNH=X", label: "离岸人民币", group: "利率汇率", format: "cnh" },
  { symbol: "GC=F", label: "黄金", group: "商品", format: "gold" },
  { symbol: "BZ=F", label: "布伦特原油", group: "商品", format: "energy" },
  { symbol: "HG=F", label: "铜", group: "商品", format: "copper" },
];

const fetchTimeoutMs = 8000;
const nasdaqHeaders = {
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.nasdaq.com",
  "User-Agent": "Mozilla/5.0",
};

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

async function fetchJson<T>(url: URL, label: string, headers: HeadersInit): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`${label}返回 ${response.status}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new Error(`${label}请求超过 ${fetchTimeoutMs / 1000} 秒`);
  }
  throw lastError instanceof Error ? lastError : new Error(`${label}抓取失败`);
}

function formatMarketTime(timestamp: unknown) {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "时间待确认";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp * 1000));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function numberDisplay(value: number, maximumFractionDigits: number) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: maximumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

function formatPulseValue(value: number, format: PulseDefinition["format"]) {
  if (format === "yield") return `${value.toFixed(3)}%`;
  if (format === "index") return numberDisplay(value, 2);
  if (format === "cnh") return value.toFixed(4);
  if (format === "copper") return `$${value.toFixed(3)}`;
  if (format === "gold") return `$${numberDisplay(value, 1)}`;
  if (format === "energy") return `$${value.toFixed(2)}`;
  return value.toFixed(2);
}

function formatPulseChange(change: number, changePercent: number, format: PulseDefinition["format"]) {
  const sign = change > 0 ? "+" : "";
  if (format === "yield") return `${sign}${(change * 100).toFixed(1)}bp`;
  return `${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}%`;
}

type YahooSparkResponse = {
  spark?: {
    result?: Array<{
      symbol?: string;
      response?: Array<{
        meta?: {
          regularMarketPrice?: number;
          regularMarketTime?: number;
          chartPreviousClose?: number;
        };
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    }>;
  };
};

async function fetchMarketPulse(): Promise<MarketPulseItem[]> {
  const url = new URL("https://query2.finance.yahoo.com/v7/finance/spark");
  url.search = new URLSearchParams({
    symbols: pulseDefinitions.map((item) => item.symbol).join(","),
    range: "5d",
    interval: "1d",
  }).toString();
  const data = await fetchJson<YahooSparkResponse>(url, "隔夜行情", {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0",
  });
  const results = new Map(
    (data.spark?.result ?? []).map((item) => [item.symbol ?? "", item.response?.[0]]),
  );

  const pulse = pulseDefinitions.flatMap((definition) => {
    const result = results.get(definition.symbol);
    const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    const value = result?.meta?.regularMarketPrice ?? closes.at(-1);
    const previous = closes.length >= 2 ? closes.at(-2) : result?.meta?.chartPreviousClose;
    if (
      typeof value !== "number" ||
      typeof previous !== "number" ||
      !Number.isFinite(value) ||
      !Number.isFinite(previous) ||
      previous === 0
    ) {
      return [];
    }

    const change = value - previous;
    const changePercent = (change / previous) * 100;
    return [{
      id: definition.symbol,
      label: definition.label,
      group: definition.group,
      displayValue: formatPulseValue(value, definition.format),
      changeLabel: formatPulseChange(change, changePercent, definition.format),
      changePercent,
      tone: Math.abs(change) < 0.000001 ? "flat" as const : change > 0 ? "up" as const : "down" as const,
      asOfLabel: formatMarketTime(result?.meta?.regularMarketTime),
    }];
  });

  if (pulse.length < 8) {
    throw new Error(`隔夜行情仅返回 ${pulse.length}/${pulseDefinitions.length} 项有效数据`);
  }
  return pulse;
}

function cleanField(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function timeZoneOffset(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const inZoneAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return inZoneAsUtc - date.getTime();
}

function shiftedIsoDate(date: string, dayOffset: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return shifted.toISOString().slice(0, 10);
}

function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function newYorkWallTimeToUtc(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  let utcTime = wallTime - timeZoneOffset(new Date(wallTime), "America/New_York");
  utcTime = wallTime - timeZoneOffset(new Date(utcTime), "America/New_York");
  return new Date(utcTime);
}

const countryTimeZones: Record<string, string> = {
  China: "Asia/Shanghai",
  Japan: "Asia/Tokyo",
  "United States": "America/New_York",
  "Euro Zone": "Europe/Berlin",
  Germany: "Europe/Berlin",
  France: "Europe/Paris",
  Italy: "Europe/Rome",
  Spain: "Europe/Madrid",
  "United Kingdom": "Europe/London",
};

function beijingTimeFromNewYork(date: string, time: string, country: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) return "时间待定";
  const eventTimeZone = countryTimeZones[country] ?? "America/New_York";
  const candidates = [-1, 0, 1].map((dayOffset) =>
    newYorkWallTimeToUtc(shiftedIsoDate(date, dayOffset), time),
  );
  const converted =
    candidates.find((candidate) => dateInTimeZone(candidate, eventTimeZone) === date) ??
    candidates[1];
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(converted);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const convertedDate = `${get("year")}-${get("month")}-${get("day")}`;
  const prefix = convertedDate === date ? "" : convertedDate > date ? "次日 " : "前日 ";
  return `${prefix}${get("hour")}:${get("minute")}`;
}

const countryNames: Record<string, string> = {
  China: "中国",
  "United States": "美国",
  "Euro Zone": "欧元区",
  Germany: "德国",
  Japan: "日本",
  "United Kingdom": "英国",
};

function translateEventName(name: string) {
  const translations: Array<[RegExp, string]> = [
    [/Initial Jobless Claims/i, "首次申请失业救济人数"],
    [/Continuing Jobless Claims/i, "持续申请失业救济人数"],
    [/Nonfarm Payrolls/i, "非农就业人数"],
    [/Unemployment Rate/i, "失业率"],
    [/Trade Balance \(USD\)/i, "美元计价贸易帐"],
    [/Trade Balance/i, "贸易帐"],
    [/Exports/i, "出口"],
    [/Imports/i, "进口"],
    [/Retail Sales/i, "零售销售"],
    [/Factory Orders/i, "工厂订单"],
    [/Industrial Production/i, "工业产出"],
    [/Household Spending/i, "家庭支出"],
    [/Consumer Price Index|\bCPI\b/i, "消费者物价指数"],
    [/Producer Price Index|\bPPI\b/i, "生产者物价指数"],
    [/Gross Domestic Product|\bGDP\b/i, "国内生产总值"],
    [/Atlanta Fed GDPNow/i, "亚特兰大联储 GDPNow"],
    [/Interest Rate Decision/i, "利率决议"],
    [/ECB Economic Bulletin/i, "欧洲央行经济公报"],
  ];
  return translations.find(([pattern]) => pattern.test(name))?.[1] ?? name;
}

function macroScore(country: string, eventName: string) {
  const countryScore = country === "China" ? 5 : country === "United States" ? 4 :
    country === "Euro Zone" || country === "Japan" ? 3 : country === "Germany" ? 2 : 1;
  const high = /interest rate|fomc|fed |ecb |boj |cpi|pce|nonfarm payrolls|gross domestic|\bgdp\b|pmi|trade balance/i;
  const medium = /jobless claims|retail sales|exports|imports|unemployment|industrial production|factory orders|household spending/i;
  return countryScore + (high.test(eventName) ? 5 : medium.test(eventName) ? 3 : 0) +
    (/\(usd\)/i.test(eventName) ? 1 : 0);
}

type NasdaqEconomicResponse = {
  data?: {
    rows?: Array<{
      gmt?: string;
      country?: string;
      eventName?: string;
      actual?: string;
      consensus?: string;
      previous?: string;
    }>;
  };
};

function macroDetail(row: NonNullable<NonNullable<NasdaqEconomicResponse["data"]>["rows"]>[number]) {
  const actual = cleanField(row.actual);
  const consensus = cleanField(row.consensus);
  const previous = cleanField(row.previous);
  const parts = [
    actual ? `实际 ${actual}` : "",
    consensus ? `预期 ${consensus}` : "",
    previous ? `前值 ${previous}` : "",
  ].filter(Boolean);
  return parts.join(" / ") || "数值待公布";
}

async function fetchMacroCalendar(date: string): Promise<MorningCalendarItem[]> {
  const url = new URL("https://api.nasdaq.com/api/calendar/economicevents");
  url.searchParams.set("date", date);
  const data = await fetchJson<NasdaqEconomicResponse>(url, "宏观日历", nasdaqHeaders);
  const rows = Array.isArray(data.data?.rows) ? data.data.rows : [];
  const candidates = rows
    .map((row, index) => {
      const country = cleanField(row.country);
      const eventName = cleanField(row.eventName);
      const score =
        macroScore(country, eventName) +
        (/initial jobless claims/i.test(eventName) ? 1 : 0) +
        (cleanField(row.actual).includes("%") ? 0.25 : 0);
      return { row, index, country, eventName, score };
    })
    .filter(
      (item) =>
        item.country &&
        item.eventName &&
        item.score >= 5 &&
        !/construction pmi/i.test(item.eventName),
    )
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const countryCounts = new Map<string, number>();
  const seen = new Set<string>();
  const selected: typeof candidates = [];
  for (const item of candidates) {
    const normalizedEvent = item.eventName.toLowerCase().replace(/\s*\(usd\)\s*/g, "").replace(/[^a-z]/g, "");
    const key = `${item.country}|${normalizedEvent}`;
    if (seen.has(key) || (countryCounts.get(item.country) ?? 0) >= 2) continue;
    seen.add(key);
    countryCounts.set(item.country, (countryCounts.get(item.country) ?? 0) + 1);
    selected.push(item);
    if (selected.length >= 6) break;
  }

  return selected.map((item) => ({
    id: `macro-${date}-${item.index}`,
    timeLabel: beijingTimeFromNewYork(date, cleanField(item.row.gmt), item.country),
    category: countryNames[item.country] ?? item.country,
    title: translateEventName(item.eventName),
    detail: macroDetail(item.row),
    importance: item.score >= 10 ? "high" : item.score >= 8 ? "medium" : "normal",
    url: "https://www.nasdaq.com/market-activity/economic-calendar",
  }));
}

type NasdaqEarningsResponse = {
  data?: {
    rows?: Array<{
      time?: string;
      symbol?: string;
      name?: string;
      marketCap?: string;
      epsForecast?: string;
    }>;
  };
};

function parseMarketCap(value: unknown) {
  const parsed = Number(cleanField(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMarketCap(value: number) {
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}万亿美元`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e11 ? 0 : 1)}亿美元`;
  return `${(value / 1e6).toFixed(0)}百万美元`;
}

function earningsTimeLabel(value: unknown) {
  const time = cleanField(value);
  if (time === "time-pre-market") return "美股盘前";
  if (time === "time-after-hours") return "美股盘后";
  return "时间待定";
}

async function fetchEarningsCalendar(date: string): Promise<MorningCalendarItem[]> {
  const url = new URL("https://api.nasdaq.com/api/calendar/earnings");
  url.searchParams.set("date", date);
  const data = await fetchJson<NasdaqEarningsResponse>(url, "财报日历", nasdaqHeaders);
  const rows = Array.isArray(data.data?.rows) ? data.data.rows : [];
  const seenCompanies = new Set<string>();
  return rows
    .map((row, index) => ({
      row,
      index,
      symbol: cleanField(row.symbol),
      name: cleanField(row.name),
      marketCap: parseMarketCap(row.marketCap),
    }))
    .filter((item) => item.symbol && item.name && item.marketCap > 0)
    .sort((left, right) => right.marketCap - left.marketCap)
    .filter((item) => {
      const key = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seenCompanies.has(key)) return false;
      seenCompanies.add(key);
      return true;
    })
    .slice(0, 5)
    .map((item) => {
      const eps = cleanField(item.row.epsForecast);
      return {
        id: `earnings-${date}-${item.symbol}`,
        timeLabel: earningsTimeLabel(item.row.time),
        category: item.symbol,
        title: item.name,
        detail: `${formatMarketCap(item.marketCap)}${eps ? ` / EPS预期 ${eps}` : ""}`,
        importance: item.marketCap >= 1e11 ? "high" as const : item.marketCap >= 1e10 ? "medium" as const : "normal" as const,
        url: "https://www.nasdaq.com/market-activity/earnings",
      };
    });
}

export async function fetchMorningMarketContext(): Promise<MorningMarketContext> {
  const date = shanghaiDate();
  const [marketPulse, macroCalendar, earningsCalendar] = await Promise.all([
    fetchMarketPulse(),
    fetchMacroCalendar(date),
    fetchEarningsCalendar(date),
  ]);
  return { marketPulse, macroCalendar, earningsCalendar };
}

export function createEmptyMorningMarketContext(): MorningMarketContext {
  return { marketPulse: [], macroCalendar: [], earningsCalendar: [] };
}
