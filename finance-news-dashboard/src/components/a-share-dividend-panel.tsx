import {
  ArrowUpRight,
  BadgePercent,
  Building2,
  Factory,
  FlaskConical,
  Fuel,
  HeartPulse,
  Landmark,
  MonitorSmartphone,
  RefreshCw,
  ShoppingBasket,
  TrainFront,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  ashareDividendContinuityYears,
  ashareDividendMinimumYield,
} from "@/lib/a-share-dividend-config";
import type {
  AshareDividendCompany,
  AshareDividendSnapshot,
} from "@/lib/a-share-dividends";

type DividendCategory = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  accent: string;
  keywords: string[];
};

type DividendCategoryGroup = DividendCategory & {
  rows: AshareDividendCompany[];
  averageYield: number | null;
  highestYield: number | null;
};

const dividendCategories: DividendCategory[] = [
  {
    id: "financial",
    name: "金融",
    description: "银行、保险及其他金融服务",
    icon: Landmark,
    accent: "text-sky-600",
    keywords: ["银行", "保险", "证券", "多元金融"],
  },
  {
    id: "consumer",
    name: "大消费",
    description: "食品饮料、家电、服装与商贸零售",
    icon: ShoppingBasket,
    accent: "text-red-600",
    keywords: [
      "白酒",
      "食品",
      "饮料",
      "乳品",
      "家电",
      "厨卫",
      "服装",
      "纺织",
      "家居",
      "零售",
      "连锁",
      "贸易",
      "电商",
      "饰品",
      "养殖",
      "农产品",
    ],
  },
  {
    id: "healthcare",
    name: "医药健康",
    description: "中药、制药、生物与医疗器械",
    icon: HeartPulse,
    accent: "text-emerald-600",
    keywords: ["医药", "中药", "制药", "生物", "医疗", "动物保健"],
  },
  {
    id: "energy",
    name: "能源公用",
    description: "煤炭、油气、电力与燃气",
    icon: Fuel,
    accent: "text-amber-700",
    keywords: ["煤炭", "石油", "油气", "炼化", "电力", "燃气", "水务"],
  },
  {
    id: "materials",
    name: "材料化工",
    description: "化工、钢铁、建材、造纸与包装",
    icon: FlaskConical,
    accent: "text-cyan-700",
    keywords: [
      "化学",
      "化工",
      "农化",
      "钢铁",
      "普钢",
      "特钢",
      "冶钢",
      "有色",
      "金属",
      "水泥",
      "玻璃",
      "建材",
      "造纸",
      "包装印刷",
    ],
  },
  {
    id: "technology",
    name: "科技传媒",
    description: "通信、计算机、软件、互联网与传媒",
    icon: MonitorSmartphone,
    accent: "text-violet-600",
    keywords: [
      "通信",
      "计算机",
      "软件",
      "IT服务",
      "互联网",
      "游戏",
      "出版",
      "广告",
      "影视",
    ],
  },
  {
    id: "industrial",
    name: "工业制造",
    description: "机械设备、汽车与工业零部件",
    icon: Factory,
    accent: "text-slate-700",
    keywords: [
      "机械",
      "设备",
      "汽车",
      "商用车",
      "摩托车",
      "军工",
      "自动化",
      "工业金属",
    ],
  },
  {
    id: "transportation",
    name: "交通运输",
    description: "铁路公路、航运港口、航空与物流",
    icon: TrainFront,
    accent: "text-blue-600",
    keywords: ["铁路", "公路", "航运", "港口", "航空", "物流", "交通运输"],
  },
  {
    id: "construction",
    name: "建筑地产",
    description: "建筑施工、基础设施与房地产",
    icon: Building2,
    accent: "text-teal-700",
    keywords: ["建筑", "建设", "专业工程", "基础设施", "装修装饰", "房地产", "房屋"],
  },
  {
    id: "other",
    name: "其他行业",
    description: "暂未归入以上大类的公司",
    icon: Zap,
    accent: "text-slate-500",
    keywords: [],
  },
];

function categoryForIndustry(industry: string | null) {
  const normalizedIndustry = industry?.trim() ?? "";
  return (
    dividendCategories.find(
      (category) =>
        category.id !== "other" &&
        category.keywords.some((keyword) => normalizedIndustry.includes(keyword)),
    ) ?? dividendCategories.at(-1)!
  );
}

