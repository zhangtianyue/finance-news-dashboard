import { NextRequest, NextResponse } from "next/server";
import { createFxRateCache } from "@/lib/fx-rate-cache";
import { fxCurrencies, parseFxProviderRows } from "@/lib/fx-rates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const cache = createFxRateCache(async () => {
  const url = new URL("https://api.frankfurter.dev/v2/rates");
  url.search = new URLSearchParams({
    base: "USD",
    quotes: fxCurrencies.filter(({ code }) => code !== "USD").map(({ code }) => code).join(","),
    providers: "CBSL",
    expand: "providers",
  }).toString();
  const response = await fetch(url, {
    cache: "no-store", signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`FX source HTTP ${response.status}`);
  return parseFxProviderRows(await response.json());
});

export async function GET(request: NextRequest) {
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  try {
    const result = await cache.get(force);
    return NextResponse.json(result, {
      headers: { "Cache-Control": force || result.fallback ? "no-store" : "public, s-maxage=300" },
    });
  } catch {
    return NextResponse.json({ error: "汇率源暂时不可用，请稍后重试。" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
