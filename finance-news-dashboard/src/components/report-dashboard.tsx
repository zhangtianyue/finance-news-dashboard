"use client";

import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BadgePercent,
  CheckCircle2,
  Clock3,
  FileText,
  Flame,
  Gauge,
  Globe2,
  Layers3,
  Moon,
  PiggyBank,
  RefreshCw,
  Rss,
  Sparkles,
  Sun,
  TrendingUp,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { PolymarketHotItem, PolymarketHotSnapshot } from "@/lib/polymarket-hot";
import type { StockHeatItem, StockHeatSector, StockHeatSnapshot } from "@/lib/stock-heat";

const sourceOrder: SourceId[] = ["cls", "wallstreetcn", "xueqiu"];
type DashboardView = "report" | "valuation" | "qdii" | "dividends" | "polymarket" | "dca";
type MarketHeatMode = "stocks" | "sectors" | "events";
type DashboardTheme = "light" | "dark";
type DashboardNavItem = {
  view: DashboardView;
  label: string;
  icon: ReactNode;
  title: string;
};

const dashboardViews = new Set<DashboardView>([
  "report",
  "valuation",
  "qdii",
  "dividends",
  "polymarket",
  "dca",
]);
const marketHeatModes = new Set<MarketHeatMode>(["stocks", "sectors", "events"]);
const dashboardThemeStorageKey = "finance-dashboard-theme";

function isDashboardView(value: string | null): value is DashboardView {
  return value != null && dashboardViews.has(value as DashboardView);
}

function readDashboardViewFromLocation() {
  if (typeof window === "undefined") return "report";

  const view = new URLSearchParams(window.location.search).get("view");
  return isDashboardView(view) ? view : "report";
}

function readMarketHeatModeFromLocation() {
  if (typeof window === "undefined") return "stocks";

  const mode = new URLSearchParams(window.location.search).get("heat");
  return mode != null && marketHeatModes.has(mode as MarketHeatMode)
    ? (mode as MarketHeatMode)
    : "stocks";
}

function readDashboardTheme() {
  if (typeof window === "undefined") return "light";

  const storedTheme = window.localStorage.getItem(dashboardThemeStorageKey);
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function dashboardViewHref(view: DashboardView) {
  return view === "report" ? "/" : `/?view=${view}`;
}

function marketHeatModeHref(mode: MarketHeatMode) {
  return `/?view=polymarket&heat=${mode}`;
}

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

function formatCompactDateTime(value: string | null | undefined) {
  if (!value) return "N/A";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) return value.slice(5, 16);
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(5, 10);
  return value;
}

