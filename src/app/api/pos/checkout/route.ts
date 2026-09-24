import { NextRequest } from 'next/server'
import { z } from 'zod'
import { checkout, type PaymentMethod } from '@/lib/checkout'
import { withAuth, StoreError } from '@/lib/api'

const ItemSchema = z.union([
  z.object({
    productId: z.string().min(1),
    qty: z.number().int().positive(),
    price: z.number().positive().optional(),
    unit: z.string().optional(),
    label: z.string().optional(),
  }),
  z.object({
    name: z.string().min(1).max(200),
    price: z.number().positive(),
    qty: z.number().int().positive(),
    unit: z.string().optional(),
  }),
])

const Body = z.object({
  items: z.array(ItemSchema).min(1),
  paymentMethod: z.enum(['เงินสด', 'QR / สแกน', 'หักบัญชีสมาชิก']) as z.ZodType<PaymentMethod>,
  memberNumber: z.string().nullable().optional(),
  discount: z.number().min(0).optional(),
  slipImage: z.string().max(600_000).nullable().optional(),
})

export const POST = withAuth(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

  const result = await checkout({
    items: parsed.data.items,
    paymentMethod: parsed.data.paymentMethod,
    memberNumber: parsed.data.memberNumber ?? null,
    discount: parsed.data.discount ?? 0,
    cashierId: ctx.userId,
    cashierName: ctx.displayName,
    slipImage: parsed.data.slipImage ?? null,
    actorId: ctx.userId,
    actorName: ctx.displayName,
    actorRole: ctx.role,
  })

  return result
}, 'POS.SELL')
