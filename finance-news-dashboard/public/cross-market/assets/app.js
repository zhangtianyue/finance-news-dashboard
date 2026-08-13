const app = document.querySelector("#app");
window.__MARKET_LAG_APP_VERSION__ = "20260717-full-market-rescan-v1";

let state = {
  data: null,
  mode: "live",
  activeId: null,
  backtestDate: null,
  backtestActiveId: null,
  megaBacktestActiveId: null,
  megaMetric: "return_5d",
  confidenceActiveId: null,
  confidenceHorizon: 5,
  confidenceMinScore: 10,
  selectedAsset: null,
  usMenuOpen: false,
  cnMenuOpen: false,
  chartRange: "1M",
  chartCache: {},
  chartLoading: {},
};

const resolveModeFromURL = (value) =>
  String(value || "").trim() === "live" ? "live" : null;

const readScrollSnapshot = () => ({
  windowX: window.scrollX || 0,
  windowY: window.scrollY || 0,
  us: document.querySelector(".us-side")?.scrollTop || 0,
  cn: document.querySelector(".cn-side")?.scrollTop || 0,
  backtest: document.querySelector(".backtest-dashboard")?.scrollTop || 0,
});

const restoreScrollSnapshot = (snapshot) => {
  if (!snapshot) return;
  const restore = () => {
    const usSide = document.querySelector(".us-side");
    const cnSide = document.querySelector(".cn-side");
    if (usSide) usSide.scrollTop = snapshot.us;
    if (cnSide) cnSide.scrollTop = snapshot.cn;
    const backtestDashboard = document.querySelector(".backtest-dashboard");
    if (backtestDashboard) backtestDashboard.scrollTop = snapshot.backtest || 0;
    window.scrollTo(snapshot.windowX || 0, snapshot.windowY || 0);
  };
  restore();
  requestAnimationFrame(restore);
  setTimeout(restore, 60);
  setTimeout(restore, 180);
};

const pct = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const parsed = Number(value);
  const sign = parsed > 0 ? "+" : "";
  return `${sign}${parsed.toFixed(2)}%`;
};

const num = (value, digits = 2) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
};

const prob = (value, digits = 0) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(digits)}%`;
};

const clsMove = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "";
  return Number(value) >= 0 ? "up" : "down";
};

const statusClass = (value) => {
  const text = String(value || "").toLowerCase();
  if (["connected", "ok"].some((item) => text.includes(item))) return "status-ok";
  if (["disabled_free_mode", "public_only", "manual_import_optional"].some((item) => text.includes(item))) return "status-ok";
  if (["needs_login", "not_configured", "fallback", "unknown"].some((item) => text.includes(item))) return "status-warn";
  return "status-bad";
};

const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const shortDate = (value) => {
  const text = String(value || "");
  return text.length >= 10 ? text.slice(5, 10) : text;
};

const axisDate = (value, range = state.chartRange) => {
  const text = String(value || "");
  if (["3Y", "5Y"].includes(range)) return text.length >= 7 ? text.slice(0, 7) : text;
  if (range === "1Y") return text.length >= 10 ? text.slice(2, 10) : text;
  return shortDate(text);
};

const compactAmount = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const parsed = Number(value);
  if (Math.abs(parsed) >= 100000000) return `${(parsed / 100000000).toFixed(2)}亿`;
  if (Math.abs(parsed) >= 10000) return `${(parsed / 10000).toFixed(2)}万`;
  return parsed.toFixed(0);
};

const chartRanges = [
  { key: "1M", label: "1月", period: "1个月", count: 22 },
  { key: "3M", label: "3月", period: "3个月", count: 66 },
  { key: "6M", label: "6月", period: "6个月", count: 126 },
  { key: "1Y", label: "1年", period: "1年", count: 252 },
  { key: "3Y", label: "3年", period: "3年", count: 756 },
  { key: "5Y", label: "5年", period: "5年", count: 1260 },
];

const rangeRows = (rows = [], range = state.chartRange) => {
  const meta = chartRanges.find((item) => item.key === range) || chartRanges.find((item) => item.key === "1M");
  if (!Number.isFinite(meta.count)) return rows;
  return rows.slice(-meta.count);
};

const miniChart = (rows = [], options = {}) => {
  const chartRows = rows
    .map((row) => ({ ...row, close: Number(row.close) }))
    .filter((row) => Number.isFinite(row.close));
  const values = chartRows.map((row) => row.close);
  if (values.length < 2) {
    return `<div class="mini-chart"><svg viewBox="0 0 180 58" aria-hidden="true"></svg><div class="chart-axis"><span>${esc(options.period || "走势")}</span><span>暂无数据</span></div></div>`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 170 + 5;
      const y = 48 - ((value - min) / range) * 38;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const markerIndex = options.markerDate ? chartRows.findIndex((row) => row.date === options.markerDate) : -1;
  const markerValue = markerIndex >= 0 ? chartRows[markerIndex].close : null;
  const markerX = markerIndex >= 0 ? (markerIndex / (values.length - 1)) * 170 + 5 : null;
  const markerY = Number.isFinite(markerValue) ? 48 - ((markerValue - min) / range) * 38 : null;
  const markerSvg =
    markerIndex >= 0
      ? `<line class="mini-backtest-line" x1="${markerX.toFixed(1)}" y1="8" x2="${markerX.toFixed(
          1,
        )}" y2="50"></line><circle class="mini-backtest-dot" cx="${markerX.toFixed(1)}" cy="${markerY.toFixed(1)}" r="3"></circle>`
      : "";
  const firstDate = chartRows[0]?.date || "";
  const lastDate = chartRows[chartRows.length - 1]?.date || "";
  return `
    <div class="mini-chart" aria-label="${esc(options.period || "走势")}">
      <svg viewBox="0 0 180 58" aria-hidden="true">
        <line class="chart-grid" x1="5" y1="10" x2="175" y2="10"></line>
        <line class="chart-grid" x1="5" y1="29" x2="175" y2="29"></line>
        <line class="chart-grid" x1="5" y1="48" x2="175" y2="48"></line>
        <path d="M ${points.replaceAll(" ", " L ")}"></path>
        ${markerSvg}
      </svg>
      <div class="chart-axis">
        <span>${esc(options.period || "")} ${esc(shortDate(firstDate))}-${esc(shortDate(lastDate))}</span>
        <span>${num(min)} / ${num(max)}</span>
      </div>
    </div>
  `;
};

const renderKlineChart = (rows = [], options = {}) => {
  const selectedRange = options.range || state.chartRange;
  const selectedRangeMeta =
    chartRanges.find((item) => item.key === selectedRange) || chartRanges.find((item) => item.key === "1M");
  const candles = rangeRows(rows, selectedRange)
    .map((row) => {
      const close = Number(row.close);
      if (!Number.isFinite(close)) return null;
      const open = Number.isFinite(Number(row.open)) ? Number(row.open) : close;
      const high = Number.isFinite(Number(row.high)) ? Number(row.high) : Math.max(open, close);
      const low = Number.isFinite(Number(row.low)) ? Number(row.low) : Math.min(open, close);
      const volume = Number.isFinite(Number(row.volume)) ? Number(row.volume) : 0;
      return {
        date: row.date || "",
        open,
        high: Math.max(high, open, close),
        low: Math.min(low, open, close),
        close,
        volume,
      };
    })
    .filter(Boolean);

  if (candles.length < 2) {
    return `
      <div class="kline-shell">
        <div class="chart-range-bar">
          ${chartRanges
            .map(
              (range) =>
                `<button class="chart-range-button ${range.key === selectedRange ? "active" : ""}" type="button" data-chart-range="${range.key}" onclick="window.__marketLagSetChartRange && window.__marketLagSetChartRange('${range.key}')">${range.label}</button>`,
            )
            .join("")}
        </div>
        <div class="empty">暂无足够K线数据。刷新数据后会读取开高低收和成交量。</div>
      </div>
    `;
  }

  const width = 780;
  const height = 318;
  const left = 62;
  const right = 18;
  const top = 18;
  const priceBottom = 224;
  const volumeTop = 244;
  const volumeBottom = 286;
  const plotWidth = width - left - right;
  const priceHeight = priceBottom - top;
  const maxPrice = Math.max(...candles.map((row) => row.high));
  const minPrice = Math.min(...candles.map((row) => row.low));
  const priceRange = maxPrice - minPrice || Math.max(maxPrice, 1) * 0.01;
  const maxVolume = Math.max(...candles.map((row) => row.volume), 1);
  const band = plotWidth / candles.length;
  const bodyWidth = Math.max(3, Math.min(10, band * 0.56));
  const y = (value) => top + ((maxPrice - value) / priceRange) * priceHeight;
  const yVolume = (value) => volumeBottom - (value / maxVolume) * (volumeBottom - volumeTop);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => maxPrice - ratio * priceRange);
  const xForIndex = (index) => left + index * band + band / 2;
  const xLabels = [0, Math.floor((candles.length - 1) / 2), candles.length - 1]
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .map((index, labelIndex, arr) => ({
      index,
      x: xForIndex(index),
      anchor: labelIndex === 0 ? "start" : labelIndex === arr.length - 1 ? "end" : "middle",
      date: axisDate(candles[index].date, selectedRange),
    }));
  const markerIndex = options.markerDate ? candles.findIndex((row) => row.date === options.markerDate) : -1;
  const markerCandle = markerIndex >= 0 ? candles[markerIndex] : null;
  const markerX = markerIndex >= 0 ? xForIndex(markerIndex) : null;
  const markerY = markerCandle ? y(options.markerValue || markerCandle.close) : null;
  const markerSvg = markerCandle
    ? `
      <g class="backtest-marker">
        <line x1="${markerX.toFixed(2)}" y1="${top}" x2="${markerX.toFixed(2)}" y2="${volumeBottom}"></line>
        <circle cx="${markerX.toFixed(2)}" cy="${markerY.toFixed(2)}" r="5"></circle>
        <text x="${Math.min(markerX + 8, width - 94).toFixed(2)}" y="${Math.max(markerY - 10, top + 12).toFixed(
          2,
        )}">${esc(options.markerLabel || "回测点")}</text>
      </g>
    `
    : "";

  const candleSvg = candles
    .map((row, index) => {
      const x = xForIndex(index);
      const openY = y(row.open);
      const closeY = y(row.close);
      const highY = y(row.high);
      const lowY = y(row.low);
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(Math.abs(closeY - openY), 1.6);
      const up = row.close >= row.open;
      const volumeY = yVolume(row.volume);
      const hoverX = left + index * band;
      const change = row.open ? ((row.close - row.open) / row.open) * 100 : 0;
      return `
        <g class="candle ${up ? "up" : "down"}">
          <line class="wick" x1="${x.toFixed(2)}" y1="${highY.toFixed(2)}" x2="${x.toFixed(2)}" y2="${lowY.toFixed(2)}"></line>
          <rect class="candle-body" x="${(x - bodyWidth / 2).toFixed(2)}" y="${bodyTop.toFixed(
            2,
          )}" width="${bodyWidth.toFixed(2)}" height="${bodyHeight.toFixed(2)}"></rect>
          <rect class="volume-bar" x="${(x - bodyWidth / 2).toFixed(2)}" y="${volumeY.toFixed(
            2,
          )}" width="${bodyWidth.toFixed(2)}" height="${Math.max(volumeBottom - volumeY, 1).toFixed(2)}"></rect>
          <rect class="hover-zone" x="${hoverX.toFixed(2)}" y="${top}" width="${Math.max(
            band,
            1,
          ).toFixed(2)}" height="${volumeBottom - top}"
            data-date="${esc(row.date)}"
            data-open="${num(row.open)}"
            data-high="${num(row.high)}"
            data-low="${num(row.low)}"
            data-close="${num(row.close)}"
            data-change="${pct(change)}"
            data-volume="${compactAmount(row.volume)}"
            data-x="${x.toFixed(2)}"></rect>
        </g>
      `;
    })
    .join("");

  const periodLabel = `${selectedRangeMeta.period}${String(options.period || "").includes("复权") ? "复权" : ""}日K`;
  const firstDate = candles[0]?.date || "";
  const lastDate = candles[candles.length - 1]?.date || "";
  return `
    <div class="kline-shell">
      <div class="chart-range-bar" aria-label="K线周期">
        <div class="chart-period-label">${esc(periodLabel)} · ${esc(firstDate)}-${esc(lastDate)}</div>
        <div class="chart-range-buttons">
          ${chartRanges
            .map(
              (range) =>
                `<button class="chart-range-button ${range.key === selectedRange ? "active" : ""}" type="button" data-chart-range="${range.key}" onclick="window.__marketLagSetChartRange && window.__marketLagSetChartRange('${range.key}')">${range.label}</button>`,
            )
            .join("")}
        </div>
      </div>
      <div class="kline-chart-wrap">
        <svg class="kline-chart ${options.isUs ? "us" : "cn"}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(
          periodLabel,
        )}K线图">
          <rect class="chart-plot-bg" x="${left}" y="${top}" width="${plotWidth}" height="${priceBottom - top}"></rect>
          ${ticks
            .map((tick) => {
              const ty = y(tick);
              return `
                <line class="price-grid" x1="${left}" y1="${ty.toFixed(2)}" x2="${width - right}" y2="${ty.toFixed(
                  2,
                )}"></line>
                <text class="y-label" x="${left - 8}" y="${(ty + 3).toFixed(2)}">${num(tick)}</text>
              `;
            })
            .join("")}
          <line class="volume-baseline" x1="${left}" y1="${volumeBottom}" x2="${width - right}" y2="${volumeBottom}"></line>
          ${xLabels
            .map(
              (label) =>
                `<text class="x-label" x="${label.x.toFixed(2)}" y="${height - 12}" style="text-anchor:${label.anchor}">${esc(
                  label.date,
                )}</text>`,
            )
            .join("")}
          <line class="chart-hover-line" x1="0" y1="${top}" x2="0" y2="${volumeBottom}"></line>
          ${candleSvg}
          ${markerSvg}
        </svg>
        <div class="chart-tooltip" hidden></div>
      </div>
    </div>
  `;
};

const connector = (label, value, detail = "") => `
  <div class="connector">
    <div class="connector-label">${esc(label)}</div>
    <div class="connector-value ${statusClass(value)}">${esc(value || "-")}</div>
    <div class="connector-detail">${esc(detail || "")}</div>
  </div>
`;

const chevronIcon = (open = false) => `
  <svg class="chevron-icon ${open ? "open" : ""}" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M5.5 7.5L10 12l4.5-4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>
`;

const closeIcon = () => `
  <svg class="close-icon" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M5.8 5.8l8.4 8.4M14.2 5.8l-8.4 8.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
  </svg>
`;

const riskText = (scores = {}) => (scores.risk_flags?.length ? scores.risk_flags.join(" / ") : "无硬性风险");

const riskBadges = (scores = {}) => {
  const flags = scores.risk_flags || [];
  if (!flags.length && !scores.action) return "";
  return `
    <div class="risk-badges">
      ${scores.action ? `<span class="risk-badge action">${esc(scores.action)}</span>` : ""}
      ${flags.map((flag) => `<span class="risk-badge">${esc(flag)}</span>`).join("")}
    </div>
  `;
};

const heatLabel = (concept) => `实时热度 ${num(
  concept.scores.market_heat_score ?? concept.discovery?.heat_score ?? concept.scores.research_heat_score ?? concept.scores.lag_score,
  1,
)}`;

