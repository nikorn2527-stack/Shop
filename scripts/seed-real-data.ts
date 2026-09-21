/**
 * ROUND 65 (user) — ตั้งค่าระบบทดสอบร้านค้าสวัสดิการด้วยข้อมูลจริง
 *
 * สิ่งที่สคริปต์นี้ทำ (รันด้วย: corepack pnpm tsx scripts/seed-real-data.ts [--yes])
 *  1. สำรองฐานข้อมูลปัจจุบันไป data/backups/seed-backup-<เวลา>.sqlite เสมอ (ก่อนแตะข้อมูล)
 *  2. ล้างข้อมูลเดิมทั้งหมดที่เกี่ยวกับการขาย (สินค้า สต๊อก บิล สมาชิก ธุรกรรม รอบตัดยอด log)
 *     — ไม่แตะบัญชีผู้ใช้ระบบและการตั้งค่าร้าน/ลิขสิทธิ์ที่มีอยู่
 *  3. นำเข้าสินค้าจริง 120 รายการจากชีท "รายงานสินค้าคงคลัง 17 กันยายน 2569"
 *     พร้อมยอดยกมา (รับเข้าเป็น Lot เมื่อ 16 ก.ย. เพื่อให้รายงานยอดยกมา/ยอดขาย/คงเหลือตรงชีท)
 *  4. สร้างบัญชีเจ้าหน้าที่ 3 คน (นายนิกร / นายอุดร / นายกฤษฎา) ถ้ายังไม่มี
 *  5. สร้างสมาชิกทดสอบ 16 คน (ชาย 8 · หญิง 8) พร้อมรหัสบัตร/รหัสผู้ป่วยสมมุติ
 *     และยอดเปิดบัตรตามแบบชีท "ยอดเงินในบัตร" (ไม่ใช่ข้อมูลผู้ป่วยจริง)
 *  6. สร้างรายการทุกประเภทตั้งแต่ 17 กันยายน 2569 ถึงวันนี้: ขายสินค้า (เงินสด/QR/หักบัญชี)
 *     · เติมเงิน · ลดยอดเงิน (ถอน) · คืนบัตรเงินสด · เปิดใช้บัตร · ตัดยอดประจำวัน
 *
 * รันบนเครื่องร้าน: หยุดโปรแกรมก่อน → corepack pnpm tsx scripts/seed-real-data.ts → เปิดใหม่
 * ระวัง: ขั้นตอนที่ 2 ลบข้อมูลขาย/สมาชิกทั้งหมด สำรองไว้ก่อนเสมอแล้ว (ขั้นตอนที่ 1)
 */
import "dotenv/config"; // ROUND 66 — โหลด .env เหมือนที่ server ทำ ให้ SQLITE_DB_PATH ชี้ไฟล์เดียวกัน
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, scryptSync } from "node:crypto";
import { createSqliteStore } from "../server/sqliteStore";
import { SEED_PRODUCTS } from "./seed-data-products";

const args = process.argv.slice(2);
const autoYes = args.includes("--yes");
const dbPath = process.env.SQLITE_DB_PATH || "data/welfare-store.sqlite";

// --- ข้อมูลคน (ตั้งชื่อเองสำหรับงานทดสอบ — ไม่ใช่ผู้ป่วยจริง) -------------------

const STAFF = [
  { username: "nikorn", displayName: "นายนิกร พันโนนงิ้ว" },
  { username: "udon", displayName: "นายอุดร แสงจันทร์" },
  { username: "kritsada", displayName: "นายกฤษฎา สารีโท" },
];
const STAFF_PASSWORD = "Shop2569";

type SeedMember = {
  prename: string; firstName: string; lastName: string; gender: "ชาย" | "หญิง";
  cardNumber: string; patientCode: string; phone: string;
  /** วันที่เปิดใช้บัตร (ลงทะเบียน) */
  openedAt: string; activation: number;
  /** รายการก่อน 17 ก.ย. เพื่อให้ ยอดทั้งหมด/ยอดจ่าย ต่างจากคงเหลือเหมือนชีทจริง */
  preHistory: { daysBefore: number; type: "deposit" | "purchase"; amount: number; detail: string }[];
  /** ยอดคงเหลือ ณ ค่ำวันที่ 16 ก.ย. (คำนวณสด) */
};

