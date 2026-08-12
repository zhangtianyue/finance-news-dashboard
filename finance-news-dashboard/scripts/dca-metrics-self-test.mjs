import assert from "node:assert/strict";
import { calculateXirr } from "../src/lib/financial-math.ts";

const oneYearReturn = calculateXirr([
  { date: new Date("2025-01-01T00:00:00Z"), amount: -1000 },
  { date: new Date("2026-01-01T00:00:00Z"), amount: 1100 },
]);
assert.ok(oneYearReturn != null && Math.abs(oneYearReturn - 0.1) < 0.0002);

const periodicReturn = calculateXirr([
  { date: new Date("2025-01-01T00:00:00Z"), amount: -1000 },
  { date: new Date("2025-07-01T00:00:00Z"), amount: -1000 },
  { date: new Date("2026-01-01T00:00:00Z"), amount: 2200 },
]);
assert.ok(periodicReturn != null && periodicReturn > 0.13 && periodicReturn < 0.14);

assert.equal(
  calculateXirr([
    { date: new Date("2026-01-01T00:00:00Z"), amount: -1000 },
    { date: new Date("2026-01-01T00:00:00Z"), amount: 1100 },
  ]),
  null,
);

const longRangeReturn = calculateXirr([
  { date: new Date("1970-01-01T00:00:00Z"), amount: -1000 },
  { date: new Date("2026-01-01T00:00:00Z"), amount: 100_000 },
]);
assert.ok(longRangeReturn != null && longRangeReturn > 0.08 && longRangeReturn < 0.09);

process.stdout.write("dca financial metrics self-test passed\n");
