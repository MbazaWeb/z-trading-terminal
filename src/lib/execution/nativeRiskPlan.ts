import "server-only";
import { getBridgeAccountRisk,getBridgeRiskSpecs } from "@/lib/mt5BridgeServer";
import { planNativePosition } from "./protectiveLevels";
import type { NativeMarket } from "@/lib/agents/nativeMarket";

export async function nativeRiskPlan(market:NativeMarket,side:"buy"|"sell") {
 const [account,spec]=await Promise.all([getBridgeAccountRisk(),getBridgeRiskSpecs(market.symbol)]);
 if(account.currency!==spec.currency||account.login!==spec.login||account.server!==spec.server)
 throw new Error("Broker risk identity mismatch");
 const read=(name:string)=>{const raw=process.env[name];if(!raw?.trim())throw new Error("Missing "+name);
 const n=Number(raw);if(!Number.isFinite(n)||n<=0)throw new Error("Invalid "+name);return n;};
 const now=Date.now();
 if(now-account.observedAt>10000||now-spec.observedAt>10000)throw new Error("Expired risk evidence");
 return planNativePosition(market,side,{
 equity:account.equity,freeMargin:account.freeMargin,dailyRealizedPnl:account.dailyRealizedPnl,
 openRisk:account.openRisk,openPositions:account.openPositions,
 dailyLossLimit:read("AI_DAILY_LOSS_LIMIT_ACCOUNT_CURRENCY"),
 maxPositions:read("AI_MAX_OPEN_POSITIONS"),riskPercent:read("AI_RISK_PERCENT"),
 estimatedCostsPerLot:read("AI_ESTIMATED_COSTS_PER_LOT"),maxSpreadTicks:read("AI_MAX_SPREAD_TICKS"),
 tickSize:spec.tickSize,lossTickValue:spec.lossTickValue,minVolume:spec.minVolume,maxVolume:spec.maxVolume,volumeStep:spec.volumeStep
 },spec.minStopDistance,now);
}
