"use client";

/**
 * api-client — Thin fetch wrapper for the JSON API.
 *
 * - Forwards cookies via `credentials: 'include'`.
 * - On non-2xx: throws an Error whose message is the Thai business-rule text
 *   extracted from `{ error: { message } }` (the format produced by
 *   src/lib/errors.ts → errorPayload()).
 * - On 401: hard-redirects to `/` so the Server-Component auth gate at
 *   src/app/page.tsx re-evaluates the session and renders LoginView.
 *
 * Usage:
 *   import { apiGet, apiPost } from '@/lib/api-client'
 *   const me = await apiGet<{ user: SessionUser }>('/api/auth/me')
 *   await apiPost('/api/auth/login', { username, password })
 */

export interface ApiError extends Error {
  /** HTTP status code from the response. */
  status: number;
  /** Optional error code from `{ error: { code } }`. */
  code?: string;
  /** Raw response payload (parsed JSON or text). */
  payload?: unknown;
}

/** Extract the user-facing Thai message from a JSON error payload. */
function extractMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const err = (payload as { error?: unknown }).error;
    if (
      err &&
      typeof err === "object" &&
      typeof (err as { message?: unknown }).message === "string"
    ) {
      return (err as { message: string }).message;
    }
    if (typeof (payload as { message?: unknown }).message === "string") {
      return (payload as { message: string }).message;
    }
  }
  if (typeof payload === "string" && payload.length > 0) return payload;
  return fallback;
}

/** Build the ApiError from a non-OK response. */
function buildApiError(res: Response, payload: unknown): ApiError {
  const message = extractMessage(
    payload,
    `เกิดข้อผิดพลาด (${res.status})`,
  );
  const err = new Error(message) as ApiError;
  err.name = "ApiError";
  err.status = res.status;
  if (payload && typeof payload === "object") {
    const code = (payload as { error?: { code?: unknown } }).error?.code;
    if (typeof code === "string") err.code = code;
  }
  err.payload = payload;
  return err;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: { Accept: "application/json" },
  };

  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] =
      "application/json";
    init.body = JSON.stringify(body);
  }

  // 30-second timeout — prevents infinite hang if server is slow to compile.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: controller.signal });
  } catch (networkErr) {
    const isAbort = networkErr instanceof DOMException && networkErr.name === "AbortError";
    const err = new Error(
      isAbort
        ? "คำขอใช้เวลานานเกินไป · ลองอีกครั้งใน 30 วินาที (server อาจจะ compile อยู่)"
        : "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ · ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่",
    ) as ApiError;
    err.name = "ApiError";
    err.status = 0;
    err.code = isAbort ? "TIMEOUT" : "NETWORK";
    err.payload = networkErr;
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  // Read body once — try JSON, fall back to text, fall back to empty.
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    const trimmed = text.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    } else {
      parsed = text;
    }
  }

  if (!res.ok) {
    // Only auto-reload on 401 if we're NOT on login/setup/change-password pages.
    // On login page, 401 should show a toast error instead of reloading (which
    // would make it look like nothing happened).
    if (res.status === 401 && typeof window !== "undefined") {
      const path = window.location.pathname;
      const isAuthPage = path === "/" || path === "/login" || path === "/setup" || path === "/change-password";
      if (!isAuthPage) {
        window.location.href = "/";
        throw buildApiError(res, parsed);
      }
    }
    throw buildApiError(res, parsed);
  }

  return parsed as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>("GET", path);
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("PATCH", path, body);
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>("DELETE", path);
}

/** True if the thrown value is an ApiError with status 401. */
export function isUnauthorized(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status?: number }).status === 401
  );
}
