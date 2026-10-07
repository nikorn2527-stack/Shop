/**
 * AppShell — the main authenticated shell (sidebar + topbar + content area +
 * view switching). Extracted from `client/src/pages/Home.tsx` as part of the
 * V2 refactor (Step V2-B) so Home.tsx becomes a thin auth-gate that delegates
 * to this layout.
 *
 * View components that still live inside Home.tsx (Members / Reports /
 * Settings / Logs) are passed in via the `viewComponents` prop to avoid a
 * circular import. As subsequent V2 steps extract those views into their own
 * files, AppShell will import them directly and the `viewComponents` prop can
 * be removed.
 */
import type { ComponentType } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CostProfit from "../pages/CostProfit";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  StockReceive,
  Pause,
  Plus,
  ScanLine,
  Search,
  Settings2,
  Sparkles,
  TrendingDown,
  UserCog,
  UserPlus,
  UsersRound,
  X,
} from "@/lib/icons";
import { pendingStockAlerts } from "@/lib/pendingAlerts";
import { useEditionStatus } from "@/components/EditionUi";
import { GlobalSearch } from "@/components/GlobalSearch";
import { SharedSearchHost, SharedSearchProvider } from "@/components/SharedSearch";
import { KeyboardShortcutsOverlay, ShortcutsFab } from "@/components/KeyboardShortcutsOverlay";
import { Dashboard } from "../pages/Dashboard";
import { Pos } from "../pages/Pos";
import { Stock } from "../pages/Stock";
import { Users } from "../pages/Users";
import { trpc } from "@/lib/trpc";
import {
  applyPaperWidth,
  brandInitial,
  type BrandSettings,
} from "../theme";
import {
  canAccessView,
  isAdminRole,
  loadHeldBills,
  memberFullName,
  money,
  navItems,
  type Role,
  type View,
} from "../pages/pageData";
import { formatThaiDate } from "../pages/viewFormat";
import type { SettingsTab } from "../pages/shared";
import type { User } from "../../../drizzle/schema";

/** Max member rows shown in the bell dropdown before the "+N รายการเพิ่มเติม" hint. */
const MEMBER_NOTIF_LIMIT = 6;

/**
 * View components defined inside Home.tsx (Members / Reports / Settings / Logs)
 * that AppShell renders. Passed in as a prop so AppShell doesn't have to import
 * Home.tsx (which would create a circular import: Home imports AppShell).
 */
export type AppShellViewComponents = {
  Members: ComponentType<{
    role: Role;
    userName: string;
    focusMemberNumber: string | null;
    onFocusMemberConsumed: () => void;
  }>;
  Reports: ComponentType<{
    financialOverview?: boolean;
    focusBill: string | null;
    onFocusBillConsumed: () => void;
    role: Role;
    userName: string;
  }>;
  Settings: ComponentType<{
    setView: (view: View) => void;
    role: Role;
    initialTab?: SettingsTab;
  }>;
  Logs: ComponentType;
};

export type AppShellProps = {
  user: User;
  brand?: BrandSettings | null | undefined;
  onLogout: () => void;
  viewComponents: AppShellViewComponents;
};

