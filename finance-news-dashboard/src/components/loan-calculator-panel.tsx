"use client";

import {
  ArrowDownToLine,
  BarChart3,
  Calculator,
  CalendarDays,
  Check,
  CircleDollarSign,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateLoan,
  type LoanCalculationInput,
  type LoanCalculationResult,
  type LoanPaymentRow,
  type LoanRepaymentMethod,
  type EarlyRepaymentStrategy,
} from "@/lib/loan-calculator";

type DashboardTheme = "light" | "dark";
type TermUnit = "years" | "months";
type ChartMode = "payment" | "balance";

const methodLabels: Record<LoanRepaymentMethod, string> = {
  annuity: "等额本息",
  "equal-principal": "等额本金",
  "interest-only": "先息后本",
};

const defaultSettings = {
  principalWan: "100",
  termValue: "30",
  termUnit: "years" as TermUnit,
  annualRatePercent: "3.10",
  fee: "0",
  method: "annuity" as LoanRepaymentMethod,
  earlyRepaymentEnabled: false,
  earlyRepaymentWan: "20",
  earlyRepaymentStrategy: "reduce-term" as EarlyRepaymentStrategy,
};

function defaultFirstPaymentDate() {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return date.toISOString().slice(0, 10);
}

function addYearsToMonth(date: string, years: number) {
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) return "";
  return `${Number(match[1]) + years}-${match[2]}`;
}

function formatYuan(value: number, digits = 2) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatWan(value: number) {
  return `${(value / 10_000).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}万元`;
}

function formatCompactYuan(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absolute >= 100_000_000) return `${sign}${(absolute / 100_000_000).toFixed(1)}亿`;
  if (absolute >= 10_000) return `${sign}${(absolute / 10_000).toFixed(1)}万`;
  return `${sign}${absolute.toFixed(0)}`;
}

function formatDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function buildLoanInput(settings: {
  principalWan: string;
  termValue: string;
  termUnit: TermUnit;
  annualRatePercent: string;
  firstPaymentDate: string;
  fee: string;
  method: LoanRepaymentMethod;
  earlyRepaymentEnabled: boolean;
  earlyRepaymentWan: string;
  earlyRepaymentMonth: string;
  earlyRepaymentStrategy: EarlyRepaymentStrategy;
}): LoanCalculationInput {
  const termNumber = Number(settings.termValue);
  return {
    principal: Number(settings.principalWan) * 10_000,
    annualRate: Number(settings.annualRatePercent) / 100,
    termMonths: Math.round(termNumber * (settings.termUnit === "years" ? 12 : 1)),
    firstPaymentDate: settings.firstPaymentDate,
    method: settings.method,
    fee: Number(settings.fee),
    earlyRepayment: settings.earlyRepaymentEnabled
      ? {
          amount: Number(settings.earlyRepaymentWan) * 10_000,
          month: settings.earlyRepaymentMonth,
          strategy: settings.earlyRepaymentStrategy,
        }
      : null,
  };
}

function DetailBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="text-[10px] font-semibold text-slate-500">{label}</div>
      <div className="mt-1 whitespace-nowrap font-mono text-xs font-semibold text-slate-950">
        {value}
      </div>
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs font-semibold text-slate-600">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ControlSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-b border-slate-200 px-4 py-4 last:border-b-0">
      <legend className="sr-only">{title}</legend>
      <div className="text-[11px] font-semibold text-slate-500">{title}</div>
      {children}
    </fieldset>
  );
}

function SegmentButton({
  active,
  onClick,
  disabled = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`h-8 rounded px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-slate-950 text-white shadow-sm"
          : "text-slate-600 hover:bg-white hover:text-slate-950"
      }`}
    >
      {children}
    </button>
  );
}

