/**
 * ยกระดับบัญชีผู้ใช้ให้เป็น administrator + ปลดล็อก + ล้าง must_change_password
 *
 * การใช้งาน:
 *   pnpm exec tsx scripts/promote-admin.ts <path-to-sqlite> [username]
 *
 * ตัวอย่าง:
 *   pnpm exec tsx scripts/promote-admin.ts data/welfare-store.sqlite
 *   pnpm exec tsx scripts/promote-admin.ts data/welfare-store.sqlite nikorn
 *
 * ถ้าไม่ระบุ username: จะ list ผู้ใช้ทั้งหมดให้เลือก
 * ถ้าระบุ username: จะยกระดับ user นั้นเป็น 'administrator' ทันที
 */
import "dotenv/config";
import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2];
const targetUsername = process.argv[3];

if (!dbPath) {
  console.error("Usage: pnpm exec tsx scripts/promote-admin.ts <path-to-sqlite> [username]");
  console.error("");
  console.error("Examples:");
  console.error("  pnpm exec tsx scripts/promote-admin.ts data/welfare-store.sqlite");
  console.error("  pnpm exec tsx scripts/promote-admin.ts data/welfare-store.sqlite nikorn");
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

// ตรวจว่ามีตาราง app_users หรือไม่ (อาจเป็น DB เก่าจาก main)
const hasAppUsers = db.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name='app_users'`
).get() as { name: string } | undefined;

if (!hasAppUsers) {
  console.error(`✗ ตาราง app_users ไม่มีในไฟล์ ${dbPath}`);
  console.error("  ไฟล์นี้อาจยังไม่ได้ผ่าน migration — ลองรัน pnpm dev ครั้งหนึ่งเพื่อให้ระบบสร้างตารางให้");
  process.exit(1);
}

// list ผู้ใช้ทั้งหมด
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

console.log(`\n=== ผู้ใช้ใน ${dbPath} (${users.length} บัญชี) ===\n`);
console.log("ID  | username      | role          | สถานะ    | locked | mustChange");
console.log("----|---------------|---------------|---------|--------|-----------");
for (const u of users) {
  const status = u.active ? "ใช้งาน" : "ระงับ";
  const locked = u.lockedUntil ? "ใช่" : "-";
  const must = u.mustChangePassword ? "ใช่" : "-";
  console.log(
    `${String(u.id).padStart(3)} | ${u.username.padEnd(13)} | ${u.role.padEnd(13)} | ${status.padEnd(7)} | ${locked.padEnd(6)} | ${must}`
  );
}
console.log("");

if (!targetUsername) {
  console.log("เพื่อยกระดับเป็น administrator รันคำสั่ง:");
  console.log(`  pnpm exec tsx scripts/promote-admin.ts ${dbPath} <username>`);
  db.close();
  process.exit(0);
}

// หา user ที่ระบุ
const target = users.find(u => u.username.toLowerCase() === targetUsername.toLowerCase());
if (!target) {
  console.error(`✗ ไม่พบผู้ใช้ "${targetUsername}" ในระบบ`);
  db.close();
  process.exit(1);
}

console.log(`→ ยกระดับ ${target.username} (${target.displayName}) จาก role="${target.role}" เป็น "administrator" ...`);

db.prepare(
  `UPDATE app_users
   SET role = 'administrator',
       active = 1,
       failed_attempts = 0,
       locked_until = NULL,
       must_change_password = 0
   WHERE id = ?`
).run(target.id);

// ตรวจผล
const updated = db.prepare(
  `SELECT id, username, role, active, failed_attempts, locked_until, must_change_password
   FROM app_users WHERE id = ?`
).get(target.id) as {
  id: number;
  username: string;
  role: string;
  active: number;
  failed_attempts: number;
  locked_until: string | null;
  must_change_password: number;
};

console.log("\n=== ผลการยกระดับ ===");
console.log(`✔ username:        ${updated.username}`);
console.log(`✔ role:            ${updated.role}`);
console.log(`✔ active:          ${updated.active === 1 ? "ใช้งาน" : "ระงับ"}`);
console.log(`✔ failed_attempts: ${updated.failed_attempts} (รีเป็น 0)`);
console.log(`✔ locked_until:    ${updated.locked_until ?? "NULL (ปลดล็อกแล้ว)"}`);
console.log(`✔ must_change_pw:  ${updated.must_change_password === 1 ? "ใช่" : "ไม่ (ปลดแล้ว)"}`);
console.log("\n→ ล็อกอินด้วยบัญชีนี้ได้ทันที รหัสผ่านยังเป็นของเดิม");

db.close();
