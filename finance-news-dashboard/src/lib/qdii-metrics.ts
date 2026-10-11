export type ShareDateBasis = "observed" | "effective" | "legacy";
export type QdiiShareSnapshot = {
  date: string;
  dateBasis: ShareDateBasis;
  totalShares: number;
  source: string;
  sourceTime: string | null;
  recordedAt: string;
};
export type QdiiShareHistory = Record<string, QdiiShareSnapshot[]>;
export type ShareChangeKind = "daily" | "interval" | "observation" | "first" | "unverified" | "missing";
export type QdiiPrice = {
  price: number | null;
  priceDate: string | null;
  priceTime?: string | null;
  changePct: number | null;
  amount: number | null;
  sourceName?: string;
};

export function numberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()
    || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function positiveNumber(value: unknown): number | null {
  const number = numberOrNull(value);
  return number != null && number > 0 ? number : null;
}

export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function datePart(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.slice(0, 10);
  return validDate(date) ? date : null;
}

export function shanghaiDateTimeFromSeconds(value: unknown): string | null {
  const seconds = positiveNumber(value);
  if (seconds == null || !Number.isFinite(new Date(seconds * 1000).getTime())) return null;
  return shanghaiDateTime(new Date(seconds * 1000));
}

export function shanghaiDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function selectQdiiPrice(sources: Array<QdiiPrice | null | undefined>): QdiiPrice {
  const normalized = sources.flatMap((source): QdiiPrice[] => {
    if (!source || positiveNumber(source.price) == null) return [];
    const time = typeof source.priceTime === "string"
      && /^\d{4}-\d{2}-\d{2}[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(source.priceTime)
      && datePart(source.priceTime) ? source.priceTime.replace("T", " ") : null;
    const amount = numberOrNull(source.amount);
    return [{
      ...source, price: positiveNumber(source.price),
      priceDate: datePart(time) ?? (validDate(source.priceDate) ? source.priceDate : null),
      priceTime: time, changePct: numberOrNull(source.changePct),
      amount: amount != null && amount >= 0 ? amount : null,
    }];
  });
  const source = normalized.sort((a, b) =>
    (b.priceTime ?? b.priceDate ?? "").localeCompare(a.priceTime ?? a.priceDate ?? ""))[0];
  if (!source) return { price: null, priceDate: null, priceTime: null, changePct: null, amount: null };
  return source;
}

export function qdiiPremium({ price, nav, priceDate, navDate, priceTime, navTime, quotedRate, sameProvider }: {
  price: number | null;
  nav: number | null;
  priceDate: string | null;
  navDate: string | null;
  priceTime?: string | null;
  navTime?: string | null;
  quotedRate?: number | null;
  sameProvider: boolean;
}) {
  const quotedPremiumRate = numberOrNull(quotedRate);
  if (positiveNumber(price) == null || positiveNumber(nav) == null) {
    return { premiumRate: null, quotedPremiumRate, premiumQuality: "missing" as const,
      premiumNote: "缺少有效现价或参考估值，暂不计算溢价率" };
  }
  if (!validDate(priceDate) || !validDate(navDate) || priceDate !== navDate) {
    return { premiumRate: null, quotedPremiumRate, premiumQuality: "date-mismatch" as const,
      premiumNote: "现价与参考估值日期不一致或未确认，暂不计算溢价率" };
  }
  const timeOf = (time: string | null | undefined) => time
    ? Date.parse(`${time.replace(" ", "T")}+08:00`) : NaN;
  if (Number.isFinite(timeOf(priceTime)) && Number.isFinite(timeOf(navTime))
    && Math.abs(timeOf(priceTime) - timeOf(navTime)) > 120_000) {
    return { premiumRate: null, quotedPremiumRate, premiumQuality: "date-mismatch" as const,
      premiumNote: "现价与参考估值的报价时间相差超过两分钟，暂不计算溢价率" };
  }
  const calculated = (price! / nav! - 1) * 100;
  if (!Number.isFinite(calculated)) {
    return { premiumRate: null, quotedPremiumRate, premiumQuality: "missing" as const,
      premiumNote: "溢价率计算结果无效" };
  }
  // Allow the rounding of three-decimal prices and four-decimal reference values.
  const tolerance = Math.min(0.1, Math.max(0.02,
    ((0.0005 / nav!) + (price! * 0.00005 / (nav! * nav!))) * 100 + 0.005));
  if (sameProvider && quotedPremiumRate != null && quotedPremiumRate > -100
    && Math.abs(quotedPremiumRate - calculated) <= tolerance) {
    return { premiumRate: quotedPremiumRate, quotedPremiumRate, premiumQuality: "verified" as const,
      premiumNote: "行情溢价率已与同批现价和参考估值核对；参考估值不等于实际成交净值" };
  }
  const mismatch = sameProvider && quotedPremiumRate != null;
  return { premiumRate: calculated, quotedPremiumRate,
    premiumQuality: mismatch ? "mismatch" as const : "calculated" as const,
    premiumNote: mismatch
      ? `行情溢价率 ${quotedPremiumRate.toFixed(2)}% 与现价/估值不一致，当前显示按参考估值计算的结果`
      : "按同日现价与参考估值计算；参考估值不等于实际成交净值" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function parseShareSnapshot(value: unknown, legacy = false, now = Date.now()): QdiiShareSnapshot | null {
  if (!isRecord(value) || !validDate(value.date) || positiveNumber(value.totalShares) == null
    || typeof value.recordedAt !== "string") return null;
  const recordedAt = Date.parse(value.recordedAt);
  if (!Number.isFinite(recordedAt) || recordedAt > now + 60_000
    || value.date > shanghaiDateTime(new Date(recordedAt)).slice(0, 10)) return null;
  const dateBasis = legacy ? "legacy" : value.dateBasis;
  if (dateBasis !== "observed" && dateBasis !== "effective" && dateBasis !== "legacy") return null;
  if (!legacy && (typeof value.source !== "string" || !value.source.trim())) return null;
  return {
    date: value.date, dateBasis, totalShares: positiveNumber(value.totalShares)!,
    source: legacy ? "legacy-unverified" : String(value.source),
    sourceTime: typeof value.sourceTime === "string" && datePart(value.sourceTime) ? value.sourceTime : null,
    recordedAt: new Date(recordedAt).toISOString(),
  };
}

export function parseShareHistory(value: unknown, now = Date.now()): QdiiShareHistory {
  try {
    const file: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!isRecord(file) || !isRecord(file.entries) || (file.version !== 1 && file.version !== 2)) return {};
    const entries: QdiiShareHistory = {};
    for (const [code, rows] of Object.entries(file.entries)) {
      if (!/^\d{6}$/.test(code) || !Array.isArray(rows)) continue;
      const parsed = rows.map((row) => parseShareSnapshot(row, file.version === 1, now)).filter((row) => row != null);
      entries[code] = mergeShareSnapshots([], parsed);
    }
    return entries;
  } catch {
    return {};
  }
}

export function mergeShareSnapshots(existing: QdiiShareSnapshot[], incoming: QdiiShareSnapshot[]) {
  const rows = new Map<string, QdiiShareSnapshot>();
  for (const row of [...existing, ...incoming]) {
    const key = `${row.dateBasis}:${row.date}`;
    const previous = rows.get(key);
    if (!previous || previous.recordedAt <= row.recordedAt) rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt)).slice(-120);
}

export function shareMetrics(rows: QdiiShareSnapshot[], previousTradingDate?: string | null) {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt));
  const latest = sorted.find((row) => row.dateBasis !== "legacy") ?? sorted[0];
  const previous = latest && latest.dateBasis !== "legacy"
    ? sorted.find((row) => row.date < latest.date && row.dateBasis === latest.dateBasis && row.source === latest.source)
    : undefined;
  const netShareChange = latest && previous ? latest.totalShares - previous.totalShares : null;
  const shareChangeKind: ShareChangeKind = !latest ? "missing" : latest.dateBasis === "legacy" ? "unverified"
    : !previous ? "first" : latest.dateBasis === "observed" ? "observation"
      : previous.date === previousTradingDate ? "daily" : "interval";
  return {
    totalShares: latest?.totalShares ?? null,
    totalSharesDate: latest?.date ?? null,
    totalSharesTime: latest?.sourceTime ?? null,
    shareDateBasis: latest?.dateBasis ?? null,
    previousTotalShares: previous?.totalShares ?? null,
    previousTotalSharesDate: previous?.date ?? null,
    netShareChange, netShareChangePct: netShareChange != null && previous ? netShareChange / previous.totalShares * 100 : null,
    shareChangeKind,
    shareChangeSource: latest?.source ?? null,
    shareSnapshotNote: !latest ? "暂无服务器份额记录"
      : latest.dateBasis === "legacy" ? "历史快照曾使用行情日期，份额对应日期未核验，不据此计算净申赎"
        : previous ? `${previous.date} 至 ${latest.date} 的${latest.dateBasis === "observed" ? "观察份额" : "基金份额"}变化；不代表实际资金流入金额`
          : latest.dateBasis === "observed" ? "仅有一次服务器观察记录，份额对应交易日未确认" : "尚缺少可比较的历史份额",
  };
}

