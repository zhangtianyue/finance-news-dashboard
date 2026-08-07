import { promises as fs } from "fs";
import path from "path";
import { revalidateTag, unstable_cache } from "next/cache";

export type SourceId = "cls" | "wallstreetcn" | "xueqiu";

export type NewsItem = {
  id: string;
  source: SourceId;
  sourceName: string;
  rank: number;
  title: string;
  url: string;
  meta?: Record<string, unknown>;
};

export type ReportSection = {
  title: string;
  bullets: string[];
};

export type MorningReport = {
  date: string;
  generatedAt: string;
  generatedAtLabel: string;
  sources: Record<SourceId, NewsItem[]>;
  sourceStatus: Record<SourceId, { ok: boolean; count: number; message: string }>;
  summary: ReportSection;
  marketImpact: ReportSection;
  risks: ReportSection;
  focusTags: string[];
  refreshNotice?: string;
};

const SOURCE_NAMES: Record<SourceId, string> = {
  cls: "财联社",
  wallstreetcn: "华尔街见闻",
  xueqiu: "雪球个股热度",
};

const SOURCE_HOSTS: Record<SourceId, string[]> = {
  cls: ["cls.cn"],
  wallstreetcn: ["wallstreetcn.com"],
  xueqiu: ["xueqiu.com"],
};

const DEFAULT_SOURCES: SourceId[] = ["cls", "wallstreetcn", "xueqiu"];
const expectedSourceCount = 10;
const reportDir = path.join(process.cwd(), "data", "reports");
const latestReportPath = path.join(reportDir, "latest.json");
const fetchTimeoutMs = 5000;
const fetchAttemptCount = 2;
const morningReportCacheTag = "morning-report-v2";
const morningReportRevalidateSeconds = 20 * 60;

function isVercelRuntime() {
  return process.env.VERCEL === "1";
}

async function persistLatestReport(report: MorningReport) {
  if (isVercelRuntime()) return;

  const temporaryPath = `${latestReportPath}.tmp`;
  try {
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(temporaryPath, JSON.stringify(report, null, 2));
    await fs.rename(temporaryPath, latestReportPath);
  } catch (error) {
    console.warn("Morning report cache write skipped", error);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function readLocalLatestReport(): Promise<MorningReport | null> {
  try {
    const file = await fs.readFile(latestReportPath, "utf8");
    const report = JSON.parse(file) as MorningReport;
    return report?.sources && report?.sourceStatus ? report : null;
  } catch {
    return null;
  }
}

function shanghaiDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;

  return {
    date: day,
    label: `${day} ${time} 北京时间`,
  };
}

function includesAny(text: string, keywords: string[]) {
  const normalizedText = text.toLowerCase();
  return keywords.some((keyword) => normalizedText.includes(keyword.toLowerCase()));
}

function normalizeTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/^财联社\d{1,2}月\d{1,2}日电[，,:：]?/, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function titleBigrams(title: string) {
  const normalized = normalizeTitle(title);
  const bigrams: string[] = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.push(normalized.slice(index, index + 2));
  }
  return bigrams;
}

function titlesAreSimilar(left: string, right: string) {
  const normalizedLeft = normalizeTitle(left);
  const normalizedRight = normalizeTitle(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;
  if (Math.min(normalizedLeft.length, normalizedRight.length) >= 12) {
    if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
      return true;
    }
  }

  const leftBigrams = titleBigrams(left);
  const rightBigrams = titleBigrams(right);
  if (!leftBigrams.length || !rightBigrams.length) return false;
  const remaining = new Map<string, number>();
  rightBigrams.forEach((bigram) => remaining.set(bigram, (remaining.get(bigram) ?? 0) + 1));
  let overlap = 0;
  leftBigrams.forEach((bigram) => {
    const count = remaining.get(bigram) ?? 0;
    if (count > 0) {
      overlap += 1;
      remaining.set(bigram, count - 1);
    }
  });

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length) >= 0.72;
}

