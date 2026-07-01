export type ValuationRegion =
  | "美国"
  | "中国内地"
  | "香港"
  | "日本"
  | "韩国"
  | "印度"
  | "越南"
  | "欧洲"
  | "全球";

export type ValuationQuality = "官方/指数口径" | "ETF近似" | "第三方估算";

export type IndexValuation = {
  id: string;
  name: string;
  region: ValuationRegion;
  proxy: string;
  peTtm: number | null;
  forwardPe: number | null;
  pb: number | null;
  dividendYield: number | null;
  currency: string;
  valuationBand: "低" | "中" | "高" | "很高" | "缺数据";
  quality: ValuationQuality;
  sourceName: string;
  sourceUrl: string;
  note: string;
};

export type GlobalValuationSnapshot = {
  asOf: string;
  asOfLabel: string;
  methodology: string;
  rows: IndexValuation[];
  qdiiGroups: QdiiEtfGroup[];
};

export type QdiiEtf = {
  code: string;
  name: string;
  manager: string;
  market: string;
  tracking: string;
  exchange: "上交所" | "深交所";
  sourceType: "QDII-ETF" | "港股通ETF" | "跨境ETF";
  note: string;
};

export type QdiiEtfQuote = {
  code: string;
  price: number | null;
  priceDate: string | null;
  priceTime: string | null;
  changePct: number | null;
  amount: number | null;
  nav: number | null;
  navDate: string | null;
  navTime: string | null;
  navSource: string;
  premiumRate: number | null;
  sourceName: string;
  subscriptionStatus: string | null;
  redemptionStatus: string | null;
  subscriptionOpen: boolean | null;
  subscriptionDate: string | null;
  subscriptionMinAmount: string | null;
  dailySubscriptionCount: string | null;
  dailySubscriptionLimit: string | null;
  subscriptionSource: string | null;
  subscriptionSourceUrl: string | null;
  subscriptionNote: string | null;
  updatedAt: string;
  status: "ok" | "partial" | "missing";
};

export type QdiiEtfGroup = {
  id: string;
  title: string;
  description: string;
  items: QdiiEtf[];
};

function shanghaiDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const day = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;

  return {
    asOf: new Date().toISOString(),
    asOfLabel: `${day} ${time} 北京时间`,
  };
}

function band(pe: number | null): IndexValuation["valuationBand"] {
  if (pe == null) return "缺数据";
  if (pe < 12) return "低";
  if (pe < 20) return "中";
  if (pe < 30) return "高";
  return "很高";
}

