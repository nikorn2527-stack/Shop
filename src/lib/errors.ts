/**
 * StoreError — business-rule error carrying a Thai, user-facing message.
 *
 * In tRPC this mapped to BAD_REQUEST. In Next.js Route Handlers we map it to
 * HTTP 400 with `{ error: { code: "BUSINESS_RULE", message } }`.
 *
 * The message must be Thai and actionable — e.g. `สต็อกไม่พอ · น้ำดื่มคริสตัล 600 มล. เหลือ 5 ขวด`.
 */
export class StoreError extends Error {
  readonly code: string
  constructor(message: string, code = 'BUSINESS_RULE') {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

/** Auth-specific errors → HTTP 401 / 403. */
export class AuthError extends Error {
  readonly statusCode: number
  constructor(message: string, statusCode: 401 | 403 = 401) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
  }
}

/** Conflict — duplicate key, concurrent modification. → HTTP 409. */
export class ConflictError extends StoreError {
  constructor(message: string) {
    super(message, 'CONFLICT')
  }
}

/** Not found — entity lookup failed. → HTTP 404. */
export class NotFoundError extends StoreError {
  constructor(message: string) {
    super(message, 'NOT_FOUND')
  }
}

/** Map any thrown error to an HTTP status code for JSON responses. */
export function httpStatusFor(err: unknown): number {
  if (err instanceof AuthError) return err.statusCode
  if (err instanceof NotFoundError) return 404
  if (err instanceof ConflictError) return 409
  if (err instanceof StoreError) return 400
  return 500
}

/** Map any thrown error to a JSON-serializable payload. */
export function errorPayload(err: unknown) {
  if (err instanceof StoreError || err instanceof AuthError) {
    return { error: { code: err.code ?? 'BUSINESS_RULE', message: err.message } }
  }
  if (err instanceof Error) {
    return { error: { code: 'INTERNAL', message: err.message || 'Internal Server Error' } }
  }
  return { error: { code: 'INTERNAL', message: 'Internal Server Error' } }
}
