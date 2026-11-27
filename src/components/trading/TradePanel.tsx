"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatPrice, priceDecimals } from "./useMarketData";
import type { SymbolInfo } from "./types";

interface TradePanelProps {
  symbol: SymbolInfo;
  livePrice: number;
}

const FAKE_BALANCE_QUOTE = 50_000;

export function TradePanel({ symbol, livePrice }: TradePanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [priceInput, setPriceInput] = useState(() =>
    livePrice.toFixed(priceDecimals(livePrice)),
  );
  const [amountInput, setAmountInput] = useState("");

  const decimals = priceDecimals(livePrice);

  // Reset the price field to the live price when the symbol changes, using
  // the React "adjust state during render" pattern (no effect needed).
  const [appliedSymbolId, setAppliedSymbolId] = useState(symbol.id);
  if (appliedSymbolId !== symbol.id) {
    setAppliedSymbolId(symbol.id);
    setPriceInput(livePrice.toFixed(decimals));
    setAmountInput("");
  }

  const price = parseFloat(priceInput) || 0;
  const amount = parseFloat(amountInput) || 0;
  const total = useMemo(() => price * amount, [price, amount]);

  const isBuy = side === "buy";
  const sideColor = isBuy ? "var(--bull)" : "var(--bear)";

  function handlePercent(pct: number) {
    const quoteToSpend = FAKE_BALANCE_QUOTE * pct;
    if (price <= 0) {
      toast.error("Enter a price first");
      return;
    }
    const amt = quoteToSpend / price;
    setAmountInput(amt.toFixed(symbol.basePrice >= 1 ? 4 : 6));
  }

  function handleSubmit() {
    if (amount <= 0 || price <= 0) {
      toast.error("Enter a valid price and amount");
      return;
    }
    toast.success(`${isBuy ? "Buy" : "Sell"} order placed (demo)`, {
      description: `${amount.toFixed(symbol.basePrice >= 1 ? 4 : 6)} ${symbol.base} @ ${formatPrice(price, decimals)} ${symbol.quote} | Total ${formatPrice(total, 2)} ${symbol.quote}`,
    });
  }

  return (
    <section className="flex flex-col rounded-xl border border-[var(--panel-border)] bg-[#0d1117] animate-fade-in-up">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Trade
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Spot / Market
        </span>
      </div>

      {/* Buy / Sell tab toggle */}
      <div className="grid grid-cols-2 gap-1 p-2">
        <button
          type="button"
          onClick={() => setSide("buy")}
          className={cn(
            "rounded-md py-1.5 text-sm font-bold uppercase tracking-wider transition-all",
            isBuy
              ? "bg-[var(--bull)] text-[#0a0e17] shadow-[0_0_10px_rgba(22,199,132,0.35)]"
              : "bg-[#11161f] text-muted-foreground hover:text-foreground",
          )}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => setSide("sell")}
          className={cn(
            "rounded-md py-1.5 text-sm font-bold uppercase tracking-wider transition-all",
            !isBuy
              ? "bg-[var(--bear)] text-white shadow-[0_0_10px_rgba(234,57,67,0.35)]"
              : "bg-[#11161f] text-muted-foreground hover:text-foreground",
          )}
        >
          Sell
        </button>
      </div>

      <div className="flex flex-col gap-2 px-2 pb-2">
        {/* Available balance */}
        <div className="flex items-center justify-between rounded-md bg-[#0a0e17] px-2.5 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Available</span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {FAKE_BALANCE_QUOTE.toLocaleString("en-US", {
              maximumFractionDigits: 2,
            })}{" "}
            {symbol.quote}
          </span>
        </div>

        {/* Price input */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Price
          </span>
          <div className="flex items-center rounded-md border border-[var(--panel-border)] bg-[#0a0e17] focus-within:border-[var(--bull)]/60">
            <Input
              type="number"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              className="h-9 border-0 bg-transparent px-2.5 font-mono text-sm tabular-nums shadow-none focus-visible:ring-0"
              placeholder={livePrice.toFixed(decimals)}
            />
            <span className="pr-2.5 text-[11px] font-medium text-muted-foreground">
              {symbol.quote}
            </span>
          </div>
        </label>

        {/* Amount input */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Amount
          </span>
          <div className="flex items-center rounded-md border border-[var(--panel-border)] bg-[#0a0e17] focus-within:border-[var(--bull)]/60">
            <Input
              type="number"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="h-9 border-0 bg-transparent px-2.5 font-mono text-sm tabular-nums shadow-none focus-visible:ring-0"
              placeholder="0.00"
            />
            <span className="pr-2.5 text-[11px] font-medium text-muted-foreground">
              {symbol.base}
            </span>
          </div>
        </label>

        {/* Percentage buttons */}
        <div className="grid grid-cols-4 gap-1">
          {[0.25, 0.5, 0.75, 1].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => handlePercent(pct)}
              className="rounded-md border border-[var(--panel-border)] bg-[#0a0e17] py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-[#11161f] hover:text-foreground"
            >
              {pct === 1 ? "Max" : `${pct * 100}%`}
            </button>
          ))}
        </div>

        {/* Total (auto) */}
        <div className="flex items-center justify-between rounded-md bg-[#0a0e17] px-2.5 py-1.5 text-[11px]">
          <span className="text-muted-foreground">Total</span>
          <span className="font-mono font-medium tabular-nums text-foreground">
            {formatPrice(total, 2)} {symbol.quote}
          </span>
        </div>

        {/* Submit button */}
        <button
          type="button"
          onClick={handleSubmit}
          className="mt-1 rounded-md py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all hover:brightness-110 active:scale-[0.99]"
          style={{
            backgroundColor: sideColor,
            boxShadow: `0 0 12px ${isBuy ? "rgba(22,199,132,0.4)" : "rgba(234,57,67,0.4)"}`,
          }}
        >
          {isBuy ? "Buy" : "Sell"} {symbol.base}
        </button>

        <p className="pt-0.5 text-center text-[10px] text-muted-foreground">
          Demo only - no real orders are executed
        </p>
      </div>
    </section>
  );
}
