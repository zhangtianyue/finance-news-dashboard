import assert from "node:assert/strict";
import {
  hasOlderShareSnapshot, persistDashboardTheme, qdiiQuoteTimeLabel, resolveDashboardTheme,
} from "../src/lib/dashboard-ui.ts";

const blocked = () => { throw new Error("storage blocked"); };
assert.equal(resolveDashboardTheme(() => "dark", false), "dark");
assert.equal(resolveDashboardTheme(() => "light", true), "light");
assert.equal(resolveDashboardTheme(() => null, true), "dark");
assert.equal(resolveDashboardTheme(() => "invalid", false), "light");
assert.equal(resolveDashboardTheme(blocked, true), "dark");
assert.equal(resolveDashboardTheme(blocked, false), "light");
let saved;
persistDashboardTheme("dark", (theme) => { saved = theme; });
assert.equal(saved, "dark");
assert.doesNotThrow(() => persistDashboardTheme("light", blocked));

// Synthetic dates and prices verify presentation, not market data.
const quote = { price: 2, priceDate: "2026-09-30", priceTime: "2026-09-30 16:14:00" };
assert.equal(qdiiQuoteTimeLabel([]), "行情待更新");
assert.equal(qdiiQuoteTimeLabel([quote]), "行情 2026-09-30 16:14 北京时间");
assert.equal(qdiiQuoteTimeLabel([{ ...quote, priceTime: null }]), "行情 2026-09-30 北京时间");
assert.equal(qdiiQuoteTimeLabel([quote, { ...quote, price: null, priceDate: "2026-10-04", priceTime: "2026-10-04 09:00" }]), "行情 2026-09-30 16:14 北京时间");
assert.equal(qdiiQuoteTimeLabel([quote, { ...quote, priceDate: "2026-09-29", priceTime: "2026-09-29T15:00" }]), "行情 2026-09-30 16:14 北京时间 · 部分日期不同");
assert.equal(qdiiQuoteTimeLabel([{ ...quote, price: Infinity }]), "行情待更新");
assert.equal(qdiiQuoteTimeLabel([{ ...quote, price: 0 }]), "行情待更新");
assert.equal(hasOlderShareSnapshot({ priceDate: "2026-09-30", totalSharesDate: "2026-07-03" }), true);
assert.equal(hasOlderShareSnapshot({ priceDate: "2026-09-30", totalSharesDate: "2026-09-30" }), false);
assert.equal(hasOlderShareSnapshot({ priceDate: "2026-09-30", totalSharesDate: null }), false);
assert.equal(hasOlderShareSnapshot(undefined), false);
process.stdout.write("Dashboard UI self-test passed: blocked storage, theme fallback, quote timestamps and old share snapshots.\n");
