import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { getSession, logout, SESSION_COOKIE, clearSessionCookieOptions } from '@/lib/auth'
import { logAction, withHandler } from '@/lib/api'

export const POST = withHandler(async () => {
  const session = await getSession()
  if (session) {
    await db.auditLog.create({
      data: {
        action: 'ออกจากระบบ',
        actorId: session.user.id,
        actor: session.user.displayName,
        actorRole: session.user.role,
        detail: `ผู้ใช้ ${session.user.username} ออกจากระบบ`,
        tone: 'green',
      },
    }).catch(() => {})
    await logout(session.session.id)
  }
  const res = NextResponse.json({ success: true })
  const store = await cookies()
  store.set(SESSION_COOKIE, '', clearSessionCookieOptions())
  return res
})
