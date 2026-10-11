import { qdiiGroups } from "./global-valuations";
import { positiveNumber, shanghaiDateTimeFromSeconds } from "./qdii-metrics";
import type { QdiiShareHistory } from "./qdii-metrics";
import { observationSnapshot, persistQdiiShareSnapshots } from "./qdii-share-store";

export type ShareRefreshResult = {
  ok: boolean;
  status: "ok" | "partial" | "upstream-failed" | "storage-failed";
  attempted: number;
  fetched: number;
  persisted: number;
  failedCodes: string[];
  updatedAt: string;
  storage: string;
};

let refreshPromise: Promise<ShareRefreshResult> | null = null;

async function fetchShares(code: string, deadline: number) {
  const hosts = [...new Set([`${(Number(code.slice(-2)) % 90) + 1}.push2.eastmoney.com`, "19.push2.eastmoney.com", "38.push2.eastmoney.com", "push2.eastmoney.com"])];
  for (const host of hosts) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await fetch(`https://${host}/api/qt/stock/get?secid=${code.startsWith("5") ? "1" : "0"}.${code}&fields=f84,f86`, {
        cache: "no-store", signal: AbortSignal.timeout(Math.min(2500, remaining)),
        headers: { Referer: "https://quote.eastmoney.com/", "User-Agent": "Mozilla/5.0" },
      });
      if (!response.ok) continue;
      const payload = await response.json() as { data?: { f84?: unknown; f86?: unknown } };
      const totalShares = positiveNumber(payload.data?.f84);
      if (totalShares == null) continue;
      // f86 is a quote timestamp, not a verified effective date of fund shares.
      return observationSnapshot(totalShares, shanghaiDateTimeFromSeconds(payload.data?.f86), new Date().toISOString());
    } catch {
      // Try another host within the shared time budget; no additional curl retry wave.
    }
  }
  return null;
}

export function refreshQdiiShares(): Promise<ShareRefreshResult> {
  if (refreshPromise) return refreshPromise;
  const pending = (async (): Promise<ShareRefreshResult> => {
    const codes = [...new Set(qdiiGroups.flatMap((group) => group.items.map((item) => item.code)))];
    const deadline = Date.now() + 40_000;
    const patches: QdiiShareHistory = {};
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(6, codes.length) }, async () => {
      while (cursor < codes.length && Date.now() < deadline) {
        const code = codes[cursor++];
        const snapshot = await fetchShares(code, deadline);
        if (snapshot) patches[code] = [snapshot];
      }
    }));
    const write = await persistQdiiShareSnapshots(patches);
    const fetched = Object.keys(patches).length;
    const failedCodes = codes.filter((code) => !patches[code] || write.failedCodes.includes(code));
    const status = !fetched ? "upstream-failed" : !write.persisted ? "storage-failed" : failedCodes.length ? "partial" : "ok";
    return {
      ok: status === "ok", status, attempted: codes.length, fetched,
      persisted: write.persisted, failedCodes, updatedAt: new Date().toISOString(), storage: write.storage,
    };
  })().finally(() => { refreshPromise = null; });
  refreshPromise = pending;
  return pending;
}
