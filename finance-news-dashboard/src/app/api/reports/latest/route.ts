import { NextResponse } from "next/server";
import { createEmptyReport, getLatestReport } from "@/lib/news-report";

export async function GET() {
  const report = (await getLatestReport()) ?? createEmptyReport();

  return NextResponse.json(report, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