const MEMBERS: SeedMember[] = [
  { prename: "นาย", firstName: "สมชาย", lastName: "ใจดี", gender: "ชาย", cardNumber: "2395100201", patientCode: "70001", phone: "081-234-5001", openedAt: "2026-04-25 10:12:00", activation: 5000, preHistory: [{ daysBefore: 120, type: "purchase", amount: 640, detail: "ซื้อของใช้ที่ร้าน" }, { daysBefore: 60, type: "deposit", amount: 1000, detail: "เติมเงินสดที่เคาน์เตอร์" }, { daysBefore: 21, type: "purchase", amount: 425, detail: "ซื้อของใช้ที่ร้าน" }] },
  { prename: "นาย", firstName: "มานะ", lastName: "ตั้งใจดี", gender: "ชาย", cardNumber: "2395100202", patientCode: "70002", phone: "081-234-5002", openedAt: "2026-05-12 09:30:00", activation: 1000, preHistory: [{ daysBefore: 90, type: "deposit", amount: 500, detail: "เติมเงินสดที่เคาน์เตอร์" }, { daysBefore: 30, type: "purchase", amount: 996, detail: "ซื้อของใช้ที่ร้าน" }] },
  { prename: "นาย", firstName: "ประเสริฐ", lastName: "ศรีสุข", gender: "ชาย", cardNumber: "2395100203", patientCode: "70003", phone: "082-345-6003", openedAt: "2026-05-28 13:45:00", activation: 2000, preHistory: [{ daysBefore: 75, type: "purchase", amount: 1496, detail: "ซื้อของใช้ที่ร้าน" }] },
  { prename: "นาย", firstName: "วิชัย", lastName: "รักดี", gender: "ชาย", cardNumber: "2395100204", patientCode: "70004", phone: "082-345-6004", openedAt: "2026-06-15 08:20:00", activation: 10000, preHistory: [{ daysBefore: 50, type: "deposit", amount: 2000, detail: "เติมเงินสดที่เคาน์เตอร์" }, { daysBefore: 45, type: "purchase", amount: 10_204, detail: "ซื้อของใช้ที่ร้าน" }] },
  { prename: "นาย", firstName: "ธนกร", lastName: "ใจงาม", gender: "ชาย", cardNumber: "2395100205", patientCode: "70005", phone: "083-456-7005", openedAt: "2026-07-02 15:05:00", activation: 500, preHistory: [] },
  { prename: "นาย", firstName: "พิชัย", lastName: "ชาญชัย", gender: "ชาย", cardNumber: "2395100206", patientCode: "70006", phone: "083-456-7006", openedAt: "2026-07-19 11:40:00", activation: 1500, preHistory: [{ daysBefore: 40, type: "purchase", amount: 1218, detail: "ซื้อของใช้ที่ร้าน" }] },
  { prename: "นาย", firstName: "อดุลย์", lastName: "สุขเกษม", gender: "ชาย", cardNumber: "2395100207", patientCode: "70007", phone: "084-567-8007", openedAt: "2026-08-05 10:00:00", activation: 1000, preHistory: [] },
  { prename: "นาย", firstName: "กิตติ", lastName: "พงษ์ไทย", gender: "ชาย", cardNumber: "2395100208", patientCode: "70008", phone: "084-567-8008", openedAt: "2026-08-21 14:25:00", activation: 3000, preHistory: [{ daysBefore: 15, type: "deposit", amount: 1000, detail: "เติมเงินสดที่เคาน์เตอร์" }, { daysBefore: 10, type: "purchase", amount: 2450, detail: "ซื้อของใช้ที่ร้าน" }] },
  { prename: "นางสาว", firstName: "มาลี", lastName: "ใจดี", gender: "หญิง", cardNumber: "2395100209", patientCode: "70009", phone: "085-678-9009", openedAt: "2026-04-30 09:15:00", activation: 1000, preHistory: [{ daysBefore: 100, type: "deposit", amount: 1495, detail: "เติมเงินสดที่เคาน์เตอร์" }, { daysBefore: 55, type: "purchase", amount: 896, detail: "ซื้อของใช้ที่ร้าน" }] },
  { prename: "นางสาว", firstName: "สมศรี", lastName: "สุขสวัสดิ์", gender: "หญิง", cardNumber: "2395100210", patientCode: "70010", phone: "085-678-9010", openedAt: "2026-05-20 10:50:00", activation: 2000, preHistory: [{ daysBefore: 80, type: "purchase", amount: 3096, detail: "ซื้อของใช้ที่ร้าน" }, { daysBefore: 25, type: "deposit", amount: 500, detail: "เติมเงินสดที่เคาน์เตอร์" }] },
  { prename: "นางสาว", firstName: "ปิ่นทอง", lastName: "แสงทอง", gender: "หญิง", cardNumber: "2395100211", patientCode: "70011", phone: "086-789-1011", openedAt: "2026-06-08 16:30:00", activation: 500, preHistory: [{ daysBefore: 65, type: "deposit", amount: 500, detail: "เติมเงินสดที่เคาน์เตอร์" }] },
  { prename: "นางสาว", firstName: "กนกพร", lastName: "รุ่งเรือง", gender: "หญิง", cardNumber: "2395100212", patientCode: "70012", phone: "086-789-1012", openedAt: "2026-06-24 08:45:00", activation: 1500, preHistory: [{ daysBefore: 48, type: "purchase", amount: 504, detail: "ซื้อของใช้ที่ร้าน" }] },
  { prename: "นาง", firstName: "อรุณี", lastName: "ทองดี", gender: "หญิง", cardNumber: "2395100213", patientCode: "70013", phone: "087-890-2013", openedAt: "2026-07-11 13:20:00", activation: 1000, preHistory: [] },
  { prename: "นางสาว", firstName: "พรทิพย์", lastName: "วงศ์สุวรรณ", gender: "หญิง", cardNumber: "2395100214", patientCode: "70014", phone: "087-890-2014", openedAt: "2026-09-17 09:05:00", activation: 1000, preHistory: [] },
  { prename: "นางสาว", firstName: "ลออทิพย์", lastName: "ใจดี", gender: "หญิง", cardNumber: "2395100215", patientCode: "70015", phone: "088-901-3015", openedAt: "2026-09-18 10:15:00", activation: 500, preHistory: [] },
  { prename: "นางสาว", firstName: "จิราพร", lastName: "แสงจันทร์", gender: "หญิง", cardNumber: "2395100216", patientCode: "70016", phone: "088-901-3016", openedAt: "2026-09-20 15:40:00", activation: 2000, preHistory: [] },
];

// --- ตัวช่วยเวลา (คำนวณสดเพื่อให้ "ตั้งแต่ 17 ก.ย. เป็นต้นมา" ครอบคลุมถึงวันรัน) ----

const now = new Date();
function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmt(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
/** วันแรกของข้อมูล: 17 กันยายนปีนี้ (ถ้าวันนี้ยังไม่ถึง 17 ก.ย. ใช้ปีที่แล้ว) */
const periodStart = new Date(now.getFullYear(), 8, 17) <= now ? new Date(now.getFullYear(), 8, 17) : new Date(now.getFullYear() - 1, 8, 17);
/** วันที่รับสินค้าเข้าเป็น Lot ยกมา = วันก่อนเริ่มรายการ */
const lotReceivedAt = new Date(periodStart.getTime() - 86_400_000);
function dayAt(offset: number, h: number, m: number) {
  const d = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate() + offset, h, m, 0);
  return d > now ? null : d;
}

// --- ตัวเลขสุ่มแบบคงที่ (ทุกครั้งที่รันได้ข้อมูลชุดเดิม) ---------------------------

let seed = 20260917;
function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
function pick<T>(list: T[]): T { return list[Math.floor(rnd() * list.length)]; }
function randInt(min: number, max: number) { return min + Math.floor(rnd() * (max - min + 1)); }

function confirmExit(message: string) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

// --- เริ่มสคริปต์ ------------------------------------------------------------