const rows: Omit<IndexValuation, "valuationBand">[] = [
  {
    id: "sp500",
    name: "S&P 500",
    region: "美国",
    proxy: "SPY / VOO",
    peTtm: 25.0,
    forwardPe: 22.0,
    pb: 5.1,
    dividendYield: 1.2,
    currency: "USD",
    quality: "ETF近似",
    sourceName: "SPDR / Vanguard / S&P DJI",
    sourceUrl: "https://www.spglobal.com/spdji/en/indices/equity/sp-500/",
    note: "大盘成长权重较高，TTM 与 Forward PE 差异需要分开看。",
  },
  {
    id: "nasdaq100",
    name: "Nasdaq 100",
    region: "美国",
    proxy: "QQQ",
    peTtm: 34.0,
    forwardPe: 28.0,
    pb: 8.5,
    dividendYield: 0.5,
    currency: "USD",
    quality: "ETF近似",
    sourceName: "Invesco QQQ",
    sourceUrl: "https://www.invesco.com/qqq-etf/en/home.html",
    note: "科技权重高，估值主要受 AI、软件和半导体盈利预期影响。",
  },
  {
    id: "dow",
    name: "Dow Jones",
    region: "美国",
    proxy: "DIA",
    peTtm: 26.5,
    forwardPe: 21.0,
    pb: 4.8,
    dividendYield: 1.8,
    currency: "USD",
    quality: "ETF近似",
    sourceName: "SPDR DIA",
    sourceUrl: "https://www.ssga.com/us/en/intermediary/etfs/funds/spdr-dow-jones-industrial-average-etf-trust-dia",
    note: "30 只成分股，口径和市值加权宽基指数不同。",
  },
  {
    id: "russell2000",
    name: "Russell 2000",
    region: "美国",
    proxy: "IWM",
    peTtm: 39.0,
    forwardPe: 23.0,
    pb: 1.9,
    dividendYield: 1.2,
    currency: "USD",
    quality: "ETF近似",
    sourceName: "iShares IWM",
    sourceUrl: "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf",
    note: "小盘股亏损公司较多，TTM PE 容易失真，更适合结合 Forward PE 和 PB。",
  },
  {
    id: "csi300",
    name: "沪深300",
    region: "中国内地",
    proxy: "510300 / ASHR",
    peTtm: 13.0,
    forwardPe: null,
    pb: 1.4,
    dividendYield: 2.4,
    currency: "CNY",
    quality: "第三方估算",
    sourceName: "中证指数 / ETF",
    sourceUrl: "https://www.csindex.com.cn/",
    note: "建议后续接中证指数估值接口或交易所数据替换。",
  },
  {
    id: "csi500",
    name: "中证500",
    region: "中国内地",
    proxy: "510500",
    peTtm: 24.0,
    forwardPe: null,
    pb: 1.8,
    dividendYield: 1.6,
    currency: "CNY",
    quality: "第三方估算",
    sourceName: "中证指数 / ETF",
    sourceUrl: "https://www.csindex.com.cn/",
    note: "中盘成长和周期暴露更高，PE 波动通常大于沪深300。",
  },
  {
    id: "sse50",
    name: "上证50",
    region: "中国内地",
    proxy: "510050",
    peTtm: 10.5,
    forwardPe: null,
    pb: 1.2,
    dividendYield: 3.4,
    currency: "CNY",
    quality: "第三方估算",
    sourceName: "上交所 / 中证指数",
    sourceUrl: "https://www.csindex.com.cn/",
    note: "金融和央国企权重高，PB 和股息率比 PE 更有解释力。",
  },
  {
    id: "star50",
    name: "科创50",
    region: "中国内地",
    proxy: "588000 / 588080",
    peTtm: 54.0,
    forwardPe: null,
    pb: 4.3,
    dividendYield: 0.4,
    currency: "CNY",
    quality: "第三方估算",
    sourceName: "上交所 / 中证指数 / ETF",
    sourceUrl: "https://www.csindex.com.cn/",
    note: "半导体、硬科技和创新药权重较高，PE 常年波动大，需结合盈利周期看。",
  },
  {
    id: "hsi",
    name: "恒生指数",
    region: "香港",
    proxy: "2800.HK",
    peTtm: 11.0,
    forwardPe: 10.0,
    pb: 1.2,
    dividendYield: 3.3,
    currency: "HKD",
    quality: "官方/指数口径",
    sourceName: "Hang Seng Indexes",
    sourceUrl: "https://www.hsi.com.hk/eng",
    note: "港股估值低位时也要同时看盈利下修和美元利率。",
  },
  {
    id: "hstech",
    name: "恒生科技",
    region: "香港",
    proxy: "3033.HK / KWEB",
    peTtm: 27.0,
    forwardPe: 18.0,
    pb: 2.5,
    dividendYield: 0.6,
    currency: "HKD",
    quality: "ETF近似",
    sourceName: "Hang Seng Indexes / ETF",
    sourceUrl: "https://www.hsi.com.hk/eng/indexes/all-indexes/hstech",
    note: "互联网和硬科技权重高，Forward PE 比 TTM PE 更重要。",
  },
  {
    id: "nikkei225",
    name: "日经225",
    region: "日本",
    proxy: "1321.T / EWJ",
    peTtm: 23.0,
    forwardPe: 20.0,
    pb: 2.2,
    dividendYield: 1.6,
    currency: "JPY",
    quality: "ETF近似",
    sourceName: "Nikkei / ETF",
    sourceUrl: "https://indexes.nikkei.co.jp/en/nkave",
    note: "价格加权指数，估值和 TOPIX 口径差异较大。",
  },
  {
    id: "topix",
    name: "TOPIX",
    region: "日本",
    proxy: "1306.T / EWJ",
    peTtm: 17.0,
    forwardPe: 15.0,
    pb: 1.5,
    dividendYield: 2.0,
    currency: "JPY",
    quality: "ETF近似",
    sourceName: "JPX / ETF",
    sourceUrl: "https://www.jpx.co.jp/english/markets/indices/topix/",
    note: "比日经225更接近日本全市场大盘估值。",
  },
  {
    id: "kospi",
    name: "韩国 KOSPI / MSCI Korea",
    region: "韩国",
    proxy: "EWY / 069500.KS",
    peTtm: 26.4,
    forwardPe: null,
    pb: 2.74,
    dividendYield: 1.0,
    currency: "KRW",
    quality: "ETF近似",
    sourceName: "iShares EWY",
    sourceUrl: "https://www.ishares.com/us/products/239681/ishares-msci-south-korea-etf",
    note: "EWY 跟踪 MSCI Korea 25/50，和 KOSPI 不完全一致；三星电子、SK 海力士等科技权重会显著影响估值。",
  },
  {
    id: "nifty50",
    name: "NIFTY 50",
    region: "印度",
    proxy: "NIFTYBEES / INDA",
    peTtm: 22.5,
    forwardPe: 20.0,
    pb: 3.6,
    dividendYield: 1.2,
    currency: "INR",
    quality: "官方/指数口径",
    sourceName: "NSE Indices",
    sourceUrl: "https://www.niftyindices.com/indices/equity/broad-based-indices/NIFTY--50",
    note: "长期高 ROE 市场，估值通常高于其他新兴市场。",
  },
  {
    id: "vietnam",
    name: "越南 VN-Index / VNM",
    region: "越南",
    proxy: "VNM / VN30 ETF",
    peTtm: 14.0,
    forwardPe: null,
    pb: 2.05,
    dividendYield: 0.2,
    currency: "VND",
    quality: "ETF近似",
    sourceName: "VanEck VNM",
    sourceUrl: "https://www.vaneck.com/us/en/investments/vietnam-etf-vnm/",
    note: "VNM 跟踪 MarketVector Vietnam Local Index，接近越南本地上市公司篮子；地产、金融和消费权重较高。",
  },
  {
    id: "dax",
    name: "DAX",
    region: "欧洲",
    proxy: "DAXEX / EWG",
    peTtm: 15.0,
    forwardPe: 13.5,
    pb: 1.8,
    dividendYield: 2.6,
    currency: "EUR",
    quality: "ETF近似",
    sourceName: "STOXX / ETF",
    sourceUrl: "https://www.dax-indices.com/",
    note: "出口和工业周期暴露较高，需结合欧元和全球制造业周期。",
  },
  {
    id: "ftse100",
    name: "FTSE 100",
    region: "欧洲",
    proxy: "ISF.L / EWU",
    peTtm: 12.0,
    forwardPe: 11.0,
    pb: 1.7,
    dividendYield: 3.8,
    currency: "GBP",
    quality: "ETF近似",
    sourceName: "FTSE Russell / ETF",
    sourceUrl: "https://www.lseg.com/en/ftse-russell/indices/uk",
    note: "资源、金融和高股息权重较高，股息率是重要指标。",
  },
  {
    id: "cac40",
    name: "CAC 40",
    region: "欧洲",
    proxy: "CAC.PA / EWQ",
    peTtm: 14.0,
    forwardPe: 12.5,
    pb: 1.9,
    dividendYield: 2.9,
    currency: "EUR",
    quality: "ETF近似",
    sourceName: "Euronext / ETF",
    sourceUrl: "https://live.euronext.com/en/product/indices/FR0003500008-XPAR",
    note: "奢侈品、工业和金融权重对估值影响较大。",
  },
  {
    id: "stoxx600",
    name: "STOXX Europe 600",
    region: "欧洲",
    proxy: "EXSA.DE / FEZ",
    peTtm: 15.5,
    forwardPe: 13.8,
    pb: 1.9,
    dividendYield: 3.0,
    currency: "EUR",
    quality: "ETF近似",
    sourceName: "STOXX",
    sourceUrl: "https://stoxx.com/index/sxxp/",
    note: "欧洲宽基，通常比单一国家指数更适合做区域估值锚。",
  },
  {
    id: "msciworld",
    name: "MSCI World",
    region: "全球",
    proxy: "URTH / IWDA",
    peTtm: 22.0,
    forwardPe: 19.5,
    pb: 3.4,
    dividendYield: 1.8,
    currency: "USD",
    quality: "ETF近似",
    sourceName: "MSCI / iShares",
    sourceUrl: "https://www.msci.com/indexes/index/990100",
    note: "美国权重较高，本质上会受到美股估值牵引。",
  },
  {
    id: "msciem",
    name: "MSCI Emerging Markets",
    region: "全球",
    proxy: "EEM / IEMG",
    peTtm: 13.0,
    forwardPe: 11.6,
    pb: 1.8,
    dividendYield: 2.5,
    currency: "USD",
    quality: "ETF近似",
    sourceName: "MSCI / iShares",
    sourceUrl: "https://www.msci.com/indexes/index/891800",
    note: "中国、台湾、印度、韩国权重变化会显著影响估值。",
  },
];

