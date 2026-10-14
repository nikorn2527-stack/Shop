import { memberNumberHead, nextMemberNumberSequence, type MemberNumberFormat } from "../shared/memberNumber";
import { allocateInventoryCost } from "./inventoryValuation";
import { INVENTORY_ACTION_LABELS } from "../shared/inventoryActions";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

// Store all business timestamps as Thai local wall time. The hosting runtime
// may run in UTC, while the shop UI and reports are intended for Thailand.
// Setting TZ before any Date helpers are evaluated keeps saved and displayed
// sales, stock, wallet, and audit-log times in the same timezone.
const STORE_TIME_ZONE = "Asia/Bangkok";
process.env.TZ = STORE_TIME_ZONE;

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type SqliteDb = InstanceType<typeof DatabaseSync>;

/** Business-rule error carrying a Thai, user-facing message. tRPC maps it to BAD_REQUEST. */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreError";
  }
}

export type SqliteMember = {
  id: number;
  memberNumber: string;
  /** คำนำหน้าชื่อ (นาย/นาง/นางสาว/…) — null = ไม่มี */
  prename?: string | null;
  firstName: string;
  lastName: string;
  idCard: string | null;
  phone: string | null;
  type: string;
  balance: number;
  status: "active" | "suspended";
  createdAt: string;
  photoUrl: string | null;
  gender: string | null;
  /** ROUND 65 (user) — รหัสบัตรเงินสดของสมาชิก (เช่น 2395100201) · null = ยังไม่ผูกบัตร */
  cardNumber: string | null;
  accountClosed?: number;
  /** 1 when the current physical-card binding and usage round are both live. */
  cardUsable?: number;
  /** ROUND 65 (user) — รหัสผู้ป่วย (HN) ที่ผูกกับบัตร · null = ไม่มี */
  patientCode: string | null;
};

export type SqliteTransaction = {
  id: number;
  memberNumber: string;
  type: "purchase" | "deposit" | "withdrawal" | "activation" | "refund";
  detail: string;
  amount: number;
  paymentMethod: string | null;
  balanceAfter: number | null;
  createdAt: string;
  /** เลขบัตร ณ รอบที่ทำรายการ ไม่เปลี่ยนตามบัตรปัจจุบันของสมาชิก */
  cardNumber: string | null;
  /** ROUND 63 — รายการนี้มีรูปหลักฐานแนบไหม (ตัวรูปดึงแยกที่ member.transactionSlip) */
  hasSlip?: number;
};

export type SqliteMemberSummary = {
  id: number;
  memberNumber: string;
  /** คำนำหน้าชื่อ — null = ไม่มี */
  prename?: string | null;
  firstName: string;
  lastName: string;
  type: string;
  balance: number;
  status: "active" | "suspended";
  createdAt: string;
  lastTransactionAt: string | null;
  photoUrl: string | null;
  gender: string | null;
  /** ROUND 65 — รหัสบัตรเงินสด / รหัสผู้ป่วย (แสดงในรายการและรายงานยอดเงินในบัตร) */
  cardNumber: string | null;
  /** 1 เมื่อบัตรยัง assigned ให้สมาชิกรายนี้และมีรอบใช้งานที่ยังไม่ปิด */
  cardUsable: number;
  patientCode: string | null;
};

export type SqliteProduct = {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  emoji: string | null;
  color: string | null;
  unit: string;
  price: number;
  size: string | null;
  imageUrl: string | null;
  /** สินค้าลัดหน้าร้าน — 1 = โชว์เป็นปุ่มลัดที่ POS (round 31-12) */
  quickPick: number;
  /** "unit" = ขายตามหน่วย · "money" = ขายเป็นเงิน เช่น น้ำแข็ง (ใช้ priceTiers) */
  sellMode: string | null;
  /** ตัวเลือกราคาสั้นๆ สำหรับ sellMode "money": JSON [{ label, price, qty }] */
  priceTiers: string | null;
  cost: number;
  stock: number;
  reorderPoint: number;
  active: number;
  createdAt: string;
};

export type SqliteStockRow = {
  id: number;
  productId: number;
  sku: string;
  name: string;
  unit: string;
  lot: string;
  expiry: string | null;
  qty: number;
  cost: number;
  price: number;
  stock: number;
  reorderPoint: number;
  receivedAt: string | null;
  active: number;
  status: "ปกติ" | "สต็อกต่ำ" | "ใกล้หมดอายุ" | "ปิดการขาย";
  tone: "green" | "red" | "amber" | "purple";
};

export type SqliteSale = {
  id: number;
  orderNumber: string;
  paymentMethod: string;
  memberNumber: string | null;
  subtotal: number;
  discount: number;
  total: number;
  cashier: string | null;
  createdAt: string;
};

export type SqliteSaleItem = {
  id: number;
  saleId: number;
  productId: number | null;
  name: string;
  qty: number;
  price: number;
  cost: number;
};

export type SqliteAuditLog = {
  id: number;
  action: string;
  actor: string;
  actorRole: string | null;
  detail: string;
  tone: string;
  createdAt: string;
};

