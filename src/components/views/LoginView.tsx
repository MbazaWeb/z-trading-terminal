"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  BarChart3,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldCheck,
  TrendingUp,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  type PendingAccountType,
  useAuthStore,
} from "@/lib/authStore";

// Register your app at https://api.deriv.com/dashboard and replace this
// with the App ID you obtain there. The placeholder below is Deriv's public
// demo App ID that does not require registration for quick testing.
const DERIV_APP_ID = "1089";

const MT5_SERVERS = [
  "Deriv-MT5",
  "ICMarkets-MT5",
  "Exness-MT5",
  "FBS-MT5",
  "Pepperstone-MT5",
  "Other",
] as const;

function startDerivOAuth() {
  const oauthUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${DERIV_APP_ID}&l=en&brand=binary`;
  window.location.href = oauthUrl;
}

function AccountTypePill({
  type,
  active,
  onSelect,
}: {
  type: PendingAccountType;
  active: boolean;
  onSelect: (t: PendingAccountType) => void;
}) {
  const isReal = type === "real";
  return (
    <button
      type="button"
      onClick={() => onSelect(type)}
      className={cn(
        "group flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all duration-200",
        active
          ? isReal
            ? "border-[var(--bear)] bg-[rgba(234,57,67,0.08)] text-foreground shadow-[0_0_18px_rgba(234,57,67,0.25)]"
            : "border-[var(--bull)] bg-[rgba(22,199,132,0.08)] text-foreground shadow-[0_0_18px_rgba(22,199,132,0.25)]"
          : "border-[var(--panel-border)] bg-[#0d1117] text-muted-foreground hover:border-[#2a3340] hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isReal ? "bg-[var(--bear)]" : "bg-[var(--bull)]",
        )}
        aria-hidden="true"
      />
      <span>{isReal ? "Real Account" : "Demo Account"}</span>
    </button>
  );
}

function LoginCard() {
  const pendingAccountType = useAuthStore((s) => s.pendingAccountType);
  const setPendingAccountType = useAuthStore((s) => s.setPendingAccountType);
  const loginWithMetaTrader = useAuthStore((s) => s.loginWithMetaTrader);

  const [showMt5Form, setShowMt5Form] = useState(false);
  const [loginNumber, setLoginNumber] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState<string>(MT5_SERVERS[0]);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<{ login?: string; password?: string }>(
    {},
  );

  const handleDeriv = () => {
    setPendingAccountType(pendingAccountType ?? "demo");
    toast.info("Redirecting to Deriv...");
    // Tiny delay so the toast actually paints before the full-page redirect.
    setTimeout(startDerivOAuth, 250);
  };

  const toggleMt5 = () => {
    setShowMt5Form((v) => !v);
    setErrors({});
  };

  const handleMt5Submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: { login?: string; password?: string } = {};
    if (!loginNumber.trim()) next.login = "Account number is required";
    if (!password) next.password = "Password is required";
    setErrors(next);
    if (next.login || next.password) return;

    setSubmitting(true);
    const chosenType: PendingAccountType = pendingAccountType ?? "demo";
    setTimeout(() => {
      const loginid = `MT5-${loginNumber.trim()}`;
      loginWithMetaTrader(loginid, chosenType);
      setSubmitting(false);
      toast.success("Connected to MetaTrader", {
        description: `Logged in as ${loginid} (${server})`,
      });
    }, 1500);
  };

  return (
    <div className="relative w-full max-w-md rounded-2xl border border-[var(--panel-border)] bg-[rgba(13,17,23,0.86)] p-6 shadow-[0_0_60px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-8">
      {/* Subtle top border glow */}
      <div className="pointer-events-none absolute inset-x-6 -top-px h-px bg-gradient-to-r from-transparent via-[var(--bull)] to-transparent opacity-60" />

      {/* Brand */}
      <div className="mb-6 flex flex-col items-center text-center">
        <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--bull)] to-[#0e7a4d] text-[#0a0e17] shadow-[0_0_22px_rgba(22,199,132,0.55)]">
          <Activity className="size-7" strokeWidth={2.5} />
        </div>
        <h1 className="text-xl font-bold tracking-wider text-foreground">
          Z TERMINAL
        </h1>
        <p className="mt-1 text-xs font-medium tracking-wide text-muted-foreground">
          Professional Trading Terminal
        </p>
      </div>

      {/* Heading */}
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-foreground">
          Sign in to your account
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your broker account to start trading
        </p>
      </div>

      {/* Account type pre-select */}
      <div className="mb-5">
        <Label className="mb-2 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Account mode
        </Label>
        <div className="flex gap-2">
          <AccountTypePill
            type="demo"
            active={pendingAccountType === "demo"}
            onSelect={(t) => setPendingAccountType(t)}
          />
          <AccountTypePill
            type="real"
            active={pendingAccountType === "real"}
            onSelect={(t) => setPendingAccountType(t)}
          />
        </div>
      </div>

      {/* Deriv button */}
      <button
        type="button"
        onClick={handleDeriv}
        className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-lg border border-[var(--bull)]/60 bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_18px_rgba(22,199,132,0.35)] transition-all duration-200 hover:scale-[1.02] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--bull)]"
      >
        <span className="flex size-6 items-center justify-center rounded-md bg-white/20 font-mono text-sm font-bold tracking-tighter">
          D
        </span>
        <span>Continue with Deriv</span>
        <ChevronRight className="size-4 opacity-80 transition-transform group-hover:translate-x-0.5" />
      </button>

      {/* Divider */}
      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--panel-border)]" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          or
        </span>
        <div className="h-px flex-1 bg-[var(--panel-border)]" />
      </div>

      {/* MetaTrader button */}
      <button
        type="button"
        onClick={toggleMt5}
        aria-expanded={showMt5Form}
        className={cn(
          "group flex w-full items-center justify-center gap-3 rounded-lg border px-4 py-3 text-sm font-semibold transition-all duration-200 hover:scale-[1.02] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2",
          showMt5Form
            ? "border-indigo-400/70 bg-gradient-to-r from-indigo-500 to-blue-600 text-white shadow-[0_0_18px_rgba(99,102,241,0.4)] focus-visible:ring-indigo-400"
            : "border-indigo-500/40 bg-[rgba(99,102,241,0.12)] text-indigo-200 hover:bg-gradient-to-r hover:from-indigo-500 hover:to-blue-600 hover:text-white focus-visible:ring-indigo-400",
        )}
      >
        <BarChart3 className="size-5" />
        <span>Continue with MetaTrader</span>
        <ChevronRight
          className={cn(
            "size-4 opacity-80 transition-transform",
            showMt5Form && "rotate-90",
          )}
        />
      </button>

      {/* MetaTrader expandable form */}
      <div
        className={cn(
          "grid transition-all duration-300 ease-out",
          showMt5Form ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <form
            onSubmit={handleMt5Submit}
            className="rounded-lg border border-[var(--panel-border)] bg-[#0a0e17] p-4"
          >
            {/* Login number */}
            <div className="mb-3">
              <Label
                htmlFor="mt5-login"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                Account / Login number
              </Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="mt5-login"
                  inputMode="numeric"
                  autoComplete="username"
                  placeholder="12345678"
                  value={loginNumber}
                  onChange={(e) => setLoginNumber(e.target.value)}
                  className="bg-[#0d1117] pl-9 font-mono tabular-nums"
                  aria-invalid={!!errors.login}
                />
              </div>
              {errors.login && (
                <p className="mt-1 text-xs text-[var(--bear)]">{errors.login}</p>
              )}
            </div>

            {/* Password */}
            <div className="mb-3">
              <Label
                htmlFor="mt5-password"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                Password
              </Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="mt5-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-[#0d1117] pl-9 pr-9"
                  aria-invalid={!!errors.password}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-xs text-[var(--bear)]">
                  {errors.password}
                </p>
              )}
            </div>

            {/* Server */}
            <div className="mb-4">
              <Label
                htmlFor="mt5-server"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                Server / Broker
              </Label>
              <Select value={server} onValueChange={setServer}>
                <SelectTrigger
                  id="mt5-server"
                  className="bg-[#0d1117]"
                >
                  <SelectValue placeholder="Select server" />
                </SelectTrigger>
                <SelectContent>
                  {MT5_SERVERS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Account type toggle (synced with pending) */}
            <div className="mb-4">
              <Label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Account type
              </Label>
              <div className="flex gap-2">
                <AccountTypePill
                  type="demo"
                  active={pendingAccountType === "demo"}
                  onSelect={(t) => setPendingAccountType(t)}
                />
                <AccountTypePill
                  type="real"
                  active={pendingAccountType === "real"}
                  onSelect={(t) => setPendingAccountType(t)}
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-gradient-to-r from-indigo-500 to-blue-600 text-white hover:brightness-110"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4" />
                  Connect Account
                </>
              )}
            </Button>
          </form>
        </div>
      </div>

      {/* Footer */}
      <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
        By signing in, you agree to the Terms of Service and Privacy Policy.
        <br />
        This is a demo application — no real trades are executed.
      </p>
    </div>
  );
}

export function LoginView() {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-12">
      {/* Animated background: grid + radial glows */}
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40" />
      <div
        className="pointer-events-none absolute -top-1/4 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(22,199,132,0.18),transparent_60%)] blur-2xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-1/4 right-1/4 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.14),transparent_60%)] blur-2xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-1/3 left-1/4 h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(234,57,67,0.10),transparent_60%)] blur-2xl"
        aria-hidden="true"
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
        <LoginCard />
        <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground">
          <TrendingUp className="size-3.5 text-[var(--bull)]" />
          <span>Encrypted session • No funds at risk</span>
        </div>
      </div>
    </div>
  );
}
