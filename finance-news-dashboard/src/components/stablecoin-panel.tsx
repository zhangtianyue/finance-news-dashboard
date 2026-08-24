import {
  AlertTriangle,
  ArrowUpRight,
  CircleDollarSign,
  Database,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import type {
  StablecoinAsset,
  StablecoinPegHealth,
  StablecoinSnapshot,
} from "@/lib/stablecoins";

function formatUsd(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(1)}K`;
  return `${sign}$${absolute.toFixed(0)}`;
}

function formatUsdYi(value: number) {
  const formatted = (value / 100_000_000).toLocaleString("zh-CN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${formatted}亿`;
}

function formatSignedUsd(value: number) {
  if (Math.abs(value) < 1_000) return "$0";
  return `${value > 0 ? "+" : ""}${formatUsd(value)}`;
}

function formatSignedPct(value: number) {
  if (Math.abs(value) < 0.005) return "0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function changeClass(value: number) {
  if (Math.abs(value) < 1_000) return "text-slate-500";
  if (value > 0) return "text-red-600";
  if (value < 0) return "text-emerald-600";
  return "text-slate-500";
}

function pegHealthMeta(health: StablecoinPegHealth) {
  if (health === "risk") {
    return { label: "明显偏离", className: "border-red-200 bg-red-50 text-red-700" };
  }
  if (health === "watch") {
    return { label: "轻微偏离", className: "border-amber-200 bg-amber-50 text-amber-800" };
  }
  if (health === "nav") {
    return { label: "净值型", className: "border-violet-200 bg-violet-50 text-violet-700" };
  }
  if (health === "normal") {
    return { label: "锚定正常", className: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  }
  return { label: "价格待更新", className: "border-slate-200 bg-slate-50 text-slate-500" };
}

function priceLabel(asset: StablecoinAsset) {
  if (asset.price == null) return "N/A";
  return `$${asset.price.toFixed(4)}`;
}

function deviationLabel(asset: StablecoinAsset) {
  if (asset.pegHealth === "nav") return "随净值累积";
  if (asset.priceDeviationPct == null) return "暂无偏离数据";
  return `${asset.priceDeviationPct > 0 ? "+" : ""}${asset.priceDeviationPct.toFixed(3)}%`;
}

function SnapshotNotice({
  snapshot,
  isLoading,
  message,
}: {
  snapshot: StablecoinSnapshot | null;
  isLoading: boolean;
  message: string | null;
}) {
  if (!message && !isLoading) return null;

  const isError = snapshot?.status === "empty";
  const isCached = snapshot?.status === "cached";
  const className = isError
    ? "border-red-200 bg-red-50 text-red-700"
    : isCached
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-slate-200 bg-white text-slate-600";

  return (
    <div className={`mb-5 flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${className}`}>
      <Database className={`size-4 shrink-0 ${isLoading ? "animate-pulse" : ""}`} />
      <span>{isLoading ? "正在更新美元稳定币规模..." : message}</span>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  valueClassName = "text-slate-950",
  className = "",
}: {
  label: string;
  value: string;
  detail: string;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <article className={`min-w-0 px-4 py-3 sm:px-5 ${className}`}>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className={`mt-1.5 truncate font-mono text-xl font-semibold tracking-normal ${valueClassName}`}>
        {value}
      </div>
      <div className="mt-1 truncate text-[11px] leading-4 text-slate-500">{detail}</div>
    </article>
  );
}

function AssetIdentity({ asset }: { asset: StablecoinAsset }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 font-mono text-[11px] font-bold text-slate-800">
        {asset.symbol.slice(0, 4)}
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-sm font-bold text-slate-950">{asset.symbol}</span>
          <span className="truncate text-xs text-slate-500">{asset.name}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
          <span>{asset.mechanismLabel}</span>
          <span>·</span>
          <span>{asset.chains.length} 条主要链</span>
        </div>
      </div>
    </div>
  );
}

