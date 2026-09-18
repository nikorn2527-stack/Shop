import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { readAppSessionCookie, type TrpcContext } from "./_core/context";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getWelfareDb } from "./welfareStore";
import {
  LOGIN_MAX_FAILURES,
  StoreError,
  checkout,
  clearLoginFailures,
  createAppSession,
  createAppUser,
  createProduct,
  dailySalesRows,
  dashboardStats,
  deleteAppSession,
  deleteMember,
  findAppUserByUsername,
  getMemberDetail,
  getSettings,
  listAppSessions,
  listAppUsers,
  listAuditLogs,
  listMembers,
  listProducts,
  listStockRows,
  logAction,
  loginLockRemainingMinutes,
  memberSpendingStats,
  receiveStock,
  registerLoginFailure,
  registerMember,
  revokeAppSession,
  revokeOtherAppSessions,
  salesList,
  setMemberStatus,
  setProductActive,
  setSettings,
  stockCount,
  stockCountLots,
  unlockAppUser,
  updateAppUser,
  updateMember,
  updateProduct,
  verifyPassword,
  walletTx,
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
      actorRole: ctx.user.role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่",
    };
  }
  return { actor: input.actor, actorRole: input.actorRole };
}

/** Admin gate: session role wins; only anonymous requests fall back to input. */
function isAdminCtx(ctx: TrpcContext, input: { actorRole?: string }) {
  return ctx.user ? ctx.user.role === "admin" : (input.actorRole ?? "").trim() === "ผู้บริหาร";
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
  firstName: z.string().min(1, "กรุณาระบุชื่อสมาชิก"),
  lastName: z.string().min(1, "กรุณาระบุนามสกุลสมาชิก"),
  citizenId: z.string().optional(),
  phone: z.string().optional(),
  type: z.string().optional(),
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
});

const memberUpdateInput = z.object({
  memberNumber: z.string().min(1),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  idCard: z.string().nullish(),
  phone: z.string().nullish(),
  type: z.string().optional(),
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

// A bill line is either a catalog product (barcode/quick-pick) or a "รายการพิเศษ"
// (special/custom line: weighed goods, services, ad-hoc charges — no product row,
// no stock movement). sale_items.product_id is nullable on purpose for these.
const checkoutInput = z.object({
  items: z
    .array(z.union([
      z.object({ productId: z.number().int().positive(), qty: z.number().int().positive() }),
      z.object({ name: z.string().min(1, "กรุณาระบุชื่อรายการพิเศษ"), price: z.number().positive("ราคาต้องมากกว่า 0"), qty: z.number().int().positive(), unit: z.string().optional() }),
    ]))
    .min(1, "ยังไม่มีสินค้าในบิล"),
  paymentMethod: paymentMethodSchema,
  memberNumber: z.string().nullish(),
  discount: z.number().min(0).optional(),
  cashier: z.string().optional(),
  actorRole: z.string().optional(),
});

const productCreateInput = z.object({
  name: z.string().min(1, "กรุณาระบุชื่อสินค้า"),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  unit: z.string().optional(),
  price: z.number().positive("ราคาขายต้องมากกว่า 0"),
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

const reportsDailyInput = z
  .object({ days: z.number().int().min(1).max(365).optional() })
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
    autoPrintReceipt: z.boolean().optional(),
    showBalanceOnReceipt: z.boolean().optional(),
    lowBalanceAlert: z.boolean().optional(),
    lowBalanceThreshold: z.number().min(0).optional(),
    lowStockAlert: z.boolean().optional(),
    expiryAlert: z.boolean().optional(),
    expiryAlertDays: z.number().int().min(1).max(365).optional(),
  })
  .nullish();

const authLoginInput = z.object({
  username: z.string().min(1, "กรุณาระบุชื่อผู้ใช้"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});

const userCreateInput = z.object({
  username: z.string().min(1, "กรุณาระบุชื่อผู้ใช้"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
  displayName: z.string().min(1, "กรุณาระบุชื่อ-นามสกุล"),
  role: z.enum(["staff", "admin"]),
});

const userUpdateInput = z.object({
  userId: z.number().int().positive(),
  displayName: z.string().optional(),
  role: z.enum(["staff", "admin"]).optional(),
  active: z.boolean().optional(),
  password: z.string().optional(),
});

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
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
          clearLoginFailures(db, user.id);
          const roleThai = user.role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
          const session = createAppSession(db, user.id);
          ctx.res.cookie(COOKIE_NAME, session.sessionId, {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            secure: isSecureRequest(ctx.req),
            maxAge: 7 * 24 * 60 * 60 * 1000,
          });
          logAction(db, "เข้าสู่ระบบ", user.displayName, `${user.username} · สิทธิ์ ${roleThai}`, "blue", roleThai);
          return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
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
            const roleThai = ctx.user.role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
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
  }),

  sales: router({
    list: publicProcedure
      .input(salesListInput)
      .query(({ input }) => withStoreErrors(() => salesList(getWelfareDb(), input ?? {}))),
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
        return withStoreErrors(() => stockCount(getWelfareDb(), { ...input, actor, actorRole }));
      }),
    countLots: publicProcedure
      .input(stockCountLotsInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => stockCountLots(getWelfareDb(), { ...input, actor, actorRole }));
      }),
  }),

  pos: router({
    checkout: publicProcedure
      .input(checkoutInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => checkout(getWelfareDb(), { ...input, cashier: input.cashier ?? actor, actorRole }));
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
    update: publicProcedure
      .input(memberUpdateInput)
      .mutation(({ ctx, input }) => {
        const { actor, actorRole } = resolveActor(ctx, input);
        return withStoreErrors(() => updateMember(getWelfareDb(), { ...input, actor, actorRole }));
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
      .query(({ input }) => withStoreErrors(() => dailySalesRows(getWelfareDb(), input?.days ?? 30))),
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

  logs: router({
    list: publicProcedure
      .input(logsListInput)
      .query(({ input }) => withStoreErrors(() => listAuditLogs(getWelfareDb(), input?.limit ?? 200))),
  }),
});

export type AppRouter = typeof appRouter;