export type CheckoutReceipt = {
  orderNumber: string;
  createdAt: string;
  items: { productId: number | null; name: string; unit: string; qty: number; price: number; amount: number }[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  memberNumber: string | null;
  memberName: string | null;
  balanceAfter: number | null;
  cashier: string | null;
  /** FIX-7 (user) — ยอดเงินสดที่รับมา (เฉพาะ "เงินสด") ใช้พิมพ์ "รับเงินมา X / ทอน Y" ท้ายใบเสร็จ */
  receivedCash?: number | null;
  /** FIX-7 (user) — ยอดเงินทอน (เฉพาะ "เงินสด") */
  changeDue?: number | null;
  /** FIX-7 (user) — บิล QR ที่แคชเชียร์ยืนยันตรวจสอบแล้ว (เก็บไว้ในตารางเพื่อ audit) */
  paymentVerified?: boolean | null;
  /** FIX-8 (user) — พรีวิวก่อนพิมพ์ใบเสร็จ/บัตร/รายงาน: true = เปิด preview ก่อน (default, ปลอดภัย)
   *  false = กดปุ่มพิมพ์แล้ว window.print() เลย (เร็วกว่า แต่ไม่มีโอกาสตรวจก่อน) */
  printPreviewBefore?: boolean;
};

/** A past receipt rebuilt from the sales/sale_items tables — balanceAfter is replayed from the member ledger when that bill was a wallet purchase. */
export type SaleHistoryEntry = CheckoutReceipt & {
  /** รหัสแถวในตาราง sales — ใช้ดึงหลักฐานแนบ (sales.slip) รอบหลัง */
  id: number;
  /** ROUND 63 — บิลนี้มีรูปหลักฐานการชำระแนบอยู่ไหม (ตัวรูปดึงแยกที่ sales.slip เพื่อไม่ให้ลิสต์หนัก) */
  hasSlip: boolean;
  /** FEAT-9 — บิลนี้ถูกยกเลิกหรือไม่ (true = void, แสดง red strikethrough ใน RecentBillsWidget) */
  voided?: boolean;
};

export type DailySalesRow = {
  date: string;
  orders: number;
  items: number;
  revenue: number;
  cogs: number;
  profit: number;
  marginPct: number;
};

export type DashboardStats = {
  rangeDays: number;
  totalSales: number;
  totalOrders: number;
  itemsSold: number;
  bestSellerCount: number;
  avgDailySales: number;
  revenueByDay: { date: string; total: number }[];
  bestSellers: { name: string; qty: number; revenue: number }[];
  lowStock: { id: number; sku: string; name: string; unit: string; stock: number; reorderPoint: number }[];
  expirySoon: { id: number; productId: number; sku: string; name: string; unit: string; lot: string; expiry: string; qty: number }[];
  recentActivities: SqliteAuditLog[];
  memberWalletTotal: number;
  memberCount: { total: number; active: number; suspended: number };
};

/** FIX-5 (user) — บัญชีธนาคารของร้าน (รับเงินโอน)
 *  เก็บเป็น JSON array ใน StoreSettings.bankAccounts ·
 *  ใช้แสดงที่หน้ายืนยันการชำระ POS + ท้ายใบเสร็จ (เมื่อชำระด้วย QR/สแกน)
 *  แทนที่จะมีเฉพาะ QR PromptPay อย่างเดียว */
export type BankAccount = {
  /** id คงที่ (crypto.randomUUID()) — ใช้เป็น React key + อ้างอิงตอนลบ/แก้ */
  id: string;
  /** รหัสธนาคาร — เช่น "BBL" "KBANK" "SCB" "KTB" "BAY" "TTB" "TCD" "CIMBT" "TISCO" "KKTB" "ICB" "TCRB" "LHFB" "GHIB"
   *  เก็บเพื่อ sort/group และแสดงสี/ไอคอน (ถ้ามี) ในอนาคต */
  bankCode: string;
  /** ชื่อธนาคาร (display) เช่น "ธนาคารกสิกรไทย" — ตรงกับที่ผู้ใช้พิมพ์เข้ามา */
  bankName: string;
  /** เลขที่บัญชี (ตัวเลขเท่านั้น, 10-12 หลัก) */
  accountNumber: string;
  /** ชื่อบัญชี (ตัวอักษรตามสมุดบัญชี) — ลูกค้าใช้ตรวจสอบก่อนโอน */
  accountName: string;
  /** ชื่อสาขา (ถ้ามี) — ไม่บังคับ */
  branch?: string;
  /** ปิด/เปิดใช้งาน — ปิดได้โดยไม่ลบ (สำหรับเปลี่ยนบัญชีชั่วคราว) */
  active: boolean;
  /** หมายเหตุ (ถ้ามี) เช่น "บัญชีออมทรัพย์" "เฉพาะโอนภายในเวลาทำการ" */
  note?: string;
};

export type StoreSettings = {
  memberNumberMode: "running" | "year" | "manual";
  memberNumberPrefix: string;
  memberNumberYearMode: "none" | "buddhist" | "gregorian";
  memberNumberYearDigits: 2 | 4;
  memberNumberSeparator: "-" | "/" | "_" | "";
  memberNumberResetMonth: number;
  memberNumberSequenceDigits: number;
  storeName: string;
  storeCode: string;
  storeAddress: string;
  /** Round 25 — ปรับแต่งแอป: ชื่อที่แสดงบน sidebar/login/title */
  appName: string;
  /** data-URL รูปโลโก้ (สูงสุด ~512KB) — ว่าง = ใช้อักษรย่อ */
  appLogo: string;
  appBackground: string;
  /** สีธีมหลัก: preset id เช่น "emerald" หรือ hex "#007a55" */
  appTheme: string;
  /** ROUND 75 (user) — หน้าแจ้งผลหลังชำระเงิน ไม่เด้งไปหน้าสั่งพิมพ์อีกต่อไป:
   *  แสดงหน้าใบเสร็จพร้อมปุ่ม พิมพ์/บันทึกรูป/ดาวน์โหลด PDF ให้ผู้ใช้กดเอง —
   *  ตัวตั้ง autoPrintReceipt เดิมถูกลบออก (พฤติกรรม window.print() อัตโนมัติ)
   *  · เพิ่ม posRailHidden: ปุ่มรางซ้าย POS ที่ปิดใช้งาน (JSON array ของ key) */
  posRailHidden: string;
  posShortcutKeys: string;
  showBalanceOnReceipt: boolean;
  lowBalanceAlert: boolean;
  lowBalanceThreshold: number;
  lowStockAlert: boolean;
  expiryAlert: boolean;
  expiryAlertDays: number;
  /** Round 31 — รอบตัดยอดประจำวัน: auto = ระบบตัดตามเวลาที่กำหนด · manual = เจ้าหน้าที่กดตัดยอดเอง */
  dailyCutOffMode: "auto" | "manual";
  /** "HH:MM" เวลาตัดยอดของรอบอัตโนมัติ (เช่น "02:00" = รอบวันวิ่ง 02:00→02:00 ของวันถัดไป) */
  dailyCutOffTime: string;
  /** ROUND 36 (ข้อ 31) — ประตูบัญชีผู้พัฒนา (dev): ปิดอยู่ (false) = บัญชี dev เข้าสู่ระบบไม่ได้ทั้งหมด */
  devAccess: boolean;
  /** ROUND 38 (ข้อ 39) — สไตล์การแสดงผลของแอป: "shop" (ค่าเริ่มต้น) | "apple" | "microsoft" | "android" */
  appStyle: string;
  /** ROUND 38 (ข้อ 39) — สำรองข้อมูลอัตโนมัติ: เปิด/ปิดตัวตรวจตามรอบเวลาของเซิร์ฟเวอร์ */
  backupAutoEnabled: boolean;
  /** ROUND 38 (ข้อ 39) — รอบสำรองข้อมูลอัตโนมัติเป็นชั่วโมง (1-168) */
  backupIntervalHours: number;
  /** ROUND 38 (ข้อ 39) — จำนวนไฟล์สำรองที่เก็บสูงสุด (3-60) — เกินจากนี้ลบไฟล์เก่าสุด */
  backupKeepCount: number;
  /** ROUND 42 (ข้อ 32 ตอนที่ 3 — ข้อ 4) — ความกว้างกระดาษสลิปเครื่องพิมพ์: "58" (สลิปเล็ก) | "72" (มาตรฐานเดิม) | "80" (สลิปใหญ่) */
  receiptPaperWidth: "58" | "72" | "80";
  /** FIX-8 (user) — พรีวิวก่อนพิมพ์ (ใบเสร็จ/บัตร/รายงาน): true = เปิดก่อน (default ปลอดภัย)
   *  false = กดปุ่มพิมพ์แล้ว window.print() ทันที (เร็ว แต่ไม่มีโอกาสตรวจก่อน) */
  printPreviewBefore: boolean;
  /** FIX-9 (user) — @deprecated ใช้ receiptPrinterName/reportPrinterName/cardPrinterName แทน
   *  เก็บไว้เพื่อ backward compat (บิลเก่าที่ยังไม่ได้อัปเดต) */
  defaultPrinterName: string;
  /** FIX-15 (user) — เครื่องพิมพ์ใบเสร็จ (thermal) — พิมพ์ใบเสร็จ/สลิปเติม-ถอน · "" = ยังไม่ตั้ง */
  receiptPrinterName: string;
  /** FIX-15 (user) — เครื่องพิมพ์รายงาน (A4 laser/inkjet) — พิมพ์รายงานสมาชิก/สรุปยอด · "" = ยังไม่ตั้ง */
  reportPrinterName: string;
  /** FIX-15 (user) — เครื่องพิมพ์บัตรสมาชิก — พิมพ์บัตรสมาชิก · "" = ยังไม่ตั้ง */
  cardPrinterName: string;
  /** FIX-18 (user) — toggle พรีวิวแยกตามประเภทเอกสาร */
  receiptPreviewBefore: boolean;
  reportPreviewBefore: boolean;
  cardPreviewBefore: boolean;
  /** ROUND 56 (user) — เช็คลิสต์วันขึ้นระบบ (โซนเครื่องมือติดตั้ง): JSON array ของ id ที่ติ๊กแล้ว
   *  เก็บฝั่งเซิร์ฟเวอร์ให้ทุกเครื่องเห็นตรงกัน · "" = ยังไม่ได้ติ๊กอะไร */
  goliveChecks: string;
  /** ROUND 61 (user) — ระบบเวอร์ชัน 3 แบบ (ทั่วไป/โปร/โปรพลัส): รหัสลิขสิทธิ์ที่ใส่แล้ว ("" = ยังไม่มี) ·
   *  เปลี่ยนผ่าน edition.applyLicense เท่านั้น (settings.set กลั่น fields เหล่านี้ทิ้งเสมอ) */
  licenseKey: string;
  /** ชื่อผู้ถือลิขสิทธิ์ที่พิมพ์ตอนใช้รหัส — แสดงบนหน้าเวอร์ชันและโซนช่าง */
  licenseName: string;
  /** วันเริ่มทดลองใช้โปรพลัส 30 วัน "YYYY-MM-DD" · "" = ยังไม่เคยทดลอง · ตั้งผ่าน edition.startTrial เท่านั้น */
  trialStart: string;
  /** ROUND 63 (user) — บัญชีพร้อมเพย์ของร้าน (เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก)
   *  ใช้สร้าง QR ให้ลูกค้าสแกนจ่ายที่หน้ายืนยันการชำระเงิน · "" = ยังไม่ตั้ง (ไม่แสดง QR) */
  promptpayId: string;
  /** เปิด/ปิดการรับเงินพร้อมเพย์ โดยไม่ต้องลบหมายเลขที่ตั้งค่าไว้ */
  promptpayActive: boolean;
  /** FIX-5 (user) — บัญชีธนาคารของร้าน (รับเงินโอน) · เก็บเป็น JSON array ใน store_settings
   *  แสดงที่หน้ายืนยันการชำระ POS (ควบคู่กับ QR) และท้ายใบเสร็จเมื่อชำระด้วย QR / สแกน ·
   *  [] = ยังไม่มีบัญชี (ลูกค้าไม่เห็นตัวเลือกโอนผ่านธนาคาร) */
  bankAccounts: BankAccount[];
  /** ROUND 68 (user) — เบอร์โทรศูนย์ช่วยเหลือของร้าน แสดงท้ายหน้าจอทุกหน้า
   *  (แถบ footer) · "" = ไม่แสดง (เดิมเคยเป็นข้อความล็อก 02-XXX-XXXX แก้ไม่ได้) */
  helpPhone: string;
};

/**
 * Lightweight SQLite adapter for local feature testing.
 * Uses Node 22's built-in node:sqlite, so a cloned project needs no native binary build.
 * Production auth/runtime remains on the template's configured database.
 */
export function createSqliteStore(filename = ":memory:"): SqliteDb {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_number TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      id_card TEXT,
      phone TEXT,
      type TEXT NOT NULL DEFAULT 'สมาชิก',
      balance REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    -- ROUND 65 (user): type เพิ่ม 'activation' (เปิดใช้บัตร = ลงทะเบียนพร้อมเงินเริ่มต้น)
    -- และ 'refund' (คืนบัตรเงินสด = ผู้ป่วยคืนบัตร ร้านจ่ายเงินคืนตามยอดคงเหลือ)
    CREATE TABLE IF NOT EXISTS member_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_number TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('purchase', 'deposit', 'withdrawal', 'activation', 'refund')),
      detail TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT,
      balance_after REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_number) REFERENCES members(member_number)
    );
    CREATE TABLE IF NOT EXISTS store_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'ของใช้',
      emoji TEXT,
      color TEXT,
      unit TEXT NOT NULL DEFAULT 'ชิ้น',
      price REAL NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      reorder_point INTEGER NOT NULL DEFAULT 10,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stock_lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      lot TEXT NOT NULL,
      expiry_date TEXT,
      qty INTEGER NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      payment_method TEXT NOT NULL,
      member_number TEXT REFERENCES members(member_number),
      subtotal REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      cashier TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER,
      name TEXT NOT NULL,
      qty INTEGER NOT NULL,
      price REAL NOT NULL,
      cost REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('RECEIVE', 'SALE', 'ADJUST', 'TRANSFER', 'RETURN', 'VOID', 'COUNT')),
      qty_delta INTEGER NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      ref_type TEXT,
      ref_id INTEGER,
      reason TEXT,
      actor TEXT,
      actor_role TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS cashier_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashier_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      opening_cash REAL NOT NULL DEFAULT 0,
      expected_cash REAL NOT NULL DEFAULT 0,
      counted_cash REAL,
      cash_difference REAL,
      expected_qr REAL NOT NULL DEFAULT 0,
      expected_wallet REAL NOT NULL DEFAULT 0,
      bills_count INTEGER NOT NULL DEFAULT 0,
      pieces INTEGER NOT NULL DEFAULT 0,
      sales_total REAL NOT NULL DEFAULT 0,
      note TEXT,
      opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      method TEXT,
      actor TEXT,
      approver TEXT,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS day_closures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_start TEXT NOT NULL,
      closed_at TEXT NOT NULL,
      bills INTEGER NOT NULL DEFAULT 0,
      pieces INTEGER NOT NULL DEFAULT 0,
      revenue REAL NOT NULL DEFAULT 0,
      cash_total REAL NOT NULL DEFAULT 0,
      qr_total REAL NOT NULL DEFAULT 0,
      wallet_total REAL NOT NULL DEFAULT 0,
      deposits REAL NOT NULL DEFAULT 0,
      withdrawals REAL NOT NULL DEFAULT 0,
      deposit_count INTEGER NOT NULL DEFAULT 0,
      deposit_amount REAL NOT NULL DEFAULT 0,
      activation_count INTEGER NOT NULL DEFAULT 0,
      activation_amount REAL NOT NULL DEFAULT 0,
      withdrawal_count INTEGER NOT NULL DEFAULT 0,
      withdrawal_amount REAL NOT NULL DEFAULT 0,
      refund_count INTEGER NOT NULL DEFAULT 0,
      refund_amount REAL NOT NULL DEFAULT 0,
      closed_by TEXT,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_role TEXT,
      detail TEXT,
      tone TEXT NOT NULL DEFAULT 'blue',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS roles (
      name TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS permissions (
      key TEXT PRIMARY KEY,
      group_name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_name TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
      permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
      PRIMARY KEY (role_name, permission_key)
    );
    CREATE TABLE IF NOT EXISTS order_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty REAL NOT NULL DEFAULT 1,
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS physical_cards (
      card_number TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'blank' CHECK (status IN ('blank','assigned','returned_vacant','lost','damaged')),
      assigned_member_number TEXT REFERENCES members(member_number),
      note TEXT,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS card_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_number TEXT NOT NULL REFERENCES physical_cards(card_number),
      member_number TEXT NOT NULL REFERENCES members(member_number),
      action TEXT NOT NULL CHECK (action IN ('assign','release','lost','damaged')),
      actor TEXT,
      actor_role TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_physical_cards_status ON physical_cards(status);
    CREATE INDEX IF NOT EXISTS idx_card_assignments_card ON card_assignments(card_number);
    -- P4 (release/rollback) — every install/update/rollback/hotfix lands a row
    -- here so the on-premise deployment has an auditable release history. The
    -- scripts/update.sh and scripts/rollback.sh drivers append a row each
    -- time they run; system.releases (admin only) reads it back. Action is
    -- CHECK-constrained to the four canonical actions so ad-hoc strings cannot
    -- pollute the history. Migrations / health_check / backup_file are stored as
    -- TEXT (the scripts pass JSON or markdown); actor is who/what triggered it.
    CREATE TABLE IF NOT EXISTS release_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('install', 'update', 'rollback', 'hotfix')),
      notes TEXT,
      migrations TEXT,
      backup_file TEXT,
      health_check TEXT,
      actor TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureColumn(db, "members", "phone", "TEXT");
  ensureColumn(db, "members", "type", "TEXT NOT NULL DEFAULT 'สมาชิก'");
  ensureColumn(db, "member_transactions", "balance_after", "REAL");
  ensureColumn(db, "audit_logs", "actor_role", "TEXT");
  ensureColumn(db, "sale_items", "unit", "TEXT");
  // NULL marks legacy valuations: never invent historical purchase amounts.
  ensureColumn(db, "stock_lots", "remaining_value_satang", "INTEGER");
  ensureColumn(db, "stock_lots", "received_value_satang", "INTEGER");
  ensureColumn(db, "sale_items", "cost_total_satang", "INTEGER");
  db.exec(`CREATE TABLE IF NOT EXISTS sale_lot_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
    lot_id INTEGER NOT NULL REFERENCES stock_lots(id),
    qty INTEGER NOT NULL CHECK(qty > 0),
    cost_satang INTEGER NOT NULL CHECK(cost_satang >= 0),
    valuation_source TEXT NOT NULL CHECK(valuation_source IN ('receipt', 'legacy_estimate')),
    UNIQUE(sale_item_id, lot_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sale_lot_item ON sale_lot_allocations(sale_item_id);`);
  db.exec(`CREATE TABLE IF NOT EXISTS lot_value_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id INTEGER NOT NULL REFERENCES stock_lots(id),
    qty_delta INTEGER NOT NULL,
    value_delta_satang INTEGER NOT NULL,
    reason TEXT NOT NULL,
    actor TEXT,
    created_at TEXT NOT NULL
  );`);
  ensureColumn(db, "app_users", "failed_attempts", "INTEGER NOT NULL DEFAULT 0");
  // ROUND 36 (ข้อ 31) — บังคับเปลี่ยนรหัสผ่านครั้งแรก: 1 = บัญชีใหม่/รหัสที่ผู้บริหารตั้งให้ ต้องเปลี่ยนก่อนใช้งาน
  ensureColumn(db, "app_users", "must_change_password", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "products", "size", "TEXT");
  ensureColumn(db, "products", "image_url", "TEXT");
  ensureColumn(db, "products", "quick_pick", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "products", "sell_mode", "TEXT");
  ensureColumn(db, "products", "price_tiers", "TEXT");
  ensureColumn(db, "members", "photo_url", "TEXT");
  ensureColumn(db, "members", "gender", "TEXT");
  // Round 43 — คำนำหน้าชื่อสมาชิก (นาย/นาง/นางสาว/ด.ช./... ) NULL = ไม่มี
  ensureColumn(db, "members", "prename", "TEXT");
  ensureColumn(db, "members", "account_closed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "member_transactions", "actor", "TEXT");
  // Backfill the new actor column from audit_logs (round 30): every wallet /
  // purchase transaction was logged with the same timestamp as its
  // member_transactions row, so an exact created_at match recovers the staff
  // member who did it. Idempotent — only rows still missing actor are touched.
  db.prepare(`UPDATE member_transactions SET actor = (
    SELECT a.actor FROM audit_logs a
    WHERE a.action = 'ขายสินค้า' AND a.created_at = member_transactions.created_at
      AND a.detail LIKE 'บิล #' || substr(member_transactions.detail, 6, instr(member_transactions.detail || ' ·', ' ·') - 6) || ' ·%'
    ORDER BY a.id DESC LIMIT 1
  ) WHERE actor IS NULL AND type = 'purchase' AND detail LIKE 'บิล #%'`).run();
  db.prepare(`UPDATE member_transactions SET actor = (
    SELECT a.actor FROM audit_logs a
    WHERE a.action IN ('เติมเงินสมาชิก', 'ถอนเงินสมาชิก')
      AND a.created_at = member_transactions.created_at
      AND a.detail LIKE member_transactions.member_number || ' ·%'
    ORDER BY a.id DESC LIMIT 1
  ) WHERE actor IS NULL AND type IN ('deposit', 'withdrawal')`).run();
  ensureColumn(db, "app_users", "locked_until", "TEXT");
  // Session security — idle timeout tracking
  ensureColumn(db, "app_sessions", "last_seen_at", "TEXT");
  db.prepare("UPDATE app_sessions SET last_seen_at = created_at WHERE last_seen_at IS NULL").run();
  // ROUND 63 (user) — หลักฐานการชำระเงิน: รูปสลิปที่แนบมากับบิลขาย (QR/สแกน) และ
  // รายการเติม/ถอนเงินสมาชิก เก็บเป็น data-URL JPEG (ย่อ ~800px ฝั่ง client ก่อนส่ง)
  ensureColumn(db, "sales", "slip_url", "TEXT");
  ensureColumn(db, "sales", "voided", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sales", "void_reason", "TEXT");
  ensureColumn(db, "sales", "void_actor", "TEXT");
  ensureColumn(db, "sales", "voided_at", "TEXT");
  ensureColumn(db, "member_transactions", "slip_url", "TEXT");
  // Hospital daily-cover-sheet snapshots. Keep separate amount/count columns so
  // a closed document remains historically accurate after later ledger entries.
  ensureColumn(db, "day_closures", "deposit_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "day_closures", "deposit_amount", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "day_closures", "activation_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "day_closures", "activation_amount", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "day_closures", "withdrawal_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "day_closures", "withdrawal_amount", "REAL NOT NULL DEFAULT 0");
  ensureColumn(db, "day_closures", "refund_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "day_closures", "refund_amount", "REAL NOT NULL DEFAULT 0");
  // P2-b (idempotency) — client_request_id lets checkout() + walletTx()
  // short-circuit a retried submit and return the original receipt/ledger row
  // instead of double-charging the member or double-decrementing stock.
  // NULL on legacy rows; only present on rows written through the idempotent path.
  ensureColumn(db, "sales", "client_request_id", "TEXT");
  ensureColumn(db, "member_transactions", "client_request_id", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sales_client_req ON sales(client_request_id) WHERE client_request_id IS NOT NULL");
  db.exec("CREATE INDEX IF NOT EXISTS idx_member_tx_client_req ON member_transactions(client_request_id) WHERE client_request_id IS NOT NULL");
  // FIX-7 (user) — ยอดเงินสดที่รับมา + ยอดเงินทอน สำหรับบิล "เงินสด" + flag ยืนยันตรวจสอบสำหรับบิล "QR / สแกน"
  // NULL on legacy rows (บิลเก่าไม่มีข้อมูลนี้ → ไม่แสดงในใบเสร็จ)
  ensureColumn(db, "sales", "received_cash", "REAL");
  ensureColumn(db, "sales", "change_due", "REAL");
  ensureColumn(db, "sales", "payment_verified", "INTEGER");
  // ROUND 65 (user) — รหัสบัตรเงินสด (23951…) และรหัสผู้ป่วย (HN) ของสมาชิกร้านค้าสวัสดิการ
  ensureColumn(db, "members", "card_number", "TEXT");
  ensureColumn(db, "members", "patient_code", "TEXT");
  // ROUND 65 (user) — DB เดิมสร้าง member_transactions ด้วย CHECK 3 ชนิดเดิม →
  // ขยายเป็น 5 ชนิด (เพิ่ม activation/refund) ด้วยการสร้างตารางใหม่แล้วคัดลอกข้อมูล
  upgradeMemberTransactionsTypes(db);
  // ROUND 65 (user) — จำนวนที่ "รับเข้าจริง" ของแต่ละ Lot (qty ปัจจุบันโดนหักตอนขาย
  // ไปแล้ว) ใช้คำนวณยอดยกมาของรายงานสินค้าคงคลังให้ตรงชีทโรงพยาบาล
  ensureColumn(db, "stock_lots", "received_qty", "INTEGER");
  db.prepare("UPDATE stock_lots SET received_qty = qty WHERE received_qty IS NULL").run();
  // Backfill units for sale_items rows written before the column existed (idempotent).
  db.prepare("UPDATE sale_items SET unit = (SELECT p.unit FROM products p WHERE p.id = sale_items.product_id) WHERE unit IS NULL").run();
  ensureColumn(db, "physical_cards", "archived_at", "TEXT");
  seedPhysicalCardsFromMembers(db);
  initializeCardUsageSessions(db);
  // RBAC — seed roles + permissions (idempotent)
  ensureRbacSeed(db);
  return db;
}
/** บัตรกายภาพหมุนเวียน — แยกสต็อกบัตรออกจากตัวตนสมาชิก (member_number ไม่ reuse). */
export type PhysicalCardStatus = "blank" | "assigned" | "returned_vacant" | "lost" | "damaged";
export type CardUsageSession = { id: number; cardNumber: string; memberNumber: string; memberName: string; startedAt: string; endedAt: string | null; openedBy: string | null; closedBy: string | null; openingBalance: number; closingBalance: number | null; legacy: number; transactionCount: number; incoming: number; outgoing: number };
export type CardSessionTransaction = { id: number; type: string; amount: number; balanceAfter: number | null; createdAt: string; actor: string | null; detail: string };

function initializeCardUsageSessions(db: SqliteDb) {
  db.exec(`CREATE TABLE IF NOT EXISTS card_usage_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_number TEXT NOT NULL REFERENCES physical_cards(card_number),
    member_number TEXT NOT NULL REFERENCES members(member_number),
    started_at TEXT NOT NULL, ended_at TEXT, opened_by TEXT, closed_by TEXT,
    opening_balance REAL NOT NULL, closing_balance REAL, end_reason TEXT,
    legacy INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_card_session_open_card ON card_usage_sessions(card_number) WHERE ended_at IS NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_card_session_open_member ON card_usage_sessions(member_number) WHERE ended_at IS NULL;`);
  ensureColumn(db, "member_transactions", "card_usage_session_id", "INTEGER REFERENCES card_usage_sessions(id)");
  ensureColumn(db, "sales", "card_usage_session_id", "INTEGER REFERENCES card_usage_sessions(id)");
  db.prepare(`INSERT INTO card_usage_sessions (card_number, member_number, started_at, opening_balance, legacy)
    SELECT c.card_number, c.assigned_member_number, ?, m.balance, 1
    FROM physical_cards c JOIN members m ON m.member_number = c.assigned_member_number
    WHERE c.status = 'assigned' AND NOT EXISTS (SELECT 1 FROM card_usage_sessions s WHERE s.card_number = c.card_number AND s.ended_at IS NULL)`).run(formatDateTime());
  db.exec(`CREATE INDEX IF NOT EXISTS idx_member_tx_card_session ON member_transactions(card_usage_session_id);
    CREATE INDEX IF NOT EXISTS idx_sales_card_session ON sales(card_usage_session_id);
    CREATE TRIGGER IF NOT EXISTS card_session_assignment AFTER INSERT ON card_assignments BEGIN
      INSERT INTO card_usage_sessions (card_number, member_number, started_at, opened_by, opening_balance)
      SELECT NEW.card_number, NEW.member_number, NEW.created_at, NEW.actor,
        CASE WHEN EXISTS (SELECT 1 FROM member_transactions WHERE member_number = NEW.member_number)
        THEN balance ELSE 0 END FROM members WHERE member_number = NEW.member_number AND NEW.action = 'assign';
      UPDATE card_usage_sessions SET ended_at = NEW.created_at, closed_by = NEW.actor, end_reason = NEW.action,
        closing_balance = (SELECT balance FROM members WHERE member_number = NEW.member_number)
      WHERE card_number = NEW.card_number AND member_number = NEW.member_number AND ended_at IS NULL AND NEW.action != 'assign';
    END;
    CREATE TRIGGER IF NOT EXISTS member_tx_card_session AFTER INSERT ON member_transactions BEGIN
      UPDATE member_transactions SET card_usage_session_id = (SELECT id FROM card_usage_sessions WHERE member_number = NEW.member_number AND ended_at IS NULL)
      WHERE id = NEW.id AND NEW.card_usage_session_id IS NULL;
    END;
    CREATE TRIGGER IF NOT EXISTS sale_card_session AFTER INSERT ON sales BEGIN
      UPDATE sales SET card_usage_session_id = (SELECT id FROM card_usage_sessions WHERE member_number = NEW.member_number AND ended_at IS NULL)
      WHERE id = NEW.id AND NEW.card_usage_session_id IS NULL;
    END;`);
  // Link legacy rows to the physical-card round that covered their timestamp.
  // Imported installations commonly have one synthetic legacy round created
  // after their historical ledger; that round intentionally represents those
  // earlier rows until the first real return/reassignment closes it.
  db.prepare(`UPDATE member_transactions AS t
    SET card_usage_session_id = (
      SELECT s.id FROM card_usage_sessions s
      WHERE s.member_number = t.member_number
        AND (
          (t.created_at >= s.started_at AND (s.ended_at IS NULL OR t.created_at <= s.ended_at))
          OR (s.legacy = 1 AND NOT EXISTS (
            SELECT 1 FROM card_usage_sessions exact
            WHERE exact.member_number = t.member_number
              AND t.created_at >= exact.started_at
              AND (exact.ended_at IS NULL OR t.created_at <= exact.ended_at)
          ))
        )
      ORDER BY CASE WHEN t.created_at >= s.started_at THEN 0 ELSE 1 END, s.id DESC
      LIMIT 1
    )
    WHERE t.card_usage_session_id IS NULL`).run();
  // If a member has exactly one card in their entire assignment history, that
  // card is an unambiguous fallback for imported ledger rows whose timestamps
  // predate the synthetic legacy session created during migration.
  db.prepare(`UPDATE member_transactions AS t
    SET card_usage_session_id = (
      SELECT s.id FROM card_usage_sessions s
      WHERE s.member_number = t.member_number
        AND s.card_number = (
          SELECT MIN(a.card_number) FROM card_assignments a
          WHERE a.member_number = t.member_number
          HAVING COUNT(DISTINCT a.card_number) = 1
        )
      ORDER BY s.legacy DESC, s.id ASC LIMIT 1
    )
    WHERE t.card_usage_session_id IS NULL`).run();
}

export function cardUsageHistory(db: SqliteDb, cardNumber: string) {
  const sessions = db.prepare(`SELECT s.id, s.card_number AS cardNumber, s.member_number AS memberNumber,
    TRIM(m.first_name || ' ' || m.last_name) AS memberName, s.started_at AS startedAt, s.ended_at AS endedAt, s.opened_by AS openedBy,
    s.closed_by AS closedBy, s.opening_balance AS openingBalance, s.closing_balance AS closingBalance, s.legacy,
    COUNT(t.id) AS transactionCount,
    COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END),0) AS incoming,
    COALESCE(SUM(CASE WHEN t.amount < 0 THEN -t.amount ELSE 0 END),0) AS outgoing
    FROM card_usage_sessions s JOIN members m ON m.member_number = s.member_number
    LEFT JOIN member_transactions t ON t.card_usage_session_id = s.id
    WHERE s.card_number = ? GROUP BY s.id ORDER BY s.id DESC`).all(cardNumber) as unknown as CardUsageSession[];
  const transactions = db.prepare(`SELECT t.id, t.type, t.amount, t.balance_after AS balanceAfter,
    t.created_at AS createdAt, t.actor, t.detail, t.card_usage_session_id AS sessionId
    FROM member_transactions t JOIN card_usage_sessions s ON s.id = t.card_usage_session_id
    WHERE s.card_number = ? ORDER BY t.id DESC`).all(cardNumber) as unknown as (CardSessionTransaction & { sessionId: number })[];
  return { sessions, transactions };
}
export type PhysicalCardRow = { cardNumber: string; status: PhysicalCardStatus; assignedMemberNumber: string | null; note: string | null; createdBy: string | null; updatedBy: string | null; createdAt: string; updatedAt: string };

function seedPhysicalCardsFromMembers(db: SqliteDb) {
  const rows = db.prepare(`SELECT DISTINCT card_number AS cardNumber, member_number AS memberNumber FROM members WHERE card_number IS NOT NULL AND TRIM(card_number) != ''`).all() as unknown as { cardNumber: string; memberNumber: string }[];
  const insert = db.prepare(`INSERT OR IGNORE INTO physical_cards (card_number, status, assigned_member_number, created_at, updated_at) VALUES (?, 'assigned', ?, ?, ?)`);
  for (const row of rows) {
    const code = row.cardNumber.trim();
    if (!code) continue;
    const now = formatDateTime();
    insert.run(code, row.memberNumber, now, now);
  }
}

/** Require a live physical-card round before any normal member transaction. */
function requireUsableMemberCard(db: SqliteDb, memberNumber: string): SqliteMember {
  const member = db.prepare(`SELECT id, member_number AS memberNumber, prename, first_name AS firstName, last_name AS lastName, id_card AS idCard, phone, type, balance, status, created_at AS createdAt, photo_url AS photoUrl, gender, card_number AS cardNumber, account_closed AS accountClosed, patient_code AS patientCode FROM members WHERE member_number = ?`).get(memberNumber.trim()) as SqliteMember | undefined;
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${memberNumber} ในระบบ`);
  if (member.status !== "active") throw new StoreError(`สมาชิกถูกระงับการใช้งาน · ${member.memberNumber}`);
  if (member.accountClosed) throw new StoreError("บัญชีรอบนี้ปิดแล้ว ต้องรับคืนบัตรและจ่ายบัตรใหม่ก่อนทำรายการ");
  if (!member.cardNumber?.trim()) throw new StoreError("สมาชิกยังไม่มีบัตร กรุณาจ่ายบัตรก่อนทำรายการ");
  const card = db.prepare(`SELECT status, assigned_member_number AS assignedMemberNumber FROM physical_cards WHERE card_number = ? AND archived_at IS NULL`).get(member.cardNumber) as { status: PhysicalCardStatus; assignedMemberNumber: string | null } | undefined;
  if (!card || card.status !== "assigned" || card.assignedMemberNumber !== member.memberNumber) {
    throw new StoreError("บัตรไม่พร้อมใช้งาน กรุณาตรวจสอบสถานะและการผูกบัตร");
  }
  const session = db.prepare(`SELECT id FROM card_usage_sessions WHERE card_number = ? AND member_number = ? AND ended_at IS NULL`).get(member.cardNumber, member.memberNumber);
  if (!session) throw new StoreError("ไม่พบรอบใช้งานของบัตร กรุณารับคืนและจ่ายบัตรใหม่");
  return member;
}

export function listPhysicalCards(db: SqliteDb, status?: PhysicalCardStatus | "all", search?: string): PhysicalCardRow[] {
  const conditions: string[] = ["archived_at IS NULL"];
  const params: (string | number)[] = [];
  if (status && status !== "all") { conditions.push(`status = ?`); params.push(status); }
  const keyword = search?.trim();
  if (keyword) { conditions.push(`(card_number LIKE ? OR COALESCE(assigned_member_number, '') LIKE ?)`); params.push(`%${keyword}%`, `%${keyword}%`); }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`SELECT card_number AS cardNumber, status, assigned_member_number AS assignedMemberNumber, note, created_by AS createdBy, updated_by AS updatedBy, created_at AS createdAt, updated_at AS updatedAt FROM physical_cards${where} ORDER BY card_number`).all(...params) as unknown as PhysicalCardRow[];
}
export function previewGeneratedCards(db: SqliteDb, prefix: string, digits: number, count: number) {
  prefix = prefix.trim();
  if (!/^[A-Za-z0-9-]{0,16}$/.test(prefix) || !Number.isInteger(digits) || digits < 3 || digits > 10 || !Number.isInteger(count) || count < 1 || count > 500) {
    throw new StoreError("รูปแบบรหัสไม่ถูกต้อง: จำนวนหลัก 3–10 และจำนวนบัตร 1–500 ใบ");
  }
  let last = 0;
  const rows = db.prepare(`SELECT card_number AS code FROM physical_cards UNION SELECT card_number AS code FROM members WHERE card_number IS NOT NULL`).all() as { code: string }[];
  for (const { code } of rows) {
    if (!code.startsWith(prefix)) continue;
    const suffix = code.slice(prefix.length);
    if (/^\d+$/.test(suffix) && suffix.length === digits) last = Math.max(last, Number(suffix));
  }
  if (last + count >= 10 ** digits) throw new StoreError("เลขรันเต็มจำนวนหลักที่กำหนด กรุณาเพิ่มจำนวนหลักหรือเปลี่ยนคำนำหน้า");
  const codes = Array.from({ length: count }, (_, index) => `${prefix}${String(last + index + 1).padStart(digits, "0")}`);
  return { first: codes[0], last: codes[codes.length - 1], count, codes };
}

export function generateBlankCards(db: SqliteDb, prefix: string, digits: number, count: number, actor?: string, actorRole?: string) {
  // Allocate and insert under one write lock; previews never reserve numbers.
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = previewGeneratedCards(db, prefix, digits, count);
    const now = formatDateTime();
    const insert = db.prepare(`INSERT INTO physical_cards (card_number, status, created_by, updated_by, created_at, updated_at) VALUES (?, 'blank', ?, ?, ?, ?)`);
    for (const code of result.codes) insert.run(code, actor?.trim() || null, actor?.trim() || null, now, now);
    logAction(db, "เพิ่มบัตรเปล่า", actor?.trim() || "ระบบ", `${count} ใบ · ${result.first} ถึง ${result.last}`, "blue", actorRole ?? null, now);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function createBlankCards(db: SqliteDb, cardNumbers: string[], actor?: string, actorRole?: string) {
  const cleaned = Array.from(new Set(cardNumbers.map((code) => code.trim()).filter(Boolean)));
  if (cleaned.length === 0) throw new StoreError("กรุณาระบุรหัสบัตรอย่างน้อย 1 ใบ");
  if (cleaned.length > 500) throw new StoreError("เพิ่มบัตรได้ครั้งละไม่เกิน 500 ใบ");
  if (cleaned.some((code) => code.length > 30)) throw new StoreError("รหัสบัตรยาวเกินไป (สูงสุด 30 ตัวอักษร)");
  const createdAt = formatDateTime();
  runInTransaction(db, () => {
    for (const code of cleaned) {
      const exists = db.prepare(`SELECT status FROM physical_cards WHERE card_number = ?`).get(code);
      if (exists) throw new StoreError(`รหัสบัตร ${code} มีอยู่ในระบบแล้ว`);
      const clash = db.prepare(`SELECT member_number FROM members WHERE card_number = ?`).get(code) as { member_number: string } | undefined;
      if (clash) throw new StoreError(`รหัสบัตร ${code} ถูกใช้กับสมาชิก ${clash.member_number} อยู่แล้ว`);
      db.prepare(`INSERT INTO physical_cards (card_number, status, assigned_member_number, created_by, updated_by, created_at, updated_at) VALUES (?, 'blank', NULL, ?, ?, ?, ?)`).run(code, actor?.trim() || null, actor?.trim() || null, createdAt, createdAt);
    }
    logAction(db, "เพิ่มบัตรเปล่า", actor?.trim() || "ระบบ", `${cleaned.length} ใบ`, "blue", actorRole ?? null, createdAt);
  });
  return listPhysicalCards(db, "blank");
}

function assignPhysicalCardTx(db: SqliteDb, cardNumber: string, memberNumber: string, actor?: string, actorRole?: string, createdAt = formatDateTime()) {
  const code = cardNumber.trim();
  if (!code) throw new StoreError("กรุณายิงรหัสบัตร");
  const card = db.prepare(`SELECT status AS status, assigned_member_number AS assignedMemberNumber FROM physical_cards WHERE card_number = ? AND archived_at IS NULL`).get(code) as { status: PhysicalCardStatus; assignedMemberNumber: string | null } | undefined;
  if (!card) throw new StoreError(`ไม่พบบัตร ${code} ในสต็อกบัตร · กรุณาเพิ่มบัตรเปล่าก่อน`);
  if (card.status === "assigned") throw new StoreError(`บัตร ${code} ถูกใช้กับสมาชิก ${card.assignedMemberNumber ?? ""} อยู่แล้ว`);
  if (card.status === "lost" || card.status === "damaged") throw new StoreError(`บัตร ${code} ใช้งานไม่ได้`);
  const holder = db.prepare(`SELECT member_number FROM members WHERE card_number = ? AND member_number != ?`).get(code, memberNumber) as { member_number: string } | undefined;
  if (holder) throw new StoreError(`รหัสบัตร ${code} ถูกใช้กับสมาชิก ${holder.member_number} อยู่แล้ว`);
  db.prepare(`UPDATE physical_cards SET status = 'assigned', assigned_member_number = ?, updated_by = ?, updated_at = ? WHERE card_number = ?`).run(memberNumber, actor?.trim() || null, createdAt, code);
  db.prepare(`INSERT INTO card_assignments (card_number, member_number, action, actor, actor_role, created_at) VALUES (?, ?, 'assign', ?, ?, ?)`).run(code, memberNumber, actor?.trim() || null, actorRole ?? null, createdAt);
}

/** Explicit demo preparation, never executed automatically during startup. */
export function bindExistingMembersToDemoCards(db: SqliteDb, actor: string) {
  return runInTransaction(db, () => {
    const members = db.prepare(`SELECT member_number AS memberNumber, card_number AS cardNumber FROM members ORDER BY member_number`).all() as unknown as { memberNumber: string; cardNumber: string | null }[];
    const mappings: { memberNumber: string; cardNumber: string; previousCard: string | null }[] = [];
    let sequence = 1;
    for (const member of members) {
      if (member.cardNumber?.startsWith("DEMO-CARD-")) continue;
      let code: string;
      while (true) {
        code = `DEMO-CARD-${String(sequence++).padStart(5, "0")}`;
        const card = listPhysicalCards(db, "all", code).find(entry => entry.cardNumber === code);
        if (!card) {
          const now = formatDateTime();
          db.prepare(`INSERT INTO physical_cards (card_number, status, created_by, updated_by, created_at, updated_at) VALUES (?, 'blank', ?, ?, ?, ?)`).run(code, actor, actor, now, now);
          break;
        }
        if (card.status === "blank" || card.status === "returned_vacant") break;
      }
      if (member.cardNumber) {
        const now = formatDateTime();
        const result = db.prepare(`UPDATE physical_cards SET status = 'returned_vacant', assigned_member_number = NULL, updated_by = ?, updated_at = ? WHERE card_number = ? AND assigned_member_number = ? AND status = 'assigned'`).run(actor, now, member.cardNumber, member.memberNumber);
        if (Number(result.changes) !== 1) throw new StoreError(`ข้อมูลการผูกบัตรเดิมไม่ตรงกับสมาชิก ${member.memberNumber}`);
        db.prepare(`INSERT INTO card_assignments (card_number, member_number, action, actor, note, created_at) VALUES (?, ?, 'release', ?, ?, ?)`).run(member.cardNumber, member.memberNumber, actor, "เปลี่ยนเป็นบัตรชุดเดโม", now);
      }
      assignPhysicalCardTx(db, code, member.memberNumber, actor);
      db.prepare(`UPDATE members SET card_number = ? WHERE member_number = ?`).run(code, member.memberNumber);
      logAction(db, "ผูกบัตรเดโม", actor, `${member.memberNumber} · ${code}`, "blue");
      mappings.push({ memberNumber: member.memberNumber, cardNumber: code, previousCard: member.cardNumber });
    }
    return mappings;
  });
}

export function releasePhysicalCard(db: SqliteDb, cardNumber: string, actor?: string, actorRole?: string, note?: string, expectedSessionId?: number) {
  return runInTransaction(db, () => {
    if (expectedSessionId !== undefined) {
      const session = db.prepare(`SELECT id FROM card_usage_sessions WHERE card_number = ? AND ended_at IS NULL`).get(cardNumber.trim()) as { id: number } | undefined;
      if (session?.id !== expectedSessionId) throw new StoreError("บัตรมีการเปลี่ยนผู้ถือแล้ว กรุณาสแกนใหม่");
    }
    const holder = db.prepare(`SELECT balance FROM members WHERE card_number = ?`).get(cardNumber.trim()) as { balance: number } | undefined;
    if (holder && holder.balance !== 0) throw new StoreError("กรุณาคืนเงินทั้งหมดหรือจัดการยอดค้างก่อนคืนบัตร");
    return releasePhysicalCardTx(db, cardNumber, actor, actorRole, note);
  });
}

/** Assign or replace a physical card without changing the member identity or money. */
export function assignMemberCard(db: SqliteDb, input: {
  memberNumber: string; cardNumber: string; expectedCardNumber: string | null;
  expectedSessionId?: number;
  actor?: string; actorRole?: string;
}) {
  return runInTransaction(db, () => {
    const member = getMemberDetail(db, input.memberNumber)?.member;
    if (!member) throw new StoreError("ไม่พบสมาชิก");
    if (member.status !== "active") throw new StoreError("สมาชิกถูกระงับการใช้งาน");
    if ((member.cardNumber || null) !== input.expectedCardNumber) throw new StoreError("บัตรสมาชิกมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่");
    if (member.cardNumber === input.cardNumber.trim()) throw new StoreError("กรุณาเลือกบัตรใบใหม่");
    if (member.cardNumber) {
      const session = db.prepare(`SELECT id FROM card_usage_sessions WHERE card_number = ? AND member_number = ? AND ended_at IS NULL`).get(member.cardNumber, input.memberNumber) as { id: number } | undefined;
      if (input.expectedSessionId === undefined || session?.id !== input.expectedSessionId) throw new StoreError("รอบบัตรมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่");
      releasePhysicalCardTx(db, member.cardNumber, input.actor, input.actorRole, "เปลี่ยนบัตร · คงยอดเงินในบัญชีสมาชิก");
    }
    assignPhysicalCardTx(db, input.cardNumber, input.memberNumber, input.actor, input.actorRole);
    db.prepare(`UPDATE members SET card_number = ?, account_closed = 0 WHERE member_number = ?`).run(input.cardNumber.trim(), input.memberNumber);
    logAction(db, "จ่ายบัตรสมาชิก", input.actor || "ระบบ", `${input.memberNumber} · ${input.cardNumber.trim()}`, "blue", input.actorRole ?? null);
    return getMemberDetail(db, input.memberNumber);
  });
}

function releasePhysicalCardTx(db: SqliteDb, cardNumber: string, actor?: string, actorRole?: string, note?: string) {
  const code = cardNumber.trim();
  if (!code) throw new StoreError("กรุณาระบุรหัสบัตร");
  const createdAt = formatDateTime();
  {
    const card = db.prepare(`SELECT status AS status, assigned_member_number AS assignedMemberNumber FROM physical_cards WHERE card_number = ?`).get(code) as { status: PhysicalCardStatus; assignedMemberNumber: string | null } | undefined;
    if (!card) throw new StoreError(`ไม่พบบัตร ${code} ในสต็อกบัตร`);
    if (card.status !== "assigned" || !card.assignedMemberNumber) throw new StoreError(`บัตร ${code} ไม่ได้ผูกกับสมาชิก`);
    db.prepare(`UPDATE members SET card_number = NULL WHERE member_number = ?`).run(card.assignedMemberNumber);
    db.prepare(`UPDATE physical_cards SET status = 'returned_vacant', assigned_member_number = NULL, note = ?, updated_by = ?, updated_at = ? WHERE card_number = ?`).run(note?.trim() || null, actor?.trim() || null, createdAt, code);
    db.prepare(`INSERT INTO card_assignments (card_number, member_number, action, actor, actor_role, note, created_at) VALUES (?, ?, 'release', ?, ?, ?, ?)`).run(code, card.assignedMemberNumber, actor?.trim() || null, actorRole ?? null, note?.trim() || null, createdAt);
    logAction(db, "คืนบัตรหมุนเวียน", actor?.trim() || "ระบบ", `${code} · จากสมาชิก ${card.assignedMemberNumber}`, "amber", actorRole ?? null, createdAt);
    return getMemberDetail(db, card.assignedMemberNumber);
  }
}

export function markPhysicalCard(db: SqliteDb, cardNumber: string, status: "lost" | "damaged", actor?: string, actorRole?: string, note?: string) {
  const code = cardNumber.trim();
  if (!code) throw new StoreError("กรุณาระบุรหัสบัตร");
  const createdAt = formatDateTime();
  return runInTransaction(db, () => {
    const card = db.prepare(`SELECT assigned_member_number AS assignedMemberNumber FROM physical_cards WHERE card_number = ?`).get(code) as { assignedMemberNumber: string | null } | undefined;
    if (!card) throw new StoreError(`ไม่พบบัตร ${code} ในสต็อกบัตร`);
    if (card.assignedMemberNumber) db.prepare(`UPDATE members SET card_number = NULL WHERE member_number = ?`).run(card.assignedMemberNumber);
    if (card.assignedMemberNumber) db.prepare(`INSERT INTO card_assignments (card_number, member_number, action, actor, actor_role, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(code, card.assignedMemberNumber, status, actor?.trim() || null, actorRole ?? null, note?.trim() || null, createdAt);
    db.prepare(`UPDATE physical_cards SET status = ?, assigned_member_number = NULL, note = ?, updated_by = ?, updated_at = ? WHERE card_number = ?`).run(status, note?.trim() || null, actor?.trim() || null, createdAt, code);
    logAction(db, status === "lost" ? "แจ้งบัตรหาย" : "ทำบัตรชำรุด", actor?.trim() || "ระบบ", code, "red", actorRole ?? null, createdAt);
  });
}

export function returnMemberCard(db: SqliteDb, input: { memberNumber: string; cardNumber: string; expectedSessionId: number; mode: "refund"; actor?: string; actorRole?: string; clientRequestId?: string }) {
  if (input.mode !== "refund") throw new StoreError("คืนบัตรต้องคืนเงินทั้งหมดก่อน");
  const member = getMemberDetail(db, input.memberNumber)?.member;
  const session = db.prepare(`SELECT id FROM card_usage_sessions WHERE card_number = ? AND member_number = ? AND ended_at IS NULL`).get(input.cardNumber, input.memberNumber) as { id: number } | undefined;
  if (!member || member.cardNumber !== input.cardNumber || session?.id !== input.expectedSessionId) throw new StoreError("บัตรมีการเปลี่ยนผู้ถือแล้ว กรุณาสแกนใหม่");
  if (member.status !== "active") throw new StoreError("สมาชิกถูกระงับการใช้งาน");
  if (member.balance < 0) throw new StoreError("สมาชิกมียอดค้าง กรุณาจัดการยอดก่อนคืนบัตร");
  if (input.mode === "refund" && member.balance > 0) {
    walletTx(db, { memberNumber: input.memberNumber, type: "refund", amount: member.balance, actor: input.actor, actorRole: input.actorRole, clientRequestId: input.clientRequestId, note: "คืนเงินทั้งหมดและคืนบัตร" });
    return getMemberDetail(db, input.memberNumber);
  }
  return releasePhysicalCard(db, input.cardNumber, input.actor, input.actorRole, "รับคืนบัตรยอดศูนย์", input.expectedSessionId);
}

/** Close the current account use without claiming that the physical card was returned. */
export function closeMemberAccount(db: SqliteDb, input: { memberNumber: string; cardNumber: string; expectedSessionId: number; actor?: string; actorRole?: string; clientRequestId?: string }) {
  return runInTransaction(db, () => {
    const member = getMemberDetail(db, input.memberNumber)?.member;
    const session = db.prepare(`SELECT id FROM card_usage_sessions WHERE card_number = ? AND member_number = ? AND ended_at IS NULL`).get(input.cardNumber, input.memberNumber) as { id: number } | undefined;
    if (!member || member.cardNumber !== input.cardNumber || session?.id !== input.expectedSessionId) throw new StoreError("ข้อมูลบัตรเปลี่ยนแล้ว ค้นหาสมาชิกอีกครั้ง");
    if (member.status !== "active") throw new StoreError("สมาชิกถูกระงับการใช้งาน");
    if (member.balance < 0) throw new StoreError("มียอดค้าง ต้องจัดการยอดก่อนปิดบัญชี");
    const closed = db.prepare(`SELECT account_closed FROM members WHERE member_number = ?`).get(input.memberNumber) as { account_closed: number };
    if (closed.account_closed) return getMemberDetail(db, input.memberNumber);
    if (member.balance > 0) walletTx(db, { memberNumber: input.memberNumber, type: "refund", amount: member.balance, retainCard: true, note: "คืนเงินทั้งหมดและปิดรอบบัญชี · ยังไม่ได้รับบัตรคืน", actor: input.actor, actorRole: input.actorRole, clientRequestId: input.clientRequestId });
    db.prepare(`UPDATE members SET account_closed = 1 WHERE member_number = ?`).run(input.memberNumber);
    logAction(db, "ปิดรอบบัญชีสมาชิก", input.actor || "เจ้าหน้าที่", `${input.memberNumber} · คืนเงินแล้ว · บัตร ${input.cardNumber} ยังไม่ได้รับคืน`, "amber", input.actorRole ?? null);
    return getMemberDetail(db, input.memberNumber);
  });
}



/** Migration-safe column add for databases created before a column existed. */
function ensureColumn(db: SqliteDb, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * ROUND 65 (user) — ขยายชนิดธุรกรรมสมาชิกจาก 3 เป็น 5 ชนิด (เพิ่ม 'activation' เปิดใช้บัตร
 * และ 'refund' คืนบัตรเงินสด) ให้กับฐานข้อมูลที่สร้างตารางไว้ก่อนหน้า — SQLite
 * แก้ CHECK ไม่ได้โดยตรง จึงสร้างตารางใหม่→คัดลอก→สลับชื่อ (idempotent: ถ้าเจอ
 * 'activation' ในคำนิยามเดิมแล้วถือว่าย้ายเสร็จ ข้ามทันที)
 */
function upgradeMemberTransactionsTypes(db: SqliteDb) {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'member_transactions'`).get() as { sql: string } | undefined;
  if (!row?.sql || row.sql.includes("'activation'")) return;
  db.exec(`
    CREATE TABLE member_transactions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_number TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('purchase', 'deposit', 'withdrawal', 'activation', 'refund')),
      detail TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT,
      balance_after REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (member_number) REFERENCES members(member_number)
    );
  `);
  db.exec(`
    INSERT INTO member_transactions_new (id, member_number, type, detail, amount, payment_method, balance_after, created_at)
      SELECT id, member_number, type, detail, amount, payment_method, balance_after, created_at FROM member_transactions;
    DROP TABLE member_transactions;
    ALTER TABLE member_transactions_new RENAME TO member_transactions;
  `);
  // คอลัมน์เสริมที่เคยเพิ่มด้วย ensureColumn ในรอบก่อนต้องกลับมาให้ครบหลังสลับตาราง
  ensureColumn(db, "member_transactions", "balance_after", "REAL");
  ensureColumn(db, "member_transactions", "actor", "TEXT");
  ensureColumn(db, "member_transactions", "slip_url", "TEXT");
}

export function seedSqliteDemoData(db: SqliteDb) {
  // ROUND 36 (ข้อ 31) — ไม่ seed บัญชีผู้ใช้แล้ว: ฐานข้อมูลใหม่ต้องลงทะเบียน
  // ผู้บริหารหลักผ่าน SetupView ก่อน (setupInitialAdmin) เพื่อบังคับเปลี่ยนรหัสผ่าน
  const insertMember = db.prepare(`INSERT OR IGNORE INTO members (member_number, first_name, last_name, id_card, balance, status) VALUES (?, ?, ?, ?, ?, ?)`);
  insertMember.run("M-000218", "อรทัย", "ส.", null, 1240, "active");
  insertMember.run("M-000092", "พิมพ์ชนก", "ร.", null, 0, "suspended");
  const insertTransaction = db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  insertTransaction.run("M-000218", "purchase", "บิล #INV-260917-038 · น้ำดื่ม 2 ขวด, ข้าวกล่อง 1 กล่อง", -59, "member_balance", "2026-09-17 14:38:00");
  insertTransaction.run("M-000218", "deposit", "ผู้ฝาก: น.ส.กัญญาณัฐ พ.", 500, "cash", "2026-09-17 14:32:00");
  insertTransaction.run("M-000218", "withdrawal", "ถอนเพื่อถอนฟัน", -200, "cash", "2026-09-12 10:16:00");
  insertTransaction.run("M-000092", "withdrawal", "ถอนเพื่อถอนฟัน · แนบหลักฐานแล้ว", -200, "cash", "2026-09-16 09:12:00");
}

export function getMemberDetail(db: SqliteDb, memberNumber: string, transactionLimit = 50) {
  const member = db.prepare(`SELECT m.id, m.member_number as memberNumber, m.prename, m.first_name as firstName, m.last_name as lastName, m.id_card as idCard, m.phone, m.type, m.balance, m.status, m.created_at as createdAt, m.photo_url as photoUrl, m.gender, m.card_number as cardNumber, m.account_closed as accountClosed, m.patient_code as patientCode,
    CASE WHEN m.status = 'active' AND m.account_closed = 0 AND EXISTS (
      SELECT 1 FROM physical_cards pc
      JOIN card_usage_sessions cs ON cs.card_number = pc.card_number
        AND cs.member_number = m.member_number AND cs.ended_at IS NULL
      WHERE pc.card_number = m.card_number AND pc.archived_at IS NULL
        AND pc.status = 'assigned' AND pc.assigned_member_number = m.member_number
    ) THEN 1 ELSE 0 END AS cardUsable
    FROM members m WHERE m.member_number = ?`).get(memberNumber) as SqliteMember | undefined;
  if (!member) return undefined;
  const transactions = db.prepare(`SELECT t.id, t.member_number as memberNumber, t.type, t.detail, t.amount,
    t.payment_method as paymentMethod, t.balance_after as balanceAfter, t.created_at as createdAt,
    t.slip_url IS NOT NULL AS hasSlip, s.card_number AS cardNumber
    FROM member_transactions t
    LEFT JOIN card_usage_sessions s ON s.id = t.card_usage_session_id
    WHERE t.member_number = ? ORDER BY t.created_at DESC, t.id DESC LIMIT ?`).all(memberNumber, transactionLimit) as unknown as SqliteTransaction[];
  return { member, transactions };
}

/** ROUND 63 (user) — ดึงรูปหลักฐานของรายการเติม/ถอนเงินสมาชิก ตามรหัสแถว member_transactions */
export function getTransactionSlip(db: SqliteDb, id: number): { slipUrl: string | null } {
  const row = db.prepare(`SELECT slip_url AS slipUrl FROM member_transactions WHERE id = ?`).get(id) as { slipUrl: string | null } | undefined;
  if (!row) throw new StoreError("ไม่พบรายการธุรกรรมนี้ในระบบ");
  return { slipUrl: row.slipUrl };
}

export function setMemberNumberMode(db: SqliteDb, mode: "running" | "year" | "manual") {
  db.prepare(`INSERT INTO store_settings (key, value) VALUES ('member_number_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(mode);
}

export function getMemberNumberMode(db: SqliteDb) {
  const row = db.prepare(`SELECT value FROM store_settings WHERE key = 'member_number_mode'`).get() as { value: "running" | "year" | "manual" } | undefined;
  return row?.value ?? "running";
}

function memberNumberSettings(db: SqliteDb): Required<MemberNumberFormat> {
  const settings = getSettings(db);
  return {
    // An empty prefix is intentional: it enables formats such as 69-00001
    // or 6900001 instead of silently restoring the historical "M" prefix.
    prefix: settings.memberNumberPrefix.trim().replace(/[^A-Za-z0-9ก-๙._-]/g, "").slice(0, 20),
    yearMode: settings.memberNumberYearMode,
    yearDigits: settings.memberNumberYearDigits === 4 ? 4 : 2,
    separator: settings.memberNumberSeparator === "" || settings.memberNumberSeparator === "/" || settings.memberNumberSeparator === "_" ? settings.memberNumberSeparator : "-",
    resetMonth: Math.min(12, Math.max(1, Math.floor(settings.memberNumberResetMonth || 1))),
    sequenceDigits: Math.min(10, Math.max(1, Math.floor(settings.memberNumberSequenceDigits || 6))),
  };
}

export function suspendMember(db: SqliteDb, memberNumber: string) {
  const result = db.prepare(`UPDATE members SET status = 'suspended' WHERE member_number = ?`).run(memberNumber);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Welfare store domain: products, stock, POS checkout, members, wallet,
// reports, settings and audit logs. All user-facing errors are Thai.
// ---------------------------------------------------------------------------

const PAYMENT_METHODS = ["เงินสด", "QR / สแกน", "หักบัญชีสมาชิก"] as const;
const WALLET_PAYMENT = "หักบัญชีสมาชิก";

const pad2 = (value: number) => String(value).padStart(2, "0");

// ROUND 40 (ข้อ 32) — export ให้ importTool.ts ใช้ร่วมกัน (ตัวเล็ก ไร้ผลข้างเนียง)
export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatDateTime(date = new Date()) {
  return `${formatDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatDate(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/** ฿-formatted money for log details, e.g. "฿1,240.00" */
export function money(value: number) {
  return `฿${value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function runInTransaction<T>(db: SqliteDb, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function countRows(db: SqliteDb, table: string) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

/** Audit trail entry. Called from every mutation. */
export function logAction(
  db: SqliteDb,
  action: string,
  actor: string,
  detail: string,
  tone = "blue",
  actorRole: string | null = null,
  createdAt: string = formatDateTime(),
): SqliteAuditLog {
  const result = db.prepare(`INSERT INTO audit_logs (action, actor, actor_role, detail, tone, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(action, actor, actorRole, detail, tone, createdAt);
  return { id: Number(result.lastInsertRowid), action, actor, actorRole, detail, tone, createdAt };
}

export function listAuditLogs(db: SqliteDb, limit = 200): SqliteAuditLog[] {
  const capped = Math.max(1, Math.min(1000, Math.floor(limit)));
  return db.prepare(`SELECT id, action, actor, actor_role AS actorRole, detail, tone, created_at AS createdAt FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?`).all(capped) as unknown as SqliteAuditLog[];
}

// --- P4: release/rollback log + schema version tracking --------------------

/**
 * P4 (release/rollback) — One row per install/update/rollback/hotfix action,
 * so the on-premise deployment has an auditable release history that pairs
 * with `scripts/update.sh` and `scripts/rollback.sh`. Action is constrained
 * to the four canonical values by a CHECK clause on the table itself; the
 * TypeScript union here mirrors that and keeps callers type-safe.
 */
export type ReleaseAction = "install" | "update" | "rollback" | "hotfix";

export type ReleaseLogRow = {
  id: number;
  version: string;
  action: ReleaseAction;
  notes: string | null;
  migrations: string | null;
  backupFile: string | null;
  healthCheck: string | null;
  actor: string | null;
  createdAt: string;
};

export type LogReleaseInput = {
  version: string;
  action: ReleaseAction;
  notes?: string | null;
  migrations?: string | null;
  backupFile?: string | null;
  healthCheck?: string | null;
  actor?: string | null;
  /** actorRole is preserved for audit-trail parity with logAction. */
  actorRole?: string | null;
};

/**
 * Append a release_logs row AND a matching audit_logs entry. The audit log
 * is what shows up on the "ประวัติระบบ" page (red tone for rollback, blue for
 * install/update, amber for hotfix) so admins see release events next to
 * every other system action. Returns the inserted row.
 *
 * Idempotent: callers that re-send the same input (e.g. a script that gets
 * re-run after a transient failure) will get a duplicate row. The script
 * drivers therefore pass `--actor "$USER@$(hostname)"` plus a timestamp
 * inside `notes` so duplicates are easy to spot in the history.
 */
export function logRelease(db: SqliteDb, input: LogReleaseInput): ReleaseLogRow {
  const version = (input.version ?? "").trim() || "0.0.0";
  const notes = input.notes?.trim() || null;
  const migrations = input.migrations ?? null;
  const backupFile = input.backupFile?.trim() || null;
  const healthCheck = input.healthCheck ?? null;
  const actor = input.actor?.trim() || null;
  const actorRole = input.actorRole ?? null;
  const result = db
    .prepare(
      `INSERT INTO release_logs (version, action, notes, migrations, backup_file, health_check, actor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(version, input.action, notes, migrations, backupFile, healthCheck, actor);
  const id = Number(result.lastInsertRowid);
  const tone = input.action === "rollback" ? "red" : input.action === "hotfix" ? "amber" : "blue";
  const summaryParts: string[] = [`เวอร์ชัน ${version}`];
  if (backupFile) summaryParts.push(`สำรองไว้ที่ ${backupFile}`);
  if (migrations) summaryParts.push(`migrations: ${migrations}`);
  if (healthCheck) summaryParts.push(`health: ${healthCheck}`);
  if (notes) summaryParts.push(notes);
  logAction(
    db,
    input.action === "install"
      ? "ติดตั้งระบบ"
      : input.action === "update"
        ? "อัปเดตระบบ"
        : input.action === "rollback"
          ? "ย้อนระบบกลับ"
          : "Hotfix",
    actor ?? "ระบบ",
    summaryParts.join(" · "),
    tone,
    actorRole,
  );
  return db
    .prepare(
      `SELECT id, version, action, notes, migrations, backup_file AS backupFile, health_check AS healthCheck, actor, created_at AS createdAt
       FROM release_logs WHERE id = ?`,
    )
    .get(id) as unknown as ReleaseLogRow;
}

/** Release history newest-first. Caps at 200 to match audit_logs behavior. */
export function listReleases(db: SqliteDb, limit = 100): ReleaseLogRow[] {
  const capped = Math.max(1, Math.min(200, Math.floor(limit)));
  return db
    .prepare(
      `SELECT id, version, action, notes, migrations, backup_file AS backupFile, health_check AS healthCheck, actor, created_at AS createdAt
       FROM release_logs ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(capped) as unknown as ReleaseLogRow[];
}

// --- P4: schema version tracking (separate from app version) ----------------

/**
 * P4 — DB schema version, stored in `store_settings` under `schema_version`.
 *
 * This is INTENTIONALLY separate from the app semver (`package.json` version
 * returned by `getVersion()` in `server/_core/version.ts`):
 *   • The app version changes with every release (features, fixes).
 *   • The schema version only bumps when a DB migration runs (new table,
 *     new column, CHECK constraint change, etc.).
 *
 * `scripts/update.sh` reads this before/after running migrations so it can
 * skip a migration that was already applied and refuse to downgrade.
 *
 * Default "1.0" matches the schema as of P4 (no migration versioning existed
 * before this task — the value is backfilled the first time it is read).
 */
const SCHEMA_VERSION_KEY = "schema_version";
const DEFAULT_SCHEMA_VERSION = "1.0";

/** Current DB schema version (default "1.0" when never set). */
export function getSchemaVersion(db: SqliteDb): string {
  const row = db
    .prepare(`SELECT value FROM store_settings WHERE key = ?`)
    .get(SCHEMA_VERSION_KEY) as { value: string } | undefined;
  const raw = (row?.value ?? "").trim();
  return raw || DEFAULT_SCHEMA_VERSION;
}

/**
 * Update the schema version setting. Called by the migration runner inside
 * `scripts/update.sh` (and by any future in-app migration path) right after
 * a successful migration commit. Does NOT log to audit_logs on its own —
 * the caller (script or migration runner) writes a `logRelease` entry that
 * already records the migration, so a second audit row would be noise.
 */
export function setSchemaVersion(db: SqliteDb, version: string): void {
  const clean = (version ?? "").trim();
  if (!clean) return;
  db.prepare(
    `INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SCHEMA_VERSION_KEY, clean);
}

// --- products & stock -------------------------------------------------------

export function listProducts(db: SqliteDb, includeInactive = false): SqliteProduct[] {
  if (includeInactive) {
    return db.prepare(`SELECT id, sku, barcode, name, category, emoji, color, size, image_url AS imageUrl, quick_pick AS quickPick, sell_mode AS sellMode, price_tiers AS priceTiers, unit, price, cost, stock, reorder_point AS reorderPoint, active, created_at AS createdAt FROM products ORDER BY active DESC, id`).all() as unknown as SqliteProduct[];
  }
  return db.prepare(`SELECT id, sku, barcode, name, category, emoji, color, size, image_url AS imageUrl, quick_pick AS quickPick, sell_mode AS sellMode, price_tiers AS priceTiers, unit, price, cost, stock, reorder_point AS reorderPoint, active, created_at AS createdAt FROM products WHERE active = 1 ORDER BY id`).all() as unknown as SqliteProduct[];
}

function getProductById(db: SqliteDb, productId: number): SqliteProduct | undefined {
  return db.prepare(`SELECT id, sku, barcode, name, category, emoji, color, size, image_url AS imageUrl, quick_pick AS quickPick, sell_mode AS sellMode, price_tiers AS priceTiers, unit, price, cost, stock, reorder_point AS reorderPoint, active, created_at AS createdAt FROM products WHERE id = ?`).get(productId) as SqliteProduct | undefined;
}

export type CreateProductInput = {
  name: string;
  sku?: string;
  barcode?: string;
  size?: string;
  imageUrl?: string | null;
  /** 1 = สินค้าลัดหน้าร้าน (boolean ก็รับแล้วแปลงเป็น 0/1) */
  quickPick?: number | boolean | null;
  /** "unit" (default) | "money" — ขายเป็นเงินใช้ priceTiers */
  sellMode?: "unit" | "money" | null;
  /** JSON [{ label, price, qty }] สำหรับ sellMode "money" */
  priceTiers?: string | null;
  unit?: string;
  price: number;
  cost?: number;
  stock?: number;
  reorderPoint?: number;
  category?: string;
  emoji?: string;
  color?: string;
  actor?: string;
  actorRole?: string;
};

// ROUND 71 — รหัสสินค้าอัตโนมัติแยกตามหมวด (ตามชุดข้อมูลจริง 120 รายการ):
// เครื่องดื่ม=DRK · ของใช้ส่วนตัว=HYG · ขนม=SNK · อาหาร=FD · ของใช้ในครัวเรือน=HH · เครื่องเขียน=ST
// ("ของใช้" คือหมวดเดโมรุ่นเก่า — ให้ HYG เหมือนเดิม) — ชุดเดียวกันใช้ที่ scripts/seed-data-products.ts
// และ IMPORT_SKU_PREFIXES ใน server/importTool.ts เพื่อให้ import XLSX ออกรหัสชุดเดียวกัน
const CATEGORY_SKU_PREFIXES: Record<string, string> = {
  "เครื่องดื่ม": "DRK",
  "อาหาร": "FD",
  "ของใช้": "HYG",
  "ของใช้ส่วนตัว": "HYG",
  "ของใช้ในครัวเรือน": "HH",
  "ขนม": "SNK",
  "เครื่องเขียน": "ST",
};

function generateSku(db: SqliteDb, category: string) {
  const prefix = CATEGORY_SKU_PREFIXES[category] ?? "GEN";
  const rows = db.prepare(`SELECT sku FROM products WHERE sku LIKE ?`).all(`${prefix}-%`) as unknown as { sku: string }[];
  const used = new Set(rows.map((row) => row.sku));
  let sequence = rows.reduce((max, row) => {
    const suffix = row.sku.slice(prefix.length + 1);
    return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0) + 1;
  while (used.has(`${prefix}-${String(sequence).padStart(3, "0")}`)) sequence += 1;
  return `${prefix}-${String(sequence).padStart(3, "0")}`;
}

/** Error thrown when a sell-by-money product carries bad price-tiers JSON. */
const PRICE_TIERS_ERROR = "รูปแบบราคาสั้นๆ (price tiers) ไม่ถูกต้อง";

/** 0/1 coercion for quickPick — accepts boolean or 0/1 from any caller. */
const toQuickPickFlag = (value: number | boolean | null | undefined) => (value === 1 || value === true ? 1 : 0);

/**
 * Guard for sell-by-money products (round 31-12): priceTiers must be valid
 * JSON — a non-empty array of { label: string, price: number > 0, qty: number > 0 }.
 */
function assertValidPriceTiers(raw: string | null): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    throw new StoreError(PRICE_TIERS_ERROR);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new StoreError(PRICE_TIERS_ERROR);
  const labels = new Set<string>();
  for (const tier of parsed) {
    if (typeof tier !== "object" || tier === null || Array.isArray(tier)) throw new StoreError(PRICE_TIERS_ERROR);
    const { label, price, qty } = tier as { label?: unknown; price?: unknown; qty?: unknown };
    if (
      typeof label !== "string" ||
      !label.trim() ||
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price <= 0 ||
      typeof qty !== "number" ||
      !Number.isFinite(qty) ||
      qty <= 0
    ) {
      throw new StoreError(PRICE_TIERS_ERROR);
    }
    if (labels.has(label.trim())) throw new StoreError("ชื่อช่องราคาซ้ำกัน กรุณาใช้ชื่อไม่ซ้ำ");
    labels.add(label.trim());
  }
}

export function createProduct(db: SqliteDb, input: CreateProductInput): SqliteProduct {
  const name = input.name?.trim();
  if (!name) throw new StoreError("กรุณาระบุชื่อสินค้า");
  // ROUND 54 (user) — อนุญาตราคา ฿0 = "ยังไม่ได้ตั้งราคา" (สินค้านำเข้า 120 รายการยังไม่มีราคา
  // ต้องแก้ชื่อ/ขนาด/หน่วยได้ก่อน โดยยังไม่ต้องใส่ราคา) — ห้ามติดลบเท่านั้น
  if (!Number.isFinite(input.price) || input.price < 0) throw new StoreError("ราคาขายต้องเป็นตัวเลข 0 ขึ้นไป");
  if (input.cost !== undefined && (!Number.isFinite(input.cost) || input.cost < 0)) throw new StoreError("ต้นทุนต้องเป็นตัวเลข 0 ขึ้นไป");
  if (input.reorderPoint !== undefined && (!Number.isInteger(input.reorderPoint) || input.reorderPoint < 0)) throw new StoreError("จุดสั่งซื้อต้องเป็นจำนวนเต็ม 0 ขึ้นไป");
  if (input.stock !== undefined && (!Number.isInteger(input.stock) || input.stock < 0)) throw new StoreError("จำนวนสต็อกเริ่มต้นไม่ถูกต้อง");
  const sellMode = input.sellMode ?? "unit";
  const quickPick = toQuickPickFlag(input.quickPick);
  const priceTiers = input.priceTiers?.trim() || null;
  if (sellMode === "money") assertValidPriceTiers(priceTiers);
  const sku = input.sku?.trim() || generateSku(db, input.category?.trim() || "ของใช้");
  if (db.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku)) {
    throw new StoreError(`รหัสสินค้า ${sku} ถูกใช้แล้ว กรุณาระบุรหัสอื่น`);
  }
  const result = db.prepare(`INSERT INTO products (sku, barcode, name, category, emoji, color, size, image_url, unit, price, cost, stock, reorder_point, quick_pick, sell_mode, price_tiers, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
    sku,
    input.barcode?.trim() || null,
    name,
    input.category?.trim() || "ของใช้",
    input.emoji ?? null,
    input.color ?? null,
    input.size?.trim() || null,
    input.imageUrl || null,
    input.unit?.trim() || "ชิ้น",
    round2(input.price),
    round2(input.cost ?? 0),
    input.stock ?? 0,
    input.reorderPoint ?? 10,
    quickPick,
    sellMode,
    priceTiers,
  );
  logAction(db, "เพิ่มสินค้า", input.actor?.trim() || "ระบบ", `${name} (${sku})`, "green", input.actorRole ?? null);
  return getProductById(db, Number(result.lastInsertRowid))!;
}

/**
 * ROUND 77 (user) — รับเข้าสินค้า "ต้นทุนต่างกันแต่ละรอบ" ได้:
 * สินค้าชนิดเดียวกัน รอบละราคาไม่เท่ากัน (เช่น รอบนี้ 10 ห่อ @฿200 แถมอีก 2 ห่อ)
 * ต้นทุนที่ fix คงที่ใช้ไม่ได้ → ระบบเก็บเป็น "ต้นทุนถัวเฉลี่ย" (weighted average):
 * ผสมมูลค่าของเดิมในคลังกับทุกบรรทัดที่รับเข้ารอบนี้ บรรทัดแถม (ต้นทุน ฿0) จะดึง
 * ค่าเฉลี่ยลงให้เอง — รายงานกำไรจึงถูกต้องตามของจริงเสมอ
 */
export type ReceiveStockLine = { qty: number; cost?: number };

export type ReceiveStockLotRow = { id: number; productId: number; lot: string; expiry: string | null; qty: number; cost: number; receivedAt: string };

export type ReceiveStockResult = {
  /** ทุกบรรทัดที่รับเข้ารอบนี้ (แต่ละบรรทัด = 1 stock_lot ใช้ Lot เดียวกัน) */
  lots: ReceiveStockLotRow[];
  /** บรรทัดแรก — ผู้เรียกแบบเดิม (บรรทัดเดียว) ยังอ่านได้ตามรูปเก่า */
  lot: ReceiveStockLotRow;
  product: SqliteProduct;
  /** ต้นทุนถัวเฉลี่ยใหม่ที่เก็บในสินค้า (ของเดิมในคลัง + ทุกบรรทัดรอบนี้) */
  averageCost: number;
  /** ต้นทุนเฉลี่ยก่อนรับเข้ารอบนี้ */
  previousCost: number;
};

export function nextStockLotNumber(db: SqliteDb) {
  const prefix = `LOT-${formatDate()}-`;
  const labels = db.prepare("SELECT lot FROM stock_lots WHERE lot LIKE ?").all(`${prefix}%`) as unknown as { lot: string }[];
  const sequence = labels.reduce((max, row) => {
    const suffix = row.lot.slice(prefix.length);
    return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0) + 1;
  return { prefix, sequence, lot: prefix + String(sequence).padStart(4, "0") };
}

export function receiveStockLines(
  db: SqliteDb,
  input: { productId: number; lot?: string; expiryDate?: string | null; lines: (ReceiveStockLine | null | undefined)[] | null | undefined; paidAmount?: number; actor?: string; actorRole?: string },
  insideTransaction = false,
): ReceiveStockResult {
  const lines = (input.lines ?? []).filter((line): line is ReceiveStockLine => line != null);
  if (lines.length === 0) throw new StoreError("กรุณาระบุจำนวนที่รับเข้าอย่างน้อย 1 บรรทัด");
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) throw new StoreError("จำนวนต้องมากกว่า 0");
    if (line.cost !== undefined && !(line.cost >= 0)) throw new StoreError("ต้นทุนต่อหน่วยต้องเป็นตัวเลข 0 ขึ้นไป");
  }
  const product = getProductById(db, input.productId);
  if (!product || !product.active) throw new StoreError(`ไม่พบสินค้ารหัส ${input.productId} ในระบบ`);
  const parsed = lines.map((line) => ({ qty: line.qty, cost: line.cost === undefined ? undefined : round2(line.cost) }));
  const totalQty = parsed.reduce((sum, line) => sum + line.qty, 0);
  const receiptValue = input.paidAmount === undefined
    ? Math.round(lines.reduce((sum, line) => sum + line.qty * (line.cost ?? product.cost), 0) * 100)
    : Math.round(input.paidAmount * 100);
  if (!Number.isSafeInteger(receiptValue) || receiptValue < 0) throw new StoreError("มูลค่ารับเข้าไม่ถูกต้อง");
  const previousCost = product.cost;
  // บรรทัดที่ไม่ใส่ต้นทุน = ใช้ต้นทุนเฉลี่ยปัจจุบันของสินค้า (พฤติกรรมเดิม)
  const lineValue = receiptValue / 100;
  const oldQty = Math.max(0, Math.trunc(product.stock));
  const averageCost = round2((oldQty * previousCost + lineValue) / (oldQty + totalQty));
  let lotLabel = input.lot?.trim() || "";
  const createdAt = formatDateTime();
  const writeReceipt = () => {
    if (!lotLabel) {
      lotLabel = nextStockLotNumber(db).lot;
    }
    const insert = db.prepare(`INSERT INTO stock_lots (product_id, lot, expiry_date, qty, cost, received_at, received_qty, received_value_satang, remaining_value_satang) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let valueRemaining = BigInt(receiptValue);
    let qtyRemaining = totalQty;
    const lots = parsed.map((line) => {
      const allocation = allocateInventoryCost(valueRemaining, qtyRemaining, line.qty);
      const value = Number(allocation.issuedValueSatang);
      valueRemaining = allocation.remainingValueSatang;
      qtyRemaining = allocation.remainingQuantity;
      const result = insert.run(input.productId, lotLabel, input.expiryDate || null, line.qty, line.cost ?? previousCost, createdAt, line.qty, value, value);
      return { id: Number(result.lastInsertRowid), productId: input.productId, lot: lotLabel, expiry: input.expiryDate || null, qty: line.qty, cost: line.cost ?? previousCost, receivedAt: createdAt };
    });
    db.prepare(`UPDATE products SET stock = stock + ?, cost = ? WHERE id = ?`).run(totalQty, averageCost, input.productId);
    for (const lot of lots) {
      recordMovement(db, { type: 'RECEIVE', productId: input.productId, qtyDelta: lot.qty, unitCost: lot.cost, refType: 'stock_lot', refId: lot.id, reason: `รับเข้า Lot ${lotLabel}`, actor: input.actor?.trim() || undefined, actorRole: input.actorRole ?? undefined });
    }
    // Log: บรรทัดเดียวไม่ใส่ต้นทุน = ข้อความเดิม · มีต้นทุน/หลายบรรทัด = สรุปทุกบรรทัด + ต้นทุนเฉลี่ยใหม่
    const anyCost = parsed.some((line) => line.cost !== undefined);
    const lineSummary = anyCost ? ` · ${parsed.map((line) => `${line.qty}×${money(line.cost ?? previousCost)}${line.cost === 0 ? " แถม" : ""}`).join(" + ")}` : "";
    const avgSummary = anyCost ? ` · ต้นทุนเฉลี่ย ${money(averageCost)} (เดิม ${money(previousCost)})` : "";
    logAction(db, "รับเข้าสินค้า", input.actor?.trim() || "ระบบ", `${product.name} · Lot ${lotLabel} · +${totalQty} ${product.unit}${lineSummary}${avgSummary}`, "green", input.actorRole ?? null, createdAt);
    return { lots, lot: lots[0], product: getProductById(db, input.productId)!, averageCost, previousCost };
  };
  return insideTransaction ? writeReceipt() : runInTransaction(db, writeReceipt);
}

export type StockIntakeEntry = {
  productId?: number;
  newProduct?: CreateProductInput;
  purchaseQty: number;
  freeQty?: number;
  paidAmount: number;
  lot?: string;
  expiryDate?: string | null;
};

/** Create catalog entries and their receipts together, or roll back the entire intake. */
export function receiveStockBatch(db: SqliteDb, entries: StockIntakeEntry[], actor: string, actorRole?: string) {
  if (entries.length === 0 || entries.length > 200) throw new StoreError("จำนวนรายการรับเข้าต้องอยู่ระหว่าง 1–200 รายการ");
  return runInTransaction(db, () => entries.map((entry) => {
    if (Boolean(entry.productId) === Boolean(entry.newProduct)) throw new StoreError("เลือกรายการสินค้าเดิมหรือสินค้าใหม่อย่างใดอย่างหนึ่ง");
    if (!Number.isInteger(entry.purchaseQty) || entry.purchaseQty <= 0 || !Number.isInteger(entry.freeQty ?? 0) || (entry.freeQty ?? 0) < 0 || !Number.isFinite(entry.paidAmount) || entry.paidAmount < 0) throw new StoreError("จำนวนรับเข้าหรือยอดจ่ายไม่ถูกต้อง");
    if (entry.newProduct?.stock) throw new StoreError("สินค้าใหม่ต้องไม่มีสต็อกตั้งต้นในรายการรับเข้า");
    if (entry.newProduct?.barcode?.trim() && db.prepare("SELECT id FROM products WHERE barcode = ? OR sku = ?").get(entry.newProduct.barcode.trim(), entry.newProduct.barcode.trim())) throw new StoreError("บาร์โค้ดนี้มีสินค้าอยู่แล้ว กรุณาเลือกสินค้าเดิม");
    const productId = entry.newProduct ? createProduct(db, { ...entry.newProduct, stock: 0, actor, actorRole }).id : entry.productId!;
    return receiveStockLines(db, { productId, lot: entry.lot, expiryDate: entry.expiryDate, paidAmount: entry.paidAmount, actor, actorRole, lines: [{ qty: entry.purchaseQty, cost: entry.paidAmount / entry.purchaseQty }, ...((entry.freeQty ?? 0) > 0 ? [{ qty: entry.freeQty!, cost: 0 }] : [])] }, true);
  }));
}

export function receiveStock(
  db: SqliteDb,
  productId: number,
  lot: string,
  expiryDate: string | null,
  qty: number,
  cost?: number,
  actor?: string,
  actorRole?: string,
) {
  const result = receiveStockLines(db, { productId, lot, expiryDate, lines: [{ qty, cost }], actor, actorRole });
  // รูปเอาต์พุตเดิม { lot, product } + เผื่อ averageCost ไว้ให้ผู้เรียกรุ่นใหม่
  return { lot: result.lot, product: result.product, averageCost: result.averageCost };
}

export function stockReceiptHistory(db: SqliteDb, input: { from?: string; to?: string; search?: string; actor?: string } = {}) {
  return db.prepare(`SELECT l.id, p.sku, p.name, p.unit, l.lot,
    l.received_at AS receivedAt, l.received_qty AS receivedQty,
    l.expiry_date AS expiry, l.cost, p.price AS sellingPrice,
    ROUND(l.received_qty * p.price, 2) AS sellingValue, m.actor,
    CASE WHEN m.id IS NOT NULL THEN l.received_qty * m.unit_cost ELSE NULL END AS value
    FROM stock_lots l JOIN products p ON p.id = l.product_id
    LEFT JOIN stock_movements m ON m.ref_type = 'stock_lot' AND m.ref_id = l.id AND m.type = 'RECEIVE'
    WHERE (? = '' OR substr(l.received_at, 1, 10) >= ?)
      AND (? = '' OR substr(l.received_at, 1, 10) <= ?)
      AND (? = '' OR instr(lower(p.name || ' ' || p.sku || ' ' || l.lot), lower(?)) > 0)
      AND (? = '' OR instr(lower(coalesce(m.actor, '')), lower(?)) > 0)
    ORDER BY l.received_at DESC, l.id DESC`).all(
      input.from ?? '', input.from ?? '', input.to ?? '', input.to ?? '',
      input.search?.trim() ?? '', input.search?.trim() ?? '', input.actor?.trim() ?? '', input.actor?.trim() ?? ''
    ) as { id: number; sku: string; name: string; unit: string; lot: string; receivedAt: string; receivedQty: number; expiry: string | null; cost: number; sellingPrice: number; sellingValue: number; actor: string | null; value: number | null }[];
}

export function listStockRows(db: SqliteDb): SqliteStockRow[] {
  const rows = db.prepare(`SELECT l.id, p.id AS productId, p.sku, p.name, p.unit, l.lot, l.expiry_date AS expiry, l.qty, l.cost, p.price, p.stock, p.reorder_point AS reorderPoint, l.received_at AS receivedAt, p.active AS active FROM stock_lots l JOIN products p ON p.id = l.product_id ORDER BY p.sku, l.id`).all() as unknown as (Omit<SqliteStockRow, "status" | "tone">)[];
  const today = startOfToday();
  return rows.map((row) => {
    let status: SqliteStockRow["status"] = "ปกติ";
    let tone: SqliteStockRow["tone"] = "green";
    if (!row.active) {
      status = "ปิดการขาย";
      tone = "purple";
    } else if (row.stock <= row.reorderPoint) {
      status = "สต็อกต่ำ";
      tone = "red";
    } else if (row.expiry) {
      const daysLeft = Math.floor((Date.parse(`${row.expiry}T00:00:00`) - today.getTime()) / 86400000);
      if (daysLeft <= 30) {
        status = "ใกล้หมดอายุ";
        tone = "amber";
      }
    }
    return { ...row, status, tone };
  });
}

export type StockCountInput = {
  productId: number;
  countedQty: number;
  note?: string;
  actor?: string;
  actorRole?: string;
};

/** Reconciles the authoritative products.stock with a physical count. */
export function stockCount(db: SqliteDb, input: StockCountInput) {
  if (!Number.isInteger(input.countedQty) || input.countedQty < 0) throw new StoreError("จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป");
  const product = getProductById(db, input.productId);
  if (!product || !product.active) throw new StoreError(`ไม่พบสินค้ารหัส ${input.productId} ในระบบ`);
  const diff = input.countedQty - product.stock;
  if (diff !== 0 && db.prepare(`SELECT 1 FROM stock_lots WHERE product_id = ? AND received_value_satang IS NOT NULL`).get(input.productId)) {
    throw new StoreError("สินค้าที่มีมูลค่ารายล็อตต้องนับสต็อกแยกล็อต เพื่อรักษาจำนวนและต้นทุนให้ตรงกัน");
  }
  const note = input.note?.trim();
  const detail =
    (diff === 0
      ? `${product.name} · ตรงตามระบบ ${input.countedQty} ${product.unit}`
      : `${product.name} · ระบบ ${product.stock} → นับได้ ${input.countedQty} ${product.unit} (${diff})`) + (note ? ` · ${note}` : "");
  const tone = diff < 0 ? "red" : diff > 0 ? "green" : "blue";
  runInTransaction(db, () => {
    db.prepare(`UPDATE products SET stock = ? WHERE id = ?`).run(input.countedQty, input.productId);
    recordMovement(db, { type: 'COUNT', productId: input.productId, qtyDelta: diff, unitCost: product.cost, refType: 'count', reason: `นับสต็อก: ระบบ ${product.stock} → นับ ${input.countedQty}`, actor: input.actor?.trim() || undefined, actorRole: input.actorRole ?? undefined });
    logAction(db, "นับสต็อก", input.actor?.trim() || "เจ้าหน้าที่ร้านค้า", detail, tone, input.actorRole ?? null, formatDateTime());
  });
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    unit: product.unit,
    systemQty: product.stock,
    countedQty: input.countedQty,
    diff,
    product: getProductById(db, input.productId)!,
  };
}

export type LotCountEntry = { lotId: number; countedQty: number };

export type StockCountLotsInput = {
  counts: LotCountEntry[];
  note?: string;
  actor?: string;
  actorRole?: string;
};

export type StockCountLotResult = {
  lotId: number;
  lot: string;
  expiry: string | null;
  systemQty: number;
  countedQty: number;
  diff: number;
};

export type StockCountLotsResult = {
  productId: number;
  sku: string;
  name: string;
  unit: string;
  systemQty: number;
  countedQty: number;
  diff: number;
  lots: StockCountLotResult[];
};

/**
 * Reconciles physical counts PER LOT: each listed lot's qty is set to its
 * counted value, then the product's sellable stock is recomputed as the SUM
 * of all its lots (lots not listed keep their current qty). One audit entry
 * per product records every lot old→new plus the product total.
 */
export function stockCountLots(db: SqliteDb, input: StockCountLotsInput): StockCountLotsResult {
  if (!Array.isArray(input.counts) || input.counts.length === 0) {
    throw new StoreError("กรุณาระบุจำนวนที่นับได้อย่างน้อย 1 Lot");
  }
  const seen = new Set<number>();
  for (const entry of input.counts) {
    if (!Number.isInteger(entry.lotId)) throw new StoreError("รหัส Lot ไม่ถูกต้อง");
    if (!Number.isInteger(entry.countedQty) || entry.countedQty < 0) {
      throw new StoreError("จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป");
    }
    if (seen.has(entry.lotId)) throw new StoreError("พบ Lot ซ้ำในรายการนับ กรุณาตรวจสอบอีกครั้ง");
    seen.add(entry.lotId);
  }

  const lotSelect = `SELECT l.id, l.lot, l.expiry_date AS expiry, l.qty, p.id AS productId, p.sku, p.name, p.unit, p.stock, p.active FROM stock_lots l JOIN products p ON p.id = l.product_id`;
  const lots = input.counts.map((entry) => {
    const lot = db.prepare(`${lotSelect} WHERE l.id = ?`).get(entry.lotId) as
      | { id: number; lot: string; expiry: string | null; qty: number; productId: number; sku: string; name: string; unit: string; stock: number; active: number }
      | undefined;
    if (!lot) throw new StoreError(`ไม่พบ Lot รหัส ${entry.lotId} ในระบบ`);
    return { lot, countedQty: entry.countedQty };
  });

  // A single count session covers exactly one product (the UI enforces it;
  // the server double-checks so mixed submissions can never corrupt stock).
  const productIds = new Set(lots.map((item) => item.lot.productId));
  if (productIds.size !== 1) {
    throw new StoreError("การนับแยกตาม Lot ทำได้ครั้งละ 1 สินค้า");
  }
  const head = lots[0]!.lot;
  if (!head.active) throw new StoreError(`ไม่พบสินค้ารหัส ${head.productId} ในระบบ`);

  const note = input.note?.trim();
  return runInTransaction(db, () => {
    const results: StockCountLotResult[] = [];
    for (const { lot, countedQty } of lots) {
      const valuation = db.prepare(`SELECT remaining_value_satang AS value FROM stock_lots WHERE id = ?`).get(lot.id) as { value: number | null };
      if (valuation.value !== null && countedQty !== lot.qty) {
        if (countedQty > lot.qty) throw new StoreError("ล็อตที่นับเกินต้องตรวจสอบมูลค่าก่อนปรับเพิ่ม กรุณารับเข้าเป็นล็อตปรับปรุงพร้อมมูลค่าที่ตรวจสอบแล้ว");
        const allocation = allocateInventoryCost(BigInt(valuation.value), lot.qty, lot.qty - countedQty);
        db.prepare(`UPDATE stock_lots SET remaining_value_satang = ? WHERE id = ?`).run(Number(allocation.remainingValueSatang), lot.id);
        db.prepare(`INSERT INTO lot_value_adjustments (lot_id, qty_delta, value_delta_satang, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(lot.id, countedQty - lot.qty, -Number(allocation.issuedValueSatang), input.note?.trim() || "นับสต็อกแยกล็อต", input.actor ?? null, formatDateTime());
      }
      db.prepare(`UPDATE stock_lots SET qty = ? WHERE id = ?`).run(countedQty, lot.id);
      results.push({ lotId: lot.id, lot: lot.lot, expiry: lot.expiry, systemQty: lot.qty, countedQty, diff: countedQty - lot.qty });
    }
    // Recompute sellable stock from every lot of this product.
    const { total } = db.prepare(`SELECT COALESCE(SUM(qty), 0) AS total FROM stock_lots WHERE product_id = ?`).get(head.productId) as { total: number };
    db.prepare(`UPDATE products SET stock = ? WHERE id = ?`).run(total, head.productId);

    const lotBreakdown = results
      .map((result) => `${result.lot}: ${result.systemQty} → ${result.countedQty}${result.diff !== 0 ? ` (${result.diff > 0 ? "+" : ""}${result.diff})` : ""}`)
      .join(" · ");
    const detail = `${head.name} · รวม ${head.stock} → ${total} ${head.unit} (${total - head.stock}) · ${lotBreakdown}` + (note ? ` · ${note}` : "");
    const tone = total < head.stock ? "red" : total > head.stock ? "green" : "blue";
    logAction(db, "นับสต็อก (แยกล็อต)", input.actor?.trim() || "เจ้าหน้าที่ร้านค้า", detail, tone, input.actorRole ?? null, formatDateTime());

    return {
      productId: head.productId,
      sku: head.sku,
      name: head.name,
      unit: head.unit,
      systemQty: head.stock,
      countedQty: total,
      diff: total - head.stock,
      lots: results,
    };
  });
}

// --- order list (รายการสั่งซื้อ — round 32-15) --------------------------------

export type SqliteOrderItem = {
  id: number;
  productId: number;
  sku: string;
  name: string;
  unit: string;
  category: string;
  cost: number;
  stock: number;
  reorderPoint: number;
  qty: number;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
};

const ORDER_ITEM_SELECT = `SELECT o.id, o.qty, o.note, o.created_by AS createdBy, o.created_at AS createdAt, p.id AS productId, p.sku, p.name, p.unit, p.category, p.cost, p.stock, p.reorder_point AS reorderPoint FROM order_list_items o JOIN products p ON p.id = o.product_id`;

export function listOrderItems(db: SqliteDb): SqliteOrderItem[] {
  return db.prepare(`${ORDER_ITEM_SELECT} ORDER BY o.id ASC`).all() as SqliteOrderItem[];
}

export type OrderAddInput = {
  productId: number;
  qty?: number;
  note?: string;
  actor?: string;
  actorRole?: string;
};

/** Adds (or merges +qty when the product is already on the list) an order row. */
export function addOrderItem(db: SqliteDb, input: OrderAddInput): SqliteOrderItem[] {
  const qty = input.qty === undefined ? 1 : input.qty;
  if (!Number.isFinite(qty) || qty <= 0) throw new StoreError("จำนวนที่จะสั่งซื้อต้องมากกว่า 0");
  const product = getProductById(db, input.productId);
  if (!product) throw new StoreError(`ไม่พบสินค้ารหัส ${input.productId} ในระบบ`);
  const actor = input.actor?.trim() || "เจ้าหน้าที่ร้านค้า";
  runInTransaction(db, () => {
    const existing = db.prepare(`SELECT id, qty FROM order_list_items WHERE product_id = ?`).get(input.productId) as { id: number; qty: number } | undefined;
    const note = input.note?.trim() || null;
    if (existing) {
      db.prepare(`UPDATE order_list_items SET qty = ?, note = COALESCE(?, note) WHERE id = ?`).run(existing.qty + qty, note, existing.id);
    } else {
      db.prepare(`INSERT INTO order_list_items (product_id, qty, note, created_by) VALUES (?, ?, ?, ?)`).run(input.productId, qty, note, actor);
    }
    logAction(db, "ขอสั่งซื้อสินค้า", actor, `${product.name} · ${qty} ${product.unit} · คงเหลือ ${product.stock} ${product.unit}`, "amber", input.actorRole ?? null, formatDateTime());
  });
  return listOrderItems(db);
}

export type OrderUpdateInput = {
  id: number;
  qty?: number;
  note?: string | null;
  actor?: string;
  actorRole?: string;
};

export function updateOrderItem(db: SqliteDb, input: OrderUpdateInput): SqliteOrderItem[] {
  const existing = db.prepare(`${ORDER_ITEM_SELECT} WHERE o.id = ?`).get(input.id) as SqliteOrderItem | undefined;
  if (!existing) throw new StoreError("ไม่พบรายการสั่งซื้อนี้ในระบบ (อาจถูกลบไปแล้ว)");
  if (input.qty !== undefined && (!Number.isFinite(input.qty) || input.qty <= 0)) throw new StoreError("จำนวนที่จะสั่งซื้อต้องมากกว่า 0");
  const actor = input.actor?.trim() || "เจ้าหน้าที่ร้านค้า";
  runInTransaction(db, () => {
    db.prepare(`UPDATE order_list_items SET qty = ?, note = ? WHERE id = ?`).run(
      input.qty ?? existing.qty,
      input.note === undefined ? existing.note : input.note,
      input.id,
    );
    logAction(db, "แก้ไขรายการสั่งซื้อ", actor, `${existing.name} · ${input.qty ?? existing.qty} ${existing.unit}`, "blue", input.actorRole ?? null, formatDateTime());
  });
  return listOrderItems(db);
}

export function removeOrderItem(db: SqliteDb, input: { id: number; actor?: string; actorRole?: string }): SqliteOrderItem[] {
  const existing = db.prepare(`${ORDER_ITEM_SELECT} WHERE o.id = ?`).get(input.id) as SqliteOrderItem | undefined;
  if (!existing) return listOrderItems(db);
  const actor = input.actor?.trim() || "เจ้าหน้าที่ร้านค้า";
  runInTransaction(db, () => {
    db.prepare(`DELETE FROM order_list_items WHERE id = ?`).run(input.id);
    logAction(db, "ถอดออกจากรายการสั่งซื้อ", actor, `${existing.name} · ${existing.qty} ${existing.unit}`, "purple", input.actorRole ?? null, formatDateTime());
  });
  return listOrderItems(db);
}

/** Clears the whole list — used after the order has been placed/received. */
export function clearOrderList(db: SqliteDb, input: { actor?: string; actorRole?: string }): SqliteOrderItem[] {
  const items = listOrderItems(db);
  if (items.length === 0) return items;
  const actor = input.actor?.trim() || "เจ้าหน้าที่ร้านค้า";
  runInTransaction(db, () => {
    db.prepare(`DELETE FROM order_list_items`).run();
    logAction(db, "ล้างรายการสั่งซื้อ", actor, `ล้าง ${items.length} รายการ (สั่งซื้อ/ตรวจสอบแล้ว)`, "green", input.actorRole ?? null, formatDateTime());
  });
  return listOrderItems(db);
}

export type UpdateProductInput = {
  productId: number;
  name?: string;
  barcode?: string | null;
  size?: string | null;
  imageUrl?: string | null;
  /** 1 = สินค้าลัดหน้าร้าน (boolean ก็รับแล้วแปลงเป็น 0/1) */
  quickPick?: number | boolean | null;
  /** "unit" (default) | "money" — ขายเป็นเงินใช้ priceTiers */
  sellMode?: "unit" | "money" | null;
  /** JSON [{ label, price, qty }] สำหรับ sellMode "money" */
  priceTiers?: string | null;
  unit?: string;
  price?: number;
  cost?: number;
  reorderPoint?: number;
  category?: string;
  emoji?: string;
  actor?: string;
  actorRole?: string;
};

/** Updates only the provided product fields. Undefined keeps the current value; only fields whose value actually changed are written/logged. */
export function updateProduct(db: SqliteDb, input: UpdateProductInput): SqliteProduct {
  const product = getProductById(db, input.productId);
  if (!product) throw new StoreError(`ไม่พบสินค้ารหัส ${input.productId} ในระบบ`);
  if (input.name !== undefined && !input.name.trim()) throw new StoreError("กรุณาระบุชื่อสินค้า");
  if (input.unit !== undefined && !input.unit.trim()) throw new StoreError("กรุณาระบุหน่วยสินค้า");
  if (input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0)) throw new StoreError("ราคาขายต้องเป็นตัวเลข 0 ขึ้นไป");
  if (input.cost !== undefined && (!Number.isFinite(input.cost) || input.cost < 0)) throw new StoreError("ต้นทุนต้องเป็น 0 ขึ้นไป");
  if (input.reorderPoint !== undefined && (!Number.isInteger(input.reorderPoint) || input.reorderPoint < 0)) throw new StoreError("จุดสั่งซื้อต้องเป็นจำนวนเต็ม 0 ขึ้นไป");

  // Resolved values for the new round-31-12 fields: undefined keeps the stored
  // value; null sellMode falls back to the "unit" default. Money-mode
  // products must carry a valid price-tiers payload (new or already stored).
  const nextQuickPick = toQuickPickFlag(input.quickPick);
  const nextSellMode = input.sellMode !== undefined ? (input.sellMode ?? "unit") : (product.sellMode ?? "unit");
  const nextPriceTiers = input.priceTiers !== undefined ? (input.priceTiers?.trim() || null) : product.priceTiers;
  if (nextSellMode === "money") assertValidPriceTiers(nextPriceTiers);

  const assignments: string[] = [];
  const values: (string | number | null)[] = [];
  const changedLabels: string[] = [];
  const normalizeEmoji = (value: string | undefined) => value?.trim() || null;

  if (input.name !== undefined && input.name.trim() !== product.name) {
    assignments.push("name = ?");
    values.push(input.name.trim());
    changedLabels.push("ชื่อ");
  }
  if (input.unit !== undefined && input.unit.trim() !== product.unit) {
    assignments.push("unit = ?");
    values.push(input.unit.trim());
    changedLabels.push("หน่วย");
  }
  if (input.price !== undefined && round2(input.price) !== product.price) {
    assignments.push("price = ?");
    values.push(round2(input.price));
    changedLabels.push("ราคาขาย");
  }
  if (input.cost !== undefined && round2(input.cost) !== product.cost) {
    assignments.push("cost = ?");
    values.push(round2(input.cost));
    changedLabels.push("ต้นทุน");
  }
  if (input.reorderPoint !== undefined && input.reorderPoint !== product.reorderPoint) {
    assignments.push("reorder_point = ?");
    values.push(input.reorderPoint);
    changedLabels.push("จุดสั่งซื้อ");
  }
  if (input.category !== undefined && input.category.trim() !== product.category) {
    assignments.push("category = ?");
    values.push(input.category.trim());
    changedLabels.push("หมวดหมู่");
  }
  if (input.emoji !== undefined && normalizeEmoji(input.emoji) !== product.emoji) {
    assignments.push("emoji = ?");
    values.push(normalizeEmoji(input.emoji));
    changedLabels.push("สัญลักษณ์");
  }
  if (input.barcode !== undefined && (input.barcode?.trim() || null) !== product.barcode) {
    assignments.push("barcode = ?");
    values.push(input.barcode?.trim() || null);
    changedLabels.push("บาร์โค้ด");
  }
  if (input.size !== undefined && (input.size?.trim() || null) !== product.size) {
    assignments.push("size = ?");
    values.push(input.size?.trim() || null);
    changedLabels.push("ขนาด");
  }
  if (input.imageUrl !== undefined && (input.imageUrl || null) !== product.imageUrl) {
    assignments.push("image_url = ?");
    values.push(input.imageUrl || null);
    changedLabels.push("รูปสินค้า");
  }
  if (input.quickPick !== undefined && nextQuickPick !== product.quickPick) {
    assignments.push("quick_pick = ?");
    values.push(nextQuickPick);
    changedLabels.push("สินค้าลัดหน้าร้าน");
  }
  if (input.sellMode !== undefined && nextSellMode !== (product.sellMode ?? "unit")) {
    assignments.push("sell_mode = ?");
    values.push(nextSellMode);
    changedLabels.push("วิธีขาย");
  }
  if (input.priceTiers !== undefined && nextPriceTiers !== product.priceTiers) {
    assignments.push("price_tiers = ?");
    values.push(nextPriceTiers);
    changedLabels.push("ราคาสั้นๆ");
  }

  const displayName = input.name?.trim() || product.name;
  const changeSummary = changedLabels.length > 0 ? `แก้ไข: ${changedLabels.join(", ")}` : "ตรวจสอบข้อมูลแล้ว · ไม่มีการเปลี่ยนแปลง";
  const detail = `${product.sku} · ${displayName} · ${changeSummary}`;

  runInTransaction(db, () => {
    if (assignments.length > 0) {
      db.prepare(`UPDATE products SET ${assignments.join(", ")} WHERE id = ?`).run(...values, input.productId);
    }
    logAction(db, "แก้ไขสินค้า", input.actor?.trim() || "เจ้าหน้าที่ร้านค้า", detail, "blue", input.actorRole ?? null, formatDateTime());
  });
  return getProductById(db, input.productId)!;
}

export type BulkPriceItemInput = {
  productId: number;
  price?: number;
  cost?: number;
};

export type BulkUpdatePricesInput = {
  items: BulkPriceItemInput[];
  actor?: string;
  actorRole?: string;
};

export type BulkUpdatePricesResult = {
  updated: number;
  priceChanges: number;
  costChanges: number;
  skipped: number;
  /** ตัวอย่างชื่อสินค้าที่แก้ (ใช้ทำ toast สรุป) */
  sampleNames: string[];
};

/**
 * Round 64 — ปรับราคาขาย/ต้นทุนหลายรายการพร้อมกันใน transaction เดียว
 * (use case จริง: ร้านใหม่มีสินค้า 100+ รายการที่ยังไม่มีราคา)
 * - validate ทุกรายการก่อนแตะ DB (fail fast — ไม่มีการแก้ครึ่งชุด)
 * - รายการที่ค่าเท่าเดิมถูกนับเป็น skipped (ไม่เขียน DB ไม่ลง log ต่อชิ้น)
 * - ลง log สรุปก้อนเดียว กันปนคอมไพล์ log หลายร้อยแถว
 */
export function bulkUpdateProductPrices(db: SqliteDb, input: BulkUpdatePricesInput): BulkUpdatePricesResult {
  if (input.items.length === 0) throw new StoreError("กรุณาเลือกรายการที่ต้องการปรับราคาอย่างน้อย 1 รายการ");
  if (input.items.length > 500) throw new StoreError("ปรับราคาได้ครั้งละไม่เกิน 500 รายการ");

  // 1) ตรวจทุกรายการก่อน — ผิดสักชิ้นเดียวโยนทิ้งทั้งชุด (ไม่มี partial write)
  const seen = new Set<number>();
  const prepared: Array<{ product: SqliteProduct; price: number | null; cost: number | null }> = [];
  for (const item of input.items) {
    if (seen.has(item.productId)) continue; // ซ้ำ (เช่น client ส่งมาสองแถว) — เอาแถวแรก
    seen.add(item.productId);
    const product = getProductById(db, item.productId);
    if (!product) throw new StoreError(`ไม่พบสินค้ารหัส ${item.productId} ในระบบ`);
    if (item.price !== undefined && !(item.price >= 0)) throw new StoreError(`ราคาขายของ "${product.name}" ต้องเป็นตัวเลข 0 ขึ้นไป`);
    if (item.cost !== undefined && item.cost < 0) throw new StoreError(`ต้นทุนของ "${product.name}" ต้องเป็นตัวเลข 0 ขึ้นไป`);
    const nextPrice = item.price !== undefined ? round2(item.price) : null;
    const nextCost = item.cost !== undefined ? round2(item.cost) : null;
    if (nextPrice !== null && nextPrice === product.price && nextCost !== null && nextCost === product.cost) continue;
    prepared.push({ product, price: nextPrice, cost: nextCost });
  }
  const willChange = (row: { product: SqliteProduct; price: number | null; cost: number | null }) =>
    (row.price !== null && row.price !== row.product.price) || (row.cost !== null && row.cost !== row.product.cost);
  const changing = prepared.filter(willChange);
  if (changing.length === 0) {
    return { updated: 0, priceChanges: 0, costChanges: 0, skipped: input.items.length, sampleNames: [] };
  }

  // 2) เขียนทั้งชุดใน transaction เดียว
  let priceChanges = 0;
  let costChanges = 0;
  const sampleNames: string[] = [];
  runInTransaction(db, () => {
    for (const row of changing) {
      const assignments: string[] = [];
      const values: (string | number | null)[] = [];
      if (row.price !== null && row.price !== row.product.price) {
        assignments.push("price = ?");
        values.push(row.price);
        priceChanges += 1;
        if (sampleNames.length < 3) sampleNames.push(row.product.name);
      }
      if (row.cost !== null && row.cost !== row.product.cost) {
        assignments.push("cost = ?");
        values.push(row.cost);
        costChanges += 1;
        if (sampleNames.length < 3 && !sampleNames.includes(row.product.name)) sampleNames.push(row.product.name);
      }
      if (assignments.length > 0) {
        db.prepare(`UPDATE products SET ${assignments.join(", ")} WHERE id = ?`).run(...values, row.product.id);
      }
    }
    const actor = input.actor?.trim() || "เจ้าหน้าที่ร้านค้า";
    const detail = `${changing.length} รายการ · แก้ราคาขาย ${priceChanges} · แก้ต้นทุน ${costChanges}${sampleNames.length > 0 ? ` · เช่น ${sampleNames.join(", ")}${changing.length > sampleNames.length ? " และอื่นๆ" : ""}` : ""}`;
    logAction(db, "ปรับราคาหลายรายการ", actor, detail, "blue", input.actorRole ?? null, formatDateTime());
  });

  return { updated: changing.length, priceChanges, costChanges, skipped: input.items.length - changing.length, sampleNames };
}

export type DeleteProductInput = {
  productId: number;
  actor?: string;
  actorRole?: string;
};

/**
 * Permanently removes a product and its remaining lots from the catalog.
 * Sale history keeps its own name/price snapshot, so old bills stay intact.
 */
export function deleteProduct(db: SqliteDb, input: DeleteProductInput): { deleted: true; name: string; sku: string } {
  const product = getProductById(db, input.productId);
  if (!product) throw new StoreError(`ไม่พบสินค้ารหัส ${input.productId} ในระบบ`);
  const saleRefs = db.prepare(`SELECT COUNT(*) AS n FROM sale_items WHERE product_id = ?`).get(input.productId) as { n: number };
  runInTransaction(db, () => {
    db.prepare(`DELETE FROM stock_lots WHERE product_id = ?`).run(input.productId);
    db.prepare(`DELETE FROM products WHERE id = ?`).run(input.productId);
    logAction(
      db,
      "ลบสินค้า",
      input.actor?.trim() || "ระบบ",
      `${product.name} (${product.sku}) · เหลือ ${product.stock} ${product.unit} ในคลัง · ปรากฏในประวัติขาย ${saleRefs.n} รายการ`,
      "red",
      input.actorRole ?? null,
    );
  });
  return { deleted: true, name: product.name, sku: product.sku };
}

export type SetProductActiveInput = {
  productId: number;
  active: boolean;
  actor?: string;
  actorRole?: string;
};

/** Archives (active = 0) or restores (active = 1) a product. Archived products keep their stock, lots and history. */
export function setProductActive(db: SqliteDb, input: SetProductActiveInput): SqliteProduct {
  const product = getProductById(db, input.productId);
  if (!product) throw new StoreError(`ไม่พบสินค้ารหัส ${input.productId} ในระบบ`);
  const nextActive = input.active ? 1 : 0;
  if (product.active === nextActive) return product;
  runInTransaction(db, () => {
    db.prepare(`UPDATE products SET active = ? WHERE id = ?`).run(nextActive, input.productId);
    logAction(
      db,
      input.active ? "เปิดขายสินค้า" : "ปิดการขายสินค้า",
      input.actor?.trim() || "เจ้าหน้าที่ร้านค้า",
      `${product.sku} · ${product.name} · คงเหลือ ${product.stock} ${product.unit}`,
      input.active ? "green" : "purple",
      input.actorRole ?? null,
      formatDateTime(),
    );
  });
  return getProductById(db, input.productId)!;
}

// --- POS checkout -----------------------------------------------------------

function yyMMdd(date: Date) {
  return `${String(date.getFullYear()).slice(-2)}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function nextOrderNumber(db: SqliteDb, date = new Date()) {
  const prefix = `RC-${yyMMdd(date)}-`;
  const row = db.prepare(`SELECT MAX(CAST(SUBSTR(order_number, 11) AS INTEGER)) AS maxSeq FROM sales WHERE order_number LIKE ?`).get(`${prefix}%`) as { maxSeq: number | null };
  return `${prefix}${String((row?.maxSeq ?? 0) + 1).padStart(3, "0")}`;
}

function summarizeItems(items: { name: string; qty: number; unit: string }[]) {
  const head = items.slice(0, 3).map((item) => `${item.name} ${item.qty} ${item.unit}`).join(", ");
  return items.length > 3 ? `${head} และอีก ${items.length - 3} รายการ` : head;
}

/** A catalog line references a product; a "รายการพิเศษ" line is a priced ad-hoc item with no product/stock behind it. */
export type CheckoutItemInput =
  | { productId: number; qty: number; price?: number; unit?: string; label?: string }
  | { name: string; price: number; qty: number; unit?: string };

/**
 * Deducts sold qty from the product's lots FEFO-style (first-expiry-first-out:
 * earliest expiry first, undated lots last, then oldest received, then lot id).
 * Records exact per-lot satang allocations. Checkout rejects shortfalls for
 * valued receipts and rolls back the transaction. Legacy, unvalued inventory
 * retains its estimated-cost fallback and audit warning.
 */
function deductLotsFifo(db: SqliteDb, productId: number, qty: number, saleItemId: number): { shortfall: number; costSatang: number } {
  const tracked = db.prepare(`SELECT COUNT(*) AS count FROM stock_lots WHERE product_id = ?`).get(productId) as { count: number };
  if (tracked.count === 0) {
    const product = getProductById(db, productId)!;
    return { shortfall: 0, costSatang: Math.round(qty * product.cost * 100) };
  }
  const lots = db.prepare(
    `SELECT id, qty, cost, remaining_value_satang AS value, received_value_satang AS receivedValue FROM stock_lots WHERE product_id = ? AND qty > 0 ORDER BY (expiry_date IS NULL), expiry_date, received_at, id`,
  ).all(productId) as unknown as { id: number; qty: number; cost: number; value: number | null; receivedValue: number | null }[];
  let remaining = qty;
  let costSatang = 0;
  const updateLot = db.prepare(`UPDATE stock_lots SET qty = qty - ?, remaining_value_satang = ? WHERE id = ?`);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qty, remaining);
    const allocation = allocateInventoryCost(BigInt(lot.value ?? Math.round(lot.qty * lot.cost * 100)), lot.qty, take);
    const issued = Number(allocation.issuedValueSatang);
    updateLot.run(take, Number(allocation.remainingValueSatang), lot.id);
    db.prepare(`INSERT INTO sale_lot_allocations (sale_item_id, lot_id, qty, cost_satang, valuation_source) VALUES (?, ?, ?, ?, ?)`).run(saleItemId, lot.id, take, issued, lot.receivedValue === null ? 'legacy_estimate' : 'receipt');
    costSatang += issued;
    remaining -= take;
  }
  return { shortfall: remaining, costSatang };
}

export type CheckoutInput = {
  items: CheckoutItemInput[];
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  memberNumber?: string | null;
  discount?: number;
  cashier?: string;
  actorRole?: string;
  /** ROUND 63 (user) — รูปหลักฐานการชำระ (สลิปโอน/สแกนจ่าย) data-URL · ไม่แนบ = ไม่ส่ง */
  slipImage?: string | null;
  /**
   * P2-b (idempotency) — client-generated key (UUID) sent once per checkout
   * attempt. Retries with the SAME key return the original receipt instead
   * of writing a second bill. Omitted on legacy clients → no idempotency.
   */
  clientRequestId?: string | null;
  /** FIX-7 (user) — ยอดเงินที่รับมาจากลูกค้า (เฉพาะ "เงินสด") · null/undefined สำหรับ QR/wallet */
  receivedCash?: number | null;
  /** FIX-7 (user) — ยอดเงินทอน (เฉพาะ "เงินสด") · null/undefined สำหรับ QR/wallet */
  changeDue?: number | null;
  /** FIX-7 (user) — แคชเชียร์ยืนยันว่าตรวจสอบการชำระแล้ว (เฉพาะ "QR / สแกน") · null สำหรับเงินสด/wallet */
  paymentVerified?: boolean | null;
};

export function checkout(db: SqliteDb, input: CheckoutInput): CheckoutReceipt {
  // P2-b (idempotency) — short-circuit a retried submit BEFORE touching stock
  // or wallet balance. The client is expected to send the SAME clientRequestId
  // for every retry of one logical checkout. We replay the original receipt
  // (items + totals + balanceAfter) so the UI shows the same slip again.
  if (input.clientRequestId) {
    const existing = db.prepare(`SELECT id, order_number AS orderNumber, created_at AS createdAt, subtotal, discount, total, payment_method AS paymentMethod, member_number AS memberNumber, cashier, received_cash AS receivedCash, change_due AS changeDue, payment_verified AS paymentVerified FROM sales WHERE client_request_id = ? LIMIT 1`).get(input.clientRequestId) as
      | { id: number; orderNumber: string; createdAt: string; subtotal: number; discount: number; total: number; paymentMethod: string; memberNumber: string | null; cashier: string | null; receivedCash: number | null; changeDue: number | null; paymentVerified: number | null }
      | undefined;
    if (existing) {
      const itemRows = db.prepare(`SELECT product_id AS productId, name, COALESCE(unit, 'ชิ้น') AS unit, qty, price, ROUND(qty * price, 2) AS amount FROM sale_items WHERE sale_id = ?`).all(existing.id) as { productId: number | null; name: string; unit: string; qty: number; price: number; amount: number }[];
      // Replay memberName + balanceAfter the same way salesList() does so the
      // reprinted slip is byte-identical to the original.
      let memberName: string | null = null;
      let balanceAfter: number | null = null;
      if (existing.memberNumber) {
        const memberRow = db.prepare(`SELECT prename, first_name, last_name FROM members WHERE member_number = ?`).get(existing.memberNumber) as { prename: string | null; first_name: string; last_name: string } | undefined;
        if (memberRow) {
          memberName = [memberRow.prename, memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ").trim() || null;
        }
        const balanceRow = db.prepare(`SELECT balance_after AS balanceAfter FROM member_transactions WHERE member_number = ? AND detail LIKE ? ORDER BY id DESC LIMIT 1`).get(existing.memberNumber, `บิล #${existing.orderNumber} ·%`) as { balanceAfter: number | null } | undefined;
        balanceAfter = balanceRow?.balanceAfter ?? null;
      }
      return {
        orderNumber: existing.orderNumber,
        createdAt: existing.createdAt,
        items: itemRows,
        subtotal: existing.subtotal,
        discount: existing.discount,
        total: existing.total,
        paymentMethod: existing.paymentMethod,
        memberNumber: existing.memberNumber,
        memberName,
        balanceAfter,
        cashier: existing.cashier,
        // FIX-7 — replay ยอดเงินสด/ทอน และ flag ยืนยันด้วย (null/undefined สำหรับบิลเก่า)
        receivedCash: existing.receivedCash ?? null,
        changeDue: existing.changeDue ?? null,
        paymentVerified: existing.paymentVerified === 1 ? true : existing.paymentVerified === 0 ? false : null,
      };
    }
  }
  if (!input.items?.length) throw new StoreError("ยังไม่มีสินค้าในบิล");
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) throw new StoreError("วิธีชำระเงินไม่ถูกต้อง");
  // Catalog lines merge by productId+price+label (round 31-12: money-mode
  // tiers of the same product stay separate lines — น้ำแข็ง ฿1 / ฿5 / ฿10);
  // special ("รายการพิเศษ") lines merge by lowercased name+price+unit.
  type MergedLine = { productId: number; qty: number; price?: number; unit?: string; label?: string };
  const merged = new Map<string, MergedLine>();
  const specials = new Map<string, { name: string; price: number; qty: number; unit: string }>();
  for (const item of input.items) {
    if (!Number.isInteger(item.qty) || item.qty <= 0) throw new StoreError("จำนวนต้องมากกว่า 0");
    if ("productId" in item) {
      if (!Number.isInteger(item.productId) || item.productId <= 0) throw new StoreError("รหัสสินค้าไม่ถูกต้อง");
      const unitPrice = item.price !== undefined ? Math.round(item.price * 10000) / 10000 : undefined;
      const key = `${item.productId}|${unitPrice ?? ""}|${item.label ?? ""}`;
      const existing = merged.get(key);
      merged.set(key, { productId: item.productId, qty: (existing?.qty ?? 0) + item.qty, price: unitPrice, unit: item.unit, label: item.label });
    } else {
      const name = item.name.trim();
      if (!name) throw new StoreError("กรุณาระบุชื่อรายการพิเศษ");
      if (!(item.price > 0)) throw new StoreError("ราคารายการพิเศษต้องมากกว่า 0");
      const unit = item.unit?.trim() || "รายการ";
      const key = `${name.toLowerCase()}|${item.price}|${unit}`;
      const existing = specials.get(key);
      specials.set(key, { name, price: item.price, qty: (existing?.qty ?? 0) + item.qty, unit });
    }
  }
  const isWallet = input.paymentMethod === WALLET_PAYMENT;
  if (isWallet && !input.memberNumber?.trim()) throw new StoreError("กรุณาเลือกสมาชิกก่อนชำระแบบหักบัญชีสมาชิก");

  const products = new Map<number, SqliteProduct>();
  const qtyByProduct = new Map<number, number>();
  for (const line of Array.from(merged.values())) {
    qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + line.qty);
  }
  for (const [productId, totalQty] of Array.from(qtyByProduct.entries())) {
    const product = getProductById(db, productId);
    if (!product || !product.active) throw new StoreError(`ไม่พบสินค้ารหัส ${productId} ในระบบ`);
    if (product.stock < totalQty) throw new StoreError(`สต็อกไม่พอ · ${product.name} เหลือ ${product.stock} ${product.unit}`);
    products.set(productId, product);
  }

  const items: { productId: number | null; name: string; unit: string; qty: number; price: number; cost: number; amount: number }[] = [
    ...Array.from(merged.values()).map((line) => {
      const product = products.get(line.productId)!;
      const unitPrice = line.price ?? product.price;
      return { productId: line.productId, name: line.label ? `${product.name} · ${line.label}` : product.name, unit: line.unit ?? product.unit, qty: line.qty, price: unitPrice, cost: product.cost, amount: round2(unitPrice * line.qty) };
    }),
    ...Array.from(specials.values()).map((special) => ({ ...special, productId: null, cost: 0, amount: round2(special.price * special.qty) })),
  ];
  const subtotal = round2(items.reduce((sum, item) => sum + item.amount, 0));
  const discount = round2(Math.max(0, input.discount ?? 0));
  if (discount > subtotal) throw new StoreError("ส่วนลดมากกว่ายอดรวมสินค้า");
  const total = round2(subtotal - discount);

  let member: SqliteMember | undefined;
  if (input.memberNumber?.trim()) member = requireUsableMemberCard(db, input.memberNumber);
  if (isWallet && member) {
    if (member.balance < total) throw new StoreError(`ยอดเงินคงเหลือไม่พอ · ยอดชำระ ${money(total)} คงเหลือ ${money(member.balance)}`);
  }

  const now = new Date();
  const createdAt = formatDateTime(now);
  const orderNumber = nextOrderNumber(db, now);
  const cashier = input.cashier?.trim() || "เจ้าหน้าที่ร้านค้า";
  // ROUND 63 — แนบหลักฐานการชำระไปกับบิล (ส่วนใหญ่คือสลิป QR / สแกน) · จำกัดความยาวกัน URL ผิดปกติ
  const slipImage = typeof input.slipImage === "string" && input.slipImage.startsWith("data:image/") ? input.slipImage.slice(0, 600_000) : null;

  return runInTransaction(db, () => {
    const saleResult = db.prepare(`INSERT INTO sales (order_number, payment_method, member_number, subtotal, discount, total, cashier, created_at, slip_url, client_request_id, received_cash, change_due, payment_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      orderNumber,
      input.paymentMethod,
      member?.memberNumber ?? (input.memberNumber?.trim() || null),
      subtotal,
      discount,
      total,
      cashier,
      createdAt,
      slipImage,
      input.clientRequestId ?? null,
      // FIX-7 — บิลเงินสดเก็บยอดรับ/ทอน · บิล QR เก็บ flag ยืนยัน · บิล wallet = null ทั้งคู่
      input.paymentMethod === "เงินสด" ? (typeof input.receivedCash === "number" ? round2(input.receivedCash) : null) : null,
      input.paymentMethod === "เงินสด" ? (typeof input.changeDue === "number" ? round2(input.changeDue) : null) : null,
      input.paymentMethod === "QR / สแกน" ? (input.paymentVerified ? 1 : 0) : null,
    );
    const saleId = Number(saleResult.lastInsertRowid);
    const insertItem = db.prepare(`INSERT INTO sale_items (sale_id, product_id, name, qty, price, cost, unit) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const updateStock = db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`);
    const lotShortfalls: { name: string; unit: string; qty: number }[] = [];
    for (const item of items) {
      const itemResult = insertItem.run(saleId, item.productId, item.name, item.qty, item.price, item.cost, item.unit);
      const saleItemId = Number(itemResult.lastInsertRowid);
      if (item.productId == null) continue; // รายการพิเศษ — no product/stock row behind it
      updateStock.run(item.qty, item.productId);
        recordMovement(db, { type: 'SALE', productId: item.productId, qtyDelta: -item.qty, unitCost: item.cost, refType: 'sale', refId: saleId, reason: `บิล ${orderNumber}`, actor: input.cashier?.trim() || undefined, actorRole: input.actorRole ?? undefined });
      const allocation = deductLotsFifo(db, item.productId, item.qty, saleItemId);
      const shortfall = allocation.shortfall;
      if (shortfall > 0 && db.prepare(`SELECT 1 FROM stock_lots WHERE product_id = ? AND received_value_satang IS NOT NULL`).get(item.productId)) {
        throw new StoreError("จำนวนในล็อตไม่ตรงกับสต็อก กรุณาตรวจสอบล็อตก่อนขาย");
      }
      const costSatang = allocation.costSatang + Math.round(shortfall * item.cost * 100);
      db.prepare(`UPDATE sale_items SET cost_total_satang = ? WHERE id = ?`).run(costSatang, saleItemId);
      if (shortfall > 0) lotShortfalls.push({ name: item.name, unit: item.unit, qty: shortfall });
    }

    let balanceAfter: number | null = null;
    if (isWallet && member) {
      balanceAfter = round2(member.balance - total);
      db.prepare(`UPDATE members SET balance = ? WHERE member_number = ?`).run(balanceAfter, member.memberNumber);
      db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, actor, created_at) VALUES (?, 'purchase', ?, ?, ?, ?, ?, ?)`).run(
        member.memberNumber,
        `บิล #${orderNumber} · ${summarizeItems(items)}`,
        -total,
        input.paymentMethod,
        balanceAfter,
        cashier,
        createdAt,
      );
    } else if (member) {
      // Cash / QR member bill — snapshot the untouched balance for the slip.
      balanceAfter = round2(member.balance);
    }

    const lotNote = lotShortfalls.length
      ? ` · ตัดยอด Lot ไม่ครบ: ${lotShortfalls.map((row) => `${row.name} ${row.qty} ${row.unit}`).join(", ")} (แนะนำนับสต็อกแยกล็อต)`
      : "";
    logAction(db, "ขายสินค้า", cashier, `บิล #${orderNumber} · ${money(total)}${member ? ` · หักบัญชี ${member.memberNumber}` : ""}${slipImage ? " · แนบหลักฐานการชำระแล้ว" : ""}${lotNote}`, "blue", input.actorRole ?? null, createdAt);

    return {
      orderNumber,
      createdAt,
      items: items.map(({ productId, name, unit, qty, price, amount }) => ({ productId, name, unit, qty, price, amount })),
      subtotal,
      discount,
      total,
      paymentMethod: input.paymentMethod,
      memberNumber: member?.memberNumber ?? null,
      memberName: member ? [member.prename, member.firstName, member.lastName].filter(Boolean).join(" ") : null,
      balanceAfter,
      cashier,
      // FIX-7 — ส่งยอดเงินสด/ทอน และ flag ยืนยันกลับไปแสดงในใบเสร็จ
      receivedCash: input.paymentMethod === "เงินสด" ? (typeof input.receivedCash === "number" ? round2(input.receivedCash) : null) : null,
      changeDue: input.paymentMethod === "เงินสด" ? (typeof input.changeDue === "number" ? round2(input.changeDue) : null) : null,
      paymentVerified: input.paymentMethod === "QR / สแกน" ? !!input.paymentVerified : null,
    };
  });
}

// --- sales history (receipt reprint) ---------------------------------------

export type SalesListInput = {
  search?: string;
  limit?: number;
};

/** Lists past receipts, newest first. Search matches order number or member number (case-insensitive contains). */
export function salesList(db: SqliteDb, input: SalesListInput = {}): SaleHistoryEntry[] {
  const search = input.search?.trim();
  const limit = input.limit == null ? null : Math.max(1, Math.min(500, Math.floor(input.limit)));
  const conditions: string[] = [];
  const params: string[] = [];
  if (search) {
    conditions.push("(s.order_number LIKE ? OR s.member_number LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sales = db.prepare(`SELECT s.id, s.order_number AS orderNumber, s.payment_method AS paymentMethod, s.member_number AS memberNumber, s.subtotal, s.discount, s.total, s.cashier, s.created_at AS createdAt, s.slip_url IS NOT NULL AS hasSlip, s.received_cash AS receivedCash, s.change_due AS changeDue, s.payment_verified AS paymentVerified, s.voided AS voided, CASE WHEN m.prename IS NULL OR m.prename = '' THEN m.first_name || ' ' || m.last_name ELSE m.prename || ' ' || m.first_name || ' ' || m.last_name END AS memberName FROM sales s LEFT JOIN members m ON m.member_number = s.member_number${where} ORDER BY s.created_at DESC, s.id DESC${limit == null ? "" : " LIMIT ?"}`).all(...params, ...(limit == null ? [] : [limit])) as unknown as {
    id: number;
    orderNumber: string;
    paymentMethod: string;
    memberNumber: string | null;
    subtotal: number;
    discount: number;
    total: number;
    cashier: string | null;
    createdAt: string;
    hasSlip: number;
    receivedCash: number | null;
    changeDue: number | null;
    paymentVerified: number | null;
    voided: number;
    memberName: string | null;
  }[];
  if (sales.length === 0) return [];

  const placeholders = sales.map(() => "?").join(", ");
  const itemRows = db.prepare(`SELECT si.sale_id AS saleId, si.product_id AS productId, si.name, COALESCE(si.unit, p.unit, 'ชิ้น') AS unit, si.qty, si.price, ROUND(si.qty * si.price, 2) AS amount FROM sale_items si LEFT JOIN products p ON p.id = si.product_id WHERE si.sale_id IN (${placeholders})`).all(...sales.map((sale) => sale.id)) as unknown as { saleId: number; productId: number; name: string; unit: string; qty: number; price: number; amount: number }[];
  const itemsBySale = new Map<number, SaleHistoryEntry["items"]>();
  for (const row of itemRows) {
    const bucket = itemsBySale.get(row.saleId) ?? [];
    bucket.push({ productId: row.productId, name: row.name, unit: row.unit, qty: row.qty, price: row.price, amount: row.amount });
    itemsBySale.set(row.saleId, bucket);
  }

  // Wallet purchases wrote the post-sale balance into member_transactions
  // (`บิล #<orderNumber> · …` + balance_after). Replaying that row lets
  // reprinted member receipts show the same ยอดคงเหลือหลังรายการ line the
  // original slip had — historical sales before this table stay null.
  const balanceLookup = db.prepare(`SELECT balance_after AS balanceAfter FROM member_transactions WHERE member_number = ? AND detail LIKE ? ORDER BY id DESC LIMIT 1`);

  return sales.map((sale) => ({
    id: sale.id,
    orderNumber: sale.orderNumber,
    createdAt: sale.createdAt,
    items: itemsBySale.get(sale.id) ?? [],
    subtotal: sale.subtotal,
    discount: sale.discount,
    total: sale.total,
    paymentMethod: sale.paymentMethod,
    memberNumber: sale.memberNumber,
    memberName: sale.memberName?.trim() || null,
    balanceAfter: sale.memberNumber
      ? ((balanceLookup.get(sale.memberNumber, `บิล #${sale.orderNumber} ·%`) as { balanceAfter: number | null } | undefined)?.balanceAfter ?? null)
      : null,
    cashier: sale.cashier,
    hasSlip: sale.hasSlip === 1,
    // FIX-7 — replay ยอดเงินสด/ทอน และ flag ยืนยัน (null สำหรับบิลเก่าที่ไม่มีข้อมูลนี้)
    receivedCash: sale.receivedCash ?? null,
    changeDue: sale.changeDue ?? null,
    paymentVerified: sale.paymentVerified === 1 ? true : sale.paymentVerified === 0 ? false : null,
    // FEAT-9 — voided flag for RecentBillsWidget red strikethrough indicator
    voided: sale.voided === 1,
  }));
}

/** ROUND 63 (user) — ดึงรูปหลักฐานการชำระของบิล (สลิป QR / สแกน) ตามรหัสแถว sales */
export function getSaleSlip(db: SqliteDb, id: number): { slipUrl: string | null } {
  const row = db.prepare(`SELECT slip_url AS slipUrl FROM sales WHERE id = ?`).get(id) as { slipUrl: string | null } | undefined;
  if (!row) throw new StoreError("ไม่พบบิลนี้ในระบบ");
  return { slipUrl: row.slipUrl };
}

// --- members & wallet -------------------------------------------------------

const MEMBER_SELECT = `SELECT id, member_number as memberNumber, prename, first_name as firstName, last_name as lastName, id_card as idCard, phone, type, balance, status, created_at as createdAt, photo_url as photoUrl, gender, card_number as cardNumber, patient_code as patientCode FROM members WHERE member_number = ?`;

function getMemberByNumber(db: SqliteDb, memberNumber: string): SqliteMember | undefined {
  return db.prepare(MEMBER_SELECT).get(memberNumber) as SqliteMember | undefined;
}

export function listMembers(db: SqliteDb, search?: string, status?: "active" | "suspended"): SqliteMemberSummary[] {
  const conditions: string[] = [];
  const params: string[] = [];
  if (search?.trim()) {
    // ROUND 65 — ค้นหาเจอจากรหัสบัตรและรหัสผู้ป่วยด้วย (นอกจากชื่อ/เลขสมาชิก)
    conditions.push(`(first_name || ' ' || last_name || ' ' || member_number || ' ' || COALESCE(card_number, '') || ' ' || COALESCE(patient_code, '')) LIKE ?`);
    params.push(`%${search.trim()}%`);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`SELECT m.id, m.member_number AS memberNumber, m.prename AS prename, m.first_name AS firstName, m.last_name AS lastName, m.type, m.balance, m.status, m.created_at AS createdAt, m.photo_url AS photoUrl, m.gender, m.card_number AS cardNumber, m.patient_code AS patientCode,
    CASE WHEN m.status = 'active' AND m.account_closed = 0 AND EXISTS (
      SELECT 1 FROM physical_cards pc
      JOIN card_usage_sessions cs ON cs.card_number = pc.card_number
        AND cs.member_number = m.member_number AND cs.ended_at IS NULL
      WHERE pc.card_number = m.card_number AND pc.archived_at IS NULL
        AND pc.status = 'assigned' AND pc.assigned_member_number = m.member_number
    ) THEN 1 ELSE 0 END AS cardUsable,
    (SELECT MAX(t.created_at) FROM member_transactions t WHERE t.member_number = m.member_number) AS lastTransactionAt
    FROM members m${where} ORDER BY m.member_number`).all(...params) as unknown as SqliteMemberSummary[];
}

function nextMemberSequence(db: SqliteDb, prefix: string) {
  const rows = db.prepare(`SELECT member_number AS memberNumber FROM members WHERE member_number LIKE ?`).all(`${prefix}%`) as unknown as { memberNumber: string }[];
  let max = 0;
  for (const row of rows) {
    const suffix = row.memberNumber.slice(prefix.length);
    if (/^\d+$/.test(suffix)) max = Math.max(max, Number(suffix));
  }
  return max + 1;
}

export function generateMemberNumber(db: SqliteDb, mode: "running" | "year" | "manual", provided?: string) {
  if (mode === "manual") {
    const manual = provided?.trim();
    if (!manual) throw new StoreError("โหมดกำหนดหมายเลขเอง: กรุณาระบุหมายเลขสมาชิก");
    return manual;
  }
  const config = memberNumberSettings(db);
  const members = db.prepare(`SELECT member_number AS memberNumber FROM members`).all() as unknown as { memberNumber: string }[];
  const digits = mode === "year" && config.yearMode === "none" ? 5 : config.sequenceDigits;
  return `${memberNumberHead(mode, config)}${String(nextMemberNumberSequence(members, mode, config)).padStart(digits, "0")}`;
}

export type RegisterMemberInput = {
  prename?: string;
  firstName: string;
  lastName: string;
  citizenId?: string;
  phone?: string;
  type?: string;
  gender?: string;
  photoUrl?: string;
  initialDeposit?: number;
  memberNumber?: string;
  /** ROUND 65 — รหัสบัตรเงินสดที่ออกให้สมาชิก (เช่น 2395100201) */
  cardNumber?: string;
  /** ROUND 65 — รหัสผู้ป่วย (HN) ที่ผูกกับบัตร */
  patientCode?: string;
  actor?: string;
  actorRole?: string;
};

export function findExistingMembers(db: SqliteDb, input: { firstName: string; lastName: string; citizenId?: string; phone?: string }) {
  const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const digits = (value: string) => value.replace(/\D/g, "");
  const id = digits(input.citizenId ?? "");
  const phone = digits(input.phone ?? "");
  const rows = db.prepare("SELECT member_number, first_name, last_name, status, id_card, phone FROM members").all() as unknown as { member_number: string; first_name: string; last_name: string; status: string; id_card: string | null; phone: string | null }[];
  return rows.flatMap(row => {
    const reason = id && digits(row.id_card ?? "") === id ? "citizenId" : phone && digits(row.phone ?? "") === phone ? "phone" : normalize(input.firstName) && normalize(input.lastName) && normalize(row.first_name) === normalize(input.firstName) && normalize(row.last_name) === normalize(input.lastName) ? "name" : null;
    return reason ? [{ memberNumber: row.member_number, name: row.first_name + " " + row.last_name, status: row.status, reason }] : [];
  });
}

export function registerMember(db: SqliteDb, input: RegisterMemberInput) {
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  if (!firstName || !lastName) throw new StoreError("กรุณาระบุชื่อและนามสกุลสมาชิก");
  const existingIdentity = findExistingMembers(db, input).find(member => member.reason === "citizenId");
  if (existingIdentity) throw new StoreError(`เลขประจำตัวนี้เคยลงทะเบียนแล้ว สมาชิก ${existingIdentity.memberNumber} กรุณาใช้บัญชีเดิม`);
  if (input.initialDeposit !== undefined && !(input.initialDeposit > 0)) throw new StoreError("จำนวนเงินต้องมากกว่า 0");
  const memberNumber = generateMemberNumber(db, getMemberNumberMode(db), input.memberNumber);
  if (db.prepare(`SELECT id FROM members WHERE member_number = ?`).get(memberNumber)) {
    throw new StoreError(`หมายเลขสมาชิก ${memberNumber} ถูกใช้แล้ว`);
  }
  // ROUND 65 — รหัสบัตร/รหัสผู้ป่วย: ห้ามซ้ำกับสมาชิกคนอื่น (ว่างได้ = ยังไม่ผูก)
  const cardNumber = input.cardNumber?.trim() || null;
  const patientCode = input.patientCode?.trim() || null;
  if (cardNumber && db.prepare(`SELECT id FROM members WHERE card_number = ?`).get(cardNumber)) {
    throw new StoreError(`รหัสบัตร ${cardNumber} ถูกใช้กับสมาชิกอื่นแล้ว`);
  }
  if (patientCode && db.prepare(`SELECT id FROM members WHERE patient_code = ?`).get(patientCode)) {
    throw new StoreError(`รหัสผู้ป่วย ${patientCode} ถูกใช้กับสมาชิกอื่นแล้ว`);
  }
  const initialDeposit = input.initialDeposit ? round2(input.initialDeposit) : 0;
  const createdAt = formatDateTime();
  runInTransaction(db, () => {
    db.prepare(`INSERT INTO members (member_number, prename, first_name, last_name, id_card, phone, type, balance, status, created_at, photo_url, gender, card_number, patient_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`).run(
      memberNumber,
      input.prename?.trim() || null,
      firstName,
      lastName,
      input.citizenId?.trim() || null,
      input.phone?.trim() || null,
      input.type?.trim() || "สมาชิก",
      initialDeposit,
      createdAt,
      input.photoUrl?.trim() || null,
      input.gender?.trim() || null,
      cardNumber,
      patientCode,
    );
    if (cardNumber) assignPhysicalCardTx(db, cardNumber, memberNumber, input.actor, input.actorRole, createdAt);
    if (initialDeposit > 0) {
      // ROUND 65 — เงินเริ่มต้นตอนลงทะเบียน = "เปิดใช้บัตร" (ตรงกับรายงานโรงพยาบาล)
      db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, created_at, actor) VALUES (?, 'activation', ?, ?, 'เงินสด', ?, ?, ?)`).run(
        memberNumber,
        `เปิดใช้บัตร · เงินเริ่มต้นตอนลงทะเบียน · เงินสด`,
        initialDeposit,
        initialDeposit,
        createdAt,
        input.actor?.trim() || "ระบบ",
      );
    }
    logAction(db, "ลงทะเบียนสมาชิก", input.actor?.trim() || "ระบบ", `${memberNumber} · ${firstName} ${lastName}${initialDeposit > 0 ? ` · เปิดใช้บัตรพร้อมเงิน ${money(initialDeposit)}` : ""}`, "green", input.actorRole ?? null, createdAt);
  });
  return getMemberDetail(db, memberNumber)!;
}

export function setMemberStatus(db: SqliteDb, memberNumber: string, suspended: boolean, actor?: string, actorRole?: string) {
  const member = db.prepare(`SELECT member_number AS memberNumber, first_name AS firstName, last_name AS lastName, status FROM members WHERE member_number = ?`).get(memberNumber) as { memberNumber: string; firstName: string; lastName: string; status: "active" | "suspended" } | undefined;
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${memberNumber} ในระบบ`);
  const nextStatus = suspended ? "suspended" : "active";
  if (member.status !== nextStatus) {
    const createdAt = formatDateTime();
    runInTransaction(db, () => {
      db.prepare(`UPDATE members SET status = ? WHERE member_number = ?`).run(nextStatus, memberNumber);
      logAction(
        db,
        suspended ? "ระงับสมาชิก" : "เปิดใช้งานสมาชิก",
        actor?.trim() || "ระบบ",
        `${memberNumber} · ${member.firstName} ${member.lastName}`,
        suspended ? "red" : "green",
        actorRole ?? null,
        createdAt,
      );
    });
  }
  return getMemberDetail(db, memberNumber);
}

export type WalletTxInput = {
  memberNumber: string;
  /** ROUND 65 — 'refund' = คืนบัตรเงินสด (ผู้ป่วยคืนบัตร ร้านจ่ายเงินคืน) คิดเหมือนถอน */
  type: "deposit" | "withdrawal" | "refund";
  /** Internal account closure: refund money but keep the physical card assigned. */
  retainCard?: boolean;
  amount: number;
  note?: string;
  actor?: string;
  actorRole?: string;
  /** ROUND 63 (user) — รูปหลักฐาน (สลิปโอน/ถอน) data-URL · ไม่แนบ = ไม่ส่ง */
  slipImage?: string | null;
  /**
   * P2-b (idempotency) — client-generated key (UUID) sent once per wallet
   * operation. Retries with the SAME key return the original transaction row
   * instead of double-debiting/crediting the member. Omitted on legacy clients
   * → no idempotency.
   */
  clientRequestId?: string | null;
};

export function walletTx(db: SqliteDb, input: WalletTxInput) {
  // P2-b (idempotency) — short-circuit a retried submit BEFORE touching the
  // member's balance. The client is expected to send the SAME clientRequestId
  // for every retry of one logical wallet operation. We replay the original
  // ledger row so the UI shows the same slip/result again.
  if (input.clientRequestId) {
    const existing = db.prepare(`SELECT member_number AS memberNumber, type, amount, balance_after AS balanceAfter, detail FROM member_transactions WHERE client_request_id = ? LIMIT 1`).get(input.clientRequestId) as
      | { memberNumber: string; type: "deposit" | "withdrawal" | "refund"; amount: number; balanceAfter: number | null; detail: string }
      | undefined;
    if (existing) {
      const memberRow = db.prepare(`SELECT prename, first_name, last_name, balance FROM members WHERE member_number = ?`).get(existing.memberNumber) as { prename: string | null; first_name: string; last_name: string; balance: number } | undefined;
      // Match the normal-path return shape so the inferred walletTx return
      // type stays the strict `string`/`number` the UI consumers expect —
      // existing.balanceAfter is only null on legacy rows that predate the
      // balance_after column; we fall back to the live balance in that case.
      const memberName = memberRow
        ? [memberRow.prename, memberRow.first_name, memberRow.last_name].filter(Boolean).join(" ")
        : "";
      const balanceAfter = existing.balanceAfter ?? memberRow?.balance ?? 0;
      const balanceBefore = existing.type === "deposit"
        ? round2(balanceAfter - Math.abs(existing.amount))
        : round2(balanceAfter + Math.abs(existing.amount));
      return {
        memberNumber: existing.memberNumber,
        memberName,
        type: existing.type,
        amount: Math.abs(existing.amount),
        balanceBefore,
        balanceAfter,
        detail: existing.detail,
      };
    }
  }
  if (!(input.amount > 0)) throw new StoreError("จำนวนเงินต้องมากกว่า 0");
  const amount = round2(input.amount);
  // Refund is a recovery operation: it must remain available for lost/damaged cards.
  const member = input.type === "refund"
    ? getMemberByNumber(db, input.memberNumber?.trim() ?? "")
    : requireUsableMemberCard(db, input.memberNumber);
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${input.memberNumber} ในระบบ`);
  if (input.type === "refund" && member.status !== "active") throw new StoreError(`สมาชิกถูกระงับการใช้งาน · ${member.memberNumber}`);
  // FIX-4 issue 3 — SQLite stores REAL as IEEE-754 double, so a stored 99.99
  // may come back as 99.98999999999. Comparing raw balance < amount would
  // reject a refund that exactly matches the displayed balance. Round both
  // sides to 2 decimals before the check (refund = return-all-money case).
  const roundedBalance = round2(member.balance);
  if (input.type !== "deposit" && roundedBalance < amount) {
    throw new StoreError(`ยอดเงินคงเหลือไม่พอ · ${input.type === "refund" ? "คืนบัตร" : "ถอน"} ${money(amount)} คงเหลือ ${money(roundedBalance)}`);
  }
  const signedAmount = input.type === "deposit" ? amount : -amount;
  const balanceAfter = round2(member.balance + signedAmount);
  const note = input.note?.trim();
  const fallbackDetail = input.type === "deposit"
    ? "เติมเงินเข้าบัญชีสมาชิก · เงินสด"
    : input.type === "refund"
      ? "คืนบัตรเงินสด · จ่ายเงินคืนตามยอดคงเหลือ"
      : "ถอนเงินจากบัญชีสมาชิก · เงินสด";
  const detail = note || fallbackDetail;
  const actor = input.actor?.trim() || "เจ้าหน้าที่ร้านค้า";
  const createdAt = formatDateTime();
  // ROUND 63 — รูปหลักฐานที่แนบมากับการเติม/ถอน (เช่น สลิปโอนเข้า) เก็บไปกับรายการ
  const slipImage = typeof input.slipImage === "string" && input.slipImage.startsWith("data:image/") ? input.slipImage.slice(0, 600_000) : null;
  const writeWallet = () => {
    db.prepare(`UPDATE members SET balance = ? WHERE member_number = ?`).run(balanceAfter, member.memberNumber);
    db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, actor, created_at, slip_url, client_request_id) VALUES (?, ?, ?, ?, 'เงินสด', ?, ?, ?, ?, ?)`).run(
      member.memberNumber,
      input.type,
      detail,
      signedAmount,
      balanceAfter,
      actor,
      createdAt,
      slipImage,
      input.clientRequestId ?? null,
    );
    // Record the refund in the holding round before closing and releasing the card.
    if (input.type === "refund" && balanceAfter === 0 && member.cardNumber && !input.retainCard) {
      releasePhysicalCardTx(db, member.cardNumber, actor, input.actorRole, "คืนเงินครบยอดและรับคืนบัตร");
    }
    logAction(
      db,
      input.type === "deposit" ? "เติมเงินสมาชิก" : input.type === "refund" ? "คืนบัตรเงินสด" : "ถอนเงินสมาชิก",
      actor,
      `${member.memberNumber} · ${money(amount)} · ${note || "เงินสด"}${slipImage ? " · แนบหลักฐานแล้ว" : ""}`,
      input.type === "deposit" ? "green" : input.type === "refund" ? "amber" : "purple",
      input.actorRole ?? null,
      createdAt,
    );
  };
  // Account closure owns the enclosing transaction; ordinary wallet operations own theirs.
  if (input.retainCard) writeWallet();
  else runInTransaction(db, writeWallet);
  return {
    memberNumber: member.memberNumber,
    memberName: [member.prename, member.firstName, member.lastName].filter(Boolean).join(" "),
    type: input.type,
    amount,
    balanceBefore: member.balance,
    balanceAfter,
    detail,
  };
}

export type UpdateMemberInput = {
  memberNumber: string;
  prename?: string | null;
  firstName?: string;
  lastName?: string;
  idCard?: string | null;
  phone?: string | null;
  type?: string;
  gender?: string | null;
  photoUrl?: string | null;
  /** ROUND 65 — รหัสบัตรเงินสด · "" = ล้าง */
  cardNumber?: string | null;
  /** ROUND 65 — รหัสผู้ป่วย (HN) · "" = ล้าง */
  patientCode?: string | null;
  actor?: string;
  actorRole?: string;
};

/** Updates only the provided member profile fields. Undefined keeps the current value; empty idCard/phone clears them. */
export function updateMember(db: SqliteDb, input: UpdateMemberInput): SqliteMember {
  const member = getMemberByNumber(db, input.memberNumber?.trim() ?? "");
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${input.memberNumber} ในระบบ`);
  if (input.cardNumber !== undefined && (input.cardNumber?.trim() || null) !== (member.cardNumber ?? null)) {
    throw new StoreError("เปลี่ยนบัตรผ่านหน้าจัดการบัตรเปล่าเท่านั้น");
  }
  if (typeof input.firstName === "string" && !input.firstName.trim()) throw new StoreError("กรุณาระบุชื่อสมาชิก");
  if (typeof input.lastName === "string" && !input.lastName.trim()) throw new StoreError("กรุณาระบุนามสกุลสมาชิก");
  if (typeof input.type === "string" && !input.type.trim()) throw new StoreError("กรุณาระบุประเภทสมาชิก");

  const assignments: string[] = [];
  const values: (string | number | null)[] = [];
  const changedLabels: string[] = [];
  const normalizeOptional = (value: string | null | undefined) => value?.trim() || null;
  if (input.prename !== undefined && normalizeOptional(input.prename) !== (member.prename ?? null)) {
    assignments.push("prename = ?");
    values.push(normalizeOptional(input.prename));
    changedLabels.push("คำนำหน้า");
  }
  if (input.firstName != null && input.firstName.trim() !== member.firstName) {
    assignments.push("first_name = ?");
    values.push(input.firstName.trim());
    changedLabels.push("ชื่อ");
  }
  if (input.lastName != null && input.lastName.trim() !== member.lastName) {
    assignments.push("last_name = ?");
    values.push(input.lastName.trim());
    changedLabels.push("นามสกุล");
  }
  if (input.idCard !== undefined && normalizeOptional(input.idCard) !== member.idCard) {
    assignments.push("id_card = ?");
    values.push(normalizeOptional(input.idCard));
    changedLabels.push("เลขบัตรประชาชน");
  }
  if (input.phone !== undefined && normalizeOptional(input.phone) !== member.phone) {
    assignments.push("phone = ?");
    values.push(normalizeOptional(input.phone));
    changedLabels.push("เบอร์โทร");
  }
  if (input.type != null && input.type.trim() !== member.type) {
    assignments.push("type = ?");
    values.push(input.type.trim());
    changedLabels.push("ประเภท");
  }
  if (input.gender !== undefined && normalizeOptional(input.gender) !== member.gender) {
    assignments.push("gender = ?");
    values.push(normalizeOptional(input.gender));
    changedLabels.push("เพศ");
  }
  if (input.photoUrl !== undefined && (input.photoUrl?.trim() || null) !== member.photoUrl) {
    assignments.push("photo_url = ?");
    values.push(input.photoUrl?.trim() || null);
    changedLabels.push("รูปสมาชิก");
  }
  // ROUND 65 — รหัสบัตร/รหัสผู้ป่วย: ตรวจซ้ำกับสมาชิกคนอื่นก่อนบันทึก
  if (input.cardNumber !== undefined) {
    const nextCard = normalizeOptional(input.cardNumber);
    if (nextCard && nextCard !== member.cardNumber) {
      const clash = db.prepare(`SELECT member_number FROM members WHERE card_number = ? AND member_number != ?`).get(nextCard, member.memberNumber) as { member_number: string } | undefined;
      if (clash) throw new StoreError(`รหัสบัตร ${nextCard} ถูกใช้กับสมาชิก ${clash.member_number} อยู่แล้ว`);
    }
    if (nextCard !== member.cardNumber) {
      assignments.push("card_number = ?");
      values.push(nextCard);
      changedLabels.push("รหัสบัตร");
    }
  }
  if (input.patientCode !== undefined) {
    const nextPatient = normalizeOptional(input.patientCode);
    if (nextPatient && nextPatient !== member.patientCode) {
      const clash = db.prepare(`SELECT member_number FROM members WHERE patient_code = ? AND member_number != ?`).get(nextPatient, member.memberNumber) as { member_number: string } | undefined;
      if (clash) throw new StoreError(`รหัสผู้ป่วย ${nextPatient} ถูกใช้กับสมาชิก ${clash.member_number} อยู่แล้ว`);
    }
    if (nextPatient !== member.patientCode) {
      assignments.push("patient_code = ?");
      values.push(nextPatient);
      changedLabels.push("รหัสผู้ป่วย");
    }
  }

  const displayName = `${input.firstName?.trim() || member.firstName} ${input.lastName?.trim() || member.lastName}`.trim();
  const changeSummary = changedLabels.length > 0 ? `แก้ไข: ${changedLabels.join(", ")}` : "ตรวจสอบข้อมูลแล้ว · ไม่มีการเปลี่ยนแปลง";
  const detail = `${member.memberNumber} · ${displayName} · ${changeSummary}`;

  runInTransaction(db, () => {
    if (assignments.length > 0) {
      db.prepare(`UPDATE members SET ${assignments.join(", ")} WHERE member_number = ?`).run(...values, member.memberNumber);
    }
    logAction(db, "แก้ไขข้อมูลสมาชิก", input.actor?.trim() || "เจ้าหน้าที่ร้านค้า", detail, "blue", input.actorRole ?? null, formatDateTime());
  });
  return getMemberByNumber(db, member.memberNumber)!;
}

export type DeleteMemberInput = {
  memberNumber: string;
  actor?: string;
  actorRole?: string;
};

/** Hard-deletes a member. Blocked while a balance remains or any transaction history exists. */
export function deleteMember(db: SqliteDb, input: DeleteMemberInput): { memberNumber: string; memberName: string } {
  const member = getMemberByNumber(db, input.memberNumber?.trim() ?? "");
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${input.memberNumber} ในระบบ`);
  if (member.balance > 0) throw new StoreError(`ยอดเงินคงเหลือไม่เป็น 0 · ถอนเงิน ${money(member.balance)} ออกก่อนลบสมาชิก`);
  const history = db.prepare(`SELECT COUNT(*) AS count FROM member_transactions WHERE member_number = ?`).get(member.memberNumber) as { count: number };
  if (history.count > 0) throw new StoreError("สมาชิกมีประวัติธุรกรรมในระบบ · ใช้การระงับการใช้งานแทนการลบ");
  if (db.prepare(`SELECT id FROM card_assignments WHERE member_number = ? LIMIT 1`).get(member.memberNumber) || member.cardNumber) {
    throw new StoreError("สมาชิกมีประวัติบัตร · ใช้การระงับการใช้งานแทนการลบ");
  }

  const displayName = [member.prename, member.firstName, member.lastName].filter(Boolean).join(" ");
  runInTransaction(db, () => {
    db.prepare(`DELETE FROM members WHERE member_number = ?`).run(member.memberNumber);
    logAction(db, "ลบสมาชิก", input.actor?.trim() || "เจ้าหน้าที่ร้านค้า", `${member.memberNumber} · ${displayName}`, "red", input.actorRole ?? null, formatDateTime());
  });
  return { memberNumber: member.memberNumber, memberName: displayName };
}

// --- reports ----------------------------------------------------------------

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** ROUND 51 — ชื่อพนักงานพิเศษ: แทนบิลที่ไม่ได้ระบุชื่อผู้ขาย (เก่า ๆ / นำเข้า) */
export const UNASSIGNED_CASHIER = "ไม่ระบุพนักงาน";

export type DailyRangeInput = { days?: number; from?: string; to?: string; cashier?: string; cashiers?: string[] };

/**
 * ROUND 51 (user) — ตัวกรองพนักงานขายใช้ร่วมกับทุกรายงานยอดขาย
 * ROUND 79 (user) — เลือกได้หลายคนพร้อมกัน (cashiers[]) เช่น ดู 2 กะรวมกัน
 * ว่าง/ไม่ส่ง = ทุกคน · UNASSIGNED_CASHIER ปนในลิสต์ได้ = รวมบิลที่ไม่มีชื่อผู้ขายด้วย
 * (เทียบแบบ TRIM เพื่อให้ตรงกับการจัดกลุ่มของ salesByCashier เสมอ)
 */
function cashierWhere(alias: string, input: DailyRangeInput): { sql: string; params: string[] } {
  const names = [
    ...(input.cashier?.trim() ? [input.cashier.trim()] : []),
    ...(input.cashiers ?? []).map((name) => name.trim()).filter((name) => name !== ""),
  ];
  if (names.length === 0) return { sql: "", params: [] };
  const regular = Array.from(new Set(names.filter((name) => name !== UNASSIGNED_CASHIER)));
  const unassigned = names.includes(UNASSIGNED_CASHIER);
  const parts: string[] = [];
  const params: string[] = [];
  if (regular.length > 0) {
    parts.push(`TRIM(COALESCE(${alias}.cashier, '')) IN (${regular.map(() => "?").join(", ")})`);
    params.push(...regular);
  }
  if (unassigned) parts.push(`TRIM(COALESCE(${alias}.cashier, '')) = ''`);
  if (parts.length === 0) return { sql: "", params: [] };
  return { sql: ` AND (${parts.join(" OR ")})`, params };
}

function resolveRangeDates(input: DailyRangeInput): { fromDate: Date; toDate: Date } {
  const today = startOfToday();
  let fromDate: Date;
  let toDate: Date;
  if (input.from && ISO_DATE_ONLY.test(input.from)) fromDate = new Date(`${input.from}T00:00:00`);
  else {
    const range = Math.max(1, Math.min(365, Math.floor(input.days ?? 30)));
    fromDate = addDays(today, -(range - 1));
  }
  if (input.to && ISO_DATE_ONLY.test(input.to)) toDate = new Date(`${input.to}T00:00:00`);
  else toDate = today;
  if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
  // Cap at 366 rows so a bad range can never generate an unbounded loop.
  if ((toDate.getTime() - fromDate.getTime()) / 86_400_000 > 365) toDate = addDays(fromDate, 365);
  return { fromDate, toDate };
}

/**
 * Cost used by profit reports. A product whose sale-time cost is zero has not
 * been costed yet, so treating it as free would overstate profit. Estimate its
 * cost from the sale price instead, making that line's provisional profit zero.
 * Special lines are excluded because they are not products with a cost field.
 */
const REPORT_COGS_SQL = `CASE
  WHEN si.product_id IS NOT NULL AND COALESCE(si.cost, 0) <= 0 THEN si.qty * si.price
  ELSE COALESCE(si.cost_total_satang / 100.0, si.qty * si.cost, 0)
END`;

export function dailySalesRows(db: SqliteDb, input: number | DailyRangeInput = 30): DailySalesRow[] {
  const options: DailyRangeInput = typeof input === "number" ? { days: input } : (input ?? {});
  const { fromDate, toDate } = resolveRangeDates(options);
  const since = `${formatDate(fromDate)} 00:00:00`;
  const until = `${formatDate(toDate)} 23:59:59`;
  const filter = cashierWhere("s", options);
  const salesByDay = new Map<string, { orders: number; revenue: number }>();
  for (const row of db.prepare(`SELECT substr(s.created_at, 1, 10) AS date, COUNT(*) AS orders, ROUND(SUM(s.total), 2) AS revenue FROM sales s WHERE COALESCE(s.voided, 0) = 0 AND s.created_at >= ? AND s.created_at <= ?${filter.sql} GROUP BY date`).all(since, until, ...filter.params) as unknown as { date: string; orders: number; revenue: number }[]) {
    salesByDay.set(row.date, { orders: row.orders, revenue: round2(row.revenue) });
  }
  const itemsByDay = new Map<string, { items: number; cogs: number }>();
  for (const row of db.prepare(`SELECT substr(s.created_at, 1, 10) AS date, COALESCE(SUM(si.qty), 0) AS items, ROUND(COALESCE(SUM(${REPORT_COGS_SQL}), 0), 2) AS cogs FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE COALESCE(s.voided, 0) = 0 AND s.created_at >= ? AND s.created_at <= ?${filter.sql} GROUP BY date`).all(since, until, ...filter.params) as unknown as { date: string; items: number; cogs: number }[]) {
    itemsByDay.set(row.date, { items: row.items, cogs: round2(row.cogs) });
  }
  const rows: DailySalesRow[] = [];
  for (let date = new Date(fromDate); date <= toDate; date = addDays(date, 1)) {
    const key = formatDate(date);
    const sales = salesByDay.get(key);
    const items = itemsByDay.get(key);
    const revenue = sales?.revenue ?? 0;
    const cogs = items?.cogs ?? 0;
    const profit = round2(revenue - cogs);
    rows.push({ date: key, orders: sales?.orders ?? 0, items: items?.items ?? 0, revenue, cogs, profit, marginPct: revenue > 0 ? round2((profit / revenue) * 100) : 0 });
  }
  return rows;
}

// --- report breakdowns (round 30): by product category & by cashier ---------

export type SalesByCategoryRow = { category: string; orders: number; qty: number; revenue: number; cogs: number; profit: number; marginPct: number };

/** Sales grouped by product category — special (no-product) lines land in "รายการพิเศษ". */
export function salesByCategory(db: SqliteDb, input: DailyRangeInput = {}): SalesByCategoryRow[] {
  const { fromDate, toDate } = resolveRangeDates(input);
  const since = `${formatDate(fromDate)} 00:00:00`;
  const until = `${formatDate(toDate)} 23:59:59`;
  const filter = cashierWhere("s", input);
  const rows = db.prepare(`SELECT COALESCE(NULLIF(TRIM(p.category), ''), 'ไม่ระบุหมวด') AS category, COUNT(DISTINCT si.sale_id) AS orders, COALESCE(SUM(si.qty), 0) AS qty, ROUND(COALESCE(SUM(si.qty * si.price), 0), 2) AS revenue, ROUND(COALESCE(SUM(${REPORT_COGS_SQL}), 0), 2) AS cogs FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id WHERE COALESCE(s.voided, 0) = 0 AND s.created_at >= ? AND s.created_at <= ?${filter.sql} GROUP BY category ORDER BY revenue DESC`).all(since, until, ...filter.params) as unknown as { category: string; orders: number; qty: number; revenue: number; cogs: number }[];
  return rows.map((row) => { const profit = round2(row.revenue - row.cogs); return { ...row, qty: Number(row.qty), cogs: round2(row.cogs), profit, marginPct: row.revenue > 0 ? round2((profit / row.revenue) * 100) : 0 }; });
}

export type SalesByProductRow = {
  productId: number | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  bills: number;
  qty: number;
  revenue: number;
  cogs: number;
  profit: number;
  marginPct: number;
};

/**
 * Sales grouped per product (สรุปยอดขายแยกตามสินค้า). Special lines with no
 * product behind them collapse into one "รายการพิเศษ" row (sku/barcode/
 * category null); lines whose product was deleted fall back to the name
 * snapshot kept on the sale item. Sorted by revenue DESC.
 */
export function salesByProduct(db: SqliteDb, input: DailyRangeInput = {}): SalesByProductRow[] {
  const { fromDate, toDate } = resolveRangeDates(input);
  const since = `${formatDate(fromDate)} 00:00:00`;
  const until = `${formatDate(toDate)} 23:59:59`;
  const filter = cashierWhere("s", input);
  const rows = db.prepare(`SELECT si.product_id AS productId, CASE WHEN si.product_id IS NULL THEN 'รายการพิเศษ' ELSE COALESCE(p.name, si.name) END AS name, p.sku AS sku, p.barcode AS barcode, NULLIF(TRIM(p.category), '') AS category, COUNT(DISTINCT si.sale_id) AS bills, COALESCE(SUM(si.qty), 0) AS qty, ROUND(COALESCE(SUM(si.qty * si.price), 0), 2) AS revenue, ROUND(COALESCE(SUM(${REPORT_COGS_SQL}), 0), 2) AS cogs FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id WHERE COALESCE(s.voided, 0) = 0 AND s.created_at >= ? AND s.created_at <= ?${filter.sql} GROUP BY si.product_id ORDER BY revenue DESC`).all(since, until, ...filter.params) as unknown as { productId: number | null; name: string; sku: string | null; barcode: string | null; category: string | null; bills: number; qty: number; revenue: number; cogs: number }[];
  return rows.map((row) => { const profit = round2(row.revenue - row.cogs); return { ...row, bills: Number(row.bills), qty: Number(row.qty), cogs: round2(row.cogs), profit, marginPct: row.revenue > 0 ? round2((profit / row.revenue) * 100) : 0 }; });
}

/**
 * ROUND 48 (user) — รายงาน "แยกตามรายการในบิล": ทุกบรรทัดสินค้าจากทุกบิลในช่วงเวลา
 * ผู้ใช้อยากรู้ว่าแต่ละช่วง "มีรายการอะไร" บ้าง ไม่ใช่แค่จำนวนบิล — รายงานนี้คือ
 * สมุดขายรายบรรทัด: บิลไหน วันไหน เวลาไหน ขายอะไร กี่ชิ้น ราคาเท่าไหร่ ใครขาย
 * จำกัดที่ 1000 บรรทัดล่าสุดกันช่วงยาว ๆ ลากเบราว์เซอร์ (พอสำหรับรายงานหน้าร้าน)
 */
export type SalesLineItemRow = {
  orderNumber: string;
  createdAt: string;
  /** SKU is the hospital-report product identifier; barcode is a legacy fallback. */
  productCode: string | null;
  productName: string;
  unit: string;
  qty: number;
  price: number;
  amount: number;
  paymentMethod: string;
  cashier: string;
  memberNumber: string | null;
  memberName: string | null;
};

export function salesLineItems(db: SqliteDb, input: DailyRangeInput = {}): SalesLineItemRow[] {
  const { fromDate, toDate } = resolveRangeDates(input);
  const since = `${formatDate(fromDate)} 00:00:00`;
  const until = `${formatDate(toDate)} 23:59:59`;
  const filter = cashierWhere("s", input);
  return db.prepare(`SELECT s.order_number AS orderNumber, s.created_at AS createdAt, COALESCE(NULLIF(TRIM(p.sku), ''), NULLIF(TRIM(p.barcode), '')) AS productCode, si.name AS productName, COALESCE(si.unit, p.unit, 'ชิ้น') AS unit, si.qty, si.price, ROUND(si.qty * si.price, 2) AS amount, s.payment_method AS paymentMethod, COALESCE(NULLIF(TRIM(s.cashier), ''), '${UNASSIGNED_CASHIER}') AS cashier, s.member_number AS memberNumber, CASE WHEN m.member_number IS NULL THEN NULL WHEN m.prename IS NULL OR m.prename = '' THEN m.first_name || ' ' || m.last_name ELSE m.prename || ' ' || m.first_name || ' ' || m.last_name END AS memberName FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id LEFT JOIN members m ON m.member_number = s.member_number WHERE COALESCE(s.voided, 0) = 0 AND s.created_at >= ? AND s.created_at <= ?${filter.sql} ORDER BY s.created_at DESC, s.id DESC, si.id ASC LIMIT 1000`).all(since, until, ...filter.params) as unknown as SalesLineItemRow[];
}

export type SalesByCashierRow = { cashier: string; orders: number; items: number; memberBills: number; discount: number; total: number; cogs: number; profit: number };

/** Sales grouped by the staff member (cashier) who closed each bill. */
export function salesByCashier(db: SqliteDb, input: DailyRangeInput = {}): SalesByCashierRow[] {
  const { fromDate, toDate } = resolveRangeDates(input);
  const since = `${formatDate(fromDate)} 00:00:00`;
  const until = `${formatDate(toDate)} 23:59:59`;
  const filter = cashierWhere("s", input);
  const base = db.prepare(`SELECT COALESCE(NULLIF(TRIM(s.cashier), ''), '${UNASSIGNED_CASHIER}') AS cashier, COUNT(*) AS orders, ROUND(COALESCE(SUM(s.discount), 0), 2) AS discount, ROUND(COALESCE(SUM(s.total), 0), 2) AS total, SUM(CASE WHEN s.member_number IS NOT NULL AND s.member_number != '' THEN 1 ELSE 0 END) AS memberBills, ROUND(COALESCE(SUM(sale_costs.cogs), 0), 2) AS cogs FROM sales s LEFT JOIN (SELECT si.sale_id, SUM(${REPORT_COGS_SQL}) AS cogs FROM sale_items si GROUP BY si.sale_id) sale_costs ON sale_costs.sale_id = s.id WHERE COALESCE(s.voided, 0) = 0 AND s.created_at >= ? AND s.created_at <= ?${filter.sql} GROUP BY cashier ORDER BY total DESC`).all(since, until, ...filter.params) as unknown as { cashier: string; orders: number; discount: number; total: number; memberBills: number; cogs: number }[];
  const itemsByCashier = new Map<string, number>();
  for (const row of db.prepare(`SELECT COALESCE(NULLIF(TRIM(s.cashier), ''), '${UNASSIGNED_CASHIER}') AS cashier, COALESCE(SUM(si.qty), 0) AS items FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE COALESCE(s.voided, 0) = 0 AND s.created_at >= ? AND s.created_at <= ?${filter.sql} GROUP BY cashier`).all(since, until, ...filter.params) as unknown as { cashier: string; items: number }[]) {
    itemsByCashier.set(row.cashier, Number(row.items));
  }
  return base.map((row) => { const cogs = round2(row.cogs); const profit = round2(row.total - cogs); return { cashier: row.cashier, orders: row.orders, items: itemsByCashier.get(row.cashier) ?? 0, memberBills: Number(row.memberBills), discount: round2(row.discount), total: round2(row.total), cogs, profit }; });
}

/** ROUND 51 (user) — รายชื่อพนักงานขายจากบิลจริงทั้งหมด (สำหรับตัวกรองเจาะจงในรายงาน) */
export type CashierOptionRow = { cashier: string; bills: number; lastSale: string };

export function salesCashierOptions(db: SqliteDb): CashierOptionRow[] {
  return db.prepare(`SELECT COALESCE(NULLIF(TRIM(cashier), ''), '${UNASSIGNED_CASHIER}') AS cashier, COUNT(*) AS bills, MAX(created_at) AS lastSale FROM sales GROUP BY COALESCE(NULLIF(TRIM(cashier), ''), '${UNASSIGNED_CASHIER}') ORDER BY bills DESC`).all() as unknown as CashierOptionRow[];
}

// --- member transaction history (round 30): what members spent / deposited /
// withdrew + which staff member performed each entry ---------------------------

export type MemberTransactionRow = {
  id: number;
  memberNumber: string;
  memberName: string | null;
  /** เลขบัตร ณ รอบที่ทำรายการ (จาก card_usage_sessions) */
  cardNumber: string | null;
  patientCode: string | null;
  type: "purchase" | "deposit" | "withdrawal" | "activation" | "refund";
  kind: "tx";
  detail: string;
  amount: number;
  paymentMethod: string | null;
  balanceAfter: number | null;
  actor: string | null;
  createdAt: string;
};

export type MemberTransactionsInput = {
  memberNumber?: string;
  type?: "purchase" | "deposit" | "withdrawal" | "activation" | "refund";
  /** ROUND 77 (user) — เลือกหลายประเภทพร้อมกัน (รวมกับ type เดี่ยว ถ้าส่งทั้งคู่) */
  types?: ("purchase" | "deposit" | "withdrawal" | "activation" | "refund")[];
  from?: string;
  to?: string;
  limit?: number;
};

/**
 * Member wallet ledger with the staff member (actor) who performed each entry.
 * Credit-limit requests are deliberately excluded because they do not move money.
 */
export function memberTransactions(db: SqliteDb, input: MemberTransactionsInput = {}): MemberTransactionRow[] {
  const memberNumber = input.memberNumber?.trim();
  const limit = input.limit === undefined
    ? null
    : Math.max(1, Math.min(1000, Math.floor(input.limit)));
  // ROUND 77 — เลือกหลายประเภทพร้อมกัน; ชุดว่าง = ทุกประเภทธุรกรรมเงินจริง
  const typeSet = new Set<string>([...(input.types ?? []), ...(input.type ? [input.type] : [])]);
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (memberNumber) {
    conditions.push("t.member_number LIKE ?");
    params.push(`%${memberNumber}%`);
  }
  const txTypes = Array.from(typeSet);
  if (txTypes.length === 1) {
    conditions.push("t.type = ?");
    params.push(txTypes[0]);
  } else if (txTypes.length > 1) {
    conditions.push(`t.type IN (${txTypes.map(() => "?").join(", ")})`);
    params.push(...txTypes);
  }
    if (input.from && ISO_DATE_ONLY.test(input.from)) {
      conditions.push("t.created_at >= ?");
      params.push(`${input.from} 00:00:00`);
    }
    if (input.to && ISO_DATE_ONLY.test(input.to)) {
      conditions.push("t.created_at <= ?");
      params.push(`${input.to} 23:59:59`);
    }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const limitSql = limit === null ? "" : " LIMIT ?";
  const txRows = db.prepare(`SELECT t.id, t.member_number AS memberNumber,
    NULLIF(TRIM(m.first_name || ' ' || m.last_name), '') AS memberName,
    s.card_number AS cardNumber, m.patient_code AS patientCode, t.type, t.detail,
    t.amount, t.payment_method AS paymentMethod, t.balance_after AS balanceAfter,
    t.actor, t.created_at AS createdAt
    FROM member_transactions t
    LEFT JOIN members m ON m.member_number = t.member_number
    LEFT JOIN card_usage_sessions s ON s.id = t.card_usage_session_id
    ${where} ORDER BY t.created_at DESC, t.id DESC${limitSql}`).all(...params, ...(limit === null ? [] : [limit])) as unknown as MemberTransactionRow[];
  return txRows.map((row) => ({ ...row, kind: "tx" as const }));
}

// --- ROUND 65 (user): รายงานยอดเงินในบัตรสมาชิก --------------------------------
// ตรงกับชีทโรงพยาบาล "รายงานแสดงยอดเงินในบัตรเงินสด": รหัสบัตร · ยอดทั้งหมด (เงินเข้า
// รวมเปิดใช้บัตร+เติมเงิน) · ยอดจ่าย (ใช้ซื้อ+ถอน+คืนบัตร) · คงเหลือ · วันที่เปิดใช้บัตร ·
// รหัสผู้ป่วย · ชื่อผู้ป่วย ---------------------------------------------------------

export type MemberBalanceRow = {
  id: number;
  memberNumber: string;
  cardNumber: string | null;
  patientCode: string | null;
  prename: string | null;
  firstName: string;
  lastName: string;
  type: string;
  status: "active" | "suspended";
  /** วันที่เปิดใช้บัตร = วันที่ลงทะเบียนสมาชิกในระบบ */
  createdAt: string;
  /** ยอดทั้งหมด (บาท) — เงินเข้ารวมทุกช่องทาง: เปิดใช้บัตร + เติมเงิน */
  totalIn: number;
  /** ยอดจ่าย (บาท) — ใช้ซื้อสินค้า + ถอน + คืนบัตรเงินสด (ค่าบวก) */
  totalOut: number;
  /** คงเหลือ (บาท) = ยอดคงเหลือในบัญชีสมาชิกขณะนี้ */
  balance: number;
};

export type MemberBalancesInput = { search?: string };

/**
 * ROUND 65 — รายงาน "ยอดเงินในบัตร" ทุกใบในระบบ (ยอดทั้งหมด/ยอดจ่าย/คงเหลือ
 * คำนวณจาก member_transactions ทั้งหมด) · เรียงตามหมายเลขสมาชิก · ค้นหาได้จาก
 * ชื่อ/เลขสมาชิก/รหัสบัตร/รหัสผู้ป่วย
 */
export function memberBalances(db: SqliteDb, input: MemberBalancesInput = {}): MemberBalanceRow[] {
  const search = input.search?.trim();
  const where = search
    ? ` WHERE (m.first_name || ' ' || m.last_name || ' ' || m.member_number || ' ' || COALESCE(m.card_number, '') || ' ' || COALESCE(m.patient_code, '')) LIKE ?`
    : "";
  const params = search ? [`%${search}%`] : [];
  return db.prepare(`
    SELECT m.id, m.member_number AS memberNumber, m.card_number AS cardNumber, m.patient_code AS patientCode,
      m.prename, m.first_name AS firstName, m.last_name AS lastName, m.type, m.status,
      m.created_at AS createdAt, m.balance,
      ROUND(COALESCE(SUM(CASE WHEN t.type IN ('deposit', 'activation') THEN t.amount END), 0), 2) AS totalIn,
      ROUND(COALESCE(SUM(CASE WHEN t.type IN ('purchase', 'withdrawal', 'refund') THEN -t.amount END), 0), 2) AS totalOut
    FROM members m
    LEFT JOIN member_transactions t ON t.member_number = m.member_number
    ${where}
    GROUP BY m.id
    ORDER BY m.member_number
  `).all(...params) as unknown as MemberBalanceRow[];
}

// --- ROUND 65 (user): รายงานสินค้าคงคลังแบบมีช่วงเวลา ---------------------------
// ตรงกับชีทโรงพยาบาล "รายงานสินค้าคงคลัง": รหัสสินค้า · ชื่อสินค้า · ยอดยกมา ·
// ยอดขาย · คงเหลือ — ยอดยกมาคำนวณย้อนกลับจากสต็อกปัจจุบัน (ยกมา = ปัจจุบัน +
// ที่ขายในช่วง − ที่รับเข้าในช่วง) --------------------------------------------------

export type StockBalanceRow = {
  productId: number;
  /** รหัสสินค้า — บาร์โค้ดถ้ามี ไม่มีก็ใช้ SKU */
  code: string;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  category: string;
  active: number;
  /** จำนวนยกมาต้นช่วง */
  opening: number;
  /** จำนวนที่ขายออกในช่วง */
  sold: number;
  /** จำนวนที่รับเข้าในช่วง */
  received: number;
  /** จำนวนคงเหลือปัจจุบัน */
  remaining: number;
  sellingPrice: number;
  sellingValue: number;
};

export type StockBalanceInput = { from?: string; to?: string; search?: string };

export function stockBalanceReport(db: SqliteDb, input: StockBalanceInput = {}): StockBalanceRow[] {
  const fromDate = input.from && ISO_DATE_ONLY.test(input.from) ? input.from : formatDate(addDays(new Date(), -6));
  const rawTo = input.to && ISO_DATE_ONLY.test(input.to) ? input.to : formatDate(new Date());
  const toDate = rawTo < fromDate ? fromDate : rawTo;
  const since = `${fromDate} 00:00:00`;
  const until = `${toDate} 23:59:59`;
  // ยอดยกมา (จำนวนต้นช่วง) ต้องคิดจาก "ทุกอย่างที่เกิดหลังจากต้นช่วงจนถึงปัจจุบัน" เสมอ
  // เพราะคงเหลือคือสต็อกปัจจุบัน — ถ้าเลือก "ถึง" ย้อนหลัง ยอดขายหลังจากนั้นก็ยัง
  // ถูกหักออกจากสต็อกจริง จึงต้องบวกกลับให้ครบถึงวันนี้ (ยอดขายคอลัมน์แสดงตามช่วง)
  const sinceNow = `${formatDate(new Date())} 23:59:59`;

  const soldByProduct = new Map<number, number>();
  for (const row of db.prepare(`SELECT si.product_id AS productId, COALESCE(SUM(si.qty), 0) AS qty FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id IS NOT NULL AND s.created_at >= ? AND s.created_at <= ? GROUP BY si.product_id`).all(since, until) as unknown as { productId: number; qty: number }[]) {
    soldByProduct.set(row.productId, Number(row.qty));
  }
  const soldSinceStart = new Map<number, number>();
  for (const row of db.prepare(`SELECT si.product_id AS productId, COALESCE(SUM(si.qty), 0) AS qty FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id IS NOT NULL AND s.created_at >= ? AND s.created_at <= ? GROUP BY si.product_id`).all(since, sinceNow) as unknown as { productId: number; qty: number }[]) {
    soldSinceStart.set(row.productId, Number(row.qty));
  }
  const receivedByProduct = new Map<number, number>();
  for (const row of db.prepare(`SELECT product_id AS productId, COALESCE(SUM(COALESCE(received_qty, qty)), 0) AS qty FROM stock_lots WHERE received_at >= ? AND received_at <= ? GROUP BY product_id`).all(since, sinceNow) as unknown as { productId: number; qty: number }[]) {
    receivedByProduct.set(row.productId, Number(row.qty));
  }

  const search = input.search?.trim();
  const where = search ? ` WHERE (name LIKE ? OR sku LIKE ? OR COALESCE(barcode, '') LIKE ?)` : "";
  const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : [];
  const products = db.prepare(`SELECT id, sku, barcode, name, unit, category, stock, price, active FROM products${where} ORDER BY id`).all(...params) as unknown as { id: number; sku: string; barcode: string | null; name: string; unit: string; category: string; stock: number; price: number; active: number }[];
  return products.map((product) => {
    const sold = soldByProduct.get(product.id) ?? 0;
    const received = receivedByProduct.get(product.id) ?? 0;
    return {
      productId: product.id,
      code: product.barcode ?? product.sku,
      sku: product.sku,
      barcode: product.barcode,
      name: product.name,
      unit: product.unit,
      category: product.category,
      active: product.active,
      opening: product.stock + (soldSinceStart.get(product.id) ?? 0) - received,
      sold,
      received,
      remaining: product.stock,
      sellingPrice: product.price,
      sellingValue: round2(product.stock * product.price),
    };
  });
}

export function dashboardStats(db: SqliteDb, rangeDays = 30): DashboardStats {
  const range = Math.max(1, Math.min(365, Math.floor(rangeDays)));
  const today = startOfToday();
  const since = `${formatDate(addDays(today, -(range - 1)))} 00:00:00`;
  const totals = db.prepare(`SELECT COUNT(*) AS orders, ROUND(COALESCE(SUM(total), 0), 2) AS revenue FROM sales WHERE created_at >= ?`).get(since) as { orders: number; revenue: number };
  const itemsRow = db.prepare(`SELECT COALESCE(SUM(si.qty), 0) AS items FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at >= ?`).get(since) as { items: number };
  const revenueByDayRows = db.prepare(`SELECT substr(created_at, 1, 10) AS date, ROUND(SUM(total), 2) AS total FROM sales WHERE created_at >= ? GROUP BY date`).all(since) as unknown as { date: string; total: number }[];
  const byDay = new Map(revenueByDayRows.map((row) => [row.date, round2(row.total)]));
  const revenueByDay: { date: string; total: number }[] = [];
  for (let offset = range - 1; offset >= 0; offset -= 1) {
    const date = formatDate(addDays(today, -offset));
    revenueByDay.push({ date, total: byDay.get(date) ?? 0 });
  }
  const bestSellers = db.prepare(`SELECT si.name, SUM(si.qty) AS qty, ROUND(SUM(si.qty * si.price), 2) AS revenue FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at >= ? GROUP BY si.name ORDER BY qty DESC, revenue DESC LIMIT 10`).all(since) as unknown as { name: string; qty: number; revenue: number }[];
  const lowStock = db.prepare(`SELECT id, sku, name, unit, stock, reorder_point AS reorderPoint FROM products WHERE active = 1 AND stock <= reorder_point ORDER BY stock ASC`).all() as unknown as DashboardStats["lowStock"];
  const expirySoon = db.prepare(`SELECT l.id, l.product_id AS productId, p.sku, p.name, p.unit, l.lot, l.expiry_date AS expiry, l.qty FROM stock_lots l JOIN products p ON p.id = l.product_id WHERE l.expiry_date IS NOT NULL AND l.expiry_date >= ? AND l.expiry_date <= ? ORDER BY l.expiry_date`).all(formatDate(today), formatDate(addDays(today, 30))) as unknown as DashboardStats["expirySoon"];
  const recentActivities = db.prepare(`SELECT id, action, actor, actor_role AS actorRole, detail, tone, created_at AS createdAt FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 12`).all() as unknown as SqliteAuditLog[];
  const memberWalletRow = db.prepare(`SELECT ROUND(COALESCE(SUM(balance), 0), 2) AS total FROM members`).get() as { total: number };
  const memberCountRow = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active, COALESCE(SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END), 0) AS suspended FROM members`).get() as { total: number; active: number; suspended: number };
  return {
    rangeDays: range,
    totalSales: round2(totals.revenue),
    totalOrders: totals.orders,
    itemsSold: itemsRow.items,
    bestSellerCount: bestSellers[0]?.qty ?? 0,
    avgDailySales: round2(totals.revenue / range),
    revenueByDay,
    bestSellers,
    lowStock,
    expirySoon,
    recentActivities,
    memberWalletTotal: round2(memberWalletRow.total),
    memberCount: memberCountRow,
  };
}

// --- settings ---------------------------------------------------------------

/** ROUND 56 (user) — ภาพรวมสำหรับ "เครื่องมือติดตั้งระบบ" (โซนผู้พัฒนา): ตัวเลขที่ช่าง
 *  ต้องเห็นในวันขึ้นระบบ — จำนวนบัญชี/สมาชิก/สินค้า/บิลวันนี้/สินค้ายังไม่ตั้งราคา
 *  ขนาดฐานข้อมูล — ไว้ตรวจรับข้อมูลก่อนส่งมอบระบบให้ลูกค้า */
export type InstallOverview = {
  users: { total: number; active: number; devAccounts: number };
  members: { total: number; active: number; walletTotal: number };
  products: { total: number; active: number; zeroPrice: number; lowStock: number };
  sales: { todayBills: number; todayRevenue: number; totalBills: number };
  dbSizeBytes: number;
};

export function installOverview(db: SqliteDb, dbPath: string): InstallOverview {
  const users = listAppUsers(db);
  const memberRow = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active, ROUND(COALESCE(SUM(balance), 0), 2) AS walletTotal FROM members`).get() as { total: number; active: number; walletTotal: number };
  const productRow = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END), 0) AS active, COALESCE(SUM(CASE WHEN active = 1 AND price = 0 THEN 1 ELSE 0 END), 0) AS zeroPrice, COALESCE(SUM(CASE WHEN active = 1 AND stock <= reorder_point THEN 1 ELSE 0 END), 0) AS lowStock FROM products`).get() as { total: number; active: number; zeroPrice: number; lowStock: number };
  const today = formatDate(startOfToday());
  const todayRow = db.prepare(`SELECT COUNT(*) AS bills, ROUND(COALESCE(SUM(total), 0), 2) AS revenue FROM sales WHERE created_at >= ?`).get(`${today} 00:00:00`) as { bills: number; revenue: number };
  const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM sales`).get() as { total: number };
  let dbSizeBytes = 0;
  try { dbSizeBytes = statSync(dbPath).size; } catch { /* ไฟล์หายชั่วคราว = 0 */ }
  return {
    users: { total: users.length, active: users.filter((user) => user.active === 1).length, devAccounts: users.filter((user) => user.role === "dev" && user.active === 1).length },
    members: memberRow,
    products: productRow,
    sales: { todayBills: todayRow.bills, todayRevenue: todayRow.revenue, totalBills: totalRow.total },
    dbSizeBytes,
  };
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  memberNumberMode: "running",
  memberNumberPrefix: "M",
  memberNumberYearMode: "none",
  memberNumberYearDigits: 2,
  memberNumberSeparator: "-",
  memberNumberResetMonth: 1,
  memberNumberSequenceDigits: 6,
  storeName: "ร้านค้าสวัสดิการ",
  storeCode: "WEL-001",
  storeAddress: "ร้านค้าสวัสดิการ",
  appName: "ร้านค้าสวัสดิการ",
  appLogo: "",
  appBackground: "",
  appTheme: "indigo",
  // ROUND 75 — เมนูลัดหน้าร้าน: "" = เปิดใช้ทุกปุ่มบนรางซ้าย POS
  posRailHidden: "",
  posShortcutKeys: "",
  showBalanceOnReceipt: true,
  lowBalanceAlert: true,
  lowBalanceThreshold: 100,
  lowStockAlert: true,
  expiryAlert: true,
  expiryAlertDays: 30,
  dailyCutOffMode: "auto",
  dailyCutOffTime: "00:00",
  devAccess: false,
  // ROUND 38 (ข้อ 39) — สไตล์การแสดงผล + ระบบสำรองข้อมูล (ค่าเริ่มต้น: สำรองทุก 24 ชม. เก็บ 14 ไฟล์)
  appStyle: "shop",
  backupAutoEnabled: true,
  backupIntervalHours: 24,
  backupKeepCount: 14,
  // ROUND 42 — เครื่องพิมพ์สลิป: ค่าเริ่มต้น 72mm ตรงกับขนาดที่ระบบใช้อยู่แล้ว
  receiptPaperWidth: "72",
  // ROUND 56 — เช็คลิสต์วันขึ้นระบบ (โซนเครื่องมือติดตั้ง): ยังไม่ได้ติ๊กอะไร
  goliveChecks: "",
  // ROUND 61 — ระบบเวอร์ชัน: ยังไม่มีรหัส ยังไม่เคยทดลอง → เริ่มที่เวอร์ชันทั่วไป
  // (ระบบใหม่จะชวนเลือก "ทดลองใช้ 30 วัน" ตอนลงทะเบียนครั้งแรก)
  licenseKey: "",
  licenseName: "",
  trialStart: "",
  // ROUND 63 — บัญชีพร้อมเพย์ร้าน ยังไม่ตั้ง → หน้า POS จะแนะนำให้ไปตั้งที่หน้าตั้งค่า การชำระเงิน
  promptpayId: "",
  // ค่าเริ่มต้นเปิดอยู่ เพื่อให้ร้านที่เคยตั้งพร้อมเพย์ใช้งานต่อได้หลังอัปเดต
  promptpayActive: true,
  // FIX-5 — บัญชีธนาคารร้าน (รับเงินโอน) เริ่มต้นว่าง → ลูกค้าเห็นเฉพาะ QR เท่านั้น
  // ผู้บริหารเพิ่มได้ที่ ตั้งค่า → การชำระเงิน → บัญชีธนาคารร้าน
  bankAccounts: [],
  // FIX-8 (user) — พรีวิวก่อนพิมพ์ (ใบเสร็จ/บัตร/รายงาน): default true (ปลอดภัย) —
  // owner ที่อยากเร็วกว่านี้ปิดเพื่อ window.print() ทันทีเมื่อกดปุ่มพิมพ์
  printPreviewBefore: true,
  // FIX-9 (user) — @deprecated เก็บไว้ backward compat
  defaultPrinterName: "",
  // FIX-15 (user) — 3 เครื่องพิมพ์แยกตามประเภทเอกสาร
  receiptPrinterName: "",
  reportPrinterName: "",
  cardPrinterName: "",
  // FIX-18 (user) — toggle พรีวิวแยกตามประเภทเอกสาร (default true = ปลอดภัย)
  receiptPreviewBefore: true,
  reportPreviewBefore: true,
  cardPreviewBefore: true,
  // ROUND 68 — เบอร์ศูนย์ช่วยเหลือท้ายหน้าจอ ยังไม่ตั้ง → ไม่แสดงแถบช่วยเหลือใน footer
  helpPhone: "",
};

const SETTINGS_KEY = "app_settings";

// --- daily cut-off (ตัดยอดประจำวัน) -----------------------------------------

export type DayClosureRow = {
  id: number;
  periodStart: string;
  closedAt: string;
  bills: number;
  pieces: number;
  revenue: number;
  cashTotal: number;
  qrTotal: number;
  walletTotal: number;
  deposits: number;
  withdrawals: number;
  depositCount: number;
  depositAmount: number;
  activationCount: number;
  activationAmount: number;
  withdrawalCount: number;
  withdrawalAmount: number;
  refundCount: number;
  refundAmount: number;
  closedBy: string | null;
  note: string | null;
};

export type BusinessPeriodStatus = {
  mode: "auto" | "manual";
  cutOffTime: string;
  /** เริ่มรอบปัจจุบัน — auto: เวลาตัดยอของวันนี้/เมื่อวาน · manual: ตั้งแต่ตัดยอดครั้งล่าสุด */
  periodStart: string;
  /** รอบถัดไปจะเริ่มเมื่อ (auto เท่านั้น) */
  nextCutOffAt: string | null;
  totals: {
    bills: number;
    pieces: number;
    revenue: number;
    cashTotal: number;
    qrTotal: number;
    walletTotal: number;
    deposits: number;
    withdrawals: number;
    depositCount: number;
    depositAmount: number;
    activationCount: number;
    activationAmount: number;
    withdrawalCount: number;
    withdrawalAmount: number;
    refundCount: number;
    refundAmount: number;
  };
  lastClosure: DayClosureRow | null;
};

const CLOSURE_SELECT = `SELECT id, period_start AS periodStart, closed_at AS closedAt, bills, pieces, ROUND(revenue, 2) AS revenue, ROUND(cash_total, 2) AS cashTotal, ROUND(qr_total, 2) AS qrTotal, ROUND(wallet_total, 2) AS walletTotal, ROUND(deposits, 2) AS deposits, ROUND(withdrawals, 2) AS withdrawals, deposit_count AS depositCount, ROUND(deposit_amount, 2) AS depositAmount, activation_count AS activationCount, ROUND(activation_amount, 2) AS activationAmount, withdrawal_count AS withdrawalCount, ROUND(withdrawal_amount, 2) AS withdrawalAmount, refund_count AS refundCount, ROUND(refund_amount, 2) AS refundAmount, closed_by AS closedBy, note FROM day_closures`;

function parseCutOffTime(value: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (!match) return { hours: 0, minutes: 0 };
  return { hours: Math.min(23, Number(match[1])), minutes: Math.min(59, Number(match[2])) };
}

/** Totals in [since, until); a transaction at cutoff belongs to the new period. */
function periodTotals(db: SqliteDb, since: string, until = "9999-12-31 23:59:59") {
  const salesRows = db.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS revenue, SUM(CASE WHEN payment_method = 'เงินสด' THEN total ELSE 0 END) AS cashTotal, SUM(CASE WHEN payment_method = 'QR / สแกน' THEN total ELSE 0 END) AS qrTotal, SUM(CASE WHEN payment_method = 'หักบัญชีสมาชิก' THEN total ELSE 0 END) AS walletTotal FROM sales WHERE created_at >= ? AND created_at < ?`).get(since, until) as { bills: number; revenue: number; cashTotal: number | null; qrTotal: number | null; walletTotal: number | null };
  const piecesRow = db.prepare(`SELECT COALESCE(SUM(si.qty), 0) AS pieces FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at >= ? AND s.created_at < ?`).get(since, until) as { pieces: number };
  const walletRows = db.prepare(`SELECT COUNT(CASE WHEN type = 'deposit' THEN 1 END) AS depositCount, COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) AS depositAmount, COUNT(CASE WHEN type = 'activation' THEN 1 END) AS activationCount, COALESCE(SUM(CASE WHEN type = 'activation' THEN amount ELSE 0 END), 0) AS activationAmount, COUNT(CASE WHEN type = 'withdrawal' THEN 1 END) AS withdrawalCount, COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN ABS(amount) ELSE 0 END), 0) AS withdrawalAmount, COUNT(CASE WHEN type = 'refund' THEN 1 END) AS refundCount, COALESCE(SUM(CASE WHEN type = 'refund' THEN ABS(amount) ELSE 0 END), 0) AS refundAmount FROM member_transactions WHERE created_at >= ? AND created_at < ?`).get(since, until) as { depositCount: number; depositAmount: number; activationCount: number; activationAmount: number; withdrawalCount: number; withdrawalAmount: number; refundCount: number; refundAmount: number };
  return {
    bills: salesRows.bills,
    pieces: piecesRow.pieces,
    revenue: round2(salesRows.revenue),
    cashTotal: round2(salesRows.cashTotal ?? 0),
    qrTotal: round2(salesRows.qrTotal ?? 0),
    walletTotal: round2(salesRows.walletTotal ?? 0),
    deposits: round2(walletRows.depositAmount),
    withdrawals: round2(walletRows.withdrawalAmount),
    depositCount: Number(walletRows.depositCount),
    depositAmount: round2(walletRows.depositAmount),
    activationCount: Number(walletRows.activationCount),
    activationAmount: round2(walletRows.activationAmount),
    withdrawalCount: Number(walletRows.withdrawalCount),
    withdrawalAmount: round2(walletRows.withdrawalAmount),
    refundCount: Number(walletRows.refundCount),
    refundAmount: round2(walletRows.refundAmount),
  };
}

/** Live status of the current business period — what ตัดยอด will snapshot right now. */
export function businessPeriodStatus(db: SqliteDb): BusinessPeriodStatus {
  const settings = getSettings(db);
  const mode = settings.dailyCutOffMode === "manual" ? "manual" : "auto";
  const { hours, minutes } = parseCutOffTime(settings.dailyCutOffTime);
  const lastClosure = db.prepare(`${CLOSURE_SELECT} ORDER BY closed_at DESC, id DESC LIMIT 1`).get() as DayClosureRow | undefined;
  const now = new Date();
  let periodStart: string;
  let nextCutOffAt: string | null = null;
  if (mode === "auto") {
    // The business day runs cut-off → cut-off. Right now we are inside the
    // period that started at the most recent cut-off instant (today's or
    // yesterday's when the store hasn't passed today's cut-off yet).
    const todayCut = new Date(now);
    todayCut.setHours(hours, minutes, 0, 0);
    const start = now >= todayCut ? todayCut : new Date(todayCut.getTime() - 24 * 60 * 60 * 1000);
    periodStart = formatDateTime(start);
    // A manual close inside the scheduled day starts a new live period too.
    if (lastClosure && lastClosure.closedAt > periodStart) periodStart = lastClosure.closedAt;
    const next = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    nextCutOffAt = formatDateTime(next);
  } else {
    periodStart = lastClosure?.closedAt ?? `${formatDate(now)} 00:00:00`;
  }
  return {
    mode,
    cutOffTime: settings.dailyCutOffTime,
    periodStart,
    nextCutOffAt,
    totals: periodTotals(db, periodStart),
    lastClosure: lastClosure ?? null,
  };
}

export type CloseDayInput = {
  actor?: string;
  actorRole?: string;
  note?: string;
};

/**
 * ตัดยอดรอบปัจจุบัน — snapshots everything since the period started into
 * day_closures + audit log. The next period starts at this instant.
 */
export function closeBusinessDay(db: SqliteDb, input: CloseDayInput = {}): DayClosureRow {
  const status = businessPeriodStatus(db);
  return saveBusinessClosure(db, status.periodStart, formatDateTime(), status.totals, input);
}

function saveBusinessClosure(db: SqliteDb, periodStart: string, closedAt: string, totals: BusinessPeriodStatus["totals"], input: CloseDayInput): DayClosureRow {
  const actor = input.actor?.trim() || "??????????????????";
  runInTransaction(db, () => {
    // P2-b (double-close guard) — once this period is already snapshotted,
    // a second close must NOT insert a duplicate row. The early SELECT inside
    // the transaction prevents the common double-submit (double-click /
    // double-tap on the close button). Note: SQLite's default BEGIN DEFERRED
    // does not take a write lock until the first write, so two truly
    // concurrent closes could still both pass the SELECT — but the UI sends
    // closes serially per user, and the SELECT guard handles the realistic
    // double-submit race cleanly.
    const alreadyClosed = db.prepare(`SELECT 1 FROM day_closures WHERE period_start = ?`).get(periodStart);
    if (alreadyClosed) throw new StoreError("รอบขายนี้ถูกตัดยอดไปแล้ว — ไม่สามารถตัดซ้อนได้");
    db.prepare(`INSERT INTO day_closures (period_start, closed_at, bills, pieces, revenue, cash_total, qr_total, wallet_total, deposits, withdrawals, deposit_count, deposit_amount, activation_count, activation_amount, withdrawal_count, withdrawal_amount, refund_count, refund_amount, closed_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      periodStart,
      closedAt,
      totals.bills,
      totals.pieces,
      totals.revenue,
      totals.cashTotal,
      totals.qrTotal,
      totals.walletTotal,
      totals.deposits,
      totals.withdrawals,
      totals.depositCount,
      totals.depositAmount,
      totals.activationCount,
      totals.activationAmount,
      totals.withdrawalCount,
      totals.withdrawalAmount,
      totals.refundCount,
      totals.refundAmount,
      actor,
      input.note?.trim() || null,
    );
    logAction(
      db,
      "ตัดยอดรอบขาย",
      actor,
      `รอบ ${periodStart} → ${closedAt} · ${totals.bills} บิล · ${money(totals.revenue)}${input.note?.trim() ? ` · ${input.note.trim()}` : ""}`,
      "purple",
      input.actorRole ?? null,
      closedAt,
    );
  });
  return db.prepare(`${CLOSURE_SELECT} ORDER BY closed_at DESC, id DESC LIMIT 1`).get() as DayClosureRow;
}

