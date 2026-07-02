import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GlobalValuationSnapshot, IndexValuation } from "@/lib/global-valuations";
import { createGlobalValuationSnapshot } from "@/lib/global-valuations";

type DynamicMetric = {
  id: string;
  peTtm?: number;
  dividendYield?: number;
  sourceName: string;
  sourceUrl: string;
  fields: string[];
};

type StockAnalysisSource = {
  id: string;
  symbol: string;
};

const timeoutMs = 5500;
const snapshotTtlMs = 60 * 60 * 1000;
const valuationSnapshotPath = join(process.cwd(), "data/runtime/global-valuations.json");
const valuationSnapshotRedisKey = "global-valuations:snapshot:v1";

const stockAnalysisSources: StockAnalysisSource[] = [
  { id: "nasdaq100", symbol: "qqq" },
  { id: "dow", symbol: "dia" },
  { id: "russell2000", symbol: "iwm" },
  { id: "kospi", symbol: "ewy" },
  { id: "nifty50", symbol: "inda" },
  { id: "vietnam", symbol: "vnm" },
  { id: "dax", symbol: "ewg" },
  { id: "ftse100", symbol: "ewu" },
  { id: "cac40", symbol: "ewq" },
  { id: "msciworld", symbol: "urth" },
  { id: "msciem", symbol: "eem" },
];

let memorySnapshot:
  | {
      expiresAt: number;
      payload: GlobalValuationSnapshot;
    }
  | null = null;

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

function withTimeout() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timeout) };
}

async function fetchText(url: string) {
  const { signal, done } = withTimeout();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    done();
  }
}

