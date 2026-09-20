/**
 * ROUND 40 (ข้อ 32) — เครื่องมือนำเข้าข้อมูลจาก Excel/CSV
 * ---------------------------------------------------------------
 * ใช้กรณีร้านมีข้อมูลจริงอยู่ในไฟล์ Excel แล้วต้องการขึ้นระบบ:
 *   1) parseSpreadsheetBase64() — อ่านไฟล์ .xlsx/.xls/.csv → ชีต + หัวตาราง + ตัวอย่างแถว
 *   2) guessMemberMapping()/guessProductMapping() — เดาคอลัมน์จากชื่อหัวตาราง (ไทย+อังกฤษ)
 *   3) importMembers()/importProducts() — นำเข้าจริง พร้อมโหมดจัดการรายการซ้ำ (ข้าม/อัปเดตทับ)
 *   4) buildTemplateBase64() — สร้างไฟล์เทมเพลต .xlsx ให้ร้านกรอกตามรูปแบบ
 *
 * หลักความปลอดภัย: router เรียก safety backup ก่อนนำเข้าเสมอ (ดู routers.ts → importData.execute)
 * ยอดเงินสมาชิกที่นำเข้าจะบันทึกเป็นรายการ "ยอดยกมา · นำเข้าข้อมูล" ในประวัติธุรกรรมเสมอ
 * สต็อกสินค้าใหม่จะสร้าง Lot "นำเข้าข้อมูล" ให้ตรงโมเดล lots ของระบบ
 */
import * as XLSX from "xlsx";
import type { SqliteDb } from "./sqliteStore";
import { StoreError, formatDateTime, logAction, money, round2, runInTransaction } from "./sqliteStore";

export type ImportKind = "members" | "products";
export type DuplicateMode = "skip" | "replace";

/** คอลัมน์ไหนของไฟล์ map ไป field ไหน (-1 / undefined = ไม่นำเข้า field นั้น) */
export type MemberFieldMapping = {
  firstName: number;
  prename?: number;
  memberNumber?: number;
  lastName?: number;
  balance?: number;
  creditLimit?: number;
  status?: number;
  phone?: number;
  idCard?: number;
  type?: number;
  gender?: number;
};

export type ProductFieldMapping = {
  name: number;
  barcode?: number;
  sku?: number;
  category?: number;
  unit?: number;
  price?: number;
  cost?: number;
  stock?: number;
  reorderPoint?: number;
  size?: number;
};

export type ImportRowError = { row: number; message: string };
export type ImportSummary = {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: ImportRowError[];
};

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

export type ParsedSheet = {
  name: string;
  /** แถวหัวตารางที่เดาได้ (0-based) — แถวแรกจาก 10 แถวแรกที่มีค่าไม่ว่าง ≥ 2 ช่อง */
  headerRowIndex: number;
  headers: string[];
  /** แถวข้อมูลตัวอย่าง 8 แถวแรก (สำหรับพรีวิวบนหน้าจอ) */
  sampleRows: string[][];
  /** จำนวนแถวข้อมูลหลังหัวตาราง (ไม่นับแถวว่าง) */
  totalRows: number;
  suggestedMapping: { memberNumber?: number; prename?: number; firstName?: number; lastName?: number; balance?: number; creditLimit?: number; status?: number; phone?: number; idCard?: number; type?: number; gender?: number } | { name?: number; barcode?: number; sku?: number; category?: number; unit?: number; price?: number; cost?: number; stock?: number; reorderPoint?: number; size?: number } | Record<string, never>;
};

const cellToText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return formatDateTime(value);
  return String(value).trim();
};

/** หาแถวหัวตาราง: แถวแรก (ไม่เกิน 10) ที่มีค่าไม่ว่างอย่างน้อย 2 ช่อง — เลี่ยง title row ที่มีข้อความเดียว */
function detectHeaderRow(matrix: string[][]): number {
  for (let index = 0; index < Math.min(matrix.length, 10); index += 1) {
    const filled = matrix[index].filter((cell) => cell !== "").length;
    if (filled >= 2) return index;
  }
  return 0;
}

