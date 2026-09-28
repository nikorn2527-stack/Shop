/**
 * ตรวจสอบสถานะฐานข้อมูล SQLite — แสดง users, tables, และทำนายผล migration
 *
 * การใช้งาน:
 *   pnpm exec tsx scripts/check-db.ts [path-to-sqlite]
 *
 * ตัวอย่าง:
 *   pnpm exec tsx scripts/check-db.ts data/welfare-store.sqlite
 *   pnpm exec tsx scripts/check-db.ts data/welfare-store-20260928T141352Z.sqlite
 *
 * ถ้าไม่ระบุ path จะใช้ค่า default: data/welfare-store.sqlite
 */
import "dotenv/config";
import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2] || process.env.SQLITE_DB_PATH || "data/welfare-store.sqlite";

console.log(`\n📊 ตรวจสอบฐานข้อมูล: ${dbPath}\n`);

let db: DatabaseSync;
try {
  db = new DatabaseSync(dbPath);
} catch (error) {
  console.error(`✗ เปิดไฟล์ไม่ได้: ${dbPath}`);
  console.error(`  Error: ${String(error)}`);
  console.error("");
  console.error("  ตรวจสอบ:");
  console.error("  - ไฟล์อยู่ที่ path ที่ระบุไหม");
  console.error("  - ระบบปิดเซิร์ฟเวอร์ก่อนรัน script นี้ (SQLite lock)");
  process.exit(1);
}

// === 1. ตารางทั้งหมด ===
const tables = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
).all() as { name: string }[];

console.log("═══════════════════════════════════════════════");
console.log(`📋 ตารางทั้งหมด: ${tables.length} ตาราง`);
console.log("═══════════════════════════════════════════════");
for (const t of tables) {
  console.log(`  • ${t.name}`);
}
console.log("");

// === ตาราง RBAC + ใหม่ที่ main-v2 ใช้ ===
const requiredTables = [
  "app_users", "app_sessions", "roles", "permissions", "role_permissions",
  "stock_movements", "cashier_shifts", "refunds",
  "members", "member_transactions", "products", "stock_lots",
  "sales", "sale_items", "day_closures", "audit_logs",
  "store_settings", "order_list_items", "limit_requests",
];

console.log("═══════════════════════════════════════════════");
console.log("🔍 ตารางที่จำเป็นสำหรับ main-v2");
console.log("═══════════════════════════════════════════════");
const existingTables = new Set(tables.map(t => t.name));
const missingTables = requiredTables.filter(t => !existingTables.has(t));
for (const t of requiredTables) {
  const status = existingTables.has(t) ? "✅ มี" : "❌ ขาด (จะถูกสร้างอัตโนมัติเมื่อรัน main-v2)";
  console.log(`  ${status}  ${t}`);
}
console.log("");

// === 2. ผู้ใช้ทั้งหมด ===
if (!existingTables.has("app_users")) {
  console.log("⚠️  ตาราง app_users ไม่มี — ไฟล์นี้อาจยังไม่ได้ผ่าน migration แรก");
  db.close();
  process.exit(0);
}

const users = db.prepare(
  `SELECT id, username, display_name AS displayName, role, active,
          failed_attempts AS failedAttempts,
          locked_until AS lockedUntil,
          must_change_password AS mustChangePassword
   FROM app_users
   ORDER BY id`
).all() as {
  id: number;
  username: string;
  displayName: string;
  role: string;
  active: number;
  failedAttempts: number;
  lockedUntil: string | null;
  mustChangePassword: number;
}[];

console.log("═══════════════════════════════════════════════");
console.log(`👥 ผู้ใช้: ${users.length} บัญชี`);
console.log("═══════════════════════════════════════════════");
console.log("ID  | username      | role          | สถานะ    | locked | mustChange | หลัง migration");
console.log("----|---------------|---------------|---------|--------|------------|---------------");
for (const u of users) {
  const status = u.active ? "ใช้งาน" : "ระงับ";
  const locked = u.lockedUntil ? "ใช่" : "-";
  const must = u.mustChangePassword ? "ใช่" : "-";
  const migrated = predictMigratedRole(u.role);
  const changed = u.role !== migrated ? `→ ${migrated}` : "(ไม่เปลี่ยน)";
  console.log(
    `${String(u.id).padStart(3)} | ${u.username.padEnd(13)} | ${u.role.padEnd(13)} | ${status.padEnd(7)} | ${locked.padEnd(6)} | ${must.padEnd(10)} | ${changed}`
  );
}
console.log("");

