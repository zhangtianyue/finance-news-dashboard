import { NextRequest, NextResponse } from "next/server";
import {
  popularInstruments,
  searchPopularInstruments,
  type InstrumentOption,
} from "@/lib/instrument-catalog";

type YahooSearchQuote = {
  symbol?: string;
  longname?: string;
  shortname?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
};

type YahooSearchResponse = {
  quotes?: YahooSearchQuote[];
};

const searchTimeoutMs = 5000;
const supportedQuoteTypes = new Set(["EQUITY", "ETF", "INDEX", "MUTUALFUND"]);

function instrumentType(quoteType: string | undefined): InstrumentOption["type"] {
  if (quoteType === "ETF") return "ETF";
  if (quoteType === "INDEX") return "指数";
  if (quoteType === "MUTUALFUND") return "基金";
  return "股票";
}

function mergeOptions(primary: InstrumentOption[], secondary: InstrumentOption[]) {
  const merged = new Map<string, InstrumentOption>();
  for (const option of [...primary, ...secondary]) {
    if (!merged.has(option.symbol)) merged.set(option.symbol, option);
  }
  return [...merged.values()].slice(0, 12);
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length > 64) {
    return NextResponse.json({ error: "搜索内容过长。" }, { status: 400 });
  }

  const localMatches = searchPopularInstruments(query).slice(0, 12);
  if (!query) {
    return NextResponse.json(
      { items: popularInstruments.slice(0, 12) },
      { headers: { "Cache-Control": "public, s-maxage=3600" } },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), searchTimeoutMs);

  try {
    const yahooUrl = new URL("https://query2.finance.yahoo.com/v1/finance/search");
    yahooUrl.search = new URLSearchParams({
      q: query,
      quotesCount: "12",
      newsCount: "0",
      enableFuzzyQuery: "true",
    }).toString();

    const response = await fetch(yahooUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      next: { revalidate: 300 },
    });
    if (!response.ok) throw new Error(`Yahoo search returned ${response.status}`);

    const payload = (await response.json()) as YahooSearchResponse;
    const remoteMatches = (payload.quotes ?? [])
      .filter(
        (quote) =>
          quote.symbol &&
          supportedQuoteTypes.has(quote.quoteType ?? "") &&
          (quote.longname || quote.shortname),
      )
      .map(
        (quote): InstrumentOption => ({
          symbol: quote.symbol?.toUpperCase() ?? "",
          name: quote.longname ?? quote.shortname ?? quote.symbol ?? "",
          exchange: quote.exchDisp ?? quote.exchange ?? "其他市场",
          type: instrumentType(quote.quoteType),
        }),
      );

    return NextResponse.json(
      { items: mergeOptions(localMatches, remoteMatches) },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" } },
    );
  } catch {
    return NextResponse.json(
      { items: localMatches, partial: true },
      { headers: { "Cache-Control": "public, s-maxage=60" } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
