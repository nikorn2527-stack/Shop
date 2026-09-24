import { NextRequest } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { changeOwnPassword, getSession, SESSION_COOKIE } from '@/lib/auth'
import { logAction, withHandler, StoreError } from '@/lib/api'

const Body = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
})

export const POST = withHandler(async (req: NextRequest, { ip }) => {
  const session = await getSession()
  if (!session) throw new StoreError('กรุณาเข้าสู่ระบบก่อนเปลี่ยนรหัสผ่าน')
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')
  }
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  await changeOwnPassword(session.user.id, parsed.data.currentPassword, parsed.data.newPassword, sessionId)

  await logAction({
    action: 'เปลี่ยนรหัสผ่าน',
    actorId: session.user.id,
    actor: session.user.displayName,
    actorRole: session.user.role,
    actorIp: ip,
    entity: 'user',
    entityId: session.user.id,
    detail: `ผู้ใช้ ${session.user.username} เปลี่ยนรหัสผ่านของตัวเอง`,
    tone: 'green',
  })

  return { success: true }
})