const statusRail = (items) => `
  <div class="status-rail" aria-label="数据源状态">
    ${items
      .map(
        (item) => `
          <div class="status-chip">
            <span class="status-chip-label">${esc(item.label)}</span>
            <strong class="${statusClass(item.status || item.value)}">${esc(item.value || "-")}</strong>
            <small>${esc(item.detail || "")}</small>
          </div>
        `,
      )
      .join("")}
  </div>
`;

const reportLinkStrip = () => "";

const renderScanAudit = () => {
  const scan = state.data?.dynamic_discovery || {};
  const coverage = scan.coverage_examples || {};
  const labels = { banking: "银行", storage: "存储", consumer: "消费", liquor: "白酒" };
  const items = Object.entries(labels).map(([key, label]) => {
    const item = coverage[key] || {};
    if (!item.scanned) return `${label} 未取得数据`;
    if (item.selected) return `${label} 入选 #${item.universe_rank ?? "--"}`;
    return `${label} 已扫描${item.universe_rank ? ` #${item.universe_rank}` : ""} · 未入选`;
  });
  const fallback = scan.fallback ? ` · 降级：${scan.fallback}` : "";
  return `
    <div class="scan-audit-strip" aria-label="全市场板块重筛状态">
      <strong>全市场重筛 ${esc(scan.universe_count ?? "--")} → ${esc(scan.selected_count ?? state.data?.concepts?.length ?? "--")}${esc(fallback)}</strong>
      <span>${items.map(esc).join(" / ")}</span>
    </div>
  `;
};

const renderModeSwitch = () => {
  const thumbClass =
    state.mode === "prediction"
      ? "fifth"
      : state.mode === "confidence"
        ? "fourth"
        : state.mode === "mega-backtest"
          ? "third"
          : state.mode === "backtest"
            ? "second"
            : "";
  return `
    <div class="mode-switch" role="tablist" aria-label="看板模式">
      <button class="${state.mode === "live" ? "active" : ""}" type="button" role="tab" aria-selected="${
        state.mode === "live" ? "true" : "false"
      }" data-mode="live">实时</button>
      <button class="${state.mode === "backtest" ? "active" : ""}" type="button" role="tab" aria-selected="${
        state.mode === "backtest" ? "true" : "false"
      }" data-mode="backtest">回测</button>
      <button class="${state.mode === "mega-backtest" ? "active" : ""}" type="button" role="tab" aria-selected="${
        state.mode === "mega-backtest" ? "true" : "false"
      }" data-mode="mega-backtest">大回测</button>
      <button class="${state.mode === "confidence" ? "active" : ""}" type="button" role="tab" aria-selected="${
        state.mode === "confidence" ? "true" : "false"
      }" data-mode="confidence">置信度</button>
      <button class="${state.mode === "prediction" ? "active" : ""}" type="button" role="tab" aria-selected="${
        state.mode === "prediction" ? "true" : "false"
      }" data-mode="prediction">预测</button>
      <button type="button" role="tab" aria-selected="false" data-mode="a-share">A股</button>
      <span class="mode-thumb ${thumbClass}" aria-hidden="true"></span>
    </div>
  `;
};

const metric = (label, value, extraClass = "") => `
  <div class="metric">
    <div class="metric-label muted">${esc(label)}</div>
    <div class="metric-value ${extraClass}">${esc(value)}</div>
  </div>
`;

const activeConcept = () => state.data.concepts.find((concept) => concept.id === state.activeId) || state.data.concepts[0];

const backtestData = () => state.data?.backtest || {};
const followModelData = () => backtestData().follow_model || {};

const followRankedConcepts = () => followModelData().concepts || [];

const activeFollowConcept = () => {
  const concepts = followRankedConcepts();
  if (!concepts.length) return null;
  return concepts.find((concept) => concept.id === state.backtestActiveId) || concepts[0];
};

const activeBacktestSnapshot = () => {
  const backtest = backtestData();
  if (!backtest.available) return null;
  const selectedDate = state.backtestDate || backtest.default_date || backtest.date_options?.[0]?.date;
  return backtest.snapshots?.[selectedDate] || null;
};

const activeBacktestConcept = () => {
  const snapshot = activeBacktestSnapshot();
  if (!snapshot?.concepts?.length) return null;
  return snapshot.concepts.find((concept) => concept.id === state.backtestActiveId) || snapshot.concepts[0];
};

const liveConceptById = (id) => state.data?.concepts?.find((concept) => concept.id === id) || null;

const liveCompanyByCode = (conceptId, code) => {
  const concept = liveConceptById(conceptId);
  return concept?.cn?.companies?.find((item) => item.code === code) || null;
};

const ensureBacktestSelection = () => {
  const backtest = backtestData();
  if (!backtest.available) return;
  const followConcepts = followRankedConcepts();
  if (followConcepts.length && !followConcepts.some((concept) => concept.id === state.backtestActiveId)) {
    state.backtestActiveId = followConcepts[0].id;
  }
  if (!state.backtestDate || !backtest.snapshots?.[state.backtestDate]) {
    state.backtestDate = backtest.default_date || backtest.date_options?.[0]?.date || null;
  }
  const snapshot = activeBacktestSnapshot();
  if (!followConcepts.length && snapshot?.concepts?.length && !snapshot.concepts.some((concept) => concept.id === state.backtestActiveId)) {
    state.backtestActiveId = snapshot.concepts[0].id;
  }
};

const ensurePredictionSelection = () => {
  ensureBacktestSelection();
};

const megaBacktestAnchorSnapshot = () => {
  const backtest = backtestData();
  if (!backtest.available) return null;
  return (
    backtest.snapshots?.[backtest.latest_date] ||
    backtest.snapshots?.[backtest.default_date] ||
    backtest.snapshots?.[backtest.date_options?.[0]?.date] ||
    null
  );
};

const megaBacktestConcepts = () => rankedBacktestConcepts(megaBacktestAnchorSnapshot(), "opportunity");

const activeMegaBacktestConcept = () => {
  const concepts = megaBacktestConcepts();
  if (!concepts.length) return null;
  return concepts.find((concept) => concept.id === state.megaBacktestActiveId) || concepts[0];
};

const ensureMegaBacktestSelection = () => {
  const concepts = megaBacktestConcepts();
  if (concepts.length && !concepts.some((concept) => concept.id === state.megaBacktestActiveId)) {
    state.megaBacktestActiveId = concepts[0].id;
  }
};

const confidenceRankedConcepts = () => followRankedConcepts();

const activeConfidenceConcept = () => {
  const concepts = confidenceRankedConcepts();
  if (!concepts.length) return null;
  return concepts.find((concept) => concept.id === state.confidenceActiveId) || concepts[0];
};

const ensureConfidenceSelection = () => {
  const concepts = confidenceRankedConcepts();
  if (concepts.length && !concepts.some((concept) => concept.id === state.confidenceActiveId)) {
    state.confidenceActiveId = concepts[0].id;
  }
};

const unique = (values = []) => [...new Set(values.filter(Boolean))];

const roleSummary = (companies = []) =>
  unique(
    companies.map((item) =>
      String(item.role || "")
        .split(/[\/、]/)[0]
        .trim(),
    ),
  )
    .slice(0, 5)
    .join(" / ");

const sumAmount = (companies = []) =>
  companies.reduce((total, item) => total + (Number.isFinite(Number(item.amount)) ? Number(item.amount) : 0), 0);

const cnIndustryStatus = (concept) => {
  const scores = concept.scores || {};
  const discovery = concept.discovery || {};
  if (concept.us_mapping_quality === "broad_fallback") {
    return `A股独立轮动：本轮全市场热度排名 #${esc(discovery.universe_rank ?? "--")}，板块当日 ${pct(
      discovery.board_change_pct,
    )}，成分上涨占比 ${pct(Number(discovery.breadth || 0) * 100)}。当前缺少可验证的直接美股行业映射，只展示A股热度，不生成跨市场买入型预测。`;
  }
  const usAvg = Number(scores.us_residual_1d ?? scores.us_avg_1d);
  const cnAvg = Number(scores.cn_residual_1d ?? scores.cn_avg_1d);
  const gap = Number(scores.lag_gap_neutral ?? scores.lag_gap);
  const roles = roleSummary(concept.cn.companies);
  const prefix = `${scores.action || "观察"}：`;
  if (scores.no_trade || String(scores.action || "").includes("回避")) {
    return `${prefix}当前主要矛盾不是“滞后补涨”，而是风险控制。${riskText(
      scores,
    )}。A股侧只保留 ${roles || "A 股映射公司"} 作为复核池，除非公告、订单或成交结构出现独立改善。`;
  }
  if (Number(scores.overheat_penalty) >= 18) {
    return `${prefix}A股映射池已有拥挤信号，机会从“发现滞后”切换到“等待回落确认”。重点比较 ${roles || "细分环节"} 的成交持续性、估值位置和是否还有未反映的订单证据。`;
  }
  if (Number.isFinite(gap) && gap >= 3 && Number.isFinite(usAvg) && usAvg > 0) {
    return `${prefix}美股端在扣除大盘后仍有领先定价，A股映射股尚未完全同步，当前更适合看作补涨验证池。重点跟踪 ${roles || "对应供应链"} 的成交额、公告、订单和客户认证是否开始共振。`;
  }
  if (Number.isFinite(usAvg) && Number.isFinite(cnAvg) && usAvg > 1 && cnAvg > 1) {
    return `${prefix}美股与A股已经同步发酵，行业状态偏热，机会从“发现滞后”切换到“确认强弱”。应优先比较 ${roles || "细分环节"} 的成交持续性和估值位置。`;
  }
  if (Number.isFinite(usAvg) && usAvg < -1) {
    return `${prefix}美股端已经降温，A股侧需要优先防补跌。只有当 ${roles || "对应公司"} 出现独立订单、政策或业绩证据时，才把它视为逆势机会。`;
  }
  return `${prefix}行业处在观察期，A股侧还缺少明确的价格确认。先把 ${roles || "A 股映射公司"} 作为候选池，等待美股残差动量、新闻证据和本地成交同步放大。`;
};

const renderConceptBrief = (side = "us") => {
  const concept = activeConcept();
  const isCn = side === "cn";
  const amount = sumAmount(concept.cn.companies);
  const discovery = concept.discovery || {};
  const dynamicMovers = (discovery.top_movers || [])
    .slice(0, 3)
    .map((item) => `${item.symbol || "-"} ${pct(item.change_1d)}`)
    .join(" / ");
  const isFullMarket = String(concept.source_type || "").startsWith("full_market");
  const dynamicMeta = isFullMarket
    ? `全市场 #${esc(discovery.universe_rank ?? "--")} · 热度 ${num(discovery.heat_score ?? discovery.activation_score, 1)} · `
    : concept.dynamic
      ? `动态发现 ${num(discovery.activation_score, 1)} · `
      : "";
  const dynamicLine = isFullMarket
    ? `<div class="risk-line dynamic-discovery-line">全市场重筛：${esc(discovery.source_label || "板块行情")}；当日 ${pct(
        discovery.board_change_pct,
      )}；上涨占比 ${pct(Number(discovery.breadth || 0) * 100)}；${esc(
        concept.us_mapping_label || "等待映射复核",
      )}。每次更新都会重新扫描和排名。</div>`
    : concept.dynamic
      ? `<div class="risk-line dynamic-discovery-line">动态发现：美股异动 ${
        esc(dynamicMovers || "等待下一次刷新确认")
      }；公开研究命中 ${esc(discovery.matched_research_count ?? 0)} 条。动态主题每次刷新重新筛选，不达标会自动退出。</div>`
      : "";
  const framework =
    state.data.summary?.score_framework ||
    "机会分不只看美股领先A股，还叠加美元/利率、全球风险偏好、供应链所在地、估值拥挤、本地政策和成交确认。";
  return `
    <div class="panel concept-brief-panel">
      <div class="panel-title">
        <h3>${esc(isCn ? `${concept.short_name} A股行业状态` : concept.name)}</h3>
        <span class="meta">${esc(dynamicMeta)}${esc(isCn ? `${concept.cn.companies.length} 只 A 股映射` : concept.scores.phase)}</span>
      </div>
      <p class="thesis">${esc(isCn ? cnIndustryStatus(concept) : concept.trigger)}</p>
      ${riskBadges(concept.scores)}
      <div class="risk-line muted">${esc(isCn ? "细分环节" : "关键词")}：${
        isCn ? esc(roleSummary(concept.cn.companies) || "-") : concept.keywords.map(esc).join(" / ")
      }</div>
      ${dynamicLine}
      <div class="risk-line muted">${esc(
        isCn ? `成交确认：映射池合计成交额 ${compactAmount(amount)}，继续核公告、订单、客户和估值。` : framework,
      )}</div>
    </div>
  `;
};

const conceptButton = (concept, compact = false, mode = "heat") => {
  const isOpportunity = mode === "opportunity";
  const value = isOpportunity
    ? concept.scores.opportunity_score ?? concept.scores.lag_score
    : concept.scores.research_heat_score ?? concept.scores.lag_score;
  const score = Math.max(8, Math.min(100, Number(value || 0)));
  const label = isOpportunity
    ? `机会 ${num(concept.scores.opportunity_score ?? concept.scores.lag_score, 1)} · ${esc(
        concept.scores.action || "观察",
      )}`
    : heatLabel(concept);
  const dynamicBadge = concept.dynamic
    ? `<span class="concept-badge">${String(concept.source_type || "").startsWith("full_market") ? "重筛" : "动态"}</span>`
    : "";
  return `
    <button class="concept-button ${compact ? "compact" : ""} ${concept.id === state.activeId ? "active" : ""}" data-concept="${esc(
      concept.id,
    )}">
      <div class="concept-name"><span>${esc(concept.short_name)}</span>${dynamicBadge}</div>
      <div class="concept-phase muted">${label} · ${esc(concept.scores.phase)}</div>
      <div class="concept-score"><span style="width:${score}%"></span></div>
    </button>
  `;
};

const renderConceptPicker = (options = {}) => {
  const side = options.side || "us";
  const mode = options.mode || "heat";
  const open = side === "cn" ? state.cnMenuOpen : state.usMenuOpen;
  const rankedConcepts = [...state.data.concepts].sort((left, right) => {
    const leftValue =
      mode === "opportunity"
        ? left.scores?.opportunity_score
        : left.scores?.market_heat_score ?? left.discovery?.heat_score ?? left.scores?.research_heat_score;
    const rightValue =
      mode === "opportunity"
        ? right.scores?.opportunity_score
        : right.scores?.market_heat_score ?? right.discovery?.heat_score ?? right.scores?.research_heat_score;
    return Number(rightValue || 0) - Number(leftValue || 0);
  });
  const topConcepts = rankedConcepts.slice(0, 6);
  return `
    <div class="concept-picker ${side === "cn" ? "cn-concept-picker" : ""}">
      <div class="concept-row">
        <div class="concept-scroll" aria-label="${side === "cn" ? "A股机会分板块" : "当日和本周热度板块"}">
          ${topConcepts.map((concept) => conceptButton(concept, true, mode)).join("")}
        </div>
        <button class="concept-menu-toggle" type="button" data-menu-toggle="${side}" aria-expanded="${open ? "true" : "false"}" aria-label="展开全部板块">
          ${chevronIcon(open)}
          <span>全部</span>
        </button>
      </div>
      ${
        open
          ? `<div class="concept-menu">${rankedConcepts.map((concept) => conceptButton(concept, false, mode)).join("")}</div>`
          : ""
      }
    </div>
  `;
};

