"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  BadgePercent,
  CheckCircle2,
  Clock3,
  FileText,
  Globe2,
  PiggyBank,
  RefreshCw,
  Rss,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type {
  GlobalValuationSnapshot,
  IndexValuation,
  QdiiEtfQuote,
  QdiiEtfGroup,
} from "@/lib/global-valuations";
import {
  ashareDividendContinuityYears,
  ashareDividendMinimumYield,
} from "@/lib/a-share-dividend-config";
import type { AshareDividendSnapshot } from "@/lib/a-share-dividends";
import { DcaBacktestPanel } from "@/components/dca-backtest-panel";
import type { MorningReport, NewsItem, SourceId } from "@/lib/news-report";

const sourceOrder: SourceId[] = ["cls", "wallstreetcn", "xueqiu"];
type DashboardView = "report" | "valuation" | "qdii" | "dividends" | "dca";

function sourceLabel(source: SourceId) {
  return {
    cls: "财联社",
    wallstreetcn: "华尔街见闻",
    xueqiu: "雪球热榜",
  }[source];
}

function NewsList({ items }: { items: NewsItem[] }) {
  if (!items.length) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-white/70 px-4 py-6 text-sm text-slate-500">
        暂无数据
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200 bg-white">
      {items.map((item) => (
        <a
          key={`${item.source}-${item.id}-${item.rank}`}
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="group grid grid-cols-[2.25rem_1fr_auto] items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
        >
          <span className="flex size-7 items-center justify-center rounded bg-slate-100 font-mono text-xs font-semibold text-slate-600">
            {item.rank}
          </span>
          <span className="min-w-0 text-sm font-medium leading-6 text-slate-900">
            {item.title}
            {item.meta?.info ? (
              <span className="ml-2 whitespace-nowrap font-mono text-xs text-emerald-700">
                {String(item.meta.info)}
              </span>
            ) : null}
          </span>
          <ArrowUpRight className="mt-1 size-4 text-slate-400 transition-colors group-hover:text-slate-900" />
        </a>
      ))}
    </div>
  );
}