function deduplicateForAnalysis(items: NewsItem[]) {
  const unique: NewsItem[] = [];
  for (const item of items) {
    if (!unique.some((existing) => titlesAreSimilar(existing.title, item.title))) {
      unique.push(item);
    }
  }
  return unique;
}

function pick(items: NewsItem[], keywords: string[], limit = 4) {
  return items.filter((item) => includesAny(item.title, keywords)).slice(0, limit);
}

function combineUnique(groups: NewsItem[][], limit = 4) {
  return deduplicateForAnalysis(groups.flat()).slice(0, limit);
}

function formatPicked(items: NewsItem[], fallback: string) {
  if (!items.length) return fallback;
  return items.map((item) => `${item.title}（${item.sourceName}#${item.rank}）`).join("；");
}

function validatedUrl(value: unknown, source: SourceId) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const allowed = SOURCE_HOSTS[source].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

async function fetchSourceOnce(source: SourceId, count: number): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);

  try {
    const response = await fetch(`https://newsnow.busiyi.world/api/s?id=${source}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${SOURCE_NAMES[source]}返回 ${response.status}`);
    }

    const data = (await response.json()) as {
      items?: Array<{
        id?: string | number;
        title?: string;
        url?: string;
        extra?: Record<string, unknown>;
      }>;
    };
    if (!Array.isArray(data.items)) {
      throw new Error(`${SOURCE_NAMES[source]}返回格式异常`);
    }

    const seenItems = new Set<string>();
    const validItems = data.items
      .map((item, sourceIndex) => {
        const title = typeof item.title === "string" ? item.title.trim().replace(/\s+/g, " ") : "";
        const url = validatedUrl(item.url, source);
        if (!title || !url) return null;
        const identity = `${normalizeTitle(title)}|${url}`;
        if (seenItems.has(identity)) return null;
        seenItems.add(identity);
        return {
          id: String(item.id ?? `${source}-${sourceIndex + 1}-${normalizeTitle(title)}`),
          source,
          sourceName: SOURCE_NAMES[source],
          title,
          url,
          meta: item.extra,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item != null)
      .slice(0, count);

    if (validItems.length < count) {
      throw new Error(
        `${SOURCE_NAMES[source]}仅返回 ${validItems.length}/${count} 条有效热点`,
      );
    }

    return validItems.map((item, index) => ({ ...item, rank: index + 1 }));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${SOURCE_NAMES[source]}请求超过 ${fetchTimeoutMs / 1000} 秒`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSource(source: SourceId, count = expectedSourceCount): Promise<NewsItem[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= fetchAttemptCount; attempt += 1) {
    try {
      return await fetchSourceOnce(source, count);
    } catch (error) {
      lastError = error;
      if (attempt < fetchAttemptCount) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${SOURCE_NAMES[source]}抓取失败`);
}

function statusFor(items: NewsItem[]) {
  if (!items.length) return { ok: false, count: 0, message: "未获取到数据" };
  if (items.length < expectedSourceCount) {
    return {
      ok: true,
      count: items.length,
      message: `已更新，仅获取 ${items.length}/${expectedSourceCount} 条`,
    };
  }
  return { ok: true, count: items.length, message: "已更新" };
}