function normalizeHeaders(width: number, headerRow: string[]): string[] {
  const headers: string[] = [];
  for (let index = 0; index < width; index += 1) {
    const label = headerRow[index] ?? "";
    headers.push(label === "" ? `คอลัมน์ ${index + 1}` : label);
  }
  return headers;
}

/** อ่าน base64 → ทุกชีต พร้อมหัวตารางที่เดาไว้ + ตัวอย่างแถว (จำกัดขนาด response) · kind ใช้เดา mapping · headerRowOverride ให้ client ตั้งแถวหัวตารางเอง (ส่งซ้ำเมื่อเปลี่ยน) */
export function parseSpreadsheetBase64(base64: string, kind: ImportKind, headerRowOverride?: number): { sheets: ParsedSheet[] } {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(Buffer.from(base64, "base64"), { type: "buffer", raw: false });
  } catch {
    throw new StoreError("อ่านไฟล์ไม่สำเร็จ — รองรับ .xlsx .xls .csv เท่านั้น และไฟล์ต้องไม่เสียหาย");
  }
  const sheets = workbook.SheetNames.map((name): ParsedSheet => {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, blankrows: false, defval: null })
      .map((row) => (Array.isArray(row) ? row : [row]))
      .map((row) => row.map(cellToText));
    const headerRowIndex = headerRowOverride !== undefined ? Math.max(0, Math.min(headerRowOverride, matrix.length - 1)) : detectHeaderRow(matrix);
    const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
    const dataRows = matrix.slice(headerRowIndex + 1).filter((row) => row.some((cell) => cell !== ""));
    return {
      name,
      headerRowIndex,
      headers: normalizeHeaders(width, matrix[headerRowIndex] ?? []),
      sampleRows: dataRows.slice(0, 8).map((row) => padRow(row, width)),
      totalRows: dataRows.length,
      suggestedMapping: {},
    };
  });
  if (sheets.length === 0) throw new StoreError("ไฟล์ไม่มีชีตข้อมูล");
  return {
    sheets: sheets.map((sheet) => ({
      ...sheet,
      suggestedMapping: kind === "members" ? guessMemberMapping(sheet.headers) : guessProductMapping(sheet.headers),
    })),
  };
}

/** อ่าน base64 → แถวข้อมูลของชีตที่เลือก (ข้ามแถวหัวตารางตามที่ระบุ) — สำหรับ execute */
export function readSheetRows(base64: string, sheetName: string, headerRowIndex: number): { headers: string[]; rows: string[][] } {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(Buffer.from(base64, "base64"), { type: "buffer", raw: false });
  } catch {
    throw new StoreError("อ่านไฟล์ไม่สำเร็จ — ไฟล์อาจเสียหาย");
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new StoreError(`ไม่พบชีต "${sheetName}" ในไฟล์`);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: null })
    .map((row) => (Array.isArray(row) ? row : [row]))
    .map((row) => row.map(cellToText));
  const safeHeader = Math.max(0, Math.min(headerRowIndex, matrix.length - 1));
  const width = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const headers = normalizeHeaders(width, matrix[safeHeader] ?? []);
  const rows = matrix.slice(safeHeader + 1).filter((row) => row.some((cell) => cell !== "")).map((row) => padRow(row, width));
  return { headers, rows };
}

function padRow(row: string[], width: number): string[] {
  const padded = row.slice(0, width);
  while (padded.length < width) padded.push("");
  return padded;
}

// ---------------------------------------------------------------------------
// guess mapping จากชื่อหัวตาราง
// ---------------------------------------------------------------------------

const normalizeHeaderKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/[\s_\-().]/g, "")
    .replace(/ๆ/g, "")
    .trim();

function findHeader(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeaderKey);
  for (const alias of aliases) {
    const key = normalizeHeaderKey(alias);
    const exact = normalized.indexOf(key);
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const key = normalizeHeaderKey(alias);
    const partial = normalized.findIndex((candidate) => candidate !== "" && candidate.includes(key));
    if (partial >= 0) return partial;
  }
  return -1;
}

