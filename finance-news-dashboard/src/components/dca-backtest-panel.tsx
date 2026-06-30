"use client";

import { ArrowDownToLine, Play, RefreshCw } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";

type DcaFrequency = "monthly" | "weekly" | "daily";
type PriceSource = "remote" | "csv";

type DcaSettings = {
  ticker: string;
  startDate: Date;
  endDate: Date;
  frequency: DcaFrequency;
  amount: number;
  fee: number;
};

type PricePoint = {
  date: Date;
  close: number;
};

type DcaTrade = {
  date: Date;
  price: number;
  invested: number;
  sharesBought: number;
  totalShares: number;
};

type DcaSeriesPoint = {
  date: Date;
  invested: number;
  value: number;
};

type DcaResult = {
  symbol: string;
  priceCount: number;
  firstDate: Date;
  lastDate: Date;
  invested: number;
  finalValue: number;
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  shares: number;
  trades: DcaTrade[];
  series: DcaSeriesPoint[];
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
        quote?: Array<{ close?: Array<number | null> }>;
      };
    }>;
    error?: {
      code?: string;
      description?: string;
    } | null;
  };
  error?: string;
};

const frequencyLabels: Record<DcaFrequency, string> = {
  monthly: "每月",
  weekly: "每周",
  daily: "每日",
};

const firstSelectableYear = 1970;

function todayInputValue() {
  return formatDateInput(new Date());
}

function defaultStartDate() {
  return "2019-01-01";
}

function resolveSymbol(rawTicker: string) {
  return rawTicker.trim().toUpperCase().replace(/\s+/g, "");
}

