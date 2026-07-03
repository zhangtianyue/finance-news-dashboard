import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ashareDividendContinuityYears,
  ashareDividendMinimumYield,
} from "@/lib/a-share-dividend-config";

export type AshareDividendCompany = {
  rank: number;
  code: string;
  name: string;
  exchange: string;
  industry: string | null;
  price: number | null;
  changePct: number | null;
  dividendYield: number | null;
  annualBonusRmb: number | null;
  dividendEvents: number;
  progress: string | null;
  reportDate: string | null;
  planNoticeDate: string | null;
  equityRecordDate: string | null;
  exDividendDate: string | null;
  eps: number | null;
  bvps: number | null;
  profitGrowth: number | null;
  totalShares: number | null;
  quoteUrl: string;
  detailUrl: string;
};

export type AshareDividendSnapshot = {
  updatedAt: string;
  updatedAtLabel: string;
  reportDate: string | null;
  reportLabel: string;
  sourceName: string;
  sourceUrl: string;
  status: "ok" | "empty" | "error";
  message: string;
  qualifiedCount: number;
  continuityYears: number;
  minimumYield: number;
  rows: AshareDividendCompany[];
};

type EastmoneyResponse<T> = {
  result?: {
    pages?: number;
    data?: T[];
    count?: number;
  };
  success?: boolean;
  message?: string;
  code?: number;
};

type EastmoneyReportDate = {
  REPORT_DATE?: string;
};

type EastmoneyDividendRow = {
  SECURITY_CODE?: string;
  SECURITY_NAME_ABBR?: string;
  MARKET_TYPE?: string;
  REPORT_DATE?: string;
  PLAN_NOTICE_DATE?: string;
  EQUITY_RECORD_DATE?: string;
  EX_DIVIDEND_DATE?: string;
  ASSIGN_PROGRESS?: string;
  PRETAX_BONUS_RMB?: number | string;
  DIVIDENT_RATIO?: number | string | null;
  BASIC_EPS?: number | string;
  BVPS?: number | string;
  PNP_YOY_RATIO?: number | string;
  TOTAL_SHARES?: number | string;
  f2?: number | string;
  f3?: number | string;
  f100?: string;
};

const eastmoneyEndpoint = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const timeoutMs = 8000;
const dividendPageSize = 500;
const dividendSnapshotTtlMs = 10 * 60 * 1000;
const dividendSnapshotPath = join(process.cwd(), "data/runtime/a-share-dividends.json");
const dividendSnapshotRedisKey = "a-share-dividends:snapshot:v1";
const sourceName = "东方财富分红送配";
const sourceUrl = "https://data.eastmoney.com/yjfp/";

