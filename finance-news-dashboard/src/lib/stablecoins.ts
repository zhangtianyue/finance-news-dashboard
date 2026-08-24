export type StablecoinStatus = "dynamic" | "cached" | "empty";
export type StablecoinPegHealth = "normal" | "watch" | "risk" | "nav" | "unknown";

export type StablecoinAsset = {
  id: string;
  name: string;
  symbol: string;
  mechanism: string;
  mechanismLabel: string;
  marketCap: number;
  circulating: number;
  dominance: number;
  price: number | null;
  priceDeviationPct: number | null;
  pegHealth: StablecoinPegHealth;
  change1d: number;
  change7d: number;
  change30d: number;
  chains: string[];
};

export type StablecoinChain = {
  name: string;
  marketCap: number;
  dominance: number;
};

export type StablecoinSnapshot = {
  updatedAt: string;
  updatedAtLabel: string;
  status: StablecoinStatus;
  message: string;
  sourceName: string;
  sourceUrl: string;
  totalMarketCap: number;
  change1d: number;
  change7d: number;
  change30d: number;
  change1dPct: number;
  change7dPct: number;
  change30dPct: number;
  trackedCount: number;
  materialCount: number;
  depegCount: number;
  topTwoDominance: number;
  assets: StablecoinAsset[];
  alerts: StablecoinAsset[];
  chains: StablecoinChain[];
};

type RawRecord = Record<string, unknown>;

const stablecoinsUrl = "https://stablecoins.llama.fi/stablecoins?includePrices=true";
const stablecoinChainsUrl = "https://stablecoins.llama.fi/stablecoinchains";
const stablecoinHomeUrl = "https://defillama.com/stablecoins";
const cacheTtlMs = 5 * 60 * 1000;
const requestTimeoutMs = 9_000;
const materialMarketCapUsd = 100_000_000;
const materialChainBalanceUsd = 1_000_000;
const navAccruingSymbols = new Set([
  "BUIDL",
  "OUSG",
  "USDY",
  "USYC",
  "sDAI",
  "sUSDe",
  "sUSDS",
  "wUSDM",
]);

let snapshotCache: { expiresAt: number; snapshot: StablecoinSnapshot } | null = null;
let refreshPromise: Promise<StablecoinSnapshot> | null = null;

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : null;
}