async function fetchYahooPrices(symbol: string, startDate: Date, endDate: Date) {
  const period1 = Math.floor(startDate.getTime() / 1000);
  const period2 = Math.floor(addDays(endDate, 1).getTime() / 1000);
  const params = new URLSearchParams({
    symbol,
    period1: String(period1),
    period2: String(period2),
  });
  const response = await fetch(`/api/prices?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message || `在线价格获取失败：HTTP ${response.status}`);
  }

  const payload = (await response.json()) as YahooChartResponse;
  const result = payload.chart?.result?.[0];
  const error = payload.chart?.error;
  if (error) throw new Error(`在线价格获取失败：${error.description || error.code}`);
  if (!result?.timestamp?.length) throw new Error("没有找到历史价格，请检查股票代码或日期范围。");

  const closes = result.indicators?.adjclose?.[0]?.adjclose ?? result.indicators?.quote?.[0]?.close ?? [];
  return result.timestamp
    .map((stamp, index) => ({
      date: stripTime(new Date(stamp * 1000)),
      close: Number(closes[index]),
    }))
    .filter((point) => Number.isFinite(point.close));
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? "";
  } catch {
    return "";
  }
}

async function readCsvPrices(file: File | null) {
  if (!file) throw new Error("请选择 CSV 文件。");
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV 至少需要包含表头和一行数据。");

  const headers = splitCsvLine(lines[0]).map((item) => item.trim().toLowerCase());
  const dateIndex = headers.findIndex((header) => ["date", "日期", "time"].includes(header));
  const closeIndex = headers.findIndex((header) =>
    ["close", "adj close", "adjclose", "收盘", "收盘价"].includes(header),
  );
  if (dateIndex < 0 || closeIndex < 0) throw new Error("CSV 表头需要包含 Date 和 Close 列。");

  return lines
    .slice(1)
    .map(splitCsvLine)
    .map((row) => ({ date: parseDate(row[dateIndex]), close: Number(row[closeIndex]) }))
    .filter((point): point is PricePoint => Boolean(point.date) && Number.isFinite(point.close))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function runDcaBacktest(prices: PricePoint[], settings: DcaSettings, symbol: string): DcaResult {
  let shares = 0;
  let invested = 0;
  let nextBuyDate = stripTime(settings.startDate);
  let peakValue = 0;
  let maxDrawdown = 0;
  const series: DcaSeriesPoint[] = [];
  const trades: DcaTrade[] = [];

  for (const point of prices) {
    while (point.date >= nextBuyDate && nextBuyDate <= settings.endDate) {
      const cashToInvest = settings.amount - settings.fee;
      const sharesBought = cashToInvest / point.close;
      shares += sharesBought;
      invested += settings.amount;
      trades.push({
        date: point.date,
        price: point.close,
        invested: settings.amount,
        sharesBought,
        totalShares: shares,
      });
      nextBuyDate = advanceDate(nextBuyDate, settings.frequency);
    }

    const value = shares * point.close;
    peakValue = Math.max(peakValue, value);
    const drawdown = peakValue > 0 ? (value - peakValue) / peakValue : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);

    series.push({
      date: point.date,
      invested,
      value,
    });
  }

  const finalValue = series.at(-1)?.value ?? 0;
  const firstDate = prices[0].date;
  const lastDate = prices.at(-1)?.date ?? firstDate;
  const totalReturn = invested > 0 ? finalValue / invested - 1 : 0;
  const years = Math.max(
    (lastDate.getTime() - firstDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
    1 / 365,
  );
  const cagr = invested > 0 ? Math.pow(finalValue / invested, 1 / years) - 1 : 0;

  return {
    symbol,
    priceCount: prices.length,
    firstDate,
    lastDate,
    invested,
    finalValue,
    totalReturn,
    cagr,
    maxDrawdown,
    shares,
    trades,
    series,
  };
}

function advanceDate(date: Date, frequency: DcaFrequency) {
  if (frequency === "daily") return addDays(date, 1);
  if (frequency === "weekly") return addDays(date, 7);
  return addMonths(date, 1);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return stripTime(next);
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  const targetDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(targetDay, lastDay));
  return stripTime(next);
}

function parseDate(value: string) {
  if (!value) return null;
  const normalized = value.trim().replace(/\//g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  return stripTime(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function dateParts(value: string) {
  const fallback = todayInputValue();
  const match = (value || fallback).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const source = match ? value : fallback;
  const [year, month, day] = source.split("-").map(Number);
  return { year, month, day };
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function buildDateValue(year: number, month: number, day: number) {
  const validDay = Math.min(day, daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(validDay).padStart(2, "0")}`;
}

function selectableYears() {
  const currentYear = new Date().getFullYear();
  return Array.from(
    { length: currentYear - firstSelectableYear + 1 },
    (_, index) => currentYear - index,
  );
}

function stripTime(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMoney(value: number) {
  return `$${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)}`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatCompactMoney(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  values: number[],
  color: string,
  xFor: (index: number) => number,
  yFor: (value: number) => number,
) {
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = xFor(index);
    const y = yFor(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function renderChart(canvas: HTMLCanvasElement, series: DcaSeriesPoint[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(720, Math.floor(rect.width * ratio));
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const width = rect.width;
  const height = rect.height;
  const pad = { top: 28, right: 24, bottom: 42, left: 72 };
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!series.length) return;

  const maxY = Math.max(...series.flatMap((point) => [point.value, point.invested]), 1);
  const xFor = (index: number) =>
    pad.left + (index / Math.max(series.length - 1, 1)) * (width - pad.left - pad.right);
  const yFor = (value: number) =>
    height - pad.bottom - (value / maxY) * (height - pad.top - pad.bottom);

  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#64748b";
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  for (let i = 0; i <= 4; i += 1) {
    const value = (maxY / 4) * i;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(formatCompactMoney(value), 10, y + 4);
  }

  drawLine(
    ctx,
    series.map((point) => point.invested),
    "#94a3b8",
    xFor,
    yFor,
  );
  drawLine(
    ctx,
    series.map((point) => point.value),
    "#dc2626",
    xFor,
    yFor,
  );

  ctx.fillStyle = "#64748b";
  ctx.fillText(formatDateInput(series[0].date), pad.left, height - 14);
  const endText = formatDateInput(series.at(-1)?.date ?? series[0].date);
  ctx.fillText(endText, width - pad.right - ctx.measureText(endText).width, height - 14);

  const legend = [
    ["#dc2626", "组合市值"],
    ["#94a3b8", "累计投入"],
  ] as const;
  let x = width - pad.right - 168;
  for (const [color, label] of legend) {
    ctx.fillStyle = color;
    ctx.fillRect(x, pad.top - 8, 18, 3);
    ctx.fillStyle = "#334155";
    ctx.fillText(label, x + 24, pad.top - 3);
    x += 84;
  }
}

function MetricCard({
  label,
  value,
  tone,
  caption,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
  caption?: string;
}) {
  const colorClass =
    tone === "positive"
      ? "text-red-700"
      : tone === "negative"
        ? "text-emerald-700"
        : "text-slate-950";
  return (
    <div className="min-h-24 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-2 font-mono text-2xl font-semibold leading-none ${colorClass}`}>
        {value}
      </div>
      {caption ? <div className="mt-2 text-xs text-slate-500">{caption}</div> : null}
    </div>
  );
}

function ControlSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-slate-200 px-4 py-3 last:border-b-0">
      <div className="mb-2 text-xs font-semibold text-slate-500">{title}</div>
      <div className="grid gap-2.5">{children}</div>
    </div>
  );
}

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
      {label}
      {children}
    </label>
  );
}

function DetailBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function SegmentButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded px-3 text-xs font-semibold transition-colors ${
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-600 hover:bg-white hover:text-slate-950"
      }`}
    >
      {children}
    </button>
  );
}

function DatePartsSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { year, month, day } = dateParts(value);
  const dayCount = daysInMonth(year, month);
  const years = selectableYears();

  function updateDate(next: Partial<{ year: number; month: number; day: number }>) {
    onChange(buildDateValue(next.year ?? year, next.month ?? month, next.day ?? day));
  }

  return (
    <div className="grid min-w-0 grid-cols-[1.2fr_0.9fr_0.9fr] gap-1.5">
      <select
        aria-label="选择年份"
        value={year}
        onChange={(event) => updateDate({ year: Number(event.target.value) })}
        className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-950 outline-none focus:border-slate-500"
      >
        {years.map((value) => (
          <option key={value} value={value}>
            {value}年
          </option>
        ))}
      </select>
      <select
        aria-label="选择月份"
        value={month}
        onChange={(event) => updateDate({ month: Number(event.target.value) })}
        className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-950 outline-none focus:border-slate-500"
      >
        {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
          <option key={value} value={value}>
            {String(value).padStart(2, "0")}月
          </option>
        ))}
      </select>
      <select
        aria-label="选择日期"
        value={Math.min(day, dayCount)}
        onChange={(event) => updateDate({ day: Number(event.target.value) })}
        className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-950 outline-none focus:border-slate-500"
      >
        {Array.from({ length: dayCount }, (_, index) => index + 1).map((value) => (
          <option key={value} value={value}>
            {String(value).padStart(2, "0")}日
          </option>
        ))}
      </select>
    </div>
  );
}

export function DcaBacktestPanel() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ticker, setTicker] = useState("SPY");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(todayInputValue);
  const [frequency, setFrequency] = useState<DcaFrequency>("monthly");
  const [amount, setAmount] = useState("1000");
  const [fee, setFee] = useState("0");
  const [source, setSource] = useState<PriceSource>("remote");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [status, setStatus] = useState("准备就绪");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<DcaResult | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    renderChart(canvas, result.series);

    const handleResize = () => renderChart(canvas, result.series);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [result]);

  async function handleRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRunning(true);
    setStatus("正在获取价格并回测...");

    try {
      const parsedStartDate = parseDate(startDate);
      const parsedEndDate = parseDate(endDate);
      const parsedAmount = Number(amount);
      const parsedFee = Number(fee);
      const symbol = resolveSymbol(ticker);

      if (!symbol) throw new Error("请输入股票代码。");
      if (!parsedStartDate || !parsedEndDate || parsedStartDate >= parsedEndDate) {
        throw new Error("请选择有效的开始和结束日期。");
      }
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error("每次投入必须大于 0。");
      }
      if (!Number.isFinite(parsedFee) || parsedFee < 0) {
        throw new Error("手续费不能为负数。");
      }
      if (parsedFee >= parsedAmount) {
        throw new Error("手续费必须小于每次投入金额。");
      }

      const settings: DcaSettings = {
        ticker: symbol,
        startDate: parsedStartDate,
        endDate: parsedEndDate,
        frequency,
        amount: parsedAmount,
        fee: parsedFee,
      };
      const prices =
        source === "csv"
          ? await readCsvPrices(csvFile)
          : await fetchYahooPrices(symbol, parsedStartDate, parsedEndDate);
      const filteredPrices = prices.filter(
        (point) =>
          point.date >= parsedStartDate && point.date <= parsedEndDate && point.close > 0,
      );

      if (filteredPrices.length < 2) {
        throw new Error("有效价格数据不足，请调长日期范围或换一个代码。");
      }

      const nextResult = runDcaBacktest(filteredPrices, settings, symbol);
      setResult(nextResult);
      setStatus(
        `完成：${formatDateInput(nextResult.firstDate)} 至 ${formatDateInput(
          nextResult.lastDate,
        )}，共 ${nextResult.priceCount} 个交易日。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "回测失败";
      setResult(null);
      setStatus(message);
    } finally {
      setIsRunning(false);
    }
  }

  function downloadTrades() {
    if (!result?.trades.length) return;
    const rows = [
      ["date", "price", "invested", "shares_bought", "total_shares"],
      ...result.trades.map((trade) => [
        formatDateInput(trade.date),
        trade.price.toFixed(4),
        trade.invested.toFixed(2),
        trade.sharesBought.toFixed(8),
        trade.totalShares.toFixed(8),
      ]),
    ];
    const blob = new Blob([rows.map((row) => row.join(",")).join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "dca-backtest-trades.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const recentTrades = result?.trades.slice(-12).reverse() ?? [];
  const currentSymbol = result?.symbol ?? (resolveSymbol(ticker) || "N/A");
  const dateRangeLabel = `${startDate || "N/A"} 至 ${endDate || "N/A"}`;
  const planLabel = `${frequencyLabels[frequency]} / ${formatMoney(Number(amount) || 0)}`;
  const sourceLabel = source === "remote" ? "在线价格" : "CSV";

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <DetailBadge label="标的" value={currentSymbol} />
          <DetailBadge label="区间" value={dateRangeLabel} />
          <DetailBadge label="计划" value={planLabel} />
          <DetailBadge label="来源" value={sourceLabel} />
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm lg:self-auto">
          <span
            className={`size-2 rounded-full ${isRunning ? "bg-amber-500" : result ? "bg-emerald-600" : "bg-slate-300"}`}
          />
          {status}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)] 2xl:grid-cols-[440px_minmax(0,1fr)]">
        <form
          onSubmit={handleRun}
          className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-200 bg-slate-950 px-4 py-4 text-white">
            <div className="text-xs font-semibold text-slate-300">DCA CONTROL</div>
            <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-2xl font-semibold">{currentSymbol}</div>
                <div className="mt-1 truncate text-xs text-slate-400">{dateRangeLabel}</div>
              </div>
              <button
                type="submit"
                disabled={isRunning}
                className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-red-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-500"
                title="运行定投回测"
              >
                {isRunning ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                {isRunning ? "回测中" : "运行"}
              </button>
            </div>
          </div>

          <ControlSection title="标的与区间">
            <FieldLabel label="股票代码">
              <input
                value={ticker}
                onChange={(event) => setTicker(event.target.value)}
                className="h-9 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-950 outline-none focus:border-slate-500"
                placeholder="SPY、QQQ、AAPL"
                autoComplete="off"
              />
            </FieldLabel>

            <div className="grid gap-3">
              <FieldLabel label="开始日期">
                <DatePartsSelect value={startDate} onChange={setStartDate} />
              </FieldLabel>
              <FieldLabel label="结束日期">
                <DatePartsSelect value={endDate} onChange={setEndDate} />
              </FieldLabel>
            </div>
          </ControlSection>

          <ControlSection title="买入计划">
            <div>
              <div className="mb-1.5 text-xs font-semibold text-slate-600">定投频率</div>
              <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
                {Object.entries(frequencyLabels).map(([value, label]) => (
                  <SegmentButton
                    key={value}
                    active={frequency === value}
                    onClick={() => setFrequency(value as DcaFrequency)}
                  >
                    {label}
                  </SegmentButton>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="每次投入">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none focus:border-slate-500"
                />
              </FieldLabel>
              <FieldLabel label="每次手续费">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 px-3 text-sm text-slate-950 outline-none focus:border-slate-500"
                />
              </FieldLabel>
            </div>
          </ControlSection>

          <ControlSection title="价格数据">
            <div>
              <div className="mb-1.5 text-xs font-semibold text-slate-600">价格来源</div>
              <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
                <SegmentButton active={source === "remote"} onClick={() => setSource("remote")}>
                  在线价格
                </SegmentButton>
                <SegmentButton active={source === "csv"} onClick={() => setSource("csv")}>
                  CSV
                </SegmentButton>
              </div>
            </div>

            {source === "csv" ? (
              <FieldLabel label="CSV 文件">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setCsvFile(event.target.files?.[0] ?? null)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-950 file:mr-3 file:rounded file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
                />
              </FieldLabel>
            ) : null}
          </ControlSection>
        </form>

        <div className="min-w-0">
          <div className="mb-4 grid gap-3 md:grid-cols-3 2xl:grid-cols-6">
            <MetricCard
              label="总投入"
              value={result ? formatMoney(result.invested) : "N/A"}
              caption={result ? `${result.trades.length} 笔买入` : undefined}
            />
            <MetricCard
              label="期末市值"
              value={result ? formatMoney(result.finalValue) : "N/A"}
              caption={result ? formatDateInput(result.lastDate) : undefined}
            />
            <MetricCard
              label="总收益率"
              value={result ? formatPercent(result.totalReturn) : "N/A"}
              tone={result ? (result.totalReturn >= 0 ? "positive" : "negative") : undefined}
            />
            <MetricCard
              label="年化收益率"
              value={result ? formatPercent(result.cagr) : "N/A"}
              tone={result ? (result.cagr >= 0 ? "positive" : "negative") : undefined}
            />
            <MetricCard
              label="最大回撤"
              value={result ? formatPercent(result.maxDrawdown) : "N/A"}
              tone={result && result.maxDrawdown < 0 ? "negative" : undefined}
            />
            <MetricCard
              label="累计股数"
              value={result ? formatNumber(result.shares, 4) : "N/A"}
              caption={result ? `${result.priceCount} 个交易日` : undefined}
            />
          </div>

          <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs font-medium text-slate-500">资产路径</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-semibold text-slate-950">
                    {currentSymbol}
                  </span>
                  <span className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500">
                    {dateRangeLabel}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={downloadTrades}
                disabled={!result?.trades.length}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                title="导出买入记录 CSV"
              >
                <ArrowDownToLine className="size-3.5" />
                导出记录
              </button>
            </div>
            <div className="relative h-[360px]">
              {result ? (
                <canvas ref={canvasRef} className="block h-full w-full" />
              ) : (
                <div className="absolute inset-0 bg-[linear-gradient(#e5e7eb_1px,transparent_1px),linear-gradient(90deg,#e5e7eb_1px,transparent_1px)] bg-[size:64px_64px]">
                  <div className="flex h-full items-center justify-center">
                    <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
                      <div className="text-sm font-semibold text-slate-950">等待回测</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {currentSymbol} / {frequencyLabels[frequency]}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
            <table className="min-w-[780px] w-full border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">日期</th>
                  <th className="px-4 py-3 text-right font-semibold">价格</th>
                  <th className="px-4 py-3 text-right font-semibold">投入</th>
                  <th className="px-4 py-3 text-right font-semibold">买入股数</th>
                  <th className="px-4 py-3 text-right font-semibold">累计股数</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentTrades.length ? (
                  recentTrades.map((trade) => (
                    <tr key={`${trade.date.toISOString()}-${trade.totalShares}`}>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">
                        {formatDateInput(trade.date)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-950">
                        {formatNumber(trade.price, 3)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-950">
                        {formatMoney(trade.invested)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-950">
                        {formatNumber(trade.sharesBought, 6)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-950">
                        {formatNumber(trade.totalShares, 6)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                      运行一次回测后显示最近买入记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