function PegBadge({ asset }: { asset: StablecoinAsset }) {
  const meta = pegHealthMeta(asset.pegHealth);
  return (
    <div>
      <span className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-semibold ${meta.className}`}>
        {meta.label}
      </span>
      <div className="mt-1.5 font-mono text-xs font-semibold text-slate-800">{priceLabel(asset)}</div>
      <div className="mt-0.5 text-[10px] text-slate-500">{deviationLabel(asset)}</div>
    </div>
  );
}

function DesktopAssetTable({ assets }: { assets: StablecoinAsset[] }) {
  return (
    <div className="hidden overflow-hidden rounded-md border border-slate-200 md:block">
      <table className="w-full table-fixed border-collapse text-left">
        <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500">
          <tr>
            <th className="w-[5%] px-3 py-3 text-center">排名</th>
            <th className="w-[27%] px-3 py-3">稳定币</th>
            <th className="w-[16%] px-3 py-3 text-right">流通规模</th>
            <th className="w-[11%] px-3 py-3 text-right">1日</th>
            <th className="w-[11%] px-3 py-3 text-right">7日</th>
            <th className="w-[11%] px-3 py-3 text-right">30日</th>
            <th className="w-[19%] px-3 py-3">锚定状态</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {assets.map((asset, index) => (
            <tr key={asset.id} className="align-middle hover:bg-slate-50/70">
              <td className="px-3 py-3 text-center font-mono text-xs text-slate-400">
                {String(index + 1).padStart(2, "0")}
              </td>
              <td className="px-3 py-3"><AssetIdentity asset={asset} /></td>
              <td className="px-3 py-3 text-right">
                <div className="font-mono text-sm font-semibold text-slate-950">
                  {formatUsdYi(asset.marketCap)}
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  占比 {asset.dominance.toFixed(2)}%
                </div>
              </td>
              {[asset.change1d, asset.change7d, asset.change30d].map((change, changeIndex) => (
                <td key={changeIndex} className={`px-3 py-3 text-right font-mono text-xs font-semibold ${changeClass(change)}`}>
                  {formatSignedUsd(change)}
                </td>
              ))}
              <td className="px-3 py-3"><PegBadge asset={asset} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileAssetList({ assets }: { assets: StablecoinAsset[] }) {
  return (
    <div className="space-y-3 md:hidden">
      {assets.map((asset, index) => (
        <article key={asset.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="font-mono text-xs text-slate-400">{String(index + 1).padStart(2, "0")}</span>
              <AssetIdentity asset={asset} />
            </div>
            <PegBadge asset={asset} />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-slate-100 pt-3 text-right">
            <div className="text-left">
              <div className="text-[10px] text-slate-500">规模</div>
              <div className="mt-1 font-mono text-xs font-semibold text-slate-950">{formatUsdYi(asset.marketCap)}</div>
            </div>
            {[
              ["1日", asset.change1d],
              ["7日", asset.change7d],
              ["30日", asset.change30d],
            ].map(([label, change]) => (
              <div key={String(label)}>
                <div className="text-[10px] text-slate-500">{label}</div>
                <div className={`mt-1 font-mono text-[11px] font-semibold ${changeClass(Number(change))}`}>
                  {formatSignedUsd(Number(change))}
                </div>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function ChainDistribution({ snapshot }: { snapshot: StablecoinSnapshot }) {
  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <Layers3 className="size-4 text-sky-600" />
            <h2 className="text-sm font-semibold text-slate-950">链上分布</h2>
          </div>
          <p className="mt-1.5 text-xs leading-5 text-slate-500">按各公链美元稳定币流通规模排序</p>
        </div>
        <span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-500">
          TOP {snapshot.chains.length}
        </span>
      </div>
      <div className="space-y-4 px-4 py-5 sm:px-5">
        {snapshot.chains.map((chain, index) => (
          <div key={chain.name}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-5 font-mono text-[10px] text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                <span className="truncate font-semibold text-slate-800">{chain.name}</span>
              </div>
              <div className="shrink-0 text-right">
                <span className="font-mono font-semibold text-slate-950">{formatUsdYi(chain.marketCap)}</span>
                <span className="ml-2 font-mono text-[10px] text-slate-500">{chain.dominance.toFixed(1)}%</span>
              </div>
            </div>
            <div className="ml-7 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-sky-600"
                style={{ width: `${Math.max(chain.dominance, 0.8)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RiskOverview({ snapshot }: { snapshot: StablecoinSnapshot }) {
  const riskAssets = snapshot.alerts ?? [];

  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2">
          {snapshot.depegCount > 0 ? (
            <AlertTriangle className="size-4 text-amber-600" />
          ) : (
            <ShieldCheck className="size-4 text-emerald-600" />
          )}
          <h2 className="text-sm font-semibold text-slate-950">锚定监测</h2>
        </div>
        <p className="mt-1.5 text-xs leading-5 text-slate-500">仅统计规模超过 1 亿美元的普通美元锚定资产</p>
      </div>
      <div className="px-4 py-5 sm:px-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="font-mono text-3xl font-semibold text-slate-950">{snapshot.depegCount}</div>
            <div className="mt-1 text-xs text-slate-500">需要关注的币种</div>
          </div>
          <div className="text-right text-xs text-slate-500">
            <div>{snapshot.materialCount} 种主要稳定币</div>
            <div className="mt-1">偏离 0.3% 起提示</div>
          </div>
        </div>

        {riskAssets.length ? (
          <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
            {riskAssets.slice(0, 6).map((asset) => (
              <div key={asset.id} className="flex items-center justify-between gap-3 py-3 text-xs">
                <span className="font-mono font-semibold text-slate-900">{asset.symbol}</span>
                <span className={asset.pegHealth === "risk" ? "text-red-600" : "text-amber-700"}>
                  {priceLabel(asset)} / {deviationLabel(asset)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-xs leading-5 text-emerald-800">
            主要美元稳定币当前没有达到提示阈值的明显价格偏离。
          </div>
        )}
      </div>
    </section>
  );
}

export function StablecoinPanel({
  snapshot,
  isLoading,
  message,
}: {
  snapshot: StablecoinSnapshot | null;
  isLoading: boolean;
  message: string | null;
}) {
  if (!snapshot || !snapshot.assets.length) {
    return (
      <>
        <SnapshotNotice snapshot={snapshot} isLoading={isLoading} message={message} />
        <section className="flex min-h-72 flex-col items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-6 text-center shadow-sm">
          <CircleDollarSign className="size-8 text-slate-400" />
          <h2 className="mt-4 text-base font-semibold text-slate-950">
            {isLoading ? "正在建立稳定币规模快照" : "稳定币数据暂时不可用"}
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
            页面其他栏目不受影响；有缓存时会优先显示最近一次成功数据。
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <SnapshotNotice snapshot={snapshot} isLoading={isLoading} message={message} />

      <div className="mb-5 grid grid-cols-2 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm md:grid-cols-5 md:divide-x md:divide-slate-200">
        <SummaryCard
          label="美元稳定币总规模"
          value={formatUsdYi(snapshot.totalMarketCap)}
          detail={`覆盖 ${snapshot.trackedCount} 种美元锚定资产`}
          className="border-b border-slate-200 md:border-b-0"
        />
        <SummaryCard
          label="1日净发行"
          value={formatSignedUsd(snapshot.change1d)}
          detail={formatSignedPct(snapshot.change1dPct)}
          valueClassName={changeClass(snapshot.change1d)}
          className="border-b border-l border-slate-200 md:border-b-0 md:border-l-0"
        />
        <SummaryCard
          label="7日净发行"
          value={formatSignedUsd(snapshot.change7d)}
          detail={formatSignedPct(snapshot.change7dPct)}
          valueClassName={changeClass(snapshot.change7d)}
          className="border-b border-slate-200 md:border-b-0"
        />
        <SummaryCard
          label="30日净发行"
          value={formatSignedUsd(snapshot.change30d)}
          detail={formatSignedPct(snapshot.change30dPct)}
          valueClassName={changeClass(snapshot.change30d)}
          className="border-b border-l border-slate-200 md:border-b-0 md:border-l-0"
        />
        <SummaryCard
          label="前两大集中度"
          value={`${snapshot.topTwoDominance.toFixed(1)}%`}
          detail="USDT 与 USDC 合计占比"
          className="col-span-2 md:col-span-1"
        />
      </div>

      <div className="mb-5 grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-w-0">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">稳定币规模排名</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">按当前美元流通规模排序，变化值为流通量增减</p>
            </div>
            <a
              href={snapshot.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700 hover:text-sky-900"
            >
              {snapshot.sourceName}
              <ArrowUpRight className="size-3.5" />
            </a>
          </div>
          <DesktopAssetTable assets={snapshot.assets} />
          <MobileAssetList assets={snapshot.assets} />
        </section>

        <div className="min-w-0 space-y-5">
          <ChainDistribution snapshot={snapshot} />
          <RiskOverview snapshot={snapshot} />
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white px-4 py-3 text-[11px] leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <span>口径：仅汇总美元锚定资产；净值累积型代币不按 1 美元价格判断脱锚。</span>
        <span className="font-mono">更新于 {snapshot.updatedAtLabel}</span>
      </div>
    </>
  );
}