function readString(record: RawRecord, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: RawRecord, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readPeggedUsd(value: unknown) {
  const record = asRecord(value);
  if (!record) return 0;
  return readNumber(record, "peggedUSD") ?? 0;
}

function formatUpdatedAtLabel(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function mechanismLabel(value: string) {
  if (value === "fiat-backed") return "法币储备";
  if (value === "crypto-backed") return "加密抵押";
  if (value === "algorithmic") return "算法调节";
  return "其他机制";
}

function percentageChange(change: number, current: number) {
  const previous = current - change;
  return previous > 0 ? (change / previous) * 100 : 0;
}

function pegHealth(symbol: string, price: number | null): StablecoinPegHealth {
  if (navAccruingSymbols.has(symbol)) return "nav";
  if (price == null || price <= 0) return "unknown";

  const deviation = Math.abs(price - 1) * 100;
  if (deviation >= 1) return "risk";
  if (deviation >= 0.3) return "watch";
  return "normal";
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "MARKET-DESK/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`DefiLlama 返回 ${response.status}`);
    }
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function parseAsset(value: unknown): Omit<StablecoinAsset, "dominance"> | null {
  const record = asRecord(value);
  if (!record || readString(record, "pegType") !== "peggedUSD") return null;

  const id = readString(record, "id");
  const name = readString(record, "name");
  const symbol = readString(record, "symbol");
  const mechanism = readString(record, "pegMechanism") ?? "unknown";
  const circulating = readPeggedUsd(record.circulating);
  if (!id || !name || !symbol || circulating <= 0) return null;

  const priceValue = readNumber(record, "price");
  const price = priceValue != null && priceValue > 0 ? priceValue : null;
  const marketCap = circulating * (price ?? 1);
  const previousDay = readPeggedUsd(record.circulatingPrevDay);
  const previousWeek = readPeggedUsd(record.circulatingPrevWeek);
  const previousMonth = readPeggedUsd(record.circulatingPrevMonth);
  const chainCirculating = asRecord(record.chainCirculating);
  const chains = chainCirculating
    ? Object.entries(chainCirculating)
        .filter(([, chainValue]) => {
          const chainRecord = asRecord(chainValue);
          return chainRecord
            ? readPeggedUsd(chainRecord.current) >= materialChainBalanceUsd
            : false;
        })
        .map(([chainName]) => chainName)
    : [];

  return {
    id,
    name,
    symbol,
    mechanism,
    mechanismLabel: mechanismLabel(mechanism),
    marketCap,
    circulating,
    price,
    priceDeviationPct: price == null ? null : (price - 1) * 100,
    pegHealth: pegHealth(symbol, price),
    change1d: circulating - previousDay,
    change7d: circulating - previousWeek,
    change30d: circulating - previousMonth,
    chains,
  };
}

function parseChain(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  const name = readString(record, "name");
  const marketCap = readPeggedUsd(record.totalCirculatingUSD);
  return name && marketCap > 0 ? { name, marketCap } : null;
}

function createSnapshot(assetsPayload: unknown, chainsPayload: unknown): StablecoinSnapshot {
  const assetsRecord = asRecord(assetsPayload);
  const rawAssets = assetsRecord && Array.isArray(assetsRecord.peggedAssets)
    ? assetsRecord.peggedAssets
    : [];
  const parsedAssets = rawAssets
    .map(parseAsset)
    .filter((item): item is NonNullable<ReturnType<typeof parseAsset>> => item != null)
    .sort((left, right) => right.marketCap - left.marketCap);

  if (!parsedAssets.length) {
    throw new Error("稳定币接口未返回有效的美元锚定资产");
  }

  const totalMarketCap = parsedAssets.reduce((sum, item) => sum + item.marketCap, 0);
  const change1d = parsedAssets.reduce((sum, item) => sum + item.change1d, 0);
  const change7d = parsedAssets.reduce((sum, item) => sum + item.change7d, 0);
  const change30d = parsedAssets.reduce((sum, item) => sum + item.change30d, 0);
  const rankedAssets = parsedAssets.map((item) => ({
    ...item,
    dominance: totalMarketCap > 0 ? (item.marketCap / totalMarketCap) * 100 : 0,
  }));
  const assets = rankedAssets.slice(0, 20);

  const parsedChains = (Array.isArray(chainsPayload) ? chainsPayload : [])
    .map(parseChain)
    .filter((item): item is NonNullable<ReturnType<typeof parseChain>> => item != null)
    .sort((left, right) => right.marketCap - left.marketCap);
  const chainTotal = parsedChains.reduce((sum, item) => sum + item.marketCap, 0);
  const chains = parsedChains.slice(0, 12).map((item) => ({
    ...item,
    dominance: chainTotal > 0 ? (item.marketCap / chainTotal) * 100 : 0,
  }));
  const now = new Date();
  const materialAssets = parsedAssets.filter((item) => item.marketCap >= materialMarketCapUsd);
  const alerts = rankedAssets.filter(
    (item) =>
      item.marketCap >= materialMarketCapUsd &&
      (item.pegHealth === "watch" || item.pegHealth === "risk"),
  );

  return {
    updatedAt: now.toISOString(),
    updatedAtLabel: `${formatUpdatedAtLabel(now)} 北京时间`,
    status: "dynamic",
    message: "美元稳定币规模已更新，流通量与链上分布来自 DefiLlama。",
    sourceName: "DefiLlama Stablecoins",
    sourceUrl: stablecoinHomeUrl,
    totalMarketCap,
    change1d,
    change7d,
    change30d,
    change1dPct: percentageChange(change1d, totalMarketCap),
    change7dPct: percentageChange(change7d, totalMarketCap),
    change30dPct: percentageChange(change30d, totalMarketCap),
    trackedCount: parsedAssets.length,
    materialCount: materialAssets.length,
    depegCount: alerts.length,
    topTwoDominance: assets.slice(0, 2).reduce((sum, item) => sum + item.dominance, 0),
    assets,
    alerts,
    chains,
  };
}

function createEmptySnapshot(message: string): StablecoinSnapshot {
  const now = new Date();
  return {
    updatedAt: now.toISOString(),
    updatedAtLabel: "待更新",
    status: "empty",
    message,
    sourceName: "DefiLlama Stablecoins",
    sourceUrl: stablecoinHomeUrl,
    totalMarketCap: 0,
    change1d: 0,
    change7d: 0,
    change30d: 0,
    change1dPct: 0,
    change7dPct: 0,
    change30dPct: 0,
    trackedCount: 0,
    materialCount: 0,
    depegCount: 0,
    topTwoDominance: 0,
    assets: [],
    alerts: [],
    chains: [],
  };
}

async function refreshStablecoinSnapshot() {
  try {
    const [assetsPayload, chainsPayload] = await Promise.all([
      fetchJson(stablecoinsUrl),
      fetchJson(stablecoinChainsUrl),
    ]);
    const snapshot = createSnapshot(assetsPayload, chainsPayload);
    snapshotCache = { expiresAt: Date.now() + cacheTtlMs, snapshot };
    return snapshot;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "未知错误";
    if (snapshotCache) {
      return {
        ...snapshotCache.snapshot,
        status: "cached" as const,
        message: `实时更新失败：${reason}。当前显示最近一次成功数据。`,
      };
    }
    return createEmptySnapshot(`稳定币数据暂时不可用：${reason}`);
  } finally {
    refreshPromise = null;
  }
}

export async function fetchStablecoinSnapshot({ force = false } = {}) {
  if (!force && snapshotCache && snapshotCache.expiresAt > Date.now()) {
    return {
      ...snapshotCache.snapshot,
      status: "cached" as const,
      message: "当前显示 5 分钟内缓存数据，可手动刷新获取最新结果。",
    };
  }

  if (!refreshPromise) {
    refreshPromise = refreshStablecoinSnapshot();
  }
  return refreshPromise;
}
