/**
 * Route Handler helpers — wrap a function that throws StoreError/AuthError/etc.
 * into a Next.js Response with the correct status code + JSON payload.
 *
 * Usage in app/api/<path>/route.ts:
 *   export const POST = withAuth(async (req, ctx) => { ... return data }, 'POS.SELL')
 */

import { NextRequest, NextResponse } from 'next/server'
import { AuthError, errorPayload, httpStatusFor, StoreError } from './errors'
import { getSession, requirePermission, type PermissionKey } from './auth'
import { logAction } from './audit'

export type ApiHandler = (req: NextRequest, ctx: { ip: string }) => Promise<unknown> | unknown
export type AuthedHandler = (
  req: NextRequest,
  ctx: { userId: string; role: string; displayName: string; ip: string },
) => Promise<unknown> | unknown

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  const xri = req.headers.get('x-real-ip')
  if (xri) return xri
  return 'unknown'
}

/** Wrap a public handler — maps errors to JSON. */
export function withHandler(handler: ApiHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      const result = await handler(req, { ip: clientIp(req) })
      if (result instanceof NextResponse) return result
      return NextResponse.json(result)
    } catch (err) {
      const status = httpStatusFor(err)
      const payload = errorPayload(err)
      if (status >= 500) {
        console.error('[api] 500:', err)
      }
      return NextResponse.json(payload, { status })
    }
  }
}

/** Wrap a handler that requires an authenticated session. */
export function withAuth(handler: AuthedHandler, permission?: PermissionKey) {
  return withHandler(async (req, { ip }) => {
    const session = permission
      ? await requirePermission(permission)
      : await getSession()
    if (!session) {
      throw new AuthError('กรุณาเข้าสู่ระบบ (10001)', 401)
    }
    return handler(req, {
      userId: session.user.id,
      role: session.user.role,
      displayName: session.user.displayName,
      ip,
    })
  })
}

/** Wrap a handler that requires ANY of the listed permissions. */
export function withAnyPermission(handler: AuthedHandler, permissions: PermissionKey[]) {
  return withHandler(async (req, { ip }) => {
    const session = await requireAnyPermissionInternal(permissions)
    return handler(req, {
      userId: session.user.id,
      role: session.user.role,
      displayName: session.user.displayName,
      ip,
    })
  })
}

async function requireAnyPermissionInternal(permissions: PermissionKey[]) {
  const { requireAnyPermission } = await import('./auth')
  return requireAnyPermission(permissions)
}

/** Helper: build a JSON OK response. */
export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init)
}

/** Helper: build a JSON error response. */
export function fail(err: unknown): NextResponse {
  return NextResponse.json(errorPayload(err), { status: httpStatusFor(err) })
}

/** Re-export for convenience in route handlers. */
export { StoreError, AuthError } from './errors'
export { logAction } from './audit'