/** Persist elapsed automatic periods, including catch-up after a server restart.
 * The cursor is separate from business settings and advances only after saving.
 * Work is bounded per tick so an old installation cannot block the server.
 */
export function closeElapsedBusinessPeriods(db: SqliteDb, now = new Date()): DayClosureRow[] {
  const settings = getSettings(db);
  if (settings.dailyCutOffMode === "manual") return [];
  const { hours, minutes } = parseCutOffTime(settings.dailyCutOffTime);
  const boundary = new Date(now);
  boundary.setHours(hours, minutes, 0, 0);
  if (boundary > now) boundary.setDate(boundary.getDate() - 1);
  const boundaryText = formatDateTime(boundary);
  const latest = db.prepare(`${CLOSURE_SELECT} ORDER BY closed_at DESC, id DESC LIMIT 1`).get() as DayClosureRow | undefined;
  const cursorKey = "automaticCutoffCursor";
  const cursor = db.prepare(`SELECT value FROM store_settings WHERE key = ?`).get(cursorKey) as { value: string } | undefined;
  let since = cursor?.value;
  if (!since) {
    const first = db.prepare(`SELECT MIN(created_at) AS createdAt FROM (SELECT created_at FROM sales UNION ALL SELECT created_at FROM member_transactions)`).get() as { createdAt: string | null };
    const start = first.createdAt ? new Date(first.createdAt.replace(" ", "T")) : new Date(boundary);
    start.setHours(hours, minutes, 0, 0);
    if (first.createdAt && formatDateTime(start) > first.createdAt) start.setDate(start.getDate() - 1);
    since = formatDateTime(start);
  }
  if (latest && latest.closedAt > since) since = latest.closedAt;
  const saveCursor = (value: string) => db.prepare(`INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(cursorKey, value);
  const closures: DayClosureRow[] = [];
  for (let i = 0; since < boundaryText && i < 31; i++) {
    const end = new Date(since.replace(" ", "T"));
    end.setHours(hours, minutes, 0, 0);
    if (formatDateTime(end) <= since) end.setDate(end.getDate() + 1);
    const until = formatDateTime(end);
    if (until > boundaryText) break;
    // A crash after saving but before advancing the cursor must not duplicate it.
    const existing = db.prepare(`SELECT closed_at AS closedAt FROM day_closures WHERE period_start = ?`).get(since) as { closedAt: string } | undefined;
    if (existing) {
      if (existing.closedAt <= since) throw new StoreError("รอบตัดยอดเดิมมีช่วงเวลาไม่ถูกต้อง");
      since = existing.closedAt;
    } else {
      closures.push(saveBusinessClosure(db, since, until, periodTotals(db, since, until), {
        actor: "ระบบอัตโนมัติ", note: "ตัดยอดตามเวลาที่กำหนด",
      }));
      since = until;
    }
    saveCursor(since);
  }
  saveCursor(since);
  return closures;
}

/** Day-closure history (ประวัติการตัดยอดรอบขาย), newest first. */
export function listDayClosures(db: SqliteDb, limit = 30): DayClosureRow[] {
  const capped = Math.max(1, Math.min(90, Math.floor(limit)));
  return db.prepare(`${CLOSURE_SELECT} ORDER BY closed_at DESC, id DESC LIMIT ?`).all(capped) as unknown as DayClosureRow[];
}

export function getSettings(db: SqliteDb): StoreSettings {
  const row = db.prepare(`SELECT value FROM store_settings WHERE key = ?`).get(SETTINGS_KEY) as { value: string } | undefined;
  const stored = row ? (JSON.parse(row.value) as Partial<StoreSettings>) : {};
  return { ...DEFAULT_STORE_SETTINGS, ...stored, memberNumberMode: getMemberNumberMode(db) };
}

export function setSettings(db: SqliteDb, patch: Partial<StoreSettings>, actor = "ผู้บริหาร", actorRole?: string | null): StoreSettings {
  if (patch.memberNumberMode !== undefined) {
    setMemberNumberMode(db, patch.memberNumberMode);
  }
  // ROUND 61 — ฟิลด์เวอร์ชัน/ลิขสิทธิ์เปลี่ยนได้ผ่าน edition.* เท่านั้น
  // (ออกรหัส–ใช้รหัส–เริ่มทดลอง มี audit + validation เฉพาะทาง) — settings.set กลั่นทิ้งเสมอ
  const { memberNumberMode: _mode, licenseKey: _licenseKey, licenseName: _licenseName, trialStart: _trialStart, ...rest } = patch;
  if (Object.keys(rest).length > 0) {
    const next = { ...getSettings(db), ...rest };
    db.prepare(`INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(SETTINGS_KEY, JSON.stringify(next));
  }
  const changedKeys = Object.entries(patch)
    .map(([key, value]) => `${key}: ${typeof value === "boolean" ? (value ? "เปิด" : "ปิด") : String(value)}`)
    .join(" · ");
  logAction(db, "บันทึกการตั้งค่า", actor, changedKeys || "ไม่มีการเปลี่ยนแปลง", "amber", actorRole ?? null);
  return getSettings(db);
}

