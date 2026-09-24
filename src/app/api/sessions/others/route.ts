import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { errorPayload, httpStatusFor } from '@/lib/errors'
import { getSession, requirePermission } from '@/lib/auth'
import { logAction } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** POST /api/sessions/others — revoke all sessions except the caller's current session. */
export async function POST(_req: NextRequest) {
  try {
    const session = await requirePermission('SYSTEM.SESSION_REVOKE')
    const current = await getSession()
    const currentId = current?.session.id

    const deleted = await db.session.deleteMany({
      where: { NOT: currentId ? { id: currentId } : undefined },
    })

    await logAction({
      action: 'ยกเลิกเซสชันอื่น',
      actorId: session.user.id,
      actor: session.user.displayName,
      actorRole: session.user.role,
      entity: 'session',
      detail: `ลบเซสชันอื่น ${deleted.count} รายการ`,
      tone: 'amber',
    })

    return NextResponse.json({ revoked: deleted.count })
  } catch (err) {
    const status = httpStatusFor(err)
    return NextResponse.json(errorPayload(err), { status })
  }
}
