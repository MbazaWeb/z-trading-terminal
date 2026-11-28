import { describe, it, expect } from "vitest";
import { STRATEGY_CONFIG, analyzeEntry, computePositionProfit, shouldTakeProfit } from "../strategy";

describe("STRATEGY_CONFIG", () => {
  it("has the required fields", () => {
    expect(STRATEGY_CONFIG.entryDropThreshold).toBeDefined();
    expect(STRATEGY_CONFIG.takeProfitTarget).toBeDefined();
    expect(STRATEGY_CONFIG.stopLossPercent).toBeDefined();
  });

  it("uses $1.50 entry drop threshold", () => {
    expect(STRATEGY_CONFIG.entryDropThreshold).toBe(1.50);
  });

  it("uses $2.00 take profit target", () => {
    expect(STRATEGY_CONFIG.takeProfitTarget).toBe(2.00);
  });
});

describe("analyzeEntry", () => {
  const baseRiskConfig = {
    maxPositionSize: 500,
    maxDailyLoss: 200,
    currentDailyLoss: 0,
    defaultStopLoss: 1.5,
    defaultTakeProfit: 3.0,
    riskPerTrade: 2.0,
  };

  it("returns conditionsMet=true when price drops >= $1.50 from reference (buy)", () => {
    const result = analyzeEntry("buy", 100, 98.4, 10000, baseRiskConfig);
    // Drop = 100 - 98.4 = 1.6 >= 1.50
    expect(result.conditionsMet).toBe(true);
    expect(result.dropAmount).toBeCloseTo(1.6, 2);
  });

  it("returns conditionsMet=false when drop is less than $1.50", () => {
    const result = analyzeEntry("buy", 100, 99.5, 10000, baseRiskConfig);
    // Drop = 0.5 < 1.50
    expect(result.conditionsMet).toBe(false);
  });

  it("returns conditionsMet=true when price rises >= $1.50 from reference (sell)", () => {
    const result = analyzeEntry("sell", 100, 101.6, 10000, baseRiskConfig);
    expect(result.conditionsMet).toBe(true);
  });

  it("returns conditionsMet=false when price moves in wrong direction", () => {
    const result = analyzeEntry("buy", 100, 101, 10000, baseRiskConfig);
    expect(result.conditionsMet).toBe(false);
  });

  it("risk check fails when daily loss exceeds limit", () => {
    const result = analyzeEntry("buy", 100, 98, 10000, {
      ...baseRiskConfig,
      currentDailyLoss: 250, // exceeds maxDailyLoss of 200
    });
    expect(result.riskCheck.passed).toBe(false);
  });

  it("returns a waitingFor message when conditions not met", () => {
    const result = analyzeEntry("buy", 100, 99.5, 10000, baseRiskConfig);
    expect(result.waitingFor).toBeTruthy();
    expect(typeof result.waitingFor).toBe("string");
  });
});

describe("computePositionProfit", () => {
  it("calculates profit for a buy position", () => {
    // Buy at 100, current 102, size 1.0
    const profit = computePositionProfit("buy", 100, 102, 1.0);
    expect(profit).toBeCloseTo(2.0, 2);
  });

  it("calculates loss for a buy position", () => {
    const profit = computePositionProfit("buy", 100, 98, 1.0);
    expect(profit).toBeCloseTo(-2.0, 2);
  });

  it("calculates profit for a sell position", () => {
    const profit = computePositionProfit("sell", 100, 98, 1.0);
    expect(profit).toBeCloseTo(2.0, 2);
  });

  it("returns 0 when entry equals current", () => {
    const profit = computePositionProfit("buy", 100, 100, 1.0);
    expect(profit).toBe(0);
  });
});

describe("shouldTakeProfit", () => {
  it("returns close=true when profit >= $2.00", () => {
    // Buy at 100, current 102, size 1.0 -> profit = 2.00
    const result = shouldTakeProfit("buy", 100, 102, 1.0);
    expect(result.close).toBe(true);
    expect(result.profit).toBeCloseTo(2.0, 2);
  });

  it("returns close=false when profit < $2.00", () => {
    // Buy at 100, current 101, size 1.0 -> profit = 1.00
    const result = shouldTakeProfit("buy", 100, 101, 1.0);
    expect(result.close).toBe(false);
    expect(result.profit).toBeCloseTo(1.0, 2);
  });

  it("returns close=true for sell position with profit", () => {
    // Sell at 100, current 97, size 1.0 -> profit = 3.00
    const result = shouldTakeProfit("sell", 100, 97, 1.0);
    expect(result.close).toBe(true);
  });

  it("returns close=false for loss", () => {
    // Buy at 100, current 98, size 1.0 -> profit = -2.00
    const result = shouldTakeProfit("buy", 100, 98, 1.0);
    expect(result.close).toBe(false);
  });
});
