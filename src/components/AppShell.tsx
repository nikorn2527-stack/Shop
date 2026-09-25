"use client";

/**
 * AppShell — the real authenticated dashboard layout.
 *
 * Replaces the placeholder from Task 2 (src/components/auth/AppShell.tsx).
 * Renders:
 *   - Desktop sidebar (w-64) with brand, role card, nav, admin nav, logout
 *   - Mobile sidebar via shadcn Sheet (hamburger in topbar)
 *   - Topbar with breadcrumb, ⌘K search button, notif bell, profile pill
 *   - Page content area (key={view} for clean swap)
 *   - Sticky footer with brand + helpPhone + Powered by PNG
 *   - GlobalSearch command palette (⌘K)
 *
 * The active view is held in client state (`view: View`). Role gating uses
 * `canAccessView(role, view)` — if blocked, falls back to "dashboard".
 *
 * Pages are imported directly (no Next router) — only the AppShell knows about
 * the 8 views. POS / Stock / Reports will lazy-load via `next/dynamic` when
 * their owning tasks finish.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Bell,
  CircleHelp,
  Crown,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  Terminal,
  UserCog,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { apiPost, apiGet } from "@/lib/api-client";
import { roleLabel } from "@/lib/rbac";
import {
  ADMIN_ROLES,
  NAV_ITEMS,
  canAccessView,
  isAdminRole,
  resolveView,
  type View,
} from "@/lib/view-data";
import { money } from "@/lib/format";
import { GlobalSearch } from "@/components/shell/GlobalSearch";
import { FloatingVersionBadge } from "@/components/shared/FloatingVersionBadge";

// Lazy-load heavy page components to keep the initial bundle small.
// This also reduces peak memory during dev compilation.
const Loading = () => <PageSkeleton label="กำลังโหลดหน้า" />;
const DashboardPage = dynamic(() => import("@/components/dashboard/DashboardPage").then((m) => m.DashboardPage), { loading: Loading });
const MembersPage = dynamic(() => import("@/components/members/MembersPage").then((m) => m.MembersPage), { loading: Loading });
const SettingsPage = dynamic(() => import("@/components/settings/SettingsPage").then((m) => m.SettingsPage), { loading: Loading });
const LogsPage = dynamic(() => import("@/components/logs/LogsPage").then((m) => m.LogsPage), { loading: Loading });
const UsersPage = dynamic(() => import("@/components/users/UsersPage").then((m) => m.UsersPage), { loading: Loading });
const PosPage = dynamic(() => import("@/components/pos/PosPage").then((m) => m.PosPage), { loading: Loading });
const StockPage = dynamic(() => import("@/components/stock/StockPage").then((m) => m.StockPage), { loading: Loading });
const ReportsPage = dynamic(() => import("@/components/reports/ReportsPage").then((m) => m.ReportsPage), { loading: Loading });
const ShiftPage = dynamic(() => import("@/components/shift/ShiftPage").then((m) => m.ShiftPage), { loading: Loading });

function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="flex-1 grid place-items-center text-muted-foreground text-sm" role="status">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
        {label}
      </div>
    </div>
  );
}

export interface AppShellUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  mustChangePassword: boolean;
}

interface AppShellProps {
  user: AppShellUser;
}

interface DashboardStats {
  lowStock: { id: string; name: string; stock: number; unit: string; reorderPoint: number }[];
  expirySoon: { lotId: string; productName: string; expiryLabel: string; qty: number }[];
  memberWalletTotal?: number;
  memberCount?: number;
}

interface Settings {
  appName?: string;
  helpPhone?: string;
  lowBalanceAlert?: boolean;
  lowBalanceThreshold?: number;
}

interface MemberRow {
  memberNumber: string;
  firstName: string;
  lastName: string;
  prename?: string | null;
  balance: number;
  status: string;
}

function brandInitial(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "ส";
  // Use first non-whitespace character (Thai or latin) — works for "ร้านค้า…" and "PNG Shop".
  return trimmed.slice(0, 1);
}

function PendingModulePlaceholder({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">
          โมดูลนี้กำลังพัฒนา
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
      </div>
      <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 p-10 text-center">
        <div className="mx-auto size-12 rounded-xl bg-emerald-100 text-emerald-700 grid place-items-center">
          <LayoutDashboard className="size-6" aria-hidden="true" />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          โมดูลนี้กำลังอยู่ระหว่างการพัฒนา · จะเปิดให้ใช้งานเร็ว ๆ นี้
        </p>
      </div>
    </div>
  );
}

function RoleIcon({ role }: { role: string }) {
  if (role === "administrator" || role === "manager")
    return <Crown className="size-3.5" aria-hidden="true" />;
  if (role === "dev_service")
    return <Terminal className="size-3.5" aria-hidden="true" />;
  if (role === "auditor")
    return <ShieldCheck className="size-3.5" aria-hidden="true" />;
  return <UserCog className="size-3.5" aria-hidden="true" />;
}

function roleChipClass(role: string): string {
  if (role === "administrator" || role === "manager")
    return "bg-emerald-100 text-emerald-700";
  if (role === "dev_service") return "bg-amber-100 text-amber-700";
  if (role === "auditor") return "bg-neutral-100 text-neutral-700";
  return "bg-neutral-100 text-neutral-700";
}

export default function AppShell({ user }: AppShellProps) {
  const router = useRouter();
  const [view, setView] = React.useState<View>("dashboard");
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [pendingLogout, setPendingLogout] = React.useState(false);

  // Refetch stats + settings every 60s so the bell + sidebar badge stay fresh.
  const [stats, setStats] = React.useState<DashboardStats | null>(null);
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [members, setMembers] = React.useState<MemberRow[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [s, st, m] = await Promise.all([
          apiGet<DashboardStats>("/api/dashboard/stats?rangeDays=30").catch(() => null),
          apiGet<Settings>("/api/settings").catch(() => null),
          apiGet<{ members: MemberRow[] }>("/api/members").catch(() => null),
        ]);
        if (cancelled) return;
        if (s) setStats(s);
        if (st) setSettings(st);
        if (m) setMembers(m.members);
      } catch {
        /* swallow — auth gate will redirect if 401 */
      }
    }
    void load();
    const t = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  // ⌘K / Ctrl+K opens global search.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const role = user.role;
  const safeView = resolveView(role, view);

  const lowStock = stats?.lowStock ?? [];
  const expirySoon = stats?.expirySoon ?? [];
  const lowBalanceThreshold = settings?.lowBalanceThreshold ?? 100;
  const lowBalanceOn = settings?.lowBalanceAlert ?? true;
  const memberLowBalance = React.useMemo(() => {
    if (!lowBalanceOn) return [];
    return (members ?? [])
      .filter((m) => m.status === "active" && m.balance < lowBalanceThreshold)
      .sort((a, b) => a.balance - b.balance)
      .slice(0, 8);
  }, [members, lowBalanceOn, lowBalanceThreshold]);
  const notifCount = lowStock.length + expirySoon.length + memberLowBalance.length;

  const appName = (settings?.appName ?? "").trim() || "PNG Shop";
  const helpPhone = (settings?.helpPhone ?? "").trim();

  const handleLogout = async () => {
    if (pendingLogout) return;
    setPendingLogout(true);
    try {
      await apiPost<{ success: boolean }>("/api/auth/logout", {});
      toast.success("ออกจากระบบแล้ว");
      router.refresh();
    } catch (err) {
      toast.error("ออกจากระบบไม่สำเร็จ", {
        description: err instanceof Error ? err.message : "เกิดข้อผิดพลาดบางอย่าง",
      });
    } finally {
      setPendingLogout(false);
    }
  };

  const handleNavigate = (next: View) => {
    setView(next);
    setSidebarOpen(false);
  };

  const renderView = () => {
    switch (safeView) {
      case "dashboard":
        return <DashboardPage role={role} userName={user.displayName} onNavigate={handleNavigate} />;
      case "pos":
        return <PosPage userName={user.displayName} />;
      case "stock":
        return <StockPage />;
      case "shift":
        return <ShiftPage />;
      case "members":
        return <MembersPage role={role} userName={user.displayName} />;
      case "reports":
        return <ReportsPage />;
      case "settings":
        if (!isAdminRole(role)) return <PendingModulePlaceholder title="ตั้งค่า" />;
        return <SettingsPage role={role} />;
      case "logs":
        if (!isAdminRole(role)) return <PendingModulePlaceholder title="ระบบ Log" />;
        return <LogsPage />;
      case "users":
        if (!isAdminRole(role)) return <PendingModulePlaceholder title="ผู้ใช้ระบบ" />;
        return <UsersPage currentUserId={user.id} currentRole={role} />;
      default:
        return null;
    }
  };

  const mainNavItems = NAV_ITEMS.filter((n) => n.section === "main");
  const adminNavItems = NAV_ITEMS.filter((n) => n.section === "admin");
  const canSeeAdmin = isAdminRole(role);

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Desktop sidebar — hidden on <lg */}
      <aside className="hidden lg:flex w-[266px] shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <SidebarContent
          appName={appName}
          user={user}
          role={role}
          view={safeView}
          onNavigate={handleNavigate}
          onLogout={handleLogout}
          pendingLogout={pendingLogout}
          mainNavItems={mainNavItems}
          adminNavItems={adminNavItems}
          canSeeAdmin={canSeeAdmin}
          lowStockCount={lowStock.length}
          helpPhone={helpPhone}
        />
      </aside>

      {/* Mobile sidebar — Sheet */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">เมนูนำทาง</SheetTitle>
          <SidebarContent
            appName={appName}
            user={user}
            role={role}
            view={safeView}
            onNavigate={handleNavigate}
            onLogout={handleLogout}
            pendingLogout={pendingLogout}
            mainNavItems={mainNavItems}
            adminNavItems={adminNavItems}
            canSeeAdmin={canSeeAdmin}
            lowStockCount={lowStock.length}
            helpPhone={helpPhone}
            onCloseMobile={() => setSidebarOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex h-[72px] items-center gap-3 px-4 sm:px-[38px]">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="เปิดเมนูนำทาง"
            >
              <Menu className="size-5" aria-hidden="true" />
            </Button>
            <nav aria-label="เบรดครัมบ์" className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-muted-foreground truncate hidden sm:inline">{appName}</span>
              <span className="text-muted-foreground/50 hidden sm:inline">/</span>
              <span className="font-medium truncate">{NAV_ITEMS.find((n) => n.id === safeView)?.label ?? "ภาพรวม"}</span>
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="hidden md:inline-flex w-56 justify-start text-muted-foreground"
                onClick={() => setSearchOpen(true)}
                aria-label="เปิดค้นหา (⌘ K)"
              >
                <Search className="size-4" aria-hidden="true" />
                <span className="truncate">ค้นหาเมนูหรือรายการ…</span>
                <kbd className="ml-auto text-[10px] rounded border bg-muted px-1 py-0.5 text-muted-foreground">⌘K</kbd>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setSearchOpen(true)}
                aria-label="ค้นหา"
              >
                <Search className="size-5" aria-hidden="true" />
              </Button>

              {/* Notif bell */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="relative"
                    aria-label={notifCount > 0 ? `การแจ้งเตือน ${notifCount} รายการ` : "การแจ้งเตือน"}
                  >
                    <Bell className="size-5" aria-hidden="true" />
                    {notifCount > 0 ? (
                      <span
                        className={cn(
                          "absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full px-1 text-[10px] font-semibold grid place-items-center",
                          notifCount > 0 ? "bg-red-500 text-white" : "bg-muted text-muted-foreground",
                        )}
                      >
                        {notifCount > 99 ? "99+" : notifCount}
                      </span>
                    ) : null}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel className="flex items-center justify-between">
                    <span>การแจ้งเตือน</span>
                    {notifCount > 0 ? (
                      <Badge variant="secondary" className="font-mono">{notifCount}</Badge>
                    ) : null}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {notifCount === 0 ? (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      <Bell className="mx-auto size-6 mb-2 opacity-40" aria-hidden="true" />
                      <p className="font-medium text-foreground">ไม่มีการแจ้งเตือน</p>
                      <p className="text-xs">สต็อก · วันหมดอายุ · ยอดสมาชิกปกติดี</p>
                    </div>
                  ) : (
                    <div className="max-h-80 overflow-y-auto">
                      {lowStock.length > 0 ? (
                        <>
                          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
                            สินค้าใกล้หมดสต็อก
                          </p>
                          {lowStock.slice(0, 4).map((row) => (
                            <DropdownMenuItem
                              key={`low-${row.id}`}
                              className="flex items-start gap-2 py-2"
                              onClick={() => handleNavigate("stock")}
                            >
                              <span className="mt-1.5 size-1.5 rounded-full bg-red-500 shrink-0" aria-hidden="true" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{row.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  เหลือ {row.stock} {row.unit} · ต่ำกว่าจุดสั่งซื้อ {row.reorderPoint}
                                </p>
                              </div>
                            </DropdownMenuItem>
                          ))}
                        </>
                      ) : null}
                      {expirySoon.length > 0 ? (
                        <>
                          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                            ใกล้หมดอายุ
                          </p>
                          {expirySoon.slice(0, 4).map((row) => (
                            <DropdownMenuItem
                              key={`exp-${row.lotId}`}
                              className="flex items-start gap-2 py-2"
                              onClick={() => handleNavigate("stock")}
                            >
                              <span className="mt-1.5 size-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{row.productName}</p>
                                <p className="text-xs text-muted-foreground">
                                  หมดอายุ {row.expiryLabel} · เหลือ {row.qty}
                                </p>
                              </div>
                            </DropdownMenuItem>
                          ))}
                        </>
                      ) : null}
                      {memberLowBalance.length > 0 ? (
                        <>
                          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                            สมาชิกยอดคงเหลือต่ำ
                          </p>
                          {memberLowBalance.slice(0, 4).map((row) => (
                            <DropdownMenuItem
                              key={`bal-${row.memberNumber}`}
                              className="flex items-start gap-2 py-2"
                              onClick={() => handleNavigate("members")}
                            >
                              <span
                                className={cn(
                                  "mt-1.5 size-1.5 rounded-full shrink-0",
                                  row.balance < 0 ? "bg-red-500" : "bg-amber-500",
                                )}
                                aria-hidden="true"
                              />
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">
                                  {[row.prename, row.firstName, row.lastName].filter(Boolean).join(" ")}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {row.memberNumber} · คงเหลือ {money(row.balance)}
                                </p>
                              </div>
                            </DropdownMenuItem>
                          ))}
                        </>
                      ) : null}
                    </div>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleNavigate("stock")}>
                    ดูสต็อกทั้งหมด →
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Profile pill */}
              <div className="flex items-center gap-2 pl-2 pr-1 sm:pl-3 sm:pr-2 border-l">
                <span
                  className={cn(
                    "size-7 rounded-full grid place-items-center text-xs font-semibold",
                    roleChipClass(role),
                  )}
                  aria-hidden="true"
                >
                  {user.displayName.slice(0, 1) || "ผู้"}
                </span>
                <div className="hidden sm:flex flex-col text-left leading-none">
                  <span className="text-xs font-medium">{user.displayName}</span>
                  <span className="text-[10px] text-muted-foreground">{roleLabel(role)}</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-[38px] py-[30px]">
          <div key={safeView}>
            {renderView()}
          </div>
        </main>

        <footer className="mt-auto border-t bg-card">
          <div className="px-4 sm:px-[38px] py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="font-medium text-foreground">{appName}</span>
              <span>· ระบบร้านค้าสวัสดิการ</span>
            </span>
            <div className="flex items-center gap-3">
              {helpPhone ? (
                <span className="flex items-center gap-1.5">
                  <CircleHelp className="size-3.5" aria-hidden="true" />
                  ศูนย์ช่วยเหลือ {helpPhone}
                </span>
              ) : null}
              <span>⚡ Powered by <b className="text-foreground">PNG TEAM</b></span>
            </div>
          </div>
        </footer>
        <FloatingVersionBadge />
      </div>

      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={(v) => {
          handleNavigate(v);
          setSearchOpen(false);
        }}
      />
    </div>
  );
}

interface SidebarContentProps {
  appName: string;
  user: AppShellUser;
  role: string;
  view: View;
  onNavigate: (v: View) => void;
  onLogout: () => void;
  pendingLogout: boolean;
  mainNavItems: typeof NAV_ITEMS;
  adminNavItems: typeof NAV_ITEMS;
  canSeeAdmin: boolean;
  lowStockCount: number;
  helpPhone: string;
  onCloseMobile?: () => void;
}

function SidebarContent({
  appName,
  user,
  role,
  view,
  onNavigate,
  onLogout,
  pendingLogout,
  mainNavItems,
  adminNavItems,
  canSeeAdmin,
  lowStockCount,
  helpPhone,
  onCloseMobile,
}: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Brand */}
      <div className="flex items-center gap-[11px] px-[10px] pt-[25px] pb-[25px]">
        <div className="size-[38px] rounded-[12px] bg-[#007a55] text-white grid place-items-center font-bold text-xl shadow-[0_5px_12px_rgba(35,124,97,.2)]">
          {brandInitial(appName)}
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <b className="text-base font-semibold tracking-tight truncate text-[#29241b]">{appName}</b>
          <small className="text-[11px] text-[#757869]">Welfare Store</small>
        </div>
        {onCloseMobile ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden"
            onClick={onCloseMobile}
            aria-label="ปิดเมนู"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {/* Role card */}
      <div className="mx-[5px] mb-[22px] bg-[#f1f7f4] border border-[#e2eee9] rounded-[12px] p-[10px]">
        <div className="flex items-center gap-[9px]">
          <div
            className={cn(
              "size-[31px] rounded-full grid place-items-center text-sm font-bold bg-[#e2c9be] text-[#6d4739]",
              roleChipClass(role),
            )}
            aria-hidden="true"
          >
            {user.displayName.slice(0, 1) || "ผู้"}
          </div>
          <div className="min-w-0">
            <b className="text-xs font-medium block truncate text-[#29241b]">{user.displayName}</b>
            <span className="text-[11px] text-[#6d6157] block mt-[2px]">{roleLabel(role)}</span>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="เมนูนำทาง">
        <p className="px-[10px] py-1 text-[11px] font-medium text-[#838776]">
          เมนูหลัก
        </p>
        <ul className="space-y-0.5">
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "w-full flex items-center gap-[11px] px-[10px] py-[10px] rounded-[11px] text-sm transition-all",
                    active
                      ? "text-[#007a55] bg-[#eaf5f1] shadow-[inset_3px_0_0_#007a55]"
                      : "text-[#747868] hover:bg-[#f1f6f4] hover:text-[#007a55]",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0"><b className="block text-[13px] font-semibold leading-tight truncate">{item.label}</b><small className="block text-[11px] text-[#797c6d] mt-[1px] truncate">{item.caption}</small></span>
                  {item.id === "stock" && lowStockCount > 0 ? (
                    <span className="ml-auto inline-flex items-center justify-center min-w-[21px] h-[21px] px-1 rounded-full bg-[#fff0df] text-[#b87827] text-[11px] font-semibold">
                      {lowStockCount > 99 ? "99+" : lowStockCount}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        {canSeeAdmin ? (
          <>
            <p className="px-2 py-1 mt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              สำหรับผู้บริหาร
            </p>
            <ul className="space-y-0.5">
              {adminNavItems.map((item) => {
                const Icon = item.icon;
                const active = view === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      className={cn(
                        "w-full flex items-center gap-[11px] px-[10px] py-[10px] rounded-[11px] text-sm transition-all",
                        active
                          ? "text-[#007a55] bg-[#eaf5f1] shadow-[inset_3px_0_0_#007a55]"
                          : "text-[#747868] hover:bg-[#f1f6f4] hover:text-[#007a55]",
                      )}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon className="size-5 shrink-0" aria-hidden="true" />
                      <span className="flex-1 min-w-0"><b className="block text-[13px] font-semibold leading-tight truncate">{item.label}</b><small className="block text-[11px] text-[#797c6d] mt-[1px] truncate">{item.caption}</small></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="mt-3 px-2.5 py-2 rounded-md border border-dashed border-neutral-200 text-[11px] text-muted-foreground flex items-center gap-2">
            <Settings2 className="size-3.5" aria-hidden="true" />
            <span>สำหรับผู้บริหารถูกซ่อน</span>
          </div>
        )}
      </nav>

      {/* Sidebar footer */}
      <div className="border-t px-3 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#848876]">
            v1.0.0 · ระบบร้านค้าสวัสดิการ
          </span>
          {helpPhone ? (
            <span className="truncate max-w-28 text-muted-foreground" title={helpPhone}>{helpPhone}</span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
          onClick={onLogout}
          disabled={pendingLogout}
        >
          <LogOut className="size-4" aria-hidden="true" />
          {pendingLogout ? "กำลังออก…" : "ออกจากระบบ"}
        </Button>
      </div>
    </div>
  );
}

// Keep these exports referenced so the bundler doesn't tree-shake the imports
// in environments where dead-code elimination runs over dynamic() catch().
void ADMIN_ROLES;
void canAccessView;
