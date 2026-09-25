import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, StoreError } from '@/lib/api'
import { round2 } from '@/lib/format'
import { logAction } from '@/lib/audit'

/** GET /api/shifts — list shifts (current user's or all if admin). */
export const GET = withAuth(async (req, ctx) => {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') // 'open' | 'closed' | undefined
  const mineOnly = url.searchParams.get('mine') === '1'

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (mineOnly) where.cashierId = ctx.userId

  const shifts = await db.cashierShift.findMany({
    where,
    orderBy: { openedAt: 'desc' },
    take: 50,
  })

  return {
    shifts: shifts.map(s => ({
      id: s.id,
      cashierId: s.cashierId,
      cashierName: s.cashierName,
      status: s.status,
      openingCash: s.openingCash,
      expectedCash: s.expectedCash,
      countedCash: s.countedCash,
      cashDifference: s.cashDifference,
      expectedQr: s.expectedQr,
      expectedWallet: s.expectedWallet,
      billsCount: s.billsCount,
      salesTotal: s.salesTotal,
      note: s.note,
      openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null,
    })),
  }
}, 'POS.SELL')

const OpenBody = z.object({
  openingCash: z.number().min(0).default(0),
  note: z.string().max(500).optional(),
})

/** POST /api/shifts — open a new shift (only one open per cashier). */
export const POST = withAuth(async (req, ctx) => {
  const parsed = OpenBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

  // Check if user already has an open shift
  const existing = await db.cashierShift.findFirst({
    where: { cashierId: ctx.userId, status: 'open' },
  })
  if (existing) {
    throw new StoreError('คุณมีกะที่เปิดอยู่แล้ว · ปิดกะปัจจุบันก่อนเปิดใหม่')
  }

  const warehouse = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!warehouse) throw new StoreError('ไม่พบคลังหลัก')

  const shift = await db.cashierShift.create({
    data: {
      cashierId: ctx.userId,
      cashierName: ctx.displayName,
      warehouseId: warehouse.id,
      status: 'open',
      openingCash: round2(parsed.data.openingCash),
      expectedCash: round2(parsed.data.openingCash),
      expectedQr: 0,
      expectedWallet: 0,
      billsCount: 0,
      salesTotal: 0,
      note: parsed.data.note ?? null,
    },
  })

  await logAction({
    action: 'เปิดกะขาย',
    actorId: ctx.userId,
    actor: ctx.displayName,
    actorRole: ctx.role,
    entity: 'cashier_shift',
    entityId: shift.id,
    detail: `เปิดกะ · เงินตั้งต้น ฿${parsed.data.openingCash.toFixed(2)}`,
    tone: 'blue',
  })

  return { shift }
}, 'POS.SELL')
