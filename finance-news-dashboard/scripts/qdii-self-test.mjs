import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as metrics from "../src/lib/qdii-metrics.ts";

// Synthetic fixtures exercise production functions without touching real history or external APIs.
const code = "513500";
const now = Date.parse("2026-08-12T07:00:00Z");
const snapshot = (date, totalShares, extra = {}) => ({
  date, totalShares, dateBasis: "observed", source: "eastmoney-f84",
  sourceTime: `${date} 15:00`, recordedAt: `${date}T07:00:00.000Z`, ...extra,
});
for (const value of ["", " ", "-", "--", NaN, Infinity, null, undefined, "0x10"]) {
  assert.equal(metrics.numberOrNull(value), null);
}
assert.equal(metrics.numberOrNull("0"), 0);
assert.equal(metrics.numberOrNull("-0.25"), -0.25);
assert.equal(metrics.positiveNumber("0"), null);
assert.equal(metrics.validDate("2026-02-30"), false);
assert.equal(metrics.datePart("bad-date"), null);
const selected = metrics.selectQdiiPrice([
  { price: null, priceDate: "2026-08-11", priceTime: "2026-08-11 15:00", changePct: 1, amount: 100 },
  { price: 2.503, priceDate: "2026-08-12", priceTime: "2026-08-12 15:00", changePct: -1, amount: 200 },
]);
assert.equal(selected.price, 2.503);
assert.equal(selected.priceDate, "2026-08-12");
assert.equal(selected.changePct, -1);
assert.equal(metrics.selectQdiiPrice([
  { ...selected, price: 3, priceDate: null, priceTime: "invalid-time" }, selected,
]).price, selected.price);
assert.equal(metrics.selectQdiiPrice([
  { ...selected, price: 3, priceTime: "2026-08-12T14:59:00" }, selected,
]).price, selected.price);
const premiumArgs = { price: 2.503, nav: 2.4104, priceDate: "2026-08-12", navDate: "2026-08-12", sameProvider: true };
assert.equal(metrics.qdiiPremium({ ...premiumArgs, quotedRate: 3.84 }).premiumRate, 3.84);
assert.equal(metrics.qdiiPremium({ ...premiumArgs, quotedRate: 0 }).premiumQuality, "mismatch");
assert.ok(metrics.qdiiPremium({ ...premiumArgs, quotedRate: 0 }).premiumRate > 3.8);
assert.equal(metrics.qdiiPremium({ ...premiumArgs, nav: 0, quotedRate: 0 }).premiumRate, null);
assert.equal(metrics.qdiiPremium({ ...premiumArgs, navDate: "2026-08-11" }).premiumRate, null);
assert.equal(metrics.qdiiPremium({ ...premiumArgs, navDate: null }).premiumRate, null);
assert.equal(metrics.qdiiPremium({ ...premiumArgs, priceTime: "2026-08-12 15:00", navTime: "2026-08-12 14:50" }).premiumRate, null);
assert.equal(metrics.qdiiPremium({ ...premiumArgs, sameProvider: false, quotedRate: 3.84 }).premiumQuality, "calculated");
assert.equal(metrics.qdiiPremium({ ...premiumArgs, price: 2, nav: 2, quotedRate: 0 }).premiumRate, 0);
assert.equal(metrics.qdiiPremium({ ...premiumArgs, price: 0.0001, nav: 0.0001, quotedRate: 20 }).premiumQuality, "mismatch");

