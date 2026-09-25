import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, StoreError, NotFoundError } from '@/lib/api'
import { round2 } from '@/lib/format'
import { logAction } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string }> }

const CloseBody = z.object({
  countedCash: z.number().min(0),
  note: z.string().max(500).optional(),
})

/** POST /api/shifts/[id]/close — close shift with cash count + difference. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  return withAuth(async (_req, ctx) => {
    const parsed = CloseBody.safeParse(await req.json().catch(() => null))
    if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

    const shift = await db.cashierShift.findUnique({ where: { id } })
    if (!shift) throw new NotFoundError('ไม่พบกะที่ระบุ')
    if (shift.status !== 'open') throw new StoreError('กะนี้ถูกปิดไปแล้ว')

    // Compute expected totals from sales in this shift's time range
    const sales = await db.sale.findMany({
      where: {
        cashierId: shift.cashierId,
        createdAt: { gte: shift.openedAt, lte: new Date() },
        voided: false,
      },
      select: { total: true, paymentMethod: true, items: { select: { qty: true } } },
    })

    const expectedCash = round2(shift.openingCash + sales.filter(s => s.paymentMethod === 'เงินสด').reduce((s, x) => s + x.total, 0))
    const expectedQr = round2(sales.filter(s => s.paymentMethod === 'QR / สแกน').reduce((s, x) => s + x.total, 0))
    const expectedWallet = round2(sales.filter(s => s.paymentMethod === 'หักบัญชีสมาชิก').reduce((s, x) => s + x.total, 0))
    const billsCount = sales.length
    const salesTotal = round2(sales.reduce((s, x) => s + x.total, 0))
    const pieces = sales.reduce((s, x) => s + x.items.reduce((a, i) => a + i.qty, 0), 0)
    const cashDifference = round2(parsed.data.countedCash - expectedCash)

    const updated = await db.cashierShift.update({
      where: { id },
      data: {
        status: 'closed',
        countedCash: round2(parsed.data.countedCash),
        expectedCash,
        expectedQr,
        expectedWallet,
        billsCount,
        salesTotal,
        pieces,
        cashDifference,
        note: parsed.data.note ?? shift.note,
        closedAt: new Date(),
      },
    })

    await logAction({
      action: 'ปิดกะขาย',
      actorId: ctx.userId,
      actor: ctx.displayName,
      actorRole: ctx.role,
      entity: 'cashier_shift',
      entityId: shift.id,
      detail: `ปิดกะ · บิล ${billsCount} · ยอด ฿${salesTotal.toFixed(2)} · เงินสดนับ ฿${parsed.data.countedCash.toFixed(2)} · ผลต่าง ${cashDifference >= 0 ? '+' : ''}฿${cashDifference.toFixed(2)}`,
      tone: cashDifference === 0 ? 'green' : 'amber',
    })

    return { shift: updated }
  }, 'POS.SELL')(req)
}
