import { WorkflowDialog } from "./WorkflowDialog";
import type { ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  Activity,
  BarChart3,
  CreditCard,
  Package,
  PackageSearch,
  ReceiptText,
  Search,
  Settings2,
  ShoppingCart,
  UserCog,
  UserPlus,
  UsersRound,
} from "@/lib/icons";

import type { Role, View } from "@/pages/pageData";
import { canAccessView, isAdminRole, money, navItems } from "@/pages/pageData";
import { formatLastActivity } from "@/pages/viewFormat";
import { trpc } from "@/lib/trpc";

/**
 * Global ⌘K command palette. Searches quick actions, menus, members,
 * products and sale bills (bills are matched server-side on order/member
 * number via sales.list). Keyboard driven: ↑/↓ move the highlight
 * (wrap-around), Enter selects, Escape closes.
 */

type CommandSection = "การดำเนินการด่วน" | "เมนู" | "สมาชิก" | "สินค้า" | "บิลขาย";

type CommandItem = {
  key: string;
  section: CommandSection;
  icon: ComponentType<any>;
  label: string;
  sub: string;
  select: () => void;
};

const SECTION_ORDER: CommandSection[] = ["การดำเนินการด่วน", "เมนู", "สมาชิก", "สินค้า", "บิลขาย"];