const gap = metrics.shareMetrics([snapshot("2026-07-03", 100_000_000), snapshot("2026-08-07", 120_000_000)]);
assert.equal(gap.netShareChange, 20_000_000);
assert.equal(gap.shareChangeKind, "observation");
assert.equal(metrics.shareChangePresentation(gap).range, "07-03 至 08-07");
assert.equal(metrics.shareChangePresentation(gap).label, "观察增加");
const effective = [snapshot("2026-08-11", 100_000_000, { dateBasis: "effective" }), snapshot("2026-08-12", 120_000_000, { dateBasis: "effective" })];
assert.equal(metrics.shareMetrics(effective).shareChangeKind, "interval");
assert.equal(metrics.shareMetrics(effective, "2026-08-11").shareChangeKind, "daily");
assert.equal(metrics.shareMetrics([effective[0], { ...effective[1], source: "different-basis" }]).netShareChange, null);
const legacy = metrics.parseShareHistory({ version: 1, entries: { [code]: effective } }, now);
assert.equal(metrics.shareMetrics(legacy[code]).netShareChange, null);
assert.equal(metrics.shareChangePresentation(metrics.shareMetrics(legacy[code])).emptyLabel, "日期待核验");
assert.equal(metrics.shareChangePresentation().emptyLabel, "暂无记录");
assert.equal(metrics.shareChangePresentation(metrics.shareMetrics([snapshot("2026-08-12", 100)])).emptyLabel, "待历史记录");
for (const value of [null, "invalid-json", { version: 2, entries: null }, { version: 2, entries: { [code]: {} } }]) {
  assert.deepEqual(metrics.parseShareHistory(value, now), {});
}
assert.equal(metrics.parseShareSnapshot(snapshot("2026-08-12", 0), false, now), null);
assert.equal(metrics.parseShareSnapshot(snapshot("2026-02-30", 100), false, now), null);
assert.equal(metrics.parseShareSnapshot(snapshot("2026-08-13", 100), false, now), null);
const newer = snapshot("2026-08-12", 200, { recordedAt: "2026-08-12T08:00:00Z" });
assert.equal(metrics.mergeShareSnapshots([newer], [snapshot("2026-08-12", 100)])[0].totalShares, 200);

