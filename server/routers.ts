import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { COOKIE_NAME } from "@shared/const";
import { EDITIONS, EDITION_TRIAL_DAYS, STANDARD_MAX_USERS, type Edition, type EditionFeatureKey } from "@shared/editions";
import { ensureEditionFeature, generateLicenseKey, parseLicenseKey, resolveEditionStatus, todayString } from "./license";
import { getSessionCookieOptions } from "./_core/cookies";
import { readAppSessionCookie, type TrpcContext } from "./_core/context";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { backupSqliteDatabase, listSqliteBackups, pruneSqliteBackupsByCount, restoreSqliteBackup, verifySqliteBackup } from "./sqliteBackup";
import { buildTemplateBase64, importMembers, importProducts, parseSpreadsheetBase64, readSheetRows, type MemberFieldMapping, type ProductFieldMapping } from "./importTool";
import { closeWelfareDb, getBackupDir, getWelfareDb, getWelfareDbPath } from "./welfareStore";
import {
  LOGIN_MAX_FAILURES,
  StoreError,
  appRoleThai,
  changeOwnPassword,
  checkout,
  clearLoginFailures,
  countAppUsers,
  createAppSession,
  createAppUser,
  createProduct,
  dailySalesRows,
  salesCashierOptions,
  deleteProduct,
  dashboardStats,
  setEditionSettings,
  memberTransactions,
  salesByCashier,
  salesByCategory,
  salesByProduct,
  salesLineItems,
  deleteAppSession,
  deleteMember,
  findAppUserByUsername,
  getMemberDetail,
  getSettings,
  installOverview,
  listAppSessions,
  listAppUsers,
  listAuditLogs,
  listDayClosures,
  listLimitRequests,
  countPendingLimitRequests,
  listMembers,
  listProducts,
  listStockRows,
  logAction,
  loginLockRemainingMinutes,
  memberSpendingStats,
  receiveStock,
  requestLimitReduction,
  decideLimitRequest,
  registerLoginFailure,
  registerMember,
  revokeAppSession,
  revokeOtherAppSessions,
  salesList,
  getSaleSlip,
  getTransactionSlip,
  setMemberStatus,
  setProductActive,
  setSettings,
  setupInitialAdmin,
  stockCount,
  stockCountLots,
  listOrderItems,
  addOrderItem,
  updateOrderItem,
  removeOrderItem,
  clearOrderList,
  unlockAppUser,
  updateAppUser,
  updateMember,
  updateProduct,
  bulkUpdateProductPrices,
  verifyPassword,
  walletTx,
  businessPeriodStatus,
  closeBusinessDay,
} from "./sqliteStore";

/** Maps business-rule StoreErrors (Thai messages) to tRPC BAD_REQUEST errors. */
function withStoreErrors<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof StoreError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }
    throw error;
  }
}

/** Same-origin cookie policy: secure only when the request is actually https. */
function isSecureRequest(req: TrpcContext["req"]) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : String(forwardedProto).split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}

/** Session-priority actor: a signed-in user overrides client-sent actor/role. */
function resolveActor(ctx: TrpcContext, input: { actor?: string; actorRole?: string }) {
  if (ctx.user) {
    return {
      actor: ctx.user.name ?? "ผู้ใช้ระบบ",
      actorRole: ctx.user.role === "admin" ? (ctx.user.appRole === "dev" ? "ผู้พัฒนา" : "ผู้บริหาร") : "เจ้าหน้าที่",
    };
  }
  return { actor: input.actor, actorRole: input.actorRole };
}

/** Admin gate: session role wins; only anonymous requests fall back to input. */
function isAdminCtx(ctx: TrpcContext, input: { actorRole?: string }) {
  return ctx.user ? ctx.user.role === "admin" : (input.actorRole ?? "").trim() === "ผู้บริหาร";
}

/** ROUND 56 (user) — ประตูโซนผู้พัฒนา (เครื่องมือติดตั้งระบบ): บัญชีที่เป็น dev เท่านั้น
 *  ใช้บทบาทจากเซสชันฝั่งเซิร์ฟเวอร์ (appRole จากฐานข้อมูล) ไม่เชื่อค่าที่ client ส่งมา */
function isDevCtx(ctx: TrpcContext) {
  return Boolean(ctx.user && ctx.user.role === "admin" && ctx.user.appRole === "dev");
}

/** ROUND 40 (ข้อ 32) — แปลง mapping ที่ client ส่ง (อาจมี -1 = ไม่นำเข้า) ให้เป็น undefined ตาม contract ของ importTool */
function sanitizeMapping<T extends Record<string, number | undefined>>(mapping: T): T {
  const cleaned: Record<string, number | undefined> = {};
  for (const [key, value] of Object.entries(mapping)) {
    if (value !== undefined && value >= 0) cleaned[key] = value;
  }
  return cleaned as T;
}

/** ROUND 61 (user) — ประตูเวอร์ชันฝั่งเซิร์ฟเวอร์: โยน StoreError ไทย (ผ่าน withStoreErrors) เมื่อเวอร์ชันยังไม่รวมฟีเจอร์นี้ */
function requireEdition(feature: EditionFeatureKey): void {
  ensureEditionFeature(getSettings(getWelfareDb()), feature);
}

const paymentMethodSchema = z.enum(["เงินสด", "QR / สแกน", "หักบัญชีสมาชิก"]);

