import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { errorPayload, httpStatusFor } from '@/lib/errors'
import { getSession, requirePermission } from '@/lib/auth'
import { StoreError, NotFoundError } from '@/lib/errors'
import { logAction } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** DELETE /api/sessions/[id] — revoke a single session. Cannot revoke own (use logout instead). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const session = await requirePermission('SYSTEM.SESSION_REVOKE')
    const { id } = await params

    const current = await getSession()
    if (current?.session.id === id) {
      throw new StoreError('ไม่สามารถยกเลิกเซสชันของตัวเองได้ · ใช้ปุ่มออกจากระบบแทน')
    }

    const target = await db.session.findUnique({ where: { id }, include: { user: { select: { username: true } } } })
    if (!target) throw new NotFoundError('ไม่พบเซสชัน')

    await db.session.delete({ where: { id } })

    await logAction({
      action: 'ยกเลิกเซสชัน',
      actorId: session.user.id,
      actor: session.user.displayName,
      actorRole: session.user.role,
      entity: 'session',
      entityId: id,
      detail: `เซสชันของ ${target.user.username}`,
      tone: 'amber',
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    const status = httpStatusFor(err)
    return NextResponse.json(errorPayload(err), { status })
  }
}
