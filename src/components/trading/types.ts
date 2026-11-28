export type AssetKind = "crypto";

export interface SymbolInfo {
  id: string; // Binance symbol, e.g. "BTCUSDT"
  label: string; // e.g. "BTC/USDT"
  base: string; // e.g. "BTC"
  quote: string; // e.g. "USDT"
  kind: AssetKind;
  name: string; // e.g. "Bitcoin"
}

export type Timeframe = "1m" | "5m" | "15m" | "1H" | "4H" | "1D" | "1W";

export interface Candle {
  time: number; // ms timestamp of candle open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // base asset amount
}

export interface OrderBookRow {
  price: number;
  amount: number;
  total: number;
}

export interface OrderBook {
  asks: OrderBookRow[]; // ascending price; displayed reversed (highest at top)
  bids: OrderBookRow[]; // descending price
  spread: number;
  spreadPercent: number;
  midPrice: number;
}

export interface Trade {
  id: string;
  price: number;
  amount: number;
  time: number; // ms
  side: "buy" | "sell";
}

export interface TickerStats {
  lastPrice: number;
  open24h: number;
  changeAbs: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number; // quote currency (USDT)
  volumeBase24h: number; // base asset
}

export type ChartType = "candles" | "line" | "area";

export interface IndicatorState {
  sma7: boolean;
  sma25: boolean;
  sma99: boolean;
}