function Section({
  icon,
  title,
  bullets,
}: {
  icon: ReactNode;
  title: string;
  bullets: string[];
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded bg-slate-900 text-white">
          {icon}
        </span>
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      </div>
      <ul className="space-y-3">
        {bullets.map((bullet) => (
          <li key={bullet} className="text-sm leading-6 text-slate-700">
            {bullet}
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatMetric(value: number | null, suffix = "") {
  if (value == null) return "N/A";
  return `${value.toFixed(value >= 10 ? 1 : 2)}${suffix}`;
}

function formatStrictPercent(value: number | null | undefined) {
  if (value == null) return "N/A";
  return `${value.toFixed(2)}%`;
}

function formatStockPrice(value: number | null | undefined) {
  if (value == null) return "N/A";
  return value.toFixed(2);
}

function formatBonus(value: number | null | undefined) {
  if (value == null) return "N/A";
  return `10派${value.toFixed(value >= 10 ? 1 : 2)}元`;
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "N/A";
  return value.slice(5);
}

function bandClass(band: IndexValuation["valuationBand"]) {
  if (band === "低") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (band === "中") return "bg-sky-50 text-sky-700 border-sky-200";
  if (band === "高") return "bg-amber-50 text-amber-700 border-amber-200";
  if (band === "很高") return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function ValuationTable({ snapshot }: { snapshot: GlobalValuationSnapshot }) {
  const rows = snapshot.rows;
  const lowCount = rows.filter((row) => row.valuationBand === "低").length;
  const highCount = rows.filter(
    (row) => row.valuationBand === "高" || row.valuationBand === "很高",
  ).length;
  const medianPe = [...rows]
    .map((row) => row.peTtm)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b)[Math.floor(rows.length / 2)];

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <Globe2 className="size-3.5" />
            全球指数估值雷达
          </div>
          <h2 className="text-xl font-semibold text-slate-950">主流市场 PE / PB / 股息率</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            {snapshot.methodology}
          </p>
        </div>
        <div className="font-mono text-xs text-slate-500">{snapshot.asOfLabel}</div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">覆盖指数</div>
          <div className="mt-2 font-mono text-3xl font-semibold">{rows.length}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">估值偏低</div>
          <div className="mt-2 font-mono text-3xl font-semibold text-emerald-700">
            {lowCount}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">估值偏高/很高</div>
          <div className="mt-2 font-mono text-3xl font-semibold text-amber-700">
            {highCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            样本中位 TTM PE：{formatMetric(medianPe)}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="min-w-[1040px] w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">指数</th>
              <th className="px-4 py-3 font-semibold">地区</th>
              <th className="px-4 py-3 font-semibold">代表标的</th>
              <th className="px-4 py-3 text-right font-semibold">PE TTM</th>
              <th className="px-4 py-3 text-right font-semibold">Forward PE</th>
              <th className="px-4 py-3 text-right font-semibold">PB</th>
              <th className="px-4 py-3 text-right font-semibold">股息率</th>
              <th className="px-4 py-3 font-semibold">估值</th>
              <th className="px-4 py-3 font-semibold">来源</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="align-top hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-950">{row.name}</div>
                  <div className="mt-1 max-w-xs text-xs leading-5 text-slate-500">
                    {row.note}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-700">{row.region}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{row.proxy}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-950">
                  {formatMetric(row.peTtm)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-950">
                  {formatMetric(row.forwardPe)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-950">
                  {formatMetric(row.pb)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-950">
                  {formatMetric(row.dividendYield, "%")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded border px-2 py-1 text-xs font-semibold ${bandClass(
                      row.valuationBand,
                    )}`}
                  >
                    {row.valuationBand}
                  </span>
                  <div className="mt-1 text-xs text-slate-500">{row.quality}</div>
                </td>
                <td className="px-4 py-3">
                  <a
                    href={row.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-950"
                  >
                    {row.sourceName}
                    <ArrowUpRight className="size-3" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatAmount(value: number | null | undefined) {
  if (value == null) return "N/A";
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(0)}万`;
  return value.toFixed(0);
}

function formatEtfPrice(value: number | null | undefined) {
  if (value == null) return "N/A";
  return value.toFixed(3);
}

function formatRealtimeEstimate(value: number | null | undefined) {
  if (value == null) return "N/A";
  return value.toFixed(4);
}

function metricClass(value: number | null | undefined) {
  if (value == null) return "text-slate-500";
  if (value > 0) return "text-red-700";
  if (value < 0) return "text-emerald-700";
  return "text-slate-700";
}

function QdiiEtfGroups({
  groups,
  quotes,
  isLoading,
  message,
}: {
  groups: QdiiEtfGroup[];
  quotes: Record<string, QdiiEtfQuote>;
  isLoading: boolean;
  message: string | null;
}) {
  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const quoted = groups
    .flatMap((group) => group.items)
    .filter((item) => quotes[item.code]?.price != null).length;

  return (
    <section>
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <TrendingUp className="size-3.5" />
            大陆上市 QDII / 跨境 ETF
          </div>
          <h2 className="text-xl font-semibold text-slate-950">按跟踪类型分组</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            这些是 A 股场内可交易的跨境 ETF/QDII 代表产品。价格和涨跌幅来自东方财富，实时估值优先使用东方财富移动端口径；溢价率按场内现价相对实时估值计算。
          </p>
        </div>
        <div className="font-mono text-xs text-slate-500">
          {groups.length} 组 / {total} 只 / 已报价 {quoted} 只
        </div>
      </div>

      {message ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <RefreshCw className={`size-4 text-emerald-600 ${isLoading ? "animate-spin" : ""}`} />
          {message}
        </div>
      ) : null}

      <div className="grid gap-5">
        {groups.map((group) => (
          <section
            key={group.id}
            className="rounded-md border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-950">{group.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{group.description}</p>
              </div>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-600">
                {group.items.length}
              </span>
            </div>

            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-[820px] w-full border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">代码</th>
                    <th className="px-3 py-2 font-semibold">名称</th>
                    <th className="px-3 py-2 text-right font-semibold">现价/日期</th>
                    <th className="px-3 py-2 text-right font-semibold">涨跌幅</th>
                    <th className="px-3 py-2 text-right font-semibold">实时估值/时间</th>
                    <th className="px-3 py-2 text-right font-semibold">溢价率</th>
                    <th className="px-3 py-2 text-right font-semibold">成交额</th>
                    <th className="px-3 py-2 font-semibold">跟踪</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.items.map((item) => {
                    const quote = quotes[item.code];
                    return (
                      <tr key={item.code} className="align-top hover:bg-slate-50">
                        <td className="whitespace-nowrap px-3 py-3 font-mono text-xs font-semibold text-slate-950">
                          {item.code}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-slate-950">{item.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.manager}</div>
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-mono ${metricClass(
                            quote?.changePct,
                          )}`}
                        >
                          <div>{formatEtfPrice(quote?.price)}</div>
                          {quote?.priceTime || quote?.priceDate ? (
                            <div className="mt-1 whitespace-nowrap text-[11px] text-slate-500">
                              {quote.priceTime ?? quote.priceDate}
                            </div>
                          ) : null}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-mono ${metricClass(
                            quote?.changePct,
                          )}`}
                        >
                          {formatMetric(quote?.changePct ?? null, "%")}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="font-mono text-slate-950">
                            {formatRealtimeEstimate(quote?.nav)}
                          </div>
                          {quote?.navTime ? (
                            <div className="mt-1 whitespace-nowrap font-mono text-[11px] text-slate-500">
                              {quote.navTime}
                            </div>
                          ) : null}
                          {quote?.navSource ? (
                            <div className="mt-1 whitespace-nowrap text-[11px] text-slate-500">
                              {quote.navSource}
                            </div>
                          ) : null}
                        </td>
                        <td
                          className={`px-3 py-3 text-right font-mono font-semibold ${metricClass(
                            quote?.premiumRate,
                          )}`}
                        >
                          {formatMetric(quote?.premiumRate ?? null, "%")}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-slate-700">
                          {formatAmount(quote?.amount)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="text-slate-700">{item.tracking}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.market}</div>
                          <div className="mt-1 text-xs leading-5 text-slate-500">{item.note}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function AshareDividendTable({
  snapshot,
  isLoading,
  message,
}: {
  snapshot: AshareDividendSnapshot | null;
  isLoading: boolean;
  message: string | null;
}) {
  const rows = snapshot?.rows ?? [];
  const averageYield =
    rows.length > 0
      ? rows.reduce((sum, row) => sum + (row.dividendYield ?? 0), 0) / rows.length
      : null;
  const multiDividendCount = rows.filter((row) => row.dividendEvents > 1).length;

  return (
    <section>
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <BadgePercent className="size-3.5" />
            A 股股息率排行
          </div>
          <h2 className="text-xl font-semibold text-slate-950">
            连续{ashareDividendContinuityYears}年分红且股息率高于
            {ashareDividendMinimumYield}%
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            数据来自东方财富分红送配，先筛选最近 {ashareDividendContinuityYears}{" "}
            个完整年度每年都有现金分红的公司，再按最近完整年度现金分红合计 / 当前行情价动态计算，展示股息率高于
            {ashareDividendMinimumYield}% 的全部公司。
          </p>
        </div>
        <div className="font-mono text-xs text-slate-500">
          {snapshot ? `${snapshot.reportLabel} / ${snapshot.updatedAtLabel}` : "待更新"}
        </div>
      </div>

      {message ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <RefreshCw className={`size-4 text-emerald-600 ${isLoading ? "animate-spin" : ""}`} />
          {message}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">
            连续{ashareDividendContinuityYears}年且 &gt;{ashareDividendMinimumYield}%
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-slate-950">
            {rows.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            按动态股息率展示
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">
            展示样本平均股息率
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-red-700">
            {formatStrictPercent(averageYield)}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">年内多次分红</div>
          <div className="mt-2 font-mono text-3xl font-semibold text-slate-950">
            {multiDividendCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            已把中期、年度等多次现金分红合并计算
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="min-w-[980px] w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">排名</th>
              <th className="px-3 py-2 font-semibold">代码/公司</th>
              <th className="px-3 py-2 text-right font-semibold">现价</th>
              <th className="px-3 py-2 text-right font-semibold">涨跌幅</th>
              <th className="px-3 py-2 text-right font-semibold">股息率</th>
              <th className="px-3 py-2 text-right font-semibold">年度现金分红</th>
              <th className="px-3 py-2 font-semibold">进度</th>
              <th className="px-3 py-2 font-semibold">登记/除息</th>
              <th className="px-3 py-2 font-semibold">行业</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length ? (
              rows.map((row) => (
                <tr key={row.code} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-3 font-mono text-xs font-semibold text-slate-500">
                    {row.rank}
                  </td>
                  <td className="px-3 py-3">
                    <a
                      href={row.quoteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-slate-950 hover:text-red-700"
                    >
                      <span className="font-mono text-xs">{row.code}</span>
                      {row.name}
                      <ArrowUpRight className="size-3" />
                    </a>
                    <div className="mt-1 text-xs text-slate-500">{row.exchange}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-950">
                    {formatStockPrice(row.price)}
                  </td>
                  <td
                    className={`px-3 py-3 text-right font-mono ${metricClass(row.changePct)}`}
                  >
                    {formatMetric(row.changePct ?? null, "%")}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold text-red-700">
                    {formatStrictPercent(row.dividendYield)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-950">
                    <div>{formatBonus(row.annualBonusRmb)}</div>
                    <div className="mt-1 text-xs text-slate-500">{row.dividendEvents}次分红</div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
                      {row.progress ?? "N/A"}
                    </span>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-slate-600">
                    <div>登记 {formatShortDate(row.equityRecordDate)}</div>
                    <div className="mt-1">除息 {formatShortDate(row.exDividendDate)}</div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    <div>{row.industry ?? "N/A"}</div>
                    <a
                      href={row.detailUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-950"
                    >
                      分红明细
                      <ArrowUpRight className="size-3" />
                    </a>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                  暂无 A 股股息率数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ReportDashboard({
  initialReport,
  initialValuations,
}: {
  initialReport: MorningReport;
  initialValuations: GlobalValuationSnapshot;
}) {
  const [report, setReport] = useState(initialReport);
  const [valuations] = useState(initialValuations);
  const [activeView, setActiveView] = useState<DashboardView>("report");
  const [qdiiQuotes, setQdiiQuotes] = useState<Record<string, QdiiEtfQuote>>({});
  const [isQdiiLoading, setIsQdiiLoading] = useState(false);
  const [qdiiMessage, setQdiiMessage] = useState<string | null>(null);
  const [dividendSnapshot, setDividendSnapshot] = useState<AshareDividendSnapshot | null>(null);
  const [isDividendLoading, setIsDividendLoading] = useState(false);
  const [dividendMessage, setDividendMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [autoRefreshMessage, setAutoRefreshMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalItems = useMemo(
    () => sourceOrder.reduce((sum, source) => sum + report.sources[source].length, 0),
    [report],
  );

  async function refreshReport(mode: "manual" | "auto" = "manual") {
    if (mode === "manual") {
      setIsRefreshing(true);
      setError(null);
      setAutoRefreshMessage(null);
    } else {
      setIsAutoRefreshing(true);
      setAutoRefreshMessage("正在后台更新早报...");
    }

    try {
      const response = await fetch("/api/reports/generate", {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`刷新失败：${response.status}`);
      }
      setReport((await response.json()) as MorningReport);
      if (mode === "auto") {
        setAutoRefreshMessage("已自动更新到最新早报");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "刷新失败";
      if (mode === "manual") {
        setError(message);
      } else {
        setAutoRefreshMessage(`自动更新失败，已显示本地缓存：${message}`);
      }
    } finally {
      if (mode === "manual") {
        setIsRefreshing(false);
      } else {
        setIsAutoRefreshing(false);
      }
    }
  }

  async function refreshQdiiQuotes() {
    setIsQdiiLoading(true);
    setQdiiMessage("正在更新 QDII 价格和溢价率...");

    try {
      const response = await fetch("/api/qdii/quotes", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`QDII 行情更新失败：${response.status}`);
      }
      const data = (await response.json()) as { quotes: Record<string, QdiiEtfQuote> };
      setQdiiQuotes(data.quotes);
      setQdiiMessage("QDII 价格和溢价率已更新");
    } catch (err) {
      const message = err instanceof Error ? err.message : "QDII 行情更新失败";
      setQdiiMessage(`${message}，已保留列表结构`);
    } finally {
      setIsQdiiLoading(false);
    }
  }

  async function refreshDividendStocks() {
    setIsDividendLoading(true);
    setDividendMessage(`正在更新 A 股股息率高于 ${ashareDividendMinimumYield}% 的公司...`);

    try {
      const response = await fetch("/api/a-share/dividends", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`A 股股息率更新失败：${response.status}`);
      }
      const data = (await response.json()) as AshareDividendSnapshot;
      setDividendSnapshot(data);
      setDividendMessage(data.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : "A 股股息率更新失败";
      setDividendMessage(`${message}，不影响其他栏目使用`);
    } finally {
      setIsDividendLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshReport("auto");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (activeView !== "qdii" || Object.keys(qdiiQuotes).length > 0 || isQdiiLoading) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshQdiiQuotes();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeView, isQdiiLoading, qdiiQuotes]);

  useEffect(() => {
    if (activeView !== "dividends" || dividendSnapshot || isDividendLoading) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshDividendStocks();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeView, dividendSnapshot, isDividendLoading]);

  const activeTimestamp =
    activeView === "report"
      ? report.generatedAtLabel
      : activeView === "dividends"
        ? dividendSnapshot?.updatedAtLabel ?? "待更新"
        : activeView === "dca"
          ? "按需运行"
          : valuations.asOfLabel;

  const activeTitle =
    activeView === "report"
      ? "开盘前财经早报"
      : activeView === "valuation"
        ? "全球指数估值雷达"
        : activeView === "qdii"
          ? "大陆上市 QDII ETF"
          : activeView === "dividends"
            ? `A 股股息率 > ${ashareDividendMinimumYield}%`
            : "定投回测器";

  return (
    <main className="min-h-screen bg-[#eef2f5] text-slate-950">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setActiveView("report")}
                  className={`inline-flex h-8 items-center gap-2 rounded px-3 text-xs font-semibold transition-colors ${
                    activeView === "report"
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-600 hover:bg-white hover:text-slate-950"
                  }`}
                  title="查看开盘前财经早报"
                >
                  <Rss className="size-3.5" />
                  财经早报
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView("valuation")}
                  className={`inline-flex h-8 items-center gap-2 rounded px-3 text-xs font-semibold transition-colors ${
                    activeView === "valuation"
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-600 hover:bg-white hover:text-slate-950"
                  }`}
                  title="查看全球指数市盈率和估值表"
                >
                  <TrendingUp className="size-3.5" />
                  估值雷达
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView("qdii")}
                  className={`inline-flex h-8 items-center gap-2 rounded px-3 text-xs font-semibold transition-colors ${
                    activeView === "qdii"
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-600 hover:bg-white hover:text-slate-950"
                  }`}
                  title="查看大陆上市 QDII ETF 价格和溢价率"
                >
                  <Globe2 className="size-3.5" />
                  QDII ETF
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView("dividends")}
                  className={`inline-flex h-8 items-center gap-2 rounded px-3 text-xs font-semibold transition-colors ${
                    activeView === "dividends"
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-600 hover:bg-white hover:text-slate-950"
                  }`}
                  title={`查看 A 股股息率高于 ${ashareDividendMinimumYield}% 的公司`}
                >
                  <BadgePercent className="size-3.5" />
                  A股股息
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView("dca")}
                  className={`inline-flex h-8 items-center gap-2 rounded px-3 text-xs font-semibold transition-colors ${
                    activeView === "dca"
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-600 hover:bg-white hover:text-slate-950"
                  }`}
                  title="查看定投回测器"
                >
                  <PiggyBank className="size-3.5" />
                  定投回测
                </button>
              </div>
              <span className="inline-flex items-center gap-2 rounded border border-slate-200 px-3 py-1.5 font-mono text-xs text-slate-600">
                <Clock3 className="size-3.5" />
                {activeTimestamp}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-normal text-slate-950 md:text-4xl">
              {activeTitle}
            </h1>
          </div>

          {activeView === "report" ? (
            <button
              type="button"
              onClick={() => refreshReport("manual")}
              disabled={isRefreshing}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              title="重新抓取三路新闻源并生成最新早报"
            >
              <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "刷新中" : "刷新早报"}
            </button>
          ) : activeView === "qdii" ? (
            <button
              type="button"
              onClick={refreshQdiiQuotes}
              disabled={isQdiiLoading}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              title="重新拉取 QDII 价格、估算净值和溢价率"
            >
              <RefreshCw className={`size-4 ${isQdiiLoading ? "animate-spin" : ""}`} />
              {isQdiiLoading ? "更新中" : "刷新 QDII"}
            </button>
          ) : activeView === "dividends" ? (
            <button
              type="button"
              onClick={refreshDividendStocks}
              disabled={isDividendLoading}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              title={`重新拉取 A 股股息率高于 ${ashareDividendMinimumYield}% 的公司`}
            >
              <RefreshCw className={`size-4 ${isDividendLoading ? "animate-spin" : ""}`} />
              {isDividendLoading ? "更新中" : "刷新股息"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 py-6 lg:px-8">
        {activeView === "report" && error ? (
          <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {activeView === "report" && autoRefreshMessage ? (
          <div className="mb-5 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            <RefreshCw
              className={`size-4 text-emerald-600 ${isAutoRefreshing ? "animate-spin" : ""}`}
            />
            {autoRefreshMessage}
          </div>
        ) : null}

        {activeView === "report" ? (
          <>
            <div className="mb-6 grid gap-3 md:grid-cols-4">
              <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-medium text-slate-500">新闻条目</div>
                <div className="mt-2 font-mono text-3xl font-semibold text-slate-950">
                  {totalItems}
                </div>
              </div>
              {sourceOrder.map((source) => {
                const status = report.sourceStatus[source];
                return (
                  <div
                    key={source}
                    className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-slate-500">
                        {sourceLabel(source)}
                      </div>
                      {status.ok ? (
                        <CheckCircle2 className="size-4 text-emerald-600" />
                      ) : (
                        <AlertTriangle className="size-4 text-amber-600" />
                      )}
                    </div>
                    <div className="mt-2 font-mono text-3xl font-semibold text-slate-950">
                      {status.count}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{status.message}</div>
                  </div>
                );
              })}
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              {report.focusTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <Section
                icon={<Sparkles className="size-4" />}
                title={report.summary.title}
                bullets={report.summary.bullets}
              />
              <Section
                icon={<FileText className="size-4" />}
                title={report.marketImpact.title}
                bullets={report.marketImpact.bullets}
              />
              <Section
                icon={<AlertTriangle className="size-4" />}
                title={report.risks.title}
                bullets={report.risks.bullets}
              />
            </div>

            <div className="mt-8 grid gap-5 lg:grid-cols-3">
              {sourceOrder.map((source) => (
                <section key={source}>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-950">
                      {sourceLabel(source)}
                    </h2>
                    <span className="font-mono text-xs text-slate-500">
                      Top {report.sources[source].length}
                    </span>
                  </div>
                  <NewsList items={report.sources[source]} />
                </section>
              ))}
            </div>
          </>
        ) : activeView === "valuation" ? (
          <>
            <ValuationTable snapshot={valuations} />
          </>
        ) : activeView === "qdii" ? (
          <QdiiEtfGroups
            groups={valuations.qdiiGroups}
            quotes={qdiiQuotes}
            isLoading={isQdiiLoading}
            message={qdiiMessage}
          />
        ) : activeView === "dividends" ? (
          <AshareDividendTable
            snapshot={dividendSnapshot}
            isLoading={isDividendLoading}
            message={dividendMessage}
          />
        ) : (
          <DcaBacktestPanel />
        )}
      </div>
    </main>
  );
}
