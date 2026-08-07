import { NextRequest, NextResponse } from "next/server";
import {
  createEmptyReport,
  getLatestReport,
  refreshLatestReport,
} from "@/lib/news-report";

export async function GET(request: NextRequest) {
  const refreshRequested = request.nextUrl.searchParams.get("refresh") === "1";
  const shouldRefresh = refreshRequested && process.env.VERCEL !== "1";
  const report =
    (shouldRefresh ? await refreshLatestReport() : await getLatestReport()) ??
    createEmptyReport();
  const responseReport =
    refreshRequested && !shouldRefresh
      ? {
          ...report,
          refreshNotice: "已检查最新缓存；线上早报由定时任务和缓存周期更新。",
        }
      : report;

  return NextResponse.json(responseReport, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
