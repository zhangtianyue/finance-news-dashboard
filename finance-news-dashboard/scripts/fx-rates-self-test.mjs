import assert from "node:assert/strict";
import {
  convertFxAmount, crossRate, formatFxRate, fxCurrencies, parseFxProviderRows, parseFxSnapshot,
} from "../src/lib/fx-rates.ts";
import { createFxRateCache } from "../src/lib/fx-rate-cache.ts";

const now = Date.parse("2026-09-08T08:00:00Z");
// Synthetic fixtures, not production quotes.
const rates = { USD: 1, CNH: 7, HKD: 7.8, EUR: 0.9, GBP: 0.8, AUD: 1.5, SGD: 1.3, CAD: 1.4, JPY: 150 };
const rows = fxCurrencies.filter(({ code }) => code !== "USD").map(({ code }) => ({
  base: "USD", quote: code, rate: rates[code], date: "2026-09-08",
  providers: [{ key: "CBSL", date: "2026-09-08", rate: rates[code] }],
}));
const snapshot = parseFxProviderRows(rows, now);
assert.equal(crossRate(snapshot, "USD", "CNH"), 7);
assert.equal(crossRate(snapshot, "CNH", "USD"), 1 / 7);
assert.equal(crossRate(snapshot, "JPY", "JPY"), 1);
assert.equal(crossRate(null, "JPY", "USD"), null);
for (const from of fxCurrencies) {
  for (const to of fxCurrencies) {
    const forward = crossRate(snapshot, from.code, to.code);
    const reverse = crossRate(snapshot, to.code, from.code);
    assert.ok(Math.abs(forward * reverse - 1) < 1e-12);
    assert.ok(Math.abs(forward - rates[to.code] / rates[from.code]) < 1e-12);
  }
}
assert.equal(convertFxAmount("1000", crossRate(snapshot, "USD", "CNH")), 7000);
assert.equal(convertFxAmount("0", 7), 0);
for (const amount of ["", " ", "-1", "1e999", "NaN", "1000000000001"]) {
  assert.equal(convertFxAmount(amount, 7), null);
}
assert.equal(convertFxAmount("10", null), null);
assert.equal(formatFxRate(0.0067), "0.006700");
assert.equal(formatFxRate(7.1), "7.1000");
assert.equal(parseFxSnapshot(snapshot, now)?.rateDate, "2026-09-08");
assert.equal(parseFxSnapshot({ ...snapshot, rateDate: "2026-02-30" }, now), null);
assert.equal(parseFxSnapshot({ ...snapshot, fetchedAt: "2026-10-08T00:00:00Z" }, now), null);
assert.equal(parseFxSnapshot(snapshot, now + 31 * 86_400_000), null);
assert.equal(parseFxSnapshot({ ...snapshot, rates: { ...rates, USD: 2 } }, now), null);
for (const rate of [0, -1, NaN, Infinity, "7"]) {
  assert.equal(parseFxSnapshot({ ...snapshot, rates: { ...rates, CNH: rate } }, now), null);
}
const cnyRows = rows.map((row) => row.quote === "CNH" ? { ...row, quote: "CNY" } : row);
assert.throws(() => parseFxProviderRows(cnyRows, now), /Missing/);
assert.throws(() => parseFxProviderRows([...rows, rows[0]], now), /duplicate/);
assert.throws(() => parseFxProviderRows(rows.slice(1), now), /Missing/);
assert.throws(() => parseFxProviderRows(rows.map((row, i) => i ? row : {
  ...row, date: "2026-09-07", providers: [{ ...row.providers[0], date: "2026-09-07" }],
}), now), /mismatch/);
assert.throws(() => parseFxProviderRows(rows.map((row) => ({
  ...row, providers: [{ ...row.providers[0], key: "ECB" }],
})), now), /mismatch/);
assert.throws(() => parseFxProviderRows(rows.map((row) => ({
  ...row, providers: [{ ...row.providers[0], excluded: true }],
})), now), /mismatch/);

let clock = now;
let calls = 0;
let fail = false;
let nextSnapshot = snapshot;
const cache = createFxRateCache(async () => {
  calls++;
  if (fail) throw new Error("upstream timeout");
  return nextSnapshot;
}, () => clock);
const first = await Promise.all([cache.get(), cache.get(), cache.get(true)]);
assert.equal(calls, 1);
assert.equal(first[0].fallback, false);
await cache.get(true);
assert.equal(calls, 1);
clock += 61_000;
await cache.get(true);
assert.equal(calls, 2);
fail = true;
clock += 16 * 60_000;
const fallback = await cache.get();
assert.equal(fallback.snapshot.rateDate, snapshot.rateDate);
assert.equal(fallback.fallback, true);
await cache.get(true);
assert.equal(calls, 3);
fail = false;
clock += 31_000;
assert.equal((await cache.get()).fallback, false);
nextSnapshot = { ...snapshot, rateDate: "2026-09-07" };
clock += 61_000;
assert.equal((await cache.get(true)).fallback, true);
let failures = 0;
const emptyCache = createFxRateCache(async () => { failures++; throw new Error("unavailable"); }, () => now);
await assert.rejects(emptyCache.get());
await assert.rejects(emptyCache.get());
assert.equal(failures, 1);
process.stdout.write("FX matrix self-test passed: cross rates, units, validation, date consistency, cache and failure fallback.\n");
