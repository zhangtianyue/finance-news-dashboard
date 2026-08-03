export type PolymarketHotCategory =
  | "宏观利率"
  | "地缘风险"
  | "科技/AI"
  | "加密资产"
  | "政治选举"
  | "中国相关"
  | "体育娱乐"
  | "其他";

export type PolymarketHotItem = {
  id: string;
  slug: string;
  title: string;
  url: string;
  category: PolymarketHotCategory;
  tags: string[];
  probability: number | null;
  probabilityLabel: string;
  change24h: number | null;
  volume24h: number | null;
  volumeTotal: number | null;
  liquidity: number | null;
  commentCount: number | null;
  endDate: string | null;
  endDateLabel: string;
  heatScore: number;
  summary: string;
  marketImpact: string[];
  riskFocus: string;
  isMarketRelevant: boolean;
  topOutcomes: {
    label: string;
    probability: number | null;
    change24h: number | null;
  }[];
};

export type PolymarketHotSnapshot = {
  updatedAt: string;
  updatedAtLabel: string;
  status: "dynamic" | "cached" | "empty";
  message: string;
  sourceName: string;
  sourceUrl: string;
  items: PolymarketHotItem[];
  marketRelevant: PolymarketHotItem[];
  movers: PolymarketHotItem[];
  categoryCounts: Record<PolymarketHotCategory, number>;
};

type RawRecord = Record<string, unknown>;

const polymarketEventsUrl = "https://gamma-api.polymarket.com/events";
const polymarketHomeUrl = "https://polymarket.com";
const hotCacheTtlMs = 90_000;
const requestTimeoutMs = 7_000;

let hotSnapshotCache: { expiresAt: number; snapshot: PolymarketHotSnapshot } | null = null;
let hotSnapshotRefreshPromise: Promise<PolymarketHotSnapshot> | null = null;

const categories: PolymarketHotCategory[] = [
  "宏观利率",
  "地缘风险",
  "科技/AI",
  "加密资产",
  "政治选举",
  "中国相关",
  "体育娱乐",
  "其他",
];

const categoryKeywords: Record<Exclude<PolymarketHotCategory, "其他">, string[]> = {
  宏观利率: [
    "fed",
    "fomc",
    "rate",
    "rates",
    "interest",
    "cpi",
    "inflation",
    "jobs",
    "payroll",
    "unemployment",
    "recession",
    "gdp",
    "tariff",
    "powell",
    "treasury",
    "yield",
    "economy",
  ],
  地缘风险: [
    "iran",
    "israel",
    "gaza",
    "ukraine",
    "russia",
    "war",
    "ceasefire",
    "nuclear",
    "hormuz",
    "strait",
    "oil",
    "sanction",
    "missile",
    "geopolitics",
  ],
  "科技/AI": [
    "ai",
    "openai",
    "nvidia",
    "nvda",
    "tesla",
    "tsla",
    "apple",
    "microsoft",
    "google",
    "meta",
    "amazon",
    "chips",
    "semiconductor",
    "tech",
  ],
  加密资产: [
    "bitcoin",
    "btc",
    "ethereum",
    "eth",
    "crypto",
    "solana",
    "xrp",
    "stablecoin",
    "etf",
  ],
  政治选举: [
    "election",
    "president",
    "trump",
    "biden",
    "congress",
    "senate",
    "governor",
    "minister",
    "politics",
    "candidate",
  ],
  中国相关: [
    "china",
    "chinese",
    "hong kong",
    "taiwan",
    "beijing",
    "shanghai",
    "tariff",
    "yuan",
    "renminbi",
    "huawei",
    "byd",
  ],
  体育娱乐: [
    "sports",
    "soccer",
    "fifa",
    "nba",
    "nfl",
    "mlb",
    "tennis",
    "ufc",
    "esports",
    "league of legends",
    "pop culture",
    "movie",
    "music",
  ],
};

const marketRelevantCategories = new Set<PolymarketHotCategory>([
  "宏观利率",
  "地缘风险",
  "科技/AI",
  "加密资产",
  "政治选举",
  "中国相关",
]);

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : null;
}

function readString(record: RawRecord, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function readNumber(record: RawRecord, key: string) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: unknown) {
  return parseJsonArray(value)
    .map((item) => (typeof item === "string" ? item : null))
    .filter((item): item is string => item != null);
}

