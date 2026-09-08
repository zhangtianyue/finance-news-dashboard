import type { FxResponse, FxSnapshot } from "./fx-rates";

export function createFxRateCache(load: () => Promise<FxSnapshot>, clock = Date.now) {
  let snapshot: FxSnapshot | null = null;
  let lastAttempt = -Infinity;
  let failed = false;
  let pending: Promise<FxResponse> | null = null;

  async function get(force = false): Promise<FxResponse> {
    const age = clock() - lastAttempt;
    const cooldown = failed ? 30_000 : force ? 60_000 : 15 * 60_000;
    if (pending) return pending;
    if (age < cooldown) {
      if (snapshot) return { snapshot, fallback: failed };
      throw new Error("FX source temporarily unavailable");
    }
    lastAttempt = clock();
    pending = (async () => {
      try {
        const next = await load();
        if (snapshot && next.rateDate < snapshot.rateDate) throw new Error("FX date regressed");
        snapshot = next;
        failed = false;
        return { snapshot, fallback: false };
      } catch (error) {
        failed = true;
        if (snapshot) return { snapshot, fallback: true };
        throw error;
      }
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }

  return { get };
}
