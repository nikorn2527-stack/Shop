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
  photoUrl: string | null;
  gender: string | null;
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
  photoUrl: string | null;
  gender: string | null;
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
};

/** A past receipt rebuilt from the sales/sale_items tables — balanceAfter is replayed from the member ledger when that bill was a wallet purchase. */
export type SaleHistoryEntry = CheckoutReceipt;

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
  /** Round 25 — ปรับแต่งแอป: ชื่อที่แสดงบน sidebar/login/title */
  appName: string;
  /** data-URL รูปโลโก้ (สูงสุด ~512KB) — ว่าง = ใช้อักษรย่อ */
  appLogo: string;
  /** สีธีมหลัก: preset id เช่น "emerald" หรือ hex "#007a55" */
  appTheme: string;
  autoPrintReceipt: boolean;
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
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS order_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      qty REAL NOT NULL DEFAULT 1,
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureColumn(db, "members", "phone", "TEXT");
  ensureColumn(db, "members", "type", "TEXT NOT NULL DEFAULT 'สมาชิก'");
  ensureColumn(db, "member_transactions", "balance_after", "REAL");
  ensureColumn(db, "audit_logs", "actor_role", "TEXT");
  ensureColumn(db, "sale_items", "unit", "TEXT");
  ensureColumn(db, "app_users", "failed_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "products", "size", "TEXT");
  ensureColumn(db, "products", "image_url", "TEXT");
  ensureColumn(db, "products", "quick_pick", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "products", "sell_mode", "TEXT");
  ensureColumn(db, "products", "price_tiers", "TEXT");
  ensureColumn(db, "members", "photo_url", "TEXT");
  ensureColumn(db, "members", "gender", "TEXT");
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
  }
}