export const qdiiGroups: QdiiEtfGroup[] = [
  {
    id: "sp500",
    title: "标普500",
    description: "跟踪美国大盘宽基，适合作为美股核心仓位观察组。",
    items: [
      {
        code: "513500",
        name: "标普500ETF",
        manager: "博时基金",
        market: "美国",
        tracking: "S&P 500",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "老牌标普500场内产品，关注溢价和申购状态。",
      },
      {
        code: "159612",
        name: "标普500ETF",
        manager: "国泰基金",
        market: "美国",
        tracking: "S&P 500",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "深交所标普500产品，可与沪市同类比较溢价和成交额。",
      },
      {
        code: "159655",
        name: "标普ETF",
        manager: "华夏基金",
        market: "美国",
        tracking: "S&P 500",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "深交所标普500产品，适合作为同类流动性补充。",
      },
      {
        code: "513650",
        name: "标普ETF",
        manager: "南方基金",
        market: "美国",
        tracking: "S&P 500",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "同类替代标的，适合和 513500 横向比较成交额与溢价。",
      },
    ],
  },
  {
    id: "nasdaq100",
    title: "纳斯达克100",
    description: "偏美股科技成长，受 AI、半导体、软件和美元利率影响更大。",
    items: [
      {
        code: "159501",
        name: "纳斯达克指数ETF",
        manager: "嘉实基金",
        market: "美国",
        tracking: "Nasdaq 100 / Nasdaq 指数",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "深交所纳指类产品，需确认具体跟踪口径。",
      },
      {
        code: "159509",
        name: "纳指科技ETF",
        manager: "景顺长城基金",
        market: "美国",
        tracking: "纳指科技",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "更偏纳指科技主题，不完全等同标准 Nasdaq 100。",
      },
      {
        code: "159513",
        name: "纳斯达克100指数ETF",
        manager: "大成基金",
        market: "美国",
        tracking: "Nasdaq 100",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "深交所纳斯达克100产品。",
      },
      {
        code: "159659",
        name: "纳斯达克100ETF",
        manager: "招商基金",
        market: "美国",
        tracking: "Nasdaq 100",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "深交所纳斯达克100产品。",
      },
      {
        code: "159660",
        name: "纳指100ETF",
        manager: "汇添富基金",
        market: "美国",
        tracking: "Nasdaq 100",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "深交所纳斯达克100产品。",
      },
      {
        code: "513100",
        name: "纳指ETF",
        manager: "国泰基金",
        market: "美国",
        tracking: "Nasdaq 100",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "成交活跃，溢价率经常是重点观察项。",
      },
      {
        code: "513110",
        name: "纳指100",
        manager: "华泰柏瑞基金",
        market: "美国",
        tracking: "Nasdaq 100",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "同类纳指100产品，可对比费率、规模、流动性。",
      },
      {
        code: "513300",
        name: "纳斯达克",
        manager: "华夏基金",
        market: "美国",
        tracking: "Nasdaq 100 / Nasdaq 指数",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "沪市纳指类产品，适合纳指同组比较。",
      },
      {
        code: "513390",
        name: "纳指基金",
        manager: "博时基金",
        market: "美国",
        tracking: "Nasdaq 100",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "纳指100同组，适合看是否存在异常折溢价。",
      },
    ],
  },
  {
    id: "china-internet",
    title: "中概互联网",
    description: "主要暴露中国互联网和中概科技，和恒生科技有重叠但不完全相同。",
    items: [
      {
        code: "159605",
        name: "中概互联ETF",
        manager: "广发基金",
        market: "中概/港美股",
        tracking: "中概互联网",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "深交所中概互联网相关产品。",
      },
      {
        code: "159607",
        name: "中概互联网ETF",
        manager: "嘉实基金",
        market: "中概/港美股",
        tracking: "中概互联网",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "深交所中概互联网相关产品。",
      },
      {
        code: "513050",
        name: "中概互联",
        manager: "易方达基金",
        market: "中概/港美股",
        tracking: "中证海外中国互联网",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "中概互联网代表产品，注意外盘交易时间和汇率影响。",
      },
      {
        code: "513220",
        name: "全球互联",
        manager: "招商基金",
        market: "全球互联网",
        tracking: "全球互联网",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "全球互联网主题，和纯中概互联网不同。",
      },
      {
        code: "513330",
        name: "恒生互联",
        manager: "华夏基金",
        market: "香港",
        tracking: "恒生互联网",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "港股互联网主题，和中概互联网同组观察。",
      },
      {
        code: "513040",
        name: "HK互联网",
        manager: "易方达基金",
        market: "香港",
        tracking: "中概互联网港股",
        exchange: "上交所",
        sourceType: "港股通ETF",
        note: "偏港股上市互联网公司，额度和交易机制与 QDII 有差异。",
      },
    ],
  },
  {
    id: "hang-seng-tech",
    title: "恒生科技",
    description: "港股科技成长组合，常用于观察港股互联网、硬科技和创新药情绪。",
    items: [
      {
        code: "513260",
        name: "HSTECH",
        manager: "汇添富基金",
        market: "香港",
        tracking: "恒生科技",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "恒生科技同类产品。",
      },
      {
        code: "513010",
        name: "港股科技",
        manager: "易方达基金",
        market: "香港",
        tracking: "恒生科技30",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "恒生科技相关产品之一，注意跟踪指数口径。",
      },
      {
        code: "513130",
        name: "恒生科技",
        manager: "华泰柏瑞基金",
        market: "香港",
        tracking: "恒生科技",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "恒生科技主流产品，可与 513180/513380/513580 比较。",
      },
      {
        code: "513180",
        name: "恒指科技",
        manager: "华夏基金",
        market: "香港",
        tracking: "恒生科技",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "同类恒生科技产品，适合看流动性和折溢价。",
      },
      {
        code: "513380",
        name: "科技恒生",
        manager: "广发基金",
        market: "香港",
        tracking: "恒生科技",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "同类恒生科技产品。",
      },
      {
        code: "513580",
        name: "HS科技",
        manager: "华安基金",
        market: "香港",
        tracking: "恒生科技",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "同类恒生科技产品。",
      },
    ],
  },
  {
    id: "hang-seng-hshare",
    title: "恒生 / H股",
    description: "港股宽基和 H 股金融权重较高，适合观察港股整体估值和股息属性。",
    items: [
      {
        code: "159519",
        name: "港股国企ETF",
        manager: "国泰基金",
        market: "香港",
        tracking: "港股国企 / H股",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "深交所港股国企相关产品。",
      },
      {
        code: "510900",
        name: "H股ETF",
        manager: "易方达基金",
        market: "香港",
        tracking: "恒生中国企业指数",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "H股代表产品，金融和央国企权重较高。",
      },
      {
        code: "513600",
        name: "恒指ETF",
        manager: "南方基金",
        market: "香港",
        tracking: "恒生指数",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "恒生指数场内产品，适合作为港股大盘观察锚。",
      },
      {
        code: "513530",
        name: "港股红利",
        manager: "华泰柏瑞基金",
        market: "香港",
        tracking: "港股通红利",
        exchange: "上交所",
        sourceType: "港股通ETF",
        note: "港股红利策略，不是纯 H 股宽基，但适合同组观察。",
      },
      {
        code: "513550",
        name: "港股通50",
        manager: "华泰柏瑞基金",
        market: "香港",
        tracking: "港股通50",
        exchange: "上交所",
        sourceType: "港股通ETF",
        note: "港股通宽基产品。",
      },
      {
        code: "513140",
        name: "港股金融",
        manager: "华泰柏瑞基金",
        market: "香港",
        tracking: "港股金融",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "偏港股金融板块，和 H 股宽基有较高相关性。",
      },
    ],
  },
  {
    id: "hang-seng-healthcare",
    title: "港股医疗 / 消费",
    description: "偏行业主题，波动通常高于宽基，适合单独观察风险偏好。",
    items: [
      {
        code: "159506",
        name: "恒生医药ETF",
        manager: "富国基金",
        market: "香港",
        tracking: "恒生医药",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "深交所港股医药主题。",
      },
      {
        code: "159615",
        name: "生物科技ETF港股",
        manager: "南方基金",
        market: "香港",
        tracking: "港股生物科技",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "港股生物科技主题。",
      },
      {
        code: "159622",
        name: "创新药ETF沪港深",
        manager: "东财基金",
        market: "沪港深",
        tracking: "创新药",
        exchange: "深交所",
        sourceType: "跨境ETF",
        note: "沪港深创新药主题，和纯 QDII 有口径差异。",
      },
      {
        code: "513060",
        name: "恒生医疗",
        manager: "博时基金",
        market: "香港",
        tracking: "恒生医疗保健",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "港股医疗主题，受创新药、政策和流动性影响大。",
      },
      {
        code: "513200",
        name: "港股医药",
        manager: "易方达基金",
        market: "香港",
        tracking: "港股通医药",
        exchange: "上交所",
        sourceType: "港股通ETF",
        note: "港股医药主题。",
      },
      {
        code: "513280",
        name: "港股生物",
        manager: "汇添富基金",
        market: "香港",
        tracking: "港股生物科技",
        exchange: "上交所",
        sourceType: "港股通ETF",
        note: "港股生物科技主题。",
      },
      {
        code: "513230",
        name: "H股消费",
        manager: "华夏基金",
        market: "香港",
        tracking: "港股消费",
        exchange: "上交所",
        sourceType: "港股通ETF",
        note: "港股消费主题。",
      },
      {
        code: "513590",
        name: "香港消费",
        manager: "鹏华基金",
        market: "香港",
        tracking: "香港消费",
        exchange: "上交所",
        sourceType: "港股通ETF",
        note: "港股消费主题，适合和恒生科技分开看。",
      },
    ],
  },
  {
    id: "us-biotech",
    title: "美股生物科技",
    description: "美股行业主题，受利率、研发管线和并购周期影响较大。",
    items: [
      {
        code: "513290",
        name: "美股生物",
        manager: "汇添富基金",
        market: "美国",
        tracking: "美股生物科技",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "美股生物科技主题，波动通常高于宽基。",
      },
    ],
  },
  {
    id: "korea-semiconductor",
    title: "韩国 / 半导体",
    description: "跨境产业主题，和存储、半导体周期相关性较高。",
    items: [
      {
        code: "513310",
        name: "中韩芯片",
        manager: "华泰柏瑞基金",
        market: "中国/韩国",
        tracking: "中韩半导体",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "中韩半导体主题产品。",
      },
    ],
  },
  {
    id: "education",
    title: "海外教育",
    description: "主题型 QDII，波动和政策敏感度高，适合单独观察。",
    items: [
      {
        code: "513360",
        name: "教育ETF",
        manager: "博时基金",
        market: "海外/中概",
        tracking: "教育主题",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "教育主题产品，流动性和波动需要单独评估。",
      },
    ],
  },
  {
    id: "japan",
    title: "日本",
    description: "跟踪日经225，受日元、日股改革和海外风险偏好影响明显。",
    items: [
      {
        code: "513000",
        name: "225ETF",
        manager: "易方达基金",
        market: "日本",
        tracking: "日经225",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "日经225代表产品之一。",
      },
      {
        code: "513520",
        name: "日经ETF",
        manager: "华夏基金",
        market: "日本",
        tracking: "日经225",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "同类日经225产品，可比较成交额和折溢价。",
      },
    ],
  },
  {
    id: "europe",
    title: "欧洲",
    description: "覆盖德国、法国等欧洲核心市场，受欧元区利率和制造业周期影响。",
    items: [
      {
        code: "513030",
        name: "德国30",
        manager: "华安基金",
        market: "德国",
        tracking: "DAX / 德国30",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "德国核心指数场内产品。",
      },
      {
        code: "513080",
        name: "法国ETF",
        manager: "华安基金",
        market: "法国",
        tracking: "CAC 40",
        exchange: "上交所",
        sourceType: "QDII-ETF",
        note: "法国 CAC40 场内产品，奢侈品和金融权重较高。",
      },
    ],
  },
];

export function createGlobalValuationSnapshot(): GlobalValuationSnapshot {
  const time = shanghaiDateTime();

  return {
    ...time,
    methodology:
      "PE/PB/股息率使用指数公司资料、ETF factsheet 与第三方估算的混合初始口径。页面用于每日快速观察估值区间，不替代指数公司正式数据。",
    rows: rows.map((row) => ({
      ...row,
      valuationBand: band(row.peTtm),
    })),
    qdiiGroups,
  };
}
