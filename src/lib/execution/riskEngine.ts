// Pure pretrade validation. All monetary values must be in account currency.
// Broker margin and loss estimates must be refreshed for the final volume.
export interface RiskInput {
  equity: number; freeMargin: number; dailyRealizedPnl: number;
  dailyLossLimit: number; openRisk: number; openPositions: number;
  maxPositions: number; riskPercent: number;
  side: "buy" | "sell"; bid: number; ask: number;
  stopLoss: number; takeProfit: number; tickSize: number;
  lossTickValue: number; minVolume: number; maxVolume: number; volumeStep: number;
  estimatedCostsPerLot: number; maxSpreadTicks: number;
}
export function sizePosition(p: RiskInput) {
  const reject = (reason: string) => ({ allowed: false as const, reason });
  if (Object.values(p).some(v => typeof v === "number" && !Number.isFinite(v))) return reject("Invalid risk data");
  if (p.equity <= 0 || p.freeMargin <= 0 || p.dailyLossLimit <= 0 ||
      p.openRisk < 0 || p.riskPercent <= 0 || p.riskPercent > 2 ||
      p.tickSize <= 0 || p.lossTickValue <= 0 || p.volumeStep <= 0 ||
      p.minVolume <= 0 || p.maxVolume < p.minVolume || p.estimatedCostsPerLot < 0 ||
      p.bid <= 0 || p.ask < p.bid || p.maxSpreadTicks <= 0 ||
      !Number.isInteger(p.openPositions) || p.openPositions < 0 ||
      !Number.isInteger(p.maxPositions) || p.maxPositions < 1 ||
      p.openPositions >= p.maxPositions) return reject("Risk limits or broker specifications invalid");
  if ((p.ask-p.bid)/p.tickSize > p.maxSpreadTicks) return reject("Spread too wide");
  const entry = p.side === "buy" ? p.ask : p.bid;
  const stopDistance = p.side === "buy" ? entry-p.stopLoss : p.stopLoss-entry;
  const rewardDistance = p.side === "buy" ? p.takeProfit-entry : entry-p.takeProfit;
  if (p.stopLoss <= 0 || p.takeProfit <= 0 || stopDistance < p.tickSize ||
      rewardDistance < 1.5*stopDistance) return reject("Invalid protective levels");
  const remaining = p.dailyLossLimit + Math.min(0,p.dailyRealizedPnl) - p.openRisk;
  const budget = Math.min(p.equity*p.riskPercent/100, p.equity*0.02-p.openRisk, remaining);
  const lossPerLot = Math.ceil(stopDistance/p.tickSize)*p.lossTickValue+p.estimatedCostsPerLot;
  if (!Number.isFinite(lossPerLot) || lossPerLot <= 0 || budget <= 0) return reject("Risk budget exhausted");
  const cap = Math.min(p.maxVolume,budget/lossPerLot);
  if (cap < p.minVolume) return reject("Minimum broker lot exceeds risk budget");
  const volume = Number((p.minVolume+Math.floor((cap-p.minVolume)/p.volumeStep)*p.volumeStep).toFixed(8));
  if (volume < p.minVolume || volume > p.maxVolume || volume*lossPerLot > budget) return reject("Volume exceeds risk budget");
  return { allowed: true as const, volume, entry, estimatedLoss: volume*lossPerLot, riskBudget: budget, requiresBrokerCheck: true as const };
}
export function validateBrokerEstimate(input: { margin: number; loss: number; freeMargin: number; riskBudget: number; costs: number }) {
  const {margin,loss,freeMargin,riskBudget,costs}=input;
  return Object.values(input).every(Number.isFinite) && margin>0 && loss>0 && costs>=0 &&
    freeMargin>0 && riskBudget>0 && margin<=freeMargin*0.8 && loss+costs<=riskBudget;
}