async function main() {
  console.log("=== ตั้งข้อมูลทดสอบร้านค้าสวัสดิการ (Round 65) ===");
  console.log(`ฐานข้อมูล: ${dbPath}`);
  if (!existsSync(dbPath)) {
    console.log("• ยังไม่มีฐานข้อมูล — จะสร้างใหม่ (ฐานข้อมูลเปล่า)");
  }

  if (!autoYes) {
    console.log("\nคำเตือน: สคริปต์นี้จะลบข้อมูลสินค้า/สต๊อก/บิล/สมาชิก/ธุรกรรมทั้งหมด แล้วใส่ข้อมูลทดสอบชุดใหม่");
    console.log("         (บัญชีผู้ใช้ระบบ การตั้งค่าร้าน และลิขสิทธิ์ที่มีอยู่จะถูกเก็บไว้ · สำรองไฟล์ก่อนเสมอ)");
    const answer = await new Promise<string>((resolve) => {
      process.stdout.write("พิมพ์ Y เพื่อยืนยัน: ");
      process.stdin.once("data", (data) => resolve(String(data).trim().toUpperCase()));
    });
    if (answer !== "Y") confirmExit("ยกเลิก — ไม่มีการแตะข้อมูลใด ๆ");
  }

  // ขั้น 1 — สำรองฐานข้อมูลเดิม
  if (existsSync(dbPath)) {
    const backupDir = join("data", "backups");
    mkdirSync(backupDir, { recursive: true });
    const stamp = fmtDate(now).replaceAll("-", "") + "-" + pad2(now.getHours()) + pad2(now.getMinutes());
    const backupPath = join(backupDir, `seed-backup-${stamp}.sqlite`);
    copyFileSync(dbPath, backupPath);
    console.log(`✔ สำรองฐานข้อมูลเดิมไป: ${backupPath}`);
    pruneOldSeedBackups(backupDir);
  } else {
    mkdirSync("data", { recursive: true });
  }

  // เปิดฐานข้อมูล (createSqliteStore ใช้ migration ปัจจุบัน: มีคอลัมน์ card_number/
  // patient_code และชนิดธุรกรรม 5 แบบรวม activation/refund)
  const db = createSqliteStore(dbPath);

  // ขั้น 2 — ล้างข้อมูลการขายเดิม (เก็บ app_users + store_settings)
  db.exec(`
    DELETE FROM sale_items;
    DELETE FROM sales;
    DELETE FROM member_transactions;
    DELETE FROM members;
    DELETE FROM order_list_items;
    DELETE FROM stock_lots;
    DELETE FROM products;
    DELETE FROM day_closures;
    DELETE FROM limit_requests;
    DELETE FROM audit_logs;
  `);
  console.log("✔ ล้างข้อมูลการขาย/สมาชิก/สต๊อกเดิม (บัญชีผู้ใช้และการตั้งค่าถูกเก็บไว้)");

  // ขั้น 3 — สินค้าจริง 120 รายการ + ยอดยกมา (Lot 16 ก.ย.)
  const insertProduct = db.prepare(`INSERT INTO products (sku, barcode, name, category, emoji, unit, price, cost, stock, reorder_point, active, quick_pick, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
  const insertLot = db.prepare(`INSERT INTO stock_lots (product_id, lot, expiry_date, qty, cost, received_at, received_qty) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const productIds: { id: number; name: string; unit: string; price: number; cost: number; stock: number }[] = [];
  db.exec("BEGIN");
  for (const product of SEED_PRODUCTS) {
    const result = insertProduct.run(product.sku, product.barcode, product.name, product.category, product.emoji, product.unit, product.price, product.cost, product.opening, product.opening >= 40 ? 15 : 10, product.quickPick, fmt(lotReceivedAt));
    const productId = Number(result.lastInsertRowid);
    // สินค้าบางประเภทหมดอายุไว: อาหาร/นม 90 วัน · ขนม 120 วัน · เครื่องสำอาง 540 วัน
    const expiryDays = product.category === "อาหาร" ? 90 : product.category === "เครื่องดื่ม" ? 120 : product.category === "ขนม" ? 150 : null;
    const expiry = expiryDays ? new Date(lotReceivedAt.getTime() + expiryDays * 86_400_000) : null;
    insertLot.run(productId, `LOT-${fmtDate(lotReceivedAt).replaceAll("-", "").slice(2)}`, expiry ? fmtDate(expiry) : null, product.opening, product.cost, fmt(lotReceivedAt), product.opening);
    productIds.push({ id: productId, name: product.name, unit: product.unit, price: product.price, cost: product.cost, stock: product.opening });
  }
  db.exec("COMMIT");
  console.log(`✔ นำเข้าสินค้า ${SEED_PRODUCTS.length} รายการ (ยอดยกมารวม ${SEED_PRODUCTS.reduce((s, p) => s + p.opening, 0).toLocaleString("th-TH")} ชิ้น จากชีท 17 ก.ย.)`);

  // ขั้น 4 — เจ้าหน้าที่ 3 คน (ถ้ายังไม่มีชื่อผู้ใช้นี้)
  const staffRows = STAFF.map((staff) => {
    const existing = db.prepare(`SELECT id, display_name AS displayName FROM app_users WHERE LOWER(username) = LOWER(?)`).get(staff.username) as { id: number; displayName: string } | undefined;
    return existing ?? { id: 0, displayName: staff.displayName };
  });
  for (let i = 0; i < STAFF.length; i += 1) {
    if (staffRows[i].id === 0) {
      const result = db.prepare(`INSERT INTO app_users (username, password_hash, display_name, role, active, created_at, must_change_password) VALUES (?, ?, ?, 'staff', 1, ?, 0)`).run(STAFF[i].username, hashPassword(STAFF_PASSWORD), STAFF[i].displayName, fmt(now));
      staffRows[i] = { id: Number(result.lastInsertRowid), displayName: STAFF[i].displayName };
      console.log(`✔ เพิ่มบัญชีเจ้าหน้าที่: ${STAFF[i].username} (${STAFF[i].displayName}) — รหัสผ่าน ${STAFF_PASSWORD}`);
    } else {
      console.log(`• บัญชี ${STAFF[i].username} (${staffRows[i].displayName}) มีอยู่แล้ว — ใช้ของเดิม`);
    }
  }
  const cashierNames = STAFF.map((s) => s.displayName);

  // ขั้น 4.5 — ฐานข้อมูลใหม่ที่ยังไม่มีผู้ใช้เลย: สร้างบัญชีผู้บริหาร (owner) พร้อม
  // การตั้งค่าร้านเบื้องต้น เพื่อให้เปิดโปรแกรมแล้วเข้าใช้งานได้ทันที (เครื่องที่มี
  // บัญชีอยู่แล้วจะข้ามส่วนนี้ทั้งหมด — ไม่แตะของเดิม)
  const userCount = (db.prepare(`SELECT COUNT(*) AS count FROM app_users`).get() as { count: number }).count;
  if (userCount === 0) {
    db.prepare(`INSERT INTO app_users (username, password_hash, display_name, role, active, created_at, must_change_password) VALUES ('owner', ?, 'ผู้บริหารร้านค้า', 'admin', 1, ?, 0)`).run(hashPassword("NewPass2568"), fmt(now));
    const settings = db.prepare(`INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    settings.run("store_name", "ร้านค้าสวัสดิการโรงพยาบาล");
    settings.run("promptpay_id", "0812345678");
    console.log("✔ ฐานข้อมูลใหม่ — สร้างบัญชีผู้บริหาร: owner / NewPass2568 (แนะนำเปลี่ยนรหัสทันทีที่เริ่มใช้งานจริง)");
  }

  // ขั้น 5 — สมาชิกทดสอบ 16 คน + ประวัติก่อน 17 ก.ย.
  const memberNumbers: string[] = [];
  const memberBalances = new Map<string, number>();
  for (let i = 0; i < MEMBERS.length; i += 1) {
    const m = MEMBERS[i];
    const memberNumber = `M-${String(i + 1).padStart(6, "0")}`;
    let balance = m.activation;
    db.exec("BEGIN");
    db.prepare(`INSERT INTO members (member_number, prename, first_name, last_name, phone, type, balance, status, created_at, gender, card_number, patient_code) VALUES (?, ?, ?, ?, ?, 'สมาชิก', ?, 'active', ?, ?, ?, ?)`)
      .run(memberNumber, m.prename, m.firstName, m.lastName, m.phone, 0, m.openedAt, m.gender, m.cardNumber, m.patientCode);
    db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, actor, created_at) VALUES (?, 'activation', ?, ?, 'เงินสด', ?, ?, ?)`)
      .run(memberNumber, "เปิดใช้บัตร · เงินเริ่มต้นตอนลงทะเบียน · เงินสด", m.activation, m.activation, cashierNames[0], m.openedAt);
    for (const entry of m.preHistory) {
      // daysBefore = จำนวนวันหลังเปิดบัตร (กันเลย 17 ก.ย.: อัดให้จบก่อนต้นช่วง)
      const openedMs = new Date(`${m.openedAt.replace(" ", "T")}`).getTime();
      const rawAt = openedMs + entry.daysBefore * 86_400_000;
      const capMs = periodStart.getTime() - 86_400_000;
      const at = new Date(Math.min(rawAt, capMs));
      if (entry.type === "deposit") {
        balance += entry.amount;
        db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, actor, created_at) VALUES (?, 'deposit', ?, ?, 'เงินสด', ?, ?, ?)`)
          .run(memberNumber, entry.detail, entry.amount, round2(balance), cashierNames[randInt(0, 2)], fmt(at));
      } else {
        balance -= entry.amount;
        db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, actor, created_at) VALUES (?, 'purchase', ?, ?, 'หักบัญชีสมาชิก', ?, ?, ?)`)
          .run(memberNumber, entry.detail, -entry.amount, round2(balance), cashierNames[randInt(0, 2)], fmt(at));
      }
    }
    db.prepare(`UPDATE members SET balance = ? WHERE member_number = ?`).run(round2(balance), memberNumber);
    db.exec("COMMIT");
    memberNumbers.push(memberNumber);
    memberBalances.set(memberNumber, round2(balance));
  }
  console.log(`✔ สร้างสมาชิกทดสอบ ${MEMBERS.length} คน (ชาย 8 · หญิง 8 · 3 คนเปิดบัตรช่วง 17-20 ก.ย.)`);

  // ขั้น 6 — รายการตั้งแต่ 17 ก.ย. ถึงวันนี้ (ทุกประเภท)
  const daysToFill = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - periodStart.getTime()) / 86_400_000);
  let orderSeqByDay = new Map<number, number>();
  const insertSale = db.prepare(`INSERT INTO sales (order_number, payment_method, member_number, subtotal, discount, total, cashier, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)`);
  const insertSaleItem = db.prepare(`INSERT INTO sale_items (sale_id, product_id, name, qty, price, cost, unit) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const updateStock = db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`);
  const updateLot = db.prepare(`UPDATE stock_lots SET qty = qty - ? WHERE id = (SELECT id FROM stock_lots WHERE product_id = ? AND qty > 0 ORDER BY (expiry_date IS NULL), expiry_date, received_at, id LIMIT 1)`);
  const insertTx = db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertAudit = db.prepare(`INSERT INTO audit_logs (action, actor, detail, tone, created_at) VALUES (?, ?, ?, ?, ?)`);
  const insertClosure = db.prepare(`INSERT INTO day_closures (period_start, closed_at, bills, pieces, revenue, cash_total, qr_total, wallet_total, deposits, withdrawals, closed_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const lotIdByProduct = new Map<number, number>();
  for (const row of db.prepare(`SELECT id, product_id FROM stock_lots`).all() as unknown as { id: number; product_id: number }[]) {
    lotIdByProduct.set(row.product_id, row.id);
  }

  const walletMembers = memberNumbers.filter((_, i) => (memberBalances.get(memberNumbers[i]) ?? 0) > 100);
  const money = (n: number) => `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const summarize = (items: { name: string; qty: number; unit: string }[]) => items.slice(0, 3).map((item) => `${item.name} ${item.qty} ${item.unit}`).join(", ") + (items.length > 3 ? ` และอีก ${items.length - 3} รายการ` : "");

  db.exec("BEGIN");
  let saleCount = 0;
  let depositCount = 0;
  let withdrawCount = 0;
  let refundCount = 0;
  for (let day = 0; day <= daysToFill; day += 1) {
    const billsToday = day === daysToFill ? randInt(3, 4) : randInt(5, 7);
    const dayStats = { bills: 0, pieces: 0, revenue: 0, cash: 0, qr: 0, wallet: 0, deposits: 0, withdrawals: 0 };
    orderSeqByDay.set(day, 0);

    // 6.2 เติมเงิน (ลดยอดเงิน = ถอน · คืนบัตรเงินสด = refund)
    const depositsToday = day === 0 ? 2 : day === daysToFill ? 1 : randInt(1, 3);
    for (let d = 0; d < depositsToday; d += 1) {
      const at = dayAt(day, randInt(9, 16), randInt(0, 59));
      if (!at) break;
      const memberNumber = pick(memberNumbers);
      const amount = pick([300, 500, 500, 1000, 1000, 1495, 2000]);
      const before = memberBalances.get(memberNumber) ?? 0;
      const after = round2(before + amount);
      memberBalances.set(memberNumber, after);
      insertTx.run(memberNumber, "deposit", "เติมเงินเข้าบัญชีสมาชิก · เงินสด", amount, "เงินสด", after, cashierNames[(day + d) % 3], fmt(at));
      insertAudit.run("เติมเงินสมาชิก", cashierNames[(day + d) % 3], `${memberNumber} · ${money(amount)} · เงินสด`, "green", fmt(at));
      dayStats.deposits = round2(dayStats.deposits + amount);
      depositCount += 1;
    }    // 6.1 บิลขาย
    for (let bill = 0; bill < billsToday; bill += 1) {
      const at = dayAt(day, randInt(8, day === daysToFill ? 11 : 19), randInt(0, 59));
      if (!at) break;
      const cashier = cashierNames[(day + bill) % cashierNames.length];
      const roll = rnd();
      const paymentMethod = roll < 0.5 ? "เงินสด" : roll < 0.75 ? "QR / สแกน" : "หักบัญชีสมาชิก";
      let memberNumber: string | null = null;
      if (paymentMethod === "หักบัญชีสมาชิก") {
        const candidates = walletMembers.filter((mn) => (memberBalances.get(mn) ?? 0) > 60);
        if (candidates.length === 0) continue;
        memberNumber = pick(candidates);
      } else if (rnd() < 0.3) {
        memberNumber = pick(memberNumbers);
      }
      const lineCount = randInt(1, 4);
      const lines: { productId: number; name: string; unit: string; qty: number; price: number; cost: number }[] = [];
      for (let line = 0; line < lineCount; line += 1) {
        const product = pick(productIds.filter((p) => p.stock > 2));
        const qty = randInt(1, 3);
        if (product && !lines.some((l) => l.productId === product.id)) {
          lines.push({ productId: product.id, name: product.name, unit: product.unit, qty, price: product.price, cost: product.cost });
        }
      }
      if (lines.length === 0) continue;
      const subtotal = round2(lines.reduce((sum, line) => sum + line.price * line.qty, 0));
      if (paymentMethod === "หักบัญชีสมาชิก" && (memberBalances.get(memberNumber!) ?? 0) < subtotal) continue;

      const seq = (orderSeqByDay.get(day) ?? 0) + 1;
      orderSeqByDay.set(day, seq);
      const orderNumber = `RC-${String(at.getFullYear()).slice(2)}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}-${String(seq).padStart(3, "0")}`;
      const saleResult = insertSale.run(orderNumber, paymentMethod, memberNumber, subtotal, subtotal, cashier, fmt(at));
      const saleId = Number(saleResult.lastInsertRowid);
      for (const line of lines) {
        insertSaleItem.run(saleId, line.productId, line.name, line.qty, line.price, line.cost, line.unit);
        updateStock.run(line.qty, line.productId);
        const lotId = lotIdByProduct.get(line.productId);
        if (lotId) updateLot.run(line.qty, line.productId);
        const product = productIds.find((p) => p.id === line.productId);
        if (product) product.stock -= line.qty;
        dayStats.pieces += line.qty;
      }
      dayStats.bills += 1;
      dayStats.revenue = round2(dayStats.revenue + subtotal);
      if (paymentMethod === "เงินสด") dayStats.cash = round2(dayStats.cash + subtotal);
      else if (paymentMethod === "QR / สแกน") dayStats.qr = round2(dayStats.qr + subtotal);
      else {
        dayStats.wallet = round2(dayStats.wallet + subtotal);
        const before = memberBalances.get(memberNumber!) ?? 0;
        const after = round2(before - subtotal);
        memberBalances.set(memberNumber!, after);
        insertTx.run(memberNumber!, "purchase", `บิล #${orderNumber} · ${summarize(lines)}`, -subtotal, paymentMethod, after, cashier, fmt(at));
      }
      insertAudit.run("ขายสินค้า", cashier, `บิล #${orderNumber} · ${money(subtotal)}${memberNumber ? ` · หักบัญชี ${memberNumber}` : ""}`, "blue", fmt(at));
      saleCount += 1;
    }


    if (day >= 1 && day % 2 === 1 && day < daysToFill) {
      const at = dayAt(day, randInt(10, 15), randInt(0, 59));
      if (at) {
        const memberNumber = pick(walletMembers.filter((mn) => (memberBalances.get(mn) ?? 0) > 400));
        if (memberNumber) {
          const amount = pick([200, 300, 1000]);
          const before = memberBalances.get(memberNumber) ?? 0;
          if (before >= amount) {
            const after = round2(before - amount);
            memberBalances.set(memberNumber, after);
            insertTx.run(memberNumber, "withdrawal", "ถอนเงินจากบัญชีสมาชิก · เงินสด", -amount, "เงินสด", after, cashierNames[day % 3], fmt(at));
            insertAudit.run("ถอนเงินสมาชิก", cashierNames[day % 3], `${memberNumber} · ${money(amount)} · เงินสด`, "purple", fmt(at));
            dayStats.withdrawals = round2(dayStats.withdrawals + amount);
            withdrawCount += 1;
          }
        }
      }
    }

    // คืนบัตรเงินสด: 19 ก.ย. และวันสุดท้าย — ผู้ป่วยออกจากโรงพยาบาล คืนบัตรรับเงินคืน
    if (day === 2 || day === daysToFill) {
      const at = dayAt(day, randInt(10, 15), randInt(0, 59));
      if (at) {
        const candidates = walletMembers.filter((mn) => (memberBalances.get(mn) ?? 0) > 150);
        const memberNumber = candidates.length > 0 ? candidates[day % candidates.length] : null;
        if (memberNumber) {
          const before = memberBalances.get(memberNumber) ?? 0;
          if (before > 0) {
            const after = 0;
            memberBalances.set(memberNumber, after);
            insertTx.run(memberNumber, "refund", `คืนบัตรเงินสด · ผู้ป่วยออกจากโรงพยาบาล · จ่ายคืน ${money(before)}`, -before, "เงินสด", after, cashierNames[(day + 1) % 3], fmt(at));
            insertAudit.run("คืนบัตรเงินสด", cashierNames[(day + 1) % 3], `${memberNumber} · ${money(before)} · จ่ายเงินคืนตามยอดคงเหลือ`, "amber", fmt(at));
            refundCount += 1;
          }
        }
      }
    }

    // 6.3 ตัดยอดประจำวัน (ทุกวันที่ผ่านมาแล้ว ไม่รวมวันนี้)
    if (day < daysToFill) {
      const closedAt = dayAt(day, 21, randInt(1, 15))!;
      insertClosure.run(fmtDate(new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate() + day)), fmt(closedAt), dayStats.bills, dayStats.pieces, dayStats.revenue, dayStats.cash, dayStats.qr, dayStats.wallet, dayStats.deposits, dayStats.withdrawals, cashierNames[day % 3], "ตัดยอดประจำวัน (ข้อมูลทดสอบ)");
      insertAudit.run("ตัดยอดประจำวัน", cashierNames[day % 3], `${dayStats.bills} บิล · ${money(dayStats.revenue)}`, "purple", fmt(closedAt));
    }

    // ซิงก์ยอด balance สมาชิกลงตาราง members ต่อวัน
    for (const [memberNumber, balance] of memberBalances) {
      db.prepare(`UPDATE members SET balance = ? WHERE member_number = ?`).run(balance, memberNumber);
    }
  }
  db.exec("COMMIT");
  console.log(`✔ สร้างรายการ 17 ${['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'][periodStart.getMonth()]} ${periodStart.getFullYear() + 543} – ${fmtDate(now)}: ขาย ${saleCount} บิล · เติมเงิน ${depositCount} · ถอน ${withdrawCount} · คืนบัตร ${refundCount} · ตัดยอด ${daysToFill} รอบ`);

  // ตรวจสอบความถูกต้อง
  const check = db.prepare(`SELECT (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM members) AS members, (SELECT COUNT(*) FROM sales) AS sales, (SELECT COUNT(*) FROM member_transactions) AS txs, (SELECT COUNT(*) FROM day_closures) AS closures`).get() as { products: number; members: number; sales: number; txs: number; closures: number };
  const integrity = db.prepare(`PRAGMA integrity_check`).get() as { integrity_check: string };
  const fk = db.prepare(`PRAGMA foreign_key_check`).all();
  console.log("\n=== สรุปข้อมูลในฐานข้อมูล ===");
  console.log(`สินค้า: ${check.products} · สมาชิก: ${check.members} · บิล: ${check.sales} · ธุรกรรมสมาชิก: ${check.txs} · รอบตัดยอด: ${check.closures}`);
  console.log(`integrity: ${integrity.integrity_check} · foreign keys: ${fk.length === 0 ? "ผ่าน" : `พบปัญหา ${fk.length} จุด!`}`);
  if (integrity.integrity_check !== "ok" || fk.length > 0) confirmExit("ตรวจสอบไม่ผ่าน — ดูข้อมูลด้านบน");

  // ยอดคงเหลือรวม (เทียบชีท "ยอดเงินในบัตร")
  const totalBalance = (db.prepare(`SELECT ROUND(SUM(balance), 2) AS total FROM members`).get() as { total: number }).total;
  const totalIn = (db.prepare(`SELECT ROUND(SUM(CASE WHEN type IN ('deposit','activation') THEN amount END), 2) AS total FROM member_transactions`).get() as { total: number }).total;
  const totalOut = (db.prepare(`SELECT ROUND(SUM(CASE WHEN type IN ('purchase','withdrawal','refund') THEN -amount END), 2) AS total FROM member_transactions`).get() as { total: number }).total;
  console.log(`ยอดเงินในบัตร: เข้ารวม ${money(totalIn)} − จ่ายรวม ${money(totalOut)} = คงเหลือ ${money(totalBalance)} ${Math.abs(totalIn - totalOut - totalBalance) < 0.01 ? "(ตรงกัน ✓)" : "(ไม่ตรง!)"}`);
  console.log("\nเสร็จสิ้น — เปิดโปรแกรมแล้วดู: รายงาน → ยอดเงินในบัตร / สินค้าคงคลัง / ประวัติธุรกรรม");
}

function round2(n: number) { return Math.round(n * 100) / 100; }

/** scrypt hash แบบเดียวกับระบบ (server/sqliteStore.hashPassword) */
function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** เก็บสำเนา seed-backup ไว้ 5 ชุดล่าสุด — เกินจากนี้ลบอันเก่าสุด */
function pruneOldSeedBackups(backupDir: string) {
  const files = readdirSync(backupDir).filter((name) => name.startsWith("seed-backup-") && name.endsWith(".sqlite")).map((name) => ({ name, mtime: statSync(join(backupDir, name)).mtimeMs })).sort((a, b) => b.mtime - a.mtime);
  for (const file of files.slice(5)) {
    try { unlinkSync(join(backupDir, file.name)); } catch { /* ลบไม่ได้ก็ปล่อย */ }
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("เกิดข้อผิดพลาด:", error);
  process.exit(1);
});
