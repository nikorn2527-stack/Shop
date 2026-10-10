import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);


import type { PermissionKey } from "../sqliteStore";
import { hasPermission } from "../sqliteStore";
import { getWelfareDb } from "../welfareStore";

/** Permission middleware — requires the user's role to have the specified permission. */
export function requirePermission(permission: PermissionKey) {
  return t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    const db = getWelfareDb();
    const role = ctx.user.appRole ?? (ctx.user.role === "admin" ? "administrator" : "cashier");
    if (!hasPermission(db, role, permission)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้" });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  });
}

/** Helper: create a procedure that requires a specific permission. */
export function permissionProcedure(permission: PermissionKey) {
  return t.procedure.use(requirePermission(permission));
}