export function createProduct(db: SqliteDb, input: CreateProductInput): SqliteProduct {
  const name = input.name?.trim();
  if (!name) throw new StoreError("กรุณาระบุชื่อสินค้า");
  if (!(input.price > 0)) throw new StoreError("ราคาขายต้องมากกว่า 0");
  if (input.stock !== undefined && (!Number.isInteger(input.stock) || input.stock < 0)) throw new StoreError("จำนวนสต็อกเริ่มต้นไม่ถูกต้อง");
  const sellMode = input.sellMode ?? "unit";
  const quickPick = toQuickPickFlag(input.quickPick);
  const priceTiers = input.priceTiers?.trim() || null;
  if (sellMode === "money") assertValidPriceTiers(priceTiers);
  const sku = input.sku?.trim() || generateSku(db, input.category ?? "ของใช้");
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
  if (input.price !== undefined && !(input.price > 0)) throw new StoreError("ราคาขายต้องมากกว่า 0");
  if (input.cost !== undefined && input.cost < 0) throw new StoreError("ต้นทุนต้องเป็น 0 ขึ้นไป");
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
  if (isWallet) {
    member = db.prepare(`SELECT id, member_number as memberNumber, first_name as firstName, last_name as lastName, id_card as idCard, phone, type, balance, status, created_at as createdAt, photo_url as photoUrl, gender FROM members WHERE member_number = ?`).get(input.memberNumber!.trim()) as SqliteMember | undefined;
    if (!member) throw new StoreError(`ไม่พบสมาชิก ${input.memberNumber} ในระบบ`);
    if (member.status !== "active") throw new StoreError(`สมาชิกถูกระงับการใช้งาน · ${member.memberNumber}`);
    if (member.balance < total) throw new StoreError(`ยอดเงินคงเหลือไม่พอ · ยอดชำระ ${money(total)} คงเหลือ ${money(member.balance)}`);
  } else if (input.memberNumber?.trim()) {
    // Cash / QR bills can still be tied to a member — the receipt then shows
    // ผู้ทำรายการ + ยอดคงเหลือล่าสุด of that member (no deduction happens).
    member = db.prepare(`SELECT id, member_number as memberNumber, first_name as firstName, last_name as lastName, id_card as idCard, phone, type, balance, status, created_at as createdAt, photo_url as photoUrl, gender FROM members WHERE member_number = ?`).get(input.memberNumber.trim()) as SqliteMember | undefined;
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
      if (item.productId == null) continue; // รายการพิเศษ — no product/stock row behind it
      updateStock.run(item.qty, item.productId);
      const shortfall = deductLotsFifo(db, item.productId, item.qty);
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
      cashier,
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

const MEMBER_SELECT = `SELECT id, member_number as memberNumber, first_name as firstName, last_name as lastName, id_card as idCard, phone, type, balance, status, created_at as createdAt, photo_url as photoUrl, gender FROM members WHERE member_number = ?`;

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
  return db.prepare(`SELECT m.id, m.member_number AS memberNumber, m.first_name AS firstName, m.last_name AS lastName, m.type, m.balance, m.status, m.created_at AS createdAt, m.photo_url AS photoUrl, m.gender, (SELECT MAX(t.created_at) FROM member_transactions t WHERE t.member_number = m.member_number) AS lastTransactionAt FROM members m${where} ORDER BY m.member_number`).all(...params) as unknown as SqliteMemberSummary[];
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
  gender?: string;
  photoUrl?: string;
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
    db.prepare(`INSERT INTO members (member_number, first_name, last_name, id_card, phone, type, balance, status, created_at, photo_url, gender) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`).run(
      memberNumber,
      firstName,
      lastName,
      input.citizenId?.trim() || null,
      input.phone?.trim() || null,
      input.type?.trim() || "สมาชิก",
      initialDeposit,
      createdAt,
      input.photoUrl?.trim() || null,
      input.gender?.trim() || null,
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
    db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, actor, created_at) VALUES (?, ?, ?, ?, 'เงินสด', ?, ?, ?)`).run(
      member.memberNumber,
      input.type,
      detail,
      signedAmount,
      balanceAfter,
      actor,
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
  gender?: string | null;
  photoUrl?: string | null;
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

const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type DailyRangeInput = { days?: number; from?: string; to?: string };

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

export function dailySalesRows(db: SqliteDb, input: number | DailyRangeInput = 30): DailySalesRow[] {
  const options: DailyRangeInput = typeof input === "number" ? { days: input } : (input ?? {});
  const { fromDate, toDate } = resolveRangeDates(options);
  const since = `${formatDate(fromDate)} 00:00:00`;
  const until = `${formatDate(toDate)} 23:59:59`;
  const salesByDay = new Map<string, { orders: number; revenue: number }>();
  for (const row of db.prepare(`SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS orders, ROUND(SUM(total), 2) AS revenue FROM sales WHERE created_at >= ? AND created_at <= ? GROUP BY date`).all(since, until) as unknown as { date: string; orders: number; revenue: number }[]) {
    salesByDay.set(row.date, { orders: row.orders, revenue: round2(row.revenue) });
  }
  const itemsByDay = new Map<string, { items: number; cogs: number }>();
  for (const row of db.prepare(`SELECT substr(s.created_at, 1, 10) AS date, COALESCE(SUM(si.qty), 0) AS items, ROUND(COALESCE(SUM(si.qty * si.cost), 0), 2) AS cogs FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.created_at >= ? AND s.created_at <= ? GROUP BY date`).all(since, until) as unknown as { date: string; items: number; cogs: number }[]) {
    itemsByDay.set(row.date, { items: row.items, cogs: round2(row.cogs) });
  }
  const rows: DailySalesRow[] = [];
  for (let date = new Date(fromDate); date <= toDate; date = addDays(date, 1)) {
    const key = formatDate(date);
    const sales = salesByDay.get(key);
    const items = itemsByDay.get(key);
    const revenue = sales?.revenue ?? 0;
    const cogs = items?.cogs ?? 0;
    rows.push({ date: key, orders: sales?.orders ?? 0, items: items?.items ?? 0, revenue, cogs, profit: round2(revenue - cogs) });
  }
  return rows;
}

// --- report breakdowns (round 30): by product category & by cashier ---------

export type SalesByCategoryRow = { category: string; orders: number; qty: number; revenue: number; cogs: number; profit: number };

/** Sales grouped by product category — special (no-product) lines land in "รายการพิเศษ". */
export function salesByCategory(db: SqliteDb, input: DailyRangeInput = {}): SalesByCategoryRow[] {
  const { fromDate, toDate } = resolveRangeDates(input);
  const since = `${formatDate(fromDate)} 00:00:00`;
  const until = `${formatDate(toDate)} 23:59:59`;
  const rows = db.prepare(`SELECT COALESCE(NULLIF(TRIM(p.category), ''), 'ไม่ระบุหมวด') AS category, COUNT(DISTINCT si.sale_id) AS orders, COALESCE(SUM(si.qty), 0) AS qty, ROUND(COALESCE(SUM(si.qty * si.price), 0), 2) AS revenue, ROUND(COALESCE(SUM(si.qty * si.cost), 0), 2) AS cogs FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id WHERE s.created_at >= ? AND s.created_at <= ? GROUP BY category ORDER BY revenue DESC`).all(since, until) as unknown as { category: string; orders: number; qty: number; revenue: number; cogs: number }[];
  return rows.map((row) => ({ ...row, qty: Number(row.qty), profit: round2(row.revenue - row.cogs) }));
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
  const rows = db.prepare(`SELECT si.product_id AS productId, CASE WHEN si.product_id IS NULL THEN 'รายการพิเศษ' ELSE COALESCE(p.name, si.name) END AS name, p.sku AS sku, p.barcode AS barcode, NULLIF(TRIM(p.category), '') AS category, COUNT(DISTINCT si.sale_id) AS bills, COALESCE(SUM(si.qty), 0) AS qty, ROUND(COALESCE(SUM(si.qty * si.price), 0), 2) AS revenue, ROUND(COALESCE(SUM(si.qty * si.cost), 0), 2) AS cogs FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id WHERE s.created_at >= ? AND s.created_at <= ? GROUP BY si.product_id ORDER BY revenue DESC`).all(since, until) as unknown as { productId: number | null; name: string; sku: string | null; barcode: string | null; category: string | null; bills: number; qty: number; revenue: number; cogs: number }[];
  return rows.map((row) => ({ ...row, bills: Number(row.bills), qty: Number(row.qty), profit: round2(row.revenue - row.cogs) }));
}

export type SalesByCashierRow = { cashier: string; orders: number; items: number; memberBills: number; discount: number; total: number };

/** Sales grouped by the staff member (cashier) who closed each bill. */
export function salesByCashier(db: SqliteDb, input: DailyRangeInput = {}): SalesByCashierRow[] {
  const { fromDate, toDate } = resolveRangeDates(input);
  const since = `${formatDate(fromDate)} 00:00:00`;
  const until = `${formatDate(toDate)} 23:59:59`;
  const base = db.prepare(`SELECT COALESCE(NULLIF(TRIM(s.cashier), ''), 'ไม่ระบุพนักงาน') AS cashier, COUNT(*) AS orders, ROUND(COALESCE(SUM(s.discount), 0), 2) AS discount, ROUND(COALESCE(SUM(s.total), 0), 2) AS total, SUM(CASE WHEN s.member_number IS NOT NULL AND s.member_number != '' THEN 1 ELSE 0 END) AS memberBills FROM sales s WHERE s.created_at >= ? AND s.created_at <= ? GROUP BY cashier ORDER BY total DESC`).all(since, until) as unknown as { cashier: string; orders: number; discount: number; total: number; memberBills: number }[];
  const itemsByCashier = new Map<string, number>();
  for (const row of db.prepare(`SELECT COALESCE(NULLIF(TRIM(s.cashier), ''), 'ไม่ระบุพนักงาน') AS cashier, COALESCE(SUM(si.qty), 0) AS items FROM sales s JOIN sale_items si ON si.sale_id = s.id WHERE s.created_at >= ? AND s.created_at <= ? GROUP BY cashier`).all(since, until) as unknown as { cashier: string; items: number }[]) {
    itemsByCashier.set(row.cashier, Number(row.items));
  }
  return base.map((row) => ({ cashier: row.cashier, orders: row.orders, items: itemsByCashier.get(row.cashier) ?? 0, memberBills: Number(row.memberBills), discount: round2(row.discount), total: round2(row.total) }));
}

// --- member transaction history (round 30): what members spent / deposited /
// withdrew + which staff member performed each entry ---------------------------

export type MemberTransactionRow = {
  id: number;
  memberNumber: string;
  memberName: string | null;
  type: "purchase" | "deposit" | "withdrawal";
  detail: string;
  amount: number;
  paymentMethod: string | null;
  balanceAfter: number | null;
  actor: string | null;
  createdAt: string;
};

export type MemberTransactionsInput = {
  memberNumber?: string;
  type?: "purchase" | "deposit" | "withdrawal";
  from?: string;
  to?: string;
  limit?: number;
};

/** Member wallet ledger with the staff member (actor) who performed each entry. */
export function memberTransactions(db: SqliteDb, input: MemberTransactionsInput = {}): MemberTransactionRow[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  const memberNumber = input.memberNumber?.trim();
  if (memberNumber) {
    conditions.push("t.member_number LIKE ?");
    params.push(`%${memberNumber}%`);
  }
  if (input.type) {
    conditions.push("t.type = ?");
    params.push(input.type);
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
  const limit = Math.max(1, Math.min(1000, Math.floor(input.limit ?? 300)));
  return db.prepare(`SELECT t.id, t.member_number AS memberNumber, NULLIF(TRIM(m.first_name || ' ' || m.last_name), '') AS memberName, t.type, t.detail, t.amount, t.payment_method AS paymentMethod, t.balance_after AS balanceAfter, t.actor, t.created_at AS createdAt FROM member_transactions t LEFT JOIN members m ON m.member_number = t.member_number${where} ORDER BY t.created_at DESC, t.id DESC LIMIT ?`).all(...params, limit) as unknown as MemberTransactionRow[];
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

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  memberNumberMode: "running",
  storeName: "ร้านค้าสวัสดิการ",
  storeCode: "WEL-001",
  storeAddress: "ร้านค้าสวัสดิการ",
  appName: "ร้านค้าสวัสดิการ",
  appLogo: "",
  appTheme: "emerald",
  autoPrintReceipt: true,
  showBalanceOnReceipt: true,
  lowBalanceAlert: true,
  lowBalanceThreshold: 100,
  lowStockAlert: true,
  expiryAlert: true,
  expiryAlertDays: 30,
  dailyCutOffMode: "auto",
  dailyCutOffTime: "00:00",
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
  };
  lastClosure: DayClosureRow | null;
};

const CLOSURE_SELECT = `SELECT id, period_start AS periodStart, closed_at AS closedAt, bills, pieces, ROUND(revenue, 2) AS revenue, ROUND(cash_total, 2) AS cashTotal, ROUND(qr_total, 2) AS qrTotal, ROUND(wallet_total, 2) AS walletTotal, ROUND(deposits, 2) AS deposits, ROUND(withdrawals, 2) AS withdrawals, closed_by AS closedBy, note FROM day_closures`;

function parseCutOffTime(value: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "");
  if (!match) return { hours: 0, minutes: 0 };
  return { hours: Math.min(23, Number(match[1])), minutes: Math.min(59, Number(match[2])) };
}

/** Totals of sales + wallet movements within [since, now]. */
function periodTotals(db: SqliteDb, since: string) {
  const salesRows = db.prepare(`SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS revenue, SUM(CASE WHEN payment_method = 'เงินสด' THEN total ELSE 0 END) AS cashTotal, SUM(CASE WHEN payment_method = 'QR / สแกน' THEN total ELSE 0 END) AS qrTotal, SUM(CASE WHEN payment_method = 'หักบัญชีสมาชิก' THEN total ELSE 0 END) AS walletTotal FROM sales WHERE created_at >= ?`).get(since) as { bills: number; revenue: number; cashTotal: number | null; qrTotal: number | null; walletTotal: number | null };
  const piecesRow = db.prepare(`SELECT COALESCE(SUM(si.qty), 0) AS pieces FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.created_at >= ?`).get(since) as { pieces: number };
  const walletRows = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) AS deposits, COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN -amount ELSE 0 END), 0) AS withdrawals FROM member_transactions WHERE created_at >= ?`).get(since) as { deposits: number; withdrawals: number };
  return {
    bills: salesRows.bills,
    pieces: piecesRow.pieces,
    revenue: round2(salesRows.revenue),
    cashTotal: round2(salesRows.cashTotal ?? 0),
    qrTotal: round2(salesRows.qrTotal ?? 0),
    walletTotal: round2(salesRows.walletTotal ?? 0),
    deposits: round2(walletRows.deposits),
    withdrawals: round2(Math.abs(walletRows.withdrawals)),
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
  const closedAt = formatDateTime();
  const actor = input.actor?.trim() || "เจ้าหน้าที่ร้านค้า";
  const totals = status.totals;
  runInTransaction(db, () => {
    db.prepare(`INSERT INTO day_closures (period_start, closed_at, bills, pieces, revenue, cash_total, qr_total, wallet_total, deposits, withdrawals, closed_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      status.periodStart,
      closedAt,
      totals.bills,
      totals.pieces,
      totals.revenue,
      totals.cashTotal,
      totals.qrTotal,
      totals.walletTotal,
      totals.deposits,
      totals.withdrawals,
      actor,
      input.note?.trim() || null,
    );
    logAction(
      db,
      "ตัดยอดรอบขาย",
      actor,
      `รอบ ${status.periodStart} → ${closedAt} · ${totals.bills} บิล · ${money(totals.revenue)}${input.note?.trim() ? ` · ${input.note.trim()}` : ""}`,
      "purple",
      input.actorRole ?? null,
      closedAt,
    );
  });
  return db.prepare(`${CLOSURE_SELECT} ORDER BY closed_at DESC, id DESC LIMIT 1`).get() as DayClosureRow;
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
          db.prepare(`INSERT INTO stock_lots (product_id, lot, expiry_date, qty, cost, received_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(created.id, `TEST-${product.sku}`, null, product.stock, product.cost, new Date().toISOString().slice(0, 19).replace("T", " "));
        }
      }
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
