import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { errorPayload, httpStatusFor } from '@/lib/errors'
import { requirePermission } from '@/lib/auth'
import { logAction } from '@/lib/audit'
import { formatThaiDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

/** GET /api/sessions — list all active sessions (SESSION_REVOKE only). */
export async function GET() {
  try {
    await requirePermission('SYSTEM.SESSION_REVOKE')
    const sessions = await db.session.findMany({
      where: { expiresAt: { gte: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      include: { user: { select: { username: true, displayName: true, role: true } } },
    })
    return NextResponse.json({
      sessions: sessions.map(s => ({
        id: s.id,
        userId: s.userId,
        username: s.user.username,
        displayName: s.user.displayName,
        role: s.user.role,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        lastSeenLabel: formatThaiDateTime(s.lastSeenAt),
        expiresAt: s.expiresAt.toISOString(),
      })),
    })
  } catch (err) {
    const status = httpStatusFor(err)
    return NextResponse.json(errorPayload(err), { status })
  }
}