/**
 * ROUND 61 — เขียนฟิลด์เวอร์ชัน/ลิขสิทธิ์โดยตรง (ไม่ผ่าน setSettings ที่กลั่นทิ้ง)
 * เรียกเฉพาะจาก edition.* ใน routers ที่มีการตรวจสิทธิ์ + audit log ของตัวเองแล้ว
 */
export function setEditionSettings(db: SqliteDb, patch: Partial<Pick<StoreSettings, "licenseKey" | "licenseName" | "trialStart">>): StoreSettings {
  const next = { ...getSettings(db), ...patch };
  db.prepare(`INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(SETTINGS_KEY, JSON.stringify(next));
  return getSettings(db);
}

// --- app users & local sessions ---------------------------------------------

/** Login account role for the welfare store app itself (local session auth). */
export type AppUserRole = "staff" | "admin" | "dev";

/**
 * หลัง RBAC migration (ensureRbacSeed) ค่าใน app_users.role ถูกเขียนใหม่เป็นชื่อ
 * บทบาทแบบละเอียด (cashier / stock_officer / supervisor / manager / auditor /
 * administrator) แต่ทั้ง client และ logic ส่วนอื่นยังพูดศัพท์เดิม 3 ค่า
 * (staff / admin / dev) อยู่ ถ้าไม่ normalize ตรงนี้ ตัวนับสิทธิ์ ฟิลเตอร์ และ
 * last-admin guard จะเทียบค่าไม่ทันกันเงียบ ๆ (นับได้ 0 ทั้งที่มีผู้ใช้อยู่)
 *
 * อ่าน: DB value → AppUserRole · เขียน: AppUserRole → DB value
 */
const APP_ROLE_BY_STORED_ROLE: Record<string, AppUserRole> = {
  cashier: "staff",
  stock_officer: "staff",
  supervisor: "staff",
  auditor: "staff",
  staff: "staff",
  manager: "admin",
  administrator: "admin",
  admin: "admin",
  dev: "dev",
};

/** ค่าที่เขียนลง app_users.role จริง ๆ เมื่อผู้ดูแลเลือกสิทธิ์แบบ 3 ค่า */
const STORED_ROLE_BY_APP_ROLE: Record<AppUserRole, string> = {
  staff: "cashier",
  admin: "administrator",
  dev: "dev",
};

/** แปลงค่า role ที่อ่านมาจากฐานข้อมูลให้อยู่ในสัญญา 3 ค่าที่ทั้งแอปเข้าใจ */
export function normalizeAppRole(role: string | null | undefined): AppUserRole {
  return APP_ROLE_BY_STORED_ROLE[String(role ?? "")] ?? "staff";
}

/** แปลงสิทธิ์ 3 ค่ากลับเป็นชื่อบทบาทที่เก็บใน DB (ต้องอยู่ในตาราง roles) */
export function storedRoleFor(appRole: AppUserRole): string {
  return STORED_ROLE_BY_APP_ROLE[appRole] ?? "cashier";
}

// ============================================================================
// RBAC — Role-Based Access Control with granular permissions
// ============================================================================

export type PermissionKey =
  | "POS.SELL" | "POS.VOID" | "POS.REFUND" | "POS.DISCOUNT" | "POS.SPECIAL"
  | "STOCK.VIEW" | "STOCK.RECEIVE" | "STOCK.ADJUST" | "STOCK.COUNT" | "STOCK.TRANSFER"
  | "REPORT.SALES" | "REPORT.PROFIT" | "REPORT.INVENTORY" | "REPORT.AUDIT" | "REPORT.ADVANCED"
  | "MEMBER.VIEW" | "MEMBER.EDIT" | "MEMBER.WALLET" | "MEMBER.DELETE"
  | "SYSTEM.USER_MANAGE" | "SYSTEM.ROLE_MANAGE" | "SYSTEM.BACKUP" | "SYSTEM.RESTORE"
  | "SYSTEM.SETTING" | "SYSTEM.LICENSE" | "SYSTEM.UPDATE" | "SYSTEM.SESSION_REVOKE";

export const PERMISSION_CATALOG: { key: PermissionKey; group: string; description: string }[] = [
  { key: "POS.SELL", group: "POS", description: "ขายสินค้าและรับชำระ" },
  { key: "POS.VOID", group: "POS", description: "ยกเลิกบิล" },
  { key: "POS.REFUND", group: "POS", description: "คืนเงิน / คืนบัตรเงินสด" },
  { key: "POS.DISCOUNT", group: "POS", description: "ให้ส่วนลดบิล" },
  { key: "POS.SPECIAL", group: "POS", description: "เปิดรายการพิเศษ" },
  { key: "STOCK.VIEW", group: "STOCK", description: "ดูสต็อก" },
  { key: "STOCK.RECEIVE", group: "STOCK", description: INVENTORY_ACTION_LABELS.receive },
  { key: "STOCK.ADJUST", group: "STOCK", description: "ปรับยอดสต็อก" },
  { key: "STOCK.COUNT", group: "STOCK", description: "นับสต็อก" },
  { key: "STOCK.TRANSFER", group: "STOCK", description: "โอนสินค้าระหว่างคลัง" },
  { key: "REPORT.SALES", group: "REPORT", description: "ดูรายงานยอดขาย" },
  { key: "REPORT.PROFIT", group: "REPORT", description: "ดูรายงานกำไร/ต้นทุน" },
  { key: "REPORT.INVENTORY", group: "REPORT", description: "ดูรายงานสินค้าคงคลัง" },
  { key: "REPORT.AUDIT", group: "REPORT", description: "ดู audit log" },
  { key: "REPORT.ADVANCED", group: "REPORT", description: "รายงานขั้นสูง" },
  { key: "MEMBER.VIEW", group: "MEMBER", description: "ดูข้อมูลสมาชิก" },
  { key: "MEMBER.EDIT", group: "MEMBER", description: "แก้ข้อมูลสมาชิก" },
  { key: "MEMBER.WALLET", group: "MEMBER", description: "เติม/ถอนเงินสมาชิก" },
  { key: "MEMBER.DELETE", group: "MEMBER", description: "ลบสมาชิก" },
  { key: "SYSTEM.USER_MANAGE", group: "SYSTEM", description: "จัดการบัญชีผู้ใช้" },
  { key: "SYSTEM.ROLE_MANAGE", group: "SYSTEM", description: "จัดการ Role/Permission" },
  { key: "SYSTEM.BACKUP", group: "SYSTEM", description: "สำรองข้อมูล" },
  { key: "SYSTEM.RESTORE", group: "SYSTEM", description: "กู้คืนข้อมูล" },
  { key: "SYSTEM.SETTING", group: "SYSTEM", description: "ตั้งค่าระบบ" },
  { key: "SYSTEM.LICENSE", group: "SYSTEM", description: "จัดการลิขสิทธิ์" },
  { key: "SYSTEM.UPDATE", group: "SYSTEM", description: "อัปเดตระบบ" },
  { key: "SYSTEM.SESSION_REVOKE", group: "SYSTEM", description: "ยกเลิก session" },
];

interface RoleDef {
  name: string;
  label: string;
  description: string;
  isSystem: boolean;
  permissions: PermissionKey[];
}

export const SYSTEM_ROLES: RoleDef[] = [
  {
    name: "cashier", label: "พนักงานขายหน้าร้าน",
    description: "เจ้าหน้าที่หน้า POS — ขาย พักบิล รับเงิน",
    isSystem: true,
    permissions: ["POS.SELL", "POS.DISCOUNT", "POS.SPECIAL", "STOCK.VIEW", "REPORT.SALES", "MEMBER.VIEW", "MEMBER.WALLET"],
  },
  {
    name: "stock_officer", label: "เจ้าหน้าที่คลังสินค้า",
    description: "ดูแลรับเข้า ปรับยอด นับสต็อก",
    isSystem: true,
    permissions: ["STOCK.VIEW", "STOCK.RECEIVE", "STOCK.ADJUST", "STOCK.COUNT", "REPORT.INVENTORY", "MEMBER.VIEW"],
  },
  {
    name: "supervisor", label: "หัวหน้างาน",
    description: "ดูแลหน้าร้าน + อนุมัติการเงินสำคัญ",
    isSystem: true,
    permissions: ["POS.SELL", "POS.VOID", "POS.REFUND", "POS.DISCOUNT", "POS.SPECIAL", "STOCK.VIEW", "STOCK.RECEIVE", "STOCK.ADJUST", "STOCK.COUNT", "REPORT.SALES", "REPORT.INVENTORY", "MEMBER.VIEW", "MEMBER.EDIT", "MEMBER.WALLET"],
  },
  {
    name: "manager", label: "ผู้จัดการ",
    description: "ดูรายงานครบ + จัดการสมาชิกและผู้ใช้บางส่วน",
    isSystem: true,
    permissions: ["POS.SELL", "POS.VOID", "POS.REFUND", "POS.DISCOUNT", "POS.SPECIAL", "STOCK.VIEW", "STOCK.RECEIVE", "STOCK.ADJUST", "STOCK.COUNT", "STOCK.TRANSFER", "REPORT.SALES", "REPORT.PROFIT", "REPORT.INVENTORY", "REPORT.AUDIT", "MEMBER.VIEW", "MEMBER.EDIT", "MEMBER.WALLET", "MEMBER.DELETE", "SYSTEM.USER_MANAGE", "SYSTEM.BACKUP"],
  },
  {
    name: "auditor", label: "ผู้ตรวจสอบ",
    description: "ดู audit log + รายงาน + ประวัติ แต่ไม่แก้ไข",
    isSystem: true,
    permissions: ["STOCK.VIEW", "REPORT.SALES", "REPORT.PROFIT", "REPORT.INVENTORY", "REPORT.AUDIT", "MEMBER.VIEW"],
  },
  {
    name: "administrator", label: "ผู้ดูแลระบบ",
    description: "สิทธิ์เต็ม — ตั้งค่า ลิขสิทธิ์ สำรองข้อมูล อัปเดตระบบ",
    isSystem: true,
    permissions: PERMISSION_CATALOG.map(p => p.key),
  },
];

/** Seed roles + permissions into the DB (idempotent). */
export function ensureRbacSeed(db: SqliteDb): void {
  // Remove the retired permission and its role assignments from upgraded databases.
  db.prepare(`DELETE FROM permissions WHERE key = 'MEMBER.LIMIT_APPROVE'`).run();
  // Insert all permissions
  for (const p of PERMISSION_CATALOG) {
    db.prepare(`INSERT OR IGNORE INTO permissions (key, group_name, description) VALUES (?, ?, ?)`).run(p.key, p.group, p.description);
  }
  // Insert roles + role_permissions
  for (const role of SYSTEM_ROLES) {
    db.prepare(`INSERT OR IGNORE INTO roles (name, label, description, is_system) VALUES (?, ?, ?, ?)`).run(role.name, role.label, role.description, role.isSystem ? 1 : 0);
    for (const perm of role.permissions) {
      db.prepare(`INSERT OR IGNORE INTO role_permissions (role_name, permission_key) VALUES (?, ?)`).run(role.name, perm);
    }
  }
  // Migrate existing users ONLY ONCE — when roles table was just created.
  // Check if any user still has old role values (staff/admin/dev) AND
  // the new RBAC roles exist. If yes, migrate. If no (already migrated), skip.
  const needsMigration = db.prepare(`SELECT COUNT(*) as c FROM app_users WHERE role IN ('staff', 'admin', 'dev')`).get() as { c: number };
  if (needsMigration.c > 0) {
    db.prepare(`UPDATE app_users SET role = 'cashier' WHERE role = 'staff'`).run();
    db.prepare(`UPDATE app_users SET role = 'administrator' WHERE role IN ('admin', 'dev')`).run();
  }
}

/** Get all permissions for a user's role. */
export function getUserPermissions(db: SqliteDb, role: string): Set<string> {
  const rows = db.prepare(`SELECT permission_key FROM role_permissions WHERE role_name = ?`).all(role) as { permission_key: string }[];
  return new Set(rows.map(r => r.permission_key));
}

/** Check if a role has a specific permission. */
export function hasPermission(db: SqliteDb, role: string, permission: PermissionKey): boolean {
  const row = db.prepare(`SELECT 1 FROM role_permissions WHERE role_name = ? AND permission_key = ?`).get(role, permission);
  return Boolean(row);
}


// ============================================================================
// Stock Movement Ledger — central truth of every stock change
// ============================================================================

export type StockMovementType = 'RECEIVE' | 'SALE' | 'ADJUST' | 'TRANSFER' | 'RETURN' | 'VOID' | 'COUNT';

export interface StockMovementInput {
  type: StockMovementType;
  productId: number;
  qtyDelta: number; // signed: +in / -out
  unitCost?: number;
  refType?: string;
  refId?: number;
  reason?: string;
  actor?: string;
  actorRole?: string;
}

/** Record a stock movement in the ledger (does NOT update products.stock — caller must do that). */
export function recordMovement(db: SqliteDb, input: StockMovementInput): void {
  db.prepare(`INSERT INTO stock_movements (product_id, type, qty_delta, unit_cost, ref_type, ref_id, reason, actor, actor_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    input.productId,
    input.type,
    Math.trunc(input.qtyDelta),
    round2(input.unitCost ?? 0),
    input.refType ?? null,
    input.refId ?? null,
    input.reason ?? null,
    input.actor ?? null,
    input.actorRole ?? null,
    formatDateTime(),
  );
}

/** Stock Card — query stock movements for a product within a date range. */
export function stockCard(db: SqliteDb, productId: number, from?: string, to?: string): { id: number; type: string; qtyDelta: number; unitCost: number; reason: string | null; actor: string | null; createdAt: string }[] {
  let sql = `SELECT id, type, qty_delta AS qtyDelta, ROUND(unit_cost, 2) AS unitCost, reason, actor, created_at AS createdAt FROM stock_movements WHERE product_id = ?`;
  const params: (string | number)[] = [productId];
  if (from) { sql += ` AND created_at >= ?`; params.push(from); }
  if (to) { sql += ` AND created_at <= ?`; params.push(to); }
  sql += ` ORDER BY created_at ASC`;
  return db.prepare(sql).all(...params) as { id: number; type: string; qtyDelta: number; unitCost: number; reason: string | null; actor: string | null; createdAt: string }[];
}

// ============================================================================
// Cashier Shift — open/close + cash count
// ============================================================================

export interface CashierShift {
  id: number;
  cashierName: string;
  status: string;
  openingCash: number;
  expectedCash: number;
  countedCash: number | null;
  cashDifference: number | null;
  expectedQr: number;
  expectedWallet: number;
  billsCount: number;
  pieces: number;
  salesTotal: number;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
}

export function openShift(db: SqliteDb, input: { cashierName: string; openingCash: number; note?: string }): CashierShift {
  const existing = db.prepare(`SELECT id FROM cashier_shifts WHERE cashier_name = ? AND status = 'open'`).get(input.cashierName);
  if (existing) throw new StoreError("คุณมีกะที่เปิดอยู่แล้ว · ปิดกะปัจจุบันก่อนเปิดใหม่");
  const result = db.prepare(`INSERT INTO cashier_shifts (cashier_name, status, opening_cash, expected_cash, note, opened_at) VALUES (?, 'open', ?, ?, ?, ?)`).run(
    input.cashierName, round2(input.openingCash), round2(input.openingCash), input.note ?? null, formatDateTime()
  );
  return getShiftById(db, Number(result.lastInsertRowid))!;
}

export function closeShift(db: SqliteDb, input: { shiftId: number; countedCash: number; note?: string }): CashierShift {
  const shift = getShiftById(db, input.shiftId);
  if (!shift) throw new StoreError("ไม่พบกะที่ระบุ");
  if (shift.status !== 'open') throw new StoreError("กะนี้ถูกปิดไปแล้ว");
  const expectedCash = round2(shift.openingCash + shift.expectedCash - shift.openingCash);
  const cashDifference = round2(input.countedCash - shift.expectedCash);
  db.prepare(`UPDATE cashier_shifts SET status = 'closed', counted_cash = ?, cash_difference = ?, note = ?, closed_at = ? WHERE id = ?`).run(
    round2(input.countedCash), cashDifference, input.note ?? shift.note, formatDateTime(), input.shiftId
  );
  return getShiftById(db, input.shiftId)!;
}

export function getShiftById(db: SqliteDb, id: number): CashierShift | undefined {
  const row = db.prepare(`SELECT id, cashier_name AS cashierName, status, ROUND(opening_cash, 2) AS openingCash, ROUND(expected_cash, 2) AS expectedCash, ROUND(counted_cash, 2) AS countedCash, ROUND(cash_difference, 2) AS cashDifference, ROUND(expected_qr, 2) AS expectedQr, ROUND(expected_wallet, 2) AS expectedWallet, bills_count AS billsCount, pieces, ROUND(sales_total, 2) AS salesTotal, note, opened_at AS openedAt, closed_at AS closedAt FROM cashier_shifts WHERE id = ?`).get(id) as CashierShift | undefined;
  return row;
}

export function listShifts(db: SqliteDb, status?: string): CashierShift[] {
  const sql = status
    ? `SELECT id, cashier_name AS cashierName, status, ROUND(opening_cash, 2) AS openingCash, ROUND(expected_cash, 2) AS expectedCash, ROUND(counted_cash, 2) AS countedCash, ROUND(cash_difference, 2) AS cashDifference, ROUND(expected_qr, 2) AS expectedQr, ROUND(expected_wallet, 2) AS expectedWallet, bills_count AS billsCount, pieces, ROUND(sales_total, 2) AS salesTotal, note, opened_at AS openedAt, closed_at AS closedAt FROM cashier_shifts WHERE status = ? ORDER BY opened_at DESC`
    : `SELECT id, cashier_name AS cashierName, status, ROUND(opening_cash, 2) AS openingCash, ROUND(expected_cash, 2) AS expectedCash, ROUND(counted_cash, 2) AS countedCash, ROUND(cash_difference, 2) AS cashDifference, ROUND(expected_qr, 2) AS expectedQr, ROUND(expected_wallet, 2) AS expectedWallet, bills_count AS billsCount, pieces, ROUND(sales_total, 2) AS salesTotal, note, opened_at AS openedAt, closed_at AS closedAt FROM cashier_shifts ORDER BY opened_at DESC LIMIT 50`;
  return (status ? db.prepare(sql).all(status) : db.prepare(sql).all()) as unknown as CashierShift[];
}

// ============================================================================
// Void Sale — reverse stock + wallet, mark sale as voided
// ============================================================================

export function voidSale(db: SqliteDb, input: { saleId: number; reason: string; actor?: string; actorRole?: string }): { reversed: boolean } {
  const sale = db.prepare(`SELECT id, order_number AS orderNumber, total, payment_method AS paymentMethod, member_number AS memberNumber, card_usage_session_id AS cardUsageSessionId FROM sales WHERE id = ?`).get(input.saleId) as { id: number; orderNumber: string; total: number; paymentMethod: string; memberNumber: string | null; cardUsageSessionId: number | null } | undefined;
  if (!sale) throw new StoreError("ไม่พบบิลนี้ในระบบ");
  if (!input.reason.trim()) throw new StoreError("ต้องระบุเหตุผลในการยกเลิก");
  const items = db.prepare(`SELECT product_id AS productId, qty, cost FROM sale_items WHERE sale_id = ?`).all(input.saleId) as { productId: number; qty: number; cost: number }[];
  runInTransaction(db, () => {
    // P2-b (TOCTOU fix) — the "already voided" check MUST live INSIDE the
    // transaction. Otherwise two concurrent void requests can both pass the
    // outer SELECT (neither sees the other's UPDATE) and double-refund the
    // wallet + double-restore the stock.
    const existingVoid = db.prepare(`SELECT 1 FROM sales WHERE id = ? AND voided = 1`).get(input.saleId);
    if (existingVoid) throw new StoreError("บิลนี้ถูกยกเลิกไปแล้ว");
    // Reverse stock for each catalog item
    for (const item of items) {
      if (!item.productId) continue;
      recordMovement(db, {
        type: 'VOID',
        productId: item.productId,
        qtyDelta: item.qty, // positive — restore
        unitCost: item.cost,
        refType: 'void',
        refId: sale.id,
        reason: `ยกเลิกบิล ${sale.orderNumber} · ${input.reason}`,
        actor: input.actor,
        actorRole: input.actorRole,
      });
      db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`).run(item.qty, item.productId);
    }
    // Restore the exact original allocations, including their residual satang.
    const allocations = db.prepare(`SELECT a.lot_id AS lotId, a.qty, a.cost_satang AS costSatang FROM sale_lot_allocations a JOIN sale_items si ON si.id = a.sale_item_id WHERE si.sale_id = ?`).all(sale.id) as { lotId: number; qty: number; costSatang: number }[];
    for (const allocation of allocations) {
      db.prepare(`UPDATE stock_lots SET qty = qty + ?, remaining_value_satang = COALESCE(remaining_value_satang, ROUND(qty * cost * 100)) + ? WHERE id = ?`).run(allocation.qty, allocation.costSatang, allocation.lotId);
    }
    // Reverse wallet if wallet payment
    if (sale.paymentMethod === "หักบัญชีสมาชิก" && sale.memberNumber) {
      const member = db.prepare(`SELECT balance FROM members WHERE member_number = ?`).get(sale.memberNumber) as { balance: number } | undefined;
      if (member) {
        const newBalance = round2(member.balance + sale.total);
        db.prepare(`UPDATE members SET balance = ? WHERE member_number = ?`).run(newBalance, sale.memberNumber);
        const reversal = db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, balance_after, payment_method, actor, created_at, card_usage_session_id) VALUES (?, 'refund', ?, ?, ?, ?, ?, ?, ?)`).run(
          sale.memberNumber,
          `ยกเลิกบิล ${sale.orderNumber} · คืนเงิน ฿${sale.total.toFixed(2)} · ${input.reason}`,
          sale.total,
          newBalance,
          sale.paymentMethod,
          input.actor ?? null,
          formatDateTime(),
          sale.cardUsageSessionId,
        );
        // The legacy insert trigger links NULL to the currently open round.
        // A reversal belongs to the sale's round, including an unknown legacy round.
        db.prepare(`UPDATE member_transactions SET card_usage_session_id = ? WHERE id = ?`).run(sale.cardUsageSessionId, Number(reversal.lastInsertRowid));
      }
    }
    // Mark sale as voided
    db.prepare(`UPDATE sales SET voided = 1, void_reason = ?, void_actor = ?, voided_at = ? WHERE id = ?`).run(
      input.reason, input.actor ?? null, formatDateTime(), input.saleId
    );
    // Record refund
    db.prepare(`INSERT INTO refunds (sale_id, amount, reason, method, actor, status, created_at) VALUES (?, ?, ?, ?, ?, 'completed', ?)`).run(
      sale.id, sale.total, input.reason, sale.paymentMethod, input.actor ?? null, formatDateTime()
    );
    logAction(db, "ยกเลิกบิล", input.actor?.trim() || "เจ้าหน้าที่", `บิล ${sale.orderNumber} · ยอด ฿${sale.total.toFixed(2)} · ${input.reason}`, "red", input.actorRole ?? null, formatDateTime());
  });
  return { reversed: true };
}


