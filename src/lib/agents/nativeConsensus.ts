import { nativeStrategies } from "./nativeStrategies";
import type { NativeMarket } from "./nativeMarket";
const mapping: Record<string,string> = {
 "momentum-native-v1":"momentum", "reversion-native-v1":"reverter",
 "breakout-native-v1":"breakout", "double-bollinger-native-v1":"strategy"
};
export function nativeConsensus(market: NativeMarket, enabledIds: readonly string[], now=Date.now()) {
 const candidates=nativeStrategies(market,now).filter(c=>enabledIds.includes(mapping[c.strategy]));
 const buys=candidates.filter(c=>c.action==="BUY").length;
 const sells=candidates.filter(c=>c.action==="SELL").length;
 const action=candidates.length>=3 && buys>=2 && sells===0 && buys/candidates.length>=0.66?"BUY":
 candidates.length>=3 && sells>=2 && buys===0 && sells/candidates.length>=0.66?"SELL":"HOLD";
 return {action,candidates,executable:false as const,reason:action==="HOLD"?"Insufficient agreement":"Preliminary strategy agreement; independent risk validation required"};
}
