import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, StoreError } from '@/lib/api'
import { NotFoundError } from '@/lib/errors'

const Body = z.object({
  suspended: z.boolean(),
})

type Ctx = { params: Promise<{ number: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  const { number: memberNumber } = await params
  return withAuth(async (_req, ctx) => {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

    const member = await db.member.findUnique({ where: { memberNumber } })
    if (!member) throw new NotFoundError('ไม่พบสมาชิก')

    if (member.status === (parsed.data.suspended ? 'suspended' : 'active')) {
      return { noChange: true }
    }

    await db.$transaction(async (tx) => {
      await tx.member.update({
        where: { id: member.id },
        data: { status: parsed.data.suspended ? 'suspended' : 'active' },
      })
      await tx.auditLog.create({
        data: {
          action: parsed.data.suspended ? 'ระงับสมาชิก' : 'ปลดระงับสมาชิก',
          actorId: ctx.userId,
          actor: ctx.displayName,
          actorRole: ctx.role,
          entity: 'member',
          entityId: member.id,
          detail: `${member.memberNumber} · ${member.firstName} ${member.lastName}`,
          tone: parsed.data.suspended ? 'red' : 'green',
        },
      })
    })

    return { suspended: parsed.data.suspended }
  }, 'MEMBER.EDIT')(req)
}