// === 3. ทำนายผล migration ===
console.log("═══════════════════════════════════════════════");
console.log("🔮 ทำนายผลหลัง migration ด้วย main-v2");
console.log("═══════════════════════════════════════════════");

const oldRoleUsers = users.filter(u => ["staff", "admin", "dev"].includes(u.role));
if (oldRoleUsers.length > 0) {
  console.log(`\n⚠️  พบผู้ใช้ ${oldRoleUsers.length} คนที่จะถูก migrate role:`);
  for (const u of oldRoleUsers) {
    const newRole = predictMigratedRole(u.role);
    console.log(`  • ${u.username} (${u.displayName}): ${u.role} → ${newRole}`);
  }
} else {
  console.log("  ✅ ไม่มีผู้ใช้ที่ต้อง migrate role (ทุกคนใช้ role ใหม่อยู่แล้ว)");
}

console.log("");
console.log("═══════════════════════════════════════════════");
console.log("📊 สรุปสิทธิ์หลัง migration");
console.log("═══════════════════════════════════════════════");
const roleCount: Record<string, number> = {};
for (const u of users) {
  const r = predictMigratedRole(u.role);
  roleCount[r] = (roleCount[r] || 0) + 1;
}
for (const [role, count] of Object.entries(roleCount)) {
  const perms = getRolePermissions(role);
  console.log(`  ${role.padEnd(15)} ${count} คน — ${perms}`);
}

console.log("");
console.log("═══════════════════════════════════════════════");
console.log("✅ สรุป");
console.log("═══════════════════════════════════════════════");
console.log(`  • ตารางขาด: ${missingTables.length} ตาราง (จะสร้างอัตโนมัติ)`);
console.log(`  • ผู้ใช้ทั้งหมด: ${users.length} คน`);
console.log(`  • ผู้ใช้ที่จะ migrate role: ${oldRoleUsers.length} คน`);
console.log(`  • ข้อมูลเดิม (members/products/sales): ไม่หาย`);
console.log("");

if (missingTables.length > 0 || oldRoleUsers.length > 0) {
  console.log("💡 ขั้นตอนถัดไป:");
  console.log("  1. ปิดเซิร์ฟเวอร์ (ถ้ารันอยู่)");
  console.log("  2. สำรองไฟล์: copy data\\welfare-store.sqlite data\\welfare-store.bak.sqlite");
  console.log("  3. รัน main-v2: pnpm dev  (รอจนเห็น 'Server running' แล้ว Ctrl+C)");
  console.log("  4. รัน script นี้อีกครั้งเพื่อยืนยันผล migration");
}

db.close();

// === Helper functions ===
function predictMigratedRole(currentRole: string): string {
  if (currentRole === "staff") return "cashier";
  if (currentRole === "admin" || currentRole === "dev") return "administrator";
  return currentRole; // ถ้าเป็น role ใหม่อยู่แล้ว (cashier, administrator, manager, etc.)
}

function getRolePermissions(role: string): string {
  switch (role) {
    case "administrator":
      return "สิทธิ์เต็ม — ทุก feature";
    case "manager":
      return "POS + Stock + Reports + Backup + User manage";
    case "supervisor":
      return "POS + Stock + Member + Limit approve";
    case "cashier":
      return "POS + รายงานขาย + Member view (ไม่มี backup)";
    case "stock_officer":
      return "Stock + รายงาน inventory";
    case "auditor":
      return "ดูรายงาน + audit log (ไม่แก้ไข)";
    default:
      return `role ไม่รู้จัก: ${role}`;
  }
}
