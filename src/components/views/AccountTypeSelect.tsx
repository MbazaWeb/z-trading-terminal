"use client";

import { FlaskConical, TrendingUp, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/lib/authStore";
import { cn } from "@/lib/utils";

interface ChoiceCardProps {
  type: "real" | "demo";
  onSelect: (t: "real" | "demo") => void;
}

function ChoiceCard({ type, onSelect }: ChoiceCardProps) {
  const isReal = type === "real";
  const Icon = isReal ? TrendingUp : FlaskConical;
  return (
    <button
      type="button"
      onClick={() => {
        onSelect(type);
        toast.success(
          isReal ? "Real account activated" : "Demo account activated",
        );
      }}
      className={cn(
        "group relative flex w-full flex-col gap-3 rounded-2xl border p-6 text-left transition-all duration-200 hover:scale-[1.02]",
        isReal
          ? "border-[var(--bear)]/60 bg-[rgba(234,57,67,0.06)] hover:shadow-[0_0_28px_rgba(234,57,67,0.25)]"
          : "border-[var(--bull)]/60 bg-[rgba(22,199,132,0.06)] hover:shadow-[0_0_28px_rgba(22,199,132,0.25)]",
      )}
    >
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-xl",
          isReal
            ? "bg-[rgba(234,57,67,0.15)] text-[var(--bear)]"
            : "bg-[rgba(22,199,132,0.15)] text-[var(--bull)]",
        )}
      >
        <Icon className="size-6" strokeWidth={2.5} />
      </div>
      <div>
        <h3 className="text-base font-semibold text-foreground">
          {isReal ? "Real Account" : "Demo Account"}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {isReal
            ? "Trade with real funds. Risk management enforced."
            : "Practice with virtual funds. No risk involved."}
        </p>
      </div>
      {isReal ? (
        <div className="flex items-center gap-2 rounded-md border border-[var(--bear)]/30 bg-[rgba(234,57,67,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--bear)]">
          <ShieldAlert className="size-3.5" />
          <span>Caution: real money</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-[var(--bull)]/30 bg-[rgba(22,199,132,0.08)] px-2.5 py-1.5 text-[11px] text-[var(--bull)]">
          <Sparkles className="size-3.5" />
          <span>$10,000 virtual balance</span>
        </div>
      )}
    </button>
  );
}

export function AccountTypeSelect() {
  const setAccountType = useAuthStore((s) => s.setAccountType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* Blur backdrop */}
      <div
        className="absolute inset-0 bg-[#05080d]/80 backdrop-blur-md"
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />

      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-[var(--panel-border)] bg-[rgba(13,17,23,0.92)] p-6 shadow-[0_0_60px_rgba(0,0,0,0.7)] backdrop-blur-xl sm:p-8">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-semibold text-foreground">
            Select your account type
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You can switch later from the sidebar.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <ChoiceCard type="demo" onSelect={setAccountType} />
          <ChoiceCard type="real" onSelect={setAccountType} />
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Demo accounts use virtual funds. Real accounts require verified funds
          in your broker account.
        </p>
      </div>
    </div>
  );
}
