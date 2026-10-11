# QDII data integrity

## Prices and premiums

- A price, its change, volume and timestamp are selected as one provider record. Empty strings and nonpositive prices/reference values are missing data, not zero.
- The normal route fetches price providers, subscription metadata and stored share history concurrently. Requests for the same mode share one in-flight request. Fast and detailed modes have separate 45-second caches; entirely missing prices retry after 5 seconds.
- Reference values from the quote feed are not guaranteed real-time fund NAV. Their displayed timestamp is the enclosing quote timestamp, not an independently verified valuation clock.
- Detailed fallback accepts a positive `gsz` estimate with its own timestamp. Published unit NAV (`dwjz`/`DWJZ`) and cumulative NAV (`LJJZ`) are never substituted for a reference estimate.
- A premium requires positive price/reference values and matching dates. Known quote timestamps more than two minutes apart are rejected. A provider premium is retained only when it agrees with the calculation within price/reference rounding tolerance; otherwise a labeled calculated result is returned.
- Display precision remains three decimals for price, four for reference value and two for premium percentage. Calculations use the unrounded numbers.

## Share observations

- `f84` is the sole share-count field. `f85` is not substituted without independently verifying its meaning.
- `f86` is treated as a quote observation timestamp, not a verified fund-share effective date. A missing timestamp uses the actual collection date and remains an observation.
- Each record retains `date`, `dateBasis`, `source`, `sourceTime` and `recordedAt`. The price date is never used to label shares.
- Differences require matching source and date basis. Observation differences are labeled observation changes, with their comparison window. They are not labeled daily net subscriptions, and are not cash flows.
- Only an effective-date source plus a verified previous trading date can produce an estimated daily net subscription figure. No such effective-date source is currently connected.
- Legacy version-1 history is preserved and shown as unverified. Its price-derived dates are not used as net-subscription baselines. Missing historical dates are not filled with today's shares or guessed values. Accurate backfill requires a separately verified historical source.
- Browsers do not calculate share changes or read their former local share history. All devices receive server calculations.

## Persistence and refresh

- Local writes merge patches under an exclusive lock and atomically rename a synced temporary file to `data/runtime/qdii-share-snapshots-v2.json`. The version-1 file is read-only.
- Redis uses one hash per ETF (`qdii:share-snapshots:v2:<code>`), with one field per date/basis. A Lua upsert prevents older recordings from replacing newer ones and retains the latest 120 fields atomically.
- Vercel requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (legacy `KV_REST_API_*` names remain supported). A storage error is never reported as successful persistence or hidden behind a serverless local-file write.
- `/api/qdii/share-snapshots/refresh` remains protected by `CRON_SECRET` in production. It collects shares without fetching prices, with six workers and a 40-second upstream budget. Its response lists attempted/fetched/persisted counts, failure codes and partial status. Zero valid data returns 502; zero successful writes returns 503.
- Keep the existing scheduled observation job. It does not require visitors to open the site. Missed observations remain explicit gaps until an authoritative historical backfill is connected.

## Verification

```sh
node --no-warnings scripts/qdii-self-test.mjs
node --no-warnings scripts/dashboard-ui-self-test.mjs
npx tsc --noEmit
```

The self-test uses synthetic quotes, temporary local history and mocked Redis/API responses. It does not query or overwrite production history. Production storage, upstream coverage and scheduled-job logs must be verified separately after deployment.