function MetricCard({
  label,
  value,
  caption,
  tone = "default",
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "default" | "positive" | "attention";
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "attention"
        ? "text-red-600"
        : "text-slate-950";
  return (
    <article className="min-w-0 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className={`mt-1.5 truncate font-mono text-lg font-semibold ${valueClass}`} title={value}>
        {value}
      </div>
      <div className="mt-1 truncate text-[10px] text-slate-500">{caption ?? "\u00a0"}</div>
    </article>
  );
}

function ScenarioCard({
  label,
  result,
  selected,
}: {
  label: string;
  result: LoanCalculationResult;
  selected: boolean;
}) {
  return (
    <article
      className={`rounded-md border bg-white px-4 py-4 shadow-sm ${
        selected ? "border-sky-400 ring-1 ring-sky-200" : "border-slate-200"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-950">{label}</div>
        {selected ? (
          <span className="inline-flex items-center gap-1 rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
            <Check className="size-3" />
            当前
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <div>
          <div className="text-slate-500">首月月供</div>
          <div className="mt-1 font-mono font-semibold text-slate-950">
            {formatYuan(result.firstPayment)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">总利息</div>
          <div className="mt-1 font-mono font-semibold text-slate-950">
            {formatWan(result.totalInterest)}
          </div>
        </div>
        <div>
          <div className="text-slate-500">还款期数</div>
          <div className="mt-1 font-mono font-semibold text-slate-950">
            {result.actualMonths} 期
          </div>
        </div>
        <div>
          <div className="text-slate-500">总还款</div>
          <div className="mt-1 font-mono font-semibold text-slate-950">
            {formatWan(result.totalRepayment)}
          </div>
        </div>
      </div>
    </article>
  );
}

function sampleSchedule(schedule: LoanPaymentRow[], maximumPoints = 120) {
  if (schedule.length <= maximumPoints) return schedule;
  const step = Math.ceil(schedule.length / maximumPoints);
  const sampled = schedule.filter((_, index) => index % step === 0);
  const last = schedule.at(-1);
  if (last && sampled.at(-1)?.period !== last.period) sampled.push(last);
  return sampled;
}

function renderLoanChart(
  canvas: HTMLCanvasElement,
  result: LoanCalculationResult,
  mode: ChartMode,
  theme: DashboardTheme,
) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const colors =
    theme === "dark"
      ? {
          grid: "#293440",
          axis: "#8f9dad",
          primary: "#38bdf8",
          secondary: "#fbbf24",
          fill: "rgba(56, 189, 248, 0.13)",
          event: "#fb7185",
        }
      : {
          grid: "#e2e8f0",
          axis: "#64748b",
          primary: "#0284c7",
          secondary: "#d97706",
          fill: "rgba(14, 165, 233, 0.10)",
          event: "#e11d48",
        };
  const margin = { top: 24, right: 22, bottom: 36, left: 62 };
  const width = rect.width - margin.left - margin.right;
  const height = rect.height - margin.top - margin.bottom;
  const points = sampleSchedule(result.schedule);
  const primaryValues = points.map((row) =>
    mode === "balance" ? row.remainingPrincipal : row.regularPayment,
  );
  const secondaryValues = points.map((row) => row.interest);
  const maxValue = Math.max(
    ...primaryValues,
    ...(mode === "payment" ? secondaryValues : [0]),
    1,
  );
  const scaleMax = maxValue * 1.08;
  const x = (index: number) =>
    margin.left + (index / Math.max(points.length - 1, 1)) * width;
  const y = (value: number) => margin.top + height - (value / scaleMax) * height;

  context.lineWidth = 1;
  context.font = '11px "SFMono-Regular", Consolas, monospace';
  context.textAlign = "right";
  context.textBaseline = "middle";
  for (let index = 0; index <= 4; index += 1) {
    const value = (scaleMax / 4) * index;
    const yPosition = y(value);
    context.strokeStyle = colors.grid;
    context.beginPath();
    context.moveTo(margin.left, yPosition);
    context.lineTo(rect.width - margin.right, yPosition);
    context.stroke();
    context.fillStyle = colors.axis;
    context.fillText(formatCompactYuan(value), margin.left - 9, yPosition);
  }

  const drawContext = context;
  function drawLine(values: number[], color: string, fill = false) {
    drawContext.beginPath();
    values.forEach((value, index) => {
      if (index === 0) drawContext.moveTo(x(index), y(value));
      else drawContext.lineTo(x(index), y(value));
    });
    if (fill) {
      drawContext.lineTo(x(values.length - 1), y(0));
      drawContext.lineTo(x(0), y(0));
      drawContext.closePath();
      drawContext.fillStyle = colors.fill;
      drawContext.fill();
      drawContext.beginPath();
      values.forEach((value, index) => {
        if (index === 0) drawContext.moveTo(x(index), y(value));
        else drawContext.lineTo(x(index), y(value));
      });
    }
    drawContext.strokeStyle = color;
    drawContext.lineWidth = 2;
    drawContext.stroke();
  }

  drawLine(primaryValues, colors.primary, mode === "balance");
  if (mode === "payment") drawLine(secondaryValues, colors.secondary);

  const earlyPeriod = result.appliedEarlyRepayment?.period;
  if (earlyPeriod) {
    const nearestIndex = points.reduce((nearest, row, index) =>
      Math.abs(row.period - earlyPeriod) < Math.abs(points[nearest].period - earlyPeriod)
        ? index
        : nearest,
    0);
    context.strokeStyle = colors.event;
    context.setLineDash([4, 4]);
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x(nearestIndex), margin.top);
    context.lineTo(x(nearestIndex), margin.top + height);
    context.stroke();
    context.setLineDash([]);
  }

  context.fillStyle = colors.axis;
  context.font = '10px "SFMono-Regular", Consolas, monospace';
  context.textBaseline = "top";
  context.textAlign = "left";
  context.fillText(result.schedule[0].date.slice(0, 7), margin.left, rect.height - 24);
  context.textAlign = "right";
  context.fillText(result.endDate.slice(0, 7), rect.width - margin.right, rect.height - 24);
}

function LoanChart({
  result,
  theme,
}: {
  result: LoanCalculationResult;
  theme: DashboardTheme;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<ChartMode>("payment");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => renderLoanChart(canvas, result, mode, theme);
    render();
    window.addEventListener("resize", render);
    return () => window.removeEventListener("resize", render);
  }, [mode, result, theme]);

  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <BarChart3 className="size-4 text-sky-600" />
            还款路径
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {mode === "payment" ? "月供与当期利息" : "未偿还本金变化"}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
          <SegmentButton active={mode === "payment"} onClick={() => setMode("payment")}>
            月供结构
          </SegmentButton>
          <SegmentButton active={mode === "balance"} onClick={() => setMode("balance")}>
            剩余本金
          </SegmentButton>
        </div>
      </div>
      <div className="relative h-[300px] sm:h-[340px]">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-200 px-4 py-3 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-5 bg-sky-600" />
          {mode === "payment" ? "正常月供" : "剩余本金"}
        </span>
        {mode === "payment" ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-0.5 w-5 bg-amber-600" />
            当期利息
          </span>
        ) : null}
        {result.appliedEarlyRepayment ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-4 w-px border-l border-dashed border-red-600" />
            提前还款
          </span>
        ) : null}
      </div>
    </section>
  );
}

function DesktopScheduleTable({ rows }: { rows: LoanPaymentRow[] }) {
  return (
    <div className="hidden md:block">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
          <tr>
            <th className="w-[7%] px-3 py-3 text-center">期数</th>
            <th className="w-[14%] px-3 py-3">还款日期</th>
            <th className="w-[16%] px-3 py-3 text-right">当期还款</th>
            <th className="w-[15%] px-3 py-3 text-right">偿还本金</th>
            <th className="w-[14%] px-3 py-3 text-right">支付利息</th>
            <th className="w-[15%] px-3 py-3 text-right">额外还款</th>
            <th className="w-[19%] px-3 py-3 text-right">剩余本金</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row) => (
            <tr key={row.period} className={row.extraPrincipal > 0 ? "bg-sky-50" : ""}>
              <td className="px-3 py-3 text-center font-mono text-slate-500">
                {row.period}
              </td>
              <td className="px-3 py-3 font-mono text-slate-700">{row.date}</td>
              <td className="px-3 py-3 text-right font-mono font-semibold text-slate-950">
                {formatYuan(row.totalPayment)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-slate-700">
                {formatYuan(row.principal)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-amber-700">
                {formatYuan(row.interest)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-sky-700">
                {row.extraPrincipal > 0 ? formatYuan(row.extraPrincipal) : "-"}
              </td>
              <td className="px-3 py-3 text-right font-mono text-slate-950">
                {formatYuan(row.remainingPrincipal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileScheduleList({ rows }: { rows: LoanPaymentRow[] }) {
  return (
    <div className="divide-y divide-slate-100 md:hidden">
      {rows.map((row) => (
        <article key={row.period} className={`px-4 py-4 ${row.extraPrincipal > 0 ? "bg-sky-50" : ""}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-950">第 {row.period} 期</div>
              <div className="mt-1 font-mono text-[11px] text-slate-500">{row.date}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-500">当期还款</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-950">
                {formatYuan(row.totalPayment)}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-[11px]">
            <div className="flex justify-between gap-2 text-slate-500">
              <span>本金</span>
              <span className="font-mono text-slate-800">{formatYuan(row.principal)}</span>
            </div>
            <div className="flex justify-between gap-2 text-slate-500">
              <span>利息</span>
              <span className="font-mono text-amber-700">{formatYuan(row.interest)}</span>
            </div>
            <div className="flex justify-between gap-2 text-slate-500">
              <span>额外</span>
              <span className="font-mono text-sky-700">
                {row.extraPrincipal > 0 ? formatYuan(row.extraPrincipal) : "-"}
              </span>
            </div>
            <div className="flex justify-between gap-2 text-slate-500">
              <span>剩余</span>
              <span className="font-mono text-slate-800">
                {formatYuan(row.remainingPrincipal)}
              </span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function LoanCalculatorPanel({ theme }: { theme: DashboardTheme }) {
  const initialFirstPaymentDate = defaultFirstPaymentDate();
  const [principalWan, setPrincipalWan] = useState(defaultSettings.principalWan);
  const [termValue, setTermValue] = useState(defaultSettings.termValue);
  const [termUnit, setTermUnit] = useState<TermUnit>(defaultSettings.termUnit);
  const [annualRatePercent, setAnnualRatePercent] = useState(
    defaultSettings.annualRatePercent,
  );
  const [firstPaymentDate, setFirstPaymentDate] = useState(initialFirstPaymentDate);
  const [fee, setFee] = useState(defaultSettings.fee);
  const [method, setMethod] = useState<LoanRepaymentMethod>(defaultSettings.method);
  const [earlyRepaymentEnabled, setEarlyRepaymentEnabled] = useState(
    defaultSettings.earlyRepaymentEnabled,
  );
  const [earlyRepaymentWan, setEarlyRepaymentWan] = useState(
    defaultSettings.earlyRepaymentWan,
  );
  const [earlyRepaymentMonth, setEarlyRepaymentMonth] = useState(
    addYearsToMonth(initialFirstPaymentDate, 5),
  );
  const [earlyRepaymentStrategy, setEarlyRepaymentStrategy] =
    useState<EarlyRepaymentStrategy>(defaultSettings.earlyRepaymentStrategy);
  const [selectedYear, setSelectedYear] = useState("all");
  const [periodQuery, setPeriodQuery] = useState("");

  const calculation = useMemo(() => {
    try {
      const input = buildLoanInput({
        principalWan,
        termValue,
        termUnit,
        annualRatePercent,
        firstPaymentDate,
        fee,
        method,
        earlyRepaymentEnabled,
        earlyRepaymentWan,
        earlyRepaymentMonth,
        earlyRepaymentStrategy,
      });
      return { input, result: calculateLoan(input), error: null };
    } catch (error) {
      return {
        input: null,
        result: null,
        error: error instanceof Error ? error.message : "贷款参数无效。",
      };
    }
  }, [
    annualRatePercent,
    earlyRepaymentEnabled,
    earlyRepaymentMonth,
    earlyRepaymentStrategy,
    earlyRepaymentWan,
    fee,
    firstPaymentDate,
    method,
    principalWan,
    termUnit,
    termValue,
  ]);

  const result = calculation.result;
  const comparisons = useMemo(() => {
    if (!calculation.input) return null;
    try {
      return {
        annuity: calculateLoan({ ...calculation.input, method: "annuity" }),
        equalPrincipal: calculateLoan({
          ...calculation.input,
          method: "equal-principal",
        }),
      };
    } catch {
      return null;
    }
  }, [calculation.input]);

  const baseline = useMemo(() => {
    if (!calculation.input || !earlyRepaymentEnabled) return result;
    try {
      return calculateLoan({ ...calculation.input, earlyRepayment: null });
    } catch {
      return null;
    }
  }, [calculation.input, earlyRepaymentEnabled, result]);

  const yearOptions = useMemo(
    () =>
      result
        ? Array.from(new Set(result.schedule.map((row) => row.date.slice(0, 4))))
        : [],
    [result],
  );
  const visibleRows = useMemo(() => {
    if (!result) return [];
    const query = Number(periodQuery);
    if (periodQuery.trim() && Number.isInteger(query)) {
      return result.schedule.filter((row) => row.period === query);
    }
    if (selectedYear === "all") return result.schedule.slice(0, 24);
    return result.schedule.filter((row) => row.date.startsWith(selectedYear));
  }, [periodQuery, result, selectedYear]);

  const savedInterest =
    baseline && result ? Math.max(baseline.totalInterest - result.totalInterest, 0) : 0;
  const shortenedMonths =
    baseline && result ? Math.max(baseline.actualMonths - result.actualMonths, 0) : 0;

  function selectMethod(nextMethod: LoanRepaymentMethod) {
    setMethod(nextMethod);
    if (nextMethod === "interest-only") setEarlyRepaymentStrategy("reduce-payment");
  }

  function resetSettings() {
    const nextFirstPaymentDate = defaultFirstPaymentDate();
    setPrincipalWan(defaultSettings.principalWan);
    setTermValue(defaultSettings.termValue);
    setTermUnit(defaultSettings.termUnit);
    setAnnualRatePercent(defaultSettings.annualRatePercent);
    setFirstPaymentDate(nextFirstPaymentDate);
    setFee(defaultSettings.fee);
    setMethod(defaultSettings.method);
    setEarlyRepaymentEnabled(defaultSettings.earlyRepaymentEnabled);
    setEarlyRepaymentWan(defaultSettings.earlyRepaymentWan);
    setEarlyRepaymentMonth(addYearsToMonth(nextFirstPaymentDate, 5));
    setEarlyRepaymentStrategy(defaultSettings.earlyRepaymentStrategy);
    setSelectedYear("all");
    setPeriodQuery("");
  }

  function downloadSchedule() {
    if (!result) return;
    const rows = [
      ["期数", "还款日期", "当期还款", "偿还本金", "支付利息", "额外还款", "剩余本金"],
      ...result.schedule.map((row) => [
        String(row.period),
        row.date,
        row.totalPayment.toFixed(2),
        row.principal.toFixed(2),
        row.interest.toFixed(2),
        row.extraPrincipal.toFixed(2),
        row.remainingPrincipal.toFixed(2),
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.join(",")).join("\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "贷款还款计划.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const termLabel = `${termValue || "-"}${termUnit === "years" ? "年" : "个月"}`;

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <DetailBadge label="贷款金额" value={`${principalWan || "-"}万元`} />
          <DetailBadge label="期限" value={termLabel} />
          <DetailBadge label="年利率" value={`${annualRatePercent || "-"}%`} />
          <DetailBadge label="方式" value={methodLabels[method]} />
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 shadow-sm lg:self-auto">
          <ShieldCheck className="size-4" />
          本地计算，参数不上传
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(280px,36%)_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] xl:gap-5">
        <form
          onSubmit={(event) => event.preventDefault()}
          className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"
        >
          <div className="border-b border-slate-200 bg-slate-950 px-4 py-4 text-white">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-sky-400/30 bg-sky-400/10 text-sky-300">
                  <Calculator className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-sky-300">LOAN CONTROL</div>
                  <div className="mt-1 truncate text-xs text-slate-300">
                    {result ? `预计 ${result.actualMonths} 期结清` : "等待有效参数"}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={resetSettings}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-white/15 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
                title="恢复默认参数"
                aria-label="恢复默认参数"
              >
                <RotateCcw className="size-4" />
              </button>
            </div>
          </div>

          <ControlSection title="还款方式">
            <div className="grid grid-cols-3 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
              {(Object.keys(methodLabels) as LoanRepaymentMethod[]).map((value) => (
                <SegmentButton
                  key={value}
                  active={method === value}
                  onClick={() => selectMethod(value)}
                >
                  {methodLabels[value]}
                </SegmentButton>
              ))}
            </div>
          </ControlSection>

          <ControlSection title="贷款参数">
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 2xl:grid-cols-2">
              <FieldLabel label="贷款金额（万元）">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={principalWan}
                  onChange={(event) => setPrincipalWan(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-950 outline-none focus:border-sky-500"
                />
              </FieldLabel>
              <FieldLabel label="年利率（%）">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={annualRatePercent}
                  onChange={(event) => setAnnualRatePercent(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-950 outline-none focus:border-sky-500"
                />
              </FieldLabel>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
              <FieldLabel label="贷款期限">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={termValue}
                  onChange={(event) => setTermValue(event.target.value)}
                  className="h-9 min-w-0 rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-950 outline-none focus:border-sky-500"
                />
              </FieldLabel>
              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-600">单位</div>
                <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
                  <SegmentButton active={termUnit === "years"} onClick={() => setTermUnit("years")}>
                    年
                  </SegmentButton>
                  <SegmentButton active={termUnit === "months"} onClick={() => setTermUnit("months")}>
                    月
                  </SegmentButton>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 2xl:grid-cols-2">
              <FieldLabel label="首次还款日期">
                <input
                  type="date"
                  value={firstPaymentDate}
                  onChange={(event) => setFirstPaymentDate(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-950 outline-none focus:border-sky-500"
                />
              </FieldLabel>
              <FieldLabel label="手续费（元）">
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                  className="h-9 rounded-md border border-slate-300 px-3 font-mono text-sm text-slate-950 outline-none focus:border-sky-500"
                />
              </FieldLabel>
            </div>
          </ControlSection>

          <ControlSection title="提前还款">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5">
              <span>
                <span className="block text-xs font-semibold text-slate-700">启用一次性提前还款</span>
                <span className="mt-1 block text-[10px] text-slate-500">在当月正常月供后冲减本金</span>
              </span>
              <input
                type="checkbox"
                checked={earlyRepaymentEnabled}
                onChange={(event) => setEarlyRepaymentEnabled(event.target.checked)}
                className="size-4 accent-sky-600"
              />
            </label>

            {earlyRepaymentEnabled ? (
              <div className="grid gap-4 rounded-md border border-sky-200 bg-sky-50 p-3">
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-1 2xl:grid-cols-2">
                  <FieldLabel label="提前还款（万元）">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={earlyRepaymentWan}
                      onChange={(event) => setEarlyRepaymentWan(event.target.value)}
                      className="h-9 rounded-md border border-slate-300 bg-white px-3 font-mono text-sm text-slate-950 outline-none focus:border-sky-500"
                    />
                  </FieldLabel>
                  <FieldLabel label="提前还款月份">
                    <input
                      type="month"
                      value={earlyRepaymentMonth}
                      onChange={(event) => setEarlyRepaymentMonth(event.target.value)}
                      className="h-9 rounded-md border border-slate-300 bg-white px-3 font-mono text-sm text-slate-950 outline-none focus:border-sky-500"
                    />
                  </FieldLabel>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-semibold text-slate-600">提前还款后</div>
                  <div className="grid grid-cols-2 gap-1 rounded-md border border-slate-200 bg-white/70 p-1">
                    <SegmentButton
                      active={earlyRepaymentStrategy === "reduce-term"}
                      onClick={() => setEarlyRepaymentStrategy("reduce-term")}
                      disabled={method === "interest-only"}
                    >
                      缩短期限
                    </SegmentButton>
                    <SegmentButton
                      active={earlyRepaymentStrategy === "reduce-payment"}
                      onClick={() => setEarlyRepaymentStrategy("reduce-payment")}
                    >
                      减少月供
                    </SegmentButton>
                  </div>
                  {method === "interest-only" ? (
                    <div className="mt-2 text-[10px] leading-4 text-slate-500">
                      先息后本不持续摊还本金，提前还款后仅按剩余本金降低利息。
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </ControlSection>
        </form>

        <div className="min-w-0 space-y-4">
          {calculation.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {calculation.error}
            </div>
          ) : null}

          {result ? (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
                <MetricCard label="首月月供" value={formatYuan(result.firstPayment)} />
                <MetricCard
                  label="末月还款"
                  value={formatYuan(result.lastPayment)}
                  caption={formatDateLabel(result.endDate)}
                />
                <MetricCard
                  label="总利息"
                  value={formatWan(result.totalInterest)}
                  tone="attention"
                />
                <MetricCard label="总还款" value={formatWan(result.totalRepayment)} />
                <MetricCard
                  label="预计结清"
                  value={`${result.actualMonths} 期`}
                  caption={formatDateLabel(result.endDate)}
                />
                <MetricCard
                  label={earlyRepaymentEnabled ? "节省利息" : "总资金成本"}
                  value={
                    earlyRepaymentEnabled
                      ? formatWan(savedInterest)
                      : formatWan(result.totalCost)
                  }
                  caption={
                    earlyRepaymentEnabled
                      ? shortenedMonths > 0
                        ? `缩短 ${shortenedMonths} 期`
                        : "还款期限不变"
                      : "利息 + 手续费"
                  }
                  tone={earlyRepaymentEnabled ? "positive" : "default"}
                />
              </div>

              <LoanChart result={result} theme={theme} />

              {comparisons ? (
                <section>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-950">核心方案对比</h2>
                      <p className="mt-1 text-xs text-slate-500">使用相同金额、利率、期限和提前还款设置</p>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <ScenarioCard
                      label="等额本息"
                      result={comparisons.annuity}
                      selected={method === "annuity"}
                    />
                    <ScenarioCard
                      label="等额本金"
                      result={comparisons.equalPrincipal}
                      selected={method === "equal-principal"}
                    />
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <div className="flex min-h-80 items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-6 text-center shadow-sm">
              <div>
                <CircleDollarSign className="mx-auto size-8 text-slate-400" />
                <div className="mt-3 text-sm font-semibold text-slate-950">等待有效参数</div>
                <div className="mt-1 text-xs text-slate-500">修正左侧输入后会自动重新计算</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {result ? (
        <section className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-sky-600" />
                <h2 className="text-sm font-semibold text-slate-950">还款明细</h2>
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                共 {result.actualMonths} 期；默认预览前 24 期，可按年份或期数筛选
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <FieldLabel label="还款年份">
                <select
                  value={selectedYear}
                  onChange={(event) => {
                    setSelectedYear(event.target.value);
                    setPeriodQuery("");
                  }}
                  className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-950 outline-none focus:border-sky-500"
                >
                  <option value="all">前 24 期</option>
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year} 年
                    </option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel label="查找期数">
                <input
                  type="number"
                  min="1"
                  max={result.actualMonths}
                  placeholder={`1-${result.actualMonths}`}
                  value={periodQuery}
                  onChange={(event) => setPeriodQuery(event.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 px-3 font-mono text-xs text-slate-950 outline-none focus:border-sky-500 sm:w-28"
                />
              </FieldLabel>
              <button
                type="button"
                onClick={downloadSchedule}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950"
                title="导出完整还款计划 CSV"
              >
                <ArrowDownToLine className="size-3.5" />
                导出全部
              </button>
            </div>
          </div>

          {visibleRows.length ? (
            <>
              <DesktopScheduleTable rows={visibleRows} />
              <MobileScheduleList rows={visibleRows} />
            </>
          ) : (
            <div className="px-4 py-10 text-center text-sm text-slate-500">没有找到对应的还款期数。</div>
          )}
        </section>
      ) : null}

      <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-[11px] leading-5 text-slate-500">
        计算口径：月利率 = 年利率 ÷ 12；提前还款在当期正常月供后冲减本金；实际银行还款额可因计息日、尾差、罚息和合同条款略有差异。
      </div>
    </section>
  );
}