function buildReport(sources: Record<SourceId, NewsItem[]>): MorningReport {
  const all = DEFAULT_SOURCES.flatMap((source) => sources[source]);
  const analysisItems = deduplicateForAnalysis(all);
  const { date, label } = shanghaiDateTime();

  const aiHardware = pick(analysisItems, [
    "光模块",
    "光通信",
    "数据中心",
    "服务器",
    "智算",
    "算力",
    "gpu",
    "hbm",
    "存储",
    "半导体",
    "芯片",
    "pcb",
    "英伟达",
    "美光",
    "台积电",
    "中际旭创",
    "兆易创新",
  ]);
  const aiApplications = pick(analysisItems, [
    "openai",
    "人工智能",
    "大模型",
    "智能体",
    "agent",
    "ai应用",
    "ai模型",
  ]);
  const chinaMacro = pick(analysisItems, [
    "人民币",
    "lpr",
    "mlf",
    "降准",
    "降息",
    "逆回购",
    "公开市场",
    "货币政策",
    "外汇储备",
    "社融",
    "信贷",
    "结汇",
    "售汇",
    "外资",
    "北向资金",
    "财政",
  ]);
  const globalRates = pick(analysisItems, [
    "美联储",
    "fed",
    "非农",
    "cpi",
    "pce",
    "通胀",
    "国债收益率",
    "国债拍卖",
    "利率",
    "抵押贷款",
    "按揭贷款",
    "欧洲央行",
    "日本央行",
    "美元指数",
  ]);
  const geopoliticalRisk = pick(analysisItems, [
    "伊朗",
    "以色列",
    "黎巴嫩",
    "霍尔木兹",
    "制裁",
    "袭击",
    "冲突",
    "战争",
    "核电站",
  ]);
  const hkMarket = pick(analysisItems, ["港股", "香港", "恒生", "h股", "南向资金"]);
  const resources = pick(analysisItems, [
    "黄金",
    "原油",
    "布油",
    "铜",
    "有色",
    "矿",
    "航运",
  ]);

  const technology = combineUnique([aiHardware, aiApplications]);
  const macro = combineUnique([chinaMacro, globalRates]);
  const riskAndResources = combineUnique([geopoliticalRisk, resources]);
  const focusTags = [
    aiHardware.length ? "AI 硬件" : null,
    aiApplications.length ? "AI 应用" : null,
    chinaMacro.length ? "中国资金面" : null,
    globalRates.length ? "全球利率" : null,
    hkMarket.length ? "港股" : null,
    geopoliticalRisk.length ? "地缘与避险" : null,
    resources.length ? "资源品" : null,
  ].filter(Boolean) as string[];

  const technologyImpact = aiHardware.length
    ? "AI 硬件线索集中在芯片、存储、算力、服务器或数据中心链条，可重点观察 A 股硬件龙头与美股半导体的成交确认。"
    : aiApplications.length
      ? "本次 AI 线索偏模型、应用或治理，不应直接映射为光模块、存储和 PCB 等硬件链催化。"
      : "科技成长方向缺少明确标题催化，盘前更适合观察成交额和龙头相对强弱。";
  const macroImpact =
    chinaMacro.length && globalRates.length
      ? "中国资金面与海外利率线索同时出现，需要结合人民币、国债收益率和美元走势判断 A 股、港股及成长股估值压力。"
      : chinaMacro.length
        ? "人民币、国内货币政策或外资线索对中国资产风险偏好更直接，需结合汇率和资金流确认。"
        : globalRates.length
          ? "海外利率和通胀线索主要影响美债收益率与科技股估值，不应直接解读为人民币或外资变化。"
          : "宏观利率标题不足，需结合美债收益率、美元指数和人民币走势确认。";
  const resourceImpact =
    geopoliticalRisk.length && resources.length
      ? "地缘事件与资源品线索同时出现，可能通过油价、航运、通胀预期和避险需求影响全球风险资产。"
      : geopoliticalRisk.length
        ? "地缘事件可能通过能源、航运和避险需求影响全球风险资产，需要等待价格与官方消息确认。"
        : resources.length
          ? "黄金、原油、铜等资源品线索主要反映供需和价格预期，需要结合期货价格与相关股票成交确认。"
          : "商品与避险线索不强，资源股行情更可能由行业供需和盘面资金驱动。";

  return {
    date,
    generatedAt: new Date().toISOString(),
    generatedAtLabel: label,
    sources,
    sourceStatus: {
      cls: statusFor(sources.cls),
      wallstreetcn: statusFor(sources.wallstreetcn),
      xueqiu: statusFor(sources.xueqiu),
    },
    focusTags,
    summary: {
      title: "热点摘要",
      bullets: [
        `科技成长线索：${formatPicked(technology, "本次未捕捉到显著 AI、半导体或算力标题。")}`,
        `宏观利率线索：${formatPicked(macro, "本次未捕捉到显著中国资金面或全球利率标题。")}`,
        `地缘与商品线索：${formatPicked(riskAndResources, "本次未捕捉到显著地缘、能源或资源品标题。")}`,
        `港股市场线索：${formatPicked(hkMarket, "本次港股相关标题较少，需结合恒生指数和南向资金确认。")}`,
      ],
    },
    marketImpact: {
      title: "潜在市场影响",
      bullets: [technologyImpact, macroImpact, resourceImpact],
    },
    risks: {
      title: "需要继续关注的风险",
      bullets: [
        geopoliticalRisk.length
          ? "地缘事件的标题热度不等于事件升级，需继续核对油价、航运和官方消息。"
          : "地缘风险目前不是标题主线，但仍应保留对能源和黄金异动的监控。",
        aiHardware.length >= 3
          ? "AI 硬件线索密集时需警惕交易拥挤和高位放量分歧。"
          : "科技线索不够密集时，追高确定性下降，需等待基本面或资金确认。",
        "雪球部分反映个股关注度而非新闻事实；整份早报仍需结合公告、财报、宏观数据和实时盘口确认。",
      ],
    },
  };
}

