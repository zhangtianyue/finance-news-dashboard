import { NextRequest, NextResponse } from "next/server";
import { refreshQdiiShares } from "@/lib/qdii-shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshQdiiShares();
    return NextResponse.json(result, {
      status: result.status === "upstream-failed" ? 502 : result.status === "storage-failed" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "QDII share snapshot refresh failed" }, { status: 503 });
  }
}
