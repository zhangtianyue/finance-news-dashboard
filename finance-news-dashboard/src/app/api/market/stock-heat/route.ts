import { NextResponse } from "next/server";
import { fetchStockHeatSnapshot } from "@/lib/stock-heat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET() {
  const snapshot = await fetchStockHeatSnapshot();

  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