export function AppShell({
  user,
  brand,
  onLogout,
  viewComponents: { Members, Reports, Settings, Logs },
}: AppShellProps) {
  const [activeView, setActiveView] = useState<View>("dashboard");
  // ROUND 61 — ป้ายเวอร์ชัน sidebar กดแล้วพาไปแท็บ “เวอร์ชันและลิขสิทธิ์” โดยตรง
  const [settingsFocusTab, setSettingsFocusTab] = useState<SettingsTab | null>(
    null
  );
  const edition = useEditionStatus();
  const openEditionTab = () => {
    setSettingsFocusTab("edition");
    setActiveView("settings");
    setMobileNav(false);
  };
  const [mobileNav, setMobileNav] = useState(false);
  // PT-2 — sidebar collapse: icon-only mode (~64px). Default expanded on
  // desktop; the toggle sits beside the brand mark. Tooltips (title attr) on
  // every nav button show the label so collapsed mode stays usable.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // PT-2 — "จัดการระบบ" admin group (settings / users / logs) is collapsed
  // by default; an admin taps the group header to expand it inline. Keeps the
  // sidebar at ≤6 top-level items (5 primary + 1 group).
  const [adminGroupOpen, setAdminGroupOpen] = useState(false);
  const [posShortcut, setPosShortcut] = useState("");
  // POS rail badge: parked-bill count, seeded from this device's storage and
  // kept in sync by the "pos-held" events Pos dispatches whenever they change.
  const [posHeldCount, setPosHeldCount] = useState(
    () => loadHeldBills().length
  );
  useEffect(() => {
    const onHeld = (event: Event) =>
      setPosHeldCount((event as CustomEvent<number>).detail ?? 0);
    window.addEventListener("pos-held", onHeld);
    return () => window.removeEventListener("pos-held", onHeld);
  }, []);
  // ROUND 73 — ปุ่มลัด F9 ที่ POS: สั่งเปิดเมนูหลัก (ภาพรวมระบบ) จากแป้นพิมพ์เหมือนกดปุ่ม
  // "เมนู" ท้ายรางซ้าย — Pos dispatch มาที่นี่เพราะ activeView อยู่ที่ Home (เกิด pos-rail เดิม)
  useEffect(() => {
    const onPosOpenMenu = () => setActiveView("dashboard");
    window.addEventListener("pos-open-menu", onPosOpenMenu);
    return () => window.removeEventListener("pos-open-menu", onPosOpenMenu);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingProductId, setPendingProductId] = useState<number | null>(null);
  const [pendingMemberNumber, setPendingMemberNumber] = useState<string | null>(
    null
  );
  const [pendingBillNumber, setPendingBillNumber] = useState<string | null>(
    null
  );
  // Round 32-16 — ลงทะเบียนสมาชิกใหม่อยู่ที่ POS จุดเดียว (F6): ปุ่มบนรางซ้าย
  // ของ POS เปิดโมดัลที่หน้าขายสินค้าเอง ไม่ต้องออกจากหน้าร้านอีกต่อไป
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => onLogout(),
  });
  // Stock rows feed both the bell dropdown and the sidebar nav badge.
  // Server statuses (listStockRows): "สต็อกต่ำ" = product stock ≤ reorder
  // point, "ใกล้หมดอายุ" = lot expiry within 30 days ("ปิดการขาย" excluded).
  const stockRowsQuery = trpc.stock.rows.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { lowStock, expiring } = useMemo(() => pendingStockAlerts(stockRowsQuery.data ?? []), [stockRowsQuery.data]);
  // Member low-balance alerts — driven by the real settings (ตั้งค่า → การแจ้งเตือน:
  // lowBalanceAlert + lowBalanceThreshold) and the member list. Mirrors the stock
  // poll cadence so the bell stays fresh after wallet top-ups/withdrawals too.
  // Same no-input query as the Members view, so both share one cache entry.
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const memberRowsQuery = trpc.member.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  // ROUND 42 (ข้อ 4) — ขนาดกระดาษสลิปจาก settings มีผลทันทีทุกครั้งที่เข้าแอป
  // (ทุก view — พิมพ์ใบเสร็จ/สลิปได้โดยไม่ต้องเปิดหน้าตั้งค่าก่อน)
  useEffect(() => {
    applyPaperWidth(settingsQuery.data?.receiptPaperWidth);
  }, [settingsQuery.data?.receiptPaperWidth]);
  const lowBalanceAlertOn = settingsQuery.data?.lowBalanceAlert ?? true;
  const lowBalanceThreshold = settingsQuery.data?.lowBalanceThreshold ?? 100;
  const memberLowBalance = useMemo(() => {
    if (!lowBalanceAlertOn) return [];
    return (memberRowsQuery.data ?? [])
      .filter(
        member =>
          member.status === "active" && member.balance < lowBalanceThreshold
      )
      .sort((a, b) => a.balance - b.balance); // lowest (most negative) first
  }, [memberRowsQuery.data, lowBalanceAlertOn, lowBalanceThreshold]);
  const memberLowBalanceShown = memberLowBalance.slice(0, MEMBER_NOTIF_LIMIT);
  const memberNegative = memberLowBalanceShown.filter(
    member => member.balance < 0
  );
  const memberLowPositive = memberLowBalanceShown.filter(
    member => member.balance >= 0
  );
  const memberLowBalanceHidden =
    memberLowBalance.length - memberLowBalanceShown.length;
  // Header count pill + bell red dot include member alerts; the sidebar
  // nav-badge on สต็อกสินค้า intentionally stays stock-only.
  const notifCount =
    lowStock.length + expiring.length + memberLowBalance.length;
  // Persistent conditions live in the bell; transaction feedback stays in each workflow.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(current => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  // Close the bell dropdown on outside click and Escape.
  useEffect(() => {
    if (!notifOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        notifRef.current &&
        !notifRef.current.contains(event.target) &&
        !(event.target instanceof Element && event.target.closest('.notif-dropdown'))
      )
        setNotifOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotifOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [notifOpen]);
  // Role/profile now come from the login session (auth.me) — no client switcher.
  // ROUND 36 — dev มาผ่าน appRole บน ctx.user (drizzle role = admin + appRole = dev)
  const role: Role =
    user.appRole === "dev" ? "dev" : user.role === "admin" ? "admin" : "staff";
  const profileName = user.name ?? "ผู้ใช้ระบบ";
  const profileAvatar = profileName.slice(0, 1);
  // ROUND 25 — แบรนด์ที่ผู้บริหารตั้งเอง (ตั้งค่า → แบรนด์และธีม)
  const appName = (brand?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const appLogo = brand?.appLogo ?? "";
  // ROUND 68 (user) — เบอร์ศูนย์ช่วยเหลือจาก settings แสดงท้ายหน้าจอ (ว่าง = ซ่อนแถบนี้)
  const helpPhone = (settingsQuery.data?.helpPhone ?? "").trim();
  // ROUND 75 (user) — ตั้งค่าเมนูลัดหน้าร้าน: ปุ่มที่ปิดไว้ซ่อนจากรางซ้าย POS ทันที
  const railHidden = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(
        settingsQuery.data?.posRailHidden || "[]"
      );
      return new Set<string>(
        Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === "string")
          : []
      );
    } catch {
      return new Set<string>();
    }
  }, [settingsQuery.data?.posRailHidden]);
  const safeView = canAccessView(role, activeView) ? activeView : "dashboard";
  const pageTitle =
    navItems.find(item => item.id === safeView)?.label ??
    (safeView === "settings"
      ? "ตั้งค่า"
      : safeView === "logs"
        ? "ประวัติระบบ"
        : safeView === "users"
          ? "ผู้ใช้ระบบ"
          : "ภาพรวม");
  const logout = () => {
    if (!logoutMutation.isPending) logoutMutation.mutate();
  };
  const notificationPanel = (
            <div className="notif-wrap" ref={notifRef}>
              <button
                type="button"
                className={`top-icon notif-bell${notifCount > 0 ? " has-alert" : ""}`}
                title={
                  notifCount > 0
                    ? `การแจ้งเตือน · ${notifCount} รายการที่ต้องจัดการ`
                    : "การแจ้งเตือน"
                }
                aria-label={
                  notifCount > 0
                    ? `การแจ้งเตือน ${notifCount} รายการ`
                    : "การแจ้งเตือน"
                }
                aria-haspopup="menu"
                aria-expanded={notifOpen}
                onClick={() => setNotifOpen(current => !current)}
              >
                <Bell size={18} /><span className="shell-notification-label">แจ้งเตือน</span>
                {notifCount > 0 && (
                  <span className="notif-badge" aria-hidden="true">
                    {notifCount > 99 ? "99+" : notifCount}
                  </span>
                )}
              </button>
              {notifOpen && createPortal(
                <div
                  className="notif-dropdown"
                  role="menu"
                  aria-label="การแจ้งเตือน"
                >
                  <div className="notif-header"><button type="button" className="notification-close" aria-label="ปิดแจ้งเตือน" onClick={() => setNotifOpen(false)}>×</button>
                    <b>การแจ้งเตือน</b>
                    {notifCount > 0 && (
                      <span className="notif-count">{notifCount}</span>
                    )}
                  </div>
                  {notifCount === 0 ? (
                    <div className="notif-empty">
                      <Bell size={22} />
                      <b>ไม่มีการแจ้งเตือน</b>
                      <small>สต็อก · วันหมดอายุ · ยอดสมาชิกปกติดี</small>
                    </div>
                  ) : (
                    <div className="notif-scroll">
                      {lowStock.length > 0 && (
                        <div className="notif-section-label">
                          <i className="notif-dot red" />
                          สินค้าใกล้หมดสต็อก
                        </div>
                      )}
                      {lowStock.map(row => (
                        <button
                          type="button"
                          className="notif-row"
                          role="menuitem"
                          key={`low-${row.id}`}
                          onClick={() => {
                            setNotifOpen(false);
                            setActiveView("stock");
                          }}
                        >
                          <div>
                            <b>{row.name}</b>
                            <small>
                              เหลือ {row.stock} {row.unit} · ต่ำกว่าจุดสั่งซื้อ{" "}
                              {row.reorderPoint}
                            </small>
                          </div>
                          <i className="notif-dot red" />
                        </button>
                      ))}
                      {expiring.length > 0 && (
                        <div className="notif-section-label">
                          <i className="notif-dot amber" />
                          ใกล้หมดอายุ
                        </div>
                      )}
                      {expiring.map(row => (
                        <button
                          type="button"
                          className="notif-row"
                          role="menuitem"
                          key={`exp-${row.id}`}
                          onClick={() => {
                            setNotifOpen(false);
                            setActiveView("stock");
                          }}
                        >
                          <div>
                            <b>{row.name}</b>
                            <small>
                              {row.expiry
                                ? `หมดอายุ ${formatThaiDate(row.expiry)}`
                                : "ตรวจสอบวันหมดอายุ"}
                            </small>
                          </div>
                          <i className="notif-dot amber" />
                        </button>
                      ))}
                      {memberNegative.length > 0 && (
                        <div className="notif-section-label">
                          <i className="notif-dot red" />
                          สมาชิกยอดคงเหลือติดลบ
                        </div>
                      )}
                      {memberNegative.map(member => (
                        <button
                          type="button"
                          className="notif-row member-row"
                          role="menuitem"
                          key={`neg-${member.memberNumber}`}
                          onClick={() => {
                            setNotifOpen(false);
                            setPendingMemberNumber(member.memberNumber);
                            setActiveView("members");
                          }}
                        >
                          <div>
                            <b>{memberFullName(member)}</b>
                            <small>
                              ยอดติดลบ{" "}
                              <b className="amount-negative">
                                {money(member.balance)}
                              </b>
                            </small>
                          </div>
                          <i className="notif-dot red" />
                        </button>
                      ))}
                      {memberLowPositive.length > 0 && (
                        <div className="notif-section-label">
                          <i className="notif-dot amber" />
                          สมาชิกยอดคงเหลือต่ำ
                        </div>
                      )}
                      {memberLowPositive.map(member => (
                        <button
                          type="button"
                          className="notif-row member-row"
                          role="menuitem"
                          key={`lowbal-${member.memberNumber}`}
                          onClick={() => {
                            setNotifOpen(false);
                            setPendingMemberNumber(member.memberNumber);
                            setActiveView("members");
                          }}
                        >
                          <div>
                            <b>{memberFullName(member)}</b>
                            <small>
                              คงเหลือ{" "}
                              <b className="amount-low">
                                {money(member.balance)}
                              </b>{" "}
                              · ต่ำกว่า {money(lowBalanceThreshold)}
                            </small>
                          </div>
                          <i className="notif-dot amber" />
                        </button>
                      ))}
                      {memberLowBalanceHidden > 0 && (
                        <div className="notif-more">
                          + {memberLowBalanceHidden} รายการเพิ่มเติม
                        </div>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    className="notif-footer"
                    role="menuitem"
                    onClick={() => {
                      setNotifOpen(false);
                      setActiveView("stock");
                    }}
                  >
                    ดูสต็อกทั้งหมด →
                  </button>
                </div>
              , document.body)}
            </div>
  );

  return (
    <SharedSearchProvider>
    <div
      className={safeView === "pos" ? "app-shell pos-terminal" : "app-shell"}
    >
      {safeView === "pos" && (
        <aside className="pos-rail" aria-label="เมนูด่วนหน้าร้าน">
          <div className="rail-brand" title={appName}>
            {appLogo ? (
              <img className="brand-logo" src={appLogo} alt={appName} />
            ) : (
              <span className="brand-mark">{brandInitial(appName)}</span>
            )}
            <div className="rail-brand-text"><b>{appName}</b><small>Welfare Store</small></div>
          </div>
          {!railHidden.has("scan") || !railHidden.has("customer") || !railHidden.has("hold") ? <div className="pos-rail-group"><span className="pos-rail-group-label">งานขาย</span>
          {!railHidden.has("scan") && (
            <button
              type="button"
              className="rail-btn rail-scan"
              title="โฟกัสช่องสแกนบาร์โค้ด — พร้อมรับค่าเสมอ (F8)"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("pos-rail", { detail: "scan" })
                )
              }
            >
              <ScanLine size={20} />
              <b>สแกน</b>
              <kbd>F8</kbd>
            </button>
          )}
          {!railHidden.has("customer") && (
            <button
              type="button"
              className="rail-btn rail-customer"
              title="เลือกลูกค้า / สมาชิกสำหรับบิลนี้ (F1)"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("pos-rail", { detail: "member" })
                )
              }
            >
              <UsersRound size={20} />
              <b>ลูกค้า</b>
              <kbd>F1</kbd>
            </button>
          )}
          {!railHidden.has("hold") && (
            <button
              type="button"
              className="rail-btn rail-hold"
              title="พักบิลปัจจุบันไว้ แล้วเริ่มบิลใหม่ — เรียกคืนได้จากแถบใต้ช่องสแกน (F5)"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("pos-rail", { detail: "hold" })
                )
              }
            >
              <Pause size={20} />
              <b>พักบิล</b>
              <kbd>F5</kbd>
              {posHeldCount > 0 && (
                <span className="rail-badge">{posHeldCount}</span>
              )}
            </button>
          )}
          </div> : null}
          {!railHidden.has("deposit") || !railHidden.has("withdraw") || !railHidden.has("register") || !railHidden.has("limit") ? <div className="pos-rail-group"><span className="pos-rail-group-label">งานสมาชิก</span>
          {!railHidden.has("deposit") && (
            <button
              type="button"
              className={`rail-btn rail-deposit${posShortcut === "เติมเงิน" ? " active" : ""}`}
              title="เติมเงินเข้าบัญชีสมาชิก (F2)"
              onClick={() =>
                setPosShortcut(posShortcut === "เติมเงิน" ? "" : "เติมเงิน")
              }
            >
              <ArrowDownToLine size={20} />
              <b>เติมเงิน</b>
              <kbd>F2</kbd>
            </button>
          )}
          {!railHidden.has("withdraw") && (
            <button
              type="button"
              className={`rail-btn rail-withdraw${posShortcut === "ถอนเงิน" ? " active" : ""}`}
              title="ถอนเงินจากบัญชีสมาชิก (F3)"
              onClick={() =>
                setPosShortcut(posShortcut === "ถอนเงิน" ? "" : "ถอนเงิน")
              }
            >
              <ArrowUpFromLine size={20} />
              <b>ถอนเงิน</b>
              <kbd>F3</kbd>
            </button>
          )}
          {!railHidden.has("register") && (
            <button
              type="button"
              className="rail-btn rail-register"
              title="ลงทะเบียนสมาชิกใหม่ + พิมพ์บัตร — ทำที่นี่ที่เดียว (F6)"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("pos-rail", { detail: "register" })
                )
              }
            >
              <UserPlus size={20} />
              <b>สมาชิกใหม่</b>
              <kbd>F6</kbd>
            </button>
          )}
          {!railHidden.has("limit") && <button type="button" className="rail-btn rail-limit" title="ขอลดวงเงินซื้อสินค้าต่อวัน — รอผู้บริหารอนุมัติ" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "limit" }))}><TrendingDown size={20} /><b>ขอลดวงเงิน</b></button>}
          </div> : null}
          {!railHidden.has("special") || !railHidden.has("receive") || !railHidden.has("add") ? <details className="pos-rail-more"><summary>งานอื่น</summary><div className="pos-rail-group">
          {!railHidden.has("special") && (
            <button
              type="button"
              className={`rail-btn rail-special${posShortcut === "สินค้าไม่ระบุตายตัว" ? " active" : ""}`}
              title="เพิ่มรายการพิเศษ — ของสั่ง ค่าบริการ (F4)"
              onClick={() => {
                if (edition.status?.has("specialOrders"))
                  setPosShortcut(
                    posShortcut === "สินค้าไม่ระบุตายตัว"
                      ? ""
                      : "สินค้าไม่ระบุตายตัว"
                  );
                else openEditionTab();
              }}
            >
              <Sparkles size={20} />
              <b>รายการพิเศษ</b>
              <kbd>F4</kbd>
            </button>
          )}
          {!railHidden.has("receive") && (
            <button
              type="button"
              className="rail-btn rail-inventory"
              title="รับเข้าสินค้าจากหน้า POS โดยตรง (F9)"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("pos-rail", { detail: "receive" })
                )
              }
            >
              <StockReceive size={20} weight="bold" />
              <b>รับเข้าสินค้า</b>
              <kbd>F9</kbd>
            </button>
          )}
          {!railHidden.has("add") && (
            <button
              type="button"
              className="rail-btn rail-add"
              title="เพิ่มสินค้าใหม่จากหน้า POS โดยตรง (F10)"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("pos-rail", { detail: "add" })
                )
              }
            >
              <Plus size={20} />
              <b>เพิ่มสินค้าใหม่</b>
              <kbd>F10</kbd>
            </button>
          )}
          </div></details> : null}
          <div className="shell-account-footer">
            {notificationPanel}
            <div className="profile-pill">
              <span className={`profile-avatar ${role}`}>{profileAvatar}</span>
              <div>
                <b>{profileName}</b>
                <small>
                  {role === "admin"
                    ? "ผู้บริหาร"
                    : role === "dev"
                      ? "ผู้พัฒนา"
                      : "เจ้าหน้าที่"}
                  {role === "dev" && <i className="dev-role-badge">ผู้พัฒนา</i>}
                </small>
              </div>
            </div>