function parseNumberArray(value: unknown) {
  return parseJsonArray(value)
    .map((item) => {
      if (typeof item === "number" && Number.isFinite(item)) return item;
      if (typeof item === "string" && item.trim()) {
        const parsed = Number(item);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    })
    .filter((item): item is number => item != null);
}

function formatDateLabel(value: string | null) {
  if (!value) return "未披露";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatUpdatedAtLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function formatProbability(value: number | null) {
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function formatUsd(value: number | null) {
  if (value == null) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesKeyword(text: string, keyword: string) {
  if (keyword.includes(" ")) return text.includes(keyword);
  if (/^[a-z0-9]{1,3}$/.test(keyword)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`).test(text);
  }
  return text.includes(keyword);
}

function classifyCategory(text: string): PolymarketHotCategory {
  const lower = text.toLowerCase();
  const matched = Object.entries(categoryKeywords).find(([, keywords]) =>
    keywords.some((keyword) => matchesKeyword(lower, keyword)),
  );

  return (matched?.[0] as PolymarketHotCategory | undefined) ?? "其他";
}

function marketImpacts(category: PolymarketHotCategory, text: string) {
  const lower = text.toLowerCase();
  const impacts = new Set<string>();

  if (category === "宏观利率") {
    impacts.add("美债利率");
    impacts.add("美元");
    impacts.add("美股科技");
    impacts.add("黄金");
  }
  if (category === "地缘风险") {
    impacts.add("原油");
    impacts.add("黄金");
    impacts.add("航运");
    impacts.add("全球风险偏好");
  }
  if (category === "科技/AI") {
    impacts.add("美股科技");
    impacts.add("半导体");
    impacts.add("港股科技");
  }
  if (category === "加密资产") {
    impacts.add("BTC/ETH");
    impacts.add("加密概念股");
    impacts.add("风险偏好");
  }
  if (category === "政治选举") {
    impacts.add("美元");
    impacts.add("美债利率");
    impacts.add("关税预期");
  }
  if (category === "中国相关" || lower.includes("china") || lower.includes("taiwan")) {
    impacts.add("A股");
    impacts.add("港股");
    impacts.add("人民币");
  }
  if (impacts.size === 0) impacts.add(category === "体育娱乐" ? "非宏观事件" : "情绪热度");

  return [...impacts].slice(0, 4);
}

function riskFocus(category: PolymarketHotCategory) {
  if (category === "宏观利率") return "CPI、非农、FOMC声明、鲍威尔讲话";
  if (category === "地缘风险") return "官方声明、航运数据、油价和制裁消息";
  if (category === "科技/AI") return "公司公告、监管表态、芯片供需和财报指引";
  if (category === "加密资产") return "ETF资金流、监管消息、链上清算和美元流动性";
  if (category === "政治选举") return "民调、辩论、法院裁决和政策表态";
  if (category === "中国相关") return "政策会议、关税消息、人民币和外资流向";
  return "成交放量、赔率快速反转、临近截止前信息更新";
}

function eventTags(event: RawRecord) {
  return parseJsonArray(event.tags)
    .map(asRecord)
    .filter((tag): tag is RawRecord => tag != null)
    .map((tag) => readString(tag, "label"))
    .filter((label): label is string => label != null);
}

function marketOutcome(market: RawRecord) {
  const outcomes = parseStringArray(market.outcomes);
  const prices = parseNumberArray(market.outcomePrices);
  const groupTitle = readString(market, "groupItemTitle");
  const question = readString(market, "question") ?? "Outcome";
  const yesIndex = outcomes.findIndex((outcome) => outcome.toLowerCase() === "yes");
  const probability = prices[yesIndex >= 0 ? yesIndex : 0] ?? readNumber(market, "lastTradePrice");
  const label = groupTitle ?? (yesIndex >= 0 ? question.replace(/\?$/, "") : outcomes[0] ?? question);

  return {
    label,
    probability: probability != null ? Math.max(0, Math.min(1, probability)) : null,
    change24h: readNumber(market, "oneDayPriceChange"),
    volume24h: readNumber(market, "volume24hr") ?? readNumber(market, "volume24hrClob"),
  };
}

function toHotItem(event: RawRecord): PolymarketHotItem | null {
  const id = readString(event, "id");
  const slug = readString(event, "slug");
  const title = readString(event, "title")?.trim();
  if (!id || !slug || !title) return null;

  const markets = parseJsonArray(event.markets)
    .map(asRecord)
    .filter((market): market is RawRecord => market != null)
    .filter((market) => market.closed !== true && market.active !== false);
  const topOutcomes = markets
    .map(marketOutcome)
    .sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1))
    .slice(0, 3)
    .map(({ label, probability, change24h }) => ({ label, probability, change24h }));
  const selectedOutcome =
    markets
      .map(marketOutcome)
      .sort((a, b) => {
        const aScore = (a.volume24h ?? 0) + Math.abs(a.change24h ?? 0) * 10_000_000;
        const bScore = (b.volume24h ?? 0) + Math.abs(b.change24h ?? 0) * 10_000_000;
        return bScore - aScore;
      })[0] ?? topOutcomes[0];
  const tags = eventTags(event);
  const description = readString(event, "description") ?? "";
  const text = `${title} ${description} ${tags.join(" ")}`;
  const category = classifyCategory(text);
  const volume24h = readNumber(event, "volume24hr");
  const volumeTotal = readNumber(event, "volume");
  const liquidity = readNumber(event, "liquidity") ?? readNumber(event, "liquidityClob");
  const commentCount = readNumber(event, "commentCount");
  const endDate = readString(event, "endDate");
  const maxMove = Math.max(
    0,
    ...markets.map((market) => Math.abs(readNumber(market, "oneDayPriceChange") ?? 0)),
  );
  const isMarketRelevant = marketRelevantCategories.has(category);
  const heatScore =
    Math.log10((volume24h ?? 0) + 1) * 14 +
    Math.log10((liquidity ?? 0) + 1) * 5 +
    Math.log10((commentCount ?? 0) + 1) * 3 +
    Math.min(maxMove, 0.25) * 100 +
    (isMarketRelevant ? 10 : 0);
  const impacts = marketImpacts(category, text);
  const probabilityLabel =
    selectedOutcome?.label && selectedOutcome.probability != null
      ? `${selectedOutcome.label} ${formatProbability(selectedOutcome.probability)}`
      : "概率待更新";

  return {
    id,
    slug,
    title,
    url: `${polymarketHomeUrl}/event/${slug}`,
    category,
    tags: tags.slice(0, 4),
    probability: selectedOutcome?.probability ?? null,
    probabilityLabel,
    change24h: selectedOutcome?.change24h ?? null,
    volume24h,
    volumeTotal,
    liquidity,
    commentCount,
    endDate,
    endDateLabel: formatDateLabel(endDate),
    heatScore,
    summary: `当前核心定价是 ${probabilityLabel}；24h 成交约 ${formatUsd(volume24h)}。`,
    marketImpact: impacts,
    riskFocus: riskFocus(category),
    isMarketRelevant,
    topOutcomes,
  };
}

export function createEmptyPolymarketHotSnapshot(message = "Polymarket 热点暂时不可用。") {
  const updatedAt = new Date().toISOString();

  return {
    updatedAt,
    updatedAtLabel: formatUpdatedAtLabel(updatedAt),
    status: "empty" as const,
    message,
    sourceName: "Polymarket Gamma API",
    sourceUrl: polymarketEventsUrl,
    items: [],
    marketRelevant: [],
    movers: [],
    categoryCounts: Object.fromEntries(categories.map((category) => [category, 0])) as Record<
      PolymarketHotCategory,
      number
    >,
  };
}

async function refreshPolymarketHotSnapshot(): Promise<PolymarketHotSnapshot> {
  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    limit: "100",
    order: "volume24hr",
    ascending: "false",
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${polymarketEventsUrl}?${params.toString()}`, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": "finance-news-dashboard/1.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Polymarket API ${response.status}`);
    }

    const parsed = (await response.json()) as unknown;
    const events = Array.isArray(parsed) ? parsed : [];
    const items = events
      .map(asRecord)
      .filter((event): event is RawRecord => event != null)
      .map(toHotItem)
      .filter((item): item is PolymarketHotItem => item != null)
      .sort((a, b) => b.heatScore - a.heatScore)
      .slice(0, 30);
    const updatedAt = new Date().toISOString();
    const categoryCounts = Object.fromEntries(
      categories.map((category) => [
        category,
        items.filter((item) => item.category === category).length,
      ]),
    ) as Record<PolymarketHotCategory, number>;
    const snapshot: PolymarketHotSnapshot = {
      updatedAt,
      updatedAtLabel: formatUpdatedAtLabel(updatedAt),
      status: items.length > 0 ? "dynamic" : "empty",
      message:
        items.length > 0
          ? `已更新 Polymarket 热点 ${items.length} 条，按成交额、流动性、赔率变化和财经相关性排序。`
          : "Polymarket 返回为空，页面保持可用。",
      sourceName: "Polymarket Gamma API",
      sourceUrl: `${polymarketEventsUrl}?${params.toString()}`,
      items,
      marketRelevant: items.filter((item) => item.isMarketRelevant).slice(0, 12),
      movers: [...items]
        .filter((item) => item.change24h != null)
        .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))
        .slice(0, 12),
      categoryCounts,
    };

    hotSnapshotCache = {
      expiresAt: Date.now() + hotCacheTtlMs,
      snapshot,
    };
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Polymarket 更新失败";
    if (hotSnapshotCache) {
      return {
        ...hotSnapshotCache.snapshot,
        status: "cached",
        message: `Polymarket 更新失败，正在显示上一轮数据：${message}`,
      };
    }
    return createEmptyPolymarketHotSnapshot(`Polymarket 更新失败：${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchPolymarketHotSnapshot({ force = false } = {}) {
  if (!force && hotSnapshotCache && hotSnapshotCache.expiresAt > Date.now()) {
    return hotSnapshotCache.snapshot;
  }
  if (hotSnapshotRefreshPromise) return hotSnapshotRefreshPromise;

  hotSnapshotRefreshPromise = refreshPolymarketHotSnapshot();
  try {
    return await hotSnapshotRefreshPromise;
  } finally {
    hotSnapshotRefreshPromise = null;
  }
}
