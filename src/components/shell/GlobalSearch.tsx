"use client";

/**
 * GlobalSearch — ⌘K command palette. Lets the user quickly jump to any view
 * (dashboard / pos / stock / members / reports / settings / logs / users).
 *
 * Future enhancements: search members by number/name, search products by
 * SKU/name, search bills by orderNumber. For now we expose navigation only,
 * which is enough to unblock the AppShell.
 */

import * as React from "react";
import {
  Activity,
  LayoutDashboard,
  PackageSearch,
  Search,
  Settings2,
  ShoppingCart,
  UserCog,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isAdminRole, type View } from "@/lib/view-data";

interface SearchItem {
  id: View;
  label: string;
  hint: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const ITEMS: SearchItem[] = [
  { id: "dashboard", label: "ภาพรวม", hint: "แดชบอร์ดหลัก", icon: LayoutDashboard },
  { id: "pos", label: "หน้าร้าน / POS", hint: "ขายสินค้าและรับชำระ", icon: ShoppingCart },
  { id: "stock", label: "สต็อกสินค้า", hint: "รับเข้าและนับสต็อก", icon: PackageSearch },
  { id: "members", label: "สมาชิกและบัญชี", hint: "จัดการสมาชิกและกระเป๋าเงิน", icon: UsersRound },
  { id: "reports", label: "รายงาน", hint: "วิเคราะห์และส่งออก", icon: Activity },
  { id: "settings", label: "ตั้งค่า", hint: "ตั้งค่าร้านค้าและระบบ", icon: Settings2, adminOnly: true },
  { id: "users", label: "ผู้ใช้ระบบ", hint: "บัญชีผู้ใช้และสิทธิ์", icon: UserCog, adminOnly: true },
  { id: "logs", label: "ระบบ Log", hint: "บันทึกการทำธุรกรรม", icon: Activity, adminOnly: true },
];

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
  role?: string;
}

export function GlobalSearch({ open, onClose, onNavigate, role }: GlobalSearchProps) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const items = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return ITEMS.filter((item) => {
      if (item.adminOnly && role && !isAdminRole(role)) return false;
      if (!q) return true;
      return (
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
      );
    });
  }, [query, role]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Defer focus to next tick so the input is mounted.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  React.useEffect(() => {
    setActive(0);
  }, [query]);

  const choose = (item: SearchItem | undefined) => {
    if (!item) return;
    onNavigate(item.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="p-0 max-w-lg overflow-hidden gap-0">
        <DialogHeader className="sr-only">
          <DialogTitle>ค้นหาเมนู</DialogTitle>
          <DialogDescription>
            พิมพ์เพื่อค้นหาเมนูนำทาง · ใช้ลูกศรเลื่อน · กด Enter เพื่อเปิด
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="ค้นหาเมนูหรือรายการ…"
            className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            aria-label="ค้นหา"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="text-[10px] rounded border bg-muted px-1.5 py-0.5 text-muted-foreground">ESC</kbd>
        </div>
        <ul ref={listRef} className="max-h-72 overflow-y-auto py-1" role="listbox">
          {items.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              ไม่พบเมนูที่ตรงกับ “{query}”
            </li>
          ) : (
            items.map((item, index) => {
              const Icon = item.icon;
              const isActive = index === active;
              return (
                <li key={item.id} role="option" aria-selected={isActive}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(item)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                      isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                    )}
                  >
                    <Icon className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{item.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{item.hint}</p>
                    </div>
                    {item.adminOnly ? (
                      <span className="text-[10px] rounded-full bg-emerald-100 text-emerald-700 px-1.5 py-0.5">
                        ผู้บริหาร
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export default GlobalSearch;