export function shareChangePresentation(quote?: {
  shareChangeKind?: ShareChangeKind;
  netShareChange?: number | null;
  totalShares?: number | null;
  totalSharesDate?: string | null;
  previousTotalSharesDate?: string | null;
  shareDateBasis?: ShareDateBasis | null;
}) {
  const kind = quote?.shareChangeKind ?? (quote?.totalShares != null ? "unverified" : "missing");
  const value = kind === "daily" || kind === "interval" || kind === "observation" ? quote?.netShareChange ?? null : null;
  const noun = kind === "daily" ? "估算净" : kind === "observation" ? "观察" : "区间";
  return {
    label: value == null ? "份额变化" : value > 0 ? `${noun}${kind === "daily" ? "申购" : "增加"}`
      : value < 0 ? `${noun}${kind === "daily" ? "赎回" : "减少"}` : "无变化",
    value,
    emptyLabel: kind === "missing" ? "暂无记录" : kind === "unverified" ? "日期待核验" : "待历史记录",
    dateLabel: quote?.shareDateBasis === "effective" ? "截至" : quote?.shareDateBasis === "observed" ? "观察" : "历史",
    range: value != null && quote?.previousTotalSharesDate && quote.totalSharesDate
      ? `${quote.previousTotalSharesDate.slice(5)} 至 ${quote.totalSharesDate.slice(5)}` : null,
  };
}
