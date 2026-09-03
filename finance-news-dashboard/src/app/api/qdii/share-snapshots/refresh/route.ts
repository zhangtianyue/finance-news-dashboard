import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const quoteUrl = new URL("/api/qdii/quotes", request.url);
  quoteUrl.searchParams.set("refreshShares", "1");
  const authorization = request.headers.get("authorization");
  const response = await fetch(quoteUrl, {
    cache: "no-store",
    headers: authorization ? { authorization } : undefined,
  });
  const payload = (await response.json()) as {
    updatedAt?: string;
    quotes?: Record<
      string,
      {
        totalShares?: number | null;
        totalSharesDate?: string | null;
        previousTotalSharesDate?: string | null;
        netShareChange?: number | null;
      }
    >;
  };

  if (!response.ok) {
    return NextResponse.json(
      { error: "QDII share snapshot refresh failed", detail: payload },
      { status: response.status },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      updatedAt: payload.updatedAt,
      sample: payload.quotes?.["513500"] ?? null,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
