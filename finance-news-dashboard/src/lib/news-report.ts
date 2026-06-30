import { promises as fs } from "fs";
import path from "path";

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
};

const SOURCE_NAMES: Record<SourceId, string> = {
  cls: "财联社",
  wallstreetcn: "华尔街见闻",
  xueqiu: "雪球热榜",
};

const DEFAULT_SOURCES: SourceId[] = ["cls", "wallstreetcn", "xueqiu"];

const reportDir = path.join(process.cwd(), "data", "reports");
const latestReportPath = path.join(reportDir, "latest.json");
const fetchTimeoutMs = 8000;

async function persistLatestReport(report: MorningReport) {
  try {
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(latestReportPath, JSON.stringify(report, null, 2));
  } catch (error) {
    console.warn("Morning report cache write skipped", error);
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
  return keywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()));
}

function titles(items: NewsItem[]) {
  return items.map((item) => item.title).join("；");
}

function pick(items: NewsItem[], keywords: string[], limit = 4) {
  return items.filter((item) => includesAny(item.title, keywords)).slice(0, limit);
}

function formatPicked(items: NewsItem[], fallback: string) {
  if (!items.length) return fallback;
  return items.map((item) => `${item.title}（${item.sourceName}#${item.rank}）`).join("；");
}

async function fetchSource(source: SourceId, count = 10): Promise<NewsItem[]> {
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
      throw new Error(`${SOURCE_NAMES[source]} returned ${response.status}`);
    }

    const data = (await response.json()) as {
      items?: Array<{
        id?: string | number;
        title?: string;
        url?: string;
        extra?: Record<string, unknown>;
      }>;
    };

    return (data.items ?? []).slice(0, count).map((item, index) => ({
      id: String(item.id ?? `${source}-${Date.now()}-${index + 1}`),
      source,
      sourceName: SOURCE_NAMES[source],
      rank: index + 1,
      title: item.title ?? "",
      url: item.url ?? "",
      meta: item.extra,
    }));
  } finally {
    clearTimeout(timeout);
  }
}

function buildReport(sources: Record<SourceId, NewsItem[]>): MorningReport {
  const all = DEFAULT_SOURCES.flatMap((source) => sources[source]);
  const titleBlob = titles(all);
  const { date, label } = shanghaiDateTime();

  const aiChain = pick(all, [
    "光通信",
    "美光",
    "迈威尔",
    "AI",
    "智算",
    "算力",
    "半导体",
    "芯片",
    "中际旭创",
    "东山精密",
    "胜宏科技",
    "兆易创新",
  ]);
  const macro = pick(all, [
    "外汇局",
    "人民币",
    "结汇",
    "售汇",
    "外资",
    "债券",
    "利率",
    "美联储",
  ]);
  const risk = pick(all, [
    "黄金",
    "伊朗",
    "以色列",
    "黎巴嫩",
    "霍尔木兹",
    "航运",
    "袭击",
    "战争",
  ]);
  const hk = pick(all, ["港", "HK", "智谱", "泡泡玛特", "恒生"]);
  const resources = pick(all, ["黄金", "紫金", "铜", "有色", "矿"]);

  const focusTags = [
    aiChain.length ? "AI 硬件链" : null,
    macro.length ? "人民币与外资" : null,
    risk.length ? "避险交易" : null,
    hk.length ? "港股科技" : null,
    resources.length ? "资源品" : null,
  ].filter(Boolean) as string[];

  return {
    date,
    generatedAt: new Date().toISOString(),
    generatedAtLabel: label,
    sources,
    sourceStatus: {
      cls: {
        ok: sources.cls.length > 0,
        count: sources.cls.length,
        message: sources.cls.length ? "已更新" : "未获取到数据",
      },
      wallstreetcn: {
        ok: sources.wallstreetcn.length > 0,
        count: sources.wallstreetcn.length,
        message: sources.wallstreetcn.length ? "已更新" : "未获取到数据",
      },
      xueqiu: {
        ok: sources.xueqiu.length > 0,
        count: sources.xueqiu.length,
        message: sources.xueqiu.length ? "已更新" : "未获取到数据",
      },
    },
    focusTags,
    summary: {
      title: "热点摘要",
      bullets: [
        `科技成长线索：${formatPicked(aiChain, "本次未捕捉到显著 AI 硬件或半导体标题。")}`,
        `宏观资金线索：${formatPicked(macro, "本次未捕捉到显著人民币、外资或利率标题。")}`,
        `避险与商品线索：${formatPicked(risk, "本次未捕捉到显著地缘或黄金标题。")}`,
        `港股与市场情绪：${formatPicked(hk, "本次港股相关标题较少，需结合盘面确认。")}`,
      ],
    },
    marketImpact: {
      title: "潜在市场影响",
      bullets: [
        aiChain.length
          ? "A 股和美股科技股的关注点偏向光模块、存储、PCB、智算中心和数据中心硬件，短线可能继续强化高景气交易。"
          : "科技成长方向缺少明确标题催化，盘前更适合观察成交额和龙头相对强弱。",
        macro.length
          ? "人民币、外资和结售汇相关信息偏向资金面观察，对中国资产风险偏好和港股弹性有参考价值。"
          : "宏观资金面标题不足，利率和汇率方向需要结合债券、美元指数与北向/南向资金确认。",
        risk.length || resources.length
          ? "黄金、地缘和资源品标题增加时，通常意味着避险需求、通胀预期或供应风险正在影响资产定价。"
          : "商品与避险线索不强，资源股行情更可能由行业自身供需和盘面资金驱动。",
      ],
    },
    risks: {
      title: "需要继续关注的风险",
      bullets: [
        includesAny(titleBlob, ["伊朗", "以色列", "黎巴嫩", "霍尔木兹"])
          ? "中东局势若继续升级，可能通过油价、航运、黄金和通胀预期影响全球风险资产。"
          : "地缘风险目前不是标题主线，但仍应保留对能源和黄金异动的监控。",
        aiChain.length >= 3
          ? "AI 硬件链标题密集时，交易拥挤度也会上升，需要警惕高位放量分歧。"
          : "科技线索不够密集时，追高确定性下降，需等待更强的基本面或资金确认。",
        "早报基于热点标题生成，不能替代公告、财报、宏观数据和实时盘口确认。",
      ],
    },
  };
}

export async function generateMorningReport(): Promise<MorningReport> {
  const entries = await Promise.allSettled(
    DEFAULT_SOURCES.map(async (source) => [source, await fetchSource(source, 10)] as const),
  );

  const sources: Record<SourceId, NewsItem[]> = {
    cls: [],
    wallstreetcn: [],
    xueqiu: [],
  };

  for (const entry of entries) {
    if (entry.status === "fulfilled") {
      sources[entry.value[0]] = entry.value[1];
    }
  }

  const report = buildReport(sources);
  await persistLatestReport(report);
  return report;
}

export function createEmptyReport(): MorningReport {
  return buildReport({
    cls: [],
    wallstreetcn: [],
    xueqiu: [],
  });
}

export async function getLatestReport(): Promise<MorningReport | null> {
  try {
    const file = await fs.readFile(latestReportPath, "utf8");
    return JSON.parse(file) as MorningReport;
  } catch {
    return null;
  }
}
