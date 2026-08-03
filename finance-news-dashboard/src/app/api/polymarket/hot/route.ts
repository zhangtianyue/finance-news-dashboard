import { NextResponse } from "next/server";
import { fetchPolymarketHotSnapshot } from "@/lib/polymarket-hot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET() {
  return NextResponse.json(await fetchPolymarketHotSnapshot(), {
    headers: {
      "Cache-Control": "public, s-maxage=90, stale-while-revalidate=300",
    },
  });
}
