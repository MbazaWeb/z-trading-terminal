"use client";

import { useState } from "react";
import {
  Activity,
  CandlestickChart,
  Cpu,
  FileText,
  LayoutDashboard,
  BrainCircuit,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/lib/authStore";

export type ViewId = "trading" | "dashboard" | "agents" | "bot" | "reports" | "strategies";

interface NavItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: "trading", label: "Trading", icon: CandlestickChart },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "strategies", label: "Strategies", icon: Activity },
  { id: "agents", label: "Agents", icon: BrainCircuit },
  { id: "bot", label: "Bot", icon: Cpu },
  { id: "reports", label: "Reports", icon: FileText },
];

interface SidebarProps {
  active: ViewId;
  onSelect: (id: ViewId) => void;
}

function NavButton({
  item,
  active,
  collapsed,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onSelect: (id: ViewId) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all",
        collapsed && "justify-center px-0",
        active
          ? "bg-[#11161f] text-foreground"
          : "text-muted-foreground hover:bg-[#0d1117] hover:text-foreground",
      )}
    >
      {active && (
        <span
          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--bull)] shadow-[0_0_8px_rgba(22,199,132,0.7)]"
          aria-hidden="true"
        />
      )}
      <Icon
        className={cn(
          "size-4 shrink-0 transition-colors",
          active
            ? "text-[var(--bull)]"
            : "text-muted-foreground group-hover:text-foreground",
        )}
        strokeWidth={active ? 2.5 : 2}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );
}

function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        "flex h-14 items-center gap-2.5 border-b border-[var(--panel-border)] px-3",
        collapsed && "justify-center px-0",
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[var(--bull)] to-[#0e7a4d] text-[#0a0e17] shadow-[0_0_12px_rgba(22,199,132,0.45)]">
        <Activity className="size-5" strokeWidth={2.5} />
      </div>
      {!collapsed && (
        <div className="flex flex-col leading-none">
          <span className="text-sm font-bold tracking-wider text-foreground">
            Z TERMINAL
          </span>
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground">
            MULTI-ASSET SUITE
          </span>
        </div>
      )}
    </div>
  );
}

function formatBalance(amount: number, currency: string): string {
  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function UserAccountSection({ collapsed }: { collapsed: boolean }) {
  const accountInfo = useAuthStore((s) => s.accountInfo);
  const provider = useAuthStore((s) => s.provider);
  const accountType = useAuthStore((s) => s.accountType);
  const logout = useAuthStore((s) => s.logout);

  if (!accountInfo) return null;

  const isDeriv = provider === "deriv";
  const isDemo = accountType === "demo";
  const balancePositive = accountInfo.balance > 0;

  const handleLogout = () => {
    logout();
    toast.success("Signed out", {
      description: "You have been returned to the login screen.",
    });
  };

  if (collapsed) {
    return (
      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={handleLogout}
          title="Sign out"
          className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--panel-border)] bg-[#0d1117] py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-[var(--bear)]/60 hover:bg-[rgba(234,57,67,0.08)] hover:text-[var(--bear)]"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="px-2 pb-2">
      <div className="rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-3">
        {/* Login id + provider badge */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <span
            className="truncate font-mono text-xs tabular-nums text-foreground"
            title={accountInfo.loginid}
          >
            {accountInfo.loginid}
          </span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
              isDeriv
                ? "bg-[rgba(22,199,132,0.15)] text-[var(--bull)]"
                : "bg-[rgba(99,102,241,0.18)] text-indigo-300",
            )}
          >
            {isDeriv ? "Deriv" : "MetaTrader"}
          </span>
        </div>

        {/* Account type badge + balance */}
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                isDemo ? "bg-[var(--bull)]" : "bg-[var(--bear)]",
              )}
              aria-hidden="true"
            />
            <span className="font-medium uppercase tracking-wide">
              {isDemo ? "Demo" : "Real"}
            </span>
          </span>
          <span
            className={cn(
              "font-mono text-xs tabular-nums font-semibold",
              balancePositive ? "text-[var(--bull)]" : "text-[var(--bear)]",
            )}
          >
            ${formatBalance(accountInfo.balance, accountInfo.currency)}
          </span>
        </div>

        {/* Logout */}
        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--panel-border)] bg-[#0a0e17] py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-[var(--bear)]/60 hover:bg-[rgba(234,57,67,0.08)] hover:text-[var(--bear)]"
        >
          <LogOut className="size-3.5" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-[var(--panel-border)] px-3 py-3 text-[11px]",
        collapsed && "justify-center px-0",
      )}
    >
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-live rounded-full bg-[var(--bull)]" />
        <span className="relative inline-flex size-2 rounded-full bg-[var(--bull)]" />
      </span>
      {!collapsed && (
        <div className="flex flex-1 items-center justify-between">
          <span className="font-semibold tracking-wider text-[var(--bull)]">
            LIVE
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">
            v1.0.0
          </span>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ active, onSelect }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSelect = (id: ViewId) => {
    onSelect(id);
    setMobileOpen(false);
  };

  return (
    <>
      {/* Mobile hamburger bar */}
      <div className="flex h-12 items-center border-b border-[var(--panel-border)] bg-[#0a0e17] px-3 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-foreground"
              aria-label="Open navigation"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[240px] border-r border-[var(--panel-border)] bg-[#0a0e17] p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex h-full flex-col">
              <SidebarBrand collapsed={false} />
              <nav className="flex flex-1 flex-col gap-1 p-2">
                {NAV_ITEMS.map((item) => (
                  <NavButton
                    key={item.id}
                    item={item}
                    active={active === item.id}
                    collapsed={false}
                    onSelect={handleSelect}
                  />
                ))}
              </nav>
              <UserAccountSection collapsed={false} />
              <SidebarFooter collapsed={false} />
            </div>
          </SheetContent>
        </Sheet>
        <span className="ml-2 text-sm font-bold tracking-wider text-foreground">
          Z TERMINAL
        </span>
      </div>

      {/* Desktop fixed sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-[var(--panel-border)] bg-[#0a0e17] transition-[width] duration-200 md:flex",
          collapsed ? "w-[64px]" : "w-[220px]",
        )}
      >
        <SidebarBrand collapsed={collapsed} />
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV_ITEMS.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={active === item.id}
              collapsed={collapsed}
              onSelect={onSelect}
            />
          ))}
        </nav>
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--panel-border)] bg-[#0d1117] py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-[#11161f] hover:text-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <>
                <PanelLeftClose className="size-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
        <UserAccountSection collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} />
      </aside>
    </>
  );
}