const renderUsTable = (concept) => `
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:104px">Ticker</th>
          <th style="width:82px">价格</th>
          <th style="width:76px">日涨跌</th>
          <th style="width:72px">5日</th>
          <th style="width:68px">量比</th>
          <th style="width:190px">1个月日线走势</th>
        </tr>
      </thead>
      <tbody>
        ${concept.us.tickers
          .map((quote) => {
            if (!quote.ok) {
              return `
                <tr>
                  <td><div class="symbol-cell"><span class="ticker-mark">${esc(quote.symbol)}</span></div></td>
                  <td colspan="5" class="secondary">${esc(quote.error || "暂无行情")}</td>
                </tr>
              `;
            }
            return `
              <tr class="clickable-row" data-asset-kind="us" data-asset-id="${esc(quote.symbol)}" tabindex="0">
                <td><div class="symbol-cell"><span class="ticker-mark">${esc(quote.symbol)}</span></div></td>
                <td>${num(quote.price)}</td>
                <td class="${clsMove(quote.change_1d)}">${pct(quote.change_1d)}</td>
                <td class="${clsMove(quote.change_5d)}">${pct(quote.change_5d)}</td>
                <td>${num(quote.relative_volume)}</td>
                <td>${miniChart(quote.spark, { period: quote.chart_period || "1个月日线" })}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  </div>
`;

const renderCnTable = (concept) => `
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:150px">公司</th>
          <th style="width:82px">价格</th>
          <th style="width:74px">涨跌</th>
          <th style="width:78px">映射</th>
          <th style="width:68px">量比</th>
          <th style="width:92px">成交额</th>
          <th style="width:185px">1个月走势</th>
          <th style="width:132px">细分位置</th>
          <th>映射理由</th>
        </tr>
      </thead>
      <tbody>
        ${concept.cn.companies
          .map(
            (item) => `
              <tr class="clickable-row" data-asset-kind="cn" data-asset-id="${esc(item.code)}" tabindex="0">
                <td>
                  <div class="symbol-cell">
                    <span class="ticker-mark">${esc(item.code)}</span>
                    <span class="company-name">${esc(item.name)}</span>
                  </div>
                </td>
                <td>${num(item.price)}</td>
                <td class="${clsMove(item.change)}">${pct(item.change)}</td>
                <td>${num(item.mapping_confidence, 0)}<div class="cell-sub muted">${esc(item.mapping_quality || "")}</div></td>
                <td>${num(item.relative_amount, 1)}</td>
                <td>${esc(item.amount_label)}</td>
                <td>${miniChart(item.spark, { period: item.chart_period || "1个月复权日线" })}</td>
                <td>${esc(item.role)}</td>
                <td class="secondary">${esc(item.reason)}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  </div>
`;

const renderNews = (concept) => {
  const news = concept.us.news || [];
  if (!news.length) return `<div class="empty">暂无可用新闻结果，保留官方来源链接。</div>`;
  return `
    <div class="news-list">
      ${news
        .map(
          (item) => `
            <a class="news-item" href="${esc(item.url)}" target="_blank" rel="noreferrer">
              <div class="news-title">${esc(item.title)}</div>
              <div class="news-date muted">${esc(item.published_at || "")}</div>
            </a>
          `,
        )
        .join("")}
    </div>
  `;
};

const renderResearch = (concept) => {
  const research = concept.us.research || [];
  if (!research.length) return `<div class="empty">公开研究源暂未匹配到该细分主题，保留新闻与官方来源。</div>`;
  return `
    <div class="news-list">
      ${research
        .map(
          (item) => `
            <a class="news-item research-item" href="${esc(item.url)}" target="_blank" rel="noreferrer">
              <div class="news-title">${esc(item.title)}</div>
              <div class="research-summary">${esc(item.summary || "")}</div>
              <div class="news-date muted">${esc(item.feed || item.source || "公开研究")} · ${esc(item.published_at || "")}</div>
            </a>
          `,
        )
        .join("")}
    </div>
  `;
};

const renderSources = (concept) => `
  <div class="source-row">
    ${(concept.us.sources || [])
      .map(
        (source) =>
          `<a class="source-pill" href="${esc(source.url)}" target="_blank" rel="noreferrer">${esc(source.label)}</a>`,
      )
      .join("")}
  </div>
`;

const renderX = (concept) => {
  const x = concept.us.x_discussion || { status: "unknown", items: [] };
  if (!x.items?.length) {
    return `<div class="empty">X：${esc(x.message || x.status || "暂无结果")}</div>`;
  }
  return `
    <div class="news-list">
      ${x.items
        .slice(0, 4)
        .map(
          (item) => `
            <div class="news-item">
              <div class="news-title">${esc(item.text)}</div>
              <div class="news-date muted">score ${esc(item.score)} · ${esc(item.created_at || "")}</div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
};

const renderManualImport = (manual) => {
  const artifacts = manual?.artifacts || [];
  return `
    <div class="manual-import">
      <div class="manual-note">${esc(manual?.message || "个人账户分析可手动导入，不需要保持券商登录。")}</div>
      <div class="manual-grid">
        ${artifacts
          .map(
            (item) => `
              <div class="manual-file ${item.exists ? "ready" : ""}">
                <span>${esc(item.label)}</span>
                <small>${item.exists ? "已就绪" : "待生成"}</small>
              </div>
            `,
          )
          .join("")}
      </div>
    </div>
  `;
};

const renderMappingRows = (concept) => `
  <div class="mapping-list">
    ${concept.cn.companies
      .slice(0, 8)
      .map(
        (item) => `
          <div class="mapping-row clickable-row" data-asset-kind="cn" data-asset-id="${esc(item.code)}" tabindex="0">
            <div>
              <div class="role">${esc(item.code)} ${esc(item.name)}</div>
              <div class="secondary">${esc(item.market)} 市场</div>
            </div>
            <div class="reason">${esc(item.role)}：${esc(item.reason)}</div>
            <div>${miniChart(item.spark, { period: "20日" })}</div>
            <div class="${clsMove(item.change)}">${pct(item.change)}</div>
          </div>
        `,
      )
      .join("")}
  </div>
`;

const rankedBacktestConcepts = (snapshot, mode = "opportunity") => {
  const concepts = snapshot?.concepts || [];
  const key = mode === "us" ? "lag_score" : "opportunity_score";
  return [...concepts].sort((a, b) => Number(b.scores?.[key] || 0) - Number(a.scores?.[key] || 0));
};

const renderBacktestRankList = (snapshot, mode = "opportunity") => {
  const concepts = rankedBacktestConcepts(snapshot, mode);
  const scoreKey = mode === "us" ? "lag_score" : "opportunity_score";
  return `
    <div class="backtest-rank-list">
      ${concepts
        .map((concept, index) => {
          const active = concept.id === activeBacktestConcept()?.id;
          const topTicker = concept.us?.top_tickers?.[0];
          const score = Number(concept.scores?.[scoreKey] || 0);
          const barWidth = Math.max(8, Math.min(100, score));
          return `
            <button class="backtest-rank-row ${active ? "active" : ""}" type="button" data-backtest-concept="${esc(
              concept.id,
            )}">
              <span class="rank-index">${index + 1}</span>
              <span class="rank-main">
                <strong>${esc(concept.short_name)}</strong>
                <small>${esc(concept.scores?.phase || "")}</small>
                <i style="width:${barWidth}%"></i>
              </span>
              <span class="rank-score">
                ${num(score, 1)}
                <small>${mode === "us" && topTicker ? `${esc(topTicker.symbol)} ${pct(topTicker.change_1d)}` : esc(concept.scores?.action || "")}</small>
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
};

const megaBacktestSnapshotConcept = (conceptId, date) =>
  backtestData().snapshots?.[date]?.concepts?.find((concept) => concept.id === conceptId) || null;

const megaBacktestDates = (conceptId) =>
  (backtestData().date_options || []).filter((item) => item.date && megaBacktestSnapshotConcept(conceptId, item.date));

const megaBacktestRecord = (conceptId, code, date) =>
  megaBacktestSnapshotConcept(conceptId, date)?.cn?.companies?.find((item) => item.code === code) || null;

const megaMetricOptions = [
  { key: "return_1d", label: "1日" },
  { key: "return_3d", label: "3日" },
  { key: "return_5d", label: "5日" },
  { key: "return_10d", label: "10日" },
  { key: "return_15d", label: "15日" },
  { key: "return_since", label: "至今" },
  { key: "mfe_5d", label: "5日最好" },
  { key: "mae_5d", label: "5日最差" },
];

const megaMetricMeta = () => megaMetricOptions.find((item) => item.key === state.megaMetric) || megaMetricOptions[2];

const megaMetricValue = (record) => record?.[megaMetricMeta().key];

const averageValue = (values = []) => {
  const parsed = values.map(Number).filter(Number.isFinite);
  if (!parsed.length) return null;
  return parsed.reduce((total, value) => total + value, 0) / parsed.length;
};

const sortValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const megaBacktestConceptReturns = (conceptId) => {
  const returns = [];
  megaBacktestDates(conceptId).forEach((dateItem) => {
    const concept = megaBacktestSnapshotConcept(conceptId, dateItem.date);
    (concept?.cn?.companies || []).forEach((company) => {
      const value = Number(megaMetricValue(company));
      if (Number.isFinite(value)) returns.push(value);
    });
  });
  return returns;
};

const compareMegaBacktestRows = (conceptId, dates = []) => (left, right) => {
  for (const dateItem of dates) {
    const leftValue = sortValue(megaMetricValue(megaBacktestRecord(conceptId, left.code, dateItem.date)));
    const rightValue = sortValue(megaMetricValue(megaBacktestRecord(conceptId, right.code, dateItem.date)));
    if (leftValue !== rightValue) return rightValue - leftValue;
  }
  return String(left.code || "").localeCompare(String(right.code || ""));
};

const megaBacktestCompanyRows = (conceptId, dates = megaBacktestDates(conceptId)) => {
  const companiesByCode = new Map();
  const collect = (companies = []) => {
    companies.forEach((company) => {
      if (!company.code || companiesByCode.has(company.code)) return;
      companiesByCode.set(company.code, {
        code: company.code,
        name: company.name,
        market: company.market,
        role: company.role,
        reason: company.reason,
      });
    });
  };
  collect(activeMegaBacktestConcept()?.cn?.companies || []);
  collect(liveConceptById(conceptId)?.cn?.companies || []);
  dates.forEach((dateItem) => collect(megaBacktestSnapshotConcept(conceptId, dateItem.date)?.cn?.companies || []));
  return [...companiesByCode.values()].sort(compareMegaBacktestRows(conceptId, dates));
};

const renderMegaConceptStrip = (concepts) => {
  if (!concepts.length) return `<div class="empty">暂无可用板块。</div>`;
  const activeId = activeMegaBacktestConcept()?.id;
  return `
    <div class="mega-concept-strip" aria-label="大回测板块">
      ${concepts
        .map((concept, index) => {
          const returns = megaBacktestConceptReturns(concept.id);
          const avgReturn = averageValue(returns);
          const hitRate = returns.length
            ? (returns.filter((value) => Number(value) > 0).length / returns.length) * 100
            : null;
          const score = Number(concept.scores?.opportunity_score || concept.scores?.lag_score || 0);
          const barWidth = Math.max(8, Math.min(100, score));
          return `
            <button class="mega-concept-card ${concept.id === activeId ? "active" : ""}" type="button" data-mega-backtest-concept="${esc(
              concept.id,
            )}">
              <span class="rank-index">${index + 1}</span>
              <span class="mega-concept-main">
                <strong>${esc(concept.short_name)}</strong>
                <small>机会 ${num(score, 1)} · 样本 ${returns.length}</small>
                <i style="width:${barWidth}%"></i>
              </span>
              <span class="mega-concept-return ${clsMove(avgReturn)}">
                ${pct(avgReturn)}
                <small>命中 ${hitRate === null ? "-" : `${num(hitRate, 0)}%`}</small>
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
};

