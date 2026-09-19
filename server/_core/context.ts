import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { COOKIE_NAME } from "@shared/const";
import type { User } from "../../drizzle/schema";
import { authenticateAppSession } from "../sqliteStore";
import { getWelfareDb } from "../welfareStore";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

/** Extracts the app session id cookie without a cookie-parser dependency. */
export function readAppSessionCookie(req: CreateExpressContextOptions["req"]): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== "string" || !header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    const name = separator === -1 ? part.trim() : part.slice(0, separator).trim();
    if (name !== COOKIE_NAME) continue;
    const value = separator === -1 ? "" : part.slice(separator + 1).trim();
    return value || undefined;
  }
  return undefined;
}

/** Maps a local app user row onto the drizzle User shape used by ctx.user. */
function toDrizzleUser(user: {
  id: number;
  username: string;
  displayName: string;
  role: "staff" | "admin" | "dev";
  mustChangePassword?: number | boolean;
  createdAt: string;
}): User {
  // created_at is stored as "YYYY-MM-DD HH:mm:ss"; Date parses it as local time
  // when the space is swapped for the ISO "T" separator.
  const createdAt = new Date(user.createdAt.replace(" ", "T"));
  return {
    id: user.id,
    openId: user.username,
    name: user.displayName,
    email: null,
    loginMethod: "local",
    // dev accounts get admin-level access; appRole keeps the real identity.
    role: user.role === "admin" || user.role === "dev" ? "admin" : "user",
    appRole: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
    createdAt,
    updatedAt: createdAt,
    lastSignedIn: createdAt,
  };
}

/**
 * Local session fallback: resolves the app_session_id cookie against the
 * welfare SQLite store. Never throws — auth failures just mean anonymous.
 */
async function authenticateLocalSession(req: CreateExpressContextOptions["req"]): Promise<User | null> {
  try {
    const sessionId = readAppSessionCookie(req);
    if (!sessionId) return null;
    const appUser = authenticateAppSession(getWelfareDb(), sessionId);
    if (!appUser) return null;
    return toDrizzleUser(appUser);
  } catch (error) {
    console.warn("[Auth] Local session lookup failed:", String(error));
    return null;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // Local session ids are UUIDs; OAuth session cookies are JWS compact
  // strings. Skip the OAuth attempt for local sessions so the SDK does not
  // log a JWSInvalid warning on every request from a signed-in local user.
  const cookieValue = readAppSessionCookie(opts.req);
  const isLocalSessionCookie = Boolean(cookieValue && UUID_PATTERN.test(cookieValue));

  if (!isLocalSessionCookie) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch (error) {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  // Sandbox / local fallback: resolve the welfare store's own session cookie
  // when the OAuth session did not produce a user.
  if (!user) {
    user = await authenticateLocalSession(opts.req);
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
