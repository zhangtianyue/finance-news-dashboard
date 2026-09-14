import assert from "node:assert/strict";
import { fetchPolymarketHotSnapshot, translatePolymarketItems, translatePredictionTitle } from "../src/lib/polymarket-hot.ts";

assert.equal(translatePredictionTitle("Sweden Parliamentary Election: 2nd Place"), "瑞典议会选举：哪个政党将排名第2？");
assert.equal(translatePredictionTitle("What will WTI Crude Oil (WTI) hit in September 2026?"), "WTI原油在2026年9月会触及什么价格？");
assert.equal(translatePredictionTitle("What price will Bitcoin hit in September?"), "比特币在9月会触及什么价格？");
assert.equal(translatePredictionTitle("Elon Musk # tweets September 8 - September 15, 2026?"), "埃隆·马斯克在9月8日至2026年9月15日期间会发布多少条推文？");
assert.equal(translatePredictionTitle("Unrecognized future event?"), null);

// Synthetic fixtures: reordered translations deliberately carry different prices.
const market = (id, label, probability, volume) => ({
  id, groupItemTitle: label, question: `${label}?`, active: true,
  outcomes: '["Yes","No"]', outcomePrices: JSON.stringify([probability, 1 - probability]),
  volume24hr: volume, oneDayPriceChange: 0.01,
});
const english = [{
  id: "event-1", slug: "test-fed", title: "Fed decision?", active: true,
  volume24hr: 1000, markets: [market("cut", "25 bps decrease", 0.4, 100), market("hold", "No change", 0.6, 200)],
}];
const chinese = [{
  id: "event-1", slug: "test-fed", title: "美联储利率决议？",
  markets: [market("hold", "维持不变", 0.1, 0), market("cut", "降息25个基点", 0.9, 0)],
}];
let failTranslation = false;
let failQuotes = false;
let calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  calls++;
  const localized = new URL(url).searchParams.get("locale") === "zh";
  if (localized ? failTranslation : failQuotes) throw new Error("upstream unavailable");
  return Response.json(localized ? chinese : english);
};
try {
  const [first, shared] = await Promise.all([fetchPolymarketHotSnapshot(), fetchPolymarketHotSnapshot()]);
  assert.equal(calls, 2);
  assert.equal(first, shared);
  const item = first.items[0];
  assert.equal(item.title, "Fed decision?");
  assert.equal(item.titleZh, "美联储利率决议？");
  assert.equal(item.probability, 0.6);
  assert.equal(item.probabilityLabelZh, "维持不变 60.0%");
  assert.equal(item.topOutcomes[0].labelZh, "维持不变");
  assert.equal(item.topOutcomes[1].labelZh, "降息25个基点");
  assert.equal(first.marketRelevant[0].titleZh, item.titleZh);
  assert.equal(first.movers[0].titleZh, item.titleZh);
  await fetchPolymarketHotSnapshot();
  assert.equal(calls, 2);

  failTranslation = true;
  english[0].markets[1].outcomePrices = '[0.7,0.3]';
  const second = await fetchPolymarketHotSnapshot({ force: true });
  assert.equal(second.status, "dynamic");
  assert.equal(second.items[0].probabilityLabelZh, "维持不变 70.0%");
  assert.equal(second.items[0].titleZh, item.titleZh);

  const bare = { ...item, titleZh: null, selectedOutcomeLabelZh: null, probabilityLabelZh: null };
  assert.equal(translatePolymarketItems([bare], [null, {}, { ...chinese[0], id: "wrong" }])[0].titleZh, null);
  assert.equal(translatePolymarketItems([bare], [{ ...chinese[0], slug: "wrong" }])[0].titleZh, null);
  assert.equal(translatePolymarketItems([{ ...bare, title: "Different event?" }], [], [item])[0].titleZh, null);
  const changedSelection = { ...bare, selectedOutcomeId: "new", selectedOutcomeLabel: "New outcome" };
  assert.equal(translatePolymarketItems([changedSelection], [], [item])[0].probabilityLabelZh, null);
  const englishOnly = [{ ...chinese[0], title: "Fed decision?", markets: [] }];
  assert.equal(translatePolymarketItems([bare], englishOnly)[0].titleZh, null);

  const binary = { ...bare, selectedOutcomeId: "binary", selectedOutcomeLabel: "Will rates fall" };
  const translatedBinary = [{ ...chinese[0], markets: [{
    id: "binary", question: "利率会下降吗？", outcomes: '["是","否"]',
  }] }];
  assert.equal(translatePolymarketItems([binary], translatedBinary)[0].selectedOutcomeLabelZh, "利率会下降吗");

  english[0].markets[1].groupItemTitle = "";
  english[0].markets[1].question = "Will rates stay unchanged?";
  const ungrouped = await fetchPolymarketHotSnapshot({ force: true });
  assert.equal(ungrouped.items[0].probabilityLabel, "Will rates stay unchanged 70.0%");

  failQuotes = true;
  const cached = await fetchPolymarketHotSnapshot({ force: true });
  assert.equal(cached.status, "cached");
  assert.equal(cached.items[0].probability, 0.7);
  assert.equal(cached.items[0].titleZh, item.titleZh);
  process.stdout.write("Polymarket tests passed: bilingual ID mapping, quote isolation, shared refresh, cache, missing translations and failures.\n");
} finally {
  globalThis.fetch = originalFetch;
}
