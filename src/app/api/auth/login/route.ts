import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureSystemSeed, login, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/auth'
import { logAction, withHandler, StoreError } from '@/lib/api'

const Body = z.object({
  username: z.string().min(1).max(60),
  password: z.string().min(1).max(200),
})

export const POST = withHandler(async (req: NextRequest, { ip }) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    throw new StoreError('ข้อมูลไม่ถูกต้อง · กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
  }
  // Ensure system seed (warehouse, roles, permissions, settings) is ready.
  await ensureSystemSeed()
  const { user, sessionId } = await login(parsed.data.username, parsed.data.password, ip)

  await logAction({
    action: 'เข้าสู่ระบบ',
    actorId: user.id,
    actor: user.displayName,
    actorRole: user.role,
    actorIp: ip,
    entity: 'user',
    entityId: user.id,
    detail: `ผู้ใช้ ${user.username} เข้าสู่ระบบ`,
    tone: user.role === 'dev_service' ? 'red' : 'blue',
  })

  const res = NextResponse.json({ user })
  res.cookies.set(SESSION_COOKIE, sessionId, SESSION_COOKIE_OPTIONS)
  return res
})