const require = createRequire(import.meta.url);
function loadTs(relativePath, overrides = {}, globals = {}) {
  const filename = new URL(relativePath, import.meta.url);
  const source = readFileSync(filename, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cjsModule = { exports: {} };
  const context = vm.createContext({
    module: cjsModule, exports: cjsModule.exports,
    require: (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name),
    process, console, setTimeout, clearTimeout, URL, Headers, Response, AbortController, AbortSignal, TextDecoder,
    ...globals,
  });
  vm.runInContext(javascript, context, { filename: filename.pathname });
  return cjsModule.exports;
}
const store = loadTs("../src/lib/qdii-share-store.ts", { "./qdii-metrics": metrics });
const directory = await mkdtemp(join(tmpdir(), "qdii-history-test-"));
try {
  const options = { directory, redis: null, serverless: false };
  const writes = await Promise.all([
    store.persistQdiiShareSnapshots({ [code]: [snapshot("2026-08-11", 100)] }, options),
    store.persistQdiiShareSnapshots({ "159612": [snapshot("2026-08-12", 200)] }, options),
    store.persistQdiiShareSnapshots({ [code]: [snapshot("2026-08-12", 300)] }, options),
  ]);
  assert.ok(writes.every((result) => result.persisted === 1));
  const saved = await store.readQdiiShareHistory([code, "159612"], options);
  assert.equal(saved.entries[code].length, 2);
  assert.equal(saved.entries["159612"][0].totalShares, 200);
  assert.equal(JSON.parse(await readFile(join(directory, "qdii-share-snapshots-v2.json"), "utf8")).version, 2);
  const missingStorage = await store.persistQdiiShareSnapshots({ [code]: [snapshot("2026-08-12", 400)] }, { ...options, serverless: true });
  assert.equal(missingStorage.persisted, 0);
  assert.equal(missingStorage.storage, "unavailable");
  const oldTime = store.observationSnapshot(100, "2026-08-11 16:00", "2026-08-12T07:00:00Z");
  assert.equal(oldTime.date, "2026-08-11");
  assert.equal(oldTime.dateBasis, "observed");
  assert.equal(store.observationSnapshot(100, null, "2026-08-12T07:00:00Z").date, "2026-08-12");
  await writeFile(join(directory, "qdii-share-snapshots-v2.json"), "broken-json");
  const failed = await store.persistQdiiShareSnapshots({ [code]: [snapshot("2026-08-12", 400)] }, options);
  assert.equal(failed.persisted, 0);
  assert.equal(await readFile(join(directory, "qdii-share-snapshots-v2.json"), "utf8"), "broken-json");
} finally { await rm(directory, { recursive: true, force: true }); }

let commands;
const redisStore = loadTs("../src/lib/qdii-share-store.ts", { "./qdii-metrics": metrics }, {
  fetch: async (_url, options) => {
    commands = JSON.parse(options.body);
    return Response.json(commands.map((command) => command[3].endsWith("159612")
      ? { error: "simulated storage failure" } : { result: 1 }));
  },
});
const partial = await redisStore.persistQdiiShareSnapshots({ [code]: [snapshot("2026-08-12", 100)], "159612": [snapshot("2026-08-12", 200)] }, { redis: { url: "https://fixture.invalid", token: "fixture" } });
assert.equal(partial.persisted, 1);
assert.equal(partial.failedCodes[0], "159612");
assert.ok(commands.every((command) => command[0] === "EVAL"));
assert.notEqual(commands[0][3], commands[1][3]);

let shareFetches = 0;
let shareWrites = 0;
const shareGroups = { qdiiGroups: [{ items: [{ code }] }] };
const shareOverrides = {
  "./global-valuations": shareGroups, "./qdii-metrics": metrics,
  "./qdii-share-store": {
    observationSnapshot: store.observationSnapshot,
    persistQdiiShareSnapshots: async (patches) => {
      shareWrites++;
      assert.equal(patches[code][0].dateBasis, "observed");
      return { persisted: 1, failedCodes: [], storage: "local" };
    },
  },
};
const shareService = loadTs("../src/lib/qdii-shares.ts", shareOverrides, {
  fetch: async () => {
    shareFetches++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json({ data: { f84: 100, f86: Date.now() / 1000 } });
  },
});
const firstRefresh = shareService.refreshQdiiShares();
assert.equal(firstRefresh, shareService.refreshQdiiShares());
assert.equal((await firstRefresh).status, "ok");
assert.equal(shareFetches, 1);
assert.equal(shareWrites, 1);
const noSource = loadTs("../src/lib/qdii-shares.ts", {
  ...shareOverrides, "./qdii-share-store": {
    observationSnapshot: store.observationSnapshot,
    persistQdiiShareSnapshots: async (patches) => {
      assert.equal(Object.keys(patches).length, 0);
      return { persisted: 0, failedCodes: [], storage: "local" };
    },
  },
}, { fetch: async () => Response.json({ data: { f84: "", f85: 999 } }) });
assert.equal((await noSource.refreshQdiiShares()).status, "upstream-failed");
const noStorage = loadTs("../src/lib/qdii-shares.ts", {
  ...shareOverrides, "./qdii-share-store": {
    observationSnapshot: store.observationSnapshot,
    persistQdiiShareSnapshots: async () => ({ persisted: 0, failedCodes: [code], storage: "unavailable" }),
  },
}, { fetch: async () => Response.json({ data: { f84: 100 } }) });
assert.equal((await noStorage.refreshQdiiShares()).status, "storage-failed");

let apiCalls = 0;
let emptyReference = false;
let mismatchedPremium = false;
const fixtures = async (url) => {
  apiCalls++;
  await new Promise((resolve) => setTimeout(resolve, 5));
  if (url.includes("qt.gtimg.cn")) {
    const fields = Array(80).fill("");
    fields[3] = emptyReference ? "" : "2.503";
    fields[30] = "20260812145000";
    fields[32] = "0.81";
    fields[77] = emptyReference ? "" : mismatchedPremium ? "0" : "3.84";
    fields[78] = emptyReference ? "" : "2.4104";
    return new Response(`v_sh${code}="${fields.join("~")}";`);
  }
  if (url.includes("ulist.np/get")) return Response.json({ data: { diff: [{ f12: code, f2: 2.503, f3: 0.81, f6: 100, f124: Date.parse("2026-08-12T06:50:00Z") / 1000, f297: 20260812 }] } });
  if (url.includes("Fund_JJJZ_Data")) return new Response("datas:[],record:0");
  if (url.includes("fundgz")) return new Response('jsonpgz({"dwjz":"1.0","gsz":"","jzrq":"2026-08-11"});');
  if (url.includes("fundmobapi")) throw new Error("Published or cumulative NAV must not be requested as a real-time fallback");
  return new Response("{}");
};
const groups = { qdiiGroups: [{ items: [{ code }] }] };
const apiOverrides = {
  "next/server": { NextResponse: Response }, "@/lib/global-valuations": groups,
  "@/lib/qdii-metrics": metrics,
  "@/lib/qdii-share-store": { readQdiiShareHistory: async () => ({ entries: { [code]: [snapshot("2026-08-11", 100), snapshot("2026-08-12", 120)] }, degraded: false }) },
  "@/lib/qdii-shares": { refreshQdiiShares: async () => ({ status: "storage-failed", persisted: 0 }) },
};
const api = loadTs("../src/app/api/qdii/quotes/route.ts", apiOverrides, { fetch: fixtures });
const request = (search = "?live=1") => ({ nextUrl: new URL(`https://fixture.invalid/api/qdii/quotes${search}`), headers: new Headers() });
const responses = await Promise.all(Array.from({ length: 4 }, () => api.GET(request())));
const payloads = await Promise.all(responses.map((response) => response.json()));
assert.equal(apiCalls, 3);
assert.equal(payloads[0].quotes[code].premiumRate, 3.84);
assert.equal(payloads[0].quotes[code].shareChangeKind, "observation");
assert.deepEqual(payloads[0].quotes[code], payloads[3].quotes[code]);
assert.equal((await (await api.GET(request())).json()).cached, true);
const full = await (await api.GET(request("?live=1&details=1"))).json();
assert.equal(full.mode, "full");
assert.equal((await (await api.GET(request())).json()).mode, "fast");
emptyReference = true;
const emptyApi = loadTs("../src/app/api/qdii/quotes/route.ts", apiOverrides, { fetch: fixtures });
const emptyQuote = (await (await emptyApi.GET(request("?live=1&details=1"))).json()).quotes[code];
assert.equal(emptyQuote.price, 2.503);
assert.equal(emptyQuote.nav, null);
assert.equal(emptyQuote.premiumRate, null);
assert.equal(emptyQuote.status, "partial");
emptyReference = false;
mismatchedPremium = true;
const mismatchApi = loadTs("../src/app/api/qdii/quotes/route.ts", apiOverrides, { fetch: fixtures });
assert.equal((await (await mismatchApi.GET(request())).json()).quotes[code].premiumQuality, "mismatch");

const refreshApi = loadTs("../src/app/api/qdii/share-snapshots/refresh/route.ts", {
  "next/server": { NextResponse: Response },
  "@/lib/qdii-shares": { refreshQdiiShares: async () => ({ ok: false, status: "storage-failed", persisted: 0 }) },
}, { process: { env: { NODE_ENV: "production", CRON_SECRET: "fixture" } } });
assert.equal((await refreshApi.GET({ headers: new Headers() })).status, 401);
assert.equal((await refreshApi.GET({ headers: new Headers({ authorization: "Bearer fixture" }) })).status, 503);

process.stdout.write("QDII self-test passed: numeric validation, coherent prices, premium checks, date basis, interval changes, legacy isolation, atomic local history, storage failures, mode-aware caching, concurrent refreshes and cron authorization.\n");
