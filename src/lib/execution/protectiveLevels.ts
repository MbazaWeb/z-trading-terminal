import { validateNativeMarket, type NativeMarket } from "@/lib/agents/nativeMarket";
import { sizePosition, type RiskInput } from "./riskEngine";

export function planNativePosition(market: NativeMarket, side: "buy" | "sell",
  risk: Omit<RiskInput,"side"|"bid"|"ask"|"stopLoss"|"takeProfit">,
  minStopDistance: number, now = Date.now()) {
  validateNativeMarket(market,now);
  if (market.provider !== "mt5" || market.quote.kind !== "bid_ask") throw new Error("MT5 executable quote required");
  if (now-market.observedAt>10000 || !Number.isFinite(minStopDistance) || minStopDistance<0 ||
      !Number.isFinite(risk.tickSize) || risk.tickSize<=0) throw new Error("Invalid risk evidence");
  const {bid,ask}=market.quote;
  const bars=market.candles.slice(-15);
  const atr=bars.slice(1).reduce((sum,c,i)=>sum+Math.max(c.high-c.low,Math.abs(c.high-bars[i].close),Math.abs(c.low-bars[i].close)),0)/14;
  if (!Number.isFinite(atr)||atr<=0) throw new Error("Invalid volatility");
  const tick=risk.tickSize;
  const distance=Math.max(1.5*atr,minStopDistance+ask-bid+tick,2*tick);
  const entry=side==="buy"?ask:bid;
  const down=(p:number)=>Math.floor(p/tick)*tick;
  const up=(p:number)=>Math.ceil(p/tick)*tick;
  const stopLoss=side==="buy"?down(entry-distance):up(entry+distance);
  const actualDistance=Math.abs(entry-stopLoss);
  const takeProfit=side==="buy"?up(entry+2*actualDistance):down(entry-2*actualDistance);
  const result=sizePosition({...risk,side,bid,ask,stopLoss,takeProfit});
  return {...result,stopLoss,takeProfit,atr,executable:false as const};
}
