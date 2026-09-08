"use client";

import { ArrowLeftRight, ArrowUpRight, CalendarDays, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  convertFxAmount, crossRate, formatFxCheckedAt, formatFxRate, fxCurrencies,
  fxStorageKey, parseFxSnapshot, type FxCurrency, type FxSnapshot,
} from "@/lib/fx-rates";

type Pair = { from: FxCurrency; to: FxCurrency };
type Status = "loading" | "ready" | "saved" | "error";

function readSavedSnapshot() {
  try {
    return parseFxSnapshot(JSON.parse(window.localStorage.getItem(fxStorageKey) ?? "null"));
  } catch {
    return null;
  }
}

export function FxMatrixPanel() {
  const [snapshot, setSnapshot] = useState<FxSnapshot | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [isLoading, setIsLoading] = useState(true);
  const [observedAt, setObservedAt] = useState(0);
  const [amount, setAmount] = useState("1000");
  const [pair, setPair] = useState<Pair>({ from: "USD", to: "CNH" });
  const [hovered, setHovered] = useState<Pair | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const snapshotRef = useRef<FxSnapshot | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 16_000);
    setIsLoading(true);
    setObservedAt(Date.now());
    try {
      const response = await fetch(`/api/fx${force ? "?refresh=1" : ""}`, {
        cache: "no-store", signal: controller.signal,
      });
      if (!response.ok) throw new Error("FX unavailable");
      const payload = await response.json();
      const next = parseFxSnapshot(payload?.snapshot);
      if (!next || typeof payload?.fallback !== "boolean") throw new Error("Invalid FX snapshot");
      if (requestRef.current !== controller) return;
      if (snapshotRef.current && (snapshotRef.current.rateDate > next.rateDate
        || (snapshotRef.current.rateDate === next.rateDate && snapshotRef.current.fetchedAt > next.fetchedAt))) {
        setStatus("saved");
        return;
      }
      snapshotRef.current = next;
      setSnapshot(next);
      setStatus(payload.fallback ? "saved" : "ready");
      try {
        const previous = readSavedSnapshot();
        if (!previous || previous.rateDate <= next.rateDate) {
          window.localStorage.setItem(fxStorageKey, JSON.stringify(next));
        }
      } catch {
        // Storage may be disabled; live rates still remain usable.
      }
    } catch {
      if (requestRef.current === controller) setStatus("error");
    } finally {
      window.clearTimeout(timer);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = readSavedSnapshot();
      if (saved) {
        snapshotRef.current = saved;
        setSnapshot(saved);
        setStatus("saved");
      }
      void refresh();
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15 * 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [refresh]);

  const rate = crossRate(snapshot, pair.from, pair.to);
  const converted = convertFxAmount(amount, rate);
  const amountInvalid = amount.trim() !== "" && convertFxAmount(amount, 1) == null;
  const active = hovered ?? pair;
  const oldReference = snapshot && observedAt - Date.parse(`${snapshot.rateDate}T00:00:00Z`) > 4 * 86_400_000;
  const warning = !isLoading && (status === "error" || status === "saved");
  const statusMessage = isLoading
    ? snapshot ? "正在核验更新，当前为上次数据" : "正在获取参考汇率"
    : warning
      ? snapshot ? "更新未成功，保留上次参考汇率" : "暂时无法获取汇率，请重试"
      : oldReference ? "参考日期较早，休市或数据源尚未更新" : "每日参考汇率 · 非实时成交价";

  return (
    <section aria-label="汇率矩阵" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            <CalendarDays className="size-4" aria-hidden="true" />
            参考日期 <time dateTime={snapshot?.rateDate}>{snapshot?.rateDate ?? "待获取"}</time>
          </span>
          {snapshot && <span>获取于 {formatFxCheckedAt(snapshot.fetchedAt)} 北京时间</span>}
        </div>
        <button type="button" onClick={() => void refresh(true)} disabled={isLoading}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60">
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} aria-hidden="true" />
          {isLoading ? "更新中" : "更新汇率"}
        </button>
      </div>

      <div className="fx-converter mb-5 grid items-end gap-3 border-y border-slate-200 py-4">
        <label className="fx-converter-wide min-w-0 text-xs font-medium text-slate-500">
          金额
          <input aria-label="换算金额" type="number" inputMode="decimal" min="0" max="1000000000000" step="any"
            value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={amountInvalid}
            className="mt-2 h-10 w-full min-w-0 rounded border border-slate-300 bg-white px-3 font-mono text-sm text-slate-950" />
        </label>
        <label className="min-w-0 text-xs font-medium text-slate-500">
          原币种
          <select aria-label="原币种" value={pair.from} onChange={(event) => setPair({ ...pair, from: event.target.value as FxCurrency })}
            className="mt-2 h-10 w-full min-w-0 rounded border border-slate-300 bg-white px-2 text-xs text-slate-950">
            {fxCurrencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} {currency.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setPair({ from: pair.to, to: pair.from })}
          aria-label="交换币种" title="交换币种"
          className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50">
          <ArrowLeftRight className="size-4" aria-hidden="true" />
        </button>
        <label className="min-w-0 text-xs font-medium text-slate-500">
          目标币种
          <select aria-label="目标币种" value={pair.to} onChange={(event) => setPair({ ...pair, to: event.target.value as FxCurrency })}
            className="mt-2 h-10 w-full min-w-0 rounded border border-slate-300 bg-white px-2 text-xs text-slate-950">
            {fxCurrencies.map((currency) => <option key={currency.code} value={currency.code}>{currency.code} {currency.name}</option>)}
          </select>
        </label>
        <div className="fx-converter-wide min-w-0">
          <div className="text-xs font-medium text-slate-500">参考兑换金额</div>
          <output aria-label="参考兑换金额" aria-live="polite" className="mt-2 flex min-h-10 flex-wrap items-center gap-x-2 break-all font-mono text-lg font-semibold text-slate-950">
            {converted == null ? "—" : converted.toLocaleString("en-US", {
              minimumFractionDigits: pair.to === "JPY" ? 0 : 2, maximumFractionDigits: pair.to === "JPY" ? 0 : 2,
            })}
            <span className="text-xs font-medium text-slate-500">{pair.to}</span>
          </output>
        </div>
      </div>
      {amountInvalid && <p role="alert" className="mb-3 text-xs text-red-600">金额须在 0 至 1 万亿之间。</p>}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        <p className="font-mono text-sm font-semibold text-slate-800" aria-live="polite">
          1 {pair.from} = {formatFxRate(rate)} {pair.to}
        </p>
        <p role="status" className={warning || oldReference ? "text-amber-700" : "text-slate-500"}>{statusMessage}</p>
      </div>

      <div className="fx-matrix-scroll overflow-auto rounded-md border border-slate-200 bg-white"
        tabIndex={0} role="region" aria-label="九币种交叉汇率表" aria-busy={isLoading}>
        <table className="fx-matrix w-full table-fixed border-separate border-spacing-0 text-center">
          <caption className="sr-only">每个单元格表示 1 单位行币种可兑换的列币种数量，均为每日参考汇率。</caption>
          <thead>
            <tr>
              <th scope="col" className="fx-corner bg-slate-50 px-2 text-[10px] font-medium leading-5 text-slate-500">原币种 ↓<br />目标币种 →</th>
              {fxCurrencies.map((currency) => (
                <th key={currency.code} scope="col" className={`px-1 py-3 ${active.to === currency.code ? "bg-sky-50" : "bg-slate-50"}`}>
                  <span className="block font-mono text-sm font-semibold text-slate-900">{currency.code}</span>
                  <span className="mt-1 block text-[10px] font-normal text-slate-500">{currency.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody onMouseLeave={() => setHovered(null)}>
            {fxCurrencies.map((from) => (
              <tr key={from.code}>
                <th scope="row" className={`px-2 py-3 text-left ${active.from === from.code ? "bg-sky-50" : "bg-white"}`}>
                  <span className="block font-mono text-sm font-semibold text-slate-900">{from.code}</span>
                  <span className="mt-1 block text-[10px] font-normal text-slate-500">{from.name}</span>
                </th>
                {fxCurrencies.map((to) => {
                  const cellRate = crossRate(snapshot, from.code, to.code);
                  const diagonal = from.code === to.code;
                  const selected = pair.from === from.code && pair.to === to.code;
                  const highlighted = active.from === from.code || active.to === to.code;
                  return (
                    <td key={to.code} className={diagonal ? "bg-slate-50 text-slate-400" : highlighted ? "bg-sky-50" : "bg-white"}>
                      {diagonal ? <span aria-label="相同币种">—</span> : (
                        <button type="button" disabled={cellRate == null}
                          aria-label={`1 ${from.code} = ${formatFxRate(cellRate)} ${to.code}`}
                          aria-pressed={selected} title={`1 ${from.name} = ${formatFxRate(cellRate)} ${to.name}`}
                          onClick={() => setPair({ from: from.code, to: to.code })}
                          onMouseEnter={() => setHovered({ from: from.code, to: to.code })}
                          onFocus={() => setHovered({ from: from.code, to: to.code })} onBlur={() => setHovered(null)}
                          className={`flex h-[62px] w-full items-center justify-center px-1 font-mono text-xs tabular-nums text-slate-900 outline-offset-[-3px] transition-colors hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-sky-500 xl:text-sm ${selected ? "font-bold ring-2 ring-inset ring-sky-500" : "font-medium"}`}>
                          {formatFxRate(cellRate)}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-6 gap-y-2 text-[11px] leading-5 text-slate-500">
        <p>CNH 为离岸人民币，不等同于在岸 CNY。参考换算不含银行点差及手续费。</p>
        <a href="https://frankfurter.dev/providers/" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:text-slate-800">
          Frankfurter / 斯里兰卡央行 <ArrowUpRight className="size-3" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
