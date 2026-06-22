import { ReportDashboard } from "@/components/report-dashboard";
import { createGlobalValuationSnapshot } from "@/lib/global-valuations";
import { createEmptyReport, getLatestReport } from "@/lib/news-report";

export const dynamic = "force-dynamic";

export default async function Home() {
  const report = (await getLatestReport()) ?? createEmptyReport();
  const valuations = createGlobalValuationSnapshot();

  return <ReportDashboard initialReport={report} initialValuations={valuations} />;
}
