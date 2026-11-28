import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { SessionData } from "@/lib/auth/session";
import { getBrokerSnapshot } from "./brokerRouter";
import { getAIControls } from "./controlStore";
import { nativeRiskPlan } from "@/lib/execution/nativeRiskPlan";
import { checkBridgeOrder, getBridgeAccountRisk } from "@/lib/mt5BridgeServer";
import { validateBrokerEstimate } from "@/lib/execution/riskEngine";
import { nativeConsensus } from "@/lib/agents/nativeConsensus";

// Native strategies use closed prices without fabricated volume statistics.
export async function analyzeBrokerMarket(db: PrismaClient, session: SessionData, symbol: string) {
  const controls = await getAIControls(db, session.userId);
  if (!controls.running || controls.emergencyStop) {
    return { action: "HOLD" as const, reason: "AI stopped", executable: false as const };
  }
  const { market } = await getBrokerSnapshot(session, symbol);
  const current = await getAIControls(db, session.userId);
  if (!current.running || current.emergencyStop || current.revision !== controls.revision) {
    return { action: "HOLD" as const, reason: "AI controls changed", executable: false as const };
  }
  const native = {provider:"mt5" as const,symbol:market.symbol,observedAt:market.observedAt,
    candles:market.candles,volumeType:market.volumeType,quote:{kind:"bid_ask" as const,bid:market.bid,ask:market.ask}};
  const consensus = nativeConsensus(native,current.enabledAgentIds);
  if(consensus.action==="HOLD") return {action:"HOLD" as const,reason:consensus.reason,consensus,executable:false as const};
  const side=consensus.action==="BUY"?"buy":"sell";
  const plan=await nativeRiskPlan(native,side);
  if(!plan.allowed)return {action:"HOLD" as const,reason:plan.reason,consensus,executable:false as const};
  const checked=await checkBridgeOrder({symbol,side,volume:plan.volume,stopLoss:plan.stopLoss,takeProfit:plan.takeProfit});
  const risk=await getBridgeAccountRisk();
  const costs=Number(process.env.AI_ESTIMATED_COSTS_PER_LOT)*plan.volume;
  if(checked.currency!==risk.currency||checked.entry!==plan.entry||!validateBrokerEstimate({margin:checked.margin,loss:checked.estimatedStopLoss,freeMargin:risk.freeMargin,riskBudget:Math.min(plan.riskBudget,risk.equity*0.02-risk.openRisk,Number(process.env.AI_DAILY_LOSS_LIMIT_ACCOUNT_CURRENCY)+Math.min(0,risk.dailyRealizedPnl)-risk.openRisk),costs})) return {action:"HOLD" as const,reason:"Broker risk changed",executable:false as const};
  const latest=await getAIControls(db,session.userId);
  if(!latest.running||latest.emergencyStop||latest.revision!==current.revision)return {action:"HOLD" as const,reason:"AI controls changed",executable:false as const};
  // Native bridge is demo-only. Never spend API credits.
  return { action: "HOLD" as const, advisoryAction: consensus.action,
    reason: "Local quantitative consensus; demo execution release pending",
    analysisSource: "local" as const, consensus, plan, checked, executable: false as const };
}
