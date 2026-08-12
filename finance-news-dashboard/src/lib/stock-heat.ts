export type StockHeatMarket = "A股" | "美股";
export type StockHeatLevel = "沸腾" | "升温" | "活跃";

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
  heatLevel: StockHeatLevel;
  signals: string[];
  quoteTimeLabel: string;
  quoteUrl: string;
};

export type StockHeatSector = {
  market: StockHeatMarket;
  rank: number;
  name: string;
  heatScore: number;
  heatLevel: StockHeatLevel;
  changePercent: number;
  amount: number;
  averageTurnoverRate: number | null;
  averageVolumeRatio: number | null;
  memberCount: number;
  activeStocks: number;
  risingStocks: number;
  fallingStocks: number;
  leaderName: string;
  leaderCode: string;
  leaderChangePercent: number;
  leaderUrl: string;
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
  aSharePanorama: StockHeatItem[];
  usStockPanorama: StockHeatItem[];
  aShareSectors: StockHeatSector[];
  usStockSectors: StockHeatSector[];
};

type RawRecord = Record<string, unknown>;

type StockHeatCandidate = {
  market: StockHeatMarket;
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
  quoteTimestamp: number | null;
  quoteTimeLabel?: string;
  quoteUrl: string;
};

type RankedStockCandidate = StockHeatCandidate & {
  heatScore: number;
  heatLevel: StockHeatLevel;
  signals: string[];
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
const sinaSourceUrl = "https://vip.stock.finance.sina.com.cn/mkt/";
const nasdaqSourceUrl = "https://www.nasdaq.com/market-activity/stocks/screener";
const cacheTtlMs = 60_000;
const upstreamTimeoutMs = 4_500;
const fallbackTimeoutMs = 6_500;
let snapshotCache: { expiresAt: number; snapshot: StockHeatSnapshot } | null = null;
let snapshotRefreshPromise: Promise<StockHeatSnapshot> | null = null;

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

function numericText(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[$,%]/g, "").trim();
  if (!normalized || normalized === "N/A" || normalized === "-") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function shanghaiTimestampFromClock(value: unknown) {
  const clock = stringOrNull(value);
  if (!clock || !/^\d{2}:\d{2}:\d{2}$/.test(clock)) return null;
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const timestamp = Date.parse(`${date}T${clock}+08:00`);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
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
    quoteUrl: `https://quote.eastmoney.com/unify/r/${marketId}.${code}`,
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

function scoreCandidates(candidates: StockHeatCandidate[]) {
  const maximumAmount = Math.max(...candidates.map((candidate) => candidate.amount), 0);

  return candidates
    .map<RankedStockCandidate>((candidate) => {
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
        heatLevel: heatScore >= 80 ? "沸腾" : heatScore >= 68 ? "升温" : "活跃",
        signals: stockSignals(candidate, heatScore),
      };
    })
    .sort((left, right) => right.heatScore - left.heatScore || right.amount - left.amount);
}

function toStockHeatItems(candidates: RankedStockCandidate[]) {
  return candidates.map<StockHeatItem>((candidate, index) => ({
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
      quoteTimeLabel:
        candidate.quoteTimeLabel ?? shanghaiDateTimeFromSeconds(candidate.quoteTimestamp),
      quoteUrl: candidate.quoteUrl,
    }));
}

function rankCandidates(candidates: RankedStockCandidate[]) {
  return toStockHeatItems(candidates.slice(0, 10));
}

function panoramaCandidates(candidates: RankedStockCandidate[]) {
  return toStockHeatItems(
    [...candidates].sort((left, right) => right.amount - left.amount).slice(0, 60),
  );
}

function average(values: Array<number | null>) {
  const available = values.filter((value): value is number => value != null);
  if (!available.length) return null;
  return available.reduce((sum, value) => sum + value, 0) / available.length;
}

function rankSectors(candidates: RankedStockCandidate[]) {
  const groups = new Map<string, RankedStockCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.industry === "其他" || candidate.industry === "-") continue;
    const current = groups.get(candidate.industry) ?? [];
    current.push(candidate);
    groups.set(candidate.industry, current);
  }

  const aggregates = [...groups.entries()]
    .filter(([, members]) => members.length >= 2)
    .map(([name, members]) => {
      const amount = members.reduce((sum, member) => sum + member.amount, 0);
      const leader = [...members].sort(
        (left, right) => right.heatScore - left.heatScore || right.amount - left.amount,
      )[0];
      const weightedChange =
        amount > 0
          ? members.reduce(
              (sum, member) => sum + member.changePercent * member.amount,
              0,
            ) / amount
          : 0;

      return {
        market: members[0].market,
        name,
        amount,
        changePercent: weightedChange,
        averageTurnoverRate: average(members.map((member) => member.turnoverRate)),
        averageVolumeRatio: average(members.map((member) => member.volumeRatio)),
        averageStockHeat:
          members.reduce((sum, member) => sum + member.heatScore, 0) / members.length,
        memberCount: members.length,
        activeStocks: members.filter((member) => member.heatScore >= 68).length,
        risingStocks: members.filter((member) => member.changePercent > 0).length,
        fallingStocks: members.filter((member) => member.changePercent < 0).length,
        leader,
      };
    });
  const maximumAmount = Math.max(...aggregates.map((sector) => sector.amount), 0);

  return aggregates
    .map((sector) => {
      const isAshare = sector.market === "A股";
      const score =
        metricScore(sector.amount, maximumAmount) * 0.4 +
        metricScore(Math.abs(sector.changePercent), isAshare ? 6 : 5) * 0.2 +
        metricScore(sector.averageTurnoverRate, isAshare ? 10 : 5) * 0.13 +
        metricScore(sector.averageVolumeRatio, 2) * 0.12 +
        metricScore(sector.averageStockHeat, 80) * 0.15;
      const heatScore = Number(score.toFixed(1));

      return {
        ...sector,
        heatScore,
        heatLevel:
          heatScore >= 78 ? ("沸腾" as const) : heatScore >= 63 ? ("升温" as const) : ("活跃" as const),
      };
    })
    .sort((left, right) => right.heatScore - left.heatScore || right.amount - left.amount)
    .slice(0, 10)
    .map<StockHeatSector>((sector, index) => ({
      market: sector.market,
      rank: index + 1,
      name: sector.name,
      heatScore: sector.heatScore,
      heatLevel: sector.heatLevel,
      changePercent: Number(sector.changePercent.toFixed(2)),
      amount: sector.amount,
      averageTurnoverRate:
        sector.averageTurnoverRate == null
          ? null
          : Number(sector.averageTurnoverRate.toFixed(2)),
      averageVolumeRatio:
        sector.averageVolumeRatio == null ? null : Number(sector.averageVolumeRatio.toFixed(2)),
      memberCount: sector.memberCount,
      activeStocks: sector.activeStocks,
      risingStocks: sector.risingStocks,
      fallingStocks: sector.fallingStocks,
      leaderName: sector.leader.name,
      leaderCode: sector.leader.code,
      leaderChangePercent: sector.leader.changePercent,
      leaderUrl: sector.leader.quoteUrl,
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
  const hosts = [
    "https://push2delay.eastmoney.com",
    "https://push2.eastmoney.com",
    "https://19.push2.eastmoney.com",
  ];

  async function fetchFromHost(host: string) {
    const response = await fetch(`${host}/api/qt/clist/get?${query.toString()}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json,text/plain,*/*",
        Referer: "https://quote.eastmoney.com/",
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(upstreamTimeoutMs),
    });
    if (!response.ok) throw new Error(`${market}行情接口 ${response.status}`);
    const rows = quoteRows(await response.json());
    if (!rows.length) throw new Error(`${market}行情返回为空`);
    return rows;
  }

  try {
    return await Promise.any(hosts.map(fetchFromHost));
  } catch (error) {
    const reasons =
      error instanceof AggregateError
        ? error.errors.map((reason) =>
            reason instanceof Error ? reason.message : String(reason),
          )
        : [error instanceof Error ? error.message : `${market}行情暂时不可用`];
    throw new Error([...new Set(reasons)].join("；"));
  }
}

async function fetchSinaAShareCandidates() {
  const url = new URL(
    "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData",
  );
  url.search = new URLSearchParams({
    page: "1",
    num: "180",
    sort: "amount",
    asc: "0",
    node: "hs_a",
    symbol: "",
    _s_r_a: "page",
  }).toString();
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json,text/plain,*/*",
      Referer: "https://vip.stock.finance.sina.com.cn/mkt/",
      "User-Agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(fallbackTimeoutMs),
  });
  if (!response.ok) throw new Error(`新浪 A 股行情 ${response.status}`);
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) throw new Error("新浪 A 股行情格式异常");

  return payload
    .filter(isRecord)
    .map<StockHeatCandidate | null>((row) => {
      const symbol = stringOrNull(row.symbol);
      const code = stringOrNull(row.code);
      const name = stringOrNull(row.name);
      const price = numberOrNull(row.trade);
      const changePercent = numberOrNull(row.changepercent);
      const amount = numberOrNull(row.amount);
      if (
        !symbol ||
        !code ||
        !name ||
        price == null ||
        price <= 0 ||
        changePercent == null ||
        amount == null ||
        amount <= 0
      ) {
        return null;
      }
      const high = numberOrNull(row.high);
      const low = numberOrNull(row.low);
      const previousClose = numberOrNull(row.settlement);
      const amplitude =
        high != null && low != null && previousClose != null && previousClose > 0
          ? ((high - low) / previousClose) * 100
          : null;
      const marketCap = numberOrNull(row.mktcap);
      return {
        market: "A股",
        code,
        name,
        industry: "其他",
        price,
        changePercent,
        amount,
        turnoverRate: numberOrNull(row.turnoverratio),
        volumeRatio: null,
        amplitude,
        marketCap: marketCap == null ? null : marketCap * 10_000,
        quoteTimestamp: shanghaiTimestampFromClock(row.ticktime),
        quoteUrl: `https://finance.sina.com.cn/realstock/company/${symbol}/nc.shtml`,
      };
    })
    .filter((item): item is StockHeatCandidate => item != null);
}

const nasdaqSectorNames: Record<string, string> = {
  Technology: "科技",
  "Health Care": "医疗保健",
  Finance: "金融",
  Industrials: "工业",
  Energy: "能源",
  Utilities: "公用事业",
  "Real Estate": "房地产",
  Telecommunications: "通信",
  "Consumer Discretionary": "可选消费",
  "Consumer Staples": "必选消费",
  "Basic Materials": "原材料",
  Miscellaneous: "其他",
};

async function fetchNasdaqUsCandidates() {
  const url = new URL("https://api.nasdaq.com/api/screener/stocks");
  url.search = new URLSearchParams({
    tableonly: "true",
    limit: "500",
    offset: "0",
    download: "true",
  }).toString();
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json, text/plain, */*",
      Origin: "https://www.nasdaq.com",
      Referer: nasdaqSourceUrl,
      "User-Agent": "Mozilla/5.0",
    },
    signal: AbortSignal.timeout(fallbackTimeoutMs),
  });
  if (!response.ok) throw new Error(`Nasdaq 美股行情 ${response.status}`);
  const payload = (await response.json()) as unknown;
  const rows =
    isRecord(payload) && isRecord(payload.data) && Array.isArray(payload.data.rows)
      ? payload.data.rows.filter(isRecord)
      : [];
  if (!rows.length) throw new Error("Nasdaq 美股行情返回为空");
  const fetchedAtLabel = `抓取时间 ${shanghaiDateTimeFromSeconds(Math.floor(Date.now() / 1000))}`;

  return rows
    .map<StockHeatCandidate | null>((row) => {
      const code = stringOrNull(row.symbol);
      const name = stringOrNull(row.name);
      const price = numericText(row.lastsale);
      const changePercent = numericText(row.pctchange);
      const volume = numericText(row.volume);
      const marketCap = numericText(row.marketCap);
      const sector = stringOrNull(row.sector);
      if (
        !code ||
        !name ||
        price == null ||
        price <= 0 ||
        changePercent == null ||
        volume == null ||
        volume <= 0 ||
        marketCap == null ||
        marketCap < 100_000_000 ||
        /ETF|ETN|Warrant|Units?|Rights?|Preferred Stock|Fund/i.test(name)
      ) {
        return null;
      }
      const amount = price * volume;
      return {
        market: "美股",
        code,
        name,
        industry: sector ? (nasdaqSectorNames[sector] ?? sector) : "其他",
        price,
        changePercent,
        amount,
        turnoverRate: marketCap > 0 ? (amount / marketCap) * 100 : null,
        volumeRatio: null,
        amplitude: null,
        marketCap,
        quoteTimestamp: null,
        quoteTimeLabel: fetchedAtLabel,
        quoteUrl: stringOrNull(row.url)
          ? `https://www.nasdaq.com${stringOrNull(row.url)}`
          : nasdaqSourceUrl,
      };
    })
    .filter((item): item is StockHeatCandidate => item != null);
}

async function fetchMarketHeat(market: StockHeatMarket) {
  let candidates: StockHeatCandidate[];
  let sourceName = "东方财富行情";
  let resultSourceUrl = sourceUrl;
  let usedFallback = false;
  try {
    const rows = await fetchEastmoneyRows(market);
    candidates = rows
      .map((row) => candidateFromRow(row, market))
      .filter((item): item is StockHeatCandidate => item != null);
  } catch (primaryError) {
    usedFallback = true;
    try {
      if (market === "A股") {
        candidates = await fetchSinaAShareCandidates();
        sourceName = "新浪财经行情";
        resultSourceUrl = sinaSourceUrl;
      } else {
        candidates = await fetchNasdaqUsCandidates();
        sourceName = "Nasdaq Screener";
        resultSourceUrl = nasdaqSourceUrl;
      }
    } catch (fallbackError) {
      const primaryMessage =
        primaryError instanceof Error ? primaryError.message : "东方财富更新失败";
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : "备用数据源更新失败";
      throw new Error(`${primaryMessage}；${fallbackMessage}`);
    }
  }
  if (!candidates.length) throw new Error(`${market}没有可排名的股票`);
  const rankedCandidates = scoreCandidates(candidates);
  return {
    stocks: rankCandidates(rankedCandidates),
    panorama: panoramaCandidates(rankedCandidates),
    sectors: rankSectors(rankedCandidates),
    sourceName,
    sourceUrl: resultSourceUrl,
    usedFallback,
  };
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
    aSharePanorama: [],
    usStockPanorama: [],
    aShareSectors: [],
    usStockSectors: [],
  };
}

async function refreshStockHeatSnapshot(): Promise<StockHeatSnapshot> {
  const now = Date.now();
  const [aShareResult, usStockResult] = await Promise.allSettled([
    fetchMarketHeat("A股"),
    fetchMarketHeat("美股"),
  ]);
  const cached = snapshotCache?.snapshot;
  const aShares =
    aShareResult.status === "fulfilled" ? aShareResult.value.stocks : (cached?.aShares ?? []);
  const usStocks =
    usStockResult.status === "fulfilled" ? usStockResult.value.stocks : (cached?.usStocks ?? []);
  const aSharePanorama =
    aShareResult.status === "fulfilled"
      ? aShareResult.value.panorama
      : (cached?.aSharePanorama ?? cached?.aShares ?? []);
  const usStockPanorama =
    usStockResult.status === "fulfilled"
      ? usStockResult.value.panorama
      : (cached?.usStockPanorama ?? cached?.usStocks ?? []);
  const aShareSectors =
    aShareResult.status === "fulfilled"
      ? aShareResult.value.sectors
      : (cached?.aShareSectors ?? []);
  const usStockSectors =
    usStockResult.status === "fulfilled"
      ? usStockResult.value.sectors
      : (cached?.usStockSectors ?? []);
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
  const freshResults = [aShareResult, usStockResult]
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchMarketHeat>>> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);
  const sourceNames = [...new Set(freshResults.map((result) => result.sourceName))];
  const fallbackSources = freshResults
    .filter((result) => result.usedFallback)
    .map((result) => result.sourceName);
  const message =
    status === "dynamic"
      ? fallbackSources.length
        ? `东方财富云端连接超时，已自动切换 ${fallbackSources.join("、")}；更新 A 股 ${aSharePanorama.length} 只、美股 ${usStockPanorama.length} 只样本。`
        : `已更新 A 股 ${aSharePanorama.length} 只、美股 ${usStockPanorama.length} 只成交全景样本和热榜。`
      : status === "partial"
        ? fallbackSources.length
          ? `部分市场已通过 ${fallbackSources.join("、")} 更新，失败部分保留上一轮可用榜单。`
          : "部分市场更新失败，已保留上一轮可用榜单。"
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
    sourceName: sourceNames.join(" / ") || cached?.sourceName || "东方财富行情",
    sourceUrl: freshResults[0]?.sourceUrl ?? cached?.sourceUrl ?? sourceUrl,
    aShareAsOfLabel: latestQuoteLabel(aShares, cached?.aShareAsOfLabel ?? "待更新"),
    usStockAsOfLabel: latestQuoteLabel(usStocks, cached?.usStockAsOfLabel ?? "待更新"),
    aShares,
    usStocks,
    aSharePanorama,
    usStockPanorama,
    aShareSectors,
    usStockSectors,
  };

  snapshotCache = {
    expiresAt: now + cacheTtlMs,
    snapshot,
  };
  return snapshot;
}

export async function fetchStockHeatSnapshot({ force = false } = {}): Promise<StockHeatSnapshot> {
  if (!force && snapshotCache && snapshotCache.expiresAt > Date.now()) {
    return snapshotCache.snapshot;
  }
  if (snapshotRefreshPromise) return snapshotRefreshPromise;

  snapshotRefreshPromise = refreshStockHeatSnapshot();
  try {
    return await snapshotRefreshPromise;
  } finally {
    snapshotRefreshPromise = null;
  }
}
