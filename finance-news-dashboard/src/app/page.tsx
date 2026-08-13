import {
  ReportDashboard,
  type DashboardView,
  type MarketHeatMode,
} from "@/components/report-dashboard";
import type { Metadata } from "next";
import { ashareDividendMinimumYield } from "@/lib/a-share-dividend-config";
import { createGlobalValuationSnapshot } from "@/lib/global-valuations";
import { createEmptyReport, getLatestReport } from "@/lib/news-report";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const dashboardViews = new Set<DashboardView>([
  "report",
  "valuation",
  "qdii",
  "dividends",
  "polymarket",
  "cross-market",
  "dca",
]);
const marketHeatModes = new Set<MarketHeatMode>([
  "stocks",
  "sectors",
  "stock-panorama",
  "sector-panorama",
  "events",
]);

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function parseDashboardParams(searchParams: HomeProps["searchParams"]) {
  const params = await searchParams;
  const viewParam = firstParam(params.view);
  const heatParam = firstParam(params.heat);
  const initialView =
    viewParam && dashboardViews.has(viewParam as DashboardView)
      ? (viewParam as DashboardView)
      : "report";
  const initialMarketHeatMode =
    heatParam === "panorama"
      ? "stock-panorama"
      : heatParam && marketHeatModes.has(heatParam as MarketHeatMode)
        ? (heatParam as MarketHeatMode)
        : "stocks";

  return { initialView, initialMarketHeatMode };
}

function dashboardPageTitle(view: DashboardView) {
  switch (view) {
    case "valuation":
      return "全球指数估值雷达";
    case "qdii":
      return "大陆上市 QDII ETF";
    case "dividends":
      return `A 股股息率 > ${ashareDividendMinimumYield}%`;
    case "polymarket":
      return "市场热度";
    case "cross-market":
      return "中美板块映射";
    case "dca":
      return "定投回测器";
    default:
      return "盘前财经早报";
  }
}

export async function generateMetadata({ searchParams }: HomeProps): Promise<Metadata> {
  const { initialView } = await parseDashboardParams(searchParams);
  return { title: `${dashboardPageTitle(initialView)} | MARKET DESK` };
}

export default async function Home({ searchParams }: HomeProps) {
  const { initialView, initialMarketHeatMode } = await parseDashboardParams(searchParams);
  const report = (await getLatestReport()) ?? createEmptyReport();
  const valuations = createGlobalValuationSnapshot();

  return (
    <ReportDashboard
      initialReport={report}
      initialValuations={valuations}
      initialView={initialView}
      initialMarketHeatMode={initialMarketHeatMode}
    />
  );
}
