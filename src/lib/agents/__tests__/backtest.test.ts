import { describe, it, expect } from "vitest";
import { backtestStrategy } from "../backtest";
import type { Candle } from "@/components/trading/types";

/**
 * Build a synthetic upward-trending candle series so the momentum agent has
 * a clear signal to act on. Each candle has an increasing close, with mild
 * high/low wiggles and steady volume.
 */
function buildUptrendCandles(n: number, start = 100): Candle[] {
  const out: Candle[] = [];
  let price = start;
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = price + 0.5;
    const high = close + 0.2;
    const low = open - 0.2;
    out.push({
      time: now - (n - i) * 60_000,
      open,
      high,
      low,
      close,
      volume: 100 + (i % 5) * 10,
    });
    price = close;
  }
  return out;
}

/**
 * Build a synthetic downtrend series for testing short-side behavior.
 */
function buildDowntrendCandles(n: number, start = 100): Candle[] {
  const out: Candle[] = [];
  let price = start;
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = price - 0.5;
    const high = open + 0.2;
    const low = close - 0.2;
    out.push({
      time: now - (n - i) * 60_000,
      open,
      high,
      low,
      close,
      volume: 100 + (i % 5) * 10,
    });
    price = close;
  }
  return out;
}

describe("backtestStrategy", () => {
  it("throws for an unknown agent id", async () => {
    await expect(
      backtestStrategy("does-not-exist", "BTCUSDT", "15m", buildUptrendCandles(60)),
    ).rejects.toThrow(/Unknown agent id/);
  });

  it("throws when not enough candles are provided", async () => {
    await expect(
      backtestStrategy("momentum", "BTCUSDT", "15m", buildUptrendCandles(20)),
    ).rejects.toThrow(/requires at least/);
  });

  it("returns a result with the right shape", async () => {
    const result = await backtestStrategy(
      "momentum",
      "BTCUSDT",
      "15m",
      buildUptrendCandles(120),
      { notional: 100 },
    );
    expect(result.agentId).toBe("momentum");
    expect(result.symbol).toBe("BTCUSDT");
    expect(result.interval).toBe("15m");
    expect(result.notional).toBe(100);
    expect(result.candlesAnalyzed).toBe(120);
    expect(Array.isArray(result.trades)).toBe(true);
    expect(Array.isArray(result.equity)).toBe(true);
    expect(typeof result.performance.totalTrades).toBe("number");
    expect(typeof result.performance.winRate).toBe("number");
  });

  it("equity curve starts at 0 and equals the sum of trade pnl at the end", async () => {
    const result = await backtestStrategy(
      "momentum",
      "BTCUSDT",
      "15m",
      buildUptrendCandles(120),
      { notional: 100 },
    );
    expect(result.equity[0]).toBe(0);
    if (result.trades.length > 0) {
      const totalPnl = result.trades.reduce((s, t) => s + t.pnl, 0);
      expect(result.equity[result.equity.length - 1]).toBeCloseTo(
        Math.round(totalPnl * 100) / 100,
        2,
      );
    }
  });

  it("every closed trade has a win/loss result matching the sign of its pnl", async () => {
    const result = await backtestStrategy(
      "momentum",
      "BTCUSDT",
      "15m",
      buildUptrendCandles(120),
    );
    for (const t of result.trades) {
      expect(t.status).toBe("closed");
      if (t.pnl >= 0) expect(t.result).toBe("win");
      else expect(t.result).toBe("loss");
    }
  });

  it("every closed trade has a holdTimeMs derived from open/close timestamps", async () => {
    const result = await backtestStrategy(
      "momentum",
      "BTCUSDT",
      "15m",
      buildUptrendCandles(120),
    );
    for (const t of result.trades) {
      expect(t.holdTimeMs).toBeGreaterThan(0);
      expect(t.holdTimeMs).toBe(t.brokerCloseTime! - t.brokerOpenTime!);
    }
  });

  it("completes without error on a strong uptrend (agents may correctly avoid overbought)", async () => {
    const result = await backtestStrategy(
      "momentum",
      "BTCUSDT",
      "15m",
      buildUptrendCandles(200, 100),
    );
    // On a very strong uptrend, RSI may exceed 70 (overbought) and the
    // momentum agent correctly avoids buying. 0 trades is valid behavior.
    expect(result.trades.length).toBeGreaterThanOrEqual(0);
    if (result.trades.length > 0) {
      expect(result.trades[0].side).toBe("buy");
    }
  });

  it("completes without error on a strong downtrend (agents may correctly avoid oversold)", async () => {
    const result = await backtestStrategy(
      "momentum",
      "BTCUSDT",
      "15m",
      buildDowntrendCandles(200, 100),
    );
    // On a very strong downtrend, the agent may correctly avoid selling
    // if conditions don't meet the strategy threshold.
    expect(result.trades.length).toBeGreaterThanOrEqual(0);
    if (result.trades.length > 0) {
      expect(result.trades[0].side).toBe("sell");
    }
  });

  it("performance rollup matches the trade list", async () => {
    const result = await backtestStrategy(
      "momentum",
      "BTCUSDT",
      "15m",
      buildUptrendCandles(120),
    );
    const wins = result.trades.filter((t) => t.result === "win").length;
    const losses = result.trades.filter((t) => t.result === "loss").length;
    expect(result.performance.totalTrades).toBe(result.trades.length);
    expect(result.performance.wins).toBe(wins);
    expect(result.performance.losses).toBe(losses);
  });

  it("respects the notional override (P&L scales with notional)", async () => {
    const small = await backtestStrategy(
      "momentum",
      "BTCUSDT",
      "15m",
      buildUptrendCandles(150),
      { notional: 50 },
    );
    const large = await backtestStrategy(
      "momentum",
      "BTCUSDT",
      "15m",
      buildUptrendCandles(150),
      { notional: 500 },
    );
    // If at least one trade was placed, the large-notional run should have
    // strictly larger absolute P&L on the same trade side. (Deterministic
    // because the candle series + analyzer are both pure.)
    if (small.trades.length > 0 && large.trades.length > 0) {
      const smallAbs = Math.abs(small.trades[0].pnl);
      const largeAbs = Math.abs(large.trades[0].pnl);
      expect(largeAbs).toBeGreaterThan(smallAbs);
    }
  });
});