const MEMBER_ALIASES: Record<keyof Omit<MemberFieldMapping, "firstName">, string[]> = {
  prename: ["คำนำหน้า", "คำนำหน้าชื่อ", "คำนำหน้านาม", "นำหน้า", "คำนำ", "prename", "prefix", "title"],
  memberNumber: ["เลขสมาชิก", "หมายเลขสมาชิก", "รหัสสมาชิก", "เลขที่สมาชิก", "เลขบัญชีสมาชิก", "memberno", "membernumber", "memberid", "member"],
  lastName: ["นามสกุล", "สกุล", "surname", "lastname", "familyname"],
  balance: ["ยอดคงเหลือ", "ยอดเงินคงเหลือ", "เงินคงเหลือ", "คงเหลือ", "ยอดเงิน", "balance", "remaining", "remain", "ยอด"],
  creditLimit: ["วงเงิน", "วงเงินซื้อ", "วงเงินสินเชื่อ", "creditlimit", "limit"],
  status: ["สถานะ", "status"],
  phone: ["เบอร์โทร", "เบอร์โทรศัพท์", "โทรศัพท์", "เบอร์", "โทร", "phone", "tel", "mobile"],
  idCard: ["บัตรประชาชน", "เลขบัตรประชาชน", "รหัสบัตรประชาชน", "เลขประจำตัวประชาชน", "เลขประจำตัว", "citizenid", "idcard", "nationalid"],
  type: ["ประเภทสมาชิก", "ประเภท", "type", "membership"],
  gender: ["เพศ", "gender"],
};

const MEMBER_FIRST_NAME_ALIASES = ["ชื่อจริง", "ชื่อ", "name", "firstname", "givenname"];

const PRODUCT_ALIASES: Record<keyof Omit<ProductFieldMapping, "name">, string[]> = {
  barcode: ["บาร์โค้ด", "บาร์โคด", "barcode", "barcodeno", "gtin", "ean"],
  sku: ["รหัสสินค้า", "รหัsku", "sku", "productcode", "itemcode", "code", "รหัส"],
  category: ["หมวดหมู่", "หมวด", "กลุ่ม", "ประเภทสินค้า", "ประเภท", "category", "group"],
  unit: ["หน่วยนับ", "หน่วย", "unit", "units", "uom"],
  price: ["ราคาขาย", "ราคา", "ราคาต่อหน่วย", "price", "saleprice", "sellprice", "retailprice"],
  cost: ["ต้นทุน", "ราคาทุน", "ราคาซื้อ", "cost", "purchaseprice"],
  stock: ["สต็อกคงเหลือ", "สต็อก", "จำนวนคงเหลือ", "คงเหลือ", "จำนวนสินค้า", "จำนวน", "stock", "qty", "quantity", "onhand", "balance"],
  reorderPoint: ["จุดสั่งซื้อ", "จุดสั่ง", "reorderpoint", "reorder", "minstock"],
  size: ["ขนาด", "size", "สเปค", "spec"],
};

const PRODUCT_NAME_ALIASES = ["ชื่อสินค้า", "ชื่อ", "สินค้า", "รายการ", "productname", "name", "product", "itemname", "item", "description"];