export function GlobalSearch({ role, open, onClose, onNavigate, onOpenMember, onOpenCards, onOpenBill, onOpenProduct }: {
  role: Role;
  open: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
  onOpenMember: (memberNumber: string) => void;
  onOpenCards: () => void;
  onOpenBill: (orderNumber: string) => void;
  onOpenProduct: (productId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  // Data is only fetched while the palette is open.
  const productsQuery = trpc.product.list.useQuery(undefined, { enabled: open });
  const membersQuery = trpc.member.list.useQuery(undefined, { enabled: open });
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();
  // Bills are searched server-side (order number OR member number) once the
  // query is long enough to be meaningful.
  const billsQuery = trpc.sales.list.useQuery({ search: trimmed, limit: 6 }, { enabled: open && trimmed.length >= 2, placeholderData: (previous) => previous });
  const loading = trimmed !== "" && (productsQuery.isFetching || membersQuery.isFetching || billsQuery.isFetching);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlighted(0);
    }
  }, [open]);

  const quickActions = useMemo(() => {
    const actions: { key: string; label: string; icon: ComponentType<any>; view: View }[] = [
      { key: "quick-pos", label: "เปิดหน้าร้าน POS", icon: ShoppingCart, view: "pos" },
      { key: "quick-receive", label: "รับเข้าสินค้าและเพิ่มสินค้าใหม่", icon: PackageSearch, view: "receive" },
      { key: "quick-register", label: "ลงทะเบียนสมาชิก", icon: UserPlus, view: "members" },
      { key: "quick-reports", label: "ดูรายงานยอดขาย", icon: BarChart3, view: "reports" },
    ];
    if (isAdminRole(role)) {
      actions.push({ key: "quick-settings", label: "ตั้งค่าระบบ", icon: Settings2, view: "settings" });
      actions.push({ key: "quick-logs", label: "ระบบ Log", icon: Activity, view: "logs" });
    }
    return actions;
  }, [role]);

  const menuEntries = useMemo(() => {
    const extra: { id: View; label: string; caption: string; icon: ComponentType<any> }[] = [
      { id: "settings", label: "ตั้งค่า", caption: "ระบบและใบเสร็จ", icon: Settings2 },
      { id: "users", label: "ผู้ใช้ระบบ", caption: "จัดการสิทธิ์และบัญชี", icon: UserCog },
      { id: "logs", label: "ระบบ Log", caption: "ประวัติการใช้งาน", icon: Activity },
    ];
    const all = [...navItems, ...(isAdminRole(role) ? extra : [])];
    return all.filter((item) => canAccessView(role, item.id));
  }, [role]);

  const items = useMemo<CommandItem[]>(() => {
    if (!open) return [];
    const list: CommandItem[] = [];

    for (const action of quickActions) {
      if (needle === "" || action.label.toLowerCase().includes(needle)) {
        list.push({ key: action.key, section: "การดำเนินการด่วน", icon: action.icon, label: action.label, sub: "ทางลัดไปยังงานที่ใช้บ่อย", select: () => onNavigate(action.view) });
      }
    }
    if (needle === "" || "จัดการบัตรสมาชิก บัตรเปล่า บัตรหมุนเวียน ประวัติ".includes(needle)) {
      list.push({ key: "quick-cards", section: "การดำเนินการด่วน", icon: CreditCard, label: "จัดการบัตรสมาชิก", sub: "อยู่ในเมนูสมาชิกและบัญชี", select: onOpenCards });
    }
    for (const menu of menuEntries) {
      if (needle === "" || `${menu.label} ${menu.caption}`.toLowerCase().includes(needle)) {
        list.push({ key: `menu-${menu.id}`, section: "เมนู", icon: menu.icon, label: menu.label, sub: menu.caption, select: () => onNavigate(menu.id) });
      }
    }
    if (needle !== "") {
      for (const member of (membersQuery.data ?? []).slice(0, 400)) {
        const haystack = `${member.firstName} ${member.lastName} ${member.memberNumber}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
        list.push({ key: `member-${member.memberNumber}`, section: "สมาชิก", icon: UsersRound, label: `${member.firstName} ${member.lastName}`, sub: `${member.memberNumber} · ยอดคงเหลือ ${money(member.balance)} · ${member.type}`, select: () => onOpenMember(member.memberNumber) });
      }
      for (const product of productsQuery.data ?? []) {
        const haystack = `${product.name} ${product.sku} ${product.barcode ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
        list.push({ key: `product-${product.id}`, section: "สินค้า", icon: Package, label: product.name, sub: `${product.sku} · คงเหลือ ${product.stock} ${product.unit} · ${money(product.price)}`, select: () => onOpenProduct(product.id) });
      }
      if (trimmed.length >= 2) {
        for (const bill of billsQuery.data ?? []) {
          list.push({ key: `bill-${bill.orderNumber}`, section: "บิลขาย", icon: ReceiptText, label: bill.orderNumber, sub: `${money(bill.total)} · ${bill.memberName ?? "บุคคลทั่วไป"} · ${formatLastActivity(bill.createdAt)}`, select: () => onOpenBill(bill.orderNumber) });
        }
      }
    }

    // Cap the data-driven sections at 6 rows each (quick actions + menus stay complete).
    const capped: CommandItem[] = [];
    const counts = new Map<CommandSection, number>();
    for (const item of list) {
      if (item.section === "สมาชิก" || item.section === "สินค้า" || item.section === "บิลขาย") {
        const used = counts.get(item.section) ?? 0;
        if (used >= 6) continue;
        counts.set(item.section, used + 1);
      }
      capped.push(item);
    }
    return capped;
  }, [open, needle, trimmed, quickActions, menuEntries, membersQuery.data, productsQuery.data, billsQuery.data, onNavigate, onOpenMember, onOpenCards, onOpenBill, onOpenProduct]);

  useEffect(() => {
    setHighlighted((current) => (items.length === 0 ? 0 : Math.min(current, items.length - 1)));
  }, [items]);

  // Keep the highlighted row visible while arrowing through long result lists.
  useEffect(() => {
    resultsRef.current?.querySelector<HTMLElement>(".command-item.highlighted")?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  if (!open) return null;

  const moveHighlight = (delta: number) => {
    if (items.length === 0) return;
    setHighlighted((current) => (current + delta + items.length) % items.length);
  };
  const selectItem = (item: CommandItem | undefined) => {
    if (!item) return;
    item.select();
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); moveHighlight(1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); moveHighlight(-1); }
    else if (event.key === "Enter") { event.preventDefault(); selectItem(items[highlighted]); }
    else if (event.key === "Escape") { event.preventDefault(); onClose(); }
  };

  const sections = SECTION_ORDER.map((section) => ({ section, entries: items.filter((item) => item.section === section) })).filter((group) => group.entries.length > 0);
  let flatIndex = -1;

  return <WorkflowDialog title="ค้นหาทั่วไป" onClose={onClose} className="command-palette" backdropClassName="command-palette-backdrop">
    <div className="command-input-row"><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="ค้นหาเมนู สมาชิก สินค้า หรือเลขที่บิล…" aria-label="ค้นหาเมนู สมาชิก สินค้า หรือเลขที่บิล" /></div>
    <div className="command-results" ref={resultsRef}>
      {loading && <div className="command-loading-row">กำลังโหลดข้อมูล…</div>}
      {sections.length === 0 && !loading && <div className="command-empty">ไม่พบผลลัพธ์สำหรับ “{trimmed}”</div>}
      {sections.map(({ section, entries }) => <div className="command-section" key={section}>
        <div className="command-section-label">{section}</div>
        {entries.map((item) => { flatIndex += 1; const index = flatIndex; const Icon = item.icon; return <button type="button" className={`command-item ${index === highlighted ? "highlighted" : ""}`} key={item.key} data-section={item.section} onMouseEnter={() => setHighlighted(index)} onClick={() => selectItem(item)}><span className="command-item-icon"><Icon size={16} /></span><span className="command-item-main"><b>{item.label}</b><small className="command-item-sub">{item.sub}</small></span></button>; })}
      </div>)}
    </div>
    <div className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> เลื่อนดู</span><span><kbd>↵</kbd> เลือก</span><span><kbd>esc</kbd> ปิด</span></div>
  </WorkflowDialog>;
}