export async function generateMorningReport(): Promise<MorningReport> {
  const entries = await Promise.allSettled(
    DEFAULT_SOURCES.map(async (source) => [source, await fetchSource(source)] as const),
  );
  const sources: Record<SourceId, NewsItem[]> = { cls: [], wallstreetcn: [], xueqiu: [] };
  const errors: string[] = [];

  entries.forEach((entry, index) => {
    const source = DEFAULT_SOURCES[index];
    if (entry.status === "fulfilled") {
      sources[entry.value[0]] = entry.value[1];
    } else {
      const message = entry.reason instanceof Error ? entry.reason.message : "未知错误";
      errors.push(`${SOURCE_NAMES[source]}：${message}`);
    }
  });

  if (errors.length) {
    throw new Error(`早报更新未完成，已保留上一版。${errors.join("；")}`);
  }

  const report = buildReport(sources);
  await persistLatestReport(report);
  return report;
}

const getCachedMorningReport = unstable_cache(
  async () => generateMorningReport(),
  [morningReportCacheTag],
  {
    revalidate: morningReportRevalidateSeconds,
    tags: [morningReportCacheTag],
  },
);

let refreshPromise: Promise<MorningReport> | null = null;

export function createEmptyReport(): MorningReport {
  const report = buildReport({ cls: [], wallstreetcn: [], xueqiu: [] });
  return {
    ...report,
    generatedAt: "",
    generatedAtLabel: "暂无可用缓存",
    refreshNotice: "三路来源暂时不可用，页面功能不受影响。",
  };
}

export async function getLatestReport(): Promise<MorningReport | null> {
  if (!isVercelRuntime()) {
    const localReport = await readLocalLatestReport();
    if (localReport) return localReport;
  }

  try {
    return await getCachedMorningReport();
  } catch (error) {
    console.error("Morning report cache read failed", error);
    return await readLocalLatestReport();
  }
}

export function refreshLatestReport(): Promise<MorningReport> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    if (!isVercelRuntime()) {
      const previous = await readLocalLatestReport();
      try {
        return await generateMorningReport();
      } catch (error) {
        if (!previous) throw error;
        const message = error instanceof Error ? error.message : "早报更新失败";
        return { ...previous, refreshNotice: message };
      }
    }

    revalidateTag(morningReportCacheTag, { expire: 0 });
    const report = await getCachedMorningReport();
    return {
      ...report,
      refreshNotice: "早报已完成更新；上游异常时会继续保留上一版。",
    };
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}
