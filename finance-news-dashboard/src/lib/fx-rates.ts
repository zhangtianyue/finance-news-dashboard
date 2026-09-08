export const fxCurrencies = [
  { code: "CNH", name: "离岸人民币", symbol: "¥" },
  { code: "HKD", name: "港元", symbol: "HK$" },
  { code: "USD", name: "美元", symbol: "$" },
  { code: "EUR", name: "欧元", symbol: "€" },
  { code: "GBP", name: "英镑", symbol: "£" },
  { code: "AUD", name: "澳元", symbol: "A$" },
  { code: "SGD", name: "新加坡元", symbol: "S$" },
  { code: "CAD", name: "加元", symbol: "C$" },
  { code: "JPY", name: "日元", symbol: "¥" },
] as const;

export type FxCurrency = (typeof fxCurrencies)[number]["code"];
export type FxSnapshot = {
  version: 1;
  base: "USD";
  provider: "CBSL";
  rateDate: string;
  fetchedAt: string;
  rates: Record<FxCurrency, number>;
};
export type FxResponse = { snapshot: FxSnapshot; fallback: boolean };

export const fxStorageKey = "finance-dashboard-fx-v1";
export const fxMaxCacheAgeMs = 30 * 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function validRateDate(value: unknown, now: number): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
    && time <= now + 24 * 60 * 60 * 1000 && now - time <= fxMaxCacheAgeMs;
}

function validRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseFxSnapshot(value: unknown, now = Date.now()): FxSnapshot | null {
  if (!isRecord(value) || value.version !== 1 || value.base !== "USD" || value.provider !== "CBSL"
    || !validRateDate(value.rateDate, now) || typeof value.fetchedAt !== "string"
    || !isRecord(value.rates)) return null;
  const fetchedAt = Date.parse(value.fetchedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt > now + 60_000 || now - fetchedAt > fxMaxCacheAgeMs) return null;
  const rates: Partial<Record<FxCurrency, number>> = {};
  for (const { code } of fxCurrencies) {
    const rate = value.rates[code];
    if (!validRate(rate)) return null;
    rates[code] = rate;
  }
  if (rates.USD !== 1) return null;
  return {
    version: 1, base: "USD", provider: "CBSL", rateDate: value.rateDate,
    fetchedAt: new Date(fetchedAt).toISOString(), rates: rates as Record<FxCurrency, number>,
  };
}

export function parseFxProviderRows(value: unknown, now = Date.now()): FxSnapshot {
  if (!Array.isArray(value)) throw new Error("Invalid FX response");
  const rates: Partial<Record<FxCurrency, number>> = { USD: 1 };
  let rateDate: string | undefined;
  for (const { code } of fxCurrencies) {
    if (code === "USD") continue;
    const rows = value.filter((row) => isRecord(row) && row.quote === code);
    if (rows.length !== 1) throw new Error(`Missing or duplicate FX quote: ${code}`);
    const row = rows[0];
    if (!isRecord(row) || row.base !== "USD" || !validRate(row.rate) || !validRateDate(row.date, now)) {
      throw new Error(`Invalid FX quote: ${code}`);
    }
    // Keep every leg on one provider and one date; never substitute CNY for CNH.
    if (!Array.isArray(row.providers) || row.providers.length !== 1
      || !isRecord(row.providers[0]) || row.providers[0].key !== "CBSL"
      || row.providers[0].date !== row.date || row.providers[0].rate !== row.rate
      || row.providers[0].excluded === true || (rateDate && rateDate !== row.date)) {
      throw new Error("FX provider or date mismatch");
    }
    rateDate = row.date;
    rates[code] = row.rate;
  }
  const snapshot = parseFxSnapshot({
    version: 1, base: "USD", provider: "CBSL", rateDate,
    fetchedAt: new Date(now).toISOString(), rates,
  }, now);
  if (!snapshot) throw new Error("Incomplete FX snapshot");
  return snapshot;
}

export function crossRate(snapshot: FxSnapshot | null, from: FxCurrency, to: FxCurrency): number | null {
  if (!snapshot) return null;
  const base = snapshot.rates[from];
  const quote = snapshot.rates[to];
  if (!validRate(base) || !validRate(quote)) return null;
  const result = quote / base;
  return validRate(result) ? result : null;
}

export function convertFxAmount(amount: string, rate: number | null): number | null {
  if (!amount.trim() || rate == null || !validRate(rate)) return null;
  const number = Number(amount);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000_000) return null;
  const result = number * rate;
  return Number.isFinite(result) ? result : null;
}

const standardRateFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false, minimumFractionDigits: 4, maximumFractionDigits: 4,
});
const smallRateFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false, minimumFractionDigits: 6, maximumFractionDigits: 6,
});

export function formatFxRate(rate: number | null): string {
  if (rate == null || !validRate(rate)) return "—";
  return (rate < 0.1 ? smallRateFormat : standardRateFormat).format(rate);
}

export function formatFxCheckedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}
