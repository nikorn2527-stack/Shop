import { getRuntimePolicy } from "../runtimePolicy";
import os from "node:os";
import { statSync } from "node:fs";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getVersion, getVersionInfo } from "./version";
import { getWelfareDb, getWelfareDbPath } from "../welfareStore";
import {
  getSchemaVersion,
  listReleases,
  logRelease,
} from "../sqliteStore";
import type { TrpcContext } from "./context";

/**
 * P4 — `system.health` is intentionally PUBLIC (no auth) so an external load
 * balancer, uptime monitor or `curl` from a cron job can probe it without a
 * session cookie. The endpoint reports:
 *   • `status: "ok"`         — always "ok" if the procedure returns at all
 *                              (any DB/JS error propagates as a 5xx via tRPC)
 *   • `version`              — app semver from package.json
 *   • `uptime`               — process.uptime() in seconds (since last boot)
 *   • `db.connected`         — true when the SQLite file is on disk & stat-able
 *   • `db.sizeBytes`         — file size of welfare-store.sqlite (0 if missing)
 *   • `memory.usedMB`        — process.memoryUsage().rssUsed in MB (rss)
 *   • `memory.totalMB`       — os.totalmem() in MB (host total, not V8 cap)
 *   • `timestamp`            — ISO string of when this row was produced
 *
 * The optional `timestamp` input is preserved for the existing Settings page
 * latency probe (which sends `Date.now()` and ignores the response body). New
 * load-balancer callers can omit the input entirely.
 *
 * Returns a flat `status`/`version`/... shape so it is easy to consume from
 * any monitoring system without tRPC-specific wrappers.
 */
export const systemRouter = router({
  experience: publicProcedure.query(() => getRuntimePolicy()),
  health: publicProcedure
    .input(
      z
        .object({
          timestamp: z.number().min(0, "timestamp cannot be negative"),
        })
        .optional(),
    )
    .query(() => {
      const info = getVersionInfo();
      const mem = process.memoryUsage();
      const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;
      let dbConnected = false;
      let dbSizeBytes = 0;
      try {
        const stats = statSync(getWelfareDbPath());
        dbConnected = true;
        dbSizeBytes = stats.size;
      } catch {
        // DB file missing OR not yet created — surface as disconnected.
        // (getWelfareDb lazily creates the file on first use; a fresh boot
        // that hasn't been hit by any request yet will legitimately report
        // disconnected + 0 bytes until the first DB-touching procedure runs.)
        dbConnected = false;
        dbSizeBytes = 0;
      }
      return {
        status: "ok" as const,
        version: info.version,
        uptime: Math.round(process.uptime()),
        db: {
          connected: dbConnected,
          sizeBytes: dbSizeBytes,
        },
        memory: {
          usedMB: mb(mem.rss),
          totalMB: mb(os.totalmem()),
        },
        timestamp: new Date().toISOString(),
      };
    }),

  /**
   * P4 — Release history (newest-first). Admin-only because release notes may
   * mention internal actor hostnames, backup paths and migration JSON. Staff
   * don't need this — the audit log on the "ประวัติระบบ" page already surfaces
   * a Thai summary of every release/rollback action.
   */
  releases: adminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).optional(),
        })
        .optional(),
    )
    .query(({ input }) => {
      const db = getWelfareDb();
      return {
        releases: listReleases(db, input?.limit ?? 100),
        schemaVersion: getSchemaVersion(db),
        appVersion: getVersion(),
      };
    }),

  /**
   * P4 — Append a release/rollback/hotfix/install entry. Dev-only: scripts
   * and engineers running `scripts/update.sh` / `scripts/rollback.sh` record
   * the result here; admins see the entry on the "ประวัติระบบ" page via the
   * audit log that logRelease() writes alongside the release_logs row.
   *
   * Refuses staff/admin (non-dev) callers — recording a release is a
   * system-maintenance action, not a normal shop operation, and we don't
   * want a curious admin to be able to forge a fake "rollback" entry.
   */
  logRelease: publicProcedure
    .input(
      z.object({
        version: z.string().min(1).max(40),
        action: z.enum(["install", "update", "rollback", "hotfix"]),
        notes: z.string().max(2000).nullish(),
        migrations: z.string().max(4000).nullish(),
        backupFile: z.string().max(300).nullish(),
        healthCheck: z.string().max(4000).nullish(),
        actor: z.string().max(120).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => {
      if (!isDevCtx(ctx)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "การบันทึกประวัติ release ใช้ได้เฉพาะบัญชีผู้พัฒนา (dev/administrator)",
        });
      }
      const actorRole =
        ctx.user?.appRole === "dev"
          ? "ผู้พัฒนา"
          : ctx.user?.appRole === "administrator"
            ? "ผู้บริหาร"
            : null;
      const db = getWelfareDb();
      return logRelease(db, {
        version: input.version,
        action: input.action,
        notes: input.notes ?? null,
        migrations: input.migrations ?? null,
        backupFile: input.backupFile ?? null,
        healthCheck: input.healthCheck ?? null,
        actor: input.actor ?? ctx.user?.name ?? null,
        actorRole,
      });
    }),

  /**
   * ROUND 42 (ข้อ 32 ตอนที่ 2 — LAN + คลาวด์) — ข้อมูลเครื่องเซิร์ฟเวอร์สำหรับ
   * หน้า "ตั้งค่า → การเชื่อมต่อ": ไอพี LAN ที่เครื่องอื่นในร้านจะใช้เข้าระบบ,
   * พอร์ต, เวลาที่เซิร์ฟเวอร์เปิดมาแล้ว, แพลตฟอร์ม — ให้ผู้บริหารตรวจสอบและ
   * แจ้ง URL ให้จุดขายอื่นได้เองโดยไม่ต้องเข้าเครื่องเซิร์ฟเวอร์
   */
  lanInfo: adminProcedure.query(() => {
    const addresses: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list ?? []) {
        // IPv4 ที่ไม่ใช่ loopback ภายใน = ไอพีที่ใช้ได้จริงบน LAN (Wi-Fi / สายแลน)
        if (net.family === "IPv4" && !net.internal) addresses.push(net.address);
      }
    }
    return {
      addresses,
      port: parseInt(process.env.PORT || "3000", 10),
      // ROUND 57 — เซิร์ฟเวอร์กำลังรัน https อยู่ไหม (HTTPS=1) เพื่อให้หน้า
      // การเชื่อมต่อเสนอ URL ที่ถูก scheme + บอกสถานะกล้องได้ถูกต้อง
      https: process.env.HTTPS === "1",
      uptimeSeconds: Math.round(process.uptime()),
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    };
  }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      }),
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});

/**
 * Dev-gate used by `system.logRelease`. Mirrors `isDevCtx` in
 * `server/routers.ts` — admin-role session + (appRole=dev OR appRole=administrator).
 * Duplicated locally so the system router stays self-contained (no circular
 * import into the big router module).
 */
function isDevCtx(ctx: TrpcContext): boolean {
  if (!ctx.user || ctx.user.role !== "admin") return false;
  return ctx.user.appRole === "dev" || ctx.user.appRole === "administrator";
}
