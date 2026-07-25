export type StockHeatMarket = "A股" | "美股";

export type StockHeatItem = {
  market: StockHeatMarket;
  rank: number;
  code: string;
  name: string;
  industry: string;
  price: number;
  changePercent: number;
  amount: number;
  turnoverRate: number | null;
  volumeRatio: number | null;
  amplitude: number | null;
  marketCap: number | null;
  heatScore: number;
  heatLevel: "沸腾" | "升温" | "活跃";
  signals: string[];
  quoteTimeLabel: string;
  quoteUrl: string;
};

export type StockHeatSnapshot = {
  status: "dynamic" | "partial" | "cached" | "unavailable";
  updatedAt: string;
  updatedAtLabel: string;
  message: string;
  sourceName: string;
  sourceUrl: string;
  aShareAsOfLabel: string;
  usStockAsOfLabel: string;
  aShares: StockHeatItem[];
  usStocks: StockHeatItem[];
};

type RawRecord = Record<string, unknown>;

type StockHeatCandidate = {
  market: StockHeatMarket;
  code: string;
  marketId: number;
  name: string;
  industry: string;
  price: number;
  changePercent: number;
  amount: number;
  turnoverRate: number | null;
  volumeRatio: number | null;
  amplitude: number | null;
  marketCap: number | null;
  quoteTimestamp: number | null;
};

const eastmoneyFields = [
  "f2",
  "f3",
  "f6",
  "f8",
  "f10",
  "f12",
  "f13",
  "f14",
  "f15",
  "f16",
  "f18",
  "f20",
  "f21",
  "f100",
  "f124",
].join(",");

const sourceUrl = "https://quote.eastmoney.com/center/";
const cacheTtlMs = 60_000;
let snapshotCache: { expiresAt: number; snapshot: StockHeatSnapshot } | null = null;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && value !== "-") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function quoteRows(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.data)) return [];
  const diff = payload.data.diff;
  if (Array.isArray(diff)) return diff.filter(isRecord);
  if (isRecord(diff)) return Object.values(diff).filter(isRecord);
  return [];
}

function shanghaiDateTimeFromSeconds(value: number | null) {
  if (value == null) return "待更新";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(value * 1000))
    .replace(/\//g, "-");
}

function candidateFromRow(row: RawRecord, market: StockHeatMarket): StockHeatCandidate | null {
  const code = stringOrNull(row.f12);
  const name = stringOrNull(row.f14);
  const marketId = numberOrNull(row.f13);
  const price = numberOrNull(row.f2);
  const changePercent = numberOrNull(row.f3);
  const amount = numberOrNull(row.f6);
  if (
    !code ||
    !name ||
    marketId == null ||
    price == null ||
    price <= 0 ||
    changePercent == null ||
    amount == null ||
    amount <= 0
  ) {
    return null;
  }

  const industry = stringOrNull(row.f100);
  const marketCap = numberOrNull(row.f20);
  if (
    market === "美股" &&
    (marketCap == null ||
      marketCap <= 0 ||
      !industry ||
      industry === "-" ||
      /ETF|ETN|基金|指数|2X|3X/i.test(name))
  ) {
    return null;
  }

  const high = numberOrNull(row.f15);
  const low = numberOrNull(row.f16);
  const previousClose = numberOrNull(row.f18);
  const amplitude =
    high != null && low != null && previousClose != null && previousClose > 0
      ? ((high - low) / previousClose) * 100
      : null;

  return {
    market,
    code,
    marketId,
    name,
    industry: industry ?? "其他",
    price,
    changePercent,
    amount,
    turnoverRate: numberOrNull(row.f8),
    volumeRatio: numberOrNull(row.f10),
    amplitude,
    marketCap,
    quoteTimestamp: numberOrNull(row.f124),
  };
}

function metricScore(value: number | null, reference: number) {
  if (value == null || value <= 0) return 0;
  return Math.min(value / reference, 1) * 100;
}

function amountScore(value: number, maximum: number) {
  if (value <= 0 || maximum <= 0) return 0;
  return (Math.log1p(value) / Math.log1p(maximum)) * 100;
}

function stockSignals(candidate: StockHeatCandidate, score: number) {
  const isAshare = candidate.market === "A股";
  const signals: string[] = [];
  if (score >= 76) signals.push("成交活跃");
  if ((candidate.volumeRatio ?? 0) >= 1.5) signals.push("明显放量");
  if ((candidate.turnoverRate ?? 0) >= (isAshare ? 8 : 4)) signals.push("换手活跃");
  if (Math.abs(candidate.changePercent) >= (isAshare ? 7 : 5)) signals.push("价格大幅异动");
  if ((candidate.amplitude ?? 0) >= (isAshare ? 8 : 6)) signals.push("盘中波动放大");
  return signals.length ? signals.slice(0, 3) : ["成交额居前"];
}