const renderMegaBacktestMatrix = (concept, dates, rows) => {
  if (!dates.length || !rows.length) return `<div class="empty">该板块暂无可用的大回测矩阵。</div>`;
  const tableMinWidth = 190 + dates.length * 92;
  return `
    <div class="mega-matrix-wrap">
      <table class="mega-matrix-table" style="min-width:${tableMinWidth}px">
        <thead>
          <tr>
            <th class="mega-stock-col">个股</th>
            ${dates
              .map(
                (dateItem) => `
                  <th class="mega-date-col">
                    <strong>${esc(shortDate(dateItem.date))}</strong>
                    <small>${Number(dateItem.trading_days_ago) === 0 ? "今天" : `${esc(dateItem.trading_days_ago)}日前`}</small>
                  </th>
                `,
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <th class="mega-stock-col mega-stock-cell" scope="row">
                    <span class="ticker-mark">${esc(row.code)}</span>
                    <span class="mega-stock-name">
                      <strong>${esc(row.name)}</strong>
                      <small>${esc(row.role || row.market || "")}</small>
                    </span>
                  </th>
                  ${dates
                    .map((dateItem) => {
                      const record = megaBacktestRecord(concept.id, row.code, dateItem.date);
                      const returnValue = megaMetricValue(record);
                      return `
                        <td class="mega-return-cell ${clsMove(returnValue)} ${record ? "clickable-return" : ""}"
                          ${
                            record
                              ? `data-asset-kind="bt-cn" data-asset-id="${esc(row.code)}" data-backtest-date-set="${esc(
                                  dateItem.date,
                                )}" data-backtest-concept-set="${esc(concept.id)}" tabindex="0"`
                              : ""
                          }>
                          <strong>${pct(returnValue)}</strong>
                          <small>${record ? `${num(record.buy_price)}买` : "-"}</small>
                        </td>
                      `;
                    })
                    .join("")}
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ROUND_TRIP_COST_PCT = 0.35;
const confidenceDays = () => Array.from({ length: state.confidenceHorizon }, (_, index) => index + 1);

const medianValue = (values = []) => {
  const parsed = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!parsed.length) return null;
  const mid = Math.floor(parsed.length / 2);
  return parsed.length % 2 ? parsed[mid] : (parsed[mid - 1] + parsed[mid]) / 2;
};

const quantileValue = (values = [], q = 0.5) => {
  const parsed = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!parsed.length) return null;
  const position = (parsed.length - 1) * clamp(q, 0, 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return parsed[lower];
  return parsed[lower] * (upper - position) + parsed[upper] * (position - lower);
};

const wilsonLowerBound = (successes, samples, z = 1.64) => {
  if (!samples) return null;
  const p = successes / samples;
  const z2 = z * z;
  const denominator = 1 + z2 / samples;
  const center = p + z2 / (2 * samples);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * samples)) / samples);
  return clamp((center - margin) / denominator, 0, 1);
};

const splitValidationReturns = (values = []) => {
  if (values.length < 12) return { train: values, validation: [] };
  const validationCount = Math.min(Math.max(6, Math.ceil(values.length * 0.3)), Math.max(0, values.length - 6));
  return {
    train: values.slice(0, values.length - validationCount),
    validation: values.slice(values.length - validationCount),
  };
};

const robustReturnStats = (rawValues = []) => {
  const values = rawValues.map(Number).filter(Number.isFinite);
  const netValues = values.map((value) => value - ROUND_TRIP_COST_PCT);
  const samples = netValues.length;
  const successes = netValues.filter((value) => value > 0).length;
  const lower = wilsonLowerBound(successes, samples);
  const { validation } = splitValidationReturns(netValues);
  const validationSuccesses = validation.filter((value) => value > 0).length;
  const validationLower = wilsonLowerBound(validationSuccesses, validation.length);
  const validationForScore = validationLower ?? (lower ?? 0) * 0.82;
  const avgNet = averageValue(netValues);
  const medianNet = medianValue(netValues);
  const p10Net = quantileValue(netValues, 0.1);
  const probScore = clamp(((lower ?? 0) - 0.48) * 128, 0, 42);
  const validationScore = clamp((validationForScore - 0.46) * 118, 0, 30);
  const sampleScore = clamp(Math.log1p(samples) * 4.1, 0, 16);
  const edgeScore = clamp((avgNet || 0) * 1.65, -12, 20);
  const tailScore = clamp((p10Net ?? -8) + 2, -13, 9);
  let cap = 58;
  if (samples >= 18) cap = 68;
  if (samples >= 24 && (lower ?? 0) >= 0.54) cap = 76;
  if (samples >= 30 && (lower ?? 0) >= 0.6 && validationForScore >= 0.5) cap = 84;
  if (samples >= 35 && (lower ?? 0) >= 0.68 && validationForScore >= 0.56 && (p10Net ?? -99) > -4) cap = 90;
  if ((lower ?? 0) >= 0.78 && validationForScore >= 0.66 && (p10Net ?? -99) > 0) cap = 96;
  if ((avgNet ?? 0) <= 0) cap = Math.min(cap, 58);
  if ((p10Net ?? 0) < -9) cap = Math.min(cap, 58);
  else if ((p10Net ?? 0) < -6) cap = Math.min(cap, 74);
  else if ((p10Net ?? 0) < -4) cap = Math.min(cap, 84);
  if (validation.length && validationForScore < 0.44) cap = Math.min(cap, 60);
  else if (validation.length && validationForScore < 0.5) cap = Math.min(cap, 70);
  else if (validation.length && validationForScore < 0.56) cap = Math.min(cap, 82);
  const score = Math.round(clamp(probScore + validationScore + sampleScore + edgeScore + tailScore, 0, cap));
  const grade =
    samples < 18
      ? "样本不足"
      : score >= 82 && (lower ?? 0) >= 0.68 && validationForScore >= 0.56 && (p10Net === null || p10Net > -4)
        ? "高可靠观察"
        : score >= 70 && (lower ?? 0) >= 0.58 && validationForScore >= 0.48
          ? "可观察"
          : score >= 56 && (lower ?? 0) >= 0.5
            ? "低仓观察"
            : "仅研究";
  return {
    samples,
    successes,
    rawWinRate: samples ? (successes / samples) * 100 : null,
    conservativeRate: lower === null ? null : lower * 100,
    validationRate: validationLower === null ? null : validationLower * 100,
    avgNet,
    medianNet,
    p10Net,
    score,
    grade,
  };
};

const confidenceCandleIndexForDate = (candles = [], date) => {
  const exact = candles.findIndex((row) => row.date === date);
  if (exact >= 0) return exact;
  return candles.findIndex((row) => row.date > date);
};

const confidenceReturnAtDay = (record, liveCompany, day) => {
  const candles = liveCompany?.candles || liveCompany?.spark || [];
  if (!record?.buy_date || !candles.length) return null;
  const buyIndex = confidenceCandleIndexForDate(candles, record.buy_date);
  if (buyIndex < 0 || buyIndex + day >= candles.length) return null;
  const buyPrice = Number(record.buy_price || candles[buyIndex]?.close);
  const exitPrice = Number(candles[buyIndex + day]?.close);
  if (!Number.isFinite(buyPrice) || buyPrice <= 0 || !Number.isFinite(exitPrice)) return null;
  return ((exitPrice - buyPrice) / buyPrice) * 100;
};

const confidenceObservationsRaw = (conceptId, minScore = state.confidenceMinScore) => {
  const observations = [];
  (backtestData().date_options || []).forEach((dateItem) => {
    const btConcept = megaBacktestSnapshotConcept(conceptId, dateItem.date);
    if (!btConcept) return;
    const opportunityScore = Number(btConcept.scores?.opportunity_score || btConcept.scores?.lag_score || 0);
    if (minScore !== null && opportunityScore < minScore) return;
    (btConcept.cn?.companies || []).forEach((record) => {
      const liveCompany = liveCompanyByCode(conceptId, record.code);
      if (!liveCompany) return;
      const returns = {};
      confidenceDays().forEach((day) => {
        const value = confidenceReturnAtDay(record, liveCompany, day);
        if (Number.isFinite(value)) returns[day] = value;
      });
      const values = Object.values(returns);
      if (!values.length) return;
      const firstPositiveDay = confidenceDays().find((day) => Number(returns[day]) > 0) || null;
      const firstConfirmDay = confidenceDays().find((day) => Number(returns[day]) >= 1) || null;
      const peak = confidenceDays().reduce(
        (best, day) => {
          const value = returns[day];
          if (!Number.isFinite(Number(value)) || Number(value) <= best.return) return best;
          return { day, return: Number(value) };
        },
        { day: null, return: Number.NEGATIVE_INFINITY },
      );
      observations.push({
        code: record.code,
        name: record.name,
        market: record.market,
        role: record.role,
        reason: record.reason,
        buyDate: record.buy_date,
        opportunityScore,
        returns,
        firstPositiveDay,
        firstConfirmDay,
        peakDay: peak.day,
        peakReturn: Number.isFinite(peak.return) ? peak.return : null,
        fixedReturn: returns[state.confidenceHorizon] ?? null,
        dynamicThreshold: Number(record.dynamic_threshold || 1),
        mfe5d: Number(record.mfe_5d),
        mae5d: Number(record.mae_5d),
      });
    });
  });
  return observations;
};

const confidenceObservations = (conceptId) => {
  const minScore = state.confidenceMinScore === 0 ? null : state.confidenceMinScore;
  const filtered = confidenceObservationsRaw(conceptId, minScore);
  if (filtered.length >= 30 || state.confidenceMinScore === 0) return { observations: filtered, fallback: false };
  return { observations: confidenceObservationsRaw(conceptId, null), fallback: true };
};

const confidenceDayStats = (observations = []) =>
  confidenceDays().map((day) => {
    const values = observations.map((item) => item.returns[day]).filter((value) => Number.isFinite(Number(value)));
    const robust = robustReturnStats(values);
    return {
      day,
      samples: values.length,
      winRate: robust.rawWinRate,
      conservativeRate: robust.conservativeRate,
      validationRate: robust.validationRate,
      confirmRate: values.length ? (values.filter((value) => Number(value) >= 1).length / values.length) * 100 : null,
      avgReturn: averageValue(values),
      avgReturnNet: robust.avgNet,
      medianReturn: medianValue(values),
      p10ReturnNet: robust.p10Net,
      score: robust.score,
    };
  });

const pickConfidenceBestWinDay = (stats = []) =>
  [...stats]
    .filter((item) => item.samples)
    .sort(
      (left, right) =>
        Number(right.conservativeRate || 0) - Number(left.conservativeRate || 0) ||
        Number(right.winRate || 0) - Number(left.winRate || 0) ||
        Number(right.avgReturnNet || 0) - Number(left.avgReturnNet || 0) ||
        left.day - right.day,
    )[0] || null;

const pickConfidenceTakeProfitDay = (stats = []) =>
  [...stats]
    .filter((item) => item.samples)
    .sort(
      (left, right) =>
        Number(right.avgReturnNet || 0) - Number(left.avgReturnNet || 0) ||
        Number(right.conservativeRate || 0) - Number(left.conservativeRate || 0) ||
        Number(right.p10ReturnNet || -999) - Number(left.p10ReturnNet || -999) ||
        left.day - right.day,
    )[0] || null;

const confidenceAggregate = (conceptId) => {
  const concept = confidenceRankedConcepts().find((item) => item.id === conceptId);
  const stats = (concept?.horizon_stats || []).map((item) => ({
    day: Number(item.horizon),
    samples: Number(item.samples || 0),
    fullSamples: Number(item.full_samples || 0),
    winRate: Number(item.raw_probability) * 100,
    calibratedRate: Number(item.calibrated_probability) * 100,
    baselineRate: Number(item.baseline_probability) * 100,
    predictiveLift: Number(item.predictive_lift) * 100,
    conservativeRate: Number(item.conservative_probability) * 100,
    validationRate: Number(item.validation_conservative_probability) * 100,
    avgReturnNet: item.avg_return_after_cost,
    medianReturn: item.median_return,
    p10ReturnNet: item.p10_return_after_cost,
    avgMae: item.avg_mae,
    brierSkill: item.brier_skill,
    calibrationError: item.calibration_error,
    score: item.certainty_score,
    grade: item.decision_status,
  }));
  const bestWin = pickConfidenceBestWinDay(stats);
  const bestTake = pickConfidenceTakeProfitDay(stats);
  const fixedDay = Math.min(Number(state.confidenceHorizon || 5), 10);
  const fixedStats = stats.find((item) => item.day === fixedDay) || stats.find((item) => item.day === 5) || stats[0] || {};
  return {
    observations: [],
    stats,
    bestWin,
    bestTake,
    realizedRate: fixedStats.calibratedRate,
    conservativeRate: fixedStats.conservativeRate,
    validationRate: fixedStats.validationRate,
    avgReturnNet: fixedStats.avgReturnNet,
    p10ReturnNet: fixedStats.p10ReturnNet,
    baselineRate: fixedStats.baselineRate,
    predictiveLift: fixedStats.predictiveLift,
    brierSkill: fixedStats.brierSkill,
    calibrationError: fixedStats.calibrationError,
    recentRate: Number(concept?.recent_probability) * 100,
    stabilityScore: Number(concept?.relationship_stability_score),
    fdrQ: concept?.fdr_q_value == null ? null : Number(concept.fdr_q_value) * 100,
    multipleTestPass: Boolean(concept?.multiple_test_pass),
    avgFirstConfirm: null,
    avgMae5d: fixedStats.avgMae,
    fixedDay,
    sampleCount: fixedStats.samples || 0,
    score: Math.round(Number(concept?.certainty_score || fixedStats.score || 0)),
    label: concept?.decision_status || fixedStats.grade || "拒绝预测",
    abstainReasons: concept?.abstain_reasons || [],
    fallback: false,
  };
};

const confidenceStockAggregates = (conceptId) => {
  const concept = confidenceRankedConcepts().find((item) => item.id === conceptId);
  const fixedDay = Math.min(Number(state.confidenceHorizon || 5), 10);
  return (concept?.stock_stats || [])
    .map((item) => {
      const stats = (item.horizon_stats || []).map((row) => ({
        day: Number(row.horizon),
        samples: Number(row.samples || 0),
        calibratedRate: Number(row.calibrated_probability) * 100,
        baselineRate: Number(row.baseline_probability) * 100,
        predictiveLift: Number(row.predictive_lift) * 100,
        conservativeRate: Number(row.conservative_probability) * 100,
        validationRate: Number(row.validation_conservative_probability) * 100,
        avgReturnNet: row.avg_return_after_cost,
        p10ReturnNet: row.p10_return_after_cost,
        brierSkill: row.brier_skill,
        calibrationError: row.calibration_error,
      }));
      const fixed = stats.find((row) => row.day === fixedDay) || stats.find((row) => row.day === 5) || stats[0] || {};
      const bestWin = pickConfidenceBestWinDay(stats);
      const bestTake = pickConfidenceTakeProfitDay(stats);
      return {
        code: item.code,
        name: item.name || item.code,
        role: item.role || "",
        samples: fixed.samples || 0,
        bestWin,
        bestTake,
        realizedRate: fixed.calibratedRate,
        conservativeRate: fixed.conservativeRate,
        validationRate: fixed.validationRate,
        baselineRate: fixed.baselineRate,
        predictiveLift: fixed.predictiveLift,
        avgReturnNet: fixed.avgReturnNet,
        p10ReturnNet: fixed.p10ReturnNet,
        brierSkill: fixed.brierSkill,
        calibrationError: fixed.calibrationError,
        recentRate: Number(item.recent_probability) * 100,
        stabilityScore: Number(item.relationship_stability_score),
        fdrQ: item.fdr_q_value == null ? null : Number(item.fdr_q_value) * 100,
        avgFirstConfirm: null,
        avgMae5d: null,
        score: Math.round(Number(item.certainty_score || 0)),
        grade: item.reliability_grade || "拒绝预测",
        abstainReasons: item.abstain_reasons || [],
      };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        Number(right.bestTake?.avgReturn || 0) - Number(left.bestTake?.avgReturn || 0) ||
        right.samples - left.samples,
    );
};

const confidenceText = (aggregate) => {
  if (!aggregate.sampleCount) return "缺少足够样本，暂不判断。";
  const reason = aggregate.abstainReasons?.length ? ` 拒绝原因：${aggregate.abstainReasons.join("、")}。` : "";
  return `V7按时间顺序样本外检验，并对旧样本衰减、近期关系失效和同批候选多重检验设门槛。第${aggregate.fixedDay}日校准盈利概率为${num(aggregate.realizedRate, 1)}%，最近事件概率为${num(aggregate.recentRate, 1)}%，无条件基准为${num(aggregate.baselineRate, 1)}%，BH q值为${num(aggregate.fdrQ, 1)}%。当前结论：${aggregate.label}。${reason}`;
};

const renderConfidenceConceptStrip = () => `
  <div class="confidence-concept-strip" aria-label="板块置信度">
    ${confidenceRankedConcepts()
      .map((concept, index) => {
        const aggregate = confidenceAggregate(concept.id);
        const active = concept.id === activeConfidenceConcept()?.id;
        return `
          <button class="confidence-concept-card ${active ? "active" : ""}" type="button" data-confidence-concept="${esc(
            concept.id,
          )}">
            <span class="rank-index">${index + 1}</span>
            <span class="confidence-concept-main">
              <strong>${esc(concept.short_name)}</strong>
              <small>${esc(aggregate.label)} · 样本 ${aggregate.sampleCount}</small>
            </span>
            <span class="confidence-score">${aggregate.score}<small>可靠度</small></span>
          </button>
        `;
      })
      .join("")}
  </div>
`;

const renderConfidenceDayCards = (aggregate) => `
  <div class="confidence-day-grid">
    ${aggregate.stats
      .map((item) => {
        const bestRise = item.day === aggregate.bestWin?.day;
        const bestTake = item.day === aggregate.bestTake?.day;
        return `
          <div class="confidence-day-card ${bestRise ? "best-rise" : ""} ${bestTake ? "best-take" : ""}">
            <div class="confidence-day-head">
              <strong>第${item.day}天</strong>
              <span>${item.samples}样本</span>
            </div>
            <div class="confidence-day-value">${num(item.calibratedRate, 1)}%</div>
            <div class="confidence-bars">
              <span style="width:${clamp(Number(item.conservativeRate || 0), 0, 100)}%"></span>
            </div>
            <small>下界 ${num(item.conservativeRate, 0)}% · 基准${num(item.baselineRate, 0)}% · 增益${num(item.predictiveLift, 1)}点 · 净${pct(item.avgReturnNet)}</small>
          </div>
        `;
      })
      .join("")}
  </div>
`;

const renderConfidenceStockTable = (rows) => `
  <div class="table-wrap confidence-table-wrap">
    <table class="data-table confidence-stock-table">
      <thead>
        <tr>
          <th style="width:150px">股票</th>
          <th style="width:74px">样本</th>
          <th style="width:96px">校准概率</th>
          <th style="width:104px">基准/增益</th>
          <th style="width:92px">概率下界</th>
          <th style="width:92px">Brier增益</th>
          <th style="width:104px">近期/稳定度</th>
          <th style="width:82px">BH q值</th>
          <th style="width:96px">扣费均值</th>
          <th>判断</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>
                  <div class="symbol-cell">
                    <span class="ticker-mark">${esc(row.code)}</span>
                    <span class="company-name">${esc(row.name)}</span>
                  </div>
                </td>
                <td>${row.samples}</td>
                <td><strong>${num(row.realizedRate, 1)}%</strong></td>
                <td>${num(row.baselineRate, 1)}%<div class="cell-sub muted">${num(row.predictiveLift, 1)}点</div></td>
                <td>${num(row.conservativeRate, 1)}%</td>
                <td class="${clsMove(row.brierSkill)}">${pct(Number(row.brierSkill || 0) * 100)}</td>
                <td>${num(row.recentRate, 1)}%<div class="cell-sub muted">${num(row.stabilityScore, 0)}分</div></td>
                <td>${Number.isFinite(row.fdrQ) ? `${num(row.fdrQ, 1)}%` : "-"}</td>
                <td class="${clsMove(row.avgReturnNet)}">${pct(row.avgReturnNet)}</td>
                <td class="secondary">${esc(row.grade || "")} · ${esc(row.role || "")}<div class="cell-sub muted">${esc(
                  (row.abstainReasons || []).slice(0, 2).join("、") || "通过核心门槛",
                )}</div></td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  </div>
`;

const backtestCompanyRows = (concept) =>
  (concept?.cn?.companies || []).map((item) => ({
    ...item,
    live: liveCompanyByCode(concept.id, item.code),
  }));

const renderBacktestStockTable = (concept) => {
  const rows = backtestCompanyRows(concept);
  if (!rows.length) return `<div class="empty">该日期暂无A股映射回测数据。</div>`;
  return `
    <div class="table-wrap">
      <table class="data-table backtest-stock-table">
        <thead>
          <tr>
            <th style="width:146px">公司</th>
            <th style="width:92px">回测买入</th>
            <th style="width:82px">1日</th>
            <th style="width:82px">3日</th>
            <th style="width:82px">5日</th>
            <th style="width:82px">10日</th>
            <th style="width:88px">至今</th>
            <th style="width:78px">当日涨跌</th>
            <th style="width:176px">K线回测点</th>
            <th>细分位置 / 映射理由</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((item) => {
              const candles = item.live?.candles || item.live?.spark || [];
              return `
                <tr class="clickable-row" data-asset-kind="bt-cn" data-asset-id="${esc(item.code)}" tabindex="0">
                  <td>
                    <div class="symbol-cell">
                      <span class="ticker-mark">${esc(item.code)}</span>
                      <span class="company-name">${esc(item.name)}</span>
                    </div>
                  </td>
                  <td>${num(item.buy_price)}<div class="cell-sub muted">${esc(item.buy_date || "")}</div></td>
                  <td class="${clsMove(item.return_1d)}">${pct(item.return_1d)}</td>
                  <td class="${clsMove(item.return_3d)}">${pct(item.return_3d)}</td>
                  <td class="${clsMove(item.return_5d)}">${pct(item.return_5d)}</td>
                  <td class="${clsMove(item.return_10d)}">${pct(item.return_10d)}</td>
                  <td class="${clsMove(item.return_since)}">${pct(item.return_since)}</td>
                  <td class="${clsMove(item.buy_day_change)}">${pct(item.buy_day_change)}</td>
                  <td>${miniChart(rangeRows(candles, "1M"), { period: "1个月", markerDate: item.buy_date })}</td>
                  <td class="secondary">${esc(item.role)}：${esc(item.reason)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
};

const followHorizonLabel = (value) => (value ? `${value}日` : "-");

const renderFollowConceptStrip = (concepts = []) => `
  <div class="follow-concept-strip" aria-label="10日跟随可靠度板块">
    ${concepts
      .map((concept, index) => {
        const active = concept.id === activeFollowConcept()?.id;
        return `
          <button class="follow-concept-card ${active ? "active" : ""}" type="button" data-backtest-concept="${esc(
            concept.id,
          )}">
            <span class="rank-index">${index + 1}</span>
            <span class="follow-card-main">
              <strong>${esc(concept.short_name)}</strong>
              <small>${esc(concept.decision_status || concept.verdict || "")} · 5日主终点</small>
            </span>
            <span class="follow-card-score">
              ${num(concept.certainty_score, 0)}
              <small>${prob(concept.calibrated_probability)}校准 · ${num(Number(concept.predictive_lift || 0) * 100, 1)}点增益</small>
            </span>
          </button>
        `;
      })
      .join("")}
  </div>
`;

const renderFollowConeChart = (concept) => {
  const rows = (concept?.future_cone || []).filter((item) => item.day && item.samples);
  if (!rows.length) return `<div class="empty">该板块暂无足够样本生成10日历史分布。</div>`;
  const values = rows.flatMap((item) => [
    item.p10_return,
    item.p25_return,
    item.median_return,
    item.p75_return,
    item.p90_return,
  ]).filter((value) => Number.isFinite(Number(value))).map(Number);
  const minY = Math.min(-2, ...values);
  const maxY = Math.max(2, ...values);
  const pad = (maxY - minY) * 0.12 || 1;
  const low = minY - pad;
  const high = maxY + pad;
  const width = 680;
  const height = 292;
  const left = 52;
  const right = 18;
  const top = 18;
  const bottom = 54;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const x = (day) => left + ((Number(day) - 1) / 9) * plotW;
  const y = (value) => top + ((high - Number(value)) / (high - low || 1)) * plotH;
  const zeroY = y(0);
  const medianPath = rows
    .filter((item) => Number.isFinite(Number(item.median_return)))
    .map((item, index) => `${index ? "L" : "M"} ${x(item.day).toFixed(1)} ${y(item.median_return).toFixed(1)}`)
    .join(" ");
  const probPath = rows
    .filter((item) => Number.isFinite(Number(item.calibrated_probability)))
    .map((item, index) => {
      const px = x(item.day);
      const py = top + (1 - Number(item.calibrated_probability)) * plotH;
      return `${index ? "L" : "M"} ${px.toFixed(1)} ${py.toFixed(1)}`;
    })
    .join(" ");
  const yTicks = [high, (high + low) / 2, low];
  return `
    <div class="follow-cone-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(concept.short_name)}未来10日历史条件分布">
        <g class="follow-grid">
          ${yTicks
            .map((tick) => {
              const ty = y(tick);
              return `<line x1="${left}" y1="${ty.toFixed(1)}" x2="${width - right}" y2="${ty.toFixed(1)}"></line><text x="8" y="${(
                ty + 4
              ).toFixed(1)}">${pct(tick)}</text>`;
            })
            .join("")}
          <line class="zero" x1="${left}" y1="${zeroY.toFixed(1)}" x2="${width - right}" y2="${zeroY.toFixed(1)}"></line>
        </g>
        <g class="follow-ranges">
          ${rows
            .map((item) => {
              const px = x(item.day);
              const p10 = Number(item.p10_return);
              const p25 = Number(item.p25_return);
              const p75 = Number(item.p75_return);
              const p90 = Number(item.p90_return);
              const median = Number(item.median_return);
              const parts = [];
              if (Number.isFinite(p10) && Number.isFinite(p90)) {
                parts.push(`<line class="range-wide" x1="${px.toFixed(1)}" y1="${y(p10).toFixed(1)}" x2="${px.toFixed(1)}" y2="${y(
                  p90,
                ).toFixed(1)}"></line>`);
              }
              if (Number.isFinite(p25) && Number.isFinite(p75)) {
                parts.push(`<line class="range-core" x1="${px.toFixed(1)}" y1="${y(p25).toFixed(1)}" x2="${px.toFixed(1)}" y2="${y(
                  p75,
                ).toFixed(1)}"></line>`);
              }
              if (Number.isFinite(median)) {
                parts.push(`<circle cx="${px.toFixed(1)}" cy="${y(median).toFixed(1)}" r="4"></circle>`);
              }
              return parts.join("");
            })
            .join("")}
        </g>
        <path class="median-line" d="${medianPath}"></path>
        <path class="prob-line" d="${probPath}"></path>
        <g class="follow-axis">
          ${rows
            .map((item) => `<text x="${x(item.day).toFixed(1)}" y="${height - 24}" text-anchor="middle">D${item.day}</text>`)
            .join("")}
          <text x="${left}" y="${height - 6}">条件收益分布</text>
          <text x="${width - right}" y="${height - 6}" text-anchor="end">橙线=样本外校准概率</text>
        </g>
      </svg>
      <div class="follow-chart-legend">
        <span><i class="median"></i>中位收益</span>
        <span><i class="core"></i>25%-75%区间</span>
        <span><i class="wide"></i>10%-90%区间</span>
      </div>
    </div>
  `;
};

const renderFollowHorizonTable = (concept) => `
  <div class="follow-horizon-grid">
    ${(concept?.horizon_stats || [])
      .map((item) => `
        <div class="follow-horizon-card ${item.horizon === 5 ? "active" : ""}">
          <div class="follow-day">D${item.horizon}</div>
          <strong>${prob(item.calibrated_probability)}</strong>
          <small>${item.samples || 0} OOS · 下界${prob(item.conservative_probability)} · 基准${prob(item.baseline_probability)} · Brier${pct(Number(item.brier_skill || 0) * 100)}</small>
        </div>
      `)
      .join("")}
  </div>
`;

const renderFollowModelTable = (concepts = []) => `
  <div class="table-wrap follow-table-wrap">
    <table class="data-table follow-model-table">
      <thead>
        <tr>
          <th style="width:142px">板块</th>
          <th style="width:92px">状态</th>
          <th style="width:92px">5日校准</th>
          <th style="width:104px">基准/增益</th>
          <th style="width:92px">概率下界</th>
          <th style="width:82px">OOS样本</th>
          <th style="width:92px">Brier增益</th>
          <th style="width:86px">校准误差</th>
          <th style="width:104px">近期/稳定度</th>
          <th style="width:82px">BH q值</th>
          <th style="width:92px">超额概率</th>
          <th style="width:92px">扣费均值</th>
          <th>触发/原因</th>
        </tr>
      </thead>
      <tbody>
        ${concepts
          .map((concept) => `
            <tr class="clickable-follow-row ${concept.id === activeFollowConcept()?.id ? "active" : ""}" data-backtest-concept="${esc(
              concept.id,
            )}">
              <td><strong>${esc(concept.short_name)}</strong><div class="cell-sub muted">${esc(concept.underlying_driver || "")}</div></td>
              <td><strong>${esc(concept.decision_status || "-")}</strong></td>
              <td>${prob(concept.calibrated_probability)}</td>
              <td>${prob(concept.baseline_probability)}<div class="cell-sub muted">${num(Number(concept.predictive_lift || 0) * 100, 1)}点</div></td>
              <td><strong>${prob(concept.conservative_probability)}</strong></td>
              <td>${concept.successes || 0}/${concept.samples || 0}</td>
              <td class="${clsMove(concept.brier_skill)}">${pct(Number(concept.brier_skill || 0) * 100)}</td>
              <td>${pct(Number(concept.calibration_error || 0) * 100)}</td>
              <td>${prob(concept.recent_probability)}<div class="cell-sub muted">${num(
                concept.relationship_stability_score,
                0,
              )}分</div></td>
              <td>${concept.fdr_q_value == null ? "-" : prob(concept.fdr_q_value)}</td>
              <td>${prob(concept.alpha_probability)}</td>
              <td class="${clsMove(concept.avg_return_after_cost)}">${pct(concept.avg_return_after_cost)}</td>
              <td class="secondary">${concept.current_trigger ? "触发有效" : "当前未触发"}<div class="cell-sub muted">${esc(
                (concept.abstain_reasons || []).slice(0, 2).join("、") || "通过核心门槛",
              )}</div></td>
            </tr>
          `)
          .join("")}
      </tbody>
    </table>
  </div>
`;

const renderFollowStockTable = (concept, snapshot) => {
  const rows = concept?.stock_stats || [];
  if (!rows.length) return `<div class="empty">该板块暂无足够的个股级跟随样本。</div>`;
  return `
    <div class="table-wrap follow-table-wrap">
      <table class="data-table follow-stock-table">
        <thead>
          <tr>
            <th style="width:150px">A股</th>
            <th style="width:74px">样本</th>
            <th style="width:90px">校准概率</th>
            <th style="width:104px">基准/增益</th>
            <th style="width:90px">概率下界</th>
            <th style="width:92px">Brier增益</th>
            <th style="width:104px">近期/稳定度</th>
            <th style="width:82px">BH q值</th>
            <th style="width:92px">扣费均值</th>
            <th style="width:92px">10分位净值</th>
            <th style="width:92px">个股分</th>
            <th>状态/原因</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map((row) => `
              <tr class="clickable-row" data-asset-kind="bt-cn" data-asset-id="${esc(row.code)}" data-backtest-date-set="${esc(
                snapshot?.date || "",
              )}" data-backtest-concept-set="${esc(concept.id)}" tabindex="0">
                <td>
                  <div class="symbol-cell">
                    <span class="ticker-mark">${esc(row.code)}</span>
                    <span class="company-name">${esc(row.name)}</span>
                  </div>
                </td>
                <td>${row.successes || 0}/${row.samples || 0}</td>
                <td><strong>${prob(row.calibrated_probability)}</strong></td>
                <td>${prob(row.baseline_probability)}<div class="cell-sub muted">${num(Number(row.predictive_lift || 0) * 100, 1)}点</div></td>
                <td><strong>${prob(row.conservative_probability)}</strong></td>
                <td class="${clsMove(row.brier_skill)}">${pct(Number(row.brier_skill || 0) * 100)}</td>
                <td>${prob(row.recent_probability)}<div class="cell-sub muted">${num(
                  row.relationship_stability_score,
                  0,
                )}分</div></td>
                <td>${row.fdr_q_value == null ? "-" : prob(row.fdr_q_value)}</td>
                <td class="${clsMove(row.avg_return_after_cost)}">${pct(row.avg_return_after_cost)}</td>
                <td class="${clsMove(row.p10_return_after_cost)}">${pct(row.p10_return_after_cost)}</td>
                <td>${num(row.certainty_score, 0)}</td>
                <td class="secondary">${esc(row.decision_status || row.reliability_grade || "")} · ${esc(
                  row.factor_state?.position_state || row.role || "",
                )}<div class="cell-sub muted">${esc((row.abstain_reasons || []).slice(0, 2).join("、") || row.reason || "通过核心门槛")}</div></td>
              </tr>
            `)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
};

const renderAutoRecommendPanel = (recommendations = [], horizon = 5) => {
  const rows = recommendations || [];
  if (!rows.length) return `<div class="empty">当前没有股票同时通过触发、样本外增益、近期关系稳定、FDR校正、超额收益、成本压力和可交易性门槛。</div>`;
  return `
    <div class="table-wrap auto-recommend-table-wrap">
      <table class="data-table auto-recommend-table">
        <thead>
          <tr>
            <th style="width:114px">A股</th>
            <th style="width:112px">所属板块</th>
            <th style="width:78px">决策分</th>
            <th style="width:88px">校准概率</th>
            <th style="width:104px">基准/增益</th>
            <th style="width:82px">概率下界</th>
            <th style="width:82px">超额概率</th>
            <th style="width:84px">Brier增益</th>
            <th style="width:80px">BH q值</th>
            <th style="width:80px">稳定度</th>
            <th style="width:84px">5日净均</th>
            <th style="width:70px">样本</th>
            <th>状态/位点</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr class="clickable-row" data-asset-kind="bt-cn" data-asset-id="${esc(row.code)}" data-backtest-date-set="${esc(
                  row.trigger_date || "",
                )}" data-backtest-concept-set="${esc(row.concept_id || "")}" tabindex="0">
                  <td>
                    <div class="symbol-cell">
                      <span class="ticker-mark">${esc(row.code)}</span>
                      <span class="company-name">${esc(row.name || "")}</span>
                    </div>
	                  </td>
	                  <td>${esc(row.concept_short_name || row.concept_name || "-")}</td>
	                  <td><strong>${num(row.certainty_score, 0)}</strong></td>
	                  <td><strong>${prob(row.calibrated_probability_5d)}</strong></td>
	                  <td>${prob(row.baseline_probability_5d)}<div class="cell-sub muted">${num(
                    Number(row.predictive_lift_5d || 0) * 100,
                    1,
                  )}点</div></td>
	                  <td><strong>${prob(row.conservative_probability_5d)}</strong></td>
	                  <td>${prob(row.alpha_probability_5d)}</td>
		                  <td class="${clsMove(row.brier_skill_5d)}">${pct(Number(row.brier_skill_5d || 0) * 100)}</td>
		                  <td>${row.fdr_q_value_5d == null ? "-" : prob(row.fdr_q_value_5d)}</td>
		                  <td>${num(row.relationship_stability_score_5d, 0)}</td>
		                  <td class="${clsMove(row.avg_return_after_cost_5d)}">${pct(row.avg_return_after_cost_5d)}</td>
	                  <td>${row.successes_5d || 0}/${row.samples_5d || 0}</td>
	                  <td class="secondary">${esc(row.decision_status || row.reliability_grade || "-")} · ${num(
                    row.recommended_horizon_days || horizon || 5,
                    0,
                  )}日<div class="cell-sub muted">${esc(row.factor_state?.position_state || row.role || row.market || "-")}</div></td>
	                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
};

const renderScreenedCandidatePanel = (rows = []) => {
  if (!rows.length) return `<div class="empty">暂无可审计的筛选记录。</div>`;
  return `
    <div class="table-wrap auto-recommend-table-wrap">
      <table class="data-table auto-recommend-table">
        <thead>
          <tr>
            <th style="width:116px">A股</th>
            <th style="width:112px">板块</th>
            <th style="width:86px">校准概率</th>
            <th style="width:104px">基准/增益</th>
            <th style="width:86px">Brier增益</th>
            <th style="width:82px">BH q值</th>
            <th style="width:82px">稳定度</th>
            <th style="width:84px">5日净均</th>
            <th>拒绝原因</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td><div class="symbol-cell"><span class="ticker-mark">${esc(row.code)}</span><span class="company-name">${esc(
                    row.name || "",
                  )}</span></div></td>
                  <td>${esc(row.concept_short_name || row.concept_name || "-")}</td>
                  <td>${prob(row.calibrated_probability_5d)}</td>
                  <td>${prob(row.baseline_probability_5d)}<div class="cell-sub muted">${num(
                    Number(row.predictive_lift_5d || 0) * 100,
                    1,
                  )}点</div></td>
                  <td class="${clsMove(row.brier_skill_5d)}">${pct(Number(row.brier_skill_5d || 0) * 100)}</td>
                  <td>${row.fdr_q_value_5d == null ? "-" : prob(row.fdr_q_value_5d)}</td>
                  <td>${num(row.relationship_stability_score_5d, 0)}</td>
                  <td class="${clsMove(row.avg_return_after_cost_5d)}">${pct(row.avg_return_after_cost_5d)}</td>
                  <td class="secondary">${esc((row.abstain_reasons || []).slice(0, 3).join("、") || "未通过核心门槛")}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
};

const renderBacktestPage = () => {
  ensureBacktestSelection();
  const backtest = backtestData();
  if (!backtest.available) {
    return `
      <div class="backtest-dashboard">
        <section class="backtest-shell">
          ${renderModeSwitch()}
          <div class="panel">
            <div class="panel-title"><h3>回测不可用</h3><span class="meta">需要A股历史K线</span></div>
            <div class="empty">${esc(backtest.message || "暂无回测数据。")}</div>
          </div>
        </section>
      </div>
    `;
  }
  const snapshot = activeBacktestSnapshot();
  const replayConcept = activeBacktestConcept();
  const follow = followModelData();
  const followConcepts = followRankedConcepts();
  const concept = activeFollowConcept();
  const autoRecommendStocks = follow.auto_recommendations || [];
  const autoRecommendHorizon = follow.auto_recommendation_horizon || 5;
  if (!snapshot || !replayConcept) {
    return `
      <div class="backtest-dashboard">
        <section class="backtest-shell">
          ${renderModeSwitch()}
          <div class="empty">所选日期没有可用回测快照。</div>
        </section>
      </div>
    `;
  }
  if (!follow.available || !followConcepts.length || !concept) {
    return `
      <div class="backtest-dashboard">
        <section class="backtest-shell">
          ${renderModeSwitch()}
          <div class="panel">
            <div class="panel-title"><h3>10日跟随模型不可用</h3><span class="meta">需要更多历史样本</span></div>
            <div class="empty">${esc(follow.message || "暂无足够样本计算跟随概率。")}</div>
          </div>
        </section>
      </div>
    `;
  }
  const usTop = rankedBacktestConcepts(snapshot, "us")[0];
  const cnTop = rankedBacktestConcepts(snapshot, "opportunity")[0];
  const replayWinRate = replayConcept.cn.companies.length ? (replayConcept.cn.winners / replayConcept.cn.companies.length) * 100 : null;
  const avgEvents = replayConcept.cn.avg_event_returns || {};
  const eventWinRates = replayConcept.cn.win_rates || {};
  return `
    <div class="backtest-dashboard">
      <section class="backtest-shell">
        <div class="backtest-head">
          <div>
            ${renderModeSwitch()}
            <h1>5日跟随样本外审计</h1>
            <p>5日为预先固定主终点；1-10日只展示诊断路径。日期回放用于核对价格，不再参与概率校准。</p>
          </div>
          <div class="follow-rank-card">
            <span>当前第一</span>
            <strong>${esc(followConcepts[0]?.short_name || "-")}</strong>
            <small>${esc(followConcepts[0]?.decision_status || "-")} · ${prob(followConcepts[0]?.calibrated_probability)}校准概率</small>
          </div>
        </div>

        <div class="backtest-method">${esc(follow.method || "")} ${esc(follow.rank_basis || "")}</div>

        <div class="metric-grid backtest-metrics">
          ${metric("样本区间", `${follow.sample_window?.from || "-"} 至 ${follow.sample_window?.to || "-"}`)}
          ${metric("当前板块", concept.short_name)}
          ${metric("主决策窗口", "5个交易日")}
          ${metric("样本外校准概率", prob(concept.calibrated_probability))}
          ${metric("无条件基准", prob(concept.baseline_probability))}
          ${metric("条件概率增益", `${num(Number(concept.predictive_lift || 0) * 100, 1)}个百分点`)}
          ${metric("Brier增益", pct(Number(concept.brier_skill || 0) * 100), clsMove(concept.brier_skill))}
          ${metric("近期关系概率", prob(concept.recent_probability))}
          ${metric("关系稳定度", `${num(concept.relationship_stability_score, 0)}分`)}
          ${metric("BH q值", concept.fdr_q_value == null ? "-" : prob(concept.fdr_q_value))}
          ${metric("保守概率下界", prob(concept.conservative_probability))}
          ${metric("样本成功数", `${concept.successes || 0}/${concept.samples || 0}`)}
          ${metric("扣费后均值", pct(concept.avg_return_after_cost), clsMove(concept.avg_return_after_cost))}
          ${metric("10分位净值", pct(concept.p10_return_after_cost), clsMove(concept.p10_return_after_cost))}
          ${metric("当前触发分", num(concept.current_activation_score, 0))}
        </div>

        <div class="backtest-main-layout">
          <div class="backtest-main-col">
            <div class="panel">
              <div class="panel-title">
                <h3>板块样本外排序</h3>
                <span class="meta">先按是否通过门槛，再看校准与尾部风险</span>
              </div>
              ${renderFollowConceptStrip(followConcepts)}
            </div>

            <div class="follow-detail-grid">
              <div class="panel">
                <div class="panel-title">
                  <h3>${esc(concept.short_name)} 1-10日历史分布</h3>
                  <span class="meta">诊断区间，不用于事后挑选主终点</span>
                </div>
                ${renderFollowConeChart(concept)}
              </div>
              <div class="panel">
                <div class="panel-title">
                  <h3>${esc(concept.short_name)} 逐日概率审计</h3>
                  <span class="meta">${esc(concept.decision_status || concept.verdict || "")}</span>
                </div>
                ${renderFollowHorizonTable(concept)}
              </div>
            </div>

            <div class="panel">
              <div class="panel-title">
                <h3>V7模型审计总表</h3>
                <span class="meta">含时间衰减、关系漂移和多重检验门槛</span>
              </div>
              ${renderFollowModelTable(followConcepts)}
            </div>

            <div class="panel">
              <div class="panel-title">
                <h3>${esc(concept.short_name)} 个股5日统计</h3>
                <span class="meta">固定5日主终点，状态包含可交易性门槛</span>
              </div>
              ${renderFollowStockTable(concept, snapshot)}
            </div>
          </div>

          <aside class="auto-recommend-col">
            <div class="panel auto-recommend-col-card">
              <div class="panel-title">
                <h3>通过门槛名单</h3>
                <span class="meta">固定${autoRecommendHorizon}日 · 无通过者时留空</span>
              </div>
              ${renderAutoRecommendPanel(autoRecommendStocks, autoRecommendHorizon)}
            </div>
          </aside>
        </div>

        <div class="panel audit-panel">
          <div class="panel-title">
            <h3>历史日期回放</h3>
            <span class="meta">用于核对某天排名和个股K线</span>
          </div>
          <div class="audit-head">
            <label class="date-control">
              <span>回测日期</span>
              <select data-backtest-date>
                ${backtest.date_options
                  .map(
                    (item) =>
                      `<option value="${esc(item.date)}" ${item.date === snapshot.date ? "selected" : ""}>${esc(
                        item.date,
                      )} · ${esc(item.trading_days_ago)}个交易日前</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <div class="metric-grid audit-metrics">
              ${metric("回测日", snapshot.date)}
              ${metric("当日美股第一", usTop?.short_name || "-")}
              ${metric("A股机会第一", cnTop?.short_name || "-")}
            </div>
          </div>
          <div class="backtest-grid">
            <div>
              <div class="panel-title compact-title"><h3>美股当日排名</h3><span class="meta">热度分</span></div>
              ${renderBacktestRankList(snapshot, "us")}
            </div>
            <div>
              <div class="panel-title compact-title"><h3>A股当日排名</h3><span class="meta">机会分</span></div>
              ${renderBacktestRankList(snapshot, "opportunity")}
            </div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>${esc(replayConcept.short_name)} 日期回放摘要</h3>
            <span class="meta">${esc(replayConcept.scores.phase || "")}</span>
          </div>
          <div class="metric-grid">
            ${metric("当日美股均涨跌", pct(replayConcept.scores.us_avg_1d), clsMove(replayConcept.scores.us_avg_1d))}
            ${metric("当日A股均涨跌", pct(replayConcept.scores.cn_avg_1d), clsMove(replayConcept.scores.cn_avg_1d))}
            ${metric("5日平均收益", pct(avgEvents.return_5d), clsMove(avgEvents.return_5d))}
            ${metric("5日命中率", eventWinRates.win_rate_5d === null ? "-" : `${num(eventWinRates.win_rate_5d, 0)}%`)}
            ${metric("10日平均收益", pct(avgEvents.return_10d), clsMove(avgEvents.return_10d))}
            ${metric("10日命中率", eventWinRates.win_rate_10d === null ? "-" : `${num(eventWinRates.win_rate_10d, 0)}%`)}
            ${metric("至今平均收益", pct(replayConcept.cn.avg_return_since), clsMove(replayConcept.cn.avg_return_since))}
            ${metric("至今上涨率", replayWinRate === null ? "-" : `${num(replayWinRate, 0)}%`)}
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>${esc(replayConcept.short_name)} A股回放股票</h3>
            <span class="meta">${esc(replayConcept.cn.companies.length)} 只 · 点击看标记K线</span>
          </div>
          ${renderBacktestStockTable(replayConcept)}
        </div>
      </section>
      ${renderDetailOverlay()}
    </div>
  `;
};

const renderPredictionPage = () => {
  ensurePredictionSelection();
  const follow = followModelData();
  const followConcepts = followRankedConcepts();
  const concept = activeFollowConcept();
  const snapshot = activeBacktestSnapshot();
  const autoRecommendStocks = follow.auto_recommendations || [];
  const screenedCandidates = follow.screened_candidates || [];
  const autoRecommendHorizon = follow.auto_recommendation_horizon || 5;
  const forward = follow.forward_validation || {};
  if (!follow.available || !followConcepts.length || !concept) {
    return `
      <div class="backtest-dashboard prediction-dashboard">
        <section class="backtest-shell prediction-shell">
          ${renderModeSwitch()}
          <div class="panel">
            <div class="panel-title"><h3>预测模块不可用</h3><span class="meta">需要更多历史样本</span></div>
            <div class="empty">${esc(follow.message || "暂无足够样本计算预测名单。")}</div>
          </div>
        </section>
      </div>
    `;
  }
  return `
    <div class="backtest-dashboard prediction-dashboard">
      <section class="backtest-shell prediction-shell">
        <div class="backtest-head">
          <div>
            ${renderModeSwitch()}
            <h1>预测</h1>
            <p>先判断是否具备预测资格，再做5日固定窗口排序。概率来自严格点时样本外检验，并经过时间衰减、近期关系漂移和同批候选多重检验校正。</p>
          </div>
          <div class="follow-rank-card">
            <span>${autoRecommendStocks.length ? "通过门槛第一" : "当前模型结论"}</span>
            <strong>${esc(autoRecommendStocks[0]?.name || "无通过者")}</strong>
            <small>${
              autoRecommendStocks.length
                ? `${num(autoRecommendStocks[0]?.certainty_score, 0)}分 · 固定持有${autoRecommendHorizon}日`
                : `${follow.rejected_stock_count || 0}只被拒绝 · 不强行给出买入型预测`
            }</small>
          </div>
        </div>

        <div class="backtest-method">
          ${esc(follow.method || "")} ${esc(follow.rank_basis || "")}
          当前预测页只作为研究排序和复核入口，不直接等同买入指令。前向验证状态：${esc(
            forward.status || "尚未开始",
          )}，已结算${forward.settled || 0}条。
        </div>
        <a class="report-link-strip cn-report" href="./reports/model_upgrade_v7_20260727.html" target="_blank" rel="noreferrer">
          <span>V7模型升级审计</span>
          <strong>查看量化模型取舍、上线门槛与后续路线</strong>
        </a>

        <div class="metric-grid backtest-metrics">
          ${metric("通过门槛", `${autoRecommendStocks.length}只`)}
          ${metric("已筛选", `${follow.screened_stock_count || screenedCandidates.length}只`)}
          ${metric("当前板块", concept.short_name)}
          ${metric("主决策窗口", "5个交易日")}
          ${metric("校准盈利概率", prob(concept.calibrated_probability))}
          ${metric("无条件基准", prob(concept.baseline_probability))}
          ${metric("条件概率增益", `${num(Number(concept.predictive_lift || 0) * 100, 1)}个百分点`)}
          ${metric("Brier增益", pct(Number(concept.brier_skill || 0) * 100), clsMove(concept.brier_skill))}
          ${metric("近期关系概率", prob(concept.recent_probability))}
          ${metric("关系稳定度", `${num(concept.relationship_stability_score, 0)}分`)}
          ${metric("BH q值", concept.fdr_q_value == null ? "-" : prob(concept.fdr_q_value))}
          ${metric("概率下界", prob(concept.conservative_probability))}
          ${metric("决策状态", concept.decision_status || concept.verdict || "-")}
          ${metric("扣费后均值", pct(concept.avg_return_after_cost), clsMove(concept.avg_return_after_cost))}
          ${metric("OOS样本", `${concept.successes || 0}/${concept.samples || 0}`)}
        </div>

        <div class="panel prediction-primary-panel">
          <div class="panel-title">
            <h3>${autoRecommendStocks.length ? "未来5日通过门槛名单" : "当前无通过者：展示筛选审计"}</h3>
            <span class="meta">固定5日主终点 · 不从1-10日中事后挑最佳</span>
          </div>
          ${
            autoRecommendStocks.length
              ? renderAutoRecommendPanel(autoRecommendStocks, autoRecommendHorizon)
              : renderScreenedCandidatePanel(screenedCandidates.slice(0, 16))
          }
        </div>

        <div class="model-gate-summary" aria-label="拒绝预测原因">
          ${(follow.rejection_summary || [])
            .slice(0, 6)
            .map((item) => `<div><strong>${item.count}</strong><span>${esc(item.reason)}</span></div>`)
            .join("")}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>板块5日样本外审计</h3>
            <span class="meta">点击板块后同步查看概率、基准增益和拒绝原因</span>
          </div>
          ${renderFollowConceptStrip(followConcepts)}
        </div>

        <div class="follow-detail-grid">
          <div class="panel">
            <div class="panel-title">
              <h3>${esc(concept.short_name)} 1-10日历史区间</h3>
              <span class="meta">诊断用途；5日以外不参与模型胜负判定</span>
            </div>
            ${renderFollowConeChart(concept)}
          </div>
          <div class="panel">
            <div class="panel-title">
              <h3>${esc(concept.short_name)} 逐日概率审计</h3>
              <span class="meta">${esc(concept.decision_status || concept.verdict || "")}</span>
            </div>
            ${renderFollowHorizonTable(concept)}
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>${esc(concept.short_name)} 个股5日样本外统计</h3>
            <span class="meta">点击个股可看K线；表内状态已包含可交易性门槛</span>
          </div>
          ${renderFollowStockTable(concept, snapshot)}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>模型审计总表</h3>
            <span class="meta">校准、近期稳定、FDR、超额、成本与触发均须通过</span>
          </div>
          ${renderFollowModelTable(followConcepts)}
        </div>
      </section>
      ${renderDetailOverlay()}
    </div>
  `;
};

const renderMegaBacktestPage = () => {
  ensureMegaBacktestSelection();
  const backtest = backtestData();
  if (!backtest.available) {
    return `
      <div class="backtest-dashboard mega-backtest-dashboard">
        <section class="backtest-shell mega-backtest-shell">
          ${renderModeSwitch()}
          <div class="panel">
            <div class="panel-title"><h3>大回测不可用</h3><span class="meta">需要历史回测快照</span></div>
            <div class="empty">${esc(backtest.message || "暂无回测数据。")}</div>
          </div>
        </section>
      </div>
    `;
  }

  const concepts = megaBacktestConcepts();
  const concept = activeMegaBacktestConcept();
  if (!concept) {
    return `
      <div class="backtest-dashboard mega-backtest-dashboard">
        <section class="backtest-shell mega-backtest-shell">
          ${renderModeSwitch()}
          <div class="empty">暂无可用板块。</div>
        </section>
      </div>
    `;
  }

  const dates = megaBacktestDates(concept.id);
  const rows = megaBacktestCompanyRows(concept.id, dates);
  const returns = megaBacktestConceptReturns(concept.id);
  const avgReturn = averageValue(returns);
  const hitRate = returns.length ? (returns.filter((value) => Number(value) > 0).length / returns.length) * 100 : null;
  const oldest = dates[dates.length - 1]?.date || "-";
  const latest = dates[0]?.date || "-";
  const metricMeta = megaMetricMeta();
  return `
    <div class="backtest-dashboard mega-backtest-dashboard">
      <section class="backtest-shell mega-backtest-shell">
        <div class="backtest-head">
          <div>
            ${renderModeSwitch()}
            <h1>大回测</h1>
            <p>横向按回测日期展开，纵向按A股个股展开；默认看固定5日窗口，也可以切换至今收益、最大有利和最大不利波动。</p>
          </div>
          <div class="mega-head-controls">
            <label class="mega-metric-control">
              <span>矩阵指标</span>
              <select data-mega-metric>
                ${megaMetricOptions
                  .map(
                    (item) =>
                      `<option value="${esc(item.key)}" ${item.key === state.megaMetric ? "selected" : ""}>${esc(
                        item.label,
                      )}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <div class="mega-range-card">
              <span>回测范围</span>
              <strong>${esc(oldest)} - ${esc(latest)}</strong>
              <small>${dates.length} 个交易日快照</small>
            </div>
          </div>
        </div>

        <div class="backtest-method">个股按当前矩阵指标“${esc(metricMeta.label)}”从最新日期向前逐日比较排序。点击收益格会打开对应个股K线，并用黄色标记该列的回测买入日。</div>

        <div class="metric-grid backtest-metrics">
          ${metric("当前板块", concept.short_name)}
          ${metric("A股股票数", `${rows.length}只`)}
          ${metric("样本单元", `${returns.length}个`)}
          ${metric(`平均${metricMeta.label}`, pct(avgReturn), clsMove(avgReturn))}
          ${metric("收益为正占比", hitRate === null ? "-" : `${num(hitRate, 0)}%`)}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>板块</h3>
            <span class="meta">按当前机会分排序，卡片显示历史矩阵均值</span>
          </div>
          ${renderMegaConceptStrip(concepts)}
        </div>

        <div class="panel mega-matrix-panel">
          <div class="panel-title">
            <h3>${esc(concept.short_name)} 个股日期收益矩阵</h3>
            <span class="meta">当前指标：${esc(metricMeta.label)}，右侧横向滑动日期</span>
          </div>
          ${renderMegaBacktestMatrix(concept, dates, rows)}
        </div>
      </section>
      ${renderDetailOverlay()}
    </div>
  `;
};

const renderConfidencePage = () => {
  ensureConfidenceSelection();
  const concept = activeConfidenceConcept();
  if (!concept) {
    return `
      <div class="backtest-dashboard confidence-dashboard">
        <section class="backtest-shell confidence-shell">
          ${renderModeSwitch()}
          <div class="empty">暂无可用可靠度样本。</div>
        </section>
      </div>
    `;
  }
  const aggregate = confidenceAggregate(concept.id);
  const stockRows = confidenceStockAggregates(concept.id);
  return `
    <div class="backtest-dashboard confidence-dashboard">
      <section class="backtest-shell confidence-shell">
        <div class="backtest-head">
          <div>
            ${renderModeSwitch()}
            <h1>置信度审计</h1>
            <p>只看时间顺序样本外概率、无条件基准、时间衰减、近期关系稳定性、FDR校正和尾部风险。5日是预先固定的主终点，其他周期仅用于诊断。</p>
          </div>
          <div class="confidence-controls">
            <label>
              <span>诊断周期</span>
              <select data-confidence-horizon>
                <option value="3" ${state.confidenceHorizon === 3 ? "selected" : ""}>3个交易日</option>
                <option value="5" ${state.confidenceHorizon === 5 ? "selected" : ""}>5个交易日（主终点）</option>
                <option value="10" ${state.confidenceHorizon === 10 ? "selected" : ""}>10个交易日</option>
              </select>
            </label>
          </div>
        </div>

        <div class="backtest-method">
          ${esc(confidenceText(aggregate))}
        </div>

        <div class="metric-grid confidence-metrics">
          ${metric("当前板块", concept.short_name)}
          ${metric("决策状态", aggregate.label)}
          ${metric(`第${aggregate.fixedDay}日校准概率`, `${num(aggregate.realizedRate, 1)}%`)}
          ${metric("无条件基准", `${num(aggregate.baselineRate, 1)}%`)}
          ${metric("条件概率增益", `${num(aggregate.predictiveLift, 1)}个百分点`)}
          ${metric("Brier增益", pct(Number(aggregate.brierSkill || 0) * 100), clsMove(aggregate.brierSkill))}
          ${metric("校准误差", pct(Number(aggregate.calibrationError || 0) * 100))}
          ${metric("近期关系概率", `${num(aggregate.recentRate, 1)}%`)}
          ${metric("关系稳定度", `${num(aggregate.stabilityScore, 0)}分`)}
          ${metric("BH q值", Number.isFinite(aggregate.fdrQ) ? `${num(aggregate.fdrQ, 1)}%` : "-")}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>板块可靠度</h3>
            <span class="meta">全部来自V7点时样本外结果</span>
          </div>
          ${renderConfidenceConceptStrip()}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>${esc(concept.short_name)} 逐日诊断</h3>
            <span class="meta">5日为主终点，其他周期不参与模型胜负判定</span>
          </div>
          ${renderConfidenceDayCards(aggregate)}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>${esc(concept.short_name)} 个股概率审计</h3>
            <span class="meta">${stockRows.length} 只 · 展示校准、基准与拒绝原因</span>
          </div>
          ${renderConfidenceStockTable(stockRows)}
        </div>
      </section>
    </div>
  `;
};

const findSelectedAsset = () => {
  if (!state.selectedAsset) return null;
  if ((state.mode === "backtest" || state.mode === "mega-backtest" || state.mode === "prediction") && state.selectedAsset.kind === "bt-cn") {
    const concept = activeBacktestConcept();
    const item = concept?.cn?.companies?.find((company) => company.code === state.selectedAsset.id);
    if (!concept || !item) return null;
    return { kind: "bt-cn", item: { ...item, live: liveCompanyByCode(concept.id, item.code) }, concept };
  }
  const concept = activeConcept();
  if (state.selectedAsset.kind === "us") {
    const item = concept.us.tickers.find((quote) => quote.symbol === state.selectedAsset.id);
    return item ? { kind: "us", item, concept } : null;
  }
  const item = concept.cn.companies.find((company) => company.code === state.selectedAsset.id);
  return item ? { kind: "cn", item, concept } : null;
};

const chartCacheKey = (kind, item) => `${kind}:${kind === "us" ? item.symbol : item.code}`;

const renderDetailOverlay = () => {
  const selected = findSelectedAsset();
  if (!selected) return "";
  const { kind, item, concept } = selected;
  const isUs = kind === "us";
  const isBacktest = kind === "bt-cn";
  const liveItem = item.live || item;
  const title = isUs ? item.symbol : `${item.code} ${item.name}`;
  const subtitle = isUs
    ? `${concept.name} · ${item.source || "US quote"}`
    : isBacktest
      ? `${concept.name} · 回测 ${item.buy_date} · ${item.market} 市场 · ${item.role}`
      : `${concept.name} · ${item.market} 市场 · ${item.role}`;
  const cacheKey = chartCacheKey(kind, item);
  const cachedChart = state.chartCache[cacheKey];
  const isLoadingChart = state.chartLoading[cacheKey];
  const chartRows = cachedChart?.rows || liveItem.candles || liveItem.spark || item.candles || item.spark || [];
  const period = cachedChart?.period || liveItem.candle_period || liveItem.chart_period || item.candle_period || item.chart_period || "5年日K";
  const chartHint = isLoadingChart
    ? "正在加载5年K线..."
    : cachedChart?.error
      ? `长期K线加载失败：${cachedChart.error}`
    : cachedChart?.rows?.length
      ? `已加载 ${cachedChart.rows.length} 根5年日K`
      : liveItem.chart_ref || item.chart_ref
        ? "5年K线将在打开后自动加载"
        : "当前只有随首页缓存写入的K线";
  return `
    <div class="detail-backdrop" data-detail-close="1">
      <section class="detail-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}详情">
        <div class="detail-head">
          <div>
            <h3 class="detail-title">${esc(title)}</h3>
            <div class="detail-subtitle">${esc(subtitle)}</div>
          </div>
          <button class="icon-button" type="button" data-detail-close="1" aria-label="关闭" onclick="window.__marketLagCloseDetail && window.__marketLagCloseDetail()">${closeIcon()}</button>
        </div>
        <div class="detail-grid">
          ${
            isBacktest
              ? `
                ${metric("回测买入价", num(item.buy_price))}
                ${metric("1日收益", pct(item.return_1d), clsMove(item.return_1d))}
                ${metric("5日收益", pct(item.return_5d), clsMove(item.return_5d))}
                ${metric("10日收益", pct(item.return_10d), clsMove(item.return_10d))}
                ${metric("5日最好", pct(item.mfe_5d), clsMove(item.mfe_5d))}
                ${metric("5日最差", pct(item.mae_5d), clsMove(item.mae_5d))}
                ${metric("至今收益", pct(item.return_since), clsMove(item.return_since))}
                ${metric("回测日涨跌", pct(item.buy_day_change), clsMove(item.buy_day_change))}
              `
              : `
                ${metric("最新价", isUs ? `${num(item.price)} ${esc(item.currency || "USD")}` : num(item.price))}
                ${metric("日涨跌", pct(isUs ? item.change_1d : item.change), clsMove(isUs ? item.change_1d : item.change))}
                ${metric(isUs ? "5日涨跌" : "成交额", isUs ? pct(item.change_5d) : item.amount_label, clsMove(item.change_5d))}
                ${metric(isUs ? "量比" : "数据源", isUs ? num(item.relative_volume) : item.source)}
              `
          }
        </div>
        <div class="detail-chart">${renderKlineChart(chartRows, {
          period,
          range: state.chartRange,
          isUs,
          markerDate: isBacktest ? item.buy_date : null,
          markerValue: isBacktest ? item.buy_price : null,
          markerLabel: "回测点",
        })}</div>
        <div class="detail-note">
          ${
            isBacktest
              ? `黄色标记是回测买入日 ${esc(item.buy_date)}，收益按该日收盘价 ${num(item.buy_price)} 到最新缓存收盘价 ${num(
                  item.latest_price,
                )} 计算，同时展示固定1/5/10日窗口和5日最大有利/不利波动。${esc(chartHint)} 映射理由：${esc(item.reason)}`
              : isUs
              ? `K线来自本地缓存的 Yahoo OHLC 数据，可切换1月、3月、6月、1年、3年、5年。${esc(
                  chartHint,
                )} 当前表格按日涨跌排序，量比为最近一日成交量相对近20个交易日均量。`
              : `K线来自本地缓存的A股日线数据，可切换1月、3月、6月、1年、3年、5年。${esc(
                  chartHint,
                )} 映射理由：${esc(
                  item.reason,
                )} 当前覆盖沪深不同上市板块；下一步要继续核公告、订单、客户和估值。`
          }
        </div>
      </section>
    </div>
  `;
};

const render = () => {
  const scrollSnapshot = readScrollSnapshot();
  const data = state.data;
  if (state.mode === "backtest") {
    app.innerHTML = renderBacktestPage();
    attachKlineHover();
    loadSelectedChart();
    restoreScrollSnapshot(scrollSnapshot);
    return;
  }
  if (state.mode === "mega-backtest") {
    app.innerHTML = renderMegaBacktestPage();
    attachKlineHover();
    loadSelectedChart();
    restoreScrollSnapshot(scrollSnapshot);
    return;
  }
  if (state.mode === "confidence") {
    app.innerHTML = renderConfidencePage();
    restoreScrollSnapshot(scrollSnapshot);
    return;
  }
  if (state.mode === "prediction") {
    app.innerHTML = renderPredictionPage();
    attachKlineHover();
    loadSelectedChart();
    restoreScrollSnapshot(scrollSnapshot);
    return;
  }
  const concept = activeConcept();
  const ibkr = data.connectors.ibkr || {};
  const manualImport = data.connectors.manual_import || {};
  const cnConnector = data.connectors.cn_quotes || {};
  const xConnector = data.connectors.x || {};
  const usStatusItems = [
    { label: "IBKR", value: "public", status: ibkr.status, detail: "公开研究" },
    { label: "US Quotes", value: "live", status: data.connectors.us_quotes.status, detail: "Yahoo 5年日K" },
    { label: "US News", value: "live", status: data.connectors.us_news.status, detail: "Google RSS" },
    {
      label: "X",
      value: xConnector.status === "disabled_free_mode" ? "free" : "enabled",
      status: xConnector.status,
      detail: xConnector.status === "disabled_free_mode" ? "不调用付费API" : "API enabled",
    },
    { label: "Personal", value: "manual", status: manualImport.status, detail: "手动导入" },
  ];
  const cnStatusItems = [
    { label: "CN Quotes", value: "live", status: cnConnector.status, detail: cnConnector.source || "" },
    { label: "Market", value: "沪深市场", status: "connected", detail: "含主板/创业板/科创板" },
    {
      label: "Market Scan",
      value: `${data.dynamic_discovery?.universe_count || "--"} 候选`,
      status: "connected",
      detail: `本轮入选 ${data.dynamic_discovery?.selected_count || data.concepts.length}`,
    },
    { label: "Current", value: concept.short_name, status: "connected", detail: concept.scores.phase },
    { label: "Risk", value: "research", status: "connected", detail: "不构成投资建议" },
  ];

  app.innerHTML = `
    <div class="split-dashboard">
      <section class="side us-side">
        ${renderModeSwitch()}
        <div class="topbar">
          <div class="title-block">
            <h1>美股信号</h1>
            <p>${esc(data.summary.thesis)}</p>
          </div>
          <div class="time-stack">
            <div>NY ${esc(data.market_clock.new_york)}</div>
            <div>生成 ${esc(data.generated_at_shanghai)}</div>
          </div>
        </div>

        ${statusRail(usStatusItems)}

        ${reportLinkStrip("us")}

        ${renderConceptPicker()}

        ${renderConceptBrief("us")}

        <div class="panel signal-panel">
          <div class="panel-title">
            <h3>美股动量</h3>
            <span class="meta">按日涨跌排序</span>
          </div>
          <div class="metric-grid">
            ${metric("研究热度", num(concept.scores.research_heat_score ?? concept.scores.lag_score, 1))}
            ${metric("美股残差", pct(concept.scores.us_residual_1d ?? concept.scores.us_avg_1d), clsMove(concept.scores.us_residual_1d ?? concept.scores.us_avg_1d))}
            ${metric("残差滞后", pct(concept.scores.lag_gap_neutral ?? concept.scores.lag_gap), clsMove(concept.scores.lag_gap_neutral ?? concept.scores.lag_gap))}
            ${metric("证据覆盖", num(concept.scores.signal_coverage_score ?? concept.scores.global_factor_score, 1))}
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>美股细分标的</h3>
            <span class="meta">${esc(concept.us.tickers.length)} 只 · Yahoo 5年日K</span>
          </div>
          ${renderUsTable(concept)}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>新闻与权威来源</h3>
            <span class="meta">${esc(concept.us.news.length)} 条新闻 · ${esc((concept.us.research || []).length)} 条公开研究</span>
          </div>
          ${renderSources(concept)}
          <div style="height:10px"></div>
          ${renderNews(concept)}
          <div class="section-divider"></div>
          ${renderResearch(concept)}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>个人账户导入</h3>
            <span class="meta">${esc(manualImport.status || "optional")}</span>
          </div>
          ${renderManualImport(manualImport)}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>公开讨论</h3>
            <span class="meta">${esc(concept.us.x_discussion?.status || "unknown")}</span>
          </div>
          ${renderX(concept)}
        </div>
      </section>

      <section class="side cn-side">
        <div class="topbar">
          <div class="title-block">
            <h2>A股映射</h2>
            <p>${esc(data.summary.method)}</p>
          </div>
          <div class="time-stack">
            <div>SH ${esc(data.market_clock.shanghai)}</div>
            <div>覆盖沪深多板块</div>
          </div>
        </div>

        ${statusRail(cnStatusItems)}

        ${reportLinkStrip("cn")}

        ${renderScanAudit()}

        ${renderConceptPicker({ side: "cn", mode: "opportunity" })}

        ${renderConceptBrief("cn")}

        <div class="panel signal-panel">
          <div class="panel-title">
            <h3>A股机会结构</h3>
            <span class="meta">按机会分排序</span>
          </div>
          <div class="metric-grid">
            ${metric("综合机会", num(concept.scores.opportunity_score ?? concept.scores.lag_score, 1))}
            ${metric("映射质量", num(concept.scores.mapping_quality_score, 1))}
            ${metric("成交确认", num(concept.scores.cn_confirm_score ?? concept.scores.cn_liquidity_score ?? 0, 1))}
            ${metric("风险惩罚", num((Number(concept.scores.overheat_penalty || 0) + Number(concept.scores.reversal_penalty || 0)), 1))}
          </div>
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>供应链映射</h3>
            <span class="meta">从美股主题到 A 股公司</span>
          </div>
          ${renderMappingRows(concept)}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>A 股映射行情</h3>
            <span class="meta">${esc(concept.cn.companies.length)} 只 · 实时或最近收盘</span>
          </div>
          ${renderCnTable(concept)}
        </div>

        <div class="panel">
          <div class="panel-title">
            <h3>本轮结论</h3>
            <span class="meta">${esc(concept.scores.phase)}</span>
          </div>
          <p class="thesis">
            ${esc(concept.name)} 的美股残差为 ${pct(concept.scores.us_residual_1d ?? concept.scores.us_avg_1d)}，A股残差为 ${pct(
              concept.scores.cn_residual_1d ?? concept.scores.cn_avg_1d,
            )}，残差滞后差为 ${pct(concept.scores.lag_gap_neutral ?? concept.scores.lag_gap)}。当前动作口径是“${esc(
              concept.scores.action || "观察",
            )}”，优先跟踪公告、订单、客户认证和成交额是否同步放大。
          </p>
          ${riskBadges(concept.scores)}
          <div class="risk-line">${esc(data.summary.risk)}</div>
        </div>
      </section>
    </div>
    ${renderDetailOverlay()}
  `;

  attachKlineHover();
  loadSelectedChart();
  restoreScrollSnapshot(scrollSnapshot);
};

window.__marketLagSetChartRange = (range) => {
  state.chartRange = range || "1M";
  render();
};

window.__marketLagCloseDetail = () => {
  state.selectedAsset = null;
  render();
};

app.addEventListener("click", (event) => {
  const modeButton = event.target.closest?.("[data-mode]");
  if (modeButton) {
    event.preventDefault();
    const nextMode = modeButton.getAttribute("data-mode");
    if (nextMode === "a-share") {
      location.href = "./a_share.html";
      return;
    }
    state.mode = "live";
    state.selectedAsset = null;
    if (state.mode === "backtest") ensureBacktestSelection();
    if (state.mode === "mega-backtest") ensureMegaBacktestSelection();
    if (state.mode === "confidence") ensureConfidenceSelection();
    if (state.mode === "prediction") ensurePredictionSelection();
    render();
    return;
  }

  const closeTarget = event.target.closest?.("[data-detail-close]");
  if (closeTarget) {
    if (event.target === closeTarget || closeTarget.tagName === "BUTTON") {
      event.preventDefault();
      state.selectedAsset = null;
      render();
      return;
    }
  }

  const rangeButton = event.target.closest?.("[data-chart-range]");
  if (rangeButton) {
    event.preventDefault();
    state.chartRange = rangeButton.getAttribute("data-chart-range") || "1M";
    render();
    return;
  }

  const toggleButton = event.target.closest?.("[data-menu-toggle]");
  if (toggleButton) {
    event.preventDefault();
    const side = toggleButton.getAttribute("data-menu-toggle");
    if (side === "cn") {
      state.cnMenuOpen = !state.cnMenuOpen;
    } else {
      state.usMenuOpen = !state.usMenuOpen;
    }
    render();
    return;
  }

  const backtestConceptTarget = event.target.closest?.("[data-backtest-concept]");
  if (backtestConceptTarget) {
    event.preventDefault();
    state.backtestActiveId = backtestConceptTarget.getAttribute("data-backtest-concept");
    state.selectedAsset = null;
    render();
    return;
  }

  const megaBacktestConceptTarget = event.target.closest?.("[data-mega-backtest-concept]");
  if (megaBacktestConceptTarget) {
    event.preventDefault();
    state.megaBacktestActiveId = megaBacktestConceptTarget.getAttribute("data-mega-backtest-concept");
    state.selectedAsset = null;
    render();
    return;
  }

  const confidenceConceptTarget = event.target.closest?.("[data-confidence-concept]");
  if (confidenceConceptTarget) {
    event.preventDefault();
    state.confidenceActiveId = confidenceConceptTarget.getAttribute("data-confidence-concept");
    state.selectedAsset = null;
    render();
    return;
  }

  const conceptButtonTarget = event.target.closest?.("[data-concept]");
  if (conceptButtonTarget) {
    event.preventDefault();
    state.activeId = conceptButtonTarget.getAttribute("data-concept");
    state.selectedAsset = null;
    render();
    return;
  }

  const assetRow = event.target.closest?.("[data-asset-kind]");
  if (assetRow) {
    event.preventDefault();
    const backtestDate = assetRow.getAttribute("data-backtest-date-set");
    const backtestConceptId = assetRow.getAttribute("data-backtest-concept-set");
    if (backtestDate) state.backtestDate = backtestDate;
    if (backtestConceptId) state.backtestActiveId = backtestConceptId;
    state.selectedAsset = {
      kind: assetRow.getAttribute("data-asset-kind"),
      id: assetRow.getAttribute("data-asset-id"),
    };
    render();
  }
});

app.addEventListener("change", (event) => {
  const megaMetric = event.target.closest?.("[data-mega-metric]");
  if (megaMetric) {
    state.megaMetric = megaMetric.value || "return_5d";
    state.selectedAsset = null;
    render();
    return;
  }
  const confidenceThreshold = event.target.closest?.("[data-confidence-threshold]");
  if (confidenceThreshold) {
    state.confidenceMinScore = Number(confidenceThreshold.value);
    state.selectedAsset = null;
    render();
    return;
  }
  const confidenceHorizon = event.target.closest?.("[data-confidence-horizon]");
  if (confidenceHorizon) {
    state.confidenceHorizon = Number(confidenceHorizon.value);
    state.selectedAsset = null;
    render();
    return;
  }
  const dateSelect = event.target.closest?.("[data-backtest-date]");
  if (!dateSelect) return;
  state.backtestDate = dateSelect.value;
  const snapshot = activeBacktestSnapshot();
  if (snapshot?.concepts?.length && !snapshot.concepts.some((concept) => concept.id === state.backtestActiveId)) {
    state.backtestActiveId = followModelData().top_concept_id || snapshot.concepts?.[0]?.id || null;
  }
  state.selectedAsset = null;
  render();
});

app.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const assetRow = event.target.closest?.("[data-asset-kind]");
  if (!assetRow) return;
  event.preventDefault();
  const backtestDate = assetRow.getAttribute("data-backtest-date-set");
  const backtestConceptId = assetRow.getAttribute("data-backtest-concept-set");
  if (backtestDate) state.backtestDate = backtestDate;
  if (backtestConceptId) state.backtestActiveId = backtestConceptId;
  state.selectedAsset = {
    kind: assetRow.getAttribute("data-asset-kind"),
    id: assetRow.getAttribute("data-asset-id"),
  };
  render();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !state.selectedAsset) return;
  event.preventDefault();
  state.selectedAsset = null;
  render();
});

const attachKlineHover = () => {
  document.querySelectorAll(".kline-chart-wrap").forEach((wrap) => {
    const tooltip = wrap.querySelector(".chart-tooltip");
    const hoverLine = wrap.querySelector(".chart-hover-line");
    if (!tooltip || !hoverLine) return;
    wrap.querySelectorAll(".hover-zone").forEach((zone) => {
      const show = (event) => {
        const data = zone.dataset;
        tooltip.hidden = false;
        tooltip.innerHTML = `
          <strong>${esc(data.date)}</strong>
          <span>开 ${esc(data.open)} 高 ${esc(data.high)}</span>
          <span>低 ${esc(data.low)} 收 ${esc(data.close)}</span>
          <span>日内 ${esc(data.change)} · 量 ${esc(data.volume)}</span>
        `;
        const wrapRect = wrap.getBoundingClientRect();
        const x = Number(data.x || 0);
        hoverLine.setAttribute("x1", String(x));
        hoverLine.setAttribute("x2", String(x));
        hoverLine.classList.add("visible");
        const localX = event.clientX - wrapRect.left;
        const left = Math.max(8, Math.min(localX + 12, wrapRect.width - 172));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = "28px";
      };
      zone.addEventListener("pointerenter", show);
      zone.addEventListener("pointermove", show);
      zone.addEventListener("pointerleave", () => {
        tooltip.hidden = true;
        hoverLine.classList.remove("visible");
      });
    });
  });
};

const loadSelectedChart = async () => {
  const selected = findSelectedAsset();
  if (!selected) return;
  const { kind, item } = selected;
  const ref = item.live?.chart_ref || item.chart_ref;
  if (!ref) return;
  const key = chartCacheKey(kind, item);
  if (state.chartCache[key]?.rows || state.chartLoading[key]) return;
  state.chartLoading[key] = true;
  try {
    const response = await fetch(ref, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.chartCache[key] = {
      rows: Array.isArray(payload.rows) ? payload.rows : [],
      period: payload.period || item.candle_period || "5年日K",
    };
  } catch (error) {
    state.chartCache[key] = { rows: null, error: error.message || String(error) };
  } finally {
    state.chartLoading[key] = false;
  }
  const current = findSelectedAsset();
  if (current && chartCacheKey(current.kind, current.item) === key) render();
};

const boot = async () => {
  try {
    if (window.__MARKET_LAG_DASHBOARD__) {
      state.data = window.__MARKET_LAG_DASHBOARD__;
      state.activeId = state.data.concepts[0]?.id;
      const initMode = resolveModeFromURL(new URLSearchParams(location.search).get("mode"));
      if (initMode) {
        state.mode = initMode;
      }
      if (state.mode === "backtest") ensureBacktestSelection();
      if (state.mode === "mega-backtest") ensureMegaBacktestSelection();
      if (state.mode === "confidence") ensureConfidenceSelection();
      if (state.mode === "prediction") ensurePredictionSelection();
      render();
      return;
    }
    const response = await fetch("./data/dashboard.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.data = data;
    state.activeId = data.concepts[0]?.id;
    const initMode = resolveModeFromURL(new URLSearchParams(location.search).get("mode"));
    if (initMode) {
      state.mode = initMode;
    }
    if (state.mode === "backtest") ensureBacktestSelection();
    if (state.mode === "mega-backtest") ensureMegaBacktestSelection();
    if (state.mode === "confidence") ensureConfidenceSelection();
    if (state.mode === "prediction") ensurePredictionSelection();
    render();
  } catch (error) {
    app.innerHTML = `
      <section class="loading-state">
        <div class="loading-title">数据未生成</div>
        <div class="empty">请先运行刷新脚本生成 dashboard.json。${esc(error.message)}</div>
      </section>
    `;
  }
};

boot();
