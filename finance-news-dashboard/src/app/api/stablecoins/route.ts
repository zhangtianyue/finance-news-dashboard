import { NextRequest, NextResponse } from "next/server";
import { fetchStablecoinSnapshot } from "@/lib/stablecoins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  const snapshot = await fetchStablecoinSnapshot({ force });

  return NextResponse.json(snapshot, {
    headers: {
      "Cache-Control": force
        ? "no-store"
        : "public, s-maxage=300, stale-while-revalidate=1800",
    },
  });
}
