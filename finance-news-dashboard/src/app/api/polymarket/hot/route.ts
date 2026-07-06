import { NextRequest, NextResponse } from "next/server";
import { fetchPolymarketHotSnapshot } from "@/lib/polymarket-hot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("refresh") === "1";

  return NextResponse.json(await fetchPolymarketHotSnapshot({ force }), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
