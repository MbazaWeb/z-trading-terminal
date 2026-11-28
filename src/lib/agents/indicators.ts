// Technical indicators used by the trading agents.
//
// All functions are pure and operate on the canonical `Candle[]` shape returned
// by the Binance client. They are intentionally simple (no external deps) so
// the math is auditable.

import type { Candle } from "@/components/trading/types";

/**
 * Simple Moving Average over the last `period` values. Returns `NaN` when
 * there is not enough data.
 */
export function sma(values: number[], period: number): number {
  if (values.length < period || period <= 0) return NaN;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i];
  }
  return sum / period;
}

/**
 * Full SMA series (one value per input element, or `null` while warming up).
 * Used by the chart's overlay lines.
 */
export function smaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

/**
 * Relative Strength Index (Wilder's smoothing) over the last `period` candles.
 * Returns a value in [0, 100]. Returns 50 (neutral) when not enough data.
 */
export function rsi(candles: Candle[], period = 14): number {
  if (candles.length <= period) return 50;
  const closes = candles.slice(-(period + 1)).map((c) => c.close);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * MACD (12, 26, 9). Returns `{ macd, signal, histogram }`. Returns zeros when
 * not enough data is available.
 */
export function macd(candles: Candle[]): {
  macd: number;
  signal: number;
  histogram: number;
} {
  const closes = candles.map((c) => c.close);
  if (closes.length < 35) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12 - ema26;
  // Signal line = EMA(9) of the MACD line. We approximate by computing an EMA
  // over the last 9 MACD values derived from the rolling EMAs above. To keep
  // this O(n) and simple, we compute the MACD series for the tail and EMA it.
  const macdSeries: number[] = [];
  for (let i = closes.length - 9; i < closes.length; i++) {
    if (i < 26) continue;
    const e12 = ema(closes.slice(0, i + 1), 12);
    const e26 = ema(closes.slice(0, i + 1), 26);
    macdSeries.push(e12 - e26);
  }
  const signal =
    macdSeries.length > 0 ? ema(macdSeries, Math.min(9, macdSeries.length)) : macdLine;
  return {
    macd: macdLine,
    signal,
    histogram: macdLine - signal,
  };
}

/**
 * Exponential Moving Average. `period` is the standard N-period EMA.
 */
export function ema(values: number[], period: number): number {
  if (values.length === 0 || period <= 0) return NaN;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/**
 * Bollinger Bands (SMA period + 2 standard deviations).
 */
export function bollingerBands(
  candles: Candle[],
  period = 20,
): { upper: number; middle: number; lower: number } {
  if (candles.length < period) {
    const last = candles.length > 0 ? candles[candles.length - 1].close : 0;
    return { upper: last, middle: last, lower: last };
  }
  const closes = candles.slice(-period).map((c) => c.close);
  const mean = closes.reduce((a, b) => a + b, 0) / period;
  const variance =
    closes.reduce((a, b) => a + (b - mean) * (b - mean), 0) / period;
  const sd = Math.sqrt(variance);
  return {
    upper: mean + 2 * sd,
    middle: mean,
    lower: mean - 2 * sd,
  };
}

/**
 * Average True Range (Wilder). Measures volatility in price units.
 */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / Math.max(slice.length, 1);
}

/**
 * True if the most recent candle's volume is at least 1.5x the rolling average.
 */
export function volumeSpike(candles: Candle[], lookback = 20): boolean {
  if (candles.length < 2) return false;
  const recent = candles.slice(-(lookback + 1), -1);
  if (recent.length === 0) return false;
  const avg =
    recent.reduce((a, b) => a + b.volume, 0) / recent.length;
  if (avg <= 0) return false;
  const last = candles[candles.length - 1].volume;
  return last >= avg * 1.5;
}

/**
 * Rolling high / low over the last `period` candles.
 */
export function rollingHighLow(
  candles: Candle[],
  period: number,
): { high: number; low: number } {
  if (candles.length === 0) return { high: 0, low: 0 };
  const slice = candles.slice(-period);
  let high = -Infinity;
  let low = Infinity;
  for (const c of slice) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  return { high, low };
}
