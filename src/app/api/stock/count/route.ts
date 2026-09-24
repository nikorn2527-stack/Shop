import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { StoreError, NotFoundError } from '@/lib/errors'
import { recordMovement } from '@/lib/stock'

const Body = z.object({
  productId: z.string().min(1),
  countedQty: z.number().int().min(0),
  note: z.string().max(500).optional(),
})

export const POST = withAuth(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

  const product = await db.product.findUnique({ where: { id: parsed.data.productId } })
  if (!product) throw new NotFoundError('ไม่พบสินค้า')

  const warehouse = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!warehouse) throw new StoreError('ไม่พบคลังหลัก')

  const diff = parsed.data.countedQty - product.stock

  const result = await db.$transaction(async (tx) => {
    // Create stock_count record for audit
    const stockCount = await tx.stockCount.create({
      data: {
        warehouseId: warehouse.id,
        mode: 'total',
        note: parsed.data.note ?? null,
        status: 'completed',
        actorId: ctx.userId,
        actorName: ctx.displayName,
      },
    })

    await tx.stockCountItem.create({
      data: {
        stockCountId: stockCount.id,
        productId: parsed.data.productId,
        systemQty: product.stock,
        countedQty: parsed.data.countedQty,
        diff,
      },
    })

    if (diff !== 0) {
      await recordMovement(tx, {
        type: 'COUNT',
        productId: parsed.data.productId,
        warehouseId: warehouse.id,
        qtyDelta: diff,
        unitCost: product.cost,
        refType: 'stock_count',
        refId: stockCount.id,
        reason: parsed.data.note ?? `นับสต็อก: ระบบ ${product.stock} → นับ ${parsed.data.countedQty}`,
        actorId: ctx.userId,
        actorName: ctx.displayName,
      })
    }

    await tx.auditLog.create({
      data: {
        action: 'นับสต็อก',
        actorId: ctx.userId,
        actor: ctx.displayName,
        actorRole: ctx.role,
        entity: 'stock_count',
        entityId: stockCount.id,
        detail: `${product.name} · ระบบ ${product.stock} · นับ ${parsed.data.countedQty} · ผลต่าง ${diff >= 0 ? '+' : ''}${diff}`,
        tone: diff === 0 ? 'green' : 'amber',
      },
    })

    return { stockCountId: stockCount.id, systemQty: product.stock, countedQty: parsed.data.countedQty, diff }
  })

  return result
}, 'STOCK.COUNT')
