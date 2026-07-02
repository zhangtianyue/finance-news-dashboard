import { NextRequest, NextResponse } from "next/server";
import { getDynamicGlobalValuationSnapshot } from "@/lib/dynamic-valuations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("refresh") === "1";

  return NextResponse.json(await getDynamicGlobalValuationSnapshot({ force }), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
