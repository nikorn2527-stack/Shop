import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { StoreError, NotFoundError } from '@/lib/errors'
import { recordMovement, weightedAverageCost } from '@/lib/stock'
import { round2 } from '@/lib/format'

const Body = z.object({
  productId: z.string().min(1),
  lot: z.string().max(60).optional(),
  expiryDate: z.string().datetime().nullable().optional(),
  // Simple form: single qty + cost
  qty: z.number().int().positive().optional(),
  cost: z.number().min(0).optional(),
  // Multi-line form (overrides simple):
  lines: z.array(z.object({
    qty: z.number().int().positive(),
    cost: z.number().min(0).optional(),
  })).optional(),
})

export const POST = withAuth(async (req, ctx) => {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

  const product = await db.product.findUnique({ where: { id: parsed.data.productId } })
  if (!product) throw new NotFoundError('ไม่พบสินค้า')

  const warehouse = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!warehouse) throw new StoreError('ไม่พบคลังหลัก')

  const lines = parsed.data.lines ?? (parsed.data.qty ? [{
    qty: parsed.data.qty,
    cost: parsed.data.cost ?? product.cost,
  }] : [])
  if (!lines.length) throw new StoreError('ต้องระบุจำนวนที่รับเข้า')

  const totalQty = lines.reduce((s, l) => s + l.qty, 0)
  const totalValue = lines.reduce((s, l) => s + l.qty * (l.cost ?? product.cost), 0)
  const newCost = weightedAverageCost(product.stock, product.cost, totalQty, totalValue / totalQty)

  const lotName = parsed.data.lot?.trim() || `LOT-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()).replace(/-/g, '')}`

  const result = await db.$transaction(async (tx) => {
    // Create or update lot (same lot name + product + warehouse)
    let lot = await tx.stockLot.findFirst({
      where: { productId: product.id, warehouseId: warehouse.id, lot: lotName },
    })
    if (!lot) {
      lot = await tx.stockLot.create({
        data: {
          productId: product.id,
          warehouseId: warehouse.id,
          lot: lotName,
          expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : null,
          qty: 0,
          cost: lines[0]?.cost ?? product.cost,
          receivedQty: 0,
        },
      })
    }

    // Update lot qty + receivedQty
    await tx.stockLot.update({
      where: { id: lot.id },
      data: {
        qty: { increment: totalQty },
        receivedQty: { increment: totalQty },
        cost: lines[0]?.cost ?? product.cost,
        expiryDate: parsed.data.expiryDate ? new Date(parsed.data.expiryDate) : lot.expiryDate,
      },
    })

    // Record movement
    await recordMovement(tx, {
      type: 'RECEIVE',
      productId: product.id,
      warehouseId: warehouse.id,
      lotId: lot.id,
      qtyDelta: totalQty,
      unitCost: newCost,
      refType: 'purchase_order',
      reason: `รับเข้า Lot ${lotName}`,
      actorId: ctx.userId,
      actorName: ctx.displayName,
    })

    // Update product cost (weighted average) — stock was bumped by recordMovement
    await tx.product.update({
      where: { id: product.id },
      data: { cost: newCost },
    })

    await tx.auditLog.create({
      data: {
        action: 'รับเข้าสต็อก',
        actorId: ctx.userId,
        actor: ctx.displayName,
        actorRole: ctx.role,
        entity: 'stock_lot',
        entityId: lot.id,
        detail: `${product.name} · Lot ${lotName} · ${totalQty} ${product.unit} · ต้นทุนเฉลี่ย ฿${newCost.toFixed(2)}`,
        tone: 'blue',
      },
    })

    return { lotId: lot.id, lotName, totalQty, newCost }
  })

  return result
}, 'STOCK.RECEIVE')