// Backward compat: map old roles to new for existing code
export function roleToPermissions(role: string): string[] {
  const found = SYSTEM_ROLES.find(r => r.name === role || (role === "staff" && r.name === "cashier") || ((role === "admin" || role === "dev") && r.name === "administrator"));
  return found ? found.permissions : SYSTEM_ROLES[0].permissions;
}

export function isAdminRole(role: string): boolean {
  return role === "administrator" || role === "manager" || role === "admin" || role === "dev";
}



/** Thai display label for an app user role (audit log actorRole / UI badges). */
export function appRoleThai(role: AppUserRole | string): string {
  const normalized = normalizeAppRole(role);
  return normalized === "admin" ? "ผู้บริหาร" : normalized === "dev" ? "ผู้พัฒนา" : "เจ้าหน้าที่";
}

// ROUND 36 (ข้อ 31) — กฎความแข็งแรงของรหัสผ่าน (มิเรอร์กันทั้ง server และ client/src/components/PasswordMeter.tsx)
const PW_HAS_LETTER = /[A-Za-z\u0E00-\u0E7F]/;
const PW_HAS_DIGIT = /[0-9]/;
const PW_HAS_SYMBOL = /[^A-Za-z0-9\u0E00-\u0E7F\s]/;

/** Minimum password length per role — dev accounts need the strongest secrets. */
export function passwordMinLength(role: AppUserRole = "staff"): number {
  return role === "dev" ? 12 : 8;
}

