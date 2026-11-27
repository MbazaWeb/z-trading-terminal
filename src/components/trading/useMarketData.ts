"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Candle,
  OrderBook,
  SymbolInfo,
  TickerStats,
  Timeframe,
  Trade,
} from "./types";

export const SYMBOLS: SymbolInfo[] = [];
export const TIMEFRAMES: Timeframe[] = ["1m","5m","15m","1H","4H","1D","1W"];
export const TIMEFRAME_LABEL = Object.fromEntries(TIMEFRAMES.map(t => [t,t])) as Record<Timeframe,string>;
// ---- Price formatting helpers ----------------------------------------------

export function priceDecimals(price: number): number {
  if (price >= 1) return 2;
  if (price >= 0.01) return 4;
  return 6;
}

export function formatPrice(price: number, decimals?: number): string {
  const d = decimals ?? priceDecimals(price);
  return price.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function formatCompact(value: number): string {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatAmount(amount: number): string {
  if (amount >= 1000) return amount.toFixed(2);
  if (amount >= 1) return amount.toFixed(3);
  if (amount >= 0.01) return amount.toFixed(4);
  return amount.toFixed(6);
}


export interface MarketState {
  symbols: SymbolInfo[];
  activeSymbol: SymbolInfo;
  timeframe: Timeframe;
  candles: Candle[];
  stats: TickerStats;
  orderBook: OrderBook;
  trades: Trade[];
  lastPriceDirection: "up" | "down" | "flat";
  livePrice: number;
  status: "loading" | "ready" | "stale" | "unavailable";
  quote: {bid:number; ask:number; time:number} | null;
  setTimeframe: (tf: Timeframe) => void;
  selectSymbol: (id:string) => void;
}
type Feed = {source:string; symbol:string; timeframe:Timeframe; symbols:{id:string;name:string;base:string;quote:string;digits:number}[]; quote:{bid:number;ask:number;time:number}; candles:(Omit<Candle,"volume">&{tickVolume:number})[]};
const emptySymbol: SymbolInfo = {id:"",label:"Unavailable",base:"",quote:"",kind:"stock",name:"Unavailable",basePrice:0};
export function useMarketData(_initialSymbolId = "", enabled = true): MarketState {
  const [symbol,setSymbol] = useState("");
  const [timeframe,setTimeframe] = useState<Timeframe>("15m");
  const [snapshot,setSnapshot] = useState<{key:string;feed:Feed|null;failed:boolean}|null>(null);
  const key = symbol + "|" + timeframe;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const res = await fetch("/api/market/mt5?" + new URLSearchParams({symbol,timeframe}), {cache:"no-store",signal:controller.signal});
        if (!res.ok) throw Error("Feed unavailable");
        const feed:Feed = await res.json();
        if (feed.source !== "MT5" || feed.timeframe !== timeframe || (symbol && feed.symbol !== symbol) || !Number.isFinite(feed.quote?.bid) || !Number.isFinite(feed.quote?.ask) || !Number.isFinite(feed.quote?.time) || feed.quote.bid <= 0 || feed.quote.ask < feed.quote.bid || !Array.isArray(feed.candles) || !feed.candles.length || !Array.isArray(feed.symbols) || !feed.symbols.some(s=>s.id===feed.symbol)) throw Error("Invalid feed");
        if (!stopped) setSnapshot({key,feed,failed:false});
      } catch {
        if (!stopped) setSnapshot(prev=>({key,feed:prev?.key===key?prev.feed:null,failed:true}));
      } finally {
        if (!stopped) timer=setTimeout(poll,5000);
      }
    }
    void poll();
    return ()=>{stopped=true;controller.abort();clearTimeout(timer);};
  },[enabled,key,symbol,timeframe]);
  const feed=enabled && snapshot?.key===key?snapshot.feed:null;
  const symbols:SymbolInfo[]=(feed?.symbols??[]).map(s=>({id:s.id,label:s.id,name:s.name,base:s.base,quote:s.quote,kind:"stock",basePrice:s.id===feed?.symbol?feed.quote.bid:0}));
  const activeSymbol=symbols.find(s=>s.id===feed?.symbol)??emptySymbol;
  const quote=feed?.quote??null;
  const livePrice=quote?.bid??0;
  const candles:Candle[]=(feed?.candles??[]).map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.tickVolume}));
  const status=!enabled?"unavailable":!feed?(snapshot?.key===key&&snapshot.failed?"unavailable":"loading"):snapshot?.failed||Date.now()-feed.quote.time>60000?"stale":"ready";
  const stats:TickerStats={lastPrice:livePrice,open24h:NaN,changeAbs:NaN,changePercent:NaN,high24h:NaN,low24h:NaN,volume24h:NaN,volumeBase24h:NaN};
  const orderBook:OrderBook={asks:[],bids:[],spread:quote?quote.ask-quote.bid:NaN,spreadPercent:quote?(quote.ask-quote.bid)/quote.bid*100:NaN,midPrice:quote?(quote.ask+quote.bid)/2:NaN};
  const selectSymbol=useCallback((id:string)=>setSymbol(id),[]);
  return {symbols,activeSymbol,timeframe,candles,stats,orderBook,trades:[],lastPriceDirection:"flat",livePrice,status,quote,setTimeframe,selectSymbol};
}
// ---- Moving average helper (used by the chart) -----------------------------

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}
