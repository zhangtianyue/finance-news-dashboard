import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mergeShareSnapshots, parseShareHistory, shanghaiDateTime } from "./qdii-metrics";
import type { QdiiShareHistory, QdiiShareSnapshot } from "./qdii-metrics";

type RedisConfig = { url: string; token: string };
type StoreOptions = { directory?: string; redis?: RedisConfig | null; serverless?: boolean };
export type ShareHistoryResult = {
  entries: QdiiShareHistory;
  storage: "redis" | "local" | "unavailable";
  degraded: boolean;
};
export type ShareWriteResult = {
  attempted: number;
  persisted: number;
  failedCodes: string[];
  storage: "redis" | "local" | "unavailable";
};

const redisPrefix = "qdii:share-snapshots:v2:";
const legacyRedisKey = "qdii:share-snapshots:v1";
const defaultDirectory = join(process.cwd(), "data", "runtime");
const legacyHistoryPath = join(process.cwd(), "data", "runtime", "qdii-share-snapshots.json");
const historyPath = join(process.cwd(), "data", "runtime", "qdii-share-snapshots-v2.json");

function configuration(options: StoreOptions) {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return {
    directory: options.directory ?? defaultDirectory,
    redis: options.redis === undefined ? url && token ? { url, token } : null : options.redis,
    serverless: options.serverless ?? Boolean(process.env.VERCEL),
  };
}

