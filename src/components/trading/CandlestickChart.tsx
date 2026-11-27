"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  TIMEFRAMES,
  formatPrice,
  priceDecimals,
  sma,
} from "./useMarketData";
import type {
  Candle,
  ChartType,
  IndicatorState,
  SymbolInfo,
  Timeframe,
} from "./types";

interface CandlestickChartProps {
  candles: Candle[];
  symbol: SymbolInfo;
  timeframe: Timeframe;
  chartType: ChartType;
  indicators: IndicatorState;
  onTimeframeChange: (tf: Timeframe) => void;
  onChartTypeChange: (t: ChartType) => void;
  onToggleIndicator: (key: keyof IndicatorState) => void;
}

// Measure an element's pixel size reactively (used to make the SVG fully
// responsive and fill its grid cell on desktop).
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 960, height: 440 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ...size };
}

function formatAxisTime(time: number, tf: Timeframe): string {
  const d = new Date(time);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  if (tf === "1m" || tf === "5m" || tf === "15m" || tf === "1H") {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (tf === "4H") {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
  }
  return `${months[d.getMonth()]} ${pad(d.getDate())}`;
}

export function CandlestickChart({
  candles,
  symbol,
  timeframe,
  chartType,
  indicators,
  onTimeframeChange,
  onChartTypeChange,
  onToggleIndicator,
}: CandlestickChartProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    index: number;
  } | null>(null);

  // Layout constants (depend on responsive size).
  const padTop = 12;
  const padBottom = 26; // time axis
  const rightAxisW = 66;
  const leftPad = 8;
  const mainH = Math.max(height - padTop - padBottom, 60);
  const priceH = Math.floor(mainH * 0.72);
  const gapVol = 8;
  const volH = mainH - priceH - gapVol;
  const plotW = Math.max(width - leftPad - rightAxisW, 0);
  const priceTop = padTop;
  const priceBottom = padTop + priceH;
  const volTop = priceBottom + gapVol;
  const volBottom = volTop + volH;

  const decimals = priceDecimals(
    candles.length ? candles[candles.length - 1].close : symbol.basePrice,
  );

  // Price range with padding.
  const { minLow, maxHigh, maxVol } = useMemo(() => {
    if (candles.length === 0) {
      return { minLow: 0, maxHigh: 1, maxVol: 1 };
    }
    let lo = Infinity;
    let hi = -Infinity;
    let mv = 0;
    for (const c of candles) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
      if (c.volume > mv) mv = c.volume;
    }
    const pad = (hi - lo) * 0.08 || hi * 0.02;
    return { minLow: lo - pad, maxHigh: hi + pad, maxVol: mv };
  }, [candles]);

  const priceToY = useCallback(
    (p: number) => {
      const range = maxHigh - minLow || 1;
      return priceBottom - ((p - minLow) / range) * priceH;
    },
    [maxHigh, minLow, priceH, priceBottom],
  );

  const volToY = useCallback(
    (v: number) => {
      const range = maxVol || 1;
      return volBottom - (v / range) * volH;
    },
    [maxVol, volH, volBottom],
  );

  const count = candles.length;
  const slot = count > 0 ? plotW / count : 0;
  const candleW = Math.max(Math.min(slot * 0.66, 14), 1.5);

  const candleX = useCallback(
    (i: number) => leftPad + slot * (i + 0.5),
    [leftPad, slot],
  );

  // SMA series.
  const closes = useMemo(() => candles.map((c) => c.close), [candles]);
  const sma7 = useMemo(
    () => (indicators.sma7 ? sma(closes, 7) : []),
    [indicators.sma7, closes],
  );
  const sma25 = useMemo(
    () => (indicators.sma25 ? sma(closes, 25) : []),
    [indicators.sma25, closes],
  );
  const sma99 = useMemo(
    () => (indicators.sma99 ? sma(closes, 99) : []),
    [indicators.sma99, closes],
  );

  function smaPath(series: (number | null)[]): string {
    let d = "";
    let started = false;
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v == null) continue;
      const x = candleX(i);
      const y = priceToY(v);
      d += `${started ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
      started = true;
    }
    return d.trim();
  }

  // Line / area path for the close series.
  const closeLinePath = useMemo(() => {
    let d = "";
    for (let i = 0; i < candles.length; i++) {
      const x = candleX(i);
      const y = priceToY(candles[i].close);
      d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
    }
    return d.trim();
  }, [candles, candleX, priceToY]);

  const closeAreaPath = useMemo(() => {
    if (!closeLinePath || candles.length === 0) return "";
    const firstX = candleX(0);
    const lastX = candleX(candles.length - 1);
    return `${closeLinePath} L${lastX.toFixed(2)},${priceBottom.toFixed(2)} L${firstX.toFixed(2)},${priceBottom.toFixed(2)} Z`;
  }, [closeLinePath, candleX, candles, priceBottom]);

  // Y-axis price gridlines + labels (~6 lines).
  const yTicks = useMemo(() => {
    const ticks: { value: number; y: number }[] = [];
    const steps = 6;
    const range = maxHigh - minLow || 1;
    for (let i = 0; i <= steps; i++) {
      const value = minLow + (range * i) / steps;
      ticks.push({ value, y: priceToY(value) });
    }
    return ticks;
  }, [minLow, maxHigh, priceToY]);

  // X-axis time labels (~7 evenly spaced).
  const xTicks = useMemo(() => {
    if (count === 0) return [];
    const labelCount = Math.min(7, count);
    const ticks: { time: number; x: number; label: string }[] = [];
    for (let i = 0; i < labelCount; i++) {
      const idx = Math.floor((i * (count - 1)) / (labelCount - 1));
      ticks.push({
        time: candles[idx].time,
        x: candleX(idx),
        label: formatAxisTime(candles[idx].time, timeframe),
      });
    }
    return ticks;
  }, [candles, count, candleX, timeframe]);

  // Mouse handling for the crosshair.
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || count === 0) return;
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const rel = (mx - leftPad) / slot;
      const index = Math.max(0, Math.min(count - 1, Math.floor(rel)));
      setHover({ x: mx, y: my, index });
    },
    [leftPad, slot, count],
  );

  const handleMouseLeave = useCallback(() => setHover(null), []);

  const hoveredCandle = hover ? candles[hover.index] : null;
  const hoveredChange = hoveredCandle
    ? hoveredCandle.close - hoveredCandle.open
    : 0;
  const hoveredChangePct = hoveredCandle
    ? (hoveredChange / hoveredCandle.open) * 100
    : 0;

  // Price at mouse Y for the right-axis label.
  const hoverPrice =
    hover && hover.y >= priceTop && hover.y <= priceBottom
      ? minLow + ((priceBottom - hover.y) / priceH) * (maxHigh - minLow)
      : null;

  return (
    <section className="flex h-full flex-col rounded-xl border border-[var(--panel-border)] bg-[#0d1117] animate-fade-in-up">
      {/* Chart toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--panel-border)] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 hidden text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:inline">
            Time
          </span>
          <div className="flex items-center rounded-md border border-[var(--panel-border)] bg-[#0a0e17] p-0.5">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={cn(
                  "rounded px-2 py-1 text-xs font-semibold transition-all",
                  timeframe === tf
                    ? "bg-[var(--bull)] text-[#0a0e17] shadow-[0_0_8px_rgba(22,199,132,0.4)]"
                    : "text-muted-foreground hover:bg-[#11161f] hover:text-foreground",
                )}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Chart type toggle */}
          <div className="flex items-center rounded-md border border-[var(--panel-border)] bg-[#0a0e17] p-0.5">
            {(["candles", "line", "area"] as ChartType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChartTypeChange(t)}
                className={cn(
                  "rounded px-2 py-1 text-xs font-semibold capitalize transition-all",
                  chartType === t
                    ? "bg-[#1c2230] text-foreground"
                    : "text-muted-foreground hover:bg-[#11161f] hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/* SMA indicators */}
          <div className="flex items-center gap-1">
            {(
              [
                { key: "sma7" as const, label: "SMA 7", color: "#f0b90b" },
                { key: "sma25" as const, label: "SMA 25", color: "#4f9cf9" },
                { key: "sma99" as const, label: "SMA 99", color: "#a855f7" },
              ]
            ).map((ind) => (
              <button
                key={ind.key}
                type="button"
                onClick={() => onToggleIndicator(ind.key)}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition-all",
                  indicators[ind.key]
                    ? "border-transparent bg-[#11161f] text-foreground"
                    : "border-[var(--panel-border)] text-muted-foreground hover:bg-[#11161f] hover:text-foreground",
                )}
              >
                <span
                  className="size-2 rounded-full"
                  style={{
                    backgroundColor: indicators[ind.key]
                      ? ind.color
                      : "#2a3340",
                    boxShadow: indicators[ind.key]
                      ? `0 0 6px ${ind.color}`
                      : "none",
                  }}
                />
                {ind.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart canvas - flexes to fill available height */}
      <div
        ref={ref}
        className="relative w-full min-h-[360px] flex-1 select-none overflow-hidden"
      >
        {/* OHLC tooltip (top-left floating box) */}
        {hoveredCandle && (
          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md border border-[var(--panel-border)] bg-[#0a0e17]/95 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>
                {symbol.base}
                {symbol.quote ? "/" + symbol.quote : ""}
              </span>
              <span>{formatAxisTime(hoveredCandle.time, timeframe)}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <span className="text-muted-foreground">O</span>
              <span className="text-right tabular-nums text-foreground">
                {formatPrice(hoveredCandle.open, decimals)}
              </span>
              <span className="text-muted-foreground">H</span>
              <span className="text-right tabular-nums text-[var(--bull)]">
                {formatPrice(hoveredCandle.high, decimals)}
              </span>
              <span className="text-muted-foreground">L</span>
              <span className="text-right tabular-nums text-[var(--bear)]">
                {formatPrice(hoveredCandle.low, decimals)}
              </span>
              <span className="text-muted-foreground">C</span>
              <span
                className={cn(
                  "text-right tabular-nums",
                  hoveredChange >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]",
                )}
              >
                {formatPrice(hoveredCandle.close, decimals)}
              </span>
              <span className="text-muted-foreground">Vol</span>
              <span className="text-right tabular-nums text-foreground/80">
                {hoveredCandle.volume >= 1000
                  ? (hoveredCandle.volume / 1000).toFixed(2) + "K"
                  : hoveredCandle.volume.toFixed(2)}
              </span>
              <span className="text-muted-foreground">Chg</span>
              <span
                className={cn(
                  "text-right tabular-nums",
                  hoveredChange >= 0 ? "text-[var(--bull)]" : "text-[var(--bear)]",
                )}
              >
                {hoveredChange >= 0 ? "+" : ""}
                {hoveredChangePct.toFixed(2)}%
              </span>
            </div>
          </div>
        )}

        {/* Legend for active SMAs (top-right) */}
        {(indicators.sma7 || indicators.sma25 || indicators.sma99) && (
          <div className="pointer-events-none absolute right-20 top-2 z-10 hidden gap-3 font-mono text-[10px] sm:flex">
            {indicators.sma7 && (
              <span className="flex items-center gap-1 text-[#f0b90b]">
                <span className="inline-block h-0.5 w-3 bg-[#f0b90b]" />
                SMA 7
              </span>
            )}
            {indicators.sma25 && (
              <span className="flex items-center gap-1 text-[#4f9cf9]">
                <span className="inline-block h-0.5 w-3 bg-[#4f9cf9]" />
                SMA 25
              </span>
            )}
            {indicators.sma99 && (
              <span className="flex items-center gap-1 text-[#a855f7]">
                <span className="inline-block h-0.5 w-3 bg-[#a855f7]" />
                SMA 99
              </span>
            )}
          </div>
        )}

        {plotW > 0 && (
          <svg
            ref={svgRef}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            role="img"
            aria-label={`${symbol.label} candlestick chart`}
          >
            <defs>
              <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#16c784" stopOpacity="0.28" />
                <stop offset="100%" stopColor="#16c784" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="line-stroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#16c784" />
                <stop offset="100%" stopColor="#0e7a4d" />
              </linearGradient>
            </defs>

            {/* Horizontal price gridlines */}
            {yTicks.map((t, i) => (
              <line
                key={`yg-${i}`}
                x1={leftPad}
                y1={t.y}
                x2={leftPad + plotW}
                y2={t.y}
                stroke="#161b22"
                strokeWidth="1"
                strokeDasharray={i === 0 || i === yTicks.length - 1 ? "0" : "2 4"}
              />
            ))}

            {/* Vertical time gridlines */}
            {xTicks.map((t, i) => (
              <line
                key={`xg-${i}`}
                x1={t.x}
                y1={priceTop}
                x2={t.x}
                y2={volBottom}
                stroke="#161b22"
                strokeWidth="1"
                strokeDasharray="2 4"
              />
            ))}

            {/* Volume bars */}
            {chartType === "candles" &&
              candles.map((c, i) => {
                const x = candleX(i);
                const y = volToY(c.volume);
                const up = c.close >= c.open;
                const color = up ? "#16c784" : "#ea3943";
                return (
                  <rect
                    key={`vol-${i}`}
                    x={x - candleW / 2}
                    y={y}
                    width={candleW}
                    height={Math.max(volBottom - y, 0)}
                    fill={color}
                    opacity="0.35"
                  />
                );
              })}

            {/* Candles / line / area */}
            {chartType === "candles" &&
              candles.map((c, i) => {
                const x = candleX(i);
                const up = c.close >= c.open;
                const color = up ? "#16c784" : "#ea3943";
                const yOpen = priceToY(c.open);
                const yClose = priceToY(c.close);
                const yHigh = priceToY(c.high);
                const yLow = priceToY(c.low);
                const bodyTop = Math.min(yOpen, yClose);
                const bodyH = Math.max(Math.abs(yClose - yOpen), 1);
                return (
                  <g key={`c-${i}`}>
                    <line
                      x1={x}
                      y1={yHigh}
                      x2={x}
                      y2={yLow}
                      stroke={color}
                      strokeWidth="1"
                    />
                    <rect
                      x={x - candleW / 2}
                      y={bodyTop}
                      width={candleW}
                      height={bodyH}
                      fill={color}
                      rx="0.5"
                    />
                  </g>
                );
              })}

            {chartType === "area" && closeAreaPath && (
              <path d={closeAreaPath} fill="url(#area-fill)" stroke="none" />
            )}

            {(chartType === "line" || chartType === "area") &&
              closeLinePath && (
                <path
                  d={closeLinePath}
                  fill="none"
                  stroke="url(#line-stroke)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}

            {/* SMA overlays */}
            {indicators.sma7 && sma7.length > 0 && (
              <path
                d={smaPath(sma7)}
                fill="none"
                stroke="#f0b90b"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.9"
              />
            )}
            {indicators.sma25 && sma25.length > 0 && (
              <path
                d={smaPath(sma25)}
                fill="none"
                stroke="#4f9cf9"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.9"
              />
            )}
            {indicators.sma99 && sma99.length > 0 && (
              <path
                d={smaPath(sma99)}
                fill="none"
                stroke="#a855f7"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.9"
              />
            )}

            {/* Last price line + label */}
            {candles.length > 0 && (
              <>
                <line
                  x1={leftPad}
                  y1={priceToY(candles[candles.length - 1].close)}
                  x2={leftPad + plotW}
                  y2={priceToY(candles[candles.length - 1].close)}
                  stroke={
                    candles[candles.length - 1].close >=
                    candles[candles.length - 1].open
                      ? "#16c784"
                      : "#ea3943"
                  }
                  strokeWidth="1"
                  strokeDasharray="4 3"
                  opacity="0.6"
                />
                <rect
                  x={leftPad + plotW}
                  y={priceToY(candles[candles.length - 1].close) - 9}
                  width={rightAxisW}
                  height={18}
                  fill={
                    candles[candles.length - 1].close >=
                    candles[candles.length - 1].open
                      ? "#16c784"
                      : "#ea3943"
                  }
                  opacity="0.95"
                />
                <text
                  x={leftPad + plotW + rightAxisW / 2}
                  y={priceToY(candles[candles.length - 1].close) + 4}
                  textAnchor="middle"
                  className="font-mono"
                  fontSize="11"
                  fontWeight="700"
                  fill="#0a0e17"
                >
                  {formatPrice(candles[candles.length - 1].close, decimals)}
                </text>
              </>
            )}

            {/* Y-axis price labels */}
            {yTicks.map((t, i) => (
              <text
                key={`yl-${i}`}
                x={leftPad + plotW + 6}
                y={t.y + 4}
                className="font-mono"
                fontSize="11"
                fill="#8b949e"
              >
                {formatPrice(t.value, decimals)}
              </text>
            ))}

            {/* X-axis time labels */}
            {xTicks.map((t, i) => (
              <text
                key={`xl-${i}`}
                x={t.x}
                y={height - 8}
                textAnchor="middle"
                className="font-mono"
                fontSize="11"
                fill="#8b949e"
              >
                {t.label}
              </text>
            ))}

            {/* Crosshair */}
            {hover && (
              <g pointerEvents="none">
                <line
                  x1={hover.x}
                  y1={priceTop}
                  x2={hover.x}
                  y2={volBottom}
                  stroke="#4a5568"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                {hoverPrice != null && (
                  <>
                    <line
                      x1={leftPad}
                      y1={hover.y}
                      x2={leftPad + plotW}
                      y2={hover.y}
                      stroke="#4a5568"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <rect
                      x={leftPad + plotW}
                      y={hover.y - 9}
                      width={rightAxisW}
                      height={18}
                      fill="#1c2230"
                      stroke="#2a3340"
                      strokeWidth="1"
                    />
                    <text
                      x={leftPad + plotW + rightAxisW / 2}
                      y={hover.y + 4}
                      textAnchor="middle"
                      className="font-mono"
                      fontSize="11"
                      fontWeight="600"
                      fill="#e6edf3"
                    >
                      {formatPrice(hoverPrice, decimals)}
                    </text>
                  </>
                )}
                {/* Hovered time label on x-axis */}
                {hoveredCandle && (
                  <>
                    <rect
                      x={candleX(hover.index) - 38}
                      y={height - 20}
                      width={76}
                      height={16}
                      fill="#1c2230"
                      stroke="#2a3340"
                      strokeWidth="1"
                    />
                    <text
                      x={candleX(hover.index)}
                      y={height - 8}
                      textAnchor="middle"
                      className="font-mono"
                      fontSize="11"
                      fontWeight="600"
                      fill="#e6edf3"
                    >
                      {formatAxisTime(hoveredCandle.time, timeframe)}
                    </text>
                  </>
                )}
              </g>
            )}
          </svg>
        )}
      </div>
    </section>
  );
}
