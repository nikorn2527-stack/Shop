import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

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
  firstName: string;
  lastName: string;
  idCard: string | null;
  phone: string | null;
  type: string;
  balance: number;
  status: "active" | "suspended";
  createdAt: string;
};

export type SqliteTransaction = {
  id: number;
  memberNumber: string;
  type: "purchase" | "deposit" | "withdrawal";
  detail: string;
  amount: number;
  paymentMethod: string | null;
  balanceAfter: number | null;
  createdAt: string;
};

export type SqliteMemberSummary = {
  id: number;
  memberNumber: string;
  firstName: string;
  lastName: string;
  type: string;
  balance: number;
  status: "active" | "suspended";
  createdAt: string;
  lastTransactionAt: string | null;
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
  items: { productId: number; name: string; unit: string; qty: number; price: number; amount: number }[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  memberNumber: string | null;
  memberName: string | null;
  balanceAfter: number | null;
};

/** A past receipt rebuilt from the sales/sale_items tables (balanceAfter is not reconstructable → null). */
export type SaleHistoryEntry = CheckoutReceipt & { cashier: string | null };

export type DailySalesRow = {
  date: string;
  orders: number;
  items: number;
  revenue: number;
  cogs: number;
  profit: number;
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

export type StoreSettings = {
  memberNumberMode: "running" | "year" | "manual";
  storeName: string;
  storeCode: string;
  storeAddress: string;
  autoPrintReceipt: boolean;
  showBalanceOnReceipt: boolean;
  lowBalanceAlert: boolean;
  lowBalanceThreshold: number;
  lowStockAlert: boolean;
  expiryAlert: boolean;
  expiryAlertDays: number;
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
    CREATE TABLE IF NOT EXISTS member_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_number TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('purchase', 'deposit', 'withdrawal')),
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
      created_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, "members", "phone", "TEXT");
  ensureColumn(db, "members", "type", "TEXT NOT NULL DEFAULT 'สมาชิก'");
  ensureColumn(db, "member_transactions", "balance_after", "REAL");
  ensureColumn(db, "audit_logs", "actor_role", "TEXT");
  ensureColumn(db, "sale_items", "unit", "TEXT");
  ensureColumn(db, "app_users", "failed_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "app_users", "locked_until", "TEXT");
  // Backfill units for sale_items rows written before the column existed (idempotent).
  db.prepare("UPDATE sale_items SET unit = (SELECT p.unit FROM products p WHERE p.id = sale_items.product_id) WHERE unit IS NULL").run();
  return db;
}

/** Migration-safe column add for databases created before a column existed. */
function ensureColumn(db: SqliteDb, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function seedSqliteDemoData(db: SqliteDb) {
  seedAppUsers(db);
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
  const member = db.prepare(`SELECT id, member_number as memberNumber, first_name as firstName, last_name as lastName, id_card as idCard, phone, type, balance, status, created_at as createdAt FROM members WHERE member_number = ?`).get(memberNumber) as SqliteMember | undefined;
  if (!member) return undefined;
  const transactions = db.prepare(`SELECT id, member_number as memberNumber, type, detail, amount, payment_method as paymentMethod, balance_after as balanceAfter, created_at as createdAt FROM member_transactions WHERE member_number = ? ORDER BY created_at DESC, id DESC LIMIT ?`).all(memberNumber, transactionLimit) as unknown as SqliteTransaction[];
  return { member, transactions };
}

export function setMemberNumberMode(db: SqliteDb, mode: "running" | "year" | "manual") {
  db.prepare(`INSERT INTO store_settings (key, value) VALUES ('member_number_mode', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(mode);
}

export function getMemberNumberMode(db: SqliteDb) {
  const row = db.prepare(`SELECT value FROM store_settings WHERE key = 'member_number_mode'`).get() as { value: "running" | "year" | "manual" } | undefined;
  return row?.value ?? "running";
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

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDateTime(date = new Date()) {
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

function runInTransaction<T>(db: SqliteDb, fn: () => T): T {
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

// --- products & stock -------------------------------------------------------

export function listProducts(db: SqliteDb, includeInactive = false): SqliteProduct[] {
  if (includeInactive) {
    return db.prepare(`SELECT id, sku, barcode, name, category, emoji, color, unit, price, cost, stock, reorder_point AS reorderPoint, active, created_at AS createdAt FROM products ORDER BY active DESC, id`).all() as unknown as SqliteProduct[];
  }
  return db.prepare(`SELECT id, sku, barcode, name, category, emoji, color, unit, price, cost, stock, reorder_point AS reorderPoint, active, created_at AS createdAt FROM products WHERE active = 1 ORDER BY id`).all() as unknown as SqliteProduct[];
}

function getProductById(db: SqliteDb, productId: number): SqliteProduct | undefined {
  return db.prepare(`SELECT id, sku, barcode, name, category, emoji, color, unit, price, cost, stock, reorder_point AS reorderPoint, active, created_at AS createdAt FROM products WHERE id = ?`).get(productId) as SqliteProduct | undefined;
}

export type CreateProductInput = {
  name: string;
  sku?: string;
  barcode?: string;
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

const CATEGORY_SKU_PREFIXES: Record<string, string> = {
  "เครื่องดื่ม": "DRK",
  "อาหาร": "FD",
  "ของใช้": "HYG",
};

function generateSku(db: SqliteDb, category: string) {
  const prefix = CATEGORY_SKU_PREFIXES[category] ?? "GEN";
  const rows = db.prepare(`SELECT sku FROM products WHERE sku LIKE ?`).all(`${prefix}-%`) as unknown as { sku: string }[];
  const used = new Set(rows.map((row) => row.sku));
  let sequence = rows.length + 1;
  while (used.has(`${prefix}-${String(sequence).padStart(3, "0")}`)) sequence += 1;
  return `${prefix}-${String(sequence).padStart(3, "0")}`;
}

export function createProduct(db: SqliteDb, input: CreateProductInput): SqliteProduct {
  const name = input.name?.trim();
  if (!name) throw new StoreError("กรุณาระบุชื่อสินค้า");
  if (!(input.price > 0)) throw new StoreError("ราคาขายต้องมากกว่า 0");
  if (input.stock !== undefined && (!Number.isInteger(input.stock) || input.stock < 0)) throw new StoreError("จำนวนสต็อกเริ่มต้นไม่ถูกต้อง");
  const sku = input.sku?.trim() || generateSku(db, input.category ?? "ของใช้");
  if (db.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku)) {
    throw new StoreError(`รหัสสินค้า ${sku} ถูกใช้แล้ว กรุณาระบุรหัสอื่น`);
  }
  const result = db.prepare(`INSERT INTO products (sku, barcode, name, category, emoji, color, unit, price, cost, stock, reorder_point, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
    sku,
    input.barcode?.trim() || null,
    name,
    input.category?.trim() || "ของใช้",
    input.emoji ?? null,
    input.color ?? null,
    input.unit?.trim() || "ชิ้น",
    round2(input.price),
    round2(input.cost ?? 0),
    input.stock ?? 0,
    input.reorderPoint ?? 10,
  );
  logAction(db, "เพิ่มสินค้า", input.actor?.trim() || "ระบบ", `${name} (${sku})`, "green", input.actorRole ?? null);
  return getProductById(db, Number(result.lastInsertRowid))!;
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
  if (!Number.isInteger(qty) || qty <= 0) throw new StoreError("จำนวนต้องมากกว่า 0");
  const product = getProductById(db, productId);
  if (!product || !product.active) throw new StoreError(`ไม่พบสินค้ารหัส ${productId} ในระบบ`);
  const effectiveCost = cost === undefined ? product.cost : round2(cost);
  const lotLabel = lot?.trim() || `LOT-${formatDate()}`;
  const createdAt = formatDateTime();
  return runInTransaction(db, () => {
    const result = db.prepare(`INSERT INTO stock_lots (product_id, lot, expiry_date, qty, cost, received_at) VALUES (?, ?, ?, ?, ?, ?)`).run(productId, lotLabel, expiryDate || null, qty, effectiveCost, createdAt);
    db.prepare(`UPDATE products SET stock = stock + ?, cost = ? WHERE id = ?`).run(qty, effectiveCost, productId);
    logAction(db, "รับเข้าสินค้า", actor?.trim() || "ระบบ", `${product.name} · Lot ${lotLabel} · +${qty} ${product.unit}`, "green", actorRole ?? null, createdAt);
    return {
      lot: { id: Number(result.lastInsertRowid), productId, lot: lotLabel, expiry: expiryDate || null, qty, cost: effectiveCost, receivedAt: createdAt },
      product: getProductById(db, productId)!,
    };
  });
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
  const note = input.note?.trim();
  const detail =
    (diff === 0
      ? `${product.name} · ตรงตามระบบ ${input.countedQty} ${product.unit}`
      : `${product.name} · ระบบ ${product.stock} → นับได้ ${input.countedQty} ${product.unit} (${diff})`) + (note ? ` · ${note}` : "");
  const tone = diff < 0 ? "red" : diff > 0 ? "green" : "blue";
  runInTransaction(db, () => {
    db.prepare(`UPDATE products SET stock = ? WHERE id = ?`).run(input.countedQty, input.productId);
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

export type UpdateProductInput = {
  productId: number;
  name?: string;
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
  if (input.price !== undefined && !(input.price > 0)) throw new StoreError("ราคาขายต้องมากกว่า 0");
  if (input.cost !== undefined && input.cost < 0) throw new StoreError("ต้นทุนต้องเป็น 0 ขึ้นไป");
  if (input.reorderPoint !== undefined && (!Number.isInteger(input.reorderPoint) || input.reorderPoint < 0)) throw new StoreError("จุดสั่งซื้อต้องเป็นจำนวนเต็ม 0 ขึ้นไป");

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

export type CheckoutItemInput = { productId: number; qty: number };

/**
 * Deducts sold qty from the product's lots FEFO-style (first-expiry-first-out:
 * earliest expiry first, undated lots last, then oldest received, then lot id).
 * Best-effort by design: when the lots cannot cover the whole qty — drift
 * between products.stock and the lot sums — they are zeroed instead and the
 * shortfall is returned so checkout can flag it in the audit trail.
 * products.stock stays the authoritative sellable figure at all times.
 * Returns the unmet qty (0 when the lots covered the sale).
 */
function deductLotsFifo(db: SqliteDb, productId: number, qty: number): number {
  const tracked = db.prepare(`SELECT COUNT(*) AS count FROM stock_lots WHERE product_id = ?`).get(productId) as { count: number };
  if (tracked.count === 0) return 0; // product is not lot-tracked — nothing to deduct
  const lots = db.prepare(
    `SELECT id, qty FROM stock_lots WHERE product_id = ? AND qty > 0 ORDER BY (expiry_date IS NULL), expiry_date, received_at, id`,
  ).all(productId) as unknown as { id: number; qty: number }[];
  let remaining = qty;
  const updateLot = db.prepare(`UPDATE stock_lots SET qty = qty - ? WHERE id = ?`);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.qty, remaining);
    updateLot.run(take, lot.id);
    remaining -= take;
  }
  return remaining;
}

export type CheckoutInput = {
  items: CheckoutItemInput[];
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  memberNumber?: string | null;
  discount?: number;
  cashier?: string;
  actorRole?: string;
};

export function checkout(db: SqliteDb, input: CheckoutInput): CheckoutReceipt {
  if (!input.items?.length) throw new StoreError("ยังไม่มีสินค้าในบิล");
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) throw new StoreError("วิธีชำระเงินไม่ถูกต้อง");
  const merged = new Map<number, number>();
  for (const item of input.items) {
    if (!Number.isInteger(item.productId) || item.productId <= 0) throw new StoreError("รหัสสินค้าไม่ถูกต้อง");
    if (!Number.isInteger(item.qty) || item.qty <= 0) throw new StoreError("จำนวนต้องมากกว่า 0");
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.qty);
  }
  const isWallet = input.paymentMethod === WALLET_PAYMENT;
  if (isWallet && !input.memberNumber?.trim()) throw new StoreError("กรุณาเลือกสมาชิกก่อนชำระแบบหักบัญชีสมาชิก");

  const products = new Map<number, SqliteProduct>();
  for (const entry of Array.from(merged.entries())) {
    const [productId, qty] = entry;
    const product = getProductById(db, productId);
    if (!product || !product.active) throw new StoreError(`ไม่พบสินค้ารหัส ${productId} ในระบบ`);
    if (product.stock < qty) throw new StoreError(`สต็อกไม่พอ · ${product.name} เหลือ ${product.stock} ${product.unit}`);
    products.set(productId, product);
  }

  const items = Array.from(merged.entries()).map(([productId, qty]) => {
    const product = products.get(productId)!;
    return { productId, name: product.name, unit: product.unit, qty, price: product.price, cost: product.cost, amount: round2(product.price * qty) };
  });
  const subtotal = round2(items.reduce((sum, item) => sum + item.amount, 0));
  const discount = round2(Math.max(0, input.discount ?? 0));
  if (discount > subtotal) throw new StoreError("ส่วนลดมากกว่ายอดรวมสินค้า");
  const total = round2(subtotal - discount);

  let member: SqliteMember | undefined;
  if (isWallet) {
    member = db.prepare(`SELECT id, member_number as memberNumber, first_name as firstName, last_name as lastName, id_card as idCard, phone, type, balance, status, created_at as createdAt FROM members WHERE member_number = ?`).get(input.memberNumber!.trim()) as SqliteMember | undefined;
    if (!member) throw new StoreError(`ไม่พบสมาชิก ${input.memberNumber} ในระบบ`);
    if (member.status !== "active") throw new StoreError(`สมาชิกถูกระงับการใช้งาน · ${member.memberNumber}`);
    if (member.balance < total) throw new StoreError(`ยอดเงินคงเหลือไม่พอ · ยอดชำระ ${money(total)} คงเหลือ ${money(member.balance)}`);
  }

  const now = new Date();
  const createdAt = formatDateTime(now);
  const orderNumber = nextOrderNumber(db, now);
  const cashier = input.cashier?.trim() || "เจ้าหน้าที่ร้านค้า";

  return runInTransaction(db, () => {
    const saleResult = db.prepare(`INSERT INTO sales (order_number, payment_method, member_number, subtotal, discount, total, cashier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      orderNumber,
      input.paymentMethod,
      member?.memberNumber ?? (input.memberNumber?.trim() || null),
      subtotal,
      discount,
      total,
      cashier,
      createdAt,
    );
    const saleId = Number(saleResult.lastInsertRowid);
    const insertItem = db.prepare(`INSERT INTO sale_items (sale_id, product_id, name, qty, price, cost, unit) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const updateStock = db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`);
    const lotShortfalls: { name: string; unit: string; qty: number }[] = [];
    for (const item of items) {
      insertItem.run(saleId, item.productId, item.name, item.qty, item.price, item.cost, item.unit);
      updateStock.run(item.qty, item.productId);
      const shortfall = deductLotsFifo(db, item.productId, item.qty);
      if (shortfall > 0) lotShortfalls.push({ name: item.name, unit: item.unit, qty: shortfall });
    }

    let balanceAfter: number | null = null;
    if (isWallet && member) {
      balanceAfter = round2(member.balance - total);
      db.prepare(`UPDATE members SET balance = ? WHERE member_number = ?`).run(balanceAfter, member.memberNumber);
      db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, created_at) VALUES (?, 'purchase', ?, ?, ?, ?, ?)`).run(
        member.memberNumber,
        `บิล #${orderNumber} · ${summarizeItems(items)}`,
        -total,
        input.paymentMethod,
        balanceAfter,
        createdAt,
      );
    }

    const lotNote = lotShortfalls.length
      ? ` · ตัดยอด Lot ไม่ครบ: ${lotShortfalls.map((row) => `${row.name} ${row.qty} ${row.unit}`).join(", ")} (แนะนำนับสต็อกแยกล็อต)`
      : "";
    logAction(db, "ขายสินค้า", cashier, `บิล #${orderNumber} · ${money(total)}${member ? ` · หักบัญชี ${member.memberNumber}` : ""}${lotNote}`, "blue", input.actorRole ?? null, createdAt);

    return {
      orderNumber,
      createdAt,
      items: items.map(({ productId, name, unit, qty, price, amount }) => ({ productId, name, unit, qty, price, amount })),
      subtotal,
      discount,
      total,
      paymentMethod: input.paymentMethod,
      memberNumber: member?.memberNumber ?? null,
      memberName: member ? `${member.firstName} ${member.lastName}`.trim() : null,
      balanceAfter,
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
  const limit = Math.max(1, Math.min(500, Math.floor(input.limit ?? 50)));
  const conditions: string[] = [];
  const params: string[] = [];
  if (search) {
    conditions.push("(s.order_number LIKE ? OR s.member_number LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sales = db.prepare(`SELECT s.id, s.order_number AS orderNumber, s.payment_method AS paymentMethod, s.member_number AS memberNumber, s.subtotal, s.discount, s.total, s.cashier, s.created_at AS createdAt, m.first_name || ' ' || m.last_name AS memberName FROM sales s LEFT JOIN members m ON m.member_number = s.member_number${where} ORDER BY s.created_at DESC, s.id DESC LIMIT ?`).all(...params, limit) as unknown as {
    id: number;
    orderNumber: string;
    paymentMethod: string;
    memberNumber: string | null;
    subtotal: number;
    discount: number;
    total: number;
    cashier: string | null;
    createdAt: string;
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
  }));
}

// --- members & wallet -------------------------------------------------------

const MEMBER_SELECT = `SELECT id, member_number as memberNumber, first_name as firstName, last_name as lastName, id_card as idCard, phone, type, balance, status, created_at as createdAt FROM members WHERE member_number = ?`;

function getMemberByNumber(db: SqliteDb, memberNumber: string): SqliteMember | undefined {
  return db.prepare(MEMBER_SELECT).get(memberNumber) as SqliteMember | undefined;
}

export function listMembers(db: SqliteDb, search?: string, status?: "active" | "suspended"): SqliteMemberSummary[] {
  const conditions: string[] = [];
  const params: string[] = [];
  if (search?.trim()) {
    conditions.push(`(first_name || ' ' || last_name || ' ' || member_number) LIKE ?`);
    params.push(`%${search.trim()}%`);
  }
  if (status) {
    conditions.push("status = ?");
    params.push(status);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`SELECT m.id, m.member_number AS memberNumber, m.first_name AS firstName, m.last_name AS lastName, m.type, m.balance, m.status, m.created_at AS createdAt, (SELECT MAX(t.created_at) FROM member_transactions t WHERE t.member_number = m.member_number) AS lastTransactionAt FROM members m${where} ORDER BY m.member_number`).all(...params) as unknown as SqliteMemberSummary[];
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

function generateMemberNumber(db: SqliteDb, mode: "running" | "year" | "manual", provided?: string) {
  if (mode === "manual") {
    const manual = provided?.trim();
    if (!manual) throw new StoreError("โหมดกำหนดหมายเลขเอง: กรุณาระบุหมายเลขสมาชิก");
    return manual;
  }
  if (mode === "year") {
    const buddhistYear = String(new Date().getFullYear() + 543).slice(-2);
    const prefix = `${buddhistYear}-`;
    return `${prefix}${String(nextMemberSequence(db, prefix)).padStart(5, "0")}`;
  }
  return `M-${String(nextMemberSequence(db, "M-")).padStart(6, "0")}`;
}

export type RegisterMemberInput = {
  firstName: string;
  lastName: string;
  citizenId?: string;
  phone?: string;
  type?: string;
  initialDeposit?: number;
  memberNumber?: string;
  actor?: string;
  actorRole?: string;
};

export function registerMember(db: SqliteDb, input: RegisterMemberInput) {
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  if (!firstName || !lastName) throw new StoreError("กรุณาระบุชื่อและนามสกุลสมาชิก");
  if (input.initialDeposit !== undefined && !(input.initialDeposit > 0)) throw new StoreError("จำนวนเงินต้องมากกว่า 0");
  const memberNumber = generateMemberNumber(db, getMemberNumberMode(db), input.memberNumber);
  if (db.prepare(`SELECT id FROM members WHERE member_number = ?`).get(memberNumber)) {
    throw new StoreError(`หมายเลขสมาชิก ${memberNumber} ถูกใช้แล้ว`);
  }
  const initialDeposit = input.initialDeposit ? round2(input.initialDeposit) : 0;
  const createdAt = formatDateTime();
  runInTransaction(db, () => {
    db.prepare(`INSERT INTO members (member_number, first_name, last_name, id_card, phone, type, balance, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(
      memberNumber,
      firstName,
      lastName,
      input.citizenId?.trim() || null,
      input.phone?.trim() || null,
      input.type?.trim() || "สมาชิก",
      initialDeposit,
      createdAt,
    );
    if (initialDeposit > 0) {
      db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, created_at) VALUES (?, 'deposit', ?, ?, 'เงินสด', ?, ?)`).run(
        memberNumber,
        "เงินเริ่มต้นตอนลงทะเบียน · เงินสด",
        initialDeposit,
        initialDeposit,
        createdAt,
      );
    }
    logAction(db, "ลงทะเบียนสมาชิก", input.actor?.trim() || "ระบบ", `${memberNumber} · ${firstName} ${lastName}${initialDeposit > 0 ? ` · เงินเริ่มต้น ${money(initialDeposit)}` : ""}`, "green", input.actorRole ?? null, createdAt);
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
  type: "deposit" | "withdrawal";
  amount: number;
  note?: string;
  actor?: string;
  actorRole?: string;
};

export function walletTx(db: SqliteDb, input: WalletTxInput) {
  if (!(input.amount > 0)) throw new StoreError("จำนวนเงินต้องมากกว่า 0");
  const amount = round2(input.amount);
  const member = db.prepare(`SELECT id, member_number as memberNumber, first_name as firstName, last_name as lastName, id_card as idCard, phone, type, balance, status, created_at as createdAt FROM members WHERE member_number = ?`).get(input.memberNumber?.trim()) as SqliteMember | undefined;
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${input.memberNumber} ในระบบ`);
  if (member.status !== "active") throw new StoreError(`สมาชิกถูกระงับการใช้งาน · ${member.memberNumber}`);
  if (input.type === "withdrawal" && member.balance < amount) {
    throw new StoreError(`ยอดเงินคงเหลือไม่พอ · ถอน ${money(amount)} คงเหลือ ${money(member.balance)}`);
  }
  const signedAmount = input.type === "deposit" ? amount : -amount;
  const balanceAfter = round2(member.balance + signedAmount);
  const note = input.note?.trim();
  const detail = note || (input.type === "deposit" ? "เติมเงินเข้าบัญชีสมาชิก · เงินสด" : "ถอนเงินจากบัญชีสมาชิก · เงินสด");
  const actor = input.actor?.trim() || "เจ้าหน้าที่ร้านค้า";
  const createdAt = formatDateTime();
  runInTransaction(db, () => {
    db.prepare(`UPDATE members SET balance = ? WHERE member_number = ?`).run(balanceAfter, member.memberNumber);
    db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, created_at) VALUES (?, ?, ?, ?, 'เงินสด', ?, ?)`).run(
      member.memberNumber,
      input.type,
      detail,
      signedAmount,
      balanceAfter,
      createdAt,
    );
    logAction(
      db,
      input.type === "deposit" ? "เติมเงินสมาชิก" : "ถอนเงินสมาชิก",
      actor,
      `${member.memberNumber} · ${money(amount)} · ${note || "เงินสด"}`,
      input.type === "deposit" ? "green" : "purple",
      input.actorRole ?? null,
      createdAt,
    );
  });
  return {
    memberNumber: member.memberNumber,
    memberName: `${member.firstName} ${member.lastName}`.trim(),
    type: input.type,
    amount,
    balanceBefore: member.balance,
    balanceAfter,
    detail,
  };
}

export type UpdateMemberInput = {
  memberNumber: string;
  firstName?: string;
  lastName?: string;
  idCard?: string | null;
  phone?: string | null;
  type?: string;
  actor?: string;
  actorRole?: string;
};

/** Updates only the provided member profile fields. Undefined keeps the current value; empty idCard/phone clears them. */
export function updateMember(db: SqliteDb, input: UpdateMemberInput): SqliteMember {
  const member = getMemberByNumber(db, input.memberNumber?.trim() ?? "");
  if (!member) throw new StoreError(`ไม่พบสมาชิก ${input.memberNumber} ในระบบ`);
  if (typeof input.firstName === "string" && !input.firstName.trim()) throw new StoreError("กรุณาระบุชื่อสมาชิก");
  if (typeof input.lastName === "string" && !input.lastName.trim()) throw new StoreError("กรุณาระบุนามสกุลสมาชิก");
  if (typeof input.type === "string" && !input.type.trim()) throw new StoreError("กรุณาระบุประเภทสมาชิก");

  const assignments: string[] = [];
  const values: (string | null)[] = [];
  const changedLabels: string[] = [];
  const normalizeOptional = (value: string | null | undefined) => value?.trim() || null;
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

  const displayName = `${member.firstName} ${member.lastName}`.trim();
  runInTransaction(db, () => {
    db.prepare(`DELETE FROM members WHERE member_number = ?`).run(member.memberNumber);
    logAction(db, "ลบสมาชิก", input.actor?.trim() || "เจ้าหน้าที่ร้านค้า", `${member.memberNumber} · ${displayName}`, "red", input.actorRole ?? null, formatDateTime());
  });
  return { memberNumber: member.memberNumber, memberName: displayName };
}

// --- reports ----------------------------------------------------------------

export function dailySalesRows(db: SqliteDb, days = 30): DailySalesRow[] {
  const range = Math.max(1, Math.min(365, Math.floor(days)));
  const today = startOfToday();
  const since = `${formatDate(addDays(today, -(range - 1)))} 00:00:00`;
  const salesByDay = new Map<string, { orders: number; revenue: number }>();
  for (const row of db.prepare(`SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS orders, ROUND(SUM(total), 2) AS revenue FROM sales WHERE created_at >= ? GROUP BY date`).all(since) as unknown as { date: string; orders: number; revenue: number }[]) {
    salesByDay.set(row.date, { orders: row.orders, revenue: round2(row.revenue) });
  }
  const itemsByDay = new Map<string, { items: number; cogs: number }>();
  for (const row of db.prepare(`SELECT substr(s.created_at, 1, 10) AS date, COALESCE(SUM(si.qty), 0) AS items, ROUND(COALESCE(SUM(si.qty * si.cost), 0), 2) AS cogs FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.created_at >= ? GROUP BY date`).all(since) as unknown as { date: string; items: number; cogs: number }[]) {
    itemsByDay.set(row.date, { items: row.items, cogs: round2(row.cogs) });
  }
  const rows: DailySalesRow[] = [];
  for (let offset = range - 1; offset >= 0; offset -= 1) {
    const date = formatDate(addDays(today, -offset));
    const sales = salesByDay.get(date);
    const items = itemsByDay.get(date);
    const revenue = sales?.revenue ?? 0;
    const cogs = items?.cogs ?? 0;
    rows.push({ date, orders: sales?.orders ?? 0, items: items?.items ?? 0, revenue, cogs, profit: round2(revenue - cogs) });
  }
  return rows;
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
  const bestSellers = db.prepare(`SELECT si.name, SUM(si.qty) AS qty, ROUND(SUM(si.qty * si.price), 2) AS revenue FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at >= ? GROUP BY si.name ORDER BY qty DESC, revenue DESC LIMIT 5`).all(since) as unknown as { name: string; qty: number; revenue: number }[];
  const lowStock = db.prepare(`SELECT id, sku, name, unit, stock, reorder_point AS reorderPoint FROM products WHERE active = 1 AND stock <= reorder_point ORDER BY stock ASC`).all() as unknown as DashboardStats["lowStock"];
  const expirySoon = db.prepare(`SELECT l.id, l.product_id AS productId, p.sku, p.name, p.unit, l.lot, l.expiry_date AS expiry, l.qty FROM stock_lots l JOIN products p ON p.id = l.product_id WHERE l.expiry_date IS NOT NULL AND l.expiry_date >= ? AND l.expiry_date <= ? ORDER BY l.expiry_date`).all(formatDate(today), formatDate(addDays(today, 30))) as unknown as DashboardStats["expirySoon"];
  const recentActivities = db.prepare(`SELECT id, action, actor, actor_role AS actorRole, detail, tone, created_at AS createdAt FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 5`).all() as unknown as SqliteAuditLog[];
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

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  memberNumberMode: "running",
  storeName: "ร้านค้าสวัสดิการโรงพยาบาลผู้ป่วยจิตเวช",
  storeCode: "WEL-PSY-001",
  storeAddress: "โรงพยาบาลผู้ป่วยจิตเวช · ฝ่ายสวัสดิการ",
  autoPrintReceipt: true,
  showBalanceOnReceipt: true,
  lowBalanceAlert: true,
  lowBalanceThreshold: 100,
  lowStockAlert: true,
  expiryAlert: true,
  expiryAlertDays: 30,
};

const SETTINGS_KEY = "app_settings";

export function getSettings(db: SqliteDb): StoreSettings {
  const row = db.prepare(`SELECT value FROM store_settings WHERE key = ?`).get(SETTINGS_KEY) as { value: string } | undefined;
  const stored = row ? (JSON.parse(row.value) as Partial<StoreSettings>) : {};
  return { ...DEFAULT_STORE_SETTINGS, ...stored, memberNumberMode: getMemberNumberMode(db) };
}

export function setSettings(db: SqliteDb, patch: Partial<StoreSettings>, actor = "ผู้บริหาร", actorRole?: string | null): StoreSettings {
  if (patch.memberNumberMode !== undefined) {
    setMemberNumberMode(db, patch.memberNumberMode);
  }
  const { memberNumberMode: _mode, ...rest } = patch;
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

// --- app users & local sessions ---------------------------------------------

/** Login account for the welfare store app itself (local session auth). */
export type AppUser = {
  id: number;
  username: string;
  passwordHash: string;
  displayName: string;
  role: "staff" | "admin";
  active: number;
  createdAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
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

const APP_USER_SELECT = `SELECT id, username, password_hash AS passwordHash, display_name AS displayName, role, active, created_at AS createdAt, failed_attempts AS failedAttempts, locked_until AS lockedUntil FROM app_users`;

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
  db.prepare(`DELETE FROM app_sessions WHERE expires_at < ?`).run(formatDateTime(now));
  db.prepare(`INSERT INTO app_sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(sessionId, userId, expiresAt, formatDateTime(now));
  return { sessionId, expiresAt };
}

/** Resolves an active, unexpired session to its (active) app user. */
export function authenticateAppSession(db: SqliteDb, sessionId: string): AppUser | undefined {
  return db.prepare(
    `SELECT u.id, u.username, u.password_hash AS passwordHash, u.display_name AS displayName, u.role, u.active, u.created_at AS createdAt, u.failed_attempts AS failedAttempts, u.locked_until AS lockedUntil
     FROM app_sessions s JOIN app_users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`,
  ).get(sessionId, formatDateTime()) as AppUser | undefined;
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
  role: "staff" | "admin";
  active: number;
  createdAt: string;
  expiresAt: string;
};

/** Purges expired session rows (housekeeping shared by list/revoke helpers). */
function purgeExpiredAppSessions(db: SqliteDb): void {
  db.prepare(`DELETE FROM app_sessions WHERE expires_at < ?`).run(formatDateTime());
}

/**
 * Lists every unexpired session with its owning user, newest login first.
 * Suspended users keep their sessions listed (revoking them is the point).
 */
export function listAppSessions(db: SqliteDb): AppSessionSummary[] {
  purgeExpiredAppSessions(db);
  return db.prepare(
    `SELECT s.id AS sessionId, u.username, u.display_name AS displayName, u.role, u.active, s.created_at AS createdAt, s.expires_at AS expiresAt
     FROM app_sessions s JOIN app_users u ON u.id = s.user_id
     WHERE s.expires_at > ?
     ORDER BY s.created_at DESC, s.id DESC`,
  ).all(formatDateTime()) as unknown as AppSessionSummary[];
}

/** Finds one unexpired session (with user info) by id. */
function findAppSessionById(db: SqliteDb, sessionId: string): AppSessionSummary | undefined {
  return db.prepare(
    `SELECT s.id AS sessionId, u.username, u.display_name AS displayName, u.role, u.active, s.created_at AS createdAt, s.expires_at AS expiresAt
     FROM app_sessions s JOIN app_users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  ).get(sessionId, formatDateTime()) as AppSessionSummary | undefined;
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
  role: "staff" | "admin";
  active: number;
  createdAt: string;
  failedAttempts: number;
  lockedUntil: string | null;
};

const APP_USER_SUMMARY_SELECT = `SELECT id, username, display_name AS displayName, role, active, created_at AS createdAt, failed_attempts AS failedAttempts, locked_until AS lockedUntil FROM app_users`;

function getAppUserSummaryById(db: SqliteDb, userId: number): AppUserSummary | undefined {
  return db.prepare(`${APP_USER_SUMMARY_SELECT} WHERE id = ?`).get(userId) as AppUserSummary | undefined;
}

/** Lists every login account, oldest first. Never exposes password hashes. */
export function listAppUsers(db: SqliteDb): AppUserSummary[] {
  return db.prepare(`${APP_USER_SUMMARY_SELECT} ORDER BY id`).all() as unknown as AppUserSummary[];
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
  role: "staff" | "admin";
  actor?: string;
  actorRole?: string | null;
};

/** Creates a login account with a scrypt-hashed password and audits it. */
export function createAppUser(db: SqliteDb, input: CreateAppUserInput): AppUserSummary {
  const username = input.username?.trim() ?? "";
  if (!USERNAME_PATTERN.test(username)) {
    throw new StoreError("ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ ตัวเลข จุด หรือขีดล่าง ความยาว 3-30 ตัวอักษร");
  }
  if (db.prepare(`SELECT id FROM app_users WHERE LOWER(username) = LOWER(?)`).get(username)) {
    throw new StoreError("มีชื่อผู้ใช้นี้ในระบบแล้ว");
  }
  if (typeof input.password !== "string" || input.password.length < 4) {
    throw new StoreError("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร");
  }
  const displayName = input.displayName?.trim() ?? "";
  if (!displayName) throw new StoreError("กรุณาระบุชื่อ-นามสกุลผู้ใช้");
  const createdAt = formatDateTime();
  const result = db.prepare(`INSERT INTO app_users (username, password_hash, display_name, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`).run(
    username,
    hashPassword(input.password),
    displayName,
    input.role,
    createdAt,
  );
  const roleThai = input.role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
  logAction(db, "เพิ่มผู้ใช้ระบบ", input.actor?.trim() || "ผู้บริหาร", `${username} · ${displayName} · สิทธิ์ ${roleThai}`, "green", input.actorRole ?? null, createdAt);
  return getAppUserSummaryById(db, Number(result.lastInsertRowid))!;
}

export type UpdateAppUserInput = {
  userId: number;
  displayName?: string;
  role?: "staff" | "admin";
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
  if (newPassword !== undefined && newPassword.length < 4) {
    throw new StoreError("รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร");
  }

  const nextDisplayName = input.displayName !== undefined && input.displayName.trim() !== user.displayName ? input.displayName.trim() : undefined;
  const nextRole = input.role !== undefined && input.role !== user.role ? input.role : undefined;
  const nextActive = input.active !== undefined && (input.active ? 1 : 0) !== user.active ? (input.active ? 1 : 0) : undefined;

  // Last-admin guard: the final active admin cannot be demoted or deactivated.
  if (user.role === "admin" && user.active === 1 && (nextRole !== undefined || nextActive === 0)) {
    const others = db.prepare(`SELECT COUNT(*) AS count FROM app_users WHERE role = 'admin' AND active = 1 AND id != ?`).get(input.userId) as { count: number };
    if (others.count === 0) {
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
    values.push(nextRole);
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
      db.prepare(`UPDATE app_users SET password_hash = ? WHERE id = ?`).run(hashPassword(newPassword), input.userId);
      // The plaintext password must never appear anywhere in the audit trail.
      logAction(db, "ตั้งรหัสผ่านใหม่", actor, `${user.username} · ตั้งรหัสผ่านใหม่`, "amber", input.actorRole ?? null, createdAt);
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
  { sku: "ICE-004", barcode: "8850000000086", name: "น้ำแข็งถุงเล็ก", category: "ของใช้", emoji: "🧊", color: "cyan", unit: "ถุง", price: 10, cost: 6, stock: 35, reorderPoint: 40 },
];

const SEED_STOCK_LOTS: { sku: string; lot: string; expiry: string | null; qty: number; cost: number; receivedAt: string }[] = [
  { sku: "DRK-001", lot: "CR-2608-01", expiry: "2027-08-18", qty: 124, cost: 4.2, receivedAt: "2026-08-20 09:12:00" },
  { sku: "DRK-002", lot: "CF-2607-02", expiry: "2027-03-10", qty: 42, cost: 13.5, receivedAt: "2026-08-15 10:40:00" },
  { sku: "FD-014", lot: "ครัวกลาง-17", expiry: "2026-09-18", qty: 18, cost: 32, receivedAt: "2026-09-17 07:20:00" },
  { sku: "DRK-003", lot: "ML-2608-08", expiry: "2026-09-30", qty: 65, cost: 9.5, receivedAt: "2026-08-22 08:55:00" },
  { sku: "FD-015", lot: "BR-260917-A", expiry: "2026-09-20", qty: 9, cost: 18, receivedAt: "2026-09-17 06:45:00" },
  { sku: "HYG-032", lot: "HM-2606-03", expiry: "2028-06-04", qty: 28, cost: 24, receivedAt: "2026-06-28 13:10:00" },
  { sku: "HYG-033", lot: "MSK-2606-01", expiry: "2029-06-30", qty: 86, cost: 14, receivedAt: "2026-06-28 13:25:00" },
  { sku: "ICE-004", lot: "รับรายวัน", expiry: null, qty: 35, cost: 6, receivedAt: "2026-09-17 05:30:00" },
];

const SEED_MEMBERS: { memberNumber: string; firstName: string; lastName: string; type: string; balance: number; status: "active" | "suspended" }[] = [
  { memberNumber: "M-000218", firstName: "อรทัย", lastName: "ส.", type: "สมาชิก", balance: 1240, status: "active" },
  { memberNumber: "M-000184", firstName: "ธนกร", lastName: "พ.", type: "เจ้าหน้าที่", balance: 860, status: "active" },
  { memberNumber: "M-000092", firstName: "พิมพ์ชนก", lastName: "ร.", type: "สมาชิก", balance: 0, status: "suspended" },
  { memberNumber: "M-000241", firstName: "สมชาย", lastName: "ว.", type: "สมาชิก", balance: 340, status: "active" },
  { memberNumber: "M-000119", firstName: "จุฑามาศ", lastName: "ก.", type: "เจ้าหน้าที่", balance: 2180, status: "active" },
];

const SEED_MEMBER_TRANSACTIONS: { memberNumber: string; type: "purchase" | "deposit" | "withdrawal"; detail: string; amount: number; paymentMethod: string | null; balanceAfter: number; createdAt: string }[] = [
  { memberNumber: "M-000218", type: "purchase", detail: "บิล #INV-260917-038 · น้ำดื่ม 2 ขวด, ข้าวกล่อง 1 กล่อง", amount: -59, paymentMethod: "member_balance", balanceAfter: 1240, createdAt: "2026-09-17 14:38:00" },
  { memberNumber: "M-000218", type: "deposit", detail: "เงินสด · ผู้ฝาก: น.ส.กัญญาณัฐ พ.", amount: 500, paymentMethod: "cash", balanceAfter: 1299, createdAt: "2026-09-17 14:32:00" },
  { memberNumber: "M-000218", type: "withdrawal", detail: "ถอนเพื่อถอนฟัน · เงินสด", amount: -200, paymentMethod: "cash", balanceAfter: 799, createdAt: "2026-09-12 10:16:00" },
  { memberNumber: "M-000218", type: "purchase", detail: "บิล #INV-260901-006 · สินค้า 4 รายการ", amount: -132, paymentMethod: "member_balance", balanceAfter: 999, createdAt: "2026-09-01 09:05:00" },
  { memberNumber: "M-000092", type: "withdrawal", detail: "ถอนเพื่อถอนฟัน · แนบหลักฐานแล้ว", amount: -200, paymentMethod: "cash", balanceAfter: 0, createdAt: "2026-09-16 09:12:00" },
  { memberNumber: "M-000092", type: "purchase", detail: "บิล #INV-260912-091 · สินค้า 2 รายการ", amount: -80, paymentMethod: "member_balance", balanceAfter: 200, createdAt: "2026-09-12 11:40:00" },
];

const SEED_AUDIT_LOGS: { action: string; actor: string; actorRole: string; detail: string; tone: string; createdAt: string }[] = [
  { action: "ขายสินค้า", actor: "น.ส.กัญญาณัฐ พ.", actorRole: "เจ้าหน้าที่", detail: "บิล #INV-260917-038 · ฿186.00", tone: "blue", createdAt: "2026-09-17 14:38:00" },
  { action: "เติมเงินสมาชิก", actor: "น.ส.กัญญาณัฐ พ.", actorRole: "เจ้าหน้าที่", detail: "M-000218 · ฿500.00 · เงินสด", tone: "green", createdAt: "2026-09-17 14:32:00" },
  { action: "แก้ไขสต็อก", actor: "นายวรพจน์ ด.", actorRole: "ผู้บริหาร", detail: "น้ำดื่มคริสตัล · +24 ขวด", tone: "amber", createdAt: "2026-09-17 13:51:00" },
  { action: "ถอนเงินสมาชิก", actor: "น.ส.กัญญาณัฐ พ.", actorRole: "เจ้าหน้าที่", detail: "M-000092 · ฿200.00 · ถอนเพื่อถอนฟัน", tone: "purple", createdAt: "2026-09-17 12:06:00" },
];

const SEED_APP_USERS: { username: string; password: string; displayName: string; role: "staff" | "admin" }[] = [
  { username: "kanyanat", password: "1234", displayName: "กัญญาณัฐ พ.", role: "staff" },
  { username: "woraphot", password: "1234", displayName: "วรพจน์ ด.", role: "admin" },
];

/** Idempotent demo login accounts — inserts only usernames that are still missing. */
export function seedAppUsers(db: SqliteDb) {
  const lookup = db.prepare(`SELECT id FROM app_users WHERE username = ?`);
  const insert = db.prepare(`INSERT INTO app_users (username, password_hash, display_name, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)`);
  for (const user of SEED_APP_USERS) {
    if (!lookup.get(user.username)) {
      insert.run(user.username, hashPassword(user.password), user.displayName, user.role, formatDateTime());
    }
  }
}

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
  seedAppUsers(db);
  const insertMember = db.prepare(`INSERT OR IGNORE INTO members (member_number, first_name, last_name, id_card, balance, status, type) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const member of SEED_MEMBERS) {
    insertMember.run(member.memberNumber, member.firstName, member.lastName, null, member.balance, member.status, member.type);
  }
  if (countRows(db, "member_transactions") === 0) {
    const insertTransaction = db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const transaction of SEED_MEMBER_TRANSACTIONS) {
      insertTransaction.run(transaction.memberNumber, transaction.type, transaction.detail, transaction.amount, transaction.paymentMethod, transaction.balanceAfter, transaction.createdAt);
    }
  }
  if (countRows(db, "products") === 0) {
    const insertProduct = db.prepare(`INSERT INTO products (sku, barcode, name, category, emoji, color, unit, price, cost, stock, reorder_point, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
    for (const product of SEED_PRODUCTS) {
      insertProduct.run(product.sku, product.barcode, product.name, product.category, product.emoji, product.color, product.unit, product.price, product.cost, product.stock, product.reorderPoint);
    }
  }
  if (countRows(db, "stock_lots") === 0) {
    const insertLot = db.prepare(`INSERT INTO stock_lots (product_id, lot, expiry_date, qty, cost, received_at) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const lot of SEED_STOCK_LOTS) {
      const product = db.prepare(`SELECT id FROM products WHERE sku = ?`).get(lot.sku) as { id: number } | undefined;
      if (product) insertLot.run(product.id, lot.lot, lot.expiry, lot.qty, lot.cost, lot.receivedAt);
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
export function openWelfareStore(filename = process.env.SQLITE_DB_PATH ?? "data/welfare-store.sqlite"): SqliteDb {
  if (filename !== ":memory:") {
    mkdirSync(dirname(resolve(filename)), { recursive: true });
  }
  const db = createSqliteStore(filename);
  seedWelfareStoreData(db);
  return db;
}
