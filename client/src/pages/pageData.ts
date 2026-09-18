import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BarChart3, LayoutDashboard, PackageSearch, ShoppingCart, UsersRound } from "lucide-react";

export type View = "dashboard" | "pos" | "stock" | "members" | "reports" | "settings" | "logs";
export type Role = "staff" | "admin";
export type CartItem = { id: number; name: string; price: number; qty: number; unit: string };

export type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  stock: number;
  unit: string;
  color: string;
  emoji: string;
};

/** Real member essentials for the POS member dropdown (from trpc.member.list). */
export type MemberLite = {
  memberNumber: string;
  firstName: string;
  lastName: string;
  type: string;
  balance: number;
  status: "active" | "suspended";
  lastTransactionAt: string | null;
};

export function calculateCartSubtotal(items: CartItem[]) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function addScannedItem(items: CartItem[], product: Product) {
  const existing = items.find((item) => item.id === product.id);
  if (existing) {
    return items.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
  }
  return [...items, { id: product.id, name: product.name, price: product.price, qty: 1, unit: product.unit }];
}

export function canAccessView(role: Role, view: View) {
  return role === "admin" || !["settings", "logs"].includes(view);
}

export function isStockAlert(stock: number, reorderLevel = 10) {
  return stock <= reorderLevel;
}

export function formatMemberNumber(mode: "running" | "year" | "manual", sequence: number) {
  if (mode === "manual") return "กรอกเอง";
  if (mode === "year") return `69-${String(sequence).padStart(5, "0")}`;
  return `M-${String(sequence).padStart(6, "0")}`;
}

export const navItems: { id: View; label: string; caption: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "ภาพรวม", caption: "สรุปการดำเนินงาน", icon: LayoutDashboard },
  { id: "pos", label: "หน้าร้าน / POS", caption: "ขายสินค้าและรับชำระ", icon: ShoppingCart },
  { id: "stock", label: "สต็อกสินค้า", caption: "รับเข้าและนับสต็อก", icon: PackageSearch },
  { id: "members", label: "สมาชิกและบัญชี", caption: "สมาชิกและเจ้าหน้าที่", icon: UsersRound },
  { id: "reports", label: "รายงาน", caption: "วิเคราะห์และส่งออก", icon: BarChart3 },
];

// NOTE (OLD-2-b): mock exports `products` + `stockRows` were DELETED — Pos.tsx and
// Stock.tsx now load real data via trpc.product.list / trpc.stock.rows.
// NOTE (OLD-2-c): mock exports `memberRows` + `memberTransactions` + `logs` were
// DELETED — Home.tsx / Dashboard.tsx views load real data via tRPC procedures
// (member.list / member.detail / logs.list / dashboard.stats).

export const money = (value: number) => `฿${value.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