function cleanText(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[,％%]/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function validMetric(value: number | null, min: number, max: number) {
  return value != null && value >= min && value <= max ? value : null;
}

function extractQuotedField(html: string, field: string) {
  const match = html.match(new RegExp(`${field}:"([^"]+)"`));
  return match?.[1] ?? null;
}

function parseStockAnalysisMetric(source: StockAnalysisSource, html: string): DynamicMetric | null {
  const peTtm = validMetric(parseNumber(extractQuotedField(html, "peRatio")), 3, 80);
  const dividendYield = validMetric(parseNumber(extractQuotedField(html, "Yield")), 0, 15);
  const fields: string[] = [];

  if (peTtm != null) fields.push("PE TTM");
  if (dividendYield != null) fields.push("股息率");
  if (fields.length === 0) return null;

  return {
    id: source.id,
    peTtm: peTtm ?? undefined,
    dividendYield: dividendYield ?? undefined,
    sourceName: `StockAnalysis ${source.symbol.toUpperCase()}`,
    sourceUrl: `https://stockanalysis.com/etf/${source.symbol}/`,
    fields,
  };
}

function parseFirstMultplValue(html: string) {
  const rows = html.matchAll(
    /<tr[^>]*>[\s\S]*?<td[^>]*>\s*([^<]+?)\s*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi,
  );

  for (const row of rows) {
    const date = cleanText(row[1]);
    const value = parseNumber(cleanText(row[2]));
    if (date && value != null) return value;
  }

  return null;
}

async function fetchSp500Metric() {
  const [peHtml, yieldHtml] = await Promise.all([
    fetchText("https://www.multpl.com/s-p-500-pe-ratio/table/by-month"),
    fetchText("https://www.multpl.com/s-p-500-dividend-yield/table/by-month"),
  ]);

  const peTtm = peHtml ? validMetric(parseFirstMultplValue(peHtml), 3, 80) : null;
  const dividendYield = yieldHtml ? validMetric(parseFirstMultplValue(yieldHtml), 0, 15) : null;
  const fields: string[] = [];

  if (peTtm != null) fields.push("PE TTM");
  if (dividendYield != null) fields.push("股息率");
  if (fields.length === 0) return null;

  return {
    id: "sp500",
    peTtm: peTtm ?? undefined,
    dividendYield: dividendYield ?? undefined,
    sourceName: "Multpl S&P 500",
    sourceUrl: "https://www.multpl.com/s-p-500-pe-ratio/table/by-month",
    fields,
  } satisfies DynamicMetric;
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

async function fetchStockAnalysisMetrics() {
  const metrics = await runLimited(stockAnalysisSources, 4, async (source) => {
    const html = await fetchText(`https://stockanalysis.com/etf/${source.symbol}/`);
    return html ? parseStockAnalysisMetric(source, html) : null;
  });

  return metrics.filter((metric): metric is DynamicMetric => metric != null);
}

function valuationBand(pe: number | null): IndexValuation["valuationBand"] {
  if (pe == null) return "缺数据";
  if (pe < 12) return "低";
  if (pe < 20) return "中";
  if (pe < 30) return "高";
  return "很高";
}

function applyMetrics(base: GlobalValuationSnapshot, metrics: DynamicMetric[]) {
  const metricById = new Map(metrics.map((metric) => [metric.id, metric]));
  let dynamicFields = 0;
  let dynamicRows = 0;

  const rows = base.rows.map((row) => {
    const metric = metricById.get(row.id);
    if (!metric) return row;

    dynamicRows += 1;
    dynamicFields += metric.fields.length;

    const peTtm = metric.peTtm ?? row.peTtm;
    const dividendYield = metric.dividendYield ?? row.dividendYield;

    return {
      ...row,
      peTtm,
      dividendYield,
      valuationBand: valuationBand(peTtm),
      quality: row.id === "sp500" ? "第三方估算" : "ETF近似",
      sourceName: metric.sourceName,
      sourceUrl: metric.sourceUrl,
      note: `${row.note} 动态字段：${metric.fields.join("、")}；其余字段沿用基准。`,
    } satisfies IndexValuation;
  });

  const time = createGlobalValuationSnapshot();
  return {
    ...base,
    asOf: time.asOf,
    asOfLabel: time.asOfLabel,
    methodology:
      "PE/PB/股息率使用动态抓取与内置基准混合口径。S&P 500 使用 Multpl 月度表，部分海外市场使用可交易 ETF 的 StockAnalysis PE/股息率近似；无法获取或未通过校验时保留内置基准。",
    rows,
    dataStatus: dynamicFields > 0 ? "dynamic" : "baseline",
    dynamicFields,
    dynamicRows,
    message:
      dynamicFields > 0
        ? `已动态更新 ${dynamicRows} 个指数的 ${dynamicFields} 个估值字段；未更新字段继续使用基准。`
        : "动态估值源暂时不可用，已显示内置基准。",
    updatedAt: time.asOf,
  } satisfies GlobalValuationSnapshot;
}

function isSnapshot(value: unknown): value is GlobalValuationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as GlobalValuationSnapshot;
  return Array.isArray(snapshot.rows) && Array.isArray(snapshot.qdiiGroups);
}

function withCurrentStaticParts(snapshot: GlobalValuationSnapshot, status: "cached") {
  const base = createGlobalValuationSnapshot();
  const savedRowsById = new Map(snapshot.rows.map((row) => [row.id, row]));

  return {
    ...snapshot,
    rows: base.rows.map((row) => savedRowsById.get(row.id) ?? row),
    qdiiGroups: base.qdiiGroups,
    dataStatus: status,
    message: `已显示最近动态缓存：${snapshot.message ?? "估值源暂时未刷新"}。`,
  } satisfies GlobalValuationSnapshot;
}

async function readSavedSnapshot() {
  if (redisConfig()) {
    try {
      const value = await upstashCommand<string | null>(["GET", valuationSnapshotRedisKey]);
      if (value) {
        const parsed = JSON.parse(value) as unknown;
        return isSnapshot(parsed) ? parsed : null;
      }
    } catch {
      // Fall through to the local file cache.
    }
  }

  try {
    const text = await readFile(valuationSnapshotPath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return isSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeSavedSnapshot(snapshot: GlobalValuationSnapshot) {
  if (redisConfig()) {
    try {
      await upstashCommand<string>(["SET", valuationSnapshotRedisKey, JSON.stringify(snapshot)]);
      return;
    } catch {
      // Fall through to local write. Vercel needs KV/Upstash env vars for persistence.
    }
  }

  try {
    await mkdir(dirname(valuationSnapshotPath), { recursive: true });
    await writeFile(valuationSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  } catch {
    // Serverless environments may not have persistent project storage.
  }
}

function isFresh(snapshot: GlobalValuationSnapshot) {
  const updatedAt = snapshot.updatedAt ?? snapshot.asOf;
  const updatedTime = Date.parse(updatedAt);
  return Number.isFinite(updatedTime) && Date.now() - updatedTime < snapshotTtlMs;
}

export async function getDynamicGlobalValuationSnapshot(options: { force?: boolean } = {}) {
  const force = options.force ?? false;
  const now = Date.now();

  if (!force && memorySnapshot && memorySnapshot.expiresAt > now) {
    return withCurrentStaticParts(memorySnapshot.payload, "cached");
  }

  const savedSnapshot = await readSavedSnapshot();
  if (!force && savedSnapshot && isFresh(savedSnapshot)) {
    memorySnapshot = {
      expiresAt: now + snapshotTtlMs,
      payload: savedSnapshot,
    };
    return withCurrentStaticParts(savedSnapshot, "cached");
  }

  const base = createGlobalValuationSnapshot();
  const metrics = (await Promise.all([fetchSp500Metric(), fetchStockAnalysisMetrics()]))
    .flat()
    .filter((metric): metric is DynamicMetric => metric != null);
  const snapshot = applyMetrics(base, metrics);

  if ((snapshot.dynamicFields ?? 0) > 0) {
    memorySnapshot = {
      expiresAt: now + snapshotTtlMs,
      payload: snapshot,
    };
    await writeSavedSnapshot(snapshot);
    return snapshot;
  }

  if (savedSnapshot) {
    return withCurrentStaticParts(savedSnapshot, "cached");
  }

  return snapshot;
}
