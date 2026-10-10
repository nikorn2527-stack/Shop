import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";

type Window = { count: number; expiresAt: number };

/** Per-process protection before password hashing. Never stores passwords or raw account names. */
export class LoginRateLimiter {
  private windows = new Map<string, Window>();
  constructor(
    private readonly windowMs = 5 * 60_000,
    private readonly sourceLimit = 120,
    private readonly accountSourceLimit = 15,
    private readonly maxWindows = 10_000,
  ) {}

  check(source: string, username: string, now = Date.now()): void {
    for (const [key, entry] of Array.from(this.windows.entries())) {
      if (entry.expiresAt <= now) this.windows.delete(key);
    }
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    const sourceKey = `source:${digest(source)}`;
    const pairKey = `account:${digest(JSON.stringify([source, username.trim().toLowerCase()]))}`;
    const rules = [{ key: sourceKey, limit: this.sourceLimit }, { key: pairKey, limit: this.accountSourceLimit }];
    const blocked = rules.map(rule => this.windows.get(rule.key))
      .filter((entry, index) => entry && entry.count >= rules[index].limit);
    if (blocked.length) {
      const seconds = Math.max(1, Math.ceil((Math.max(...blocked.map(entry => entry!.expiresAt)) - now) / 1000));
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `เข้าสู่ระบบถี่เกินไป กรุณารอ ${seconds} วินาทีแล้วลองใหม่` });
    }
    const newKeys = rules.filter(rule => !this.windows.has(rule.key)).length;
    if (this.windows.size + newKeys > this.maxWindows) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "มีคำขอเข้าสู่ระบบจำนวนมาก กรุณารอสักครู่แล้วลองใหม่" });
    }
    for (const rule of rules) {
      const entry = this.windows.get(rule.key);
      if (entry) entry.count++;
      else this.windows.set(rule.key, { count: 1, expiresAt: now + this.windowMs });
    }
  }
}

export const loginRateLimiter = new LoginRateLimiter();

/** Express only derives req.ip from forwarding headers when trust proxy is configured. */
export function loginRequestSource(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return (req.ip || req.socket?.remoteAddress || "unknown").replace(/^::ffff:/, "");
}