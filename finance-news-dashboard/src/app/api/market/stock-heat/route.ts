import { NextResponse } from "next/server";
import { fetchStockHeatSnapshot } from "@/lib/stock-heat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const snapshot = await fetchStockHeatSnapshot({ force });

  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": force
        ? "no-store"
        : "public, s-maxage=60, stale-while-revalidate=300",
    },
  });
}
