/**
 * Dual password verify — supports both legacy scrypt (Shop original) AND bcrypt (new).
 *
 * Strategy:
 *   1. On login: detect hash format
 *      - starts with "scrypt$"  → legacy scrypt (from Shop original /tmp/Shop/server/sqliteStore.ts)
 *      - starts with "$2a$" / "$2b$" / "$2y$" → bcrypt (new Next.js)
 *   2. Verify with the matching algorithm
 *   3. If verified via legacy scrypt → rehash as bcrypt + update DB (transparent to user)
 *
 * This lets existing customers log in with their current password after migration
 * without forcing a password reset. Once they log in once, their hash is upgraded
 * to bcrypt automatically.
 *
 * Legacy scrypt format (from Shop original): `scrypt$<saltHex>$<keyHex>`
 *   - salt: 16 bytes (32 hex chars)
 *   - key:  64 bytes (128 hex chars)
 *   - scrypt parameters: N=16384, r=16, p=1 (from Shop's hashPassword original)
 *
 * Migration path:
 *   - When user logs in with scrypt hash → verify → if success, rehash as bcrypt + UPDATE
 *   - Old scrypt hashes are kept until next successful login (idempotent)
 */

import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'

const BCRYPT_ROUNDS = 10

/** Legacy scrypt parameters — MUST match Shop original `hashPassword()`. */
const SCRYPT_KEYLEN = 64
const SCRYPT_N = 16384
const SCRYPT_R = 16
const SCRYPT_P = 1

/** Detect hash format. */
export type HashFormat = 'scrypt' | 'bcrypt' | 'unknown'

export function detectHashFormat(hash: string): HashFormat {
  if (!hash) return 'unknown'
  if (hash.startsWith('scrypt$')) return 'scrypt'
  if (/^\$2[aby]\$\d+\$/.test(hash)) return 'bcrypt'
  return 'unknown'
}

/** Verify a plaintext password against a stored hash (any format). */
export function verifyPasswordDual(plain: string, hash: string): boolean {
  const format = detectHashFormat(hash)
  if (format === 'scrypt') return verifyScrypt(plain, hash)
  if (format === 'bcrypt') return verifyBcrypt(plain, hash)
  return false
}

/** Hash a password with bcrypt (the new format). */
export function hashPasswordBcrypt(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS)
}

/** Check if a hash needs rehashing (i.e. it's still legacy scrypt). */
export function needsRehash(hash: string): boolean {
  return detectHashFormat(hash) === 'scrypt'
}

// ---------------------------------------------------------------------------
// Internal: legacy scrypt verify (mirrors Shop original `verifyPassword`)
// ---------------------------------------------------------------------------

function verifyScrypt(plain: string, hash: string): boolean {
  try {
    const parts = hash.split('$')
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false
    const salt = Buffer.from(parts[1], 'hex')
    const expectedKey = Buffer.from(parts[2], 'hex')
    if (salt.length !== 16 || expectedKey.length !== SCRYPT_KEYLEN) return false

    const actualKey = scryptSync(plain, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      maxmem: 128 * SCRYPT_KEYLEN * 1024, // generous bound
    })

    // Constant-time comparison to prevent timing attacks.
    if (actualKey.length !== expectedKey.length) return false
    return timingSafeEqual(actualKey, expectedKey)
  } catch {
    return false
  }
}

function verifyBcrypt(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Legacy hash generator (for tests / dev seed compatibility)
// ---------------------------------------------------------------------------

/** Generate a legacy scrypt hash (for tests only — production uses bcrypt). */
export function hashPasswordLegacyScrypt(plain: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_KEYLEN * 1024,
  })
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`
}
