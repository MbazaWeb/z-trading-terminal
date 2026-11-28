import { describe, it, expect } from "vitest";
import { calculatePerformance, agentScore, formatPerformance, type PerformanceTrade } from "../performance";

function makeTrade(
  agentId: string,
  pnl: number,
  result: "win" | "loss",
  datetime: number,
): PerformanceTrade {
  return {
    id: `trade-${datetime}`,
    status: "closed",
    datetime,
    pnl,
    result,
    agentId,
  };
}

describe("calculatePerformance", () => {
  it("returns zero metrics for no trades", () => {
    const perf = calculatePerformance([], "momentum");
    expect(perf.totalTrades).toBe(0);
    expect(perf.winRate).toBe(0);
    expect(perf.totalPnl).toBe(0);
    expect(perf.profitFactor).toBe(0);
  });

  it("calculates win rate correctly", () => {
    const trades = [
      makeTrade("momentum", 10, "win", 1000),
      makeTrade("momentum", 5, "win", 2000),
      makeTrade("momentum", -3, "loss", 3000),
    ];
    const perf = calculatePerformance(trades, "momentum");
    expect(perf.totalTrades).toBe(3);
    expect(perf.wins).toBe(2);
    expect(perf.losses).toBe(1);
    expect(perf.winRate).toBeCloseTo(66.67, 1);
  });

  it("calculates total P&L correctly", () => {
    const trades = [
      makeTrade("momentum", 10, "win", 1000),
      makeTrade("momentum", -5, "loss", 2000),
      makeTrade("momentum", 15, "win", 3000),
    ];
    const perf = calculatePerformance(trades, "momentum");
    expect(perf.totalPnl).toBe(20);
  });

  it("calculates profit factor correctly", () => {
    const trades = [
      makeTrade("momentum", 20, "win", 1000),
      makeTrade("momentum", 10, "win", 2000),
      makeTrade("momentum", -10, "loss", 3000),
    ];
    const perf = calculatePerformance(trades, "momentum");
    // grossProfit = 30, grossLoss = 10, profitFactor = 3.0
    expect(perf.grossProfit).toBe(30);
    expect(perf.grossLoss).toBe(10);
    expect(perf.profitFactor).toBeCloseTo(3.0, 2);
  });

  it("returns Infinity profit factor when no losses", () => {
    const trades = [
      makeTrade("momentum", 10, "win", 1000),
      makeTrade("momentum", 20, "win", 2000),
    ];
    const perf = calculatePerformance(trades, "momentum");
    expect(perf.profitFactor).toBe(Infinity);
  });

  it("calculates max drawdown correctly", () => {
    // Sequence: +10 (peak=10), -15 (cum=-5, DD=15), +5 (cum=0, DD=10), -5 (cum=-5, DD=15)
    const trades = [
      makeTrade("momentum", 10, "win", 1000),
      makeTrade("momentum", -15, "loss", 2000),
      makeTrade("momentum", 5, "win", 3000),
      makeTrade("momentum", -5, "loss", 4000),
    ];
    const perf = calculatePerformance(trades, "momentum");
    expect(perf.maxDrawdown).toBe(15);
  });

  it("calculates Sharpe ratio as finite", () => {
    const trades = [
      makeTrade("momentum", 10, "win", 1000),
      makeTrade("momentum", -5, "loss", 2000),
      makeTrade("momentum", 15, "win", 3000),
    ];
    const perf = calculatePerformance(trades, "momentum");
    expect(Number.isFinite(perf.sharpeRatio)).toBe(true);
  });

  it("filters trades by agentId", () => {
    const trades = [
      makeTrade("momentum", 10, "win", 1000),
      makeTrade("reverter", 20, "win", 2000),
      makeTrade("momentum", -5, "loss", 3000),
    ];
    const perf = calculatePerformance(trades, "momentum");
    expect(perf.totalTrades).toBe(2); // only momentum trades
  });

  it("ignores open trades", () => {
    const openTrade: PerformanceTrade = {
      id: "trade-open",
      status: "open",
      datetime: 1000,
      pnl: 0,
      result: null,
      agentId: "momentum",
    };
    const trades = [
      openTrade,
      makeTrade("momentum", 10, "win", 2000),
    ];
    const perf = calculatePerformance(trades, "momentum");
    expect(perf.totalTrades).toBe(1);
  });
});

describe("agentScore", () => {
  it("returns a number between 0 and 100", () => {
    const perf = calculatePerformance(
      [
        makeTrade("momentum", 10, "win", 1000),
        makeTrade("momentum", -5, "loss", 2000),
      ],
      "momentum",
    );
    const score = agentScore(perf);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("higher win rate gives higher score", () => {
    const goodPerf = calculatePerformance(
      [
        makeTrade("momentum", 10, "win", 1000),
        makeTrade("momentum", 10, "win", 2000),
      ],
      "momentum",
    );
    const badPerf = calculatePerformance(
      [
        makeTrade("momentum", -10, "loss", 1000),
        makeTrade("momentum", -10, "loss", 2000),
      ],
      "momentum",
    );
    expect(agentScore(goodPerf)).toBeGreaterThan(agentScore(badPerf));
  });
});

describe("formatPerformance", () => {
  it("formats win rate as percentage", () => {
    const perf = calculatePerformance(
      [makeTrade("momentum", 10, "win", 1000)],
      "momentum",
    );
    const formatted = formatPerformance(perf);
    expect(formatted.winRate).toBe("100.0%");
  });

  it("formats profit factor", () => {
    const perf = calculatePerformance(
      [makeTrade("momentum", 10, "win", 1000)],
      "momentum",
    );
    const formatted = formatPerformance(perf);
    expect(formatted.profitFactor).toBe("∞");
  });

  it("formats max drawdown as dollar amount", () => {
    const perf = calculatePerformance(
      [
        makeTrade("momentum", 10, "win", 1000),
        makeTrade("momentum", -20, "loss", 2000),
      ],
      "momentum",
    );
    const formatted = formatPerformance(perf);
    expect(formatted.maxDrawdown).toMatch(/\$/);
  });
});
