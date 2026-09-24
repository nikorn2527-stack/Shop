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

  const items = await db.saleItem.findMany({
    where: {
      sale: { createdAt: { gte: start, lte: end }, voided: false },
    },
    include: {
      product: { select: { category: { select: { name: true } } } },
    },
  })

  const byCategory = new Map<string, { category: string; orders: Set<string>; qty: number; revenue: number }>()
  for (const it of items) {
    const category = it.product?.category?.name ?? 'รายการพิเศษ'
    const cur = byCategory.get(category) ?? { category, orders: new Set<string>(), qty: 0, revenue: 0 }
    cur.qty += it.qty
    cur.revenue = round2(cur.revenue + it.price * it.qty)
    if (it.saleId) cur.orders.add(it.saleId)
    byCategory.set(category, cur)
  }
  const rows = [...byCategory.values()].map(r => ({
    category: r.category,
    orderCount: r.orders.size,
    qty: r.qty,
    revenue: r.revenue,
  })).sort((a, b) => b.revenue - a.revenue)

  return { rows, totals: { revenue: round2(rows.reduce((s, x) => s + x.revenue, 0)), qty: rows.reduce((s, x) => s + x.qty, 0) } }
}, 'REPORT.SALES')
