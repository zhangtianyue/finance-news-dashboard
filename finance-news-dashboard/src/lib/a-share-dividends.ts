import { ashareDividendRankingLimit } from "@/lib/a-share-dividend-config";

export type AshareDividendCompany = {
  rank: number;
  code: string;
  name: string;
  exchange: string;
  industry: string | null;
  price: number | null;
  changePct: number | null;
  dividendYield: number | null;
  pretaxBonusRmb: number | null;
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
const sourceName = "东方财富分红送配";
const sourceUrl = "https://data.eastmoney.com/yjfp/";

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

function reportLabel(value: string | null) {
  if (!value) return "未确认报告期";
  const [year, month] = value.split("-");
  if (month === "12") return `${year}年年报`;
  if (month === "06") return `${year}年中报`;
  if (month === "03") return `${year}年一季报`;
  if (month === "09") return `${year}年三季报`;
  return value;
}

function exchangeName(code: string) {
  if (code.startsWith("6")) return "沪市";
  if (code.startsWith("0") || code.startsWith("3")) return "深市";
  if (code.startsWith("8") || code.startsWith("9")) return "北交所";
  return "A股";
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
    pageSize: 12,
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
  const data = await fetchEastmoney<EastmoneyDividendRow>({
    reportName: "RPT_SHAREBONUS_DET",
    columns:
      "SECURITY_CODE,SECURITY_NAME_ABBR,MARKET_TYPE,REPORT_DATE,PLAN_NOTICE_DATE,EQUITY_RECORD_DATE,EX_DIVIDEND_DATE,ASSIGN_PROGRESS,PRETAX_BONUS_RMB,DIVIDENT_RATIO,BASIC_EPS,BVPS,PNP_YOY_RATIO,TOTAL_SHARES",
    quoteColumns: "f2,f3,f12,f14,f100",
    pageNumber: 1,
    pageSize: ashareDividendRankingLimit,
    sortColumns: "DIVIDENT_RATIO,SECURITY_CODE",
    sortTypes: "-1,1",
    filter: `(REPORT_DATE='${reportDate}')(DIVIDENT_RATIO>0)`,
    source: "WEB",
    client: "WEB",
  });

  return data.result?.data ?? [];
}

function mapDividendRow(row: EastmoneyDividendRow, rank: number): AshareDividendCompany {
  const code = row.SECURITY_CODE ?? "";
  const dividendRatio = numberOrNull(row.DIVIDENT_RATIO);
  return {
    rank,
    code,
    name: row.SECURITY_NAME_ABBR ?? code,
    exchange: exchangeName(code),
    industry: row.f100 ?? null,
    price: numberOrNull(row.f2),
    changePct: numberOrNull(row.f3),
    dividendYield: dividendRatio != null ? dividendRatio * 100 : null,
    pretaxBonusRmb: numberOrNull(row.PRETAX_BONUS_RMB),
    progress: row.ASSIGN_PROGRESS ?? null,
    reportDate: datePart(row.REPORT_DATE),
    planNoticeDate: datePart(row.PLAN_NOTICE_DATE),
    equityRecordDate: datePart(row.EQUITY_RECORD_DATE),
    exDividendDate: datePart(row.EX_DIVIDEND_DATE),
    eps: numberOrNull(row.BASIC_EPS),
    bvps: numberOrNull(row.BVPS),
    profitGrowth: numberOrNull(row.PNP_YOY_RATIO),
    totalShares: numberOrNull(row.TOTAL_SHARES),
    quoteUrl: `https://quote.eastmoney.com/unify/r/${eastmoneyQuoteMarket(code)}.${code}`,
    detailUrl: `${sourceUrl}detail/${code}.html`,
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
    rows: [],
  } satisfies AshareDividendSnapshot;
}

export async function fetchAshareDividendSnapshot(): Promise<AshareDividendSnapshot> {
  const reportDates = await fetchReportDates();

  for (const reportDate of reportDates) {
    const rows = await fetchDividendRows(reportDate);
    const mappedRows = rows.map((row, index) => mapDividendRow(row, index + 1));
    if (mappedRows.length >= ashareDividendRankingLimit) {
      const now = new Date();
      return {
        updatedAt: now.toISOString(),
        updatedAtLabel: shanghaiDateTimeLabel(now),
        reportDate,
        reportLabel: reportLabel(reportDate),
        sourceName,
        sourceUrl,
        status: "ok",
        message: `已按 ${reportLabel(reportDate)} 股息率倒序取前 ${ashareDividendRankingLimit} 名。`,
        rows: mappedRows,
      };
    }
  }

  return createEmptyAshareDividendSnapshot("最近报告期没有足够的有效股息率数据。");
}
