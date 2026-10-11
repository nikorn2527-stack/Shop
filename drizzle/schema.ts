import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  /**
   * ROUND 36 (ข้อ 31) — บทบาทจากบัญชีแอปร้านสวัสดิการ ("staff" | "admin" | "dev")
   * แยกจาก `role` เพื่อให้ dev ได้สิทธิ์ระดับ admin แต่ยังแสดงตัวตนเป็นผู้พัฒนา
   * MySQL หลักไม่ได้อ่านคอลัมน์นี้ — มันถูกส่งผ่าน ctx.user ของเซสชัน SQLite เท่านั้น
   */
  appRole: varchar("appRole", { length: 10 }),
  /** ROUND 36 — true = บัญชีนี้ต้องเปลี่ยนรหัสผ่านก่อนเริ่มใช้งาน (ส่งผ่าน ctx.user เช่นกัน) */
  mustChangePassword: boolean("mustChangePassword"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// TODO: Add your tables here