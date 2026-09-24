/**
 * Auth — cookie-based session, bcrypt password hashing, idle + absolute timeout.
 *
 * Cookie name: `app_session_id` (matches original Shop — easy migration).
 *
 * Session lifecycle:
 *   - Created on login (UUID)
 *   - Idle timeout: 30 minutes since lastSeenAt → expired
 *   - Absolute timeout: 7 days since createdAt → expired
 *   - Revocable by admin or by user (logout / "kill other sessions")
 *
 * Per Technical Review P0 Security:
 *   - actorRole MUST come from session, never from client payload.
 *   - Login failure throttling: 5 attempts → 15-min lockout.
 */

import { cookies } from 'next/headers'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { db } from './db'
import {
  AuthError,
  ConflictError,
  NotFoundError,
  StoreError,
} from './errors'

export const SESSION_COOKIE = 'app_session_id'
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const SESSION_IDLE_MS = 30 * 60 * 1000 // 30 minutes
export const LOGIN_MAX_FAILURES = 5
export const LOGIN_LOCK_MS = 15 * 60 * 1000 // 15 minutes

const BCRYPT_ROUNDS = 10

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS)
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash)
  } catch {
    return false
  }
}

/** Password strength rules. dev_service requires symbol + 12+ chars. */
export interface PasswordPolicy {
  minLength: number
  needLetter: boolean
  needDigit: boolean
  needSymbol: boolean
}

export function passwordPolicyForRole(role: string): PasswordPolicy {
  if (role === 'dev_service' || role === 'administrator') {
    return { minLength: 12, needLetter: true, needDigit: true, needSymbol: true }
  }
  return { minLength: 8, needLetter: true, needDigit: true, needSymbol: false }
}

export function validatePassword(plain: string, role: string): string[] {
  const policy = passwordPolicyForRole(role)
  const issues: string[] = []
  if (plain.length < policy.minLength) {
    issues.push(`รหัสผ่านต้องมีความยาวอย่างน้อย ${policy.minLength} ตัวอักษร`)
  }
  if (policy.needLetter && !/[A-Za-z]/.test(plain)) {
    issues.push('ต้องมีตัวอักษรอย่างน้อย 1 ตัว')
  }
  if (policy.needDigit && !/[0-9]/.test(plain)) {
    issues.push('ต้องมีตัวเลขอย่างน้อย 1 ตัว')
  }
  if (policy.needSymbol && !/[^A-Za-z0-9]/.test(plain)) {
    issues.push('ต้องมีสัญลักษณ์อย่างน้อย 1 ตัว')
  }
  return issues
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string
  username: string
  displayName: string
  role: string
  mustChangePassword: boolean
}

export interface ResolvedSession {
  user: SessionUser
  session: { id: string; expiresAt: Date; lastSeenAt: Date }
}

/**
 * Resolve the current session from the cookie. Returns null if:
 * - no cookie present
 * - session not found in DB
 * - session expired (absolute)
 * - session idle-expired (lastSeenAt too old)
 * - user account deactivated
 *
 * Side effect: bumps `lastSeenAt` if more than 5 minutes stale (avoids hot writes).
 */
export async function getSession(): Promise<ResolvedSession | null> {
  const store = await cookies()
  const sessionId = store.get(SESSION_COOKIE)?.value
  if (!sessionId) return null

  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: { user: true },
  })
  if (!session) return null

  const now = Date.now()

  // Absolute timeout
  if (now - session.createdAt.getTime() > SESSION_ABSOLUTE_MS) {
    await db.session.delete({ where: { id: sessionId } }).catch(() => {})
    return null
  }

  // Idle timeout
  if (now - session.lastSeenAt.getTime() > SESSION_IDLE_MS) {
    await db.session.delete({ where: { id: sessionId } }).catch(() => {})
    return null
  }

  if (!session.user.active) return null

  // Bump lastSeenAt if stale by >5 min (reduces write load)
  if (now - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.session.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    }).catch(() => {})
  }

  return {
    user: {
      id: session.user.id,
      username: session.user.username,
      displayName: session.user.displayName,
      role: session.user.role,
      mustChangePassword: session.user.mustChangePassword,
    },
    session: {
      id: session.id,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
    },
  }
}

/** Require an active session. Throws AuthError(401) if absent. */
export async function requireSession(): Promise<ResolvedSession> {
  const s = await getSession()
  if (!s) throw new AuthError('กรุณาเข้าสู่ระบบ (10001)', 401)
  return s
}

/** Require a specific permission. Throws AuthError(403) if missing. */
export async function requirePermission(
  permission: import('./rbac').PermissionKey,
): Promise<ResolvedSession> {
  const s = await requireSession()
  const perms = await getUserPermissions(s.user.id)
  if (!perms.has(permission)) {
    throw new AuthError(`คุณไม่มีสิทธิ์ "${permission}" (10002)`, 403)
  }
  return s
}

