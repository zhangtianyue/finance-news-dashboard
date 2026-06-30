import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol")?.trim().toUpperCase();
  const period1 = searchParams.get("period1");
  const period2 = searchParams.get("period2");

  if (!symbol || !/^\d+$/.test(period1 ?? "") || !/^\d+$/.test(period2 ?? "")) {
    return NextResponse.json(
      { error: "缺少 symbol、period1 或 period2 参数。" },
      { status: 400 },
    );
  }

  const yahooUrl = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  yahooUrl.search = new URLSearchParams({
    period1: period1 ?? "",
    period2: period2 ?? "",
    interval: "1d",
    events: "history",
    includeAdjustedClose: "true",
  }).toString();

  try {
    const yahooResponse = await fetch(yahooUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      next: {
        revalidate: 300,
      },
    });
    const body = await yahooResponse.text();

    return new NextResponse(body, {
      status: yahooResponse.status,
      headers: {
        "Cache-Control": "s-maxage=300, stale-while-revalidate=86400",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      { error: `在线价格获取失败：${message}` },
      { status: 502 },
    );
  }
}
