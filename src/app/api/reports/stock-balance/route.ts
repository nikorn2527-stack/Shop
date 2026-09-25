import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { round2, bangkokDateRange } from '@/lib/format'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || undefined
  const to = url.searchParams.get('to') || undefined
  const days = url.searchParams.get('days') ? Number(url.searchParams.get('days')) : 30

  let start: Date
  let end: Date = new Date()
  if (from && to) {
    const range = bangkokDateRange(from, to)
    start = range.gte ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    if (range.lte) end = range.lte
  } else {
    start = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  }

  // Opening stock = product.stock + qty sold in range - qty received in range
  // (approximation — full ledger query would be more accurate but slower)
  const products = await db.product.findMany({
    where: { active: true },
    select: { id: true, sku: true, name: true, unit: true, stock: true, cost: true, price: true },
    orderBy: { name: 'asc' },
  })

  // Aggregate sold qty per product in range
  const soldItems = await db.saleItem.findMany({
    where: {
      productId: { not: null },
      sale: { createdAt: { gte: start, lte: end }, voided: false },
    },
    select: { productId: true, qty: true, price: true, cost: true },
  })
  const soldMap = new Map<string, { qty: number; revenue: number; cogs: number }>()
  for (const i of soldItems) {
    if (!i.productId) continue
    const cur = soldMap.get(i.productId) ?? { qty: 0, revenue: 0, cogs: 0 }
    cur.qty += i.qty
    cur.revenue = round2(cur.revenue + i.price * i.qty)
    cur.cogs = round2(cur.cogs + i.cost * i.qty)
    soldMap.set(i.productId, cur)
  }

  // Aggregate received qty per product in range
  const received = await db.stockMovement.findMany({
    where: { type: 'RECEIVE', createdAt: { gte: start, lte: end } },
    select: { productId: true, qtyDelta: true, unitCost: true },
  })
  const receivedMap = new Map<string, { qty: number; value: number }>()
  for (const r of received) {
    const cur = receivedMap.get(r.productId) ?? { qty: 0, value: 0 }
    cur.qty += r.qtyDelta
    cur.value = round2(cur.value + r.qtyDelta * r.unitCost)
    receivedMap.set(r.productId, cur)
  }

  return {
    range: { from: from ?? null, to: to ?? null, days: days ?? null },
    rows: products.map(p => {
      const sold = soldMap.get(p.id) ?? { qty: 0, revenue: 0, cogs: 0 }
      const recv = receivedMap.get(p.id) ?? { qty: 0, value: 0 }
      const opening = p.stock - sold.qty + recv.qty
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        unit: p.unit,
        opening,
        received: recv.qty,
        receivedValue: recv.value,
        sold: sold.qty,
        soldRevenue: sold.revenue,
        soldCogs: sold.cogs,
        remaining: p.stock,
        remainingValue: round2(p.stock * p.cost),
      }
    }),
  }
}, 'REPORT.INVENTORY')
