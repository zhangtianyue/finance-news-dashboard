export type InstrumentOption = {
  symbol: string;
  name: string;
  exchange: string;
  type: "股票" | "ETF" | "指数" | "基金";
};

export const popularInstruments: InstrumentOption[] = [
  { symbol: "SPY", name: "SPDR 标普500 ETF", exchange: "NYSE Arca", type: "ETF" },
  { symbol: "QQQ", name: "Invesco 纳斯达克100 ETF", exchange: "Nasdaq", type: "ETF" },
  { symbol: "VOO", name: "Vanguard 标普500 ETF", exchange: "NYSE Arca", type: "ETF" },
  { symbol: "VT", name: "Vanguard 全球股票 ETF", exchange: "NYSE Arca", type: "ETF" },
  { symbol: "AAPL", name: "苹果公司", exchange: "Nasdaq", type: "股票" },
  { symbol: "MSFT", name: "微软", exchange: "Nasdaq", type: "股票" },
  { symbol: "NVDA", name: "英伟达", exchange: "Nasdaq", type: "股票" },
  { symbol: "AMZN", name: "亚马逊", exchange: "Nasdaq", type: "股票" },
  { symbol: "GOOGL", name: "Alphabet", exchange: "Nasdaq", type: "股票" },
  { symbol: "META", name: "Meta Platforms", exchange: "Nasdaq", type: "股票" },
  { symbol: "TSLA", name: "特斯拉", exchange: "Nasdaq", type: "股票" },
  { symbol: "BRK-B", name: "伯克希尔哈撒韦 B", exchange: "NYSE", type: "股票" },
  { symbol: "JPM", name: "摩根大通", exchange: "NYSE", type: "股票" },
  { symbol: "BABA", name: "阿里巴巴", exchange: "NYSE", type: "股票" },
  { symbol: "PDD", name: "拼多多", exchange: "Nasdaq", type: "股票" },
  { symbol: "0700.HK", name: "腾讯控股", exchange: "香港", type: "股票" },
  { symbol: "9988.HK", name: "阿里巴巴-W", exchange: "香港", type: "股票" },
  { symbol: "600519.SS", name: "贵州茅台", exchange: "上海", type: "股票" },
  { symbol: "000001.SZ", name: "平安银行", exchange: "深圳", type: "股票" },
  { symbol: "510300.SS", name: "沪深300 ETF", exchange: "上海", type: "ETF" },
];

export function searchPopularInstruments(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return popularInstruments;

  return popularInstruments.filter((item) =>
    [item.symbol, item.name, item.exchange, item.type].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}