export function guessMemberMapping(headers: string[]): Partial<MemberFieldMapping> {
  const mapping: Partial<MemberFieldMapping> = {};
  const firstName = findHeader(headers, MEMBER_FIRST_NAME_ALIASES);
  if (firstName >= 0) mapping.firstName = firstName;
  for (const [field, aliases] of Object.entries(MEMBER_ALIASES) as [keyof typeof MEMBER_ALIASES, string[]][]) {
    const index = findHeader(headers, aliases);
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

export function guessProductMapping(headers: string[]): Partial<ProductFieldMapping> {
  const mapping: Partial<ProductFieldMapping> = {};
  const name = findHeader(headers, PRODUCT_NAME_ALIASES);
  if (name >= 0) mapping.name = name;
  for (const [field, aliases] of Object.entries(PRODUCT_ALIASES) as [keyof typeof PRODUCT_ALIASES, string[]][]) {
    const index = findHeader(headers, aliases);
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

// ---------------------------------------------------------------------------
// ค่าจากเซลล์
// ---------------------------------------------------------------------------

const pick = (row: string[], column: number | undefined): string => (column === undefined || column < 0 ? "" : (row[column] ?? "").trim());

/** แปลง "1,234.50" / "฿1,234.50" / "1,234.50 บาท" → 1234.5 · คืน null ถ้าว่าง/ไม่ใช่ตัวเลข */
function parseNumberCell(text: string): number | null {
  const cleaned = text.replace(/[฿,\s]/g, "").replace(/บาท/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** integer ≥ 0 · null ถ้าว่าง/ไม่ใช่ตัวเลข */
function parseCountCell(text: string): number | null {
  const value = parseNumberCell(text);
  if (value === null) return null;
  const rounded = Math.round(value);
  return rounded >= 0 ? rounded : null;
}

function parseStatusCell(text: string): "active" | "suspended" | null {
  const key = text.toLowerCase();
  if (key === "") return null;
  if (["ระงับ", "พัก", "พักใช้งาน", "suspended", "suspend", "หยุด", "ปิด"].some((word) => key.includes(word))) return "suspended";
  return "active";
}

function parseCreditLimitCell(text: string): number | null {
  if (["", "ไม่จำกัด", "ไม่กำหนด", "none", "null", "-"].includes(text.trim())) return null;
  return parseNumberCell(text);
}

// ---------------------------------------------------------------------------
// import สมาชิก
// ---------------------------------------------------------------------------

function nextImportMemberNumber(db: SqliteDb): string {
  const row = db.prepare(`SELECT member_number AS number FROM members WHERE member_number LIKE 'M-%'`).all() as unknown as { number: string }[];
  let max = 0;
  for (const entry of row) {
    const tail = Number(entry.number.replace(/^M-/, ""));
    if (Number.isFinite(tail) && tail > max) max = tail;
  }
  return `M-${String(max + 1).padStart(6, "0")}`;
}

/** บันทึกธุรกรรมยอดยกมา/ปรับยอด — ให้ statement สมาชิกอธิบายตัวเองได้เสมอ */
function recordBalanceTransaction(db: SqliteDb, memberNumber: string, amount: number, balanceAfter: number, detail: string) {
  db.prepare(
    `INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, created_at) VALUES (?, ?, ?, ?, 'นำเข้าข้อมูล', ?, ?)`,
  ).run(memberNumber, amount >= 0 ? "deposit" : "withdrawal", detail, Math.abs(round2(amount)), round2(balanceAfter), formatDateTime());
}

export type ImportMembersOptions = {
  rows: string[][];
  mapping: MemberFieldMapping;
  duplicateMode: DuplicateMode;
  actor?: string;
  actorRole?: string;
};

export function importMembers(db: SqliteDb, options: ImportMembersOptions): ImportSummary {
  const { rows, mapping, duplicateMode, actor, actorRole } = options;
  const summary: ImportSummary = { total: rows.length, inserted: 0, updated: 0, skipped: 0, errors: [] };
  const seenNumbers = new Set<string>();
  const createdAt = formatDateTime();
  rows.forEach((row, index) => {
    const rowNumber = index + 2; // +2 = แถว Excel จริง (หัวตารางคือแถว 1)
    try {
      const firstName = pick(row, mapping.firstName);
      if (!firstName) {
        summary.errors.push({ row: rowNumber, message: "ไม่มีชื่อสมาชิก" });
        return;
      }
      const rawNumber = pick(row, mapping.memberNumber);
      let memberNumber = rawNumber;
      if (memberNumber) {
        if (seenNumbers.has(memberNumber)) {
          summary.errors.push({ row: rowNumber, message: `เลขสมาชิก ${memberNumber} ซ้ำกับแถวก่อนหน้าในไฟล์` });
          return;
        }
        seenNumbers.add(memberNumber);
      }
      const lastName = pick(row, mapping.lastName);
      const prename = pick(row, mapping.prename) || null;
      const balance = mapping.balance !== undefined ? (parseNumberCell(pick(row, mapping.balance)) ?? 0) : 0;
      const creditLimit = mapping.creditLimit !== undefined ? parseCreditLimitCell(pick(row, mapping.creditLimit)) : null;
      const status = mapping.status !== undefined ? (parseStatusCell(pick(row, mapping.status)) ?? "active") : "active";
      const phone = pick(row, mapping.phone) || null;
      const idCard = pick(row, mapping.idCard) || null;
      const type = pick(row, mapping.type) || "สมาชิก";
      const gender = pick(row, mapping.gender) || null;

      const existing = memberNumber
        ? (db.prepare(`SELECT id, balance, first_name AS firstName, last_name AS lastName FROM members WHERE member_number = ?`).get(memberNumber) as { id: number; balance: number; firstName: string; lastName: string } | undefined)
        : undefined;
      if (existing) {
        if (duplicateMode === "skip") {
          summary.skipped += 1;
          return;
        }
        runInTransaction(db, () => {
          db.prepare(
            `UPDATE members SET prename = ?, first_name = ?, last_name = ?, phone = ?, id_card = ?, type = ?, status = ?, credit_limit = ? WHERE member_number = ?`,
          ).run(prename, firstName, lastName, phone, idCard, type, status, creditLimit, memberNumber);
          if (round2(balance) !== round2(existing.balance)) {
            db.prepare(`UPDATE members SET balance = ? WHERE member_number = ?`).run(round2(balance), memberNumber);
            recordBalanceTransaction(db, memberNumber, round2(balance) - round2(existing.balance), round2(balance), `ปรับยอดตามการนำเข้าข้อมูล · เดิม ${money(existing.balance)} → ${money(round2(balance))}`);
          }
        });
        summary.updated += 1;
        return;
      }

      if (!memberNumber) {
        memberNumber = nextImportMemberNumber(db);
        while (seenNumbers.has(memberNumber)) memberNumber = `M-${String(Number(memberNumber.replace(/^M-/, "")) + 1).padStart(6, "0")}`;
        seenNumbers.add(memberNumber);
      }
      runInTransaction(db, () => {
        db.prepare(
          `INSERT INTO members (member_number, prename, first_name, last_name, id_card, phone, type, balance, status, created_at, photo_url, gender, credit_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        ).run(memberNumber, prename, firstName, lastName, idCard, phone, type, round2(balance), status, createdAt, gender, creditLimit);
        if (round2(balance) !== 0) {
          recordBalanceTransaction(db, memberNumber, round2(balance), round2(balance), `ยอดยกมา · นำเข้าข้อมูล ${round2(balance) >= 0 ? "" : "(ยอดติดลบ) "}${money(round2(balance))}`);
        }
      });
      summary.inserted += 1;
    } catch (error) {
      summary.errors.push({ row: rowNumber, message: String(error instanceof StoreError ? error.message : error) });
    }
  });
  logAction(
    db,
    "นำเข้าข้อมูลสมาชิก",
    actor?.trim() || "ผู้บริหาร",
    `เพิ่มใหม่ ${summary.inserted} · อัปเดต ${summary.updated} · ข้าม ${summary.skipped} · ผิดพลาด ${summary.errors.length}`,
    "purple",
    actorRole ?? null,
  );
  return summary;
}

// ---------------------------------------------------------------------------
// import สินค้า
// ---------------------------------------------------------------------------

const IMPORT_SKU_PREFIXES: Record<string, string> = { "เครื่องดื่ม": "DRK", "อาหาร": "FD", "ของใช้": "HYG", "ขนม": "SNK" };

function nextImportSku(db: SqliteDb, category: string): string {
  const prefix = IMPORT_SKU_PREFIXES[category] ?? "GEN";
  const rows = db.prepare(`SELECT sku FROM products WHERE sku LIKE ?`).all(`${prefix}-%`) as unknown as { sku: string }[];
  const used = new Set(rows.map((row) => row.sku));
  let sequence = rows.length + 1;
  while (used.has(`${prefix}-${String(sequence).padStart(3, "0")}`)) sequence += 1;
  return `${prefix}-${String(sequence).padStart(3, "0")}`;
}

export type ImportProductsOptions = {
  rows: string[][];
  mapping: ProductFieldMapping;
  duplicateMode: DuplicateMode;
  actor?: string;
  actorRole?: string;
};

export function importProducts(db: SqliteDb, options: ImportProductsOptions): ImportSummary {
  const { rows, mapping, duplicateMode, actor, actorRole } = options;
  const summary: ImportSummary = { total: rows.length, inserted: 0, updated: 0, skipped: 0, errors: [] };
  const seenKeys = new Set<string>();
  const createdAt = formatDateTime();
  const lotLabel = `นำเข้าข้อมูล`;
  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      const name = pick(row, mapping.name);
      if (!name) {
        summary.errors.push({ row: rowNumber, message: "ไม่มีชื่อสินค้า" });
        return;
      }
      const barcode = pick(row, mapping.barcode) || null;
      const sku = pick(row, mapping.sku) || null;
      // ลงทะเบียนกุญแจทันทีหลัง parse — แม้แถวนี้จะ error ใน validation ทีหลัง
      // แถวถัดไปที่ซ้ำกับแถว error ก็ยังนับเป็น "ซ้ำในไฟล์"
      const barcodeKey = barcode ? `B:${barcode}` : "";
      const skuKey = sku ? `S:${sku}` : "";
      const nameKey = `N:${name.toLowerCase()}`;
      for (const key of [barcodeKey, skuKey, nameKey]) {
        if (key && seenKeys.has(key)) {
          summary.errors.push({ row: rowNumber, message: `สินค้า "${name}" ซ้ำกับแถวก่อนหน้าในไฟล์` });
          return;
        }
      }
      for (const key of [barcodeKey, skuKey, nameKey]) if (key) seenKeys.add(key);
      const category = pick(row, mapping.category) || "อื่นๆ";
      const unit = pick(row, mapping.unit) || "ชิ้น";
      const price = mapping.price !== undefined ? (parseNumberCell(pick(row, mapping.price)) ?? 0) : 0;
      if (price < 0) {
        summary.errors.push({ row: rowNumber, message: `ราคาขายต้องไม่ติดลบ (พบ ${pick(row, mapping.price)})` });
        return;
      }
      const cost = mapping.cost !== undefined ? (parseNumberCell(pick(row, mapping.cost)) ?? 0) : 0;
      const stock = mapping.stock !== undefined ? (parseCountCell(pick(row, mapping.stock)) ?? 0) : 0;
      const reorderPoint = mapping.reorderPoint !== undefined ? (parseCountCell(pick(row, mapping.reorderPoint)) ?? 10) : 10;
      const size = pick(row, mapping.size) || null;

      // กุญแจตรวจซ้ำ: บาร์โค้ด → SKU → ชื่อ (ตัดช่องว่าง)
      const existing = db
        .prepare(
          `SELECT id, stock, name FROM products WHERE ${barcode ? "barcode = ?" : "1 = 0"} OR ${sku ? "sku = ?" : "1 = 0"} OR LOWER(TRIM(name)) = LOWER(TRIM(?)) ORDER BY id LIMIT 1`,
        )
        .get(...(barcode ? [barcode] : []), ...(sku ? [sku] : []), name) as { id: number; stock: number; name: string } | undefined;
      if (existing) {
        if (duplicateMode === "skip") {
          summary.skipped += 1;
          return;
        }
        runInTransaction(db, () => {
          db.prepare(
            `UPDATE products SET name = ?, barcode = COALESCE(?, barcode), category = ?, unit = ?, price = ?, cost = ?, reorder_point = ?, size = COALESCE(?, size) WHERE id = ?`,
          ).run(name, barcode, category, unit, round2(price), round2(cost), reorderPoint, size, existing.id);
          if (stock !== existing.stock) {
            db.prepare(`UPDATE products SET stock = ? WHERE id = ?`).run(stock, existing.id);
            logAction(db, "ปรับสต็อกจากการนำเข้า", actor?.trim() || "ผู้บริหาร", `${name} · เดิม ${existing.stock} → ${stock} ${unit}`, existing.stock > stock ? "red" : "green", actorRole ?? null);
          }
        });
        summary.updated += 1;
        return;
      }

      const finalSku = sku && !db.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku) ? sku : nextImportSku(db, category);
      runInTransaction(db, () => {
        const result = db
          .prepare(
            `INSERT INTO products (sku, barcode, name, category, emoji, color, size, image_url, unit, price, cost, stock, reorder_point, quick_pick, sell_mode, price_tiers, active, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?, 0, 'unit', NULL, 1, ?)`,
          )
          .run(finalSku, barcode, name, category, size, unit, round2(price), round2(cost), stock, reorderPoint, createdAt);
        if (stock > 0) {
          db.prepare(`INSERT INTO stock_lots (product_id, lot, expiry_date, qty, cost, received_at) VALUES (?, ?, NULL, ?, ?, ?)`).run(
            Number(result.lastInsertRowid),
            lotLabel,
            stock,
            round2(cost),
            createdAt,
          );
        }
      });
      summary.inserted += 1;
    } catch (error) {
      summary.errors.push({ row: rowNumber, message: String(error instanceof StoreError ? error.message : error) });
    }
  });
  logAction(
    db,
    "นำเข้าข้อมูลสินค้า",
    actor?.trim() || "ผู้บริหาร",
    `เพิ่มใหม่ ${summary.inserted} · อัปเดต ${summary.updated} · ข้าม ${summary.skipped} · ผิดพลาด ${summary.errors.length}`,
    "purple",
    actorRole ?? null,
  );
  return summary;
}

// ---------------------------------------------------------------------------
// เทมเพลต
// ---------------------------------------------------------------------------

const MEMBER_TEMPLATE_HEADERS = ["เลขสมาชิก", "คำนำหน้า", "ชื่อ", "นามสกุล", "ยอดคงเหลือ", "วงเงิน", "สถานะ", "เบอร์โทร", "บัตรประชาชน", "ประเภท", "เพศ"];
const MEMBER_TEMPLATE_ROWS = [
  ["M-000001", "นาย", "สมชาย", "ใจดี", "1500", "", "ปกติ", "0812345678", "3101234567890", "สมาชิก", "ชาย"],
  ["M-000002", "นางสาว", "สมหญิง", "มั่นคง", "320.50", "500", "ปกติ", "0898765432", "", "สมาชิก", "หญิง"],
  ["", "", "อนันต์", "ศรีสุข", "0", "", "ระงับ", "", "", "สมาชิกพิเศษ", ""],
];

const PRODUCT_TEMPLATE_HEADERS = ["บาร์โค้ด", "ชื่อสินค้า", "หมวด", "หน่วย", "ราคาขาย", "ต้นทุน", "สต็อกคงเหลือ", "จุดสั่งซื้อ"];
const PRODUCT_TEMPLATE_ROWS = [
  ["8850000000017", "น้ำดื่มคริสตัล 600 มล.", "เครื่องดื่ม", "ขวด", "7", "5", "48", "12"],
  ["8850000000024", "ขนมปังโฮลวีท", "อาหาร", "ถุง", "25", "18", "10", "5"],
  ["", "น้ำแข็งหลอด", "อื่นๆ", "ถุง", "5", "3", "20", "5"],
];

/** สร้างไฟล์เทมเพลต .xlsx (base64) ให้ร้านกรอกตาม — ดาวน์โหลดผ่านปุ่มในหน้าตั้งค่า */
export function buildTemplateBase64(kind: ImportKind): { fileName: string; base64: string } {
  const isMembers = kind === "members";
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([isMembers ? MEMBER_TEMPLATE_HEADERS : PRODUCT_TEMPLATE_HEADERS, ...(isMembers ? MEMBER_TEMPLATE_ROWS : PRODUCT_TEMPLATE_ROWS)]);
  XLSX.utils.book_append_sheet(workbook, worksheet, isMembers ? "สมาชิก" : "สินค้า");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return {
    fileName: `template-${kind}-${stamp}.xlsx`,
    base64: Buffer.from(buffer).toString("base64"),
  };
}
