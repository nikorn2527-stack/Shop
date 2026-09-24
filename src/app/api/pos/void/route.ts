import { NextRequest } from 'next/server'
import { z } from 'zod'
import { voidSale } from '@/lib/checkout'
import { withAuth, StoreError } from '@/lib/api'

const Body = z.object({
  saleId: z.string().min(1),
  reason: z.string().min(1).max(500),
  approverId: z.string().optional(),
  approverName: z.string().optional(),
})

export const POST = withAuth(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

  const result = await voidSale({
    saleId: parsed.data.saleId,
    reason: parsed.data.reason,
    actorId: ctx.userId,
    actorName: ctx.displayName,
    actorRole: ctx.role,
    approverId: parsed.data.approverId,
    approverName: parsed.data.approverName,
  })

  return result
}, 'POS.VOID')