<button type="button" className="outline-button shell-logout" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={logout} disabled={logoutMutation.isPending}><LogOut size={18} /><span>{logoutMutation.isPending ? "กำลังออก" : "ออกจากระบบ"}</span></button>
</div>
          <span className="rail-spacer" aria-hidden="true" />
          <button
            type="button"
            className="rail-btn rail-exit"
            title="เปิดเมนูหลัก — ภาพรวมระบบ (Esc)"
            onClick={() => setActiveView("dashboard")}
          >
            <LayoutDashboard size={20} />
            <b>เมนู</b>
            <kbd>Esc</kbd>
          </button>
        </aside>
      )}
      <aside
        className={`sidebar${mobileNav ? " open" : ""}${sidebarCollapsed ? " collapsed" : ""}${safeView === "pos" ? " pos-context" : ""}`}
      >
        <div className="brand">
          {appLogo ? (
            <img className="brand-logo" src={appLogo} alt={appName} />
          ) : (
            <div className="brand-mark">
              <span>{brandInitial(appName)}</span>
            </div>
          )}
          <div className="brand-text">
            <b>{appName}</b>
            <small>Welfare Store</small>
          </div>
          <button
            type="button"
            className="mobile-close"
            onClick={() => setMobileNav(false)}
            aria-label="ปิดเมนูด้านข้าง"
          >
            <X size={19} />
          </button>
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            title={sidebarCollapsed ? "ขยายเมนูด้านข้าง" : "ย่อเมนูด้านข้างเหลือไอคอน"}
            aria-label={sidebarCollapsed ? "ขยายเมนูด้านข้าง" : "ย่อเมนูด้านข้างเหลือไอคอน"}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        <div className="nav-group-label">หน้าร้าน / งานขาย</div>
        <nav>
          {[...navItems].sort((a, b) => Number(b.id === "pos") - Number(a.id === "pos")).map(({ id, label, caption, icon: Icon, tileColor }) => (
            <Fragment key={id}>
            {id === navItems.find(item => item.id !== "pos")?.id && <div className="nav-group-label">การบริหารจัดการ</div>}
            <button
              className={safeView === id ? "active" : ""}
              data-nav-item={id}
              key={id}
              title={`${label} — ${caption}`}
              onClick={() => {
                setActiveView(id);
                setMobileNav(false);
              }}
            >
              <Icon size={20} weight="duotone" />
              <b>{label}</b>
              {/* PT-2 — badges show ONLY when the user must take action.
                  Low stock → needs restocking; held bills → needs to resume.
                  Member/bill totals are pure data so they live on the page. */}
              {id === "stock" && lowStock.length > 0 && (
                <i className="nav-badge">{lowStock.length}</i>
              )}
              {id === "pos" && posHeldCount > 0 && (
                <i className="nav-badge">{posHeldCount}</i>
              )}
            </button>
            </Fragment>
          ))}
        </nav>
        {isAdminRole(role) ? (
          <div
            className={`nav-admin-section${sidebarCollapsed ? " collapsed" : ""}${adminGroupOpen ? " open" : ""}`}
          >
            {!sidebarCollapsed && (
              <button
                type="button"
                className="nav-group-toggle"
                onClick={() => setAdminGroupOpen((open) => !open)}
                aria-expanded={adminGroupOpen}
                title="จัดการระบบ — ตั้งค่า / ผู้ใช้ระบบ / ประวัติระบบ"
              >
                <Settings2 size={20} />
                <b>จัดการระบบ</b>
                <ChevronDown size={14} className="toggle-chevron" />
              </button>
            )}
            {(sidebarCollapsed || adminGroupOpen) && (
              <nav className="nav-group-children">
                <button
                  className={safeView === "settings" ? "active" : ""}
                  title="ตั้งค่า"
                  onClick={() => {
                    setActiveView("settings");
                    setMobileNav(false);
                  }}
                >
                  <Settings2 size={sidebarCollapsed ? 20 : 18} />
                  {!sidebarCollapsed && <b>ตั้งค่า</b>}
                </button>
                <button
                  className={safeView === "users" ? "active" : ""}
                  title="ผู้ใช้ระบบ"
                  onClick={() => {
                    setActiveView("users");
                    setMobileNav(false);
                  }}
                >
                  <UserCog size={sidebarCollapsed ? 20 : 18} />
                  {!sidebarCollapsed && <b>ผู้ใช้ระบบ</b>}
                </button>
                <button
                  className={safeView === "logs" ? "active" : ""}
                  title="ประวัติระบบ"
                  onClick={() => {
                    setActiveView("logs");
                    setMobileNav(false);
                  }}
                >
                  <Activity size={sidebarCollapsed ? 20 : 18} />
                  {!sidebarCollapsed && <b>ประวัติระบบ</b>}
                </button>
              </nav>
            )}
          </div>
        ) : (
          <div className="locked-nav">
            <LockKeyhole size={15} />
            <span>เมนูผู้บริหารถูกซ่อน</span>
          </div>
        )}
        <div className="sidebar-footer">{safeView !== "pos" && (<div className="shell-account-footer">
            {notificationPanel}
            <div className="profile-pill">
              <span className={`profile-avatar ${role}`}>{profileAvatar}</span>
              <div>
                <b>{profileName}</b>
                <small>
                  {role === "admin"
                    ? "ผู้บริหาร"
                    : role === "dev"
                      ? "ผู้พัฒนา"
                      : "เจ้าหน้าที่"}
                  {role === "dev" && <i className="dev-role-badge">ผู้พัฒนา</i>}
                </small>
              </div>
            </div>
<button type="button" className="outline-button shell-logout" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={logout} disabled={logoutMutation.isPending}><LogOut size={18} /><span>{logoutMutation.isPending ? "กำลังออก" : "ออกจากระบบ"}</span></button>
</div>)}</div>
      </aside>
      <main className="main-shell">
        <button type="button" className="mobile-menu workspace-menu" aria-label="เปิดเมนู" onClick={() => setMobileNav(true)}><Menu size={21} />{notifCount > 0 && <span className="workspace-alert-dot" />}</button>
            <SharedSearchHost fallback={
            <div
              className="global-search"
              role="button"
              tabIndex={0}
              aria-label="เปิดค้นหาเมนู สมาชิก หรือสินค้า"
              onClick={() => setSearchOpen(true)}
              onKeyDown={event => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSearchOpen(true);
                }
              }}
            >
              <Search size={17} />
              <span>ค้นหาเมนูหรือรายการ...</span>
              <kbd>⌘ K</kbd>
            </div>
            } />

        <div className="page-content" key={safeView}>
          {safeView === "dashboard" && (
            <Dashboard
              setView={setActiveView}
              role={role}
              userName={profileName}
            />
          )}
          {safeView === "pos" && (
            <Pos
              shortcut={posShortcut}
              setShortcut={setPosShortcut}
              role={role}
              userName={profileName}
              focusProductId={pendingProductId}
              onFocusProductConsumed={() => setPendingProductId(null)}
            />
          )}
          {safeView === "stock" && <Stock role={role} userName={profileName} />}
          {safeView === "members" && (
            <Members
              role={role}
              userName={profileName}
              focusMemberNumber={pendingMemberNumber}
              onFocusMemberConsumed={() => setPendingMemberNumber(null)}
            />
          )}
          {safeView === "profit" && <CostProfit />}
          {safeView === "reports" && (
            <Reports
              key={safeView}
              focusBill={pendingBillNumber}
              onFocusBillConsumed={() => setPendingBillNumber(null)}
              role={role}
              userName={profileName}
            />
          )}
          {safeView === "settings" && isAdminRole(role) && (
            <Settings
              setView={setActiveView}
              role={role}
              initialTab={settingsFocusTab ?? undefined}
            />
          )}
          {safeView === "users" && isAdminRole(role) && (
            <Users selfUsername={user.openId} />
          )}
          {safeView === "logs" && isAdminRole(role) && <Logs />}
        </div>
        <footer className="app-footer">
          <span className="footer-brand">
            {appName}
            <small> · ระบบร้านค้าสวัสดิการ</small>
          </span>
          <span className="footer-powered">
            ⚡ Powered by <b>PNG TEAM</b>
          </span>
          {helpPhone && (
            <span className="footer-help">
              <CircleHelp size={12} /> ศูนย์ช่วยเหลือ {helpPhone}
            </span>
          )}
        </footer>
        <GlobalSearch
          role={role}
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          onOpenProduct={productId => {
            setSearchOpen(false);
            setPendingProductId(productId);
            setActiveView("pos");
          }}
          onNavigate={view => {
            setActiveView(view);
            setSearchOpen(false);
            setMobileNav(false);
          }}
          onOpenMember={memberNumber => {
            setSearchOpen(false);
            setPendingMemberNumber(memberNumber);
            setActiveView("members");
          }}
          onOpenBill={orderNumber => {
            setSearchOpen(false);
            setPendingBillNumber(orderNumber);
            setActiveView("reports");
          }}
        />
        {/* QA-FEAT-2 — discoverable keyboard shortcuts overlay. Press ? anywhere. */}
        <KeyboardShortcutsOverlay />
        {/* FEAT-4 — Floating Action Button to trigger shortcuts overlay. Bottom-right. */}
        {safeView !== "pos" && <ShortcutsFab />}
      </main>
    </div>
    </SharedSearchProvider>
  );
}