function rankCandidates(candidates: StockHeatCandidate[]) {
  const maximumAmount = Math.max(...candidates.map((candidate) => candidate.amount), 0);

  return candidates
    .map((candidate) => {
      const isAshare = candidate.market === "A股";
      const score =
        amountScore(candidate.amount, maximumAmount) * 0.45 +
        metricScore(candidate.volumeRatio, 3) * 0.18 +
        metricScore(candidate.turnoverRate, isAshare ? 15 : 8) * 0.17 +
        metricScore(Math.abs(candidate.changePercent), isAshare ? 10 : 8) * 0.12 +
        metricScore(candidate.amplitude, isAshare ? 12 : 10) * 0.08;
      const heatScore = Number(score.toFixed(1));

      return {
        ...candidate,
        heatScore,
        heatLevel: heatScore >= 80 ? ("沸腾" as const) : heatScore >= 68 ? ("升温" as const) : ("活跃" as const),
        signals: stockSignals(candidate, heatScore),
      };
    })
    .sort((left, right) => right.heatScore - left.heatScore || right.amount - left.amount)
    .slice(0, 10)
    .map<StockHeatItem>((candidate, index) => ({
      market: candidate.market,
      rank: index + 1,
      code: candidate.code,
      name: candidate.name,
      industry: candidate.industry,
      price: candidate.price,
      changePercent: candidate.changePercent,
      amount: candidate.amount,
      turnoverRate: candidate.turnoverRate,
      volumeRatio: candidate.volumeRatio,
      amplitude: candidate.amplitude,
      marketCap: candidate.marketCap,
      heatScore: candidate.heatScore,
      heatLevel: candidate.heatLevel,
      signals: candidate.signals,
      quoteTimeLabel: shanghaiDateTimeFromSeconds(candidate.quoteTimestamp),
      quoteUrl: `https://quote.eastmoney.com/unify/r/${candidate.marketId}.${candidate.code}`,
    }));
}

async function fetchEastmoneyRows(market: StockHeatMarket) {
  const query = new URLSearchParams({
    pn: "1",
    pz: market === "A股" ? "180" : "220",
    po: "1",
    np: "1",
    fltt: "2",
    invt: "2",
    fid: "f6",
    fs: market === "A股" ? "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23" : "m:105,m:106,m:107",
    fields: eastmoneyFields,
  });
  const hosts =
    market === "A股"
      ? ["https://push2.eastmoney.com", "https://19.push2.eastmoney.com", "https://push2delay.eastmoney.com"]
      : ["https://push2delay.eastmoney.com", "https://19.push2.eastmoney.com", "https://push2.eastmoney.com"];
  let lastError: unknown = null;

  for (const host of hosts) {
    try {
      const response = await fetch(`${host}/api/qt/clist/get?${query.toString()}`, {
        cache: "no-store",
        headers: {
          Accept: "application/json,text/plain,*/*",
          Referer: "https://quote.eastmoney.com/",
          "User-Agent": "Mozilla/5.0",
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`${market}行情接口 ${response.status}`);
      const rows = quoteRows(await response.json());
      if (!rows.length) throw new Error(`${market}行情返回为空`);
      return rows;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${market}行情暂时不可用`);
}

async function fetchMarketHeat(market: StockHeatMarket) {
  const rows = await fetchEastmoneyRows(market);
  const candidates = rows
    .map((row) => candidateFromRow(row, market))
    .filter((item): item is StockHeatCandidate => item != null);
  if (!candidates.length) throw new Error(`${market}没有可排名的股票`);
  return rankCandidates(candidates);
}

function latestQuoteLabel(items: StockHeatItem[], fallback: string) {
  return items[0]?.quoteTimeLabel ?? fallback;
}

export function createEmptyStockHeatSnapshot(message = "个股热度暂时不可用。"): StockHeatSnapshot {
  return {
    status: "unavailable",
    updatedAt: new Date().toISOString(),
    updatedAtLabel: "待更新",
    message,
    sourceName: "东方财富行情",
    sourceUrl,
    aShareAsOfLabel: "待更新",
    usStockAsOfLabel: "待更新",
    aShares: [],
    usStocks: [],
  };
}

export async function fetchStockHeatSnapshot({ force = false } = {}): Promise<StockHeatSnapshot> {
  const now = Date.now();
  if (!force && snapshotCache && snapshotCache.expiresAt > now) {
    return snapshotCache.snapshot;
  }

  const [aShareResult, usStockResult] = await Promise.allSettled([
    fetchMarketHeat("A股"),
    fetchMarketHeat("美股"),
  ]);
  const cached = snapshotCache?.snapshot;
  const aShares =
    aShareResult.status === "fulfilled" ? aShareResult.value : (cached?.aShares ?? []);
  const usStocks =
    usStockResult.status === "fulfilled" ? usStockResult.value : (cached?.usStocks ?? []);
  const freshMarkets = Number(aShareResult.status === "fulfilled") + Number(usStockResult.status === "fulfilled");

  if (!aShares.length && !usStocks.length) {
    const errors = [aShareResult, usStockResult]
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => (result.reason instanceof Error ? result.reason.message : "更新失败"));
    return createEmptyStockHeatSnapshot(errors.join("；") || "个股热度暂时不可用。");
  }

  const updatedAt = new Date();
  const status =
    freshMarkets === 2 ? "dynamic" : freshMarkets === 1 ? "partial" : ("cached" as const);
  const message =
    status === "dynamic"
      ? `已更新 A 股 ${aShares.length} 只、美股 ${usStocks.length} 只热门股票。`
      : status === "partial"
        ? "部分市场更新失败，已保留上一轮可用榜单。"
        : "实时更新失败，正在显示上一轮榜单。";
  const snapshot: StockHeatSnapshot = {
    status,
    updatedAt: updatedAt.toISOString(),
    updatedAtLabel: new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(updatedAt)
      .replace(/\//g, "-"),
    message,
    sourceName: "东方财富行情",
    sourceUrl,
    aShareAsOfLabel: latestQuoteLabel(aShares, cached?.aShareAsOfLabel ?? "待更新"),
    usStockAsOfLabel: latestQuoteLabel(usStocks, cached?.usStockAsOfLabel ?? "待更新"),
    aShares,
    usStocks,
  };

  snapshotCache = {
    expiresAt: now + cacheTtlMs,
    snapshot,
  };
  return snapshot;
}