/**
 * Validates a password against the store's strength policy and returns Thai
 * issue strings (empty array = strong enough). ทุกบทบาท: ยาว ≥ 8 + มีตัวอักษร +
 * มีตัวเลข · บทบาท dev: ยาว ≥ 12 + ต้องมีสัญลักษณ์พิเศษด้วย
 */
export function validatePasswordStrength(password: string, role: AppUserRole = "staff"): string[] {
  if (typeof password !== "string" || password === "") return ["กรุณาระบุรหัสผ่าน"];
  const issues: string[] = [];
  const minLength = passwordMinLength(role);
  if (password.length < minLength) {
    issues.push(`รหัสผ่านต้องมีความยาวอย่างน้อย ${minLength} ตัวอักษร`);
  }
  if (!PW_HAS_LETTER.test(password)) issues.push("รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว");
  if (!PW_HAS_DIGIT.test(password)) issues.push("รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว");
  if (role === "dev" && !PW_HAS_SYMBOL.test(password)) {
    issues.push("รหัสผ่านบัญชีผู้พัฒนา (dev) ต้องมีสัญลักษณ์พิเศษอย่างน้อย 1 ตัว เช่น ! @ # $");
  }
  return issues;
}

/** Login account for the welfare store app itself (local session auth). */
export type AppUser = {
  id: number;
  username: string;
  passwordHash: string;
  displayName: string;
  role: AppUserRole;
  active: number;
  createdAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
  /** ROUND 36 (ข้อ 31) — 1 = ต้องเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน (บัญชีใหม่/รหัสที่ผู้บริหารตั้งให้) */
  mustChangePassword: number;
};

