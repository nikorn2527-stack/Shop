import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, StoreError } from '@/lib/api'
import { NotFoundError, StoreError as StoreErr } from '@/lib/errors'
import { round2 } from '@/lib/format'
import { validateImageDataUrl } from '@/lib/scan'

const Body = z.object({
  type: z.enum(['deposit', 'withdrawal', 'refund']),
  amount: z.number().positive(),
  note: z.string().max(500).optional(),
  slipImage: z.string().max(600_000).nullable().optional(),
})

type Ctx = { params: Promise<{ number: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  const { number: memberNumber } = await params
  return withAuth(async (_req, ctx) => {
    const parsed = Body.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

    const member = await db.member.findUnique({ where: { memberNumber } })
    if (!member) throw new NotFoundError('ไม่พบสมาชิก')
    if (member.status !== 'active') throw new StoreError('สมาชิกถูกระงับการใช้งาน')

    const amount = round2(parsed.data.amount)
    const slipUrl = validateImageDataUrl(parsed.data.slipImage ?? null)

    if (parsed.data.type === 'deposit') {
      const newBalance = round2(member.balance + amount)
      await db.$transaction(async (tx) => {
        await tx.member.update({
          where: { id: member.id },
          data: { balance: newBalance },
        })
        await tx.memberTransaction.create({
          data: {
            memberNumber: member.memberNumber,
            type: 'deposit',
            detail: `เติมเงิน ฿${amount.toFixed(2)}${parsed.data.note ? ` · ${parsed.data.note}` : ''}`,
            amount,
            balanceAfter: newBalance,
            paymentMethod: 'เงินสด',
            actor: ctx.displayName,
            slipUrl,
          },
        })
        await tx.auditLog.create({
          data: {
            action: 'เติมเงินสมาชิก',
            actorId: ctx.userId,
            actor: ctx.displayName,
            actorRole: ctx.role,
            entity: 'member',
            entityId: member.id,
            detail: `${member.memberNumber} · เติม ฿${amount.toFixed(2)} · คงเหลือ ฿${newBalance.toFixed(2)}`,
            tone: 'blue',
          },
        })
      })
      return { balanceAfter: newBalance }
    }

    if (parsed.data.type === 'withdrawal' || parsed.data.type === 'refund') {
      if (member.balance < amount) {
        throw new StoreErr(`ยอดเงินคงเหลือไม่พอ · ถอน ฿${amount.toFixed(2)} · คงเหลือ ฿${member.balance.toFixed(2)}`)
      }
      const newBalance = round2(member.balance - amount)
      await db.$transaction(async (tx) => {
        await tx.member.update({
          where: { id: member.id },
          data: { balance: newBalance },
        })
        await tx.memberTransaction.create({
          data: {
            memberNumber: member.memberNumber,
            type: parsed.data.type,
            detail: `${parsed.data.type === 'refund' ? 'คืนบัตรเงินสด' : 'ถอนเงิน'} ฿${amount.toFixed(2)}${parsed.data.note ? ` · ${parsed.data.note}` : ''}`,
            amount: -amount,
            balanceAfter: newBalance,
            paymentMethod: 'เงินสด',
            actor: ctx.displayName,
            slipUrl,
          },
        })
        await tx.auditLog.create({
          data: {
            action: parsed.data.type === 'refund' ? 'คืนบัตรเงินสด' : 'ถอนเงินสมาชิก',
            actorId: ctx.userId,
            actor: ctx.displayName,
            actorRole: ctx.role,
            entity: 'member',
            entityId: member.id,
            detail: `${member.memberNumber} · ${parsed.data.type === 'refund' ? 'คืน' : 'ถอน'} ฿${amount.toFixed(2)} · คงเหลือ ฿${newBalance.toFixed(2)}`,
            tone: parsed.data.type === 'refund' ? 'purple' : 'amber',
          },
        })
      })
      return { balanceAfter: newBalance }
    }

    throw new StoreErr('ประเภทธุรกรรมไม่ถูกต้อง')
  }, 'MEMBER.WALLET')(req)
}
