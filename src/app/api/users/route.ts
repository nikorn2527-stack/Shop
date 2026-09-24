import { NextRequest } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { withAuth, logAction } from '@/lib/api'
import { StoreError, ConflictError } from '@/lib/errors'
import { hashPassword, validatePassword } from '@/lib/auth'
import { formatThaiDateTime } from '@/lib/format'
import { SYSTEM_ROLES } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

/** GET — list all users (without passwordHash). Admin (USER_MANAGE) only. */
export const GET = withAuth(async () => {
  const users = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      active: true,
      mustChangePassword: true,
      failedAttempts: true,
      lockedUntil: true,
      lastSignedIn: true,
      createdAt: true,
    },
  })

  return {
    users: users.map(u => ({
      ...u,
      lockedUntil: u.lockedUntil?.toISOString() ?? null,
      lastSignedIn: u.lastSignedIn?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      createdAtLabel: formatThaiDateTime(u.createdAt),
    })),
  }
}, 'SYSTEM.USER_MANAGE')

const createSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-z0-9_.]+$/, 'ชื่อผู้ใช้ต้องเป็นอังกฤษ/ตัวเลข/._'),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(120),
  role: z.string().max(40),
}).strict()

/** POST — create user (always sets mustChangePassword=true so user picks their own pw on first login). */
export const POST = withAuth(async (req, ctx) => {
  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')
  }
  const username = parsed.data.username.trim().toLowerCase()
  if (!SYSTEM_ROLES.some(r => r.name === parsed.data.role)) {
    throw new StoreError('บทบาทไม่ถูกต้อง')
  }
  // Validate password against the target role's policy.
  const issues = validatePassword(parsed.data.password, parsed.data.role)
  if (issues.length > 0) throw new StoreError(issues.join(' · '))

  const existing = await db.user.findUnique({ where: { username } })
  if (existing) throw new ConflictError(`ชื่อผู้ใช้ ${username} ถูกใช้แล้ว`)

  // Verify password is hashed with bcrypt — bcryptjs returns a string starting with $2.
  const passwordHash = hashPassword(parsed.data.password)
  if (!bcrypt.getRounds(passwordHash)) throw new StoreError('การเข้ารหัสรหัสผ่านล้มเหลว')

  const user = await db.user.create({
    data: {
      username,
      passwordHash,
      displayName: parsed.data.displayName.trim(),
      role: parsed.data.role,
      mustChangePassword: true,
      active: true,
    },
  })

  await logAction({
    action: 'สร้างบัญชีผู้ใช้',
    actorId: ctx.userId,
    actor: ctx.displayName,
    actorRole: ctx.role,
    entity: 'user',
    entityId: user.id,
    detail: `${user.username} · ${user.displayName} · บทบาท ${user.role}`,
    tone: 'blue',
  })

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
    },
  }
}, 'SYSTEM.USER_MANAGE')
