import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { nextSku } from '@/lib/stock'
import { StoreError, ConflictError } from '@/lib/errors'

const Query = z.object({
  includeInactive: z.coerce.boolean().optional(),
})

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const parsed = Query.safeParse({
    includeInactive: url.searchParams.get('includeInactive') ?? undefined,
  })
  const includeInactive = parsed.success ? parsed.data.includeInactive === true : false

  const products = await db.product.findMany({
    where: includeInactive ? undefined : { active: true },
    include: { category: true },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  })
  return { products }
}, 'STOCK.VIEW')

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  sku: z.string().min(1).max(40).optional(),
  barcode: z.string().max(60).optional(),
  categoryId: z.string().optional(),
  emoji: z.string().max(8).optional(),
  color: z.string().max(20).optional(),
  unit: z.string().max(20).optional(),
  price: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
  stock: z.number().int().min(0).optional(),
  reorderPoint: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
  size: z.string().max(40).optional().nullable(),
  imageUrl: z.string().max(600_000).optional().nullable(),
  quickPick: z.boolean().optional(),
  sellMode: z.enum(['unit', 'money']).optional(),
  priceTiers: z.string().max(20_000).optional().nullable(),
})

export const POST = withAuth(async (req, ctx) => {
  const parsed = CreateBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง')

  // Resolve SKU: explicit > category-based > fallback GEN
  let sku = parsed.data.sku?.trim()
  if (!sku) {
    const categoryName = parsed.data.categoryId
      ? (await db.category.findUnique({ where: { id: parsed.data.categoryId } }))?.name
      : undefined
    sku = await nextSku(categoryName ?? '')
  }

  // Validate price tiers JSON for money mode
  if (parsed.data.sellMode === 'money' && parsed.data.priceTiers) {
    try {
      const tiers = JSON.parse(parsed.data.priceTiers)
      if (!Array.isArray(tiers) || tiers.length === 0) {
        throw new StoreError('priceTiers ต้องเป็น array ไม่ว่าง')
      }
      for (const t of tiers) {
        if (typeof t.label !== 'string' || typeof t.price !== 'number' || typeof t.qty !== 'number') {
          throw new StoreError('priceTiers แต่ละ tier ต้องมี label/price/qty')
        }
        if (t.price <= 0 || t.qty <= 0) throw new StoreError('price/qty ของ tier ต้อง > 0')
      }
    } catch (e) {
      if (e instanceof StoreError) throw e
      throw new StoreError('priceTiers ไม่ใช่ JSON ที่ถูกต้อง')
    }
  }

  // Ensure unique SKU
  const existing = await db.product.findUnique({ where: { sku } })
  if (existing) throw new ConflictError(`รหัสสินค้า ${sku} ถูกใช้แล้ว`)

  // Ensure unique barcode (if provided)
  if (parsed.data.barcode) {
    const existingBc = await db.product.findFirst({ where: { barcode: parsed.data.barcode } })
    if (existingBc) throw new ConflictError(`บาร์โค้ด ${parsed.data.barcode} ถูกใช้แล้ว`)
  }

  const warehouse = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!warehouse) throw new StoreError('ไม่พบคลังหลัก · ติดต่อผู้ดูแล')

  const initialStock = parsed.data.stock ?? 0

  const product = await db.$transaction(async (tx) => {
    const p = await tx.product.create({
      data: {
        sku,
        barcode: parsed.data.barcode ?? null,
        name: parsed.data.name,
        categoryId: parsed.data.categoryId ?? null,
        emoji: parsed.data.emoji ?? '📦',
        color: parsed.data.color ?? '#6d6157',
        unit: parsed.data.unit ?? 'ชิ้น',
        price: parsed.data.price ?? 0,
        cost: parsed.data.cost ?? 0,
        stock: 0, // will be set via movement below
        reorderPoint: parsed.data.reorderPoint ?? 10,
        active: parsed.data.active ?? true,
        size: parsed.data.size ?? null,
        imageUrl: parsed.data.imageUrl ?? null,
        quickPick: parsed.data.quickPick ?? false,
        sellMode: parsed.data.sellMode ?? 'unit',
        priceTiers: parsed.data.priceTiers ?? null,
      },
    })

    // Create opening lot + record movement if initial stock > 0
    if (initialStock > 0) {
      const lot = await tx.stockLot.create({
        data: {
          productId: p.id,
          warehouseId: warehouse.id,
          lot: `INIT-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date()).replace(/-/g, '')}`,
          qty: initialStock,
          cost: p.cost,
          receivedQty: initialStock,
        },
      })
      await tx.stockMovement.create({
        data: {
          type: 'RECEIVE',
          productId: p.id,
          warehouseId: warehouse.id,
          lotId: lot.id,
          qtyDelta: initialStock,
          unitCost: p.cost,
          refType: 'stock_count',
          reason: 'เปิดสินค้าใหม่',
          actorId: ctx.userId,
          actorName: ctx.displayName,
        },
      })
      await tx.product.update({ where: { id: p.id }, data: { stock: initialStock } })
    }

    await tx.auditLog.create({
      data: {
        action: 'เพิ่มสินค้า',
        actorId: ctx.userId,
        actor: ctx.displayName,
        actorRole: ctx.role,
        entity: 'product',
        entityId: p.id,
        detail: `สินค้า ${p.name} (${p.sku}) · ราคา ฿${p.price.toFixed(2)} · สต็อก ${initialStock}`,
        tone: 'blue',
      },
    })
    return p
  })

  return { product }
}, 'STOCK.RECEIVE')
