export type NativeCandle = { time: number; open: number; high: number; low: number; close: number; volume?: number };
export type NativeMarket = {
  provider: "mt5" | "deriv";
  symbol: string;
  observedAt: number;
  candles: readonly NativeCandle[];
  volumeType: "tick_count" | "traded_volume" | "unavailable";
  quote: { kind: "bid_ask"; bid: number; ask: number } | { kind: "indicative"; price: number };
};
export function validateNativeMarket(m: NativeMarket, now = Date.now()) {
  if (!Number.isFinite(m.observedAt) || m.observedAt > now || now-m.observedAt>60000 || m.candles.length<50) throw new Error("Insufficient fresh market evidence");
  const positive = (v:number) => Number.isFinite(v)&&v>0;
  if (m.quote.kind==="bid_ask" ? !positive(m.quote.bid)||!positive(m.quote.ask)||m.quote.ask<m.quote.bid : !positive(m.quote.price)) throw new Error("Invalid quote");
  for (const [i,c] of m.candles.entries()) {
    if (![c.open,c.high,c.low,c.close].every(positive)||!Number.isSafeInteger(c.time)||c.time+60000>now||
      c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)||
      (i>0&&c.time<=m.candles[i-1].time)||
      (m.volumeType!=="unavailable"&&(c.volume===undefined||!Number.isFinite(c.volume)||c.volume<0))) throw new Error("Invalid native candle");
  }
  if(now-m.candles[m.candles.length-1].time-60000>120000) throw new Error("Stale candles");
  return m;
}
// Explicit capabilities; unsupported evidence is not replaced with zeros.
export type NativeCapability = "price" | "traded_volume" | "sentiment" | "cross_market" | "news" | "broker_specs" | "account_risk" | "session_calendar";
export const NATIVE_AGENT_REQUIREMENTS: Record<string, readonly NativeCapability[]> = {
 momentum:["price"], reverter:["price"], sentiment:["sentiment"], breakout:["price"],
 arbitrage:["cross_market"], signal:["price"], strategy:["price"], chart:["price"],
 multiIndicator:["price"], time:["session_calendar"], media:["news"],
 risk:["account_risk"], stopLoss:["broker_specs"], stopWin:["broker_specs"],
 pip:["broker_specs"], alert:["price"]
};
export function missingCapabilities(agentId:string, available:ReadonlySet<NativeCapability>) {
 const required=NATIVE_AGENT_REQUIREMENTS[agentId];
 if(!required) throw new Error("Unknown native agent");
 return required.filter(c=>!available.has(c));
}
