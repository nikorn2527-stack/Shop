import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { getWelfareDb } from "./welfareStore";
import {
  StoreError,
  checkout,
  createProduct,
  dailySalesRows,
  dashboardStats,
  deleteMember,
  getMemberDetail,
  getSettings,
  listAuditLogs,
  listMembers,
  listProducts,
  listStockRows,
  receiveStock,
  registerMember,
  setMemberStatus,
  setSettings,
  stockCount,
  updateMember,
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

const checkoutInput = z.object({
  items: z
    .array(z.object({ productId: z.number().int(), qty: z.number().int() }))
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

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  product: router({
    list: publicProcedure
      .input(z.unknown().optional())
      .query(() => withStoreErrors(() => listProducts(getWelfareDb()))),
    create: publicProcedure
      .input(productCreateInput)
      .mutation(({ input }) => withStoreErrors(() => createProduct(getWelfareDb(), input))),
  }),

  stock: router({
    rows: publicProcedure
      .input(z.unknown().optional())
      .query(() => withStoreErrors(() => listStockRows(getWelfareDb()))),
    receive: publicProcedure
      .input(stockReceiveInput)
      .mutation(({ input }) =>
        withStoreErrors(() =>
          receiveStock(
            getWelfareDb(),
            input.productId,
            input.lot ?? "",
            input.expiryDate ?? null,
            input.qty,
            input.cost,
            input.actor,
            input.actorRole,
          ),
        ),
      ),
    count: publicProcedure
      .input(stockCountInput)
      .mutation(({ input }) => withStoreErrors(() => stockCount(getWelfareDb(), input))),
  }),

  pos: router({
    checkout: publicProcedure
      .input(checkoutInput)
      .mutation(({ input }) => withStoreErrors(() => checkout(getWelfareDb(), input))),
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
    register: publicProcedure
      .input(memberRegisterInput)
      .mutation(({ input }) => withStoreErrors(() => registerMember(getWelfareDb(), input))),
    setStatus: publicProcedure
      .input(memberSetStatusInput)
      .mutation(({ input }) =>
        withStoreErrors(() => setMemberStatus(getWelfareDb(), input.memberNumber, input.suspended, input.actor, input.actorRole)),
      ),
    wallet: publicProcedure
      .input(memberWalletInput)
      .mutation(({ input }) => withStoreErrors(() => walletTx(getWelfareDb(), input))),
    update: publicProcedure
      .input(memberUpdateInput)
      .mutation(({ input }) => withStoreErrors(() => updateMember(getWelfareDb(), input))),
    delete: publicProcedure
      .input(memberDeleteInput)
      .mutation(({ input }) =>
        withStoreErrors(() => {
          if ((input.actorRole ?? "").trim() !== "ผู้บริหาร") {
            throw new TRPCError({ code: "FORBIDDEN", message: "การลบสมาชิกต้องใช้สิทธิ์ผู้บริหาร" });
          }
          return deleteMember(getWelfareDb(), input);
        }),
      ),
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
      .mutation(({ input }) =>
        withStoreErrors(() => setSettings(getWelfareDb(), input ?? {})),
      ),
  }),

  logs: router({
    list: publicProcedure
      .input(logsListInput)
      .query(({ input }) => withStoreErrors(() => listAuditLogs(getWelfareDb(), input?.limit ?? 200))),
  }),
});

export type AppRouter = typeof appRouter;