/** Require ANY of the listed permissions. */
export async function requireAnyPermission(
  permissions: import('./rbac').PermissionKey[],
): Promise<ResolvedSession> {
  const s = await requireSession()
  const perms = await getUserPermissions(s.user.id)
  if (!permissions.some(p => perms.has(p))) {
    throw new AuthError(`คุณไม่มีสิทธิ์ที่จำเป็น (${permissions.join(' / ')})`, 403)
  }
  return s
}

// Permission cache (per request — module-level Map<userId, Set>)
// In Next.js, modules are cached per-request in dev (with proper revalidation).
// For production, replace with an LRU or Redis cache.
const permCache = new Map<string, { perms: Set<string>; ts: number }>()
const PERM_CACHE_TTL_MS = 60 * 1000 // 1 minute

export async function getUserPermissions(userId: string): Promise<Set<string>> {
  const cached = permCache.get(userId)
  if (cached && Date.now() - cached.ts < PERM_CACHE_TTL_MS) {
    return cached.perms
  }
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  if (!user) return new Set()
  const rolePerms = await db.rolePermission.findMany({
    where: { roleId: user.role },
    select: { permissionKey: true },
  })
  const perms = new Set(rolePerms.map(p => p.permissionKey))
  permCache.set(userId, { perms, ts: Date.now() })
  return perms
}

/** Invalidate cache for a user (call after role/permission changes). */
export function invalidateUserPermissions(userId: string): void {
  permCache.delete(userId)
}

// ---------------------------------------------------------------------------
// Login / logout / registration
// ---------------------------------------------------------------------------

export interface LoginResult {
  user: SessionUser
  sessionId: string
}

export async function login(username: string, password: string, ip?: string): Promise<LoginResult> {
  const uname = username.trim().toLowerCase()
  const user = await db.user.findUnique({ where: { username: uname } })
  if (!user) {
    // Same message for unknown user / wrong password to prevent enumeration.
    throw new AuthError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401)
  }

  // Lockout check — even with correct password, blocked if still locked.
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000)
    throw new AuthError(`บัญชีถูกระงับชั่วคราว · ลองอีกครั้งในอีก ${minutes} นาที`, 403)
  }

  if (!verifyPassword(password, user.passwordHash)) {
    const attempts = user.failedAttempts + 1
    const justLocked = attempts >= LOGIN_MAX_FAILURES
    await db.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: attempts,
        lockedUntil: justLocked ? new Date(Date.now() + LOGIN_LOCK_MS) : user.lockedUntil,
      },
    })
    if (justLocked) {
      throw new AuthError(`บัญชีถูกระงับ ${LOGIN_LOCK_MS / 60_000} นาที จากการพยายามเข้าระบบผิดพลาด ${attempts} ครั้ง`, 403)
    }
    throw new AuthError(`ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (พยายาม ${attempts}/${LOGIN_MAX_FAILURES})`, 401)
  }

  if (!user.active) {
    throw new AuthError('บัญชีนี้ถูกปิดการใช้งาน · ติดต่อผู้ดูแลระบบ', 403)
  }

  // Clear failures + create session FIRST.
  await db.user.update({
    where: { id: user.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      lastSignedIn: new Date(),
    },
  })

  // Auto-upgrade legacy scrypt hash → bcrypt on successful login (sequential, not parallel).
  // This is transparent to the user and ensures all migrated hashes are
  // eventually converted to bcrypt after their first post-migration login.
  if (needsRehash(user.passwordHash)) {
    try {
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: hashPasswordBcrypt(password) },
      })
    } catch {
      // Non-critical: hash upgrade can be retried on next login.
    }
  }

  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS)
  await db.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      expiresAt,
      lastSeenAt: new Date(),
      ip: ip ?? null,
    },
  })

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
    sessionId,
  }
}

export async function logout(sessionId: string): Promise<void> {
  await db.session.delete({ where: { id: sessionId } }).catch(() => {})
}

export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string,
): Promise<void> {
  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) throw new NotFoundError('ไม่พบบัญชีผู้ใช้')
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new AuthError('รหัสผ่านปัจจุบันไม่ถูกต้อง', 401)
  }
  const issues = validatePassword(newPassword, user.role)
  if (issues.length > 0) throw new StoreError(issues.join(' · '))
  if (newPassword === currentPassword) {
    throw new StoreError('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน')
  }
  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: {
        passwordHash: hashPassword(newPassword),
        mustChangePassword: false,
      },
    }),
    // Revoke other sessions (keep keepSessionId if provided)
    ...(keepSessionId
      ? [db.session.deleteMany({ where: { userId, NOT: { id: keepSessionId } } })]
      : [db.session.deleteMany({ where: { userId } })]),
  ])
}

/**
 * First-run setup — only works when no users exist. Creates administrator role
 * user with mustChangePassword=true.
 */