function groupDividendRows(rows: AshareDividendCompany[]): DividendCategoryGroup[] {
  const rowsByCategory = new Map<string, AshareDividendCompany[]>();
  for (const row of rows) {
    const category = categoryForIndustry(row.industry);
    const categoryRows = rowsByCategory.get(category.id) ?? [];
    categoryRows.push(row);
    rowsByCategory.set(category.id, categoryRows);
  }

  return dividendCategories.flatMap((category) => {
    const categoryRows = rowsByCategory.get(category.id) ?? [];
    if (!categoryRows.length) return [];
    const yields = categoryRows
      .map((row) => row.dividendYield)
      .filter((value): value is number => value != null);
    return [
      {
        ...category,
        rows: categoryRows,
        averageYield: yields.length
          ? yields.reduce((sum, value) => sum + value, 0) / yields.length
          : null,
        highestYield: yields.length ? Math.max(...yields) : null,
      },
    ];
  });
}

function formatPercent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "N/A" : `${value.toFixed(2)}%`;
}

function formatPrice(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "N/A" : `¥${value.toFixed(2)}`;
}

function formatBonus(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "N/A" : `¥${value.toFixed(3)}/10股`;
}

function formatMarketCap(row: AshareDividendCompany) {
  if (
    row.price == null ||
    row.totalShares == null ||
    !Number.isFinite(row.price) ||
    !Number.isFinite(row.totalShares)
  ) {
    return "N/A";
  }
  return `${((row.price * row.totalShares) / 100_000_000).toFixed(1)}亿元`;
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "待披露";
  const match = value.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${match[1]}-${match[2]}` : value;
}

function changeClass(value: number | null) {
  if (value == null || value === 0) return "text-slate-500";
  return value > 0 ? "text-red-600" : "text-emerald-600";
}

function DividendCompanyCard({ row }: { row: AshareDividendCompany }) {
  return (
    <article className="group min-w-0 rounded-md border border-slate-200 bg-white p-3 shadow-sm transition-colors hover:border-slate-300">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={row.quoteUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 font-semibold text-slate-950 hover:text-red-700"
          >
            <span className="truncate">{row.name}</span>
            <ArrowUpRight className="size-3.5 shrink-0" />
          </a>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
            <span className="font-mono">{row.code}</span>
            <span>{row.exchange}</span>
            <span>{row.industry ?? "行业待分类"}</span>
          </div>
        </div>
        <span className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500">
          #{row.rank}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 divide-x divide-slate-100 border-y border-slate-100 py-2.5">
        <div className="pr-2">
          <div className="text-[10px] text-slate-500">股息率</div>
          <div className="mt-1 whitespace-nowrap font-mono text-base font-semibold text-red-700">
            {formatPercent(row.dividendYield)}
          </div>
        </div>
        <div className="px-2">
          <div className="text-[10px] text-slate-500">现价 / 涨跌</div>
          <div className="mt-1 whitespace-nowrap font-mono text-xs font-semibold text-slate-950">
            {formatPrice(row.price)}
          </div>
          <div className={`mt-0.5 whitespace-nowrap font-mono text-[10px] ${changeClass(row.changePct)}`}>
            {row.changePct == null
              ? "N/A"
              : `${row.changePct > 0 ? "+" : ""}${row.changePct.toFixed(2)}%`}
          </div>
        </div>
        <div className="pl-2">
          <div className="text-[10px] text-slate-500">当前市值</div>
          <div className="mt-1 whitespace-nowrap font-mono text-xs font-semibold text-slate-950">
            {formatMarketCap(row)}
          </div>
          <div className="mt-0.5 whitespace-nowrap text-[10px] text-slate-500">
            人民币估算
          </div>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-[11px] leading-5">
        <div className="min-w-0 text-slate-600">
          <div className="truncate">
            年度分红 <span className="font-mono text-slate-950">{formatBonus(row.annualBonusRmb)}</span>
          </div>
          <div className="truncate">
            {row.dividendEvents}次合计 · {row.progress ?? "进度待披露"}
          </div>
        </div>
        <div className="text-right text-slate-500">
          <div>登记 {formatShortDate(row.equityRecordDate)}</div>
          <a
            href={row.detailUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-slate-950"
          >
            分红明细
            <ArrowUpRight className="size-3" />
          </a>
        </div>
      </div>
    </article>
  );
}

export function AshareDividendPanel({
  snapshot,
  isLoading,
  message,
}: {
  snapshot: AshareDividendSnapshot | null;
  isLoading: boolean;
  message: string | null;
}) {
  const rows = snapshot?.rows ?? [];
  const groups = groupDividendRows(rows);
  const averageYield = rows.length
    ? rows.reduce((sum, row) => sum + (row.dividendYield ?? 0), 0) / rows.length
    : null;
  const multiDividendCount = rows.filter((row) => row.dividendEvents > 1).length;

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <BadgePercent className="size-3.5" />
            A 股高股息行业图谱
          </div>
          <h2 className="text-xl font-semibold text-slate-950">
            按传统行业大类查看高股息公司
          </h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            保留连续{ashareDividendContinuityYears}年现金分红、动态股息率高于
            {ashareDividendMinimumYield}% 的筛选口径，并依据东方财富细分行业归入金融、消费、能源等大类。
          </p>
        </div>
        <div className="shrink-0 font-mono text-xs text-slate-500">
          {snapshot ? `${snapshot.reportLabel} / ${snapshot.updatedAtLabel}` : "待更新"}
        </div>
      </div>

      {message ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <RefreshCw className={`size-4 text-emerald-600 ${isLoading ? "animate-spin" : ""}`} />
          {message}
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm sm:grid-cols-4">
        <div className="border-b border-r border-slate-100 px-4 py-3 sm:border-b-0">
          <div className="text-[10px] font-semibold text-slate-500">符合条件</div>
          <div className="mt-1 font-mono text-xl font-semibold text-slate-950">{rows.length}家</div>
        </div>
        <div className="border-b border-slate-100 px-4 py-3 sm:border-b-0 sm:border-r">
          <div className="text-[10px] font-semibold text-slate-500">行业大类</div>
          <div className="mt-1 font-mono text-xl font-semibold text-slate-950">{groups.length}类</div>
        </div>
        <div className="border-r border-slate-100 px-4 py-3">
          <div className="text-[10px] font-semibold text-slate-500">平均股息率</div>
          <div className="mt-1 font-mono text-xl font-semibold text-red-700">
            {formatPercent(averageYield)}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] font-semibold text-slate-500">年内多次分红</div>
          <div className="mt-1 font-mono text-xl font-semibold text-slate-950">
            {multiDividendCount}家
          </div>
        </div>
      </div>

      {groups.length ? (
        <>
          <nav
            aria-label="股息行业分类"
            className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
          >
            {groups.map((group) => {
              const Icon = group.icon;
              return (
                <a
                  key={group.id}
                  href={`#dividend-category-${group.id}`}
                  className="flex min-w-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
                >
                  <Icon className={`size-4 shrink-0 ${group.accent}`} />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">
                    {group.name}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-500">
                    {group.rows.length}
                  </span>
                </a>
              );
            })}
          </nav>

          <div className="space-y-8">
            {groups.map((group) => {
              const Icon = group.icon;
              return (
                <section
                  key={group.id}
                  id={`dividend-category-${group.id}`}
                  className="scroll-mt-4"
                >
                  <div className="mb-3 flex flex-col gap-2 border-b border-slate-300 pb-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white shadow-sm">
                        <Icon className={`size-4 ${group.accent}`} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <h3 className="text-base font-semibold text-slate-950">{group.name}</h3>
                          <span className="font-mono text-xs text-slate-500">{group.rows.length}家公司</span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">{group.description}</p>
                      </div>
                    </div>
                    <div className="flex gap-4 pl-12 font-mono text-[11px] text-slate-500 sm:pl-0">
                      <span>
                        平均 <strong className="text-red-700">{formatPercent(group.averageYield)}</strong>
                      </span>
                      <span>
                        最高 <strong className="text-red-700">{formatPercent(group.highestYield)}</strong>
                      </span>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {group.rows.map((row) => (
                      <DividendCompanyCard key={row.code} row={row} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500 shadow-sm">
          暂无 A 股股息率数据
        </div>
      )}

      <div className="mt-6 text-[11px] leading-5 text-slate-500">
        行业大类由页面依据东方财富细分行业字段归并，仅用于浏览与比较；市值按当前价格 × 总股本估算，单位为人民币。
      </div>
    </section>
  );
}
