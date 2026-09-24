import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { errorPayload, httpStatusFor } from '@/lib/errors'
import { requirePermission, invalidateUserPermissions } from '@/lib/auth'
import { logAction } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** POST /api/users/[id]/unlock — clear failedAttempts + lockedUntil. */
export async function POST(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await requirePermission('SYSTEM.USER_MANAGE')
    const { id } = await params

    const target = await db.user.findUnique({ where: { id } })
    if (!target) {
      return NextResponse.json(errorPayload(new Error('ไม่พบบัญชีผู้ใช้')), { status: 404 })
    }

    await db.user.update({
      where: { id: target.id },
      data: { failedAttempts: 0, lockedUntil: null },
    })

    invalidateUserPermissions(target.id)

    await logAction({
      action: 'ปลดล็อกบัญชีผู้ใช้',
      actorId: session.user.id,
      actor: session.user.displayName,
      actorRole: session.user.role,
      entity: 'user',
      entityId: target.id,
      detail: `${target.username} · ล้างจำนวนครั้งผิดพลาด`,
      tone: 'green',
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    const status = httpStatusFor(err)
    return NextResponse.json(errorPayload(err), { status })
  }
}