async function redisPipeline(config: RedisConfig, commands: unknown[][]) {
  const response = await fetch(`${config.url.replace(/\/$/, "")}/pipeline`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(3000),
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  const payload: unknown = await response.json();
  if (!response.ok || !Array.isArray(payload) || payload.length !== commands.length) {
    throw new Error("Share storage request failed");
  }
  return payload as Array<{ result?: unknown; error?: string }>;
}

async function readLocal(directory: string): Promise<QdiiShareHistory> {
  const entries: QdiiShareHistory = {};
  const paths = directory === defaultDirectory ? [legacyHistoryPath, historyPath] : [
    join(/* turbopackIgnore: true */ directory, "qdii-share-snapshots.json"),
    join(/* turbopackIgnore: true */ directory, "qdii-share-snapshots-v2.json"),
  ];
  for (const path of paths) {
    try {
      const file = JSON.parse(await readFile(path, "utf8"));
      if (!file || (file.version !== 1 && file.version !== 2) || !file.entries || typeof file.entries !== "object") {
        throw new Error("Invalid share history file");
      }
      const parsed = parseShareHistory(file);
      for (const [code, rows] of Object.entries(parsed)) {
        entries[code] = mergeShareSnapshots(entries[code] ?? [], rows);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return entries;
}

export async function readQdiiShareHistory(codes: string[], options: StoreOptions = {}): Promise<ShareHistoryResult> {
  const config = configuration(options);
  if (config.redis) {
    try {
      const results = await redisPipeline(config.redis, [
        ["GET", legacyRedisKey], ...codes.map((code) => ["HGETALL", `${redisPrefix}${code}`]),
      ]);
      const entries = results[0].error ? {} : parseShareHistory(results[0].result);
      let degraded = Boolean(results[0].error);
      for (let index = 0; index < codes.length; index++) {
        const result = results[index + 1];
        if (result.error || !Array.isArray(result.result)) { degraded = true; continue; }
        const rows: unknown[] = [];
        for (let i = 1; i < result.result.length; i += 2) {
          try { rows.push(JSON.parse(String(result.result[i]))); } catch { degraded = true; }
        }
        const code = codes[index];
        const parsed = parseShareHistory({ version: 2, entries: { [code]: rows } });
        entries[code] = mergeShareSnapshots(entries[code] ?? [], parsed[code] ?? []);
      }
      return { entries, storage: "redis", degraded };
    } catch {
      // Read-only fallback preserves the page, but never claims Redis is healthy.
    }
  }
  try {
    return { entries: await readLocal(config.directory), storage: "local", degraded: Boolean(config.redis) || config.serverless };
  } catch {
    return { entries: {}, storage: "unavailable", degraded: true };
  }
}

// Each ETF has its own hash. Compare timestamps and prune inside the same atomic script.
export const shareUpsertScript = `
local field = ARGV[1]
local incoming = cjson.decode(ARGV[2])
local previous = redis.call('HGET', KEYS[1], field)
if previous then
  local valid, parsed = pcall(cjson.decode, previous)
  if valid and parsed.recordedAt and parsed.recordedAt > incoming.recordedAt then return 0 end
end
redis.call('HSET', KEYS[1], field, ARGV[2])
local fields = redis.call('HKEYS', KEYS[1])
table.sort(fields, function(a, b) return string.sub(a, -10) < string.sub(b, -10) end)
for i = 1, #fields - 120 do redis.call('HDEL', KEYS[1], fields[i]) end
return 1
`;

async function writeLocal(entries: QdiiShareHistory, directory: string) {
  await mkdir(directory, { recursive: true });
  const lockPath = join(/* turbopackIgnore: true */ directory, "qdii-share-snapshots-v2.lock");
  const target = directory === defaultDirectory ? historyPath
    : join(/* turbopackIgnore: true */ directory, "qdii-share-snapshots-v2.json");
  const temporary = `${target}.${randomUUID()}.tmp`;
  let lock;
  const deadline = Date.now() + 2000;
  while (!lock) {
    try { lock = await open(lockPath, "wx"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    const history = await readLocal(directory);
    for (const [code, rows] of Object.entries(entries)) {
      history[code] = mergeShareSnapshots(history[code] ?? [], rows);
    }
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(`${JSON.stringify({ version: 2, updatedAt: new Date().toISOString(), entries: history }, null, 2)}\n`, "utf8");
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => undefined);
    await lock.close();
    await unlink(lockPath);
  }
}

export async function persistQdiiShareSnapshots(patches: QdiiShareHistory, options: StoreOptions = {}): Promise<ShareWriteResult> {
  const entries = parseShareHistory({ version: 2, entries: patches });
  const candidates = Object.entries(entries).flatMap(([code, rows]) => rows
    .filter((row) => row.dateBasis !== "legacy")
    .map((row) => ({ code, row })));
  const config = configuration(options);
  const attempted = candidates.length;
  if (!attempted) return { attempted, persisted: 0, failedCodes: [], storage: config.redis ? "redis" : "local" };
  if (config.redis) {
    try {
      const results = await redisPipeline(config.redis, candidates.map(({ code, row }) => [
        "EVAL", shareUpsertScript, 1, `${redisPrefix}${code}`, `${row.dateBasis}:${row.date}`, JSON.stringify(row),
      ]));
      const failedCodes = candidates.filter((_, i) => results[i].error
        || (results[i].result !== 0 && results[i].result !== 1)).map(({ code }) => code);
      return { attempted, persisted: attempted - failedCodes.length, failedCodes, storage: "redis" };
    } catch {
      return { attempted, persisted: 0, failedCodes: candidates.map(({ code }) => code), storage: "unavailable" };
    }
  }
  if (!config.serverless) {
    try {
      await writeLocal(entries, config.directory);
      return { attempted, persisted: attempted, failedCodes: [], storage: "local" };
    } catch {
      // A failed write must reach the refresh result instead of silently succeeding.
    }
  }
  return { attempted, persisted: 0, failedCodes: candidates.map(({ code }) => code), storage: "unavailable" };
}

export function observationSnapshot(totalShares: unknown, sourceTime: string | null, recordedAt: string): QdiiShareSnapshot | null {
  const localTime = shanghaiDateTime(new Date(recordedAt)).slice(0, 10);
  const file = parseShareHistory({ version: 2, entries: { "000000": [{
    date: sourceTime?.slice(0, 10) ?? localTime, dateBasis: "observed",
    totalShares, source: "eastmoney-f84", sourceTime, recordedAt,
  }] } });
  return file["000000"]?.[0] ?? null;
}
