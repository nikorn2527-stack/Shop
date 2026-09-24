import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, StoreError } from '@/lib/api'
import { recordMovement } from '@/lib/stock'

const Body = z.object({
  counts: z.array(z.object({
    lotId: z.string().min(1),
    countedQty: z.number().int().min(0),
  })).min(1),
  note: z.string().max(500).optional(),
})

export const POST = withAuth(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

  // Group counts by product to compute total diff
  const lots = await db.stockLot.findMany({
    where: { id: { in: parsed.data.counts.map(c => c.lotId) } },
    include: { product: true },
  })
  if (lots.length === 0) throw new StoreError('ไม่พบ lot ที่ระบุ')

  const warehouse = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!warehouse) throw new StoreError('ไม่พบคลังหลัก')

  const result = await db.$transaction(async (tx) => {
    const stockCount = await tx.stockCount.create({
      data: {
        warehouseId: warehouse.id,
        mode: 'lots',
        note: parsed.data.note ?? null,
        status: 'completed',
        actorId: ctx.userId,
        actorName: ctx.displayName,
      },
    })

    const summaries: { lotId: string; productId: string; productName: string; systemQty: number; countedQty: number; diff: number }[] = []

    for (const item of parsed.data.counts) {
      const lot = lots.find(l => l.id === item.lotId)
      if (!lot) continue

      const diff = item.countedQty - lot.qty
      await tx.stockCountItem.create({
        data: {
          stockCountId: stockCount.id,
          productId: lot.productId,
          lotId: lot.id,
          systemQty: lot.qty,
          countedQty: item.countedQty,
          diff,
        },
      })

      if (diff !== 0) {
        await recordMovement(tx, {
          type: 'COUNT',
          productId: lot.productId,
          warehouseId: warehouse.id,
          lotId: lot.id,
          qtyDelta: diff,
          unitCost: lot.cost,
          refType: 'stock_count',
          refId: stockCount.id,
          reason: `นับแยก Lot ${lot.lot}: ${lot.qty} → ${item.countedQty}`,
          actorId: ctx.userId,
          actorName: ctx.displayName,
        })
      }

      summaries.push({
        lotId: lot.id,
        productId: lot.productId,
        productName: lot.product.name,
        systemQty: lot.qty,
        countedQty: item.countedQty,
        diff,
      })
    }

    await tx.auditLog.create({
      data: {
        action: 'นับสต็อกแยก Lot',
        actorId: ctx.userId,
        actor: ctx.displayName,
        actorRole: ctx.role,
        entity: 'stock_count',
        entityId: stockCount.id,
        detail: `${parsed.data.counts.length} lot · ผลต่างรวม ${summaries.reduce((s, x) => s + x.diff, 0)}`,
        tone: 'blue',
      },
    })

    return { stockCountId: stockCount.id, summaries }
  })

  return result
}, 'STOCK.COUNT')