const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 64;
/** Session lifetime for local logins. */
export const APP_SESSION_TTL_DAYS = 7;

/** scrypt password hash, format: `scrypt$<saltHex>$<keyHex>`. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const key = scryptSync(plain, salt, SCRYPT_KEY_BYTES);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Constant-time verification. Malformed stored hashes simply fail. */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1], "hex");
    expected = Buffer.from(parts[2], "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = scryptSync(plain, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const APP_USER_SELECT = `SELECT id, username, password_hash AS passwordHash, display_name AS displayName, role, active, created_at AS createdAt, failed_attempts AS failedAttempts, locked_until AS lockedUntil, must_change_password AS mustChangePassword FROM app_users`;

// --- login rate limiting (failed-password lockout) ----------------------------

/** Wrong passwords allowed before a temporary lock. */
export const LOGIN_MAX_FAILURES = 5;
/** Lock duration in minutes once the failure limit is reached. */
export const LOGIN_LOCK_MINUTES = 15;

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

/** Parses the store's "YYYY-MM-DD HH:MM:SS" strings as LOCAL time. */
function parseStoreDateTime(text: string): Date {
  const [datePart, timePart = "00:00:00"] = text.trim().split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hours, minutes, seconds] = timePart.split(":").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0, seconds ?? 0);
}

/** Minutes (rounded up, at least 1) until the lock lifts; 0 once it has expired. */
export function loginLockRemainingMinutes(lockedUntil: string): number {
  const remaining = parseStoreDateTime(lockedUntil).getTime() - Date.now();
  return remaining <= 0 ? 0 : Math.max(1, Math.ceil(remaining / 60000));
}

export type LoginFailureOutcome = {
  attempts: number;
  lockedUntil: string | null;
  justLocked: boolean;
};

/**
 * Records one wrong password for the (active) account. Unknown or suspended
 * usernames never touch the counters. When a lock has already expired the
 * window restarts at 1 instead of stacking onto the old count. Locking writes
 * a red audit entry with the automatic-unlock time.
 */
export function registerLoginFailure(db: SqliteDb, username: string): LoginFailureOutcome {
  const user = db.prepare(
    `SELECT id, username, display_name AS displayName, failed_attempts AS failedAttempts, locked_until AS lockedUntil FROM app_users WHERE username = ? AND active = 1`,
  ).get(username) as { id: number; username: string; displayName: string; failedAttempts: number; lockedUntil: string | null } | undefined;
  if (!user) return { attempts: 0, lockedUntil: null, justLocked: false };
  const stillLocked = user.lockedUntil !== null && loginLockRemainingMinutes(user.lockedUntil) > 0;
  if (stillLocked) return { attempts: user.failedAttempts, lockedUntil: user.lockedUntil, justLocked: false };

  const attempts = user.lockedUntil !== null ? 1 : user.failedAttempts + 1; // expired lock restarts the window
  if (attempts >= LOGIN_MAX_FAILURES) {
    const lockedUntil = formatDateTime(addMinutes(new Date(), LOGIN_LOCK_MINUTES));
    db.prepare(`UPDATE app_users SET failed_attempts = ?, locked_until = ? WHERE id = ?`).run(attempts, lockedUntil, user.id);
    logAction(db, "ระงับบัญชีชั่วคราว", user.displayName, `@${user.username} · กรอกรหัสผ่านผิด ${attempts} ครั้งติดต่อกัน · ปลดล็อกอัตโนมัติ ${lockedUntil} น.`, "red", null);
    return { attempts, lockedUntil, justLocked: true };
  }
  db.prepare(`UPDATE app_users SET failed_attempts = ? WHERE id = ?`).run(attempts, user.id);
  return { attempts, lockedUntil: null, justLocked: false };
}

/** Resets the failure window after a successful login. */
export function clearLoginFailures(db: SqliteDb, userId: number): void {
  db.prepare(`UPDATE app_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?`).run(userId);
}

/** Finds an ACTIVE app user by exact username. */
export function findAppUserByUsername(db: SqliteDb, username: string): AppUser | undefined {
  return db.prepare(`${APP_USER_SELECT} WHERE username = ? AND active = 1`).get(username) as AppUser | undefined;
}

/** Creates a new session row (uuid) expiring in 7 days; lazily purges expired sessions. */
export function createAppSession(db: SqliteDb, userId: number): { sessionId: string; expiresAt: string } {
  const now = new Date();
  const sessionId = randomUUID();
  const expiresAt = formatDateTime(addDays(now, APP_SESSION_TTL_DAYS));
  runInTransaction(db, () => {
    db.prepare(`DELETE FROM app_sessions WHERE expires_at < ? OR user_id = ?`).run(formatDateTime(now), userId);
    db.prepare(`INSERT INTO app_sessions (id, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`).run(sessionId, userId, expiresAt, formatDateTime(now), formatDateTime(now));
  });
  return { sessionId, expiresAt };
}

/** Resolves an active, unexpired session to its (active) app user. */
export function authenticateAppSession(db: SqliteDb, sessionId: string): AppUser | undefined {
  const user = db.prepare(
    `SELECT u.id, u.username, u.password_hash AS passwordHash, u.display_name AS displayName, u.role, u.active, u.created_at AS createdAt, u.failed_attempts AS failedAttempts, u.locked_until AS lockedUntil, u.must_change_password AS mustChangePassword
     FROM app_sessions s JOIN app_users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`,
  ).get(sessionId, formatDateTime()) as AppUser | undefined;
  if (user) db.prepare("UPDATE app_sessions SET last_seen_at = ? WHERE id = ?").run(formatDateTime(), sessionId);
  return user;
}

/** Deletes a session row (logout). Unknown ids are a no-op. */
export function deleteAppSession(db: SqliteDb, sessionId: string): void {
  db.prepare(`DELETE FROM app_sessions WHERE id = ?`).run(sessionId);
}

// --- active session administration (admin only) ------------------------------

/** Active session without internal ids — safe to return to clients. */
export type AppSessionSummary = {
  sessionId: string;
  username: string;
  displayName: string;
  role: AppUserRole;
  active: number;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
};

/** Purges expired session rows (housekeeping shared by list/revoke helpers). */
function purgeExpiredAppSessions(db: SqliteDb): void {
  db.prepare(`DELETE FROM app_sessions WHERE expires_at < ?`).run(formatDateTime());
}

/** คืนแถวที่มี role พร้อมแปลงให้อยู่ในสัญญา 3 ค่า (DB เก็บชื่อบทบาทแบบ RBAC) */
function withAppRole<T extends { role: string }>(row: T | undefined): (T & { role: AppUserRole }) | undefined {
  return row ? { ...row, role: normalizeAppRole(row.role) } : undefined;
}

/**
 * Lists every unexpired session with its owning user, newest login first.
 * Suspended users keep their sessions listed (revoking them is the point).
 */
export function listAppSessions(db: SqliteDb): AppSessionSummary[] {
  purgeExpiredAppSessions(db);
  const rows = db.prepare(
    `SELECT s.id AS sessionId, u.username, u.display_name AS displayName, u.role, u.active, s.created_at AS createdAt, s.expires_at AS expiresAt, s.last_seen_at AS lastSeenAt
     FROM app_sessions s JOIN app_users u ON u.id = s.user_id
     WHERE s.expires_at > ?
     ORDER BY s.created_at DESC, s.id DESC`,
  ).all(formatDateTime()) as AppSessionSummary[];
  return rows.map((row) => withAppRole(row)!);
}

/** Finds one unexpired session (with user info) by id. */
function findAppSessionById(db: SqliteDb, sessionId: string): AppSessionSummary | undefined {
  const row = db.prepare(
    `SELECT s.id AS sessionId, u.username, u.display_name AS displayName, u.role, u.active, s.created_at AS createdAt, s.expires_at AS expiresAt, s.last_seen_at AS lastSeenAt
     FROM app_sessions s JOIN app_users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  ).get(sessionId, formatDateTime()) as AppSessionSummary | undefined;
  return withAppRole(row);
}

/** Session revoke audit detail, e.g. "@kanyanat · เข้าสู่ระบบ 18 ก.ย. 09:12". */
function sessionAuditDetail(session: AppSessionSummary): string {
  return `@${session.username} · เข้าสู่ระบบ ${session.createdAt}`;
}

/**
 * Revokes one active session by id and audits it. Unknown/expired ids are a
 * StoreError so the UI can distinguish "already gone" from success.
 */
export function revokeAppSession(db: SqliteDb, sessionId: string, actor?: string, actorRole?: string | null): AppSessionSummary {
  const session = findAppSessionById(db, sessionId);
  if (!session) {
    throw new StoreError("ไม่พบเซสชันนี้ในระบบ อาจหมดอายุหรือถูกยกเลิกไปแล้ว");
  }
  db.prepare(`DELETE FROM app_sessions WHERE id = ?`).run(sessionId);
  logAction(db, "ยกเลิกเซสชัน", actor ?? "ผู้ใช้ระบบ", sessionAuditDetail(session), "amber", actorRole ?? null);
  return session;
}

/**
 * Revokes every active session EXCEPT the kept one (the caller's own) and
 * audits the sweep as a single entry. Returns the number revoked.
 */
export function revokeOtherAppSessions(db: SqliteDb, keepSessionId: string, actor?: string, actorRole?: string | null): number {
  purgeExpiredAppSessions(db);
  const doomed = listAppSessions(db).filter((session) => session.sessionId !== keepSessionId);
  if (doomed.length === 0) return 0;
  const deleteAll = db.prepare(`DELETE FROM app_sessions WHERE id = ?`);
  for (const session of doomed) deleteAll.run(session.sessionId);
  logAction(db, "ยกเลิกเซสชันอื่นทั้งหมด", actor ?? "ผู้ใช้ระบบ", `${doomed.length} เซสชัน · เหลือเฉพาะเซสชันที่ใช้อยู่`, "amber", actorRole ?? null);
  return doomed.length;
}

// --- app user administration (admin only) ------------------------------------

/** AppUser without the password hash — safe to return to clients. */
export type AppUserSummary = {
  id: number;
  username: string;
  displayName: string;
  role: AppUserRole;
  active: number;
  createdAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
  /** ROUND 36 (ข้อ 31) — 1 = บัญชีนี้ยังต้องเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน */
  mustChangePassword: number;
};

const APP_USER_SUMMARY_SELECT = `SELECT id, username, display_name AS displayName, role, active, created_at AS createdAt, failed_attempts AS failedAttempts, locked_until AS lockedUntil, must_change_password AS mustChangePassword FROM app_users`;

function getAppUserSummaryById(db: SqliteDb, userId: number): AppUserSummary | undefined {
  const row = db.prepare(`${APP_USER_SUMMARY_SELECT} WHERE id = ?`).get(userId) as AppUserSummary | undefined;
  return withAppRole(row);
}

/** Lists every login account, oldest first. Never exposes password hashes. */
export function listAppUsers(db: SqliteDb): AppUserSummary[] {
  const rows = db.prepare(`${APP_USER_SUMMARY_SELECT} ORDER BY id`).all() as AppUserSummary[];
  return rows.map((row) => withAppRole(row)!);
}

/**
 * Clears a temporary login lock (wrong-password lockout) before its automatic
 * expiry and audits the early unlock. Accounts that are not locked refuse with
 * a Thai error so the UI can distinguish "nothing to do" from success.
 */
export function unlockAppUser(db: SqliteDb, userId: number, actor = "ผู้บริหาร", actorRole?: string | null): AppUserSummary {
  const user = getAppUserSummaryById(db, userId);
  if (!user) throw new StoreError(`ไม่พบผู้ใช้ระบบรหัส ${userId} ในระบบ`);
  const locked = user.lockedUntil !== null && loginLockRemainingMinutes(user.lockedUntil) > 0;
  if (!locked && user.failedAttempts === 0) {
    throw new StoreError(`บัญชี @${user.username} ไม่ได้ถูกระงับชั่วคราว จึงไม่ต้องปลดล็อก`);
  }
  db.prepare(`UPDATE app_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?`).run(userId);
  const detail = locked
    ? `@${user.username} · ปลดล็อกก่อนกำหนด (เดิมระงับถึง ${user.lockedUntil} น.)`
    : `@${user.username} · ล้างยอดพยายามเข้าสู่ระบบ ${user.failedAttempts}/${LOGIN_MAX_FAILURES} ครั้ง`;
  logAction(db, "ปลดล็อกบัญชีผู้ใช้", actor, detail, "green", actorRole ?? null);
  return { ...user, failedAttempts: 0, lockedUntil: null };
}

const USERNAME_PATTERN = /^[a-zA-Z0-9_.]{3,30}$/;

export type CreateAppUserInput = {
  username: string;
  password: string;
  displayName: string;
  role: AppUserRole;
  actor?: string;
  actorRole?: string | null;
};

/** Counts every login account (any role, any status) — 0 = ระบบยังไม่ถูกตั้งค่าครั้งแรก. */
export function countAppUsers(db: SqliteDb): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM app_users`).get() as { count: number }).count;
}

export type SetupInitialAdminInput = {
  username: string;
  displayName: string;
  password: string;
  storeName?: string;
};

/**
 * ROUND 36 (ข้อ 31) — ลงทะเบียนครั้งแรก: ใช้ได้เฉพาะระบบที่ยังไม่มีบัญชีผู้ใช้เลย
 * (ฐานข้อมูลใหม่) สร้างบัญชีผู้บริหารหลักพร้อมตั้ง must_change_password = 1
 * ให้เจ้าของร้านต้องเปลี่ยนรหัสผ่านอีกครั้งหลังลงทะเบียน เพื่อยืนยันว่าไม่มีผู้อื่นรู้รหัส
 */
