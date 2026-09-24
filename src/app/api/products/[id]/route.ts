import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { StoreError, NotFoundError, ConflictError } from '@/lib/errors'

type Ctx = { params: Promise<{ id: string }> }

const UpdateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  barcode: z.string().max(60).optional().nullable(),
  categoryId: z.string().optional().nullable(),
  emoji: z.string().max(8).optional(),
  color: z.string().max(20).optional(),
  unit: z.string().max(20).optional(),
  price: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
  reorderPoint: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
  size: z.string().max(40).optional().nullable(),
  imageUrl: z.string().max(600_000).optional().nullable(),
  quickPick: z.boolean().optional(),
  sellMode: z.enum(['unit', 'money']).optional(),
  priceTiers: z.string().max(20_000).optional().nullable(),
})

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  return withAuth(async (_req, ctx) => {
    if (!id) throw new NotFoundError('ไม่พบสินค้า')

    const parsed = UpdateBody.safeParse(body)
    if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

    const existing = await db.product.findUnique({ where: { id } })
    if (!existing) throw new NotFoundError('ไม่พบสินค้า')

    // Barcode uniqueness check
    if (parsed.data.barcode !== undefined && parsed.data.barcode !== existing.barcode) {
      if (parsed.data.barcode) {
        const other = await db.product.findFirst({
          where: { barcode: parsed.data.barcode, NOT: { id } },
        })
        if (other) throw new ConflictError(`บาร์โค้ด ${parsed.data.barcode} ถูกใช้แล้ว`)
      }
    }

    // Validate priceTiers JSON
    if (parsed.data.sellMode === 'money' && parsed.data.priceTiers) {
      try {
        const tiers = JSON.parse(parsed.data.priceTiers)
        if (!Array.isArray(tiers) || tiers.length === 0) throw new Error()
        for (const t of tiers) {
          if (typeof t.label !== 'string' || typeof t.price !== 'number' || typeof t.qty !== 'number') throw new Error()
          if (t.price <= 0 || t.qty <= 0) throw new Error()
        }
      } catch {
        throw new StoreError('priceTiers ไม่ถูกต้อง')
      }
    }

    // Track price change for price_history
    const priceChanged = parsed.data.price !== undefined && parsed.data.price !== existing.price
    const costChanged = parsed.data.cost !== undefined && parsed.data.cost !== existing.cost

    const product = await db.$transaction(async (tx) => {
      const p = await tx.product.update({
        where: { id },
        data: { ...parsed.data },
      })

      if (priceChanged || costChanged) {
        await tx.priceHistory.create({
          data: {
            productId: id,
            price: p.price,
            cost: p.cost,
            reason: 'แก้ไขจากหน้าสินค้า',
            actorId: ctx.userId,
            actorName: ctx.displayName,
          },
        })
      }

      await tx.auditLog.create({
        data: {
          action: 'แก้ไขสินค้า',
          actorId: ctx.userId,
          actor: ctx.displayName,
          actorRole: ctx.role,
          entity: 'product',
          entityId: id,
          detail: `แก้ไข ${p.name} (${p.sku})`,
          tone: 'blue',
        },
      })
      return p
    })

    return { product }
  }, 'STOCK.RECEIVE')(req)
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  return withAuth(async (_req, ctx) => {
    if (!id) throw new NotFoundError('ไม่พบสินค้า')

    const product = await db.product.findUnique({ where: { id } })
    if (!product) throw new NotFoundError('ไม่พบสินค้า')

    const saleRefs = await db.saleItem.count({ where: { productId: id } })

    await db.$transaction(async (tx) => {
      // Hard-delete product + lots (sale_items keep snapshot — not affected)
      await tx.stockMovement.deleteMany({ where: { productId: id } })
      await tx.stockLot.deleteMany({ where: { productId: id } })
      await tx.priceHistory.deleteMany({ where: { productId: id } })
      await tx.product.delete({ where: { id } })

      await tx.auditLog.create({
        data: {
          action: 'ลบสินค้า',
          actorId: ctx.userId,
          actor: ctx.displayName,
          actorRole: ctx.role,
          entity: 'product',
          entityId: id,
          detail: `ลบสินค้า ${product.name} (${product.sku}) · ปรากฏในประวัติขาย ${saleRefs} รายการ`,
          tone: 'red',
        },
      })
    })

    return { deleted: true }
  }, 'STOCK.RECEIVE')(req)
}

export const dynamic = 'force-dynamic'
