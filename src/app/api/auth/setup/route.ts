import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ensureSystemSeed, setupInitialAdmin, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/auth'
import { logAction, withHandler, StoreError } from '@/lib/api'

const Body = z.object({
  username: z.string().min(3).max(30),
  displayName: z.string().min(1).max(80),
  password: z.string().min(8).max(200),
  storeName: z.string().max(120).optional(),
})

export const POST = withHandler(async (req: NextRequest, { ip }) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')
  }
  await ensureSystemSeed()
  const { user, sessionId } = await setupInitialAdmin(parsed.data)

  await logAction({
    action: 'ลงทะเบียนผู้ดูแลระบบหลัก',
    actorId: user.id,
    actor: user.displayName,
    actorRole: user.role,
    actorIp: ip,
    entity: 'user',
    entityId: user.id,
    detail: `ตั้งค่าระบบครั้งแรก · ผู้ดูแล ${user.username}`,
    tone: 'purple',
  })

  const res = NextResponse.json({ user })
  res.cookies.set(SESSION_COOKIE, sessionId, SESSION_COOKIE_OPTIONS)
  return res
})