export function setupInitialAdmin(db: SqliteDb, input: SetupInitialAdminInput): AppUserSummary {
  if (countAppUsers(db) > 0) {
    throw new StoreError("ระบบถูกตั้งค่าผู้บริหารไว้แล้ว · ไม่สามารถลงทะเบียนซ้ำได้");
  }
  const username = input.username?.trim() ?? "";
  if (!username) throw new StoreError("กรุณาระบุชื่อผู้ใช้");
  if (/\s/.test(username)) throw new StoreError("ชื่อผู้ใช้ห้ามมีช่องว่าง");
  if (username.length > 30) throw new StoreError("ชื่อผู้ใช้ต้องไม่เกิน 30 ตัวอักษร");
  if (db.prepare(`SELECT id FROM app_users WHERE LOWER(username) = LOWER(?)`).get(username)) {
    throw new StoreError("มีชื่อผู้ใช้นี้ในระบบแล้ว");
  }
  const displayName = input.displayName?.trim() ?? "";
  if (!displayName) throw new StoreError("กรุณาระบุชื่อ-นามสกุลผู้บริหาร");
  const issues = validatePasswordStrength(input.password, "admin");
  if (issues.length > 0) throw new StoreError(issues.join(" · "));
  const createdAt = formatDateTime();
  const result = db.prepare(
    `INSERT INTO app_users (username, password_hash, display_name, role, active, created_at, must_change_password) VALUES (?, ?, ?, 'admin', 1, ?, 1)`,
  ).run(username, hashPassword(input.password), displayName, createdAt);
  const storeName = input.storeName?.trim() ?? "";
  if (storeName) {
    setSettings(db, { storeName, appName: storeName }, displayName, "ผู้บริหาร");
  }
  logAction(db, "ตั้งค่าระบบครั้งแรก", displayName, `สร้างบัญชีผู้บริหารหลัก @${username} · ชื่อร้าน ${storeName || "-"}`, "green", "ผู้บริหาร");
  return getAppUserSummaryById(db, Number(result.lastInsertRowid))!;
}

export type ChangeOwnPasswordInput = {
  userId: number;
  currentPassword: string;
  newPassword: string;
  /** เซสชันที่ผู้ใช้กำลังใช้อยู่ (จากคุกกี้) — จะไม่ถูกยกเลิกไปด้วย */
  keepSessionId?: string;
  actor?: string;
  actorRole?: string | null;
};

/**
 * ROUND 36 (ข้อ 31) — ผู้ใช้เปลี่ยนรหัสผ่านของตัวเอง: ตรวจรหัสปัจจุบัน + กฎความแข็งแรง
 * + ห้ามซ้ำของเดิม แล้วล้างธง must_change_password · ยกเลิกเซสชันอื่นทั้งหมด
 * เหลือเฉพาะเซสชันที่ใช้อยู่ (keepSessionId)
 */
export function changeOwnPassword(db: SqliteDb, input: ChangeOwnPasswordInput): { success: boolean; revokedSessions: number } {
  const user = db.prepare(`${APP_USER_SELECT} WHERE id = ?`).get(input.userId) as AppUser | undefined;
  if (!user) throw new StoreError("ไม่พบบัญชีผู้ใช้นี้");
  if (!verifyPassword(input.currentPassword ?? "", user.passwordHash)) {
    throw new StoreError("รหัสผ่านปัจจุบันไม่ถูกต้อง");
  }
  const issues = validatePasswordStrength(input.newPassword, user.role);
  if (issues.length > 0) throw new StoreError(issues.join(" · "));
  if (verifyPassword(input.newPassword, user.passwordHash)) {
    throw new StoreError("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน");
  }
  const forced = user.mustChangePassword === 1;
  const actor = input.actor?.trim() || user.displayName;
  const actorRole = input.actorRole?.trim() || appRoleThai(user.role);
  const createdAt = formatDateTime();
  const doomed = (db
    .prepare(`SELECT id FROM app_sessions WHERE user_id = ? AND expires_at > ?`)
    .all(input.userId, formatDateTime()) as { id: string }[])
    .filter((session) => session.id !== input.keepSessionId);
  runInTransaction(db, () => {
    db.prepare(`UPDATE app_users SET password_hash = ?, must_change_password = 0, failed_attempts = 0, locked_until = NULL WHERE id = ?`).run(hashPassword(input.newPassword), input.userId);
    const deleteSession = db.prepare(`DELETE FROM app_sessions WHERE id = ?`);
    for (const session of doomed) deleteSession.run(session.id);
    logAction(
      db,
      "เปลี่ยนรหัสผ่าน",
      actor,
      forced ? "เปลี่ยนรหัสผ่านบังคับครั้งแรกเสร็จสิ้น · ยกเลิกเซสชันอื่นทั้งหมด" : "เปลี่ยนรหัสผ่านเรียบร้อย · ยกเลิกเซสชันอื่นทั้งหมด",
      "green",
      actorRole,
      createdAt,
    );
  });
  return { success: true, revokedSessions: doomed.length };
}

/** Creates a login account with a scrypt-hashed password and audits it. */
export function createAppUser(db: SqliteDb, input: CreateAppUserInput): AppUserSummary {
  const username = input.username?.trim() ?? "";
  if (!USERNAME_PATTERN.test(username)) {
    throw new StoreError("ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ ตัวเลข จุด หรือขีดล่าง ความยาว 3-30 ตัวอักษร");
  }
  if (db.prepare(`SELECT id FROM app_users WHERE LOWER(username) = LOWER(?)`).get(username)) {
    throw new StoreError("มีชื่อผู้ใช้นี้ในระบบแล้ว");
  }
  // ROUND 36 (ข้อ 31) — กฎความแข็งแรงของรหัสผ่านตามบทบาท (dev เข้มที่สุด)
  const strengthIssues = validatePasswordStrength(input.password ?? "", input.role);
  if (strengthIssues.length > 0) {
    throw new StoreError(strengthIssues.join(" · "));
  }
  const displayName = input.displayName?.trim() ?? "";
  if (!displayName) throw new StoreError("กรุณาระบุชื่อ-นามสกุลผู้ใช้");
  const createdAt = formatDateTime();
  // ROUND 36 — บัญชีใหม่ทุกบทบาทต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก
  const result = db.prepare(`INSERT INTO app_users (username, password_hash, display_name, role, active, created_at, must_change_password) VALUES (?, ?, ?, ?, 1, ?, 1)`).run(
    username,
    hashPassword(input.password),
    displayName,
    storedRoleFor(input.role),
    createdAt,
  );
  const roleThai = appRoleThai(input.role);
  logAction(db, "เพิ่มผู้ใช้ระบบ", input.actor?.trim() || "ผู้บริหาร", `${username} · ${displayName} · สิทธิ์ ${roleThai} · ผู้ใช้ใหม่ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก`, "green", input.actorRole ?? null, createdAt);
  return getAppUserSummaryById(db, Number(result.lastInsertRowid))!;
}

export type UpdateAppUserInput = {
  userId: number;
  displayName?: string;
  role?: AppUserRole;
  active?: boolean;
  password?: string;
  actor?: string;
  actorRole?: string | null;
};

/** Updates only the provided account fields. Undefined keeps the current value; empty password strings are ignored. */
export function updateAppUser(db: SqliteDb, input: UpdateAppUserInput): AppUserSummary {
  const user = db.prepare(`${APP_USER_SELECT} WHERE id = ?`).get(input.userId) as AppUser | undefined;
  if (!user) throw new StoreError("ไม่พบผู้ใช้ระบบรายนี้");
  if (input.displayName !== undefined && !input.displayName.trim()) {
    throw new StoreError("กรุณาระบุชื่อ-นามสกุลผู้ใช้");
  }
  const newPassword = typeof input.password === "string" && input.password !== "" ? input.password : undefined;
  // ROUND 36 (ข้อ 31) — รหัสที่ผู้บริหารตั้งให้ผู้อื่น ต้องผ่านกฎความแข็งแรงตามบทบาท
  // เป้าหมาย (บทบาทจะเปลี่ยนพร้อมกันก็ใช้บทบาทใหม่เลย)
  if (newPassword !== undefined) {
    const strengthIssues = validatePasswordStrength(newPassword, input.role ?? normalizeAppRole(user.role));
    if (strengthIssues.length > 0) {
      throw new StoreError(strengthIssues.join(" · "));
    }
  }

  const nextDisplayName = input.displayName !== undefined && input.displayName.trim() !== user.displayName ? input.displayName.trim() : undefined;
  // user.role อ่านมาจาก DB เป็นชื่อบทบาท RBAC (administrator/cashier/…)
  // ต้อง normalize ให้เทียบกับสัญญา 3 ค่าได้ ไม่งั้นการเปลี่ยนแปลงจะถูกมองว่า "ไม่มีอะไรเปลี่ยน"
  const currentRole = normalizeAppRole(user.role);
  const nextRole = input.role !== undefined && input.role !== currentRole ? input.role : undefined;
  const nextActive = input.active !== undefined && (input.active ? 1 : 0) !== user.active ? (input.active ? 1 : 0) : undefined;

  // Last-admin guard: the final active admin cannot be demoted or deactivated.
  if (currentRole === "admin" && user.active === 1 && (nextRole !== undefined || nextActive === 0)) {
    const remaining = db
      .prepare(`SELECT role, active FROM app_users WHERE active = 1 AND id != ?`)
      .all(input.userId) as { role: string; active: number }[];
    const otherAdmins = remaining.filter((row) => normalizeAppRole(row.role) === "admin").length;
    if (otherAdmins === 0) {
      throw new StoreError("ต้องมีผู้ดูแลระบบ (ผู้บริหาร) ที่ใช้งานได้อย่างน้อย 1 รายเสมอ");
    }
  }

  const assignments: string[] = [];
  const values: (string | number)[] = [];
  const changedLabels: string[] = [];
  if (nextDisplayName !== undefined) {
    assignments.push("display_name = ?");
    values.push(nextDisplayName);
    changedLabels.push("ชื่อ-นามสกุล");
  }
  if (nextRole !== undefined) {
    assignments.push("role = ?");
    values.push(storedRoleFor(nextRole));
    changedLabels.push("สิทธิ์การใช้งาน");
  }
  if (nextActive !== undefined) {
    assignments.push("active = ?");
    values.push(nextActive);
    changedLabels.push("สถานะ");
  }

  // Nothing actually changed → return the current state without an audit entry.
  if (assignments.length === 0 && newPassword === undefined) {
    return getAppUserSummaryById(db, input.userId)!;
  }

  const actor = input.actor?.trim() || "ผู้บริหาร";
  const createdAt = formatDateTime();
  runInTransaction(db, () => {
    if (assignments.length > 0) {
      db.prepare(`UPDATE app_users SET ${assignments.join(", ")} WHERE id = ?`).run(...values, input.userId);
      logAction(
        db,
        "แก้ไขผู้ใช้ระบบ",
        actor,
        `${user.username} · ${nextDisplayName ?? user.displayName} · แก้ไข: ${changedLabels.join(", ")}`,
        nextRole !== undefined || nextActive !== undefined ? "amber" : "blue",
        input.actorRole ?? null,
        createdAt,
      );
    }
    if (newPassword !== undefined) {
      // ROUND 36 — ตั้งรหัสใหม่ = บังคับให้ผู้ใช้เปลี่ยนอีกครั้งเมื่อเข้าสู่ระบบครั้งถัดไป
      db.prepare(`UPDATE app_users SET password_hash = ?, must_change_password = 1 WHERE id = ?`).run(hashPassword(newPassword), input.userId);
      // The plaintext password must never appear anywhere in the audit trail.
      logAction(db, "ตั้งรหัสผ่านใหม่", actor, `${user.username} · ตั้งรหัสผ่านใหม่ · ผู้ใช้ต้องเปลี่ยนรหัสผ่านอีกครั้งเมื่อเข้าสู่ระบบครั้งถัดไป`, "amber", input.actorRole ?? null, createdAt);
    }
  });
  return getAppUserSummaryById(db, input.userId)!;
}

// --- member spending stats ----------------------------------------------------

export type MemberSpendingStats = {
  totalSpent: number;
  billCount: number;
  lastPurchaseAt: string | null;
  topProducts: { name: string; qty: number; total: number }[];
};

/** Lifetime purchase summary for one member, computed from the sales tables (paid totals after discount). */
export function memberSpendingStats(db: SqliteDb, memberNumber: string): MemberSpendingStats {
  const number = memberNumber?.trim() ?? "";
  const member = db.prepare(`SELECT member_number FROM members WHERE member_number = ?`).get(number);
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${memberNumber} ในระบบ`);
  const totals = db.prepare(
    `SELECT ROUND(COALESCE(SUM(total), 0), 2) AS totalSpent, COUNT(*) AS billCount, MAX(created_at) AS lastPurchaseAt FROM sales WHERE member_number = ?`,
  ).get(number) as { totalSpent: number; billCount: number; lastPurchaseAt: string | null };
  const topProducts = db.prepare(
    `SELECT COALESCE(si.name, p.name) AS name, SUM(si.qty) AS qty, ROUND(SUM(si.qty * si.price), 2) AS total
     FROM sales s
     JOIN sale_items si ON si.sale_id = s.id
     LEFT JOIN products p ON p.id = si.product_id
     WHERE s.member_number = ?
     GROUP BY si.name
     ORDER BY qty DESC, total DESC
     LIMIT 3`,
  ).all(number) as unknown as MemberSpendingStats["topProducts"];
  return {
    totalSpent: round2(totals.totalSpent ?? 0),
    billCount: totals.billCount ?? 0,
    lastPurchaseAt: totals.lastPurchaseAt ?? null,
    topProducts,
  };
}

// --- seeding ----------------------------------------------------------------

const SEED_PRODUCTS: { sku: string; barcode: string; name: string; category: string; emoji: string; color: string; unit: string; price: number; cost: number; stock: number; reorderPoint: number }[] = [
  { sku: "DRK-001", barcode: "8850000000017", name: "น้ำดื่มคริสตัล 600 มล.", category: "เครื่องดื่ม", emoji: "💧", color: "blue", unit: "ขวด", price: 7, cost: 4.2, stock: 124, reorderPoint: 60 },
  { sku: "DRK-002", barcode: "8850000000024", name: "กาแฟกระป๋อง เบอร์ดี้", category: "เครื่องดื่ม", emoji: "☕", color: "amber", unit: "กระป๋อง", price: 18, cost: 13.5, stock: 42, reorderPoint: 48 },
  { sku: "FD-014", barcode: "8850000000031", name: "ข้าวกล่องกะเพราไก่", category: "อาหาร", emoji: "🍱", color: "orange", unit: "กล่อง", price: 45, cost: 32, stock: 18, reorderPoint: 10 },
  { sku: "DRK-003", barcode: "8850000000048", name: "นมยูเอชที รสจืด", category: "เครื่องดื่ม", emoji: "🥛", color: "sky", unit: "กล่อง", price: 13, cost: 9.5, stock: 65, reorderPoint: 24 },
  { sku: "FD-015", barcode: "8850000000055", name: "ขนมปังแซนด์วิช", category: "อาหาร", emoji: "🥪", color: "rose", unit: "ชิ้น", price: 25, cost: 18, stock: 9, reorderPoint: 12 },
  { sku: "HYG-032", barcode: "8850000000062", name: "สบู่เหลวล้างมือ", category: "ของใช้", emoji: "🧴", color: "mint", unit: "ขวด", price: 32, cost: 24, stock: 28, reorderPoint: 10 },
  { sku: "HYG-033", barcode: "8850000000079", name: "หน้ากากอนามัย 3 ชิ้น", category: "ของใช้", emoji: "😷", color: "violet", unit: "แพ็ก", price: 20, cost: 14, stock: 86, reorderPoint: 20 },
  { sku: "ICE-004", barcode: "8850000000086", name: "น้ำแข็งถุงเล็ก", category: "อาหาร", emoji: "🧊", color: "cyan", unit: "ถุง", price: 10, cost: 6, stock: 35, reorderPoint: 40 },
];

/**
 * Round 32-18 — สินค้าตัวอย่างสำหรับทดสอบการยิงบาร์โค้ด (สินค้าปกติมีบาร์โค้ดครบ
 * ไม่เกี่ยวกับสินค้าไม่มีบาร์โค้ด) · แทรกแบบ idempotent ผ่าน INSERT OR IGNORE
 * เพื่อให้ฐานข้อมูลเดิมที่ใช้งานอยู่ก็ได้รายการทดสอบด้วย
 */
const SEED_TEST_PRODUCTS: { sku: string; barcode: string; name: string; category: string; emoji: string; color: string; unit: string; price: number; cost: number; stock: number; reorderPoint: number }[] = [
  { sku: "SNK-011", barcode: "8850101100015", name: "ขนมเคี้ยวกรอบรสชีส", category: "อาหาร", emoji: "🍪", color: "amber", unit: "แพ็ก", price: 20, cost: 14, stock: 54, reorderPoint: 20 },
  { sku: "SNK-012", barcode: "8850101100022", name: "วุ้นมะพร้าวแช่เย็น", category: "อาหาร", emoji: "🍮", color: "rose", unit: "ถุง", price: 10, cost: 6, stock: 70, reorderPoint: 24 },
  { sku: "DRK-005", barcode: "8850101100039", name: "ชาเขียวขวดพร้อมดื่ม", category: "เครื่องดื่ม", emoji: "🍵", color: "mint", unit: "ขวด", price: 25, cost: 17, stock: 38, reorderPoint: 12 },
  { sku: "HYG-034", barcode: "8850101100046", name: "แปรงฟันสมุนไพร", category: "ของใช้", emoji: "🪥", color: "orange", unit: "ชิ้น", price: 35, cost: 24, stock: 22, reorderPoint: 10 },
  { sku: "FD-016", barcode: "8850101100053", name: "โจ๊กหมูกระป๋อง", category: "อาหาร", emoji: "🍲", color: "sky", unit: "กระป๋อง", price: 22, cost: 15, stock: 40, reorderPoint: 12 },
];

/** Seed expiry anchored to today so demo data (และเทส expirySoon) ไม่หมดอายุไปตามเวลาจริง */
const seedExpiryFromToday = (offsetDays: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

const SEED_STOCK_LOTS: { sku: string; lot: string; expiry: string | null; qty: number; cost: number; receivedAt: string }[] = [
  { sku: "DRK-001", lot: "CR-2608-01", expiry: "2027-08-18", qty: 124, cost: 4.2, receivedAt: "2026-08-20 09:12:00" },
  { sku: "DRK-002", lot: "CF-2607-02", expiry: "2027-03-10", qty: 42, cost: 13.5, receivedAt: "2026-08-15 10:40:00" },
  { sku: "FD-014", lot: "ครัวกลาง-17", expiry: seedExpiryFromToday(12), qty: 18, cost: 32, receivedAt: "2026-09-17 07:20:00" },
  { sku: "DRK-003", lot: "ML-2608-08", expiry: seedExpiryFromToday(25), qty: 65, cost: 9.5, receivedAt: "2026-08-22 08:55:00" },
  { sku: "FD-015", lot: "BR-260917-A", expiry: seedExpiryFromToday(2), qty: 9, cost: 18, receivedAt: "2026-09-17 06:45:00" },
  { sku: "HYG-032", lot: "HM-2606-03", expiry: "2028-06-04", qty: 28, cost: 24, receivedAt: "2026-06-28 13:10:00" },
  { sku: "HYG-033", lot: "MSK-2606-01", expiry: "2029-06-30", qty: 86, cost: 14, receivedAt: "2026-06-28 13:25:00" },
  { sku: "ICE-004", lot: "รับรายวัน", expiry: null, qty: 35, cost: 6, receivedAt: "2026-09-17 05:30:00" },
  { sku: "SNK-011", lot: "TS-SNK-01", expiry: seedExpiryFromToday(120), qty: 54, cost: 14, receivedAt: "2026-09-10 09:00:00" },
  { sku: "SNK-012", lot: "TS-SNK-02", expiry: seedExpiryFromToday(30), qty: 70, cost: 6, receivedAt: "2026-09-10 09:05:00" },
  { sku: "DRK-005", lot: "TS-DRK-05", expiry: seedExpiryFromToday(180), qty: 38, cost: 17, receivedAt: "2026-09-10 09:10:00" },
  { sku: "HYG-034", lot: "TS-HYG-34", expiry: seedExpiryFromToday(400), qty: 22, cost: 24, receivedAt: "2026-09-10 09:15:00" },
  { sku: "FD-016", lot: "TS-FD-16", expiry: seedExpiryFromToday(200), qty: 40, cost: 15, receivedAt: "2026-09-10 09:20:00" },
];

const SEED_MEMBERS: { memberNumber: string; firstName: string; lastName: string; type: string; balance: number; status: "active" | "suspended" }[] = [
  { memberNumber: "M-000218", firstName: "อรทัย", lastName: "ส.", type: "สมาชิก", balance: 1240, status: "active" },
  { memberNumber: "M-000184", firstName: "ธนกร", lastName: "พ.", type: "เจ้าหน้าที่", balance: 860, status: "active" },
  { memberNumber: "M-000092", firstName: "พิมพ์ชนก", lastName: "ร.", type: "สมาชิก", balance: 0, status: "suspended" },
  { memberNumber: "M-000241", firstName: "สมชาย", lastName: "ว.", type: "สมาชิก", balance: 340, status: "active" },
  { memberNumber: "M-000119", firstName: "จุฑามาศ", lastName: "ก.", type: "เจ้าหน้าที่", balance: 2180, status: "active" },
];

const SEED_MEMBER_TRANSACTIONS: { memberNumber: string; type: "purchase" | "deposit" | "withdrawal"; detail: string; amount: number; paymentMethod: string | null; balanceAfter: number; createdAt: string; actor: string | null }[] = [
  { memberNumber: "M-000218", type: "purchase", detail: "บิล #INV-260917-038 · น้ำดื่ม 2 ขวด, ข้าวกล่อง 1 กล่อง", amount: -59, paymentMethod: "member_balance", balanceAfter: 1240, createdAt: "2026-09-17 14:38:00", actor: "น.ส.กัญญาณัฐ พ." },
  { memberNumber: "M-000218", type: "deposit", detail: "เงินสด · ผู้ฝาก: น.ส.กัญญาณัฐ พ.", amount: 500, paymentMethod: "cash", balanceAfter: 1299, createdAt: "2026-09-17 14:32:00", actor: "น.ส.กัญญาณัฐ พ." },
  { memberNumber: "M-000218", type: "withdrawal", detail: "ถอนเพื่อถอนฟัน · เงินสด", amount: -200, paymentMethod: "cash", balanceAfter: 799, createdAt: "2026-09-12 10:16:00", actor: "นายวรพจน์ ด." },
  { memberNumber: "M-000218", type: "purchase", detail: "บิล #INV-260901-006 · สินค้า 4 รายการ", amount: -132, paymentMethod: "member_balance", balanceAfter: 999, createdAt: "2026-09-01 09:05:00", actor: "น.ส.กัญญาณัฐ พ." },
  { memberNumber: "M-000092", type: "withdrawal", detail: "ถอนเพื่อถอนฟัน · แนบหลักฐานแล้ว", amount: -200, paymentMethod: "cash", balanceAfter: 0, createdAt: "2026-09-16 09:12:00", actor: "นายวรพจน์ ด." },
  { memberNumber: "M-000092", type: "purchase", detail: "บิล #INV-260912-091 · สินค้า 2 รายการ", amount: -80, paymentMethod: "member_balance", balanceAfter: 200, createdAt: "2026-09-12 11:40:00", actor: "น.ส.กัญญาณัฐ พ." },
];

const SEED_AUDIT_LOGS: { action: string; actor: string; actorRole: string; detail: string; tone: string; createdAt: string }[] = [
  { action: "ขายสินค้า", actor: "น.ส.กัญญาณัฐ พ.", actorRole: "เจ้าหน้าที่", detail: "บิล #INV-260917-038 · ฿186.00", tone: "blue", createdAt: "2026-09-17 14:38:00" },
  { action: "เติมเงินสมาชิก", actor: "น.ส.กัญญาณัฐ พ.", actorRole: "เจ้าหน้าที่", detail: "M-000218 · ฿500.00 · เงินสด", tone: "green", createdAt: "2026-09-17 14:32:00" },
  { action: "แก้ไขสต็อก", actor: "นายวรพจน์ ด.", actorRole: "ผู้บริหาร", detail: "น้ำดื่มคริสตัล · +24 ขวด", tone: "amber", createdAt: "2026-09-17 13:51:00" },
  { action: "ถอนเงินสมาชิก", actor: "น.ส.กัญญาณัฐ พ.", actorRole: "เจ้าหน้าที่", detail: "M-000092 · ฿200.00 · ถอนเพื่อถอนฟัน", tone: "purple", createdAt: "2026-09-17 12:06:00" },
];

// ROUND 36 (ข้อ 31) — SEED_APP_USERS + seedAppUsers ถูกลบออก: ฐานข้อมูลใหม่เริ่มด้วย
// ศูนย์บัญชีผู้ใช้เสมอ หน้าลงทะเบียนผู้บริหารหลัก (SetupView) จะโผล่มาเอง (ฐาน
// ข้อมูลเดิมที่มีผู้ใช้อยู่แล้วไม่กระทบ — INSERT OR IGNORE เดิมก็ไม่เคยเขียนซ้ำ)

/** Deterministic pseudo-random generator so seeded history is reproducible. */
function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function seedHistoricalSales(db: SqliteDb) {
  const products = listProducts(db);
  const bySku = new Map(products.map((product) => [product.sku, product]));
  const weights: { sku: string; weight: number }[] = [
    { sku: "DRK-001", weight: 30 },
    { sku: "DRK-002", weight: 12 },
    { sku: "FD-014", weight: 8 },
    { sku: "DRK-003", weight: 12 },
    { sku: "FD-015", weight: 8 },
    { sku: "HYG-032", weight: 6 },
    { sku: "HYG-033", weight: 12 },
    { sku: "ICE-004", weight: 12 },
  ];
  const rand = createRng(20260918);
  const pickProduct = () => {
    let roll = rand() * 100;
    for (const entry of weights) {
      roll -= entry.weight;
      if (roll < 0) return bySku.get(entry.sku)!;
    }
    return bySku.get("DRK-001")!;
  };
  const today = startOfToday();
  runInTransaction(db, () => {
    const insertSale = db.prepare(`INSERT INTO sales (order_number, payment_method, member_number, subtotal, discount, total, cashier, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`);
    const insertItem = db.prepare(`INSERT INTO sale_items (sale_id, product_id, name, qty, price, cost, unit) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (let daysAgo = 30; daysAgo >= 1; daysAgo -= 1) {
      const date = addDays(today, -daysAgo);
      const orders = 90 + Math.floor(rand() * 40);
      for (let sequence = 1; sequence <= orders; sequence += 1) {
        const itemCount = 2 + Math.floor(rand() * 4);
        const chosen = new Map<number, { product: SqliteProduct; qty: number }>();
        for (let index = 0; index < itemCount; index += 1) {
          const product = pickProduct();
          const qty = 1 + Math.floor(rand() * 3);
          const existing = chosen.get(product.id);
          chosen.set(product.id, { product, qty: (existing?.qty ?? 0) + qty });
        }
        const items = Array.from(chosen.values());
        const subtotal = round2(items.reduce((sum, { product, qty }) => sum + product.price * qty, 0));
        const discount = rand() < 0.1 ? round2(5 + Math.floor(rand() * 11)) : 0;
        const total = round2(subtotal - discount);
        const paymentMethod = rand() < 0.6 ? "เงินสด" : "QR / สแกน";
        const createdAt = `${formatDate(date)} ${pad2(8 + Math.floor(rand() * 10))}:${pad2(Math.floor(rand() * 60))}:${pad2(Math.floor(rand() * 60))}`;
        const orderNumber = `RC-${yyMMdd(date)}-${String(sequence).padStart(3, "0")}`;
        const cashier = rand() < 0.75 ? "น.ส.กัญญาณัฐ พ." : "นายวรพจน์ ด.";
        const result = insertSale.run(orderNumber, paymentMethod, subtotal, discount, total, cashier, createdAt);
        const saleId = Number(result.lastInsertRowid);
        for (const { product, qty } of items) {
          insertItem.run(saleId, product.id, product.name, qty, product.price, product.cost, product.unit);
        }
      }
    }
  });
}

/**
 * Idempotent seeding of the welfare store demo dataset, mirroring the client
 * mock data in client/src/pages/pageData.ts plus a plausible 30-day sales
 * history. Each table only seeds when it is still empty.
 */
export function seedWelfareStoreData(db: SqliteDb) {
  // ROUND 36 (ข้อ 31) — ไม่ seed บัญชีผู้ใช้: ฐานข้อมูลใหม่ (countAppUsers === 0)
  // ต้องลงทะเบียนผู้บริหารหลักผ่าน SetupView → setupInitialAdmin แล้วบังคับ
  // เปลี่ยนรหัสผ่านก่อนเข้าใช้งานจริง
  const insertMember = db.prepare(`INSERT OR IGNORE INTO members (member_number, first_name, last_name, id_card, balance, status, type) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const member of SEED_MEMBERS) {
    insertMember.run(member.memberNumber, member.firstName, member.lastName, null, member.balance, member.status, member.type);
  }
  if (countRows(db, "member_transactions") === 0) {
    const insertTransaction = db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const transaction of SEED_MEMBER_TRANSACTIONS) {
      insertTransaction.run(transaction.memberNumber, transaction.type, transaction.detail, transaction.amount, transaction.paymentMethod, transaction.balanceAfter, transaction.actor, transaction.createdAt);
    }
  }
  if (countRows(db, "products") === 0) {
    const insertProduct = db.prepare(`INSERT INTO products (sku, barcode, name, category, emoji, color, unit, price, cost, stock, reorder_point, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
    for (const product of [...SEED_PRODUCTS, ...SEED_TEST_PRODUCTS]) {
      insertProduct.run(product.sku, product.barcode, product.name, product.category, product.emoji, product.color, product.unit, product.price, product.cost, product.stock, product.reorderPoint);
    }
  } else {
    // Round 32-18 — ฐานข้อมูลที่มีข้อมูลอยู่แล้วก็ได้สินค้าทดสอบยิงบาร์โค้ด (idempotent)
    const insertTest = db.prepare(`INSERT OR IGNORE INTO products (sku, barcode, name, category, emoji, color, unit, price, cost, stock, reorder_point, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
    for (const product of SEED_TEST_PRODUCTS) {
      const info = insertTest.run(product.sku, product.barcode, product.name, product.category, product.emoji, product.color, product.unit, product.price, product.cost, product.stock, product.reorderPoint);
      if (info.changes > 0) {
        const created = db.prepare(`SELECT id FROM products WHERE sku = ?`).get(product.sku) as { id: number } | undefined;
        if (created) {
          db.prepare(`INSERT INTO stock_lots (product_id, lot, expiry_date, qty, cost, received_at, received_qty) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(created.id, `TEST-${product.sku}`, null, product.stock, product.cost, new Date().toISOString().slice(0, 19).replace("T", " "), product.stock);
        }
      }
    }
  }
  if (countRows(db, "stock_lots") === 0) {
    const insertLot = db.prepare(`INSERT INTO stock_lots (product_id, lot, expiry_date, qty, cost, received_at, received_qty) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const lot of SEED_STOCK_LOTS) {
      const product = db.prepare(`SELECT id FROM products WHERE sku = ?`).get(lot.sku) as { id: number } | undefined;
      if (product) insertLot.run(product.id, lot.lot, lot.expiry, lot.qty, lot.cost, lot.receivedAt, lot.qty);
    }
  }
  if (countRows(db, "sales") === 0) {
    seedHistoricalSales(db);
  }
  if (countRows(db, "audit_logs") === 0) {
    const insertLog = db.prepare(`INSERT INTO audit_logs (action, actor, actor_role, detail, tone, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const log of SEED_AUDIT_LOGS) {
      insertLog.run(log.action, log.actor, log.actorRole, log.detail, log.tone, log.createdAt);
    }
  }
}

/**
 * Opens (and creates if needed) the welfare store database, runs migrations
 * and seeds demo data. Uses SQLITE_DB_PATH when no filename is provided.
 */
/**
 * ROUND 48 (user) — โหมดพัฒนา (pnpm dev) กับฐานข้อมูลใหม่: สร้างบัญชีทดสอบ
 * ให้อัตโนมัติ ไม่ต้องผ่านหน้าลงทะเบียนครั้งแรก (SetupView) — ตรงกับชิปบัญชี
 * ทดลองที่หน้าล็อกอินโชว์ไว้แล้ว (kanyanat / woraphot · รหัส 1234)
 * ทำงานเฉพาะ NODE_ENV=development เท่านั้น: production (pnpm start) ยัง
 * บังคับลงทะเบียนผู้บริหารจริงตามดีไซน์ Round 36 เสมอ
 */
function seedDevAppUsers(db: SqliteDb): void {
  const createdAt = formatDateTime();
  const insert = db.prepare(`INSERT INTO app_users (username, password_hash, display_name, role, active, created_at, must_change_password) VALUES (?, ?, ?, ?, 1, ?, 0)`);
  insert.run("kanyanat", hashPassword("1234"), "น.ส.กัญญาณัฐ พ.", "staff", createdAt);
  insert.run("woraphot", hashPassword("1234"), "นายวรพจน์ ด.", "admin", createdAt);
  logAction(db, "โหมดพัฒนา", "ระบบ", "สร้างบัญชีทดสอบอัตโนมัติ kanyanat (เจ้าหน้าที่) + woraphot (ผู้บริหาร) · รหัสผ่าน 1234 · ข้ามหน้าลงทะเบียนครั้งแรกให้โหมดพัฒนา", "green", null, createdAt);
}

/**
 * ROUND 66 (user) — "ทำไมยังเป็นข้อมูลเดโม": SEED_DEMO_DATA=1 ที่ตั้งค้างไว้ใน .env
 * เคยฉีดสมาชิกเดโม 5 คน + สินค้าทดสอบ 5 รายการกลับเข้าฐานข้อมูลที่ "ไม่ว่าง"
 * (เช่น หลังรัน scripts/seed-real-data.ts หรือใช้งานจริงมาแล้ว) ทุกครั้งที่เปิด
 * โปรแกรมใหม่ — ข้อมูลเดโมปนกับข้อมูลจริงทั้งที่เอกสารเขียนว่า "มีผลเฉพาะฐาน
 * ข้อมูลที่ยังว่าง" ตอนนี้บังคับเป็นจริง: วัดจากตารางข้อมูลการขายทุกตาราง
 * (บัญชีผู้ใช้ระบบ/การตั้งค่าร้านไม่นับ — ทะเบียนผู้ใช้เปล่ายังถือว่าว่างได้)
 */
function isDatabaseEmpty(db: SqliteDb): boolean {
  const dataTables = ["members", "member_transactions", "products", "stock_lots", "sales", "sale_items", "audit_logs"];
  return dataTables.every((table) => countRows(db, table) === 0);
}

export function openWelfareStore(filename = process.env.SQLITE_DB_PATH ?? "data/welfare-store.sqlite"): SqliteDb {
  if (filename !== ":memory:") {
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  }
  const db = createSqliteStore(filename);
  // ROUND 61 (user) — "ลงใหม่ต้องไม่มีข้อมูล": หยุด seed ข้อมูลตัวอย่างโดยดีฟอลต์
  // ระบบเกิดใหม่เริ่มว่างเปล่า 100% — ข้อมูลจริงขึ้นด้วย 2 ทางเท่านั้น:
  //   1) เทมเพลต .xlsx (ตั้งค่า → นำเข้าข้อมูล) ที่เตรียมให้กรอกตามรูปแบบ
  //   2) กรอกเองผ่านหน้า POS / สต็อก / ลงทะเบียนสมาชิก
  // นักพัฒนาที่ต้องการข้อมูลตัวอย่าง (ทดสอบระบบ): ตั้ง SEED_DEMO_DATA=1 ใน .env
  //   — ROUND 66: มีผลเฉพาะฐานข้อมูลที่ยังว่างจริง ๆ เท่านั้น (isDatabaseEmpty)
  if (process.env.SEED_DEMO_DATA === "1") {
    if (isDatabaseEmpty(db)) {
      seedWelfareStoreData(db);
      // ROUND 48 — dev bypass: ฐานข้อมูลใหม่บน `pnpm dev` ข้าม SetupView ไปหน้าล็อกอินเลย
      if (process.env.NODE_ENV === "development" && countAppUsers(db) === 0) {
        seedDevAppUsers(db);
      }
    } else {
      console.warn("[SEED_DEMO_DATA] ข้ามการใส่ข้อมูลตัวอย่าง — ฐานข้อมูลนี้มีข้อมูลอยู่แล้ว ใช้ของเดิมต่อ (ถ้าไม่ต้องการเห็นข้อความนี้ ลบ SEED_DEMO_DATA=1 ใน .env ได้)");
    }
  }
  return db;
}