export async function setupInitialAdmin(input: {
  username: string
  displayName: string
  password: string
  storeName?: string
}): Promise<LoginResult> {
  const userCount = await db.user.count()
  if (userCount > 0) {
    throw new ConflictError('ระบบถูกตั้งค่าผู้ดูแลระบบไว้แล้ว · ไม่สามารถลงทะเบียนซ้ำได้')
  }
  const username = input.username.trim().toLowerCase()
  if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
    throw new StoreError('ชื่อผู้ใช้ต้องเป็นอังกฤษ/ตัวเลข/._ ยาว 3-30 ตัวอักษร')
  }
  const issues = validatePassword(input.password, 'administrator')
  if (issues.length > 0) throw new StoreError(issues.join(' · '))

  // Ensure default warehouse exists.
  const warehouse = await db.warehouse.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { name: 'คลังหลัก', code: 'MAIN', isDefault: true },
  })

  // Ensure seed settings exist.
  await ensureDefaultSettings()

  const user = await db.user.create({
    data: {
      username,
      passwordHash: hashPassword(input.password),
      displayName: input.displayName.trim() || username,
      role: 'administrator',
      mustChangePassword: true,
    },
  })

  if (input.storeName) {
    await db.storeSetting.upsert({
      where: { key: 'app_settings' },
      update: {},
      create: { key: 'app_settings', value: JSON.stringify({ storeName: input.storeName }) },
    })
  }

  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS)
  await db.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      expiresAt,
      lastSeenAt: new Date(),
    },
  })

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: true,
    },
    sessionId,
  }
}

/** Ensure default warehouse + settings + roles exist. Idempotent. */
export async function ensureSystemSeed(): Promise<void> {
  // Default warehouse
  await db.warehouse.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { name: 'คลังหลัก', code: 'MAIN', isDefault: true },
  })

  // Roles + permissions
  for (const role of SYSTEM_ROLES_REF) {
    await db.role.upsert({
      where: { name: role.name },
      update: { label: role.label, description: role.description, isSystem: role.isSystem },
      create: {
        name: role.name,
        label: role.label,
        description: role.description,
        isSystem: role.isSystem,
      },
    })
    // Ensure permissions exist
    for (const permKey of role.permissions) {
      const def = PERMISSION_CATALOG.find(p => p.key === permKey)
      if (def) {
        await db.permission.upsert({
          where: { key: def.key },
          update: { group: def.group, description: def.description },
          create: { key: def.key, group: def.group, description: def.description },
        })
      }
      await db.rolePermission.upsert({
        where: { roleId_permissionKey: { roleId: role.name, permissionKey: permKey } },
        update: {},
        create: { roleId: role.name, permissionKey: permKey },
      })
    }
  }

  await ensureDefaultSettings()
}

async function ensureDefaultSettings(): Promise<void> {
  const existing = await db.storeSetting.findUnique({ where: { key: 'app_settings' } })
  if (!existing) {
    await db.storeSetting.create({
      data: { key: 'app_settings', value: JSON.stringify(DEFAULT_SETTINGS) },
    })
  }
}

// Avoid circular import — re-export the constant from rbac.
import { SYSTEM_ROLES as SYSTEM_ROLES_REF, PERMISSION_CATALOG } from './rbac'

export const DEFAULT_SETTINGS = {
  storeName: 'ร้านค้าสวัสดิการ',
  storeCode: 'PNG',
  appName: 'PNG Shop',
  appTheme: 'emerald',
  appStyle: 'shop',
  memberNumberMode: 'running', // running | year | manual
  memberNumberPrefix: 'M',
  memberNumberYearMode: 'none',
  memberNumberYearDigits: 2,
  memberNumberSeparator: '-',
  memberNumberResetMonth: 1,
  memberNumberSequenceDigits: 6,
  dailyCutOffMode: 'auto', // auto | manual
  dailyCutOffTime: '00:00',
  receiptPaperWidth: '72', // 58 | 72 | 80
  showBalanceOnReceipt: true,
  lowBalanceAlert: true,
  lowBalanceThreshold: 100,
  lowStockAlert: true,
  expiryAlert: true,
  expiryAlertDays: 30,
  backupAutoEnabled: false,
  backupIntervalHours: 24,
  backupKeepCount: 14,
  promptpayId: '',
  helpPhone: '',
  posRailHidden: '[]',
  posShortcutKeys: '{}',
  devAccess: false,
  fontScale: 'base', // base | large | xlarge
}

export type StoreSettings = typeof DEFAULT_SETTINGS

export async function getSettings(): Promise<StoreSettings> {
  const row = await db.storeSetting.findUnique({ where: { key: 'app_settings' } })
  if (!row) return DEFAULT_SETTINGS
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.value) as Partial<StoreSettings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function setSettings(patch: Partial<StoreSettings>): Promise<void> {
  const current = await getSettings()
  // Some fields are gated and cannot be changed via generic set:
  delete (patch as Record<string, unknown>).licenseKey
  delete (patch as Record<string, unknown>).licenseName
  delete (patch as Record<string, unknown>).trialStart
  const next = { ...current, ...patch }
  await db.storeSetting.upsert({
    where: { key: 'app_settings' },
    update: { value: JSON.stringify(next) },
    create: { key: 'app_settings', value: JSON.stringify(next) },
  })
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: process.env.NODE_ENV === 'production',
  maxAge: SESSION_ABSOLUTE_MS / 1000,
}

export function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: -1,
  }
}