function bandClass(band: IndexValuation["valuationBand"]) {
  if (band === "低") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (band === "中") return "bg-sky-50 text-sky-700 border-sky-200";
  if (band === "高") return "bg-amber-50 text-amber-700 border-amber-200";
  if (band === "很高") return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function ValuationTable({
  snapshot,
  isLoading,
  message,
}: {
  snapshot: GlobalValuationSnapshot;
  isLoading: boolean;
  message: string | null;
}) {
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
        <div className="flex flex-col items-start gap-2 md:items-end">
          <span
            className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-xs font-semibold ${
              snapshot.dataStatus === "dynamic"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : snapshot.dataStatus === "cached"
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            {snapshot.dataStatus === "dynamic"
              ? "动态更新"
              : snapshot.dataStatus === "cached"
                ? "缓存"
                : "基准"}
          </span>
          <div className="font-mono text-xs text-slate-500">{snapshot.asOfLabel}</div>
        </div>
      </div>

      {message ?? snapshot.message ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <RefreshCw className={`size-4 text-emerald-600 ${isLoading ? "animate-spin" : ""}`} />
          {message ?? snapshot.message}
        </div>
      ) : null}

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

function formatUsdAmount(value: number | null | undefined) {
  if (value == null) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatStockHeatAmount(item: StockHeatItem) {
  if (item.market === "美股") return formatUsdAmount(item.amount);
  return formatAmount(item.amount);
}

function formatSectorHeatAmount(sector: StockHeatSector) {
  if (sector.market === "美股") return formatUsdAmount(sector.amount);
  return formatAmount(sector.amount);
}

function stockHeatChangeClass(value: number) {
  if (value > 0) return "text-red-600";
  if (value < 0) return "text-emerald-700";
  return "text-slate-600";
}

function stockHeatLevelClass(level: StockHeatItem["heatLevel"]) {
  if (level === "沸腾") return "border-red-200 bg-red-50 text-red-700";
  if (level === "升温") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function StockHeatList({
  title,
  caption,
  items,
  asOfLabel,
}: {
  title: string;
  caption: string;
  items: StockHeatItem[];
  asOfLabel: string;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div>
          <h3 className="text-base font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{caption}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-xs font-semibold text-slate-700">Top {items.length}</div>
          <div className="mt-1 font-mono text-[11px] text-slate-500">{asOfLabel}</div>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {items.length ? (
          items.map((item) => (
            <a
              key={`${item.market}-${item.code}`}
              href={item.quoteUrl}
              target="_blank"
              rel="noreferrer"
              className="group grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50 sm:px-5"
            >
              <span
                className={`flex size-7 items-center justify-center rounded font-mono text-xs font-semibold ${
                  item.rank <= 3 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {item.rank}
              </span>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-slate-950">{item.name}</span>
                  <span className="font-mono text-xs text-slate-500">{item.code}</span>
                  <span className="text-xs text-slate-500">{item.industry}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-600">
                  <span>成交 {formatStockHeatAmount(item)}</span>
                  <span>换手 {formatStrictPercent(item.turnoverRate)}</span>
                  <span>量比 {formatMetric(item.volumeRatio)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.signals.map((signal) => (
                    <span
                      key={signal}
                      className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600"
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              </div>

              <div className="min-w-[5.25rem] text-right">
                <div className="font-mono text-sm font-semibold text-slate-950">
                  {item.price.toFixed(2)}
                </div>
                <div
                  className={`mt-1 font-mono text-sm font-semibold ${stockHeatChangeClass(
                    item.changePercent,
                  )}`}
                >
                  {item.changePercent > 0 ? "+" : ""}
                  {item.changePercent.toFixed(2)}%
                </div>
                <span
                  className={`mt-2 inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${stockHeatLevelClass(
                    item.heatLevel,
                  )}`}
                >
                  {item.heatLevel} {item.heatScore.toFixed(0)}
                </span>
              </div>
            </a>
          ))
        ) : (
          <div className="px-4 py-10 text-center text-sm text-slate-500">暂无个股热度数据</div>
        )}
      </div>
    </section>
  );
}

function SectorHeatList({
  title,
  caption,
  sectors,
}: {
  title: string;
  caption: string;
  sectors: StockHeatSector[];
}) {
  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div>
          <h4 className="text-base font-semibold text-slate-950">{title}</h4>
          <p className="mt-1 text-xs leading-5 text-slate-500">{caption}</p>
        </div>
        <span className="shrink-0 font-mono text-xs font-semibold text-slate-700">
          Top {sectors.length}
        </span>
      </div>

      <div className="divide-y divide-slate-100">
        {sectors.length ? (
          sectors.map((sector) => (
            <div
              key={`${sector.market}-${sector.name}`}
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 px-4 py-3.5 sm:px-5"
            >
              <span
                className={`flex size-7 items-center justify-center rounded font-mono text-xs font-semibold ${
                  sector.rank <= 3 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {sector.rank}
              </span>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-slate-950">{sector.name}</span>
                  <span className="font-mono text-xs text-slate-500">
                    {sector.memberCount}只样本
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-600">
                  <span>成交 {formatSectorHeatAmount(sector)}</span>
                  <span>均换手 {formatStrictPercent(sector.averageTurnoverRate)}</span>
                  <span>均量比 {formatMetric(sector.averageVolumeRatio)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span>
                    上涨 {sector.risingStocks} / 下跌 {sector.fallingStocks}
                  </span>
                  <a
                    href={sector.leaderUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-slate-950"
                  >
                    热度股 {sector.leaderName}
                    <ArrowUpRight className="size-3" />
                  </a>
                </div>
              </div>

              <div className="min-w-[5.25rem] text-right">
                <div
                  className={`font-mono text-sm font-semibold ${stockHeatChangeClass(
                    sector.changePercent,
                  )}`}
                >
                  {sector.changePercent > 0 ? "+" : ""}
                  {sector.changePercent.toFixed(2)}%
                </div>
                <div className="mt-1 font-mono text-[11px] text-slate-500">成交加权</div>
                <span
                  className={`mt-2 inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold ${stockHeatLevelClass(
                    sector.heatLevel,
                  )}`}
                >
                  {sector.heatLevel} {sector.heatScore.toFixed(0)}
                </span>
              </div>
            </div>
          ))
        ) : (
          <div className="px-4 py-10 text-center text-sm text-slate-500">暂无板块热度数据</div>
        )}
      </div>
    </section>
  );
}

type HeatOverviewItem = {
  name: string;
  heatScore: number;
  changePercent: number;
};

function HeatOverviewCard({
  market,
  label,
  items,
}: {
  market: string;
  label: string;
  items: HeatOverviewItem[];
}) {
  const topItems = [...items].sort((a, b) => b.heatScore - a.heatScore).slice(0, 5);
  const risingCount = items.filter((item) => item.changePercent > 0).length;
  const fallingCount = items.filter((item) => item.changePercent < 0).length;
  const total = Math.max(items.length, 1);
  const risingWidth = (risingCount / total) * 100;
  const fallingWidth = (fallingCount / total) * 100;

  return (
    <section className="finance-panel overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3.5 sm:px-5">
        <div>
          <div className="text-[11px] font-semibold uppercase text-slate-500">{market}</div>
          <h3 className="mt-1 text-sm font-semibold text-slate-950">{label}</h3>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-semibold text-slate-950">
            {topItems[0]?.heatScore.toFixed(0) ?? "N/A"}
          </div>
          <div className="text-[11px] text-slate-500">最高热度</div>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5">
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>上涨 {risingCount}</span>
            <span>下跌 {fallingCount}</span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-sm bg-slate-100" aria-label={`${market}涨跌广度`}>
            <span className="bg-red-500" style={{ width: `${risingWidth}%` }} />
            <span className="bg-emerald-500" style={{ width: `${fallingWidth}%` }} />
          </div>
        </div>

        <div className="space-y-3">
          {topItems.length ? (
            topItems.map((item, index) => (
              <div key={`${market}-${item.name}`} className="grid grid-cols-[1.25rem_minmax(0,1fr)_2.5rem] items-center gap-2.5">
                <span className="font-mono text-[11px] text-slate-400">{index + 1}</span>
                <div className="min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-medium text-slate-700">{item.name}</span>
                    <span className={`font-mono text-[11px] ${stockHeatChangeClass(item.changePercent)}`}>
                      {item.changePercent > 0 ? "+" : ""}{item.changePercent.toFixed(2)}%
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-sm bg-slate-100">
                    <span
                      className="block h-full bg-sky-500"
                      style={{ width: `${Math.max(4, Math.min(100, item.heatScore))}%` }}
                    />
                  </div>
                </div>
                <span className="text-right font-mono text-xs font-semibold text-slate-700">
                  {item.heatScore.toFixed(0)}
                </span>
              </div>
            ))
          ) : (
            <div className="py-6 text-center text-sm text-slate-500">等待热度数据</div>
          )}
        </div>
      </div>
    </section>
  );
}

function MarketHeatOverview({
  snapshot,
  mode,
}: {
  snapshot: StockHeatSnapshot | null;
  mode: Exclude<MarketHeatMode, "events">;
}) {
  const aShareItems = mode === "stocks" ? snapshot?.aShares ?? [] : snapshot?.aShareSectors ?? [];
  const usItems = mode === "stocks" ? snapshot?.usStocks ?? [] : snapshot?.usStockSectors ?? [];
  const label = mode === "stocks" ? "个股热度分布" : "板块热度分布";

  return (
    <div className="mb-5 grid gap-4 lg:grid-cols-2">
      <HeatOverviewCard market="A SHARE" label={label} items={aShareItems} />
      <HeatOverviewCard market="US EQUITY" label={label} items={usItems} />
    </div>
  );
}

function StockHeatPanel({
  snapshot,
  isLoading,
  message,
}: {
  snapshot: StockHeatSnapshot | null;
  isLoading: boolean;
  message: string | null;
}) {
  const statusLabel =
    snapshot?.status === "dynamic"
      ? "动态更新"
      : snapshot?.status === "partial"
        ? "部分更新"
        : snapshot?.status === "cached"
          ? "上次数据"
          : "待更新";
  const statusClass =
    snapshot?.status === "dynamic"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : snapshot?.status === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-white text-slate-600";

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <Flame className="size-3.5" />
            个股交易热度
          </div>
          <h2 className="text-xl font-semibold text-slate-950">A股 / 美股 个股热度</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            从成交额靠前的活跃样本中，综合量比、换手率、涨跌幅和盘中振幅，突出交易异动最明显的个股。
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <span
            className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-xs font-semibold ${statusClass}`}
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            {statusLabel}
          </span>
          <div className="font-mono text-xs text-slate-500">
            {snapshot?.updatedAtLabel ?? "待更新"}
          </div>
        </div>
      </div>

      {message ?? snapshot?.message ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <RefreshCw className={`size-4 text-emerald-600 ${isLoading ? "animate-spin" : ""}`} />
          {message ?? snapshot?.message}
        </div>
      ) : null}

      <MarketHeatOverview snapshot={snapshot} mode="stocks" />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <StockHeatList
          title="A股热度"
          caption="沪深京成交活跃样本独立排名"
          items={snapshot?.aShares ?? []}
          asOfLabel={snapshot?.aShareAsOfLabel ?? "待更新"}
        />
        <StockHeatList
          title="美股热度"
          caption="纽交所、纳斯达克及美交所成交活跃样本"
          items={snapshot?.usStocks ?? []}
          asOfLabel={snapshot?.usStockAsOfLabel ?? "待更新"}
        />
      </div>
    </section>
  );
}

function SectorHeatPanel({
  snapshot,
  isLoading,
  message,
}: {
  snapshot: StockHeatSnapshot | null;
  isLoading: boolean;
  message: string | null;
}) {
  const statusLabel =
    snapshot?.status === "dynamic"
      ? "动态更新"
      : snapshot?.status === "partial"
        ? "部分更新"
        : snapshot?.status === "cached"
          ? "上次数据"
          : "待更新";
  const statusClass =
    snapshot?.status === "dynamic"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : snapshot?.status === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-white text-slate-600";

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <Layers3 className="size-3.5" />
            行业板块热度
          </div>
          <h2 className="text-xl font-semibold text-slate-950">A股 / 美股 板块热度</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            按活跃股票样本聚合成交额、涨跌、换手、量比和上涨家数。
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <span
            className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-xs font-semibold ${statusClass}`}
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            {statusLabel}
          </span>
          <div className="font-mono text-xs text-slate-500">
            {snapshot?.updatedAtLabel ?? "待更新"}
          </div>
        </div>
      </div>

      {message ?? snapshot?.message ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <RefreshCw className={`size-4 text-emerald-600 ${isLoading ? "animate-spin" : ""}`} />
          {message ?? snapshot?.message}
        </div>
      ) : null}

      <MarketHeatOverview snapshot={snapshot} mode="sectors" />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <SectorHeatList
          title="A股热门板块"
          caption="沪深京活跃个股所属行业"
          sectors={snapshot?.aShareSectors ?? []}
        />
        <SectorHeatList
          title="美股热门板块"
          caption="纽交所、纳斯达克及美交所行业"
          sectors={snapshot?.usStockSectors ?? []}
        />
      </div>
    </section>
  );
}

function formatProbability(value: number | null | undefined) {
  if (value == null) return "N/A";
  return `${(value * 100).toFixed(value >= 0.1 ? 1 : 2)}%`;
}

function formatProbabilityChange(value: number | null | undefined) {
  if (value == null) return "N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}pp`;
}

function probabilityChangeClass(value: number | null | undefined) {
  if (value == null) return "text-slate-500";
  if (value > 0) return "text-red-600";
  if (value < 0) return "text-emerald-700";
  return "text-slate-500";
}

function polymarketCategoryClass(category: PolymarketHotItem["category"]) {
  if (category === "宏观利率") return "border-sky-200 bg-sky-50 text-sky-700";
  if (category === "地缘风险") return "border-amber-200 bg-amber-50 text-amber-700";
  if (category === "科技/AI") return "border-violet-200 bg-violet-50 text-violet-700";
  if (category === "加密资产") return "border-orange-200 bg-orange-50 text-orange-700";
  if (category === "中国相关") return "border-red-200 bg-red-50 text-red-700";
  if (category === "政治选举") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (category === "体育娱乐") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-slate-200 bg-white text-slate-600";
}

function PolymarketHotCard({ item, rank }: { item: PolymarketHotItem; rank: number }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="group block rounded-md border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded bg-slate-900 font-mono text-xs font-semibold text-white">
              {rank}
            </span>
            <span
              className={`rounded border px-2 py-1 text-xs font-semibold ${polymarketCategoryClass(
                item.category,
              )}`}
            >
              {item.category}
            </span>
            <span className="font-mono text-xs text-slate-500">
              截止 {item.endDateLabel}
            </span>
          </div>
          <h3 className="text-sm font-semibold leading-6 text-slate-950">{item.title}</h3>
        </div>
        <ArrowUpRight className="mt-1 size-4 shrink-0 text-slate-400 transition-colors group-hover:text-slate-900" />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-slate-500">当前概率</div>
          <div className="mt-1 text-sm font-semibold text-slate-950">{item.probabilityLabel}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">24h变化</div>
          <div className={`mt-1 font-mono text-sm font-semibold ${probabilityChangeClass(item.change24h)}`}>
            {formatProbabilityChange(item.change24h)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">24h成交</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-950">
            {formatUsdAmount(item.volume24h)}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">流动性</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-950">
            {formatUsdAmount(item.liquidity)}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-[1.1fr_0.9fr]">
        <div className="text-sm leading-6 text-slate-700">{item.summary}</div>
        <div className="space-y-2 text-xs text-slate-600">
          <div className="flex flex-wrap gap-1.5">
            {item.marketImpact.map((impact) => (
              <span key={impact} className="rounded border border-slate-200 bg-white px-2 py-1">
                {impact}
              </span>
            ))}
          </div>
          <div className="leading-5 text-slate-500">{item.riskFocus}</div>
        </div>
      </div>
    </a>
  );
}

function PolymarketCompactList({
  title,
  items,
}: {
  title: string;
  items: PolymarketHotItem[];
}) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <span className="font-mono text-xs text-slate-500">Top {items.length}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {items.length ? (
          items.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="line-clamp-2 font-medium leading-5 text-slate-950">{item.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{item.category}</span>
                  <span>{formatUsdAmount(item.volume24h)}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono font-semibold text-slate-950">
                  {formatProbability(item.probability)}
                </div>
                <div className={`mt-1 font-mono text-xs ${probabilityChangeClass(item.change24h)}`}>
                  {formatProbabilityChange(item.change24h)}
                </div>
              </div>
            </a>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
            暂无数据
          </div>
        )}
      </div>
    </section>
  );
}

function PolymarketHotPanel({
  snapshot,
  isLoading,
  message,
}: {
  snapshot: PolymarketHotSnapshot | null;
  isLoading: boolean;
  message: string | null;
}) {
  const items = snapshot?.items ?? [];
  const marketRelevant = snapshot?.marketRelevant ?? [];
  const movers = snapshot?.movers ?? [];
  const totalVolume24h = items.reduce((sum, item) => sum + (item.volume24h ?? 0), 0);
  const biggestMover = movers[0];

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <Activity className="size-3.5" />
            Polymarket 热点雷达
          </div>
          <h2 className="text-xl font-semibold text-slate-950">全球预测市场热度</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            按成交额、流动性、赔率变化和财经相关性筛选，优先标出可能影响利率、科技股、港股、A股、黄金、原油和加密资产的事件。
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <span
            className={`inline-flex items-center gap-2 rounded border px-3 py-1.5 text-xs font-semibold ${
              snapshot?.status === "dynamic"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : snapshot?.status === "cached"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
            {snapshot?.status === "dynamic"
              ? "动态更新"
              : snapshot?.status === "cached"
                ? "上次数据"
                : "待更新"}
          </span>
          <div className="font-mono text-xs text-slate-500">
            {snapshot?.updatedAtLabel ?? "待更新"}
          </div>
        </div>
      </div>

      {message ?? snapshot?.message ? (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          <RefreshCw className={`size-4 text-emerald-600 ${isLoading ? "animate-spin" : ""}`} />
          {message ?? snapshot?.message}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">热点事件</div>
          <div className="mt-2 font-mono text-3xl font-semibold text-slate-950">
            {items.length}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">财经相关</div>
          <div className="mt-2 font-mono text-3xl font-semibold text-slate-950">
            {marketRelevant.length}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">24h成交</div>
          <div className="mt-2 font-mono text-3xl font-semibold text-slate-950">
            {formatUsdAmount(totalVolume24h)}
          </div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">最大异动</div>
          <div
            className={`mt-2 font-mono text-3xl font-semibold ${probabilityChangeClass(
              biggestMover?.change24h,
            )}`}
          >
            {formatProbabilityChange(biggestMover?.change24h)}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-3">
          {items.length ? (
            items.slice(0, 12).map((item, index) => (
              <PolymarketHotCard key={item.id} item={item} rank={index + 1} />
            ))
          ) : (
            <div className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
              暂无 Polymarket 热点数据
            </div>
          )}
        </div>
        <div className="space-y-5">
          <PolymarketCompactList title="市场相关" items={marketRelevant.slice(0, 8)} />
          <PolymarketCompactList title="赔率异动" items={movers.slice(0, 8)} />
        </div>
      </div>
    </section>
  );
}

function formatEtfPrice(value: number | null | undefined) {
  if (value == null) return "N/A";
  return value.toFixed(3);
}

function formatRealtimeEstimate(value: number | null | undefined) {
  if (value == null) return "N/A";
  return value.toFixed(4);
}

function formatShares(value: number | null | undefined) {
  if (value == null) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 100000000) return `${(abs / 100000000).toFixed(abs >= 10000000000 ? 1 : 2)}亿份`;
  if (abs >= 10000) return `${(abs / 10000).toFixed(abs >= 10000000 ? 0 : 1)}万份`;
  return `${abs.toFixed(0)}份`;
}

function shareChangeLabel(value: number | null | undefined) {
  if (value == null) return "待累计";
  if (value > 0) return "净申购";
  if (value < 0) return "净赎回";
  return "无变化";
}

type ClientShareSnapshot = {
  date: string;
  totalShares: number;
  sourceTime: string | null;
  recordedAt: string;
};

type ClientShareSnapshotFile = Record<string, ClientShareSnapshot[]>;

const qdiiShareSnapshotStorageKey = "finance-news-dashboard:qdii-share-snapshots:v1";

function readClientShareSnapshots(): ClientShareSnapshotFile {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(qdiiShareSnapshotStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ClientShareSnapshotFile) : {};
  } catch {
    return {};
  }
}

function writeClientShareSnapshots(file: ClientShareSnapshotFile) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(qdiiShareSnapshotStorageKey, JSON.stringify(file));
  } catch {
    // Browser storage may be disabled; server snapshots still work when available.
  }
}

function latestClientShareSnapshot(snapshots: ClientShareSnapshot[]) {
  return [...snapshots].sort(
    (a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt),
  )[0] ?? null;
}

function latestPreviousClientShareSnapshot(snapshots: ClientShareSnapshot[], date: string) {
  return snapshots
    .filter((snapshot) => snapshot.date < date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt))[0] ?? null;
}

function upsertClientShareSnapshot(
  file: ClientShareSnapshotFile,
  code: string,
  quote: QdiiEtfQuote,
) {
  if (quote.totalShares == null || !quote.totalSharesDate) return;

  const snapshots = file[code] ?? [];
  file[code] = snapshots
    .filter((snapshot) => snapshot.date !== quote.totalSharesDate)
    .concat({
      date: quote.totalSharesDate,
      totalShares: quote.totalShares,
      sourceTime: quote.totalSharesTime,
      recordedAt: quote.updatedAt,
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt))
    .slice(-120);
}

function enrichQdiiQuotesWithClientSnapshots(quotes: Record<string, QdiiEtfQuote>) {
  const file = readClientShareSnapshots();
  const nextQuotes: Record<string, QdiiEtfQuote> = {};
  let shouldWrite = false;

  for (const [code, quote] of Object.entries(quotes)) {
    const snapshots = file[code] ?? [];
    let nextQuote = quote;

    if (quote.totalShares != null && quote.totalSharesDate) {
      const previous = latestPreviousClientShareSnapshot(snapshots, quote.totalSharesDate);

      if (!quote.previousTotalSharesDate && previous) {
        const netShareChange = quote.totalShares - previous.totalShares;
        nextQuote = {
          ...quote,
          previousTotalShares: previous.totalShares,
          previousTotalSharesDate: previous.date,
          netShareChange,
          netShareChangePct:
            previous.totalShares > 0 ? (netShareChange / previous.totalShares) * 100 : null,
          shareChangeSource: quote.shareChangeSource ?? "浏览器本地总份额快照",
          shareSnapshotNote: `对比浏览器本地 ${previous.date} 总份额快照`,
        };
      }

      upsertClientShareSnapshot(file, code, quote);
      shouldWrite = true;
    } else {
      const latest = latestClientShareSnapshot(snapshots);
      if (latest) {
        nextQuote = {
          ...quote,
          totalShares: latest.totalShares,
          totalSharesDate: latest.date,
          totalSharesTime: latest.sourceTime,
          shareChangeSource: quote.shareChangeSource ?? "浏览器本地总份额快照",
          shareSnapshotNote: `使用浏览器本地 ${latest.date} 总份额快照`,
        };
      }
    }

    nextQuotes[code] = nextQuote;
  }

  if (shouldWrite) {
    writeClientShareSnapshots(file);
  }

  return nextQuotes;
}

function metricClass(value: number | null | undefined) {
  if (value == null) return "text-slate-500";
  if (value > 0) return "text-red-700";
  if (value < 0) return "text-emerald-700";
  return "text-slate-700";
}

function subscriptionStatusClass(status: string | null | undefined) {
  if (!status) return "border-slate-200 bg-slate-50 text-slate-600";
  if (status.includes("开放")) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status.includes("限")) return "border-amber-200 bg-amber-50 text-amber-700";
  if (status.includes("未披露")) return "border-slate-200 bg-slate-50 text-slate-600";
  if (/暂停|停止|封闭|终止/.test(status)) return "border-red-200 bg-red-50 text-red-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function displaySubscriptionStatus(status: string | null | undefined) {
  if (!status) return "待更新";
  if (status === "场内交易") return "申购未披露";
  return status;
}

function shortTradeStatus(status: string | null | undefined) {
  if (!status) return "N/A";
  return status.replace("场内交易", "场内");
}

function secondaryMarketStatus(status: string | null | undefined) {
  if (status === "场内交易") return "场内可交易";
  return `赎回 ${shortTradeStatus(status)}`;
}

function QdiiEtfCard({
  item,
  quote,
}: {
  item: QdiiEtfGroup["items"][number];
  quote: QdiiEtfQuote | undefined;
}) {
  return (
    <article className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold text-slate-950">{item.code}</div>
          <div className="mt-1 truncate text-sm font-semibold text-slate-950">{item.name}</div>
          <div className="mt-0.5 text-xs text-slate-500">{item.manager}</div>
        </div>
        <span
          className={`shrink-0 rounded border px-2 py-1 text-xs font-semibold ${subscriptionStatusClass(
            displaySubscriptionStatus(quote?.subscriptionStatus),
          )}`}
        >
          {displaySubscriptionStatus(quote?.subscriptionStatus)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div>
          <div className="text-slate-500">现价</div>
          <div className={`mt-1 font-mono text-sm font-semibold ${metricClass(quote?.changePct)}`}>
            {formatEtfPrice(quote?.price)}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-500">
            {formatCompactDateTime(quote?.priceTime ?? quote?.priceDate)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">涨跌幅</div>
          <div className={`mt-1 font-mono text-sm font-semibold ${metricClass(quote?.changePct)}`}>
            {formatMetric(quote?.changePct ?? null, "%")}
          </div>
        </div>
        <div>
          <div className="text-slate-500">实时估值</div>
          <div className="mt-1 font-mono text-sm font-semibold text-slate-950">
            {formatRealtimeEstimate(quote?.nav)}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-500">
            {formatCompactDateTime(quote?.navTime)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">溢价率</div>
          <div className={`mt-1 font-mono text-sm font-semibold ${metricClass(quote?.premiumRate)}`}>
            {formatMetric(quote?.premiumRate ?? null, "%")}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 text-xs sm:grid-cols-2">
        <div>
          <div className="text-slate-500">份额 / 净申赎</div>
          <div className="mt-1 font-mono font-semibold text-slate-950">
            {formatShares(quote?.totalShares)}
            {quote?.totalSharesDate ? (
              <span className="ml-2 font-normal text-slate-500">
                {formatShortDate(quote.totalSharesDate)}
              </span>
            ) : null}
          </div>
          <div className={`mt-1 font-semibold ${metricClass(quote?.netShareChange)}`}>
            {shareChangeLabel(quote?.netShareChange)}{" "}
            <span className="font-mono">
              {quote?.netShareChange == null ? "首次记录" : formatShares(quote.netShareChange)}
            </span>
          </div>
        </div>
        <div>
          <div className="text-slate-500">申购限制</div>
          <div className="mt-1 font-mono font-semibold text-slate-950">
            日笔数 {quote?.dailySubscriptionCount ?? "暂无披露"}
          </div>
          <div className="mt-1 font-mono font-semibold text-slate-950">
            日额度 {quote?.dailySubscriptionLimit ?? "暂无披露"}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <div>
          <span className="font-semibold text-slate-800">{item.tracking}</span>
          <span className="ml-2">{item.market}</span>
        </div>
        <div className="font-mono">成交额 {formatAmount(quote?.amount)}</div>
      </div>
    </article>
  );
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
            这些是 A 股场内可交易的跨境 ETF/QDII 代表产品。价格和涨跌幅来自东方财富，实时估值优先使用东方财富移动端口径；溢价率按场内现价相对实时估值计算。总份额来自东方财富行情快照，净申赎按本地历史快照差额估算。
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

      <div className="grid min-w-0 gap-5">
        {groups.map((group) => (
          <section
            key={group.id}
            className="min-w-0 rounded-md border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-950">{group.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{group.description}</p>
              </div>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-600">
                {group.items.length}
              </span>
            </div>

            <div className="grid gap-3 md:hidden">
              {group.items.map((item) => (
                <QdiiEtfCard key={item.code} item={item} quote={quotes[item.code]} />
              ))}
            </div>

            <div className="hidden overflow-hidden rounded-md border border-slate-200 md:block">
              <table className="w-full table-fixed border-collapse text-left text-xs">
                <colgroup>
                  <col className="w-[6%]" />
                  <col className="w-[10%]" />
                  <col className="w-[8%]" />
                  <col className="w-[6%]" />
                  <col className="w-[9%]" />
                  <col className="w-[7%]" />
                  <col className="w-[13%]" />
                  <col className="w-[15%]" />
                  <col className="w-[7%]" />
                  <col className="w-[19%]" />
                </colgroup>
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-semibold">代码</th>
                    <th className="px-2 py-2 font-semibold">名称</th>
                    <th className="py-2 pl-2 pr-4 text-right font-semibold">现价/日期</th>
                    <th className="px-2 py-2 text-right font-semibold">涨跌幅</th>
                    <th className="py-2 pl-2 pr-4 text-right font-semibold">实时估值</th>
                    <th className="py-2 pl-2 pr-4 text-right font-semibold">溢价率</th>
                    <th className="px-2 py-2 font-semibold">份额/净申赎</th>
                    <th className="px-2 py-2 font-semibold">申购限制</th>
                    <th className="py-2 pl-2 pr-4 text-right font-semibold">成交额</th>
                    <th className="px-2 py-2 font-semibold">跟踪</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {group.items.map((item) => {
                    const quote = quotes[item.code];
                    return (
                      <tr key={item.code} className="align-top hover:bg-slate-50">
                        <td className="whitespace-nowrap px-2 py-2 font-mono font-semibold text-slate-950">
                          {item.code}
                        </td>
                        <td className="px-2 py-2">
                          <div className="whitespace-nowrap font-medium text-slate-950">
                            {item.name}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{item.manager}</div>
                        </td>
                        <td
                          className={`py-2 pl-2 pr-4 text-right font-mono ${metricClass(
                            quote?.changePct,
                          )}`}
                        >
                          <div>{formatEtfPrice(quote?.price)}</div>
                          {quote?.priceTime || quote?.priceDate ? (
                            <div className="mt-1 whitespace-nowrap text-[11px] text-slate-500">
                              {formatCompactDateTime(quote.priceTime ?? quote.priceDate)}
                            </div>
                          ) : null}
                        </td>
                        <td
                          className={`px-2 py-2 text-right font-mono ${metricClass(
                            quote?.changePct,
                          )}`}
                        >
                          {formatMetric(quote?.changePct ?? null, "%")}
                        </td>
                        <td className="py-2 pl-2 pr-4 text-right">
                          <div className="font-mono text-slate-950">
                            {formatRealtimeEstimate(quote?.nav)}
                          </div>
                          {quote?.navTime ? (
                            <div className="mt-1 whitespace-nowrap font-mono text-[11px] text-slate-500">
                              {formatCompactDateTime(quote.navTime)}
                            </div>
                          ) : null}
                        </td>
                        <td
                          className={`py-2 pl-2 pr-4 text-right font-mono font-semibold ${metricClass(
                            quote?.premiumRate,
                          )}`}
                        >
                          {formatMetric(quote?.premiumRate ?? null, "%")}
                        </td>
                        <td
                          className="px-2 py-2"
                          title={quote?.shareSnapshotNote ?? quote?.shareChangeSource ?? undefined}
                        >
                          <div className="space-y-1.5 text-xs">
                            <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-1.5">
                              <span className="whitespace-nowrap text-slate-500">总份额</span>
                              <span className="whitespace-nowrap font-mono font-semibold text-slate-950">
                                {formatShares(quote?.totalShares)}
                              </span>
                            </div>
                            {quote?.totalSharesDate ? (
                              <div className="whitespace-nowrap font-mono text-[11px] text-slate-500">
                                {formatShortDate(quote.totalSharesDate)}
                              </div>
                            ) : null}
                            <div
                              className={`grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-1.5 font-semibold ${metricClass(
                                quote?.netShareChange,
                              )}`}
                            >
                              <span className="whitespace-nowrap">
                                {shareChangeLabel(quote?.netShareChange)}
                              </span>
                              <span className="whitespace-nowrap font-mono">
                                {quote?.netShareChange == null
                                  ? "首次记录"
                                  : formatShares(quote.netShareChange)}
                              </span>
                            </div>
                            {quote?.previousTotalSharesDate ? (
                              <div className="whitespace-nowrap text-[11px] text-slate-500">
                                较 {formatShortDate(quote.previousTotalSharesDate)}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td
                          className="px-2 py-2"
                          title={quote?.subscriptionNote ?? quote?.subscriptionSource ?? undefined}
                        >
                          <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex whitespace-nowrap rounded border px-2 py-1 text-xs font-semibold ${subscriptionStatusClass(
                                  displaySubscriptionStatus(quote?.subscriptionStatus),
                                )}`}
                              >
                                {displaySubscriptionStatus(quote?.subscriptionStatus)}
                              </span>
                              {quote?.subscriptionSourceUrl ? (
                                <a
                                  href={quote.subscriptionSourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[11px] text-slate-500 hover:text-slate-950"
                                  title={quote.subscriptionSource ?? "查看申购状态来源"}
                                >
                                  {quote.subscriptionDate ?? "东财"}
                                  <ArrowUpRight className="size-3" />
                                </a>
                              ) : null}
                            </div>
                            <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-1.5 text-xs">
                              <span className="whitespace-nowrap text-slate-500">日笔数</span>
                              <span className="whitespace-nowrap font-mono font-semibold text-slate-950">
                                {quote?.dailySubscriptionCount ?? "暂无披露"}
                              </span>
                            </div>
                            <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-1.5 text-xs">
                              <span className="whitespace-nowrap text-slate-500">日额度</span>
                              <span className="whitespace-nowrap font-mono font-semibold text-slate-950">
                                {quote?.dailySubscriptionLimit ?? "暂无披露"}
                              </span>
                            </div>
                            <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-1.5 text-xs text-slate-500">
                              <span className="whitespace-nowrap">
                                {secondaryMarketStatus(quote?.redemptionStatus)}
                              </span>
                              {quote?.subscriptionMinAmount ? (
                                <span className="whitespace-nowrap">
                                  起点 {quote.subscriptionMinAmount}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 pl-2 pr-4 text-right font-mono text-slate-700">
                          {formatAmount(quote?.amount)}
                        </td>
                        <td className="px-2 py-2">
                          <div className="text-slate-700">{item.tracking}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.market}</div>
                          <div className="mt-1 max-h-10 overflow-hidden text-xs leading-5 text-slate-500">
                            {item.note}
                          </div>
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
  const [valuations, setValuations] = useState(initialValuations);
  const [activeView, setActiveView] = useState<DashboardView>("report");
  const [dashboardTheme, setDashboardTheme] = useState<DashboardTheme>("light");
  const [hasRefreshedValuations, setHasRefreshedValuations] = useState(false);
  const [hasRefreshedQdii, setHasRefreshedQdii] = useState(false);
  const [isValuationLoading, setIsValuationLoading] = useState(false);
  const [valuationMessage, setValuationMessage] = useState<string | null>(
    initialValuations.message ?? null,
  );
  const [qdiiQuotes, setQdiiQuotes] = useState<Record<string, QdiiEtfQuote>>({});
  const [isQdiiLoading, setIsQdiiLoading] = useState(false);
  const [isQdiiShareLoading, setIsQdiiShareLoading] = useState(false);
  const [qdiiMessage, setQdiiMessage] = useState<string | null>(null);
  const [dividendSnapshot, setDividendSnapshot] = useState<AshareDividendSnapshot | null>(null);
  const [isDividendLoading, setIsDividendLoading] = useState(false);
  const [dividendMessage, setDividendMessage] = useState<string | null>(null);
  const [marketHeatMode, setMarketHeatMode] = useState<MarketHeatMode>("stocks");
  const [stockHeatSnapshot, setStockHeatSnapshot] = useState<StockHeatSnapshot | null>(null);
  const [isStockHeatLoading, setIsStockHeatLoading] = useState(false);
  const [stockHeatMessage, setStockHeatMessage] = useState<string | null>(null);
  const [polymarketSnapshot, setPolymarketSnapshot] = useState<PolymarketHotSnapshot | null>(null);
  const [isPolymarketLoading, setIsPolymarketLoading] = useState(false);
  const [polymarketMessage, setPolymarketMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);
  const [autoRefreshMessage, setAutoRefreshMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalItems = useMemo(
    () => sourceOrder.reduce((sum, source) => sum + report.sources[source].length, 0),
    [report],
  );

  const switchView = useCallback((view: DashboardView) => {
    setActiveView(view);

    if (typeof window === "undefined") return;

    const href =
      view === "polymarket" ? marketHeatModeHref(marketHeatMode) : dashboardViewHref(view);
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (currentHref !== href) {
      window.history.pushState(null, "", href);
    }
  }, [marketHeatMode]);

  const switchMarketHeatMode = useCallback((mode: MarketHeatMode) => {
    setMarketHeatMode(mode);

    if (typeof window === "undefined") return;

    const href = marketHeatModeHref(mode);
    const currentHref = `${window.location.pathname}${window.location.search}`;
    if (currentHref !== href) {
      window.history.pushState(null, "", href);
    }
  }, []);

  const handleViewLinkClick = useCallback(
    (view: DashboardView) => (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      switchView(view);
    },
    [switchView],
  );

  const selectDashboardTheme = useCallback((nextTheme: DashboardTheme) => {
    setDashboardTheme(nextTheme);
    window.localStorage.setItem(dashboardThemeStorageKey, nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  const toggleDashboardTheme = useCallback(() => {
    selectDashboardTheme(dashboardTheme === "light" ? "dark" : "light");
  }, [dashboardTheme, selectDashboardTheme]);

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

  const refreshQdiiShareSnapshots = useCallback(async () => {
    if (isQdiiShareLoading) return;

    setIsQdiiShareLoading(true);
    setQdiiMessage("QDII 价格已显示，正在后台补充总份额快照...");

    try {
      const response = await fetch("/api/qdii/quotes?refreshShares=1", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`总份额快照更新失败：${response.status}`);
      }
      const data = (await response.json()) as {
        quotes: Record<string, QdiiEtfQuote>;
      };
      setQdiiQuotes(enrichQdiiQuotesWithClientSnapshots(data.quotes));
      setQdiiMessage("QDII 总份额已补充；首次记录表示当前设备或服务端还没有上一条快照。");
    } catch (err) {
      const message = err instanceof Error ? err.message : "总份额快照更新失败";
      setQdiiMessage(`${message}，价格和溢价率不受影响`);
    } finally {
      setIsQdiiShareLoading(false);
    }
  }, [isQdiiShareLoading]);

  const refreshQdiiQuotes = useCallback(async () => {
    setIsQdiiLoading(true);
    setHasRefreshedQdii(true);
    setQdiiMessage("正在快速更新 QDII 价格、溢价率和申购状态...");

    try {
      const response = await fetch("/api/qdii/quotes", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`QDII 行情更新失败：${response.status}`);
      }
      const data = (await response.json()) as {
        quotes: Record<string, QdiiEtfQuote>;
        cached?: boolean;
      };
      const quotes = enrichQdiiQuotesWithClientSnapshots(data.quotes);
      const needsShareRefresh = Object.values(quotes).some(
        (quote) =>
          quote.totalShares == null ||
          quote.totalSharesDate == null ||
          (quote.priceDate != null &&
            quote.totalSharesDate != null &&
            quote.totalSharesDate < quote.priceDate),
      );
      setQdiiQuotes(quotes);
      setQdiiMessage(
        data.cached
          ? "QDII 已快速显示最近快照，正在后台更新实时行情..."
          : needsShareRefresh
            ? "QDII 价格、溢价率和申购状态已更新；总份额在后台补充"
            : "QDII 价格、溢价率和申购状态已更新，总份额使用快照",
      );
      if (data.cached) {
        window.setTimeout(() => {
          void (async () => {
            try {
              const liveResponse = await fetch("/api/qdii/quotes?live=1", {
                cache: "no-store",
              });
              if (!liveResponse.ok) {
                throw new Error(`实时行情更新失败：${liveResponse.status}`);
              }
              const liveData = (await liveResponse.json()) as {
                quotes: Record<string, QdiiEtfQuote>;
              };
              const liveQuotes = enrichQdiiQuotesWithClientSnapshots(liveData.quotes);
              const liveNeedsShareRefresh = Object.values(liveQuotes).some(
                (quote) =>
                  quote.totalShares == null ||
                  quote.totalSharesDate == null ||
                  (quote.priceDate != null &&
                    quote.totalSharesDate != null &&
                    quote.totalSharesDate < quote.priceDate),
              );
              setQdiiQuotes(liveQuotes);
              setQdiiMessage(
                liveNeedsShareRefresh
                  ? "QDII 实时行情已更新；总份额在后台补充"
                  : "QDII 实时行情已更新，总份额使用快照",
              );
              if (liveNeedsShareRefresh) {
                window.setTimeout(() => {
                  void refreshQdiiShareSnapshots();
                }, 0);
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : "实时行情更新失败";
              setQdiiMessage(`已显示最近快照；${message}`);
            }
          })();
        }, 0);
        return;
      }
      if (needsShareRefresh) {
        window.setTimeout(() => {
          void refreshQdiiShareSnapshots();
        }, 0);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "QDII 行情更新失败";
      setQdiiMessage(`${message}，已保留列表结构`);
    } finally {
      setIsQdiiLoading(false);
    }
  }, [refreshQdiiShareSnapshots]);

  async function refreshValuations(force = false) {
    setIsValuationLoading(true);
    setHasRefreshedValuations(true);
    setValuationMessage("正在更新全球指数估值...");

    try {
      const response = await fetch(`/api/valuations/latest${force ? "?refresh=1" : ""}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`估值雷达更新失败：${response.status}`);
      }
      const data = (await response.json()) as GlobalValuationSnapshot;
      setValuations(data);
      setValuationMessage(data.message ?? "全球指数估值已更新");
    } catch (err) {
      const message = err instanceof Error ? err.message : "估值雷达更新失败";
      setValuationMessage(`${message}，已保留当前估值表`);
    } finally {
      setIsValuationLoading(false);
    }
  }

  async function refreshDividendStocks(force = false) {
    setIsDividendLoading(true);
    setDividendMessage(`正在更新 A 股股息率高于 ${ashareDividendMinimumYield}% 的公司...`);

    try {
      const response = await fetch(`/api/a-share/dividends${force ? "?refresh=1" : ""}`, {
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

  async function refreshPolymarketHotspots() {
    setIsPolymarketLoading(true);
    setPolymarketMessage("正在更新 Polymarket 热点...");

    try {
      const response = await fetch("/api/polymarket/hot");
      if (!response.ok) {
        throw new Error(`Polymarket 热点更新失败：${response.status}`);
      }
      const data = (await response.json()) as PolymarketHotSnapshot;
      setPolymarketSnapshot(data);
      setPolymarketMessage(data.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Polymarket 热点更新失败";
      setPolymarketMessage(`${message}，不影响其他栏目使用`);
    } finally {
      setIsPolymarketLoading(false);
    }
  }

  async function refreshStockHeat() {
    setIsStockHeatLoading(true);
    setStockHeatMessage("正在更新 A 股和美股热度...");

    try {
      const response = await fetch("/api/market/stock-heat");
      if (!response.ok) {
        throw new Error(`个股热度更新失败：${response.status}`);
      }
      const data = (await response.json()) as StockHeatSnapshot;
      setStockHeatSnapshot(data);
      setStockHeatMessage(data.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : "个股热度更新失败";
      setStockHeatMessage(`${message}，已保留当前榜单`);
    } finally {
      setIsStockHeatLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshReport("auto");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const syncViewFromUrl = () => {
      setActiveView(readDashboardViewFromLocation());
      setMarketHeatMode(readMarketHeatModeFromLocation());
    };

    syncViewFromUrl();
    window.addEventListener("popstate", syncViewFromUrl);
    return () => window.removeEventListener("popstate", syncViewFromUrl);
  }, []);

  useEffect(() => {
    const preferredTheme = readDashboardTheme();
    document.documentElement.dataset.theme = preferredTheme;

    const timer = window.setTimeout(() => setDashboardTheme(preferredTheme), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (activeView !== "valuation" || hasRefreshedValuations || isValuationLoading) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshValuations();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeView, hasRefreshedValuations, isValuationLoading]);

  useEffect(() => {
    if (
      activeView !== "qdii" ||
      hasRefreshedQdii ||
      Object.keys(qdiiQuotes).length > 0 ||
      isQdiiLoading
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshQdiiQuotes();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeView, hasRefreshedQdii, isQdiiLoading, qdiiQuotes, refreshQdiiQuotes]);

  useEffect(() => {
    if (activeView !== "dividends" || dividendSnapshot || isDividendLoading) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshDividendStocks();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeView, dividendSnapshot, isDividendLoading]);

  useEffect(() => {
    if (
      activeView !== "polymarket" ||
      marketHeatMode === "events" ||
      stockHeatSnapshot ||
      isStockHeatLoading
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshStockHeat();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeView, marketHeatMode, stockHeatSnapshot, isStockHeatLoading]);

  useEffect(() => {
    if (
      activeView !== "polymarket" ||
      marketHeatMode !== "events" ||
      polymarketSnapshot ||
      isPolymarketLoading
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshPolymarketHotspots();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeView, marketHeatMode, polymarketSnapshot, isPolymarketLoading]);

  const activeTimestamp =
    activeView === "report"
      ? report.generatedAtLabel
      : activeView === "dividends"
        ? dividendSnapshot?.updatedAtLabel ?? "待更新"
        : activeView === "polymarket"
          ? marketHeatMode !== "events"
            ? stockHeatSnapshot?.updatedAtLabel ?? "待更新"
            : polymarketSnapshot?.updatedAtLabel ?? "待更新"
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
            : activeView === "polymarket"
              ? "市场热度"
              : "定投回测器";

  const navItems: DashboardNavItem[] = [
    {
      view: "report",
      label: "财经早报",
      icon: <Rss className="size-3.5" />,
      title: "查看开盘前财经早报",
    },
    {
      view: "polymarket",
      label: "市场热度",
      icon: <Activity className="size-3.5" />,
      title: "查看 A 股、美股和预测市场热点",
    },
    {
      view: "valuation",
      label: "估值雷达",
      icon: <TrendingUp className="size-3.5" />,
      title: "查看全球指数市盈率和估值表",
    },
    {
      view: "qdii",
      label: "QDII ETF",
      icon: <Globe2 className="size-3.5" />,
      title: "查看大陆上市 QDII ETF 价格和溢价率",
    },
    {
      view: "dividends",
      label: "A股股息",
      icon: <BadgePercent className="size-3.5" />,
      title: `查看 A 股股息率高于 ${ashareDividendMinimumYield}% 的公司`,
    },
    {
      view: "dca",
      label: "定投回测",
      icon: <PiggyBank className="size-3.5" />,
      title: "查看定投回测器",
    },
  ];

  return (
    <main
      className="dashboard-shell min-h-screen bg-[#eef2f5] text-slate-950"
      data-theme={dashboardTheme}
    >
      <div className="min-h-screen lg:flex">
        <aside className="hidden h-screen w-52 shrink-0 flex-col border-r border-white/10 bg-[#0b1118] text-white lg:sticky lg:top-0 lg:flex">
          <div className="flex h-20 items-center gap-3 border-b border-white/10 px-4">
            <span className="flex size-9 items-center justify-center rounded-md border border-sky-400/30 bg-sky-400/10 text-sky-300">
              <Gauge className="size-5" />
            </span>
            <div>
              <div className="font-mono text-xs font-semibold text-sky-300">MARKET DESK</div>
              <div className="mt-0.5 text-xs text-slate-400">个人市场终端</div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 px-2.5 py-5" aria-label="主导航">
            {navItems.map((item) => (
              <a
                key={item.view}
                href={dashboardViewHref(item.view)}
                onClick={handleViewLinkClick(item.view)}
                className={`relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors ${
                  activeView === item.view
                    ? "bg-white/10 text-white before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-sky-400"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
                title={item.title}
              >
                <span className={activeView === item.view ? "text-sky-300" : "text-slate-500"}>
                  {item.icon}
                </span>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="border-t border-white/10 p-3">
            <div className="mb-3 flex items-center gap-2 px-2 text-xs text-slate-400">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.55)]" />
              数据工作台
            </div>
            <div
              className="grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-black/20 p-1"
              role="group"
              aria-label="外观模式"
            >
              <button
                type="button"
                onClick={() => selectDashboardTheme("light")}
                aria-pressed={dashboardTheme === "light"}
                className={`inline-flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors ${
                  dashboardTheme === "light"
                    ? "bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/30"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Sun className="size-3.5" />
                浅色
              </button>
              <button
                type="button"
                onClick={() => selectDashboardTheme("dark")}
                aria-pressed={dashboardTheme === "dark"}
                className={`inline-flex h-8 items-center justify-center gap-1.5 rounded text-xs font-medium transition-colors ${
                  dashboardTheme === "dark"
                    ? "bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/30"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Moon className="size-3.5" />
                深色
              </button>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="border-b border-slate-200 bg-white lg:hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-md bg-slate-950 text-sky-300">
                  <Gauge className="size-4" />
                </span>
                <div>
                  <div className="font-mono text-[11px] font-semibold text-slate-950">MARKET DESK</div>
                  <div className="text-[10px] text-slate-500">个人市场终端</div>
                </div>
              </div>
              <button
                type="button"
                onClick={toggleDashboardTheme}
                className="flex size-9 items-center justify-center rounded-md border border-slate-200 text-slate-600"
                title={dashboardTheme === "dark" ? "切换浅色模式" : "切换深色模式"}
              >
                {dashboardTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            </div>
            <nav className="grid grid-cols-3 gap-1 border-t border-slate-200 bg-slate-50 p-2" aria-label="主导航">
              {navItems.map((item) => (
                <a
                  key={item.view}
                  href={dashboardViewHref(item.view)}
                  onClick={handleViewLinkClick(item.view)}
                  className={`inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded px-2 text-[11px] font-semibold transition-colors ${
                    activeView === item.view
                      ? "bg-slate-950 text-white"
                      : "text-slate-600 hover:bg-white hover:text-slate-950"
                  }`}
                  title={item.title}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </a>
              ))}
            </nav>
          </header>

          <div className="workspace-header border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
                  <span className="font-mono text-sky-600">MARKET / {navItems.find((item) => item.view === activeView)?.label}</span>
                  <span className="h-3 w-px bg-slate-300" />
                  <span className="inline-flex items-center gap-1.5 font-mono font-normal">
                    <Clock3 className="size-3.5" />
                    {activeTimestamp}
                  </span>
                </div>
                <h1 className="text-2xl font-semibold tracking-normal text-slate-950 md:text-3xl">
                  {activeTitle}
                </h1>
              </div>

              {activeView === "report" ? (
            <button
              type="button"
              onClick={() => refreshReport("manual")}
              disabled={isRefreshing}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              title="重新抓取三路新闻源并生成最新早报"
            >
              <RefreshCw className={`size-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "刷新中" : "刷新早报"}
            </button>
          ) : activeView === "valuation" ? (
            <button
              type="button"
              onClick={() => refreshValuations(true)}
              disabled={isValuationLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              title="重新拉取全球指数估值数据"
            >
              <RefreshCw className={`size-4 ${isValuationLoading ? "animate-spin" : ""}`} />
              {isValuationLoading ? "更新中" : "刷新估值"}
            </button>
          ) : activeView === "qdii" ? (
            <button
              type="button"
              onClick={refreshQdiiQuotes}
              disabled={isQdiiLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              title="重新拉取 QDII 价格、估算净值和溢价率"
            >
              <RefreshCw
                className={`size-4 ${isQdiiLoading ? "animate-spin" : ""}`}
              />
              {isQdiiLoading ? "更新中" : "刷新 QDII"}
            </button>
          ) : activeView === "dividends" ? (
            <button
              type="button"
              onClick={() => refreshDividendStocks(true)}
              disabled={isDividendLoading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              title={`重新拉取 A 股股息率高于 ${ashareDividendMinimumYield}% 的公司`}
            >
              <RefreshCw className={`size-4 ${isDividendLoading ? "animate-spin" : ""}`} />
              {isDividendLoading ? "更新中" : "刷新股息"}
            </button>
          ) : activeView === "polymarket" ? (
            <button
              type="button"
              onClick={() =>
                marketHeatMode !== "events"
                  ? refreshStockHeat()
                  : refreshPolymarketHotspots()
              }
              disabled={
                marketHeatMode !== "events" ? isStockHeatLoading : isPolymarketLoading
              }
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-400"
              title={
                marketHeatMode !== "events"
                  ? "重新拉取 A 股和美股市场热度"
                  : "重新拉取 Polymarket 热点预测市场"
              }
            >
              <RefreshCw
                className={`size-4 ${
                  marketHeatMode !== "events"
                    ? isStockHeatLoading
                      ? "animate-spin"
                      : ""
                    : isPolymarketLoading
                      ? "animate-spin"
                      : ""
                }`}
              />
              {marketHeatMode !== "events"
                ? isStockHeatLoading
                  ? "更新中"
                  : marketHeatMode === "stocks"
                    ? "刷新股票"
                    : "刷新板块"
                : isPolymarketLoading
                  ? "更新中"
                  : "刷新事件"}
            </button>
              ) : null}
            </div>
          </div>

          <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
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
            <ValuationTable
              snapshot={valuations}
              isLoading={isValuationLoading}
              message={valuationMessage}
            />
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
        ) : activeView === "polymarket" ? (
          <>
            <div
              className="mb-5 inline-flex w-full rounded-md border border-slate-200 bg-white p-1 shadow-sm sm:w-auto"
              role="tablist"
              aria-label="市场热度类型"
            >
              <button
                type="button"
                role="tab"
                aria-selected={marketHeatMode === "stocks"}
                onClick={() => switchMarketHeatMode("stocks")}
                className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded px-2 text-xs font-semibold transition-colors sm:flex-none sm:gap-2 sm:px-4 sm:text-sm ${
                  marketHeatMode === "stocks"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <Flame className="size-4" />
                股票热度
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={marketHeatMode === "sectors"}
                onClick={() => switchMarketHeatMode("sectors")}
                className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded px-2 text-xs font-semibold transition-colors sm:flex-none sm:gap-2 sm:px-4 sm:text-sm ${
                  marketHeatMode === "sectors"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <Layers3 className="size-4" />
                板块热度
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={marketHeatMode === "events"}
                onClick={() => switchMarketHeatMode("events")}
                className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded px-2 text-xs font-semibold transition-colors sm:flex-none sm:gap-2 sm:px-4 sm:text-sm ${
                  marketHeatMode === "events"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <Activity className="size-4" />
                事件预测
              </button>
            </div>

            {marketHeatMode === "stocks" ? (
              <StockHeatPanel
                snapshot={stockHeatSnapshot}
                isLoading={isStockHeatLoading}
                message={stockHeatMessage}
              />
            ) : marketHeatMode === "sectors" ? (
              <SectorHeatPanel
                snapshot={stockHeatSnapshot}
                isLoading={isStockHeatLoading}
                message={stockHeatMessage}
              />
            ) : (
              <PolymarketHotPanel
                snapshot={polymarketSnapshot}
                isLoading={isPolymarketLoading}
                message={polymarketMessage}
              />
            )}
          </>
        ) : (
          <DcaBacktestPanel />
        )}
          </div>
        </div>
      </div>
    </main>
  );
}
