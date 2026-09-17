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

export const products: Product[] = [
  { id: 1, name: "น้ำดื่มคริสตัล 600 มล.", category: "เครื่องดื่ม", price: 7, stock: 124, unit: "ขวด", color: "blue", emoji: "💧" },
  { id: 2, name: "กาแฟกระป๋อง เบอร์ดี้", category: "เครื่องดื่ม", price: 18, stock: 42, unit: "กระป๋อง", color: "amber", emoji: "☕" },
  { id: 3, name: "ข้าวกล่องกะเพราไก่", category: "อาหาร", price: 45, stock: 18, unit: "กล่อง", color: "orange", emoji: "🍱" },
  { id: 4, name: "นมยูเอชที รสจืด", category: "เครื่องดื่ม", price: 13, stock: 65, unit: "กล่อง", color: "sky", emoji: "🥛" },
  { id: 5, name: "ขนมปังแซนด์วิช", category: "อาหาร", price: 25, stock: 9, unit: "ชิ้น", color: "rose", emoji: "🥪" },
  { id: 6, name: "สบู่เหลวล้างมือ", category: "ของใช้", price: 32, stock: 28, unit: "ขวด", color: "mint", emoji: "🧴" },
  { id: 7, name: "หน้ากากอนามัย 3 ชิ้น", category: "ของใช้", price: 20, stock: 86, unit: "แพ็ก", color: "violet", emoji: "😷" },
  { id: 8, name: "น้ำแข็งถุงเล็ก", category: "ของใช้", price: 10, stock: 35, unit: "ถุง", color: "cyan", emoji: "🧊" },
];

export const stockRows = [
  { sku: "DRK-001", name: "น้ำดื่มคริสตัล 600 มล.", lot: "CR-2608-01", expiry: "18/08/2027", qty: "124 ขวด", cost: "฿4.20", retail: "฿7.00", status: "ปกติ", tone: "green" },
  { sku: "FD-014", name: "ข้าวกล่องกะเพราไก่", lot: "ครัวกลาง-17", expiry: "18/09/2026", qty: "18 กล่อง", cost: "฿32.00", retail: "฿45.00", status: "ใกล้หมดอายุ", tone: "amber" },
  { sku: "SNK-008", name: "ขนมปังแซนด์วิช", lot: "BR-260917-A", expiry: "20/09/2026", qty: "9 ชิ้น", cost: "฿18.00", retail: "฿25.00", status: "สต็อกต่ำ", tone: "red" },
  { sku: "HYG-032", name: "สบู่เหลวล้างมือ", lot: "HM-2606-03", expiry: "04/06/2028", qty: "28 ขวด", cost: "฿24.00", retail: "฿32.00", status: "ปกติ", tone: "green" },
  { sku: "ICE-004", name: "น้ำแข็งถุงเล็ก", lot: "รับรายวัน", expiry: "ไม่ระบุ", qty: "35 ถุง", cost: "฿6.00", retail: "฿10.00", status: "ปกติ", tone: "green" },
];

export const memberRows = [
  { id: "M-000218", name: "นางสาวอรทัย ส.", type: "สมาชิก", balance: "฿1,240.00", last: "วันนี้ 14:24", status: "ใช้งาน", tone: "green" },
  { id: "M-000184", name: "นายธนกร พ.", type: "เจ้าหน้าที่", balance: "฿860.00", last: "วันนี้ 12:08", status: "ใช้งาน", tone: "green" },
  { id: "M-000092", name: "นางสาวพิมพ์ชนก ร.", type: "สมาชิก", balance: "฿0.00", last: "16 ก.ย. 09:12", status: "ระงับ", tone: "red" },
  { id: "M-000241", name: "นายสมชาย ว.", type: "สมาชิก", balance: "฿340.00", last: "15 ก.ย. 15:46", status: "ใช้งาน", tone: "green" },
  { id: "M-000119", name: "นางสาวจุฑามาศ ก.", type: "เจ้าหน้าที่", balance: "฿2,180.00", last: "14 ก.ย. 10:21", status: "ใช้งาน", tone: "green" },
];

export const memberTransactions: Record<string, { id: string; date: string; type: "ซื้อสินค้า" | "เติมเงิน" | "ถอนเงิน"; detail: string; amount: string; tone: string }[]> = {
  "M-000218": [
    { id: "TX-038", date: "17 ก.ย. 2569 · 14:38", type: "ซื้อสินค้า", detail: "บิล #INV-260917-038 · น้ำดื่ม 2 ขวด, ข้าวกล่อง 1 กล่อง", amount: "- ฿59.00", tone: "blue" },
    { id: "TX-029", date: "17 ก.ย. 2569 · 14:32", type: "เติมเงิน", detail: "เงินสด · ผู้ฝาก: น.ส.กัญญาณัฐ พ.", amount: "+ ฿500.00", tone: "green" },
    { id: "TX-014", date: "12 ก.ย. 2569 · 10:16", type: "ถอนเงิน", detail: "ถอนเพื่อถอนฟัน · เงินสด", amount: "- ฿200.00", tone: "purple" },
    { id: "TX-006", date: "01 ก.ย. 2569 · 09:05", type: "ซื้อสินค้า", detail: "บิล #INV-260901-006 · สินค้า 4 รายการ", amount: "- ฿132.00", tone: "blue" },
  ],
  "M-000092": [
    { id: "TX-112", date: "16 ก.ย. 2569 · 09:12", type: "ถอนเงิน", detail: "ถอนเพื่อถอนฟัน · แนบหลักฐานแล้ว", amount: "- ฿200.00", tone: "purple" },
    { id: "TX-091", date: "12 ก.ย. 2569 · 11:40", type: "ซื้อสินค้า", detail: "บิล #INV-260912-091 · สินค้า 2 รายการ", amount: "- ฿80.00", tone: "blue" },
  ],
};

export const logs = [
  { time: "17 ก.ย. 2569 14:38", actor: "น.ส.กัญญาณัฐ พ.", role: "เจ้าหน้าที่", action: "ขายสินค้า", detail: "บิล #INV-260917-038 · ฿186.00", tone: "blue" },
  { time: "17 ก.ย. 2569 14:32", actor: "น.ส.กัญญาณัฐ พ.", role: "เจ้าหน้าที่", action: "เติมเงินสมาชิก", detail: "M-000218 · ฿500.00 · เงินสด", tone: "green" },
  { time: "17 ก.ย. 2569 13:51", actor: "นายวรพจน์ ด.", role: "ผู้บริหาร", action: "แก้ไขสต็อก", detail: "น้ำดื่มคริสตัล · +24 ขวด", tone: "amber" },
  { time: "17 ก.ย. 2569 12:06", actor: "น.ส.กัญญาณัฐ พ.", role: "เจ้าหน้าที่", action: "ถอนเงินสมาชิก", detail: "M-000092 · ฿200.00 · ถอนเพื่อถอนฟัน", tone: "purple" },
];

export const money = (value: number) => `฿${value.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