let memorySnapshot:
  | {
      expiresAt: number;
      payload: AshareDividendSnapshot;
    }
  | null = null;

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && value !== "-") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function datePart(value: string | null | undefined) {
  const match = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
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

function shanghaiDateTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function fiscalYearLabel(reportDate: string | null) {
  if (!reportDate) return "未确认年度";
  return `${reportDate.slice(0, 4)}完整年度`;
}

function exchangeName(code: string) {
  if (code.startsWith("6")) return "沪市";
  if (code.startsWith("0") || code.startsWith("3")) return "深市";
  if (code.startsWith("8") || code.startsWith("9")) return "北交所";
  return "A股";
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

function isSnapshot(value: unknown): value is AshareDividendSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as AshareDividendSnapshot;
  return (
    typeof snapshot.updatedAt === "string" &&
    typeof snapshot.message === "string" &&
    Array.isArray(snapshot.rows)
  );
}

function isFresh(snapshot: AshareDividendSnapshot) {
  const updatedTime = Date.parse(snapshot.updatedAt);
  return Number.isFinite(updatedTime) && Date.now() - updatedTime < dividendSnapshotTtlMs;
}

function withCacheMessage(snapshot: AshareDividendSnapshot, prefix = "已显示最近缓存") {
  return {
    ...snapshot,
    message: `${prefix}：${snapshot.message}`,
  } satisfies AshareDividendSnapshot;
}

async function readSavedSnapshot() {
  if (redisConfig()) {
    try {
      const value = await upstashCommand<string | null>(["GET", dividendSnapshotRedisKey]);
      if (value) {
        const parsed = JSON.parse(value) as unknown;
        return isSnapshot(parsed) ? parsed : null;
      }
    } catch {
      // Fall through to local cache.
    }
  }

  try {
    const text = await readFile(dividendSnapshotPath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSavedSnapshot(snapshot: AshareDividendSnapshot) {
  if (redisConfig()) {
    try {
      await upstashCommand<string>(["SET", dividendSnapshotRedisKey, JSON.stringify(snapshot)]);
      return;
    } catch {
      // Fall through to local write. Vercel needs KV/Upstash env vars for persistence.
    }
  }

  try {
    await mkdir(dirname(dividendSnapshotPath), { recursive: true });
    await writeFile(dividendSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  } catch {
    // Serverless environments may not have persistent project storage.
  }
}

function eastmoneyQuoteMarket(code: string) {
  return code.startsWith("6") ? "1" : "0";
}

async function fetchEastmoney<T>(params: Record<string, string | number>) {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${eastmoneyEndpoint}?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Referer: sourceUrl,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Eastmoney returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as EastmoneyResponse<T>;
    if (!data.success) {
      throw new Error(data.message ?? `Eastmoney returned code ${data.code ?? "unknown"}`);
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchReportDates() {
  const data = await fetchEastmoney<EastmoneyReportDate>({
    reportName: "RPT_DATE_SHAREBONUS_DET",
    columns: "ALL",
    pageNumber: 1,
    pageSize: 64,
    sortColumns: "REPORT_DATE",
    sortTypes: -1,
    source: "WEB",
    client: "WEB",
  });

  const today = shanghaiDate();
  return [...new Set((data.result?.data ?? []).map((row) => datePart(row.REPORT_DATE)))]
    .filter((value): value is string => Boolean(value))
    .filter((value) => value <= today);
}

async function fetchDividendRows(reportDate: string) {
  const fetchPage = (pageNumber: number) =>
    fetchEastmoney<EastmoneyDividendRow>({
      reportName: "RPT_SHAREBONUS_DET",
      columns:
        "SECURITY_CODE,SECURITY_NAME_ABBR,MARKET_TYPE,REPORT_DATE,PLAN_NOTICE_DATE,EQUITY_RECORD_DATE,EX_DIVIDEND_DATE,ASSIGN_PROGRESS,PRETAX_BONUS_RMB,DIVIDENT_RATIO,BASIC_EPS,BVPS,PNP_YOY_RATIO,TOTAL_SHARES",
      quoteColumns: "f2,f3,f12,f14,f100",
      pageNumber,
      pageSize: dividendPageSize,
      sortColumns: "SECURITY_CODE",
      sortTypes: "1",
      filter: `(REPORT_DATE='${reportDate}')`,
      source: "WEB",
      client: "WEB",
    });

  const firstPage = await fetchPage(1);
  const rows = [...(firstPage.result?.data ?? [])];
  const totalPages = firstPage.result?.pages ?? 1;

  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
    const page = await fetchPage(pageNumber);
    rows.push(...(page.result?.data ?? []));
  }

  return rows;
}

function reportDatesForFiscalYear(reportDates: string[], annualReportDate: string) {
  const fiscalYear = annualReportDate.slice(0, 4);
  return reportDates.filter((value) => value.startsWith(`${fiscalYear}-`));
}

function recentFiscalYears(annualReportDate: string) {
  const latestFiscalYear = Number(annualReportDate.slice(0, 4));
  return Array.from({ length: ashareDividendContinuityYears }, (_, index) =>
    String(latestFiscalYear - index),
  );
}

function reportDatesForFiscalYears(reportDates: string[], fiscalYears: string[]) {
  const fiscalYearSet = new Set(fiscalYears);
  return reportDates.filter((value) => fiscalYearSet.has(value.slice(0, 4)));
}

type AggregatedDividendRow = {
  code: string;
  name: string;
  industry: string | null;
  price: number | null;
  changePct: number | null;
  annualBonusRmb: number;
  dividendEvents: number;
  latestRow: EastmoneyDividendRow;
};

type RankedDividendRow = AggregatedDividendRow & {
  dividendYield: number;
};

function isLaterReportRow(candidate: EastmoneyDividendRow, current: EastmoneyDividendRow) {
  const candidateDate = datePart(candidate.REPORT_DATE) ?? "";
  const currentDate = datePart(current.REPORT_DATE) ?? "";
  if (candidateDate !== currentDate) return candidateDate > currentDate;

  const candidateNoticeDate = datePart(candidate.PLAN_NOTICE_DATE) ?? "";
  const currentNoticeDate = datePart(current.PLAN_NOTICE_DATE) ?? "";
  return candidateNoticeDate > currentNoticeDate;
}

function aggregateDividendRows(rows: EastmoneyDividendRow[]): RankedDividendRow[] {
  const companies = new Map<string, AggregatedDividendRow>();

  for (const row of rows) {
    const code = row.SECURITY_CODE ?? "";
    const pretaxBonusRmb = numberOrNull(row.PRETAX_BONUS_RMB);
    if (!code || pretaxBonusRmb == null || pretaxBonusRmb <= 0) continue;

    const price = numberOrNull(row.f2);
    const changePct = numberOrNull(row.f3);
    const existing = companies.get(code);

    if (!existing) {
      companies.set(code, {
        code,
        name: row.SECURITY_NAME_ABBR ?? code,
        industry: row.f100 ?? null,
        price,
        changePct,
        annualBonusRmb: pretaxBonusRmb,
        dividendEvents: 1,
        latestRow: row,
      });
      continue;
    }

    existing.annualBonusRmb += pretaxBonusRmb;
    existing.dividendEvents += 1;

    if (price != null && price > 0) {
      existing.price = price;
    }
    if (changePct != null) {
      existing.changePct = changePct;
    }
    if (row.f100) {
      existing.industry = row.f100;
    }
    if (isLaterReportRow(row, existing.latestRow)) {
      existing.latestRow = row;
    }
  }

  return [...companies.values()]
    .map((company) => {
      const dividendYield =
        company.price != null && company.price > 0
          ? (company.annualBonusRmb / 10 / company.price) * 100
          : null;
      return { ...company, dividendYield };
    })
    .filter((company): company is RankedDividendRow => company.dividendYield != null)
    .sort((a, b) => {
      if (a.dividendYield !== b.dividendYield) {
        return (b.dividendYield ?? 0) - (a.dividendYield ?? 0);
      }
      return a.code.localeCompare(b.code);
    });
}

function continuousDividendCompanyCodes(rows: EastmoneyDividendRow[], fiscalYears: string[]) {
  const requiredYears = new Set(fiscalYears);
  const yearsByCompany = new Map<string, Set<string>>();

  for (const row of rows) {
    const code = row.SECURITY_CODE ?? "";
    const reportDate = datePart(row.REPORT_DATE);
    const fiscalYear = reportDate?.slice(0, 4);
    const pretaxBonusRmb = numberOrNull(row.PRETAX_BONUS_RMB);
    if (!code || !fiscalYear || !requiredYears.has(fiscalYear)) continue;
    if (pretaxBonusRmb == null || pretaxBonusRmb <= 0) continue;

    const years = yearsByCompany.get(code) ?? new Set<string>();
    years.add(fiscalYear);
    yearsByCompany.set(code, years);
  }

  return new Set(
    [...yearsByCompany.entries()]
      .filter(([, years]) => fiscalYears.every((fiscalYear) => years.has(fiscalYear)))
      .map(([code]) => code),
  );
}

function mapDividendRow(row: RankedDividendRow, rank: number): AshareDividendCompany {
  const latestRow = row.latestRow;
  return {
    rank,
    code: row.code,
    name: row.name,
    exchange: exchangeName(row.code),
    industry: row.industry,
    price: row.price,
    changePct: row.changePct,
    dividendYield: row.dividendYield,
    annualBonusRmb: row.annualBonusRmb,
    dividendEvents: row.dividendEvents,
    progress: latestRow.ASSIGN_PROGRESS ?? null,
    reportDate: datePart(latestRow.REPORT_DATE),
    planNoticeDate: datePart(latestRow.PLAN_NOTICE_DATE),
    equityRecordDate: datePart(latestRow.EQUITY_RECORD_DATE),
    exDividendDate: datePart(latestRow.EX_DIVIDEND_DATE),
    eps: numberOrNull(latestRow.BASIC_EPS),
    bvps: numberOrNull(latestRow.BVPS),
    profitGrowth: numberOrNull(latestRow.PNP_YOY_RATIO),
    totalShares: numberOrNull(latestRow.TOTAL_SHARES),
    quoteUrl: `https://quote.eastmoney.com/unify/r/${eastmoneyQuoteMarket(row.code)}.${row.code}`,
    detailUrl: `${sourceUrl}detail/${row.code}.html`,
  };
}

export function createEmptyAshareDividendSnapshot(message = "尚未获取到 A 股股息率数据。") {
  const now = new Date();
  return {
    updatedAt: now.toISOString(),
    updatedAtLabel: shanghaiDateTimeLabel(now),
    reportDate: null,
    reportLabel: "未确认报告期",
    sourceName,
    sourceUrl,
    status: "empty",
    message,
    qualifiedCount: 0,
    continuityYears: ashareDividendContinuityYears,
    minimumYield: ashareDividendMinimumYield,
    rows: [],
  } satisfies AshareDividendSnapshot;
}

async function buildAshareDividendSnapshot(): Promise<AshareDividendSnapshot> {
  const reportDates = await fetchReportDates();
  const annualReportDates = reportDates.filter((value) => value.endsWith("-12-31"));

  for (const reportDate of annualReportDates) {
    const fiscalYears = recentFiscalYears(reportDate);
    const requiredReportDates = reportDatesForFiscalYears(reportDates, fiscalYears);
    const dividendRows = (
      await Promise.all(
        requiredReportDates.map((value) => fetchDividendRows(value)),
      )
    ).flat();

    const continuousCodes = continuousDividendCompanyCodes(dividendRows, fiscalYears);
    const currentFiscalYearReportDates = new Set(reportDatesForFiscalYear(reportDates, reportDate));
    const currentFiscalYearRows = dividendRows.filter((row) =>
      currentFiscalYearReportDates.has(datePart(row.REPORT_DATE) ?? ""),
    );
    const qualifiedRows = aggregateDividendRows(currentFiscalYearRows).filter((row) =>
      continuousCodes.has(row.code),
    );
    const displayRows = qualifiedRows.filter(
      (row) => row.dividendYield > ashareDividendMinimumYield,
    );
    const mappedRows = displayRows
      .map((row, index) => mapDividendRow(row, index + 1));
    if (mappedRows.length > 0) {
      const now = new Date();
      return {
        updatedAt: now.toISOString(),
        updatedAtLabel: shanghaiDateTimeLabel(now),
        reportDate,
        reportLabel: fiscalYearLabel(reportDate),
        sourceName,
        sourceUrl,
        status: "ok",
        message: `已按最近 ${ashareDividendContinuityYears} 个完整年度连续现金分红筛选，并用 ${fiscalYearLabel(reportDate)}现金分红合计 / 当前价格计算，展示股息率高于 ${ashareDividendMinimumYield}% 的 ${displayRows.length} 家。`,
        qualifiedCount: qualifiedRows.length,
        continuityYears: ashareDividendContinuityYears,
        minimumYield: ashareDividendMinimumYield,
        rows: mappedRows,
      };
    }
  }

  return createEmptyAshareDividendSnapshot(
    `最近 ${ashareDividendContinuityYears} 个完整年度连续现金分红公司中，没有找到动态股息率高于 ${ashareDividendMinimumYield}% 的公司。`,
  );
}

export async function fetchAshareDividendSnapshot(
  options: { force?: boolean } = {},
): Promise<AshareDividendSnapshot> {
  const force = options.force ?? false;
  const now = Date.now();

  if (!force && memorySnapshot && memorySnapshot.expiresAt > now) {
    return withCacheMessage(memorySnapshot.payload);
  }

  const savedSnapshot = await readSavedSnapshot();
  if (!force && savedSnapshot && isFresh(savedSnapshot)) {
    memorySnapshot = {
      expiresAt: now + dividendSnapshotTtlMs,
      payload: savedSnapshot,
    };
    return withCacheMessage(savedSnapshot);
  }

  try {
    const snapshot = await buildAshareDividendSnapshot();
    memorySnapshot = {
      expiresAt: now + dividendSnapshotTtlMs,
      payload: snapshot,
    };
    await writeSavedSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    if (savedSnapshot) {
      const message = error instanceof Error ? error.message : "数据源暂时不可用";
      return withCacheMessage(savedSnapshot, `A 股股息率更新失败，已显示最近缓存（${message}）`);
    }
    throw error;
  }
}
