import { describe,it,expect } from "vitest";
import { nativeStrategies } from "./nativeStrategies";
import type { NativeMarket } from "./nativeMarket";
const now=1800000000000;
function fixture(): NativeMarket {
 return {provider:"mt5",symbol:"XAUUSD",observedAt:now,volumeType:"unavailable",
 quote:{kind:"bid_ask",bid:100,ask:100.1},
 candles:Array.from({length:60},(_,i)=>({time:now-(60-i)*60000,open:100,high:101,low:99,close:100}))};
}
describe("native strategies",()=>{
 it("abstains on flat closes",()=>expect(nativeStrategies(fixture(),now).every(x=>x.action==="HOLD")).toBe(true));
 it("rejects stale quotes",()=>expect(()=>nativeStrategies({...fixture(),observedAt:now-61000},now)).toThrow());
 it("detects a closed candle breakout",()=>{
 const m=fixture(); m.candles=[...m.candles.slice(0,-1),{...m.candles[59],close:103,high:104}];
 expect(nativeStrategies(m,now).find(x=>x.strategy==="breakout-native-v1")?.action).toBe("BUY");
 });
});
