import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withHandler, logAction } from '@/lib/api'
import { getSession, requirePermission, hashPassword, validatePassword, invalidateUserPermissions } from '@/lib/auth'
import { StoreError, NotFoundError, ConflictError, errorPayload, httpStatusFor } from '@/lib/errors'
import { SYSTEM_ROLES } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  role: z.string().max(40).optional(),
  active: z.boolean().optional(),
  newPassword: z.string().min(8).max(128).optional(),
}).strict()

type Ctx = { params: Promise<{ id: string }> }

/** PATCH /api/users/[id] — update user (display name / role / active / reset password). */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params
    const session = await requirePermission('SYSTEM.USER_MANAGE')

    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')
    }

    const target = await db.user.findUnique({ where: { id } })
    if (!target) throw new NotFoundError('ไม่พบบัญชีผู้ใช้')

    const next: Record<string, unknown> = {}
    if (parsed.data.displayName !== undefined) {
      next.displayName = parsed.data.displayName.trim()
    }
    if (parsed.data.role !== undefined) {
      if (!SYSTEM_ROLES.some(r => r.name === parsed.data.role)) {
        throw new StoreError('บทบาทไม่ถูกต้อง')
      }
      next.role = parsed.data.role
    }
    if (parsed.data.active !== undefined) {
      next.active = parsed.data.active
    }
    if (parsed.data.newPassword !== undefined) {
      const issues = validatePassword(parsed.data.newPassword, parsed.data.role ?? target.role)
      if (issues.length > 0) throw new StoreError(issues.join(' · '))
      next.passwordHash = hashPassword(parsed.data.newPassword)
      next.mustChangePassword = false
    }

    // Last-admin guard — cannot demote or deactivate the last administrator.
    const isDemotion = parsed.data.role !== undefined && parsed.data.role !== 'administrator'
    const isDeactivation = parsed.data.active === false
    if ((isDemotion || isDeactivation) && target.role === 'administrator') {
      const adminCount = await db.user.count({ where: { role: 'administrator', active: true } })
      if (adminCount <= 1) {
        throw new ConflictError('ไม่สามารถเปลี่ยนบทบาทหรือระงับผู้ดูแลระบบคนสุดท้ายได้')
      }
    }

    if (Object.keys(next).length === 0) {
      return NextResponse.json({ noChange: true })
    }

    const updated = await db.user.update({
      where: { id: target.id },
      data: next,
    })

    if (parsed.data.role !== undefined) {
      invalidateUserPermissions(target.id)
    }

    const changes: string[] = []
    if (parsed.data.displayName !== undefined) changes.push(`ชื่อ → ${parsed.data.displayName}`)
    if (parsed.data.role !== undefined) changes.push(`บทบาท → ${parsed.data.role}`)
    if (parsed.data.active !== undefined) changes.push(`สถานะ → ${parsed.data.active ? 'ใช้งาน' : 'ระงับ'}`)
    if (parsed.data.newPassword !== undefined) changes.push('รีเซ็ตรหัสผ่าน')

    await logAction({
      action: 'แก้ไขบัญชีผู้ใช้',
      actorId: session.user.id,
      actor: session.user.displayName,
      actorRole: session.user.role,
      entity: 'user',
      entityId: updated.id,
      detail: `${updated.username} · ${changes.join(' · ')}`,
      tone: 'amber',
    })

    // If we reset the password, revoke all sessions (admin-set pw should land at login).
    if (parsed.data.newPassword !== undefined) {
      await db.session.deleteMany({ where: { userId: updated.id } }).catch(() => {})
    }

    return NextResponse.json({
      user: {
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        role: updated.role,
        active: updated.active,
        mustChangePassword: updated.mustChangePassword,
      },
    })
  } catch (err) {
    const status = httpStatusFor(err)
    if (status >= 500) console.error('[api/users/[id]] PATCH error:', err)
    return NextResponse.json(errorPayload(err), { status })
  }
}

// Touch unused binding so type-check stays alive.
void withHandler
void getSession
