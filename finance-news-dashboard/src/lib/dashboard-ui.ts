import type { QdiiEtfQuote } from "./global-valuations";

export type DashboardTheme = "light" | "dark";

export function resolveDashboardTheme(
  readPreference: () => unknown,
  prefersDark: boolean,
): DashboardTheme {
  try {
    const stored = readPreference();
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Browser privacy settings may block access to storage entirely.
  }
  return prefersDark ? "dark" : "light";
}

export function persistDashboardTheme(
  theme: DashboardTheme,
  writePreference: (theme: DashboardTheme) => void,
) {
  try {
    writePreference(theme);
  } catch {
    // Applying a theme does not depend on saving the preference.
  }
}

type QuoteDate = Pick<QdiiEtfQuote, "price" | "priceDate" | "priceTime">;
type ShareDate = Pick<QdiiEtfQuote, "priceDate" | "totalSharesDate">;

function quoteTimestamp(quote: QuoteDate) {
  if (quote.price == null || !Number.isFinite(quote.price) || quote.price <= 0) return null;
  const time = quote.priceTime?.match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/)?.[0];
  if (time) return time.replace("T", " ");
  return quote.priceDate?.match(/^\d{4}-\d{2}-\d{2}$/)?.[0] ?? null;
}

export function qdiiQuoteTimeLabel(quotes: Iterable<QuoteDate>) {
  const timestamps = [...quotes].map(quoteTimestamp).filter((value) => value != null).sort();
  const latest = timestamps.at(-1);
  if (!latest) return "行情待更新";
  const dates = new Set(timestamps.map((value) => value.slice(0, 10)));
  return `行情 ${latest} 北京时间${dates.size > 1 ? " · 部分日期不同" : ""}`;
}

export function hasOlderShareSnapshot(quote: ShareDate | undefined) {
  return Boolean(
    quote?.priceDate && quote.totalSharesDate && quote.totalSharesDate < quote.priceDate,
  );
}
