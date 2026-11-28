import { describe, it, expect } from "vitest";
import { sma, smaSeries, rsi, ema, bollingerBands, atr, volumeSpike } from "../indicators";
import type { Candle } from "@/components/trading/types";

function makeCandle(close: number, high?: number, low?: number, volume = 100): Candle {
  return {
    time: Date.now(),
    open: close,
    high: high ?? close,
    low: low ?? close,
    close,
    volume,
  };
}

describe("sma", () => {
  it("calculates the average of the last N values", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4); // (3+4+5)/3
  });

  it("returns NaN when not enough data", () => {
    expect(Number.isNaN(sma([1, 2], 5))).toBe(true);
  });

  it("returns NaN for period 0", () => {
    expect(Number.isNaN(sma([1, 2, 3], 0))).toBe(true);
  });

  it("handles single period", () => {
    expect(sma([10, 20, 30], 1)).toBe(30);
  });
});

describe("smaSeries", () => {
  it("produces nulls during warmup then values", () => {
    const result = smaSeries([1, 2, 3, 4], 2);
    expect(result).toHaveLength(4);
    expect(result[0]).toBeNull();
    expect(result[1]).toBe(1.5); // (1+2)/2
    expect(result[2]).toBe(2.5); // (2+3)/2
    expect(result[3]).toBe(3.5); // (3+4)/2
  });
});

describe("rsi", () => {
  it("returns 50 (neutral) when not enough candles", () => {
    const candles = [makeCandle(100), makeCandle(101)];
    expect(rsi(candles, 14)).toBe(50);
  });

  it("returns a value between 0 and 100", () => {
    const candles: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 30; i++) {
      price += Math.random() * 2 - 1;
      candles.push(makeCandle(price));
    }
    const result = rsi(candles, 14);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it("returns high RSI on pure uptrend", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(makeCandle(100 + i));
    }
    const result = rsi(candles, 14);
    expect(result).toBeGreaterThan(70);
  });

  it("returns low RSI on pure downtrend", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(makeCandle(100 - i));
    }
    const result = rsi(candles, 14);
    expect(result).toBeLessThan(30);
  });
});

describe("ema", () => {
  it("returns a finite number", () => {
    const result = ema([1, 2, 3, 4, 5], 3);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("returns NaN for empty input", () => {
    expect(Number.isNaN(ema([], 3))).toBe(true);
  });
});

describe("bollingerBands", () => {
  it("returns upper >= middle >= lower", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push(makeCandle(100 + Math.random() * 10));
    }
    const bb = bollingerBands(candles, 20);
    expect(bb.upper).toBeGreaterThanOrEqual(bb.middle);
    expect(bb.middle).toBeGreaterThanOrEqual(bb.lower);
  });
});

describe("atr", () => {
  it("returns a positive number when there is price movement", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(makeCandle(100 + i, 102 + i, 98 + i));
    }
    const result = atr(candles, 14);
    expect(result).toBeGreaterThan(0);
  });
});

describe("volumeSpike", () => {
  it("detects when current volume exceeds average", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push(makeCandle(100, 101, 99, 100));
    }
    // Last candle has 5x normal volume
    candles[candles.length - 1] = makeCandle(100, 101, 99, 500);
    expect(volumeSpike(candles, 20)).toBe(true);
  });

  it("returns false when volume is normal", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push(makeCandle(100, 101, 99, 100));
    }
    expect(volumeSpike(candles, 20)).toBe(false);
  });
});
