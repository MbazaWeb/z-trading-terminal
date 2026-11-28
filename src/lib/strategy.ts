"use client";

// Strategy: "Drop Catcher"
// - Entry: BUY when price drops $1.50 from the reference price (session open or recent high)
// - Take profit: CLOSE when profit reaches $2.00+
// - Stop loss: optional, default 1.5% below entry
// - Goal: small wins, accumulate over time

export const STRATEGY_CONFIG = {
  entryDropThreshold: 1.5, // $ — buy when price drops this much from reference
  takeProfitTarget: 2.0, // $ — close when profit reaches this
  stopLossPercent: 1.5, // % — auto-close if loss exceeds this
  referenceType: "sessionOpen", // "sessionOpen" | "recentHigh"
} as const;

export interface StrategyRiskConfig {
  maxPositionSize: number;
  maxDailyLoss: number;
  currentDailyLoss: number;
  defaultStopLoss: number;
  defaultTakeProfit: number;
  riskPerTrade: number;
}

export interface StrategyAnalysis {
  conditionsMet: boolean;
  entrySignal: string;
  referencePrice: number;
  currentPrice: number;
  dropAmount: number; // reference - current (positive = dropped)
  dropPercent: number;
  riskCheck: {
    passed: boolean;
    positionSize: number;
    stopLoss: number;
    takeProfit: number;
    maxDailyLossRemaining: number;
    reason: string; // why it passed or failed
  };
  potentialProfit: number; // estimated $ if TP hits
  waitingFor: string; // what's needed if conditions not met
}

/**
 * Analyze whether the entry conditions for the Drop Catcher strategy are met.
 *
 * BUY  -> conditionsMet when referencePrice - currentPrice >= entryDropThreshold
 * SELL -> conditionsMet when currentPrice - referencePrice >= entryDropThreshold
 *
 * Risk is checked against the account balance, risk-per-trade, and max daily loss.
 * Take-profit is a fixed dollar amount (takeProfitTarget), not a percentage.
 */
export function analyzeEntry(
  side: "buy" | "sell",
  referencePrice: number,
  currentPrice: number,
  accountBalance: number,
  riskConfig: StrategyRiskConfig,
): StrategyAnalysis {
  const isBuy = side === "buy";

  // Drop magnitude relative to reference (positive = price moved against
  // reference, i.e. the direction we are waiting for).
  const dropAmount = isBuy
    ? referencePrice - currentPrice
    : currentPrice - referencePrice;

  const dropPercent =
    referencePrice > 0 ? (dropAmount / referencePrice) * 100 : 0;

  const conditionsMet = dropAmount >= STRATEGY_CONFIG.entryDropThreshold;

  // Position sizing: percentage of balance risked, capped at maxPositionSize.
  const positionSize = Math.min(
    riskConfig.maxPositionSize,
    Math.max(
      0,
      Math.round((accountBalance * riskConfig.riskPerTrade) / 100 * 100) / 100,
    ),
  );

  // Entry assumed to be the current live price (we act now if conditions met).
  const entryPrice = currentPrice;
  const slPct = STRATEGY_CONFIG.stopLossPercent / 100;
  const stopLoss = isBuy
    ? entryPrice * (1 - slPct)
    : entryPrice * (1 + slPct);

  // Take profit: when profit reaches the fixed $2.00 target. We compute the
  // exit price that would realize that target so callers can display it.
  // For a buy: exitPrice = entryPrice + (target / size). With size derived
  // from amount/entryPrice we just use the target as the dollar amount.
  const takeProfit = STRATEGY_CONFIG.takeProfitTarget;

  // Potential loss if SL hits (in $).
  const potentialLoss = Math.abs(entryPrice - stopLoss) * positionSize;
  const maxDailyLossRemaining = Math.max(
    0,
    riskConfig.maxDailyLoss - riskConfig.currentDailyLoss,
  );

  // Risk check: position size must be > 0 and current daily loss + potential
  // loss must not exceed the daily loss limit.
  let riskPassed = true;
  let riskReason = "Position size within limits; daily loss budget available";
  if (positionSize <= 0) {
    riskPassed = false;
    riskReason = "Position size resolves to 0 — increase balance or risk-per-trade";
  } else if (riskConfig.currentDailyLoss + potentialLoss > riskConfig.maxDailyLoss) {
    riskPassed = false;
    riskReason = `Daily loss limit reached: current $${riskConfig.currentDailyLoss.toFixed(
      2,
    )} + potential $${potentialLoss.toFixed(2)} > $${riskConfig.maxDailyLoss.toFixed(2)}`;
  }

  // Estimated dollar profit if take-profit target hits.
  const potentialProfit = STRATEGY_CONFIG.takeProfitTarget;

  // Entry signal description.
  const entrySignal = conditionsMet
    ? `${isBuy ? "Price dropped" : "Price rose"} $${Math.abs(
        dropAmount,
      ).toFixed(2)} from reference`
    : `Waiting for ${isBuy ? "drop" : "rise"} of $${STRATEGY_CONFIG.entryDropThreshold.toFixed(
        2,
      )} from reference (current: $${Math.abs(dropAmount).toFixed(2)})`;

  // What's still needed before entry is valid.
  const remainingDrop = STRATEGY_CONFIG.entryDropThreshold - dropAmount;
  const waitingFor = conditionsMet
    ? riskPassed
      ? "Ready to trade — conditions and risk both pass"
      : `Conditions met but risk check failed: ${riskReason}`
    : `Waiting for $${STRATEGY_CONFIG.entryDropThreshold.toFixed(2)} ${
        isBuy ? "drop" : "rise"
      } — current move: $${Math.abs(dropAmount).toFixed(2)} (need $${Math.max(
        0,
        remainingDrop,
      ).toFixed(2)} more)`;

  return {
    conditionsMet,
    entrySignal,
    referencePrice,
    currentPrice,
    dropAmount,
    dropPercent,
    riskCheck: {
      passed: riskPassed,
      positionSize,
      stopLoss,
      takeProfit,
      maxDailyLossRemaining,
      reason: riskReason,
    },
    potentialProfit,
    waitingFor,
  };
}

/**
 * Compute live unrealized profit for an open position.
 *
 * BUY  -> (currentPrice - entryPrice) * size
 * SELL -> (entryPrice - currentPrice) * size
 */
export function computePositionProfit(
  side: "buy" | "sell",
  entryPrice: number,
  currentPrice: number,
  size: number,
): number {
  const dir = side === "buy" ? 1 : -1;
  return Math.round((currentPrice - entryPrice) * dir * size * 100) / 100;
}

/**
 * Determine whether an open position should be auto-closed because its profit
 * has reached the strategy take-profit target.
 */
export function shouldTakeProfit(
  side: "buy" | "sell",
  entryPrice: number,
  currentPrice: number,
  size: number,
): { close: boolean; profit: number } {
  const profit = computePositionProfit(side, entryPrice, currentPrice, size);
  return { close: profit >= STRATEGY_CONFIG.takeProfitTarget, profit };
}