const memberListInput = z
  .object({
    search: z.string().optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .nullish();

const memberDetailInput = z.object({ memberNumber: z.string().min(1) });

const memberRegisterInput = z.object({
  prename: z.string().max(30, "คำนำหน้ายาวเกินไป").optional(),
  firstName: z.string().min(1, "กรุณาระบุชื่อสมาชิก"),
  lastName: z.string().min(1, "กรุณาระบุนามสกุลสมาชิก"),
  citizenId: z.string().optional(),
  phone: z.string().optional(),
  type: z.string().optional(),
  gender: z.enum(["ชาย", "หญิง", "ไม่ระบุ"]).optional(),
  photoUrl: z.string().max(600_000).optional(),
  initialDeposit: z.number().positive("จำนวนเงินต้องมากกว่า 0").optional(),
  memberNumber: z.string().optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const memberSetStatusInput = z.object({
  memberNumber: z.string().min(1),
  suspended: z.boolean(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const memberWalletInput = z.object({
  memberNumber: z.string().min(1),
  type: z.enum(["deposit", "withdrawal"]),
  amount: z.number(),
  note: z.string().optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
  // ROUND 63 (user) — รูปหลักฐานการโอน/สลิป แนบไปกับรายการเติม/ถอน
  slipImage: z.string().max(600_000).nullish(),
});

const memberUpdateInput = z.object({
  memberNumber: z.string().min(1),
  prename: z.string().max(30, "คำนำหน้ายาวเกินไป").nullish(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  idCard: z.string().nullish(),
  phone: z.string().nullish(),
  type: z.string().optional(),
  gender: z.enum(["ชาย", "หญิง", "ไม่ระบุ"]).nullish(),
  photoUrl: z.string().max(600_000).nullish(),
  // Req 23.2 — วงเงินซื้อสินค้าต่อวัน (null = ไม่จำกัด)
  creditLimit: z.number().min(1).max(1000000).nullable().optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

// Req 23.2 — การขอลดวงเงิน: เจ้าหน้าที่ยื่นคำขอ · ผู้บริหารพิจารณา (approve/reject)
const memberLimitRequestInput = z.object({
  memberNumber: z.string().min(1),
  requestedLimit: z.number().int().min(1).max(1000000),
  reason: z.string().max(500).optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const memberLimitDecisionInput = z.object({
  requestId: z.number().int().positive(),
  decision: z.enum(["approve", "reject"]),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const memberDeleteInput = z.object({
  memberNumber: z.string().min(1),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const stockCountInput = z.object({
  productId: z.number().int(),
  countedQty: z.number(),
  note: z.string().optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const stockCountLotsInput = z.object({
  counts: z
    .array(z.object({ lotId: z.number().int(), countedQty: z.number().int().min(0) }))
    .min(1, "กรุณาระบุจำนวนที่นับได้อย่างน้อย 1 Lot"),
  note: z.string().optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

// Round 32-15 — รายการสั่งซื้อ (สะสมสินค้าที่จะสั่งเข้า กันตกหล่น)
const orderAddInput = z.object({
  productId: z.number().int(),
  qty: z.number().positive().optional(),
  note: z.string().max(500).optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const orderUpdateInput = z.object({
  id: z.number().int().min(1),
  qty: z.number().positive().optional(),
  note: z.string().max(500).nullable().optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

// A bill line is either a catalog product (barcode/quick-pick) or a "รายการพิเศษ"
// (special/custom line: weighed goods, services, ad-hoc charges — no product row,
// no stock movement). sale_items.product_id is nullable on purpose for these.
const checkoutInput = z.object({
  items: z
    .array(z.union([
      z.object({ productId: z.number().int().positive(), qty: z.number().int().positive(), price: z.number().positive().optional(), unit: z.string().max(30).optional(), label: z.string().max(120).optional() }),
      z.object({ name: z.string().min(1, "กรุณาระบุชื่อรายการพิเศษ"), price: z.number().positive("ราคาต้องมากกว่า 0"), qty: z.number().int().positive(), unit: z.string().optional() }),
    ]))
    .min(1, "ยังไม่มีสินค้าในบิล"),
  paymentMethod: paymentMethodSchema,
  memberNumber: z.string().nullish(),
  discount: z.number().min(0).optional(),
  cashier: z.string().optional(),
  actorRole: z.string().optional(),
  // ROUND 63 (user) — รูปหลักฐานการชำระ (สลิป QR / สแกน) แนบไปกับบิล
  slipImage: z.string().max(600_000).nullish(),
});

const productCreateInput = z.object({
  name: z.string().min(1, "กรุณาระบุชื่อสินค้า"),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  size: z.string().optional(),
  imageUrl: z.string().nullable().optional(),
  // round 31-12: สินค้าลัดหน้าร้าน + สินค้าขายเป็นเงิน (เช่น น้ำแข็ง)
  quickPick: z.number().int().min(0).max(1).nullish(),
  sellMode: z.enum(["unit", "money"]).nullish(),
  priceTiers: z.string().max(20_000).nullish(),
  unit: z.string().optional(),
  price: z.number().min(0, "ราคาขายต้องเป็นตัวเลข 0 ขึ้นไป"),
  cost: z.number().min(0).optional(),
  stock: z.number().int().min(0).optional(),
  reorderPoint: z.number().int().min(0).optional(),
  category: z.string().optional(),
  emoji: z.string().optional(),
  color: z.string().optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

// Plain z.number() for price/cost/reorderPoint so the Thai StoreError validation surfaces instead of a zod message.
const productUpdateInput = z.object({
  productId: z.number().int(),
  name: z.string().optional(),
  barcode: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  // round 31-12: สินค้าลัดหน้าร้าน + สินค้าขายเป็นเงิน (เช่น น้ำแข็ง)
  quickPick: z.number().int().min(0).max(1).nullish(),
  sellMode: z.enum(["unit", "money"]).nullish(),
  priceTiers: z.string().max(20_000).nullish(),
  unit: z.string().optional(),
  price: z.number().optional(),
  cost: z.number().optional(),
  reorderPoint: z.number().optional(),
  category: z.string().optional(),
  emoji: z.string().optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const productSetActiveInput = z.object({
  productId: z.number().int(),
  active: z.boolean(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const productDeleteInput = z.object({
  productId: z.number().int(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

// Round 64 — ปรับราคาขาย/ต้นทุนหลายรายการพร้อมกัน (ใช้ transaction เดียว + log สรุปก้อนเดียว)
const productBulkUpdatePricesInput = z.object({
  items: z
    .array(
      z.object({
        productId: z.number().int(),
        price: z.number().optional(),
        cost: z.number().optional(),
      }),
    )
    .min(1, "กรุณาเลือกรายการอย่างน้อย 1 รายการ")
    .max(500, "ปรับราคาได้ครั้งละไม่เกิน 500 รายการ"),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const productListInput = z
  .object({ includeInactive: z.boolean().optional() })
  .nullish();

const salesListInput = z
  .object({
    search: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .nullish();

const stockReceiveInput = z.object({
  productId: z.number().int(),
  lot: z.string().optional(),
  expiryDate: z.string().nullish(),
  qty: z.number().int().positive("จำนวนต้องมากกว่า 0"),
  cost: z.number().min(0).optional(),
  actor: z.string().optional(),
  actorRole: z.string().optional(),
});

const dashboardStatsInput = z
  .object({ rangeDays: z.number().int().min(1).max(365).optional() })
  .nullish();

const reportRangeInput = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD").optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD").optional(),
    /** ROUND 51 — กรองเฉพาะพนักงานขายคนนี้ ("" = ทุกคน · "ไม่ระบุพนักงาน" = บิลที่ไม่มีชื่อ) */
    cashier: z.string().trim().max(120).optional(),
  })
  .nullish();

const reportsDailyInput = z
  .object({
    days: z.number().int().min(1).max(365).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD").optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD").optional(),
    /** ROUND 51 — กรองเฉพาะพนักงานขายคนนี้ ("" = ทุกคน · "ไม่ระบุพนักงาน" = บิลที่ไม่มีชื่อ) */
    cashier: z.string().trim().max(120).optional(),
  })
  .nullish();

const memberTransactionsInput = z
  .object({
    memberNumber: z.string().optional(),
    type: z.enum(["purchase", "deposit", "withdrawal", "limit_request"]).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD").optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "รูปแบบวันที่ต้องเป็น YYYY-MM-DD").optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .nullish();

const logsListInput = z
  .object({ limit: z.number().int().min(1).max(1000).optional() })
  .nullish();

const settingsPatchInput = z
  .object({
    memberNumberMode: z.enum(["running", "year", "manual"]).optional(),
    storeName: z.string().optional(),
    storeCode: z.string().optional(),
    storeAddress: z.string().optional(),
    appName: z.string().max(80).optional(),
    appLogo: z.string().max(600_000).optional(),
    appTheme: z.string().max(32).optional(),
    autoPrintReceipt: z.boolean().optional(),
    showBalanceOnReceipt: z.boolean().optional(),
    lowBalanceAlert: z.boolean().optional(),
    lowBalanceThreshold: z.number().min(0).optional(),
    lowStockAlert: z.boolean().optional(),
    expiryAlert: z.boolean().optional(),
    expiryAlertDays: z.number().int().min(1).max(365).optional(),
    dailyCutOffMode: z.enum(["auto", "manual"]).optional(),
    dailyCutOffTime: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "รูปแบบเวลาต้องเป็น HH:MM").optional(),
    // ROUND 36 (ข้อ 31) — ประตูบัญชีผู้พัฒนา (dev): ปิดไว้เป็นค่าเริ่มต้น เปิดเฉพาะเมื่อจำเป็น
    devAccess: z.boolean().optional(),
    // ROUND 38 (ข้อ 39) — สไตล์การแสดงผลของแอป + การตั้งค่าสำรองข้อมูลอัตโนมัติ
    appStyle: z.string().max(32).optional(),
    backupAutoEnabled: z.boolean().optional(),
    backupIntervalHours: z.number().int().min(1).max(168).optional(),
    backupKeepCount: z.number().int().min(3).max(60).optional(),
    // ROUND 42 (ข้อ 32 ตอนที่ 3 — ข้อ 4) — ความกว้างกระดาษสลิปเครื่องพิมพ์ 58/72/80 มม.
    receiptPaperWidth: z.enum(["58", "72", "80"]).optional(),
    // ROUND 56 (user) — เช็คลิสต์วันขึ้นระบบ (โซนเครื่องมือติดตั้ง): JSON รหัสรายการที่ติ๊กแล้ว
    goliveChecks: z.string().max(4000).optional(),
    // ROUND 63 (user) — บัญชีพร้อมเพย์ร้าน: เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก
    promptpayId: z.string().max(20).optional(),
  })
  .nullish();

// ROUND 38 (ข้อ 39) — ชื่อไฟล์สำรองที่รับได้: welfare-store-YYYYMMDDTHHMMSSZ.sqlite เท่านั้น
const backupFileInput = z.object({
  file: z.string().regex(/^welfare-store-\d{8}T\d{6}Z\.sqlite$/, "ชื่อไฟล์สำรองไม่ถูกต้อง"),
});

const authLoginInput = z.object({
  username: z.string().min(1, "กรุณาระบุชื่อผู้ใช้"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});

// ROUND 36 (ข้อ 31) — ลงทะเบียนครั้งแรก: ใช้ได้เฉพาะระบบที่ยังไม่มีบัญชีผู้ใช้เลย
// ROUND 61 — เพิ่มการเลือกเวอร์ชันตอนลงทะเบียน: ทดลองใช้ 30 วัน / ใส่รหัสลิขสิทธิ์ / เริ่มที่ทั่วไป
const authSetupInput = z.object({
  username: z.string().min(1).max(30).regex(/^[^\s]+$/, "ชื่อผู้ใช้ห้ามมีช่องว่าง"),
  displayName: z.string().min(1),
  password: z.string().min(1),
  storeName: z.string().max(80).optional(),
  editionChoice: z.enum(["trial", "license", "standard"]).optional(),
  licenseKey: z.string().max(40).optional(),
});

const authChangePasswordInput = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

const userCreateInput = z.object({
  username: z.string().min(1, "กรุณาระบุชื่อผู้ใช้"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
  displayName: z.string().min(1, "กรุณาระบุชื่อ-นามสกุล"),
  role: z.enum(["staff", "admin", "dev"]),
});

const userUpdateInput = z.object({
  userId: z.number().int().positive(),
  displayName: z.string().optional(),
  role: z.enum(["staff", "admin", "dev"]).optional(),
  active: z.boolean().optional(),
  password: z.string().optional(),
});

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  // ROUND 56 (user) — โซนเครื่องมือติดตั้งระบบ (บัญชีผู้พัฒนาเท่านั้น): ตัวเลขตรวจรับข้อมูล
  // วันขึ้นระบบ — จำนวนบัญชี/สมาชิก/สินค้า (รวมสินค้ายังไม่ตั้งราคา)/บิลวันนี้/ขนาดฐานข้อมูล
  install: router({
    overview: publicProcedure
      .input(z.unknown().optional())
      .query(({ ctx }) =>
        withStoreErrors(() => {
          if (!isDevCtx(ctx)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "เครื่องมือติดตั้งระบบใช้ได้เฉพาะบัญชีผู้พัฒนา" });
          }
          // ROUND 61 — พ่วงสถานะเวอร์ชัน/ลิขสิทธิ์ให้ช่างเห็นตอนติดตั้ง (ลูกค้ายังไม่ได้ใส่รหัส = ทั่วไป)
          return { ...installOverview(getWelfareDb(), getWelfareDbPath()), edition: resolveEditionStatus(getSettings(getWelfareDb())) };
        }),
      ),
  }),
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    /** ROUND 36 (ข้อ 31) — สถานะลงทะเบียนครั้งแรก: needsSetup = ยังไม่มีบัญชีผู้ใช้เลย */
    setupStatus: publicProcedure.query(() => withStoreErrors(() => ({ needsSetup: countAppUsers(getWelfareDb()) === 0 }))),
    /** ROUND 36 (ข้อ 31) — ลงทะเบียนผู้บริหารหลัก (ระบบใหม่เท่านั้น) แล้วเข้าสู่ระบบทันที
     *  ROUND 61 — บันทึกการเลือกเวอร์ชันไปพร้อมกัน: ทดลอง 30 วัน / ใช้รหัสลิขสิทธิ์ / ทั่วไป */
    setup: publicProcedure
      .input(authSetupInput)
      .mutation(({ ctx, input }) =>
        withStoreErrors(() => {
          const db = getWelfareDb();
          const user = setupInitialAdmin(db, input);
          // ROUND 61 — เวอร์ชันที่เลือกไว้ตอนลงทะเบียน (ค่าเริ่มต้น = ทดลองใช้ 30 วัน)
          const choice = input.editionChoice ?? "trial";
          const storeName = (input.storeName ?? "").trim();
          if (choice === "trial") {
            setEditionSettings(db, { trialStart: todayString() });
          } else if (choice === "license") {
            const key = (input.licenseKey ?? "").trim();
            const parsed = key ? parseLicenseKey(key) : null;
            if (!parsed) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "รหัสลิขสิทธิ์ไม่ถูกต้อง — ตรวจอักขระให้ครบทุกกลุ่ม หรือเลือก “เริ่มทดลองใช้” ก่อนแล้วค่อยใส่รหัสภายหลังได้" });
            }
            setEditionSettings(db, { licenseKey: key, licenseName: storeName || user.displayName });
          }
          const roleThai = "ผู้บริหาร";
          const session = createAppSession(db, user.id);
          ctx.res.cookie(COOKIE_NAME, session.sessionId, {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            secure: isSecureRequest(ctx.req),
            maxAge: 7 * 24 * 60 * 60 * 1000,
          });
          logAction(db, "เข้าสู่ระบบ", user.displayName, `${user.username} · สิทธิ์ ${roleThai}`, "blue", roleThai);
          return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, mustChangePassword: true };
        }),
      ),
    /** ROUND 36 (ข้อ 31) — เปลี่ยนรหัสผ่านของตัวเอง (บังคับตอน first login / ตั้งใหม่โดยผู้บริหาร) */
    changePassword: publicProcedure
      .input(authChangePasswordInput)
      .mutation(({ ctx, input }) =>
        withStoreErrors(() => {
          if (!ctx.user) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบก่อนเปลี่ยนรหัสผ่าน" });
          }
          const { actor, actorRole } = resolveActor(ctx, {});
          return changeOwnPassword(getWelfareDb(), {
            userId: ctx.user.id,
            currentPassword: input.currentPassword,
            newPassword: input.newPassword,
            keepSessionId: readAppSessionCookie(ctx.req),
            actor,
            actorRole,
          });
        }),
      ),
    login: publicProcedure
      .input(authLoginInput)
      .mutation(({ ctx, input }) =>
        withStoreErrors(() => {
          const db = getWelfareDb();
          const username = input.username.trim();
          const user = findAppUserByUsername(db, username);
          // Temporary wrong-password lockout: even the CORRECT password is
          // refused while the lock is live (admins can unlock early).
          if (user?.lockedUntil && loginLockRemainingMinutes(user.lockedUntil) > 0) {
            const minutes = loginLockRemainingMinutes(user.lockedUntil);
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `บัญชีถูกระงับชั่วคราวเนื่องจากกรอกรหัสผ่านผิดหลายครั้ง · ลองอีกครั้งในอีก ${minutes} นาที หรือติดต่อผู้บริหารเพื่อปลดล็อก`,
            });
          }
          // Same message for unknown user and wrong password: no user enumeration.
          if (!user || !verifyPassword(input.password, user.passwordHash)) {
            const failure = registerLoginFailure(db, username);
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: failure.justLocked
                ? "รหัสผ่านไม่ถูกต้อง · บัญชีถูกระงับชั่วคราว 15 นาที"
                : failure.attempts > 0
                  ? `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง · พยายามแล้ว ${failure.attempts}/${LOGIN_MAX_FAILURES} ครั้ง`
                  : "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง",
            });
          }
          // ROUND 36 (ข้อ 31) — ประตูบัญชีผู้พัฒนา (dev): ตรวจหลังรหัสผ่านถูกต้อง
          // แล้วเท่านั้น เพื่อไม่เปิดช่องให้เดารหัสผ่านของบัญชี dev จากข้อความปฏิเสธ
          if (user.role === "dev" && !getSettings(db).devAccess) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "การเข้าใช้งานสำหรับผู้พัฒนา (dev) ถูกปิดอยู่ · ให้ผู้บริหารเปิดได้ที่ ตั้งค่า → สิทธิ์และความปลอดภัย",
            });
          }
          clearLoginFailures(db, user.id);
          const roleThai = appRoleThai(user.role);
          const session = createAppSession(db, user.id);
          ctx.res.cookie(COOKIE_NAME, session.sessionId, {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            secure: isSecureRequest(ctx.req),
            maxAge: 7 * 24 * 60 * 60 * 1000,
          });
          // บัญชี dev คือการเข้าถึงพิเศษ — บันทึกสีแดงและขึ้นต้นรายละเอียดด้วย DEV
          if (user.role === "dev") {
            logAction(db, "เข้าสู่ระบบ", user.displayName, `DEV · ${user.username} · สิทธิ์ ${roleThai}`, "red", roleThai);
          } else {
            logAction(db, "เข้าสู่ระบบ", user.displayName, `${user.username} · สิทธิ์ ${roleThai}`, "blue", roleThai);
          }
          return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, mustChangePassword: user.mustChangePassword === 1 };
        }),
      ),
    logout: publicProcedure.mutation(({ ctx }) => {
      // Delete the local session row (and audit) before clearing the cookie.
      try {
        const sessionId = readAppSessionCookie(ctx.req);
        if (sessionId) {
          const db = getWelfareDb();
          deleteAppSession(db, sessionId);
          if (ctx.user) {
            const roleThai = ctx.user.role === "admin" ? (ctx.user.appRole === "dev" ? "ผู้พัฒนา" : "ผู้บริหาร") : "เจ้าหน้าที่";
            logAction(db, "ออกจากระบบ", ctx.user.name ?? "ผู้ใช้ระบบ", `${ctx.user.openId} · สิทธิ์ ${roleThai}`, "green", roleThai);
          }
        }
      } catch (error) {
        // Logout must always succeed for the cookie clear below.
        console.warn("[Auth] Session delete on logout failed:", String(error));
      }
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  user: router({
    list: publicProcedure
      .input(z.unknown().optional())
      .query(({ ctx }) =>
        withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การจัดการผู้ใช้ระบบต้องใช้สิทธิ์ผู้บริหาร" });
          }
          return listAppUsers(getWelfareDb());
        }),
      ),
    create: publicProcedure
      .input(userCreateInput)
      .mutation(({ ctx, input }) => {
        // The zod schema has no actor/actorRole fields, so the session is the
        // only source of identity — the admin gate requires an admin session.
        const { actor, actorRole } = resolveActor(ctx, {});
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การจัดการผู้ใช้ระบบต้องใช้สิทธิ์ผู้บริหาร" });
          }
          // ROUND 61 — เวอร์ชันทั่วไปจำกัดบัญชีที่ใช้งานได้ 3 บัญชี (โปร/โปรพลัสไม่จำกัด)
          const editionStatus = resolveEditionStatus(getSettings(getWelfareDb()));
          if (!editionStatus.features.includes("usersUnlimited")) {
            const activeUsers = listAppUsers(getWelfareDb()).filter((user) => user.active === 1).length;
            if (activeUsers >= STANDARD_MAX_USERS) {
              throw new TRPCError({ code: "FORBIDDEN", message: `เวอร์ชันทั่วไปใช้บัญชีได้สูงสุด ${STANDARD_MAX_USERS} บัญชี (ใช้อยู่ ${activeUsers} บัญชี) — อัปเกรดเป็นเวอร์ชันโปรเพื่อเพิ่มผู้ใช้ไม่จำกัด` });
            }
          }
          return createAppUser(getWelfareDb(), { ...input, actor, actorRole });
        });
      }),
    update: publicProcedure
      .input(userUpdateInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, {});
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การจัดการผู้ใช้ระบบต้องใช้สิทธิ์ผู้บริหาร" });
          }
          // Self-protection: role changes and suspension target other accounts.
          if (ctx.user && ctx.user.id === input.userId && (input.role !== undefined || input.active === false)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "ไม่สามารถเปลี่ยนสิทธิ์หรือระงับบัญชีของตัวเองได้" });
          }
          // Pass only the defined fields so the changed-fields diff in the store works.
          return updateAppUser(getWelfareDb(), {
            userId: input.userId,
            displayName: input.displayName,
            role: input.role,
            active: input.active,
            password: input.password,
            actor,
            actorRole,
          });
        });
      }),
    unlock: publicProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, {});
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การจัดการผู้ใช้ระบบต้องใช้สิทธิ์ผู้บริหาร" });
          }
          // Unlocking your own account is allowed: a locked admin with a live
          // session should be able to clear their own lock without waiting.
          return unlockAppUser(getWelfareDb(), input.userId, actor, actorRole);
        });
      }),
  }),

  session: router({
    /** Lists active sessions; the caller's own session is flagged `current`. */
    list: publicProcedure
      .input(z.unknown().optional())
      .query(({ ctx }) =>
        withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การจัดการเซสชันต้องใช้สิทธิ์ผู้บริหาร" });
          }
          const currentSessionId = readAppSessionCookie(ctx.req);
          return listAppSessions(getWelfareDb()).map((session) => ({ ...session, current: session.sessionId === currentSessionId }));
        }),
      ),
    revoke: publicProcedure
      .input(z.object({ sessionId: z.string().min(1) }))
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, {});
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การจัดการเซสชันต้องใช้สิทธิ์ผู้บริหาร" });
          }
          // Revoking the session making this very request is what logout is for.
          if (input.sessionId === readAppSessionCookie(ctx.req)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "ไม่สามารถยกเลิกเซสชันที่กำลังใช้งานอยู่ · ใช้ปุ่มออกจากระบบ" });
          }
          return revokeAppSession(getWelfareDb(), input.sessionId, actor, actorRole);
        });
      }),
    revokeOthers: publicProcedure
      .input(z.unknown().optional())
      .mutation(({ ctx }) => {
        const { actor, actorRole } = resolveActor(ctx, {});
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การจัดการเซสชันต้องใช้สิทธิ์ผู้บริหาร" });
          }
          const currentSessionId = readAppSessionCookie(ctx.req);
          if (!currentSessionId) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: "ไม่พบเซสชันที่ใช้งานอยู่" });
          }
          return { revoked: revokeOtherAppSessions(getWelfareDb(), currentSessionId, actor, actorRole) };
        });
      }),
  }),

  product: router({
    list: publicProcedure
      .input(productListInput)
      .query(({ input }) => withStoreErrors(() => listProducts(getWelfareDb(), input?.includeInactive ?? false))),
    create: publicProcedure
      .input(productCreateInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => createProduct(getWelfareDb(), { ...input, actor, actorRole }));
      }),
    update: publicProcedure
      .input(productUpdateInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => updateProduct(getWelfareDb(), { ...input, actor, actorRole }));
      }),
    bulkUpdatePrices: publicProcedure
      .input(productBulkUpdatePricesInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, input)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การปรับราคาหลายรายการพร้อมกันต้องใช้สิทธิ์ผู้บริหาร" });
          }
          return bulkUpdateProductPrices(getWelfareDb(), { ...input, actor, actorRole });
        });
      }),
    setActive: publicProcedure
      .input(productSetActiveInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, input)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การปิด/เปิดการขายสินค้าต้องใช้สิทธิ์ผู้บริหาร" });
          }
          return setProductActive(getWelfareDb(), { ...input, actor, actorRole });
        });
      }),
    delete: publicProcedure
      .input(productDeleteInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, input)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การลบสินค้าต้องใช้สิทธิ์ผู้บริหาร" });
          }
          return deleteProduct(getWelfareDb(), { ...input, actor, actorRole });
        });
      }),
  }),

  sales: router({
    list: publicProcedure
      .input(salesListInput)
      .query(({ input }) => withStoreErrors(() => salesList(getWelfareDb(), input ?? {}))),
    // ROUND 63 (user) — ดึงรูปหลักฐานการชำระของบิล (สลิป QR / สแกน) แยกจากลิสต์กัน payload หนัก
    slip: publicProcedure
      .input(z.object({ id: z.number().int().min(1) }))
      .query(({ input }) => withStoreErrors(() => getSaleSlip(getWelfareDb(), input.id))),
  }),

  stock: router({
    rows: publicProcedure
      .input(z.unknown().optional())
      .query(() => withStoreErrors(() => listStockRows(getWelfareDb()))),
    receive: publicProcedure
      .input(stockReceiveInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() =>
          receiveStock(
            getWelfareDb(),
            input.productId,
            input.lot ?? "",
            input.expiryDate ?? null,
            input.qty,
            input.cost,
            actor,
            actorRole,
          ),
        );
      }),
    count: publicProcedure
      .input(stockCountInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => {
          requireEdition("stockCount"); // ROUND 61 — งานนับสต๊อกเป็นฟีเจอร์เวอร์ชันโปรพลัส
          return stockCount(getWelfareDb(), { ...input, actor, actorRole });
        });
      }),
    countLots: publicProcedure
      .input(stockCountLotsInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => {
          requireEdition("stockCount"); // ROUND 61 — นับแยกล็อตรวมอยู่ในงานนับสต๊อก (โปรพลัส)
          return stockCountLots(getWelfareDb(), { ...input, actor, actorRole });
        });
      }),
    // Round 32-15 — รายการสั่งซื้อ: สะสมรายการที่จะสั่งเข้า เพื่อกันตกหล่นก่อนสั่งจริง
    orderList: publicProcedure
      .input(z.unknown().optional())
      .query(() => withStoreErrors(() => listOrderItems(getWelfareDb()))),
    orderAdd: publicProcedure
      .input(orderAddInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => addOrderItem(getWelfareDb(), { ...input, actor, actorRole }));
      }),
    orderUpdate: publicProcedure
      .input(orderUpdateInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => updateOrderItem(getWelfareDb(), { ...input, actor, actorRole }));
      }),
    orderRemove: publicProcedure
      .input(z.object({ id: z.number().int().min(1), actor: z.string().optional(), actorRole: z.string().optional() }))
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => removeOrderItem(getWelfareDb(), { ...input, actor, actorRole }));
      }),
    orderClear: publicProcedure
      .input(z.object({ actor: z.string().optional(), actorRole: z.string().optional() }).optional())
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input ?? {});
        return withStoreErrors(() => clearOrderList(getWelfareDb(), { actor, actorRole }));
      }),
  }),

  pos: router({
    checkout: publicProcedure
      .input(checkoutInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => {
          // ROUND 61 — รายการพิเศษ/ของสั่ง (บรรทัดไม่มี productId) เป็นฟีเจอร์เวอร์ชันโปรพลัส
          if (input.items.some((item) => !("productId" in item))) requireEdition("specialOrders");
          return checkout(getWelfareDb(), { ...input, cashier: input.cashier ?? actor, actorRole });
        });
      }),
  }),

  member: router({
    list: publicProcedure
      .input(memberListInput)
      .query(({ input }) => withStoreErrors(() => listMembers(getWelfareDb(), input?.search, input?.status))),
    detail: publicProcedure
      .input(memberDetailInput)
      .query(({ input }) =>
        withStoreErrors(() => {
          const detail = getMemberDetail(getWelfareDb(), input.memberNumber);
          if (!detail) {
            throw new TRPCError({ code: "NOT_FOUND", message: `ไม่พบสมาชิก ${input.memberNumber} ในระบบ` });
          }
          return detail;
        }),
      ),
    stats: publicProcedure
      .input(memberDetailInput)
      .query(({ input }) => withStoreErrors(() => memberSpendingStats(getWelfareDb(), input.memberNumber))),
    register: publicProcedure
      .input(memberRegisterInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => registerMember(getWelfareDb(), { ...input, actor, actorRole }));
      }),
    setStatus: publicProcedure
      .input(memberSetStatusInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => setMemberStatus(getWelfareDb(), input.memberNumber, input.suspended, actor, actorRole));
      }),
    wallet: publicProcedure
      .input(memberWalletInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => walletTx(getWelfareDb(), { ...input, actor, actorRole }));
      }),
    // ROUND 63 (user) — ดึงรูปหลักฐานของรายการเติม/ถอนเงินสมาชิก (แนบตอนทำรายการที่ POS)
    transactionSlip: publicProcedure
      .input(z.object({ id: z.number().int().min(1) }))
      .query(({ input }) => withStoreErrors(() => getTransactionSlip(getWelfareDb(), input.id))),
    update: publicProcedure
      .input(memberUpdateInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => updateMember(getWelfareDb(), { ...input, actor, actorRole }));
      }),
    // Req 23.2 — การขอลดวงเงิน: เจ้าหน้าที่ที่ล็อกอินยื่นคำขอได้ (คำขอเข้าสถานะ pending)
    requestLimitReduction: publicProcedure
      .input(memberLimitRequestInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => requestLimitReduction(getWelfareDb(), { ...input, actor, actorRole }));
      }),
    // Req 23.2 — พิจารณาคำขอลดวงเงิน: ผู้บริหารเท่านั้น (approve = ตั้งวงเงินใหม่ / reject = คงเดิม)
    decideLimitRequest: publicProcedure
      .input(memberLimitDecisionInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, input)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การพิจารณาคำขอลดวงเงินต้องใช้สิทธิ์ผู้บริหาร" });
          }
          return decideLimitRequest(getWelfareDb(), { ...input, actor, actorRole });
        });
      }),
    delete: publicProcedure
      .input(memberDeleteInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, input)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การลบสมาชิกต้องใช้สิทธิ์ผู้บริหาร" });
          }
          return deleteMember(getWelfareDb(), { ...input, actor, actorRole });
        });
      }),
  }),

  dashboard: router({
    stats: publicProcedure
      .input(dashboardStatsInput)
      .query(({ input }) => withStoreErrors(() => dashboardStats(getWelfareDb(), input?.rangeDays ?? 30))),
  }),

  reports: router({
    daily: publicProcedure
      .input(reportsDailyInput)
      .query(({ input }) => withStoreErrors(() => dailySalesRows(getWelfareDb(), input ?? {}))),
    byCategory: publicProcedure
      .input(reportRangeInput)
      .query(({ input }) => withStoreErrors(() => salesByCategory(getWelfareDb(), input ?? {}))),
    byProduct: publicProcedure
      .input(reportRangeInput)
      .query(({ input }) => withStoreErrors(() => {
        requireEdition("reportsAdvanced"); // ROUND 61 — มุมมองตามสินค้า = เวอร์ชันโปรขึ้นไป
        return salesByProduct(getWelfareDb(), input ?? {});
      })),
    /** ROUND 48 — รายการสินค้าทุกบรรทัดจากทุกบิลในช่วงเวลา (แยกตามรายการในบิล) */
    lineItems: publicProcedure
      .input(reportRangeInput)
      .query(({ input }) => withStoreErrors(() => {
        requireEdition("reportsAdvanced"); // ROUND 61 — รายการในบิล = เวอร์ชันโปรขึ้นไป
        return salesLineItems(getWelfareDb(), input ?? {});
      })),
    byCashier: publicProcedure
      .input(reportRangeInput)
      .query(({ input }) => withStoreErrors(() => {
        requireEdition("reportsAdvanced"); // ROUND 61 — มุมมองตามพนักงานขาย = เวอร์ชันโปรขึ้นไป
        return salesByCashier(getWelfareDb(), input ?? {});
      })),
    /** ROUND 51 — รายชื่อพนักงานขายทั้งหมดจากบิลจริง (ตัวเลือกตัวกรองเจาะจงในรายงาน) */
    cashiers: publicProcedure
      .input(z.unknown().optional())
      .query(() => withStoreErrors(() => salesCashierOptions(getWelfareDb()))),
    memberTransactions: publicProcedure
      .input(memberTransactionsInput)
      .query(({ input }) => withStoreErrors(() => {
        requireEdition("reportsAdvanced"); // ROUND 61 — ธุรกรรมสมาชิกทั้งระบบ = เวอร์ชันโปรขึ้นไป (สเตตเมนต์รายคนยังใช้ได้ทุกเวอร์ชัน)
        return memberTransactions(getWelfareDb(), input ?? {});
      })),
    // Req 23.2 — คำขอลดวงเงินทั้งหมด (รอพิจารณาขึ้นก่อน) + จำนวนค้างพิจารณาสำหรับ badge
    limitRequests: publicProcedure
      .input(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional(), limit: z.number().int().min(1).max(200).optional() }).optional())
      .query(({ input }) =>
        withStoreErrors(() => ({
          items: listLimitRequests(getWelfareDb(), input ?? {}),
          pendingCount: countPendingLimitRequests(getWelfareDb()),
        })),
      ),
    businessPeriod: publicProcedure
      .input(z.unknown().optional())
      .query(() => withStoreErrors(() => businessPeriodStatus(getWelfareDb()))),
    closeDay: publicProcedure
      .input(z.object({ note: z.string().max(300).optional(), actor: z.string().optional(), actorRole: z.string().optional() }).nullish())
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input ?? {});
        return withStoreErrors(() => closeBusinessDay(getWelfareDb(), { ...(input ?? {}), actor, actorRole }));
      }),
    /** ประวัติการตัดยอดรอบขาย (ล่าสุดขึ้นก่อน) */
    closures: publicProcedure
      .input(z.number().int().min(1).max(90).nullish())
      .query(({ input }) => withStoreErrors(() => listDayClosures(getWelfareDb(), input ?? 30))),
  }),

  settings: router({
    get: publicProcedure
      .input(z.unknown().optional())
      .query(() => withStoreErrors(() => getSettings(getWelfareDb()))),
    set: publicProcedure
      .input(settingsPatchInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, {});
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การตั้งค่าระบบต้องใช้สิทธิ์ผู้บริหาร" });
          }
          return setSettings(getWelfareDb(), input ?? {}, actor ?? "ผู้บริหาร", actorRole);
        });
      }),
  }),

  // ROUND 61 (user) — ระบบเวอร์ชัน 3 แบบ (ทั่วไป/โปร/โปรพลัส):
  // ดูสถานะเวอร์ชันปัจจุบัน · ใช้รหัสลิขสิทธิ์ · เริ่มทดลองใช้ · (เจ้าของระบบ) ออกรหัสให้ลูกค้า
  edition: router({
    /** สถานะเวอร์ชันที่ใช้งานจริง — ใช้ทั้งตกแต่ง UI และตรวจสิทธิ์ฝั่งหน้าจอ */
    status: publicProcedure
      .input(z.unknown().optional())
      .query(() => withStoreErrors(() => resolveEditionStatus(getSettings(getWelfareDb())))),
    /** ใช้รหัสลิขสิทธิ์ (ผู้บริหาร): ตรวจรหัส → บันทึก + audit · รหัสหมดอายุ/ไม่ถูกต้อง = BAD_REQUEST ไทย */
    applyLicense: publicProcedure
      .input(z.object({ key: z.string().min(8).max(40), licensedTo: z.string().max(120).optional() }))
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, {});
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การใช้รหัสลิขสิทธิ์ต้องใช้สิทธิ์ผู้บริหาร" });
          }
          const db = getWelfareDb();
          const key = input.key.trim().toUpperCase();
          const parsed = parseLicenseKey(key);
          if (!parsed) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "รหัสลิขสิทธิ์ไม่ถูกต้อง — ตรวจว่าพิมพ์ครบทุกกลุ่ม ไม่มีอักขระเกิน/ขาด" });
          }
          if (parsed.expiresAt !== null && parsed.expiresAt < todayString()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `รหัสลิขสิทธิ์นี้หมดอายุแล้ว ( ${parsed.expiresAt} ) — ติดต่อผู้ขายเพื่อรับรหัสใหม่` });
          }
          const licensedTo = input.licensedTo?.trim() || getSettings(db).storeName || actor || "ผู้ถือลิขสิทธิ์";
          setEditionSettings(db, { licenseKey: key, licenseName: licensedTo });
          logAction(
            db,
            "ใช้รหัสลิขสิทธิ์",
            actor ?? "ผู้บริหาร",
            `เปิดใช้${EDITIONS[parsed.edition].label}${parsed.expiresAt ? ` ถึง ${parsed.expiresAt}` : " ถาวร"} · ผู้ถือ: ${licensedTo}`,
            "green",
            actorRole ?? null,
          );
          return resolveEditionStatus(getSettings(db));
        });
      }),
    /** เริ่มทดลองใช้โปรพลัส (ผู้บริหาร): ทำได้ครั้งเดียวต่อระบบ — ถ้าเคยทดลองแล้วจะปฏิเสธ */
    startTrial: publicProcedure
      .input(z.unknown().optional())
      .mutation(({ ctx }) => {
        const { actor, actorRole } = resolveActor(ctx, {});
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การเริ่มทดลองใช้ต้องใช้สิทธิ์ผู้บริหาร" });
          }
          const db = getWelfareDb();
          const settings = getSettings(db);
          if ((settings.trialStart ?? "").trim()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `ระบบนี้เริ่มทดลองใช้ไปแล้วเมื่อ ${settings.trialStart} (ทดลองได้ครั้งเดียว) — ใส่รหัสลิขสิทธิ์เพื่อใช้ต่อ` });
          }
          setEditionSettings(db, { trialStart: todayString() });
          logAction(db, "เริ่มทดลองใช้", actor ?? "ผู้บริหาร", `ทดลองใช้โปรพลัส ${EDITION_TRIAL_DAYS} วัน`, "blue", actorRole ?? null);
          return resolveEditionStatus(getSettings(db));
        });
      }),
    /** ออกรหัสลิขสิทธิ์ให้ลูกค้า — เจ้าของระบบเท่านั้น (บัญชีผู้พัฒนา ผ่านโซนเครื่องมือติดตั้ง) */
    generateKey: publicProcedure
      .input(z.object({ edition: z.enum(["standard", "pro", "proplus"]), months: z.number().int().min(1).max(48).nullable() }))
      .mutation(({ ctx, input }) =>
        withStoreErrors(() => {
          if (!isDevCtx(ctx)) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การออกรหัสลิขสิทธิ์ใช้ได้เฉพาะบัญชีผู้พัฒนา (เจ้าของระบบ)" });
          }
          const key = generateLicenseKey(input.edition, input.months);
          const db = getWelfareDb();
          logAction(
            db,
            "ออกรหัสลิขสิทธิ์",
            ctx.user?.name ?? "ผู้พัฒนา",
            `${EDITIONS[input.edition].label} ${input.months ? `${input.months} เดือน` : "ถาวร"} · ${key}`,
            "purple",
            "ผู้พัฒนา",
          );
          return { key, edition: input.edition, months: input.months };
        }),
      ),
  }),

  // ROUND 38 (ข้อ 39) — ระบบสำรองข้อมูล: สำรองเดี๋ยวนี้ / รายการไฟล์ / ดาวน์โหลด / กู้คืน (ผู้บริหารเท่านั้น)
  // ROUND 61 — สำรอง–กู้คืนอัตโนมัติเป็นฟีเจอร์เวอร์ชันโปรขึ้นไป (เวอร์ชันทั่วไปสำรองมือ — ก๊อปไฟล์ data\welfare-store.sqlite)
  backup: router({
    create: publicProcedure.mutation(({ ctx }) => {
      const { actor, actorRole } = resolveActor(ctx, {});
      return withStoreErrors(() => {
        if (!isAdminCtx(ctx, {})) {
          throw new TRPCError({ code: "FORBIDDEN", message: "การสำรองข้อมูลต้องใช้สิทธิ์ผู้บริหาร" });
        }
        requireEdition("backupRestore");
        const db = getWelfareDb();
        const keepCount = getSettings(db).backupKeepCount;
        const manifest = backupSqliteDatabase({ sourcePath: getWelfareDbPath(), backupDir: getBackupDir(), retentionDays: 3650 });
        pruneSqliteBackupsByCount(getBackupDir(), keepCount);
        logAction(db, "สำรองข้อมูล", actor ?? "ผู้บริหาร", `สำรองข้อมูลด้วยตนเอง · ${manifest.file}`, "blue", actorRole ?? null);
        return { ...manifest, keepCount };
      });
    }),
    list: publicProcedure
      .input(z.unknown().optional())
      .query(({ ctx }) =>
        withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การดูรายการสำรองข้อมูลต้องใช้สิทธิ์ผู้บริหาร" });
          }
          requireEdition("backupRestore");
          const settings = getSettings(getWelfareDb());
          return {
            backups: listSqliteBackups(getBackupDir()),
            keepCount: settings.backupKeepCount,
            autoEnabled: settings.backupAutoEnabled,
            intervalHours: settings.backupIntervalHours,
          };
        }),
      ),
    download: publicProcedure
      .input(backupFileInput)
      .mutation(({ ctx, input }) =>
        withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การดาวน์โหลดไฟล์สำรองต้องใช้สิทธิ์ผู้บริหาร" });
          }
          requireEdition("backupRestore");
          const backupPath = join(getBackupDir(), input.file);
          if (!existsSync(backupPath)) {
            throw new TRPCError({ code: "NOT_FOUND", message: `ไม่พบไฟล์สำรอง ${input.file}` });
          }
          try {
            verifySqliteBackup(backupPath);
          } catch {
            throw new TRPCError({ code: "BAD_REQUEST", message: "ไฟล์สำรองไม่ถูกต้องหรือตรวจสอบความถูกต้องไม่ผ่าน" });
          }
          return { file: input.file, sizeBytes: statSync(backupPath).size, base64: readFileSync(backupPath).toString("base64") };
        }),
      ),
    restore: publicProcedure
      .input(backupFileInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, {});
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การกู้คืนข้อมูลต้องใช้สิทธิ์ผู้บริหาร" });
          }
          requireEdition("backupRestore");
          const backupPath = join(getBackupDir(), input.file);
          if (!existsSync(backupPath)) {
            throw new TRPCError({ code: "NOT_FOUND", message: `ไม่พบไฟล์สำรอง ${input.file}` });
          }
          try {
            verifySqliteBackup(backupPath);
          } catch {
            throw new TRPCError({ code: "BAD_REQUEST", message: "ไฟล์สำรองไม่ถูกต้องหรือตรวจสอบความถูกต้องไม่ผ่าน" });
          }
          const dbPath = getWelfareDbPath();
          // 1) สำรองไฟล์ป้องกันไว้ก่อนเสมอ — ถ้ากู้คืนพลาด ยังมีไฟล์กลับรออยู่
          let safetyBackupFile: string;
          try {
            safetyBackupFile = backupSqliteDatabase({ sourcePath: dbPath, backupDir: getBackupDir(), retentionDays: 3650 }).file;
          } catch (error) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `สำรองไฟล์ป้องกันก่อนกู้คืนไม่สำเร็จ: ${String(error)}` });
          }
          try {
            // 2) ปิด handle เดิม แล้วลบตัวจริง + WAL/SHM คู่กัน (DatabaseSync จะเปิดใหม่แบบ lazy)
            closeWelfareDb();
            for (const suffix of ["", "-wal", "-shm"]) {
              rmSync(`${dbPath}${suffix}`, { force: true });
            }
            // 3) คัดลอกไฟล์สำรองทับตำแหน่งเดิม พร้อมตรวจ integrity หลังเขียนเสร็จ
            restoreSqliteBackup({ backupPath, targetPath: dbPath, overwrite: true });
          } catch (error) {
            throw new StoreError(`กู้คืนฐานข้อมูลไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)} · ไฟล์ป้องกันที่พึ่งสำรองไว้: ${safetyBackupFile}`);
          }
          // 4) เปิดฐานข้อมูลใหม่ (lazy) แล้วบันทึก audit สีแดง — กู้คืนเป็นเหตุการณ์สำคัญ
          logAction(
            getWelfareDb(),
            "กู้คืนข้อมูล",
            actor ?? "ผู้บริหาร",
            `กู้คืนฐานข้อมูลจากไฟล์สำรอง ${input.file} · สำรองไฟล์ป้องกันไว้ก่อนกู้คืน`,
            "red",
            actorRole ?? null,
          );
          return { ok: true as const, safetyBackupFile };
        });
      }),
  }),

  // ROUND 40 (ข้อ 32) — นำเข้าข้อมูลจริงจาก Excel/CSV: พรีวิว → map คอลัมน์ → นำเข้า (ผู้บริหารเท่านั้น)
  // ROUND 61 — การนำเข้า–ส่งออกเป็นฟีเจอร์เวอร์ชันโปรขึ้นไป (เทมเพลตสำหรับขึ้นระบบอยู่ในแท็บนำเข้าข้อมูล)
  importData: router({
    /** อ่านไฟล์ (base64) → หัวตารางทุกชีต + ตัวอย่างแถว + mapping ที่ระบบเดาให้ — ยังไม่แตะฐานข้อมูล */
    preview: publicProcedure
      .input(
        z.object({
          kind: z.enum(["members", "products"]),
          fileName: z.string().min(1).max(200),
          base64: z.string().min(16).max(7_000_000), // ~5MB ไฟล์จริง
          headerRowOverride: z.number().int().min(0).max(9).optional(),
        }),
      )
      .mutation(({ ctx, input }) =>
        withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การนำเข้าข้อมูลต้องใช้สิทธิ์ผู้บริหาร" });
          }
          requireEdition("importExport");
          return parseSpreadsheetBase64(input.base64, input.kind, input.headerRowOverride);
        }),
      ),
    /** นำเข้าจริง — สำรองข้อมูลเป็นไฟล์ป้องกันก่อนเสมอ */
    execute: publicProcedure
      .input(
        z.object({
          kind: z.enum(["members", "products"]),
          fileName: z.string().min(1).max(200),
          base64: z.string().min(16).max(7_000_000),
          sheetName: z.string().min(1).max(200),
          headerRowIndex: z.number().int().min(0).max(9),
          duplicateMode: z.enum(["skip", "replace"]),
          memberMapping: z
            .object({
              firstName: z.number().int().min(-1).max(99),
              memberNumber: z.number().int().min(-1).max(99).optional(),
              lastName: z.number().int().min(-1).max(99).optional(),
              balance: z.number().int().min(-1).max(99).optional(),
              creditLimit: z.number().int().min(-1).max(99).optional(),
              status: z.number().int().min(-1).max(99).optional(),
              phone: z.number().int().min(-1).max(99).optional(),
              idCard: z.number().int().min(-1).max(99).optional(),
              type: z.number().int().min(-1).max(99).optional(),
              gender: z.number().int().min(-1).max(99).optional(),
            })
            .optional(),
          productMapping: z
            .object({
              name: z.number().int().min(-1).max(99),
              barcode: z.number().int().min(-1).max(99).optional(),
              sku: z.number().int().min(-1).max(99).optional(),
              category: z.number().int().min(-1).max(99).optional(),
              unit: z.number().int().min(-1).max(99).optional(),
              price: z.number().int().min(-1).max(99).optional(),
              cost: z.number().int().min(-1).max(99).optional(),
              stock: z.number().int().min(-1).max(99).optional(),
              reorderPoint: z.number().int().min(-1).max(99).optional(),
              size: z.number().int().min(-1).max(99).optional(),
            })
            .optional(),
        }),
      )
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, {});
        return withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การนำเข้าข้อมูลต้องใช้สิทธิ์ผู้บริหาร" });
          }
          requireEdition("importExport");
          if (input.kind === "members" && (!input.memberMapping || input.memberMapping.firstName < 0)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "กรุณาเลือกคอลัมน์ “ชื่อ” ของสมาชิกก่อนนำเข้า" });
          }
          if (input.kind === "products" && (!input.productMapping || input.productMapping.name < 0)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "กรุณาเลือกคอลัมน์ “ชื่อสินค้า” ก่อนนำเข้า" });
          }
          const { rows } = readSheetRows(input.base64, input.sheetName, input.headerRowIndex);
          if (rows.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "ชีตที่เลือกไม่มีแถวข้อมูลให้นำเข้า" });
          }
          // 1) สำรองไฟล์ป้องกันก่อนนำเข้าเสมอ — ถ้าผลไม่ตามที่คิด กู้คืนกลับได้ทันที
          let safetyBackupFile = "";
          try {
            safetyBackupFile = backupSqliteDatabase({ sourcePath: getWelfareDbPath(), backupDir: getBackupDir(), retentionDays: 3650 }).file;
          } catch (error) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `สำรองไฟล์ป้องกันก่อนนำเข้าไม่สำเร็จ: ${String(error)}` });
          }
          // 2) นำเข้าตาม kind + mapping ที่ผู้บริหารยืนยัน
          const db = getWelfareDb();
          const summary =
            input.kind === "members"
              ? importMembers(db, { rows, mapping: sanitizeMapping(input.memberMapping!) as MemberFieldMapping, duplicateMode: input.duplicateMode, actor, actorRole })
              : importProducts(db, { rows, mapping: sanitizeMapping(input.productMapping!) as ProductFieldMapping, duplicateMode: input.duplicateMode, actor, actorRole });
          return { ...summary, safetyBackupFile, fileName: input.fileName };
        });
      }),
    /** ดาวน์โหลดไฟล์เทมเพลต .xlsx ให้กรอกตามรูปแบบที่ระบบนำเข้าได้ทันที */
    template: publicProcedure
      .input(z.object({ kind: z.enum(["members", "products"]) }))
      .mutation(({ ctx, input }) =>
        withStoreErrors(() => {
          if (!isAdminCtx(ctx, {})) {
            throw new TRPCError({ code: "FORBIDDEN", message: "การดาวน์โหลดเทมเพลตนำเข้าต้องใช้สิทธิ์ผู้บริหาร" });
          }
          requireEdition("importExport");
          return buildTemplateBase64(input.kind);
        }),
      ),
  }),

  logs: router({
    list: publicProcedure
      .input(logsListInput)
      .query(({ input }) => withStoreErrors(() => listAuditLogs(getWelfareDb(), input?.limit ?? 200))),
  }),
});

export type AppRouter = typeof appRouter;
