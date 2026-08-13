import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const defaultSource = "/Users/zhangtianyue/Desktop/output/ironman_cn_us_compare_full";
const sourceRoot = path.resolve(process.argv[2] || defaultSource);
const projectRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = path.join(projectRoot, "public", "cross-market");
const manifestPath = path.join(
  projectRoot,
  "src",
  "generated",
  "cross-market-snapshot.json",
);

async function ensureFile(filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`Not a file: ${filePath}`);
}

function replaceRequired(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Unable to patch ${label}; source package structure changed.`);
  }
  return content.replace(search, replacement);
}

function stripEmbeddedCandles(item) {
  if (!item || typeof item !== "object") return item;
  const copy = { ...item };
  delete copy.candles;
  return copy;
}

await ensureFile(path.join(sourceRoot, "index.html"));
await ensureFile(path.join(sourceRoot, "data", "dashboard-data.js"));

const dataScript = await readFile(
  path.join(sourceRoot, "data", "dashboard-data.js"),
  "utf8",
);
const context = { window: {} };
vm.runInNewContext(dataScript, context, {
  filename: "dashboard-data.js",
  timeout: 10_000,
});

const data = context.window.__MARKET_LAG_DASHBOARD__;
if (!data || !Array.isArray(data.concepts)) {
  throw new Error("The source package does not contain dashboard concepts.");
}

data.concepts.sort(
  (a, b) =>
    Number(b.discovery?.activation_score || 0) -
    Number(a.discovery?.activation_score || 0),
);

for (const concept of data.concepts) {
  concept.us.tickers = (concept.us.tickers || []).map(stripEmbeddedCandles);
  concept.us.leaders = (concept.us.leaders || []).map(stripEmbeddedCandles);
  concept.cn.companies = (concept.cn.companies || []).map(stripEmbeddedCandles);
}

if (data.dynamic_discovery) {
  delete data.dynamic_discovery.candidate_scores;
}

data.backtest = {
  available: false,
  message: "网站交付版只保留中美板块研究视图，不包含预测和回测功能。",
};

if (data.connectors?.manual_import) {
  data.connectors.manual_import = {
    status: "not_included",
    message: "网站交付版未包含个人账户导入工具。",
    artifacts: [],
  };
}

let appScript = await readFile(path.join(sourceRoot, "assets", "app.js"), "utf8");
appScript = replaceRequired(
  appScript,
  `const resolveModeFromURL = (value) => {
  const mode = String(value || "").trim();
  return ["live", "backtest", "mega-backtest", "confidence", "prediction"].includes(mode) ? mode : null;
};`,
  `const resolveModeFromURL = (value) =>
  String(value || "").trim() === "live" ? "live" : null;`,
  "URL mode guard",
);
appScript = replaceRequired(
  appScript,
  `const reportLinkStrip = (side = "us") => \`
  <a class="report-link-strip \${side === "cn" ? "cn-report" : ""}" href="./reports/latest_market_heat_report.html" target="_blank" rel="noreferrer">
    <span>最新行业热度报告</span>
    <strong>查看 9点 / 21点定时报表</strong>
  </a>
\`;`,
  `const reportLinkStrip = () => "";`,
  "missing report links",
);
appScript = replaceRequired(
  appScript,
  `state.mode = ["live", "backtest", "mega-backtest", "confidence", "prediction"].includes(nextMode) ? nextMode : "live";`,
  `state.mode = "live";`,
  "mode click guard",
);
appScript = appScript
  .replaceAll("只含沪深主板", "覆盖沪深多板块")
  .replaceAll("沪深主板行情", "A 股映射行情")
  .replaceAll("从美股概念到主板公司", "从美股主题到 A 股公司")
  .replaceAll("主板映射公司", "A 股映射公司")
  .replaceAll("只主板映射", "只 A 股映射")
  .replaceAll("${item.market} 主板", "${item.market} 市场")
  .replaceAll("${esc(item.market)} 主板", "${esc(item.market)} 市场")
  .replaceAll("当前只纳入沪深主板", "当前覆盖沪深不同上市板块")
  .replace(
    `{ label: "Market", value: "沪深主板", status: "connected", detail: "600/000 主板" },`,
    `{ label: "Market", value: "沪深市场", status: "connected", detail: "含主板/创业板/科创板" },`,
  );

let brandStyles = await readFile(
  path.join(sourceRoot, "assets", "ironman-brand.css"),
  "utf8",
);
brandStyles += `

/* The embedded delivery exposes only the live research view. */
.mode-switch {
  width: 88px !important;
  grid-template-columns: 1fr !important;
}
.mode-switch .mode-thumb {
  width: calc(100% - 6px) !important;
}
.status-rail,
.concept-scroll {
  scrollbar-width: none;
}
.status-rail::-webkit-scrollbar,
.concept-scroll::-webkit-scrollbar {
  display: none;
}
@media (min-width: 721px) {
  .status-chip {
    flex: 1 1 0;
    min-width: 86px;
  }
}
`;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "assets"), { recursive: true });
await mkdir(path.join(outputRoot, "data", "charts"), { recursive: true });

await copyFile(path.join(sourceRoot, "index.html"), path.join(outputRoot, "index.html"));
await copyFile(
  path.join(sourceRoot, "assets", "styles.css"),
  path.join(outputRoot, "assets", "styles.css"),
);
await writeFile(path.join(outputRoot, "assets", "app.js"), appScript);
await writeFile(
  path.join(outputRoot, "assets", "ironman-brand.css"),
  brandStyles,
);
await writeFile(
  path.join(outputRoot, "data", "dashboard-data.js"),
  `window.__MARKET_LAG_DASHBOARD__ = ${JSON.stringify(data)};\n`,
);

const chartRefs = new Set();
for (const concept of data.concepts) {
  for (const item of concept.us.tickers || []) {
    if (item.chart_ref) chartRefs.add(item.chart_ref);
  }
  for (const item of concept.cn.companies || []) {
    if (item.chart_ref) chartRefs.add(item.chart_ref);
  }
}

for (const chartRef of chartRefs) {
  const relativePath = String(chartRef).replace(/^\.\//, "");
  const sourcePath = path.join(sourceRoot, relativePath);
  const destinationPath = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

await mkdir(path.dirname(manifestPath), { recursive: true });
await writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      generatedAtLabel: data.generated_at_shanghai,
      conceptCount: data.concepts.length,
      universeCount: data.dynamic_discovery?.universe_count ?? null,
      chartCount: chartRefs.size,
      sourceLabel: "IRONMAN 离线研究快照",
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Imported ${data.concepts.length} concepts and ${chartRefs.size} chart files into ${outputRoot}`,
);
