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
    include: { product: { select: { id: true, name: true, unit: true, sku: true } } },
  })

  const byProduct = new Map<string, { productId: string | null; name: string; sku: string | null; unit: string | null; qty: number; revenue: number; billCount: number }>()
  for (const it of items) {
    const key = it.productId ?? `special:${it.name}`
    const cur = byProduct.get(key) ?? {
      productId: it.productId,
      name: it.name,
      sku: it.product?.sku ?? null,
      unit: it.unit ?? it.product?.unit ?? null,
      qty: 0,
      revenue: 0,
      billCount: 0,
    }
    cur.qty += it.qty
    cur.revenue = round2(cur.revenue + it.price * it.qty)
    cur.billCount += 1
    byProduct.set(key, cur)
  }
  const rows = [...byProduct.values()].sort((a, b) => b.qty - a.qty)

  return { rows, totals: { revenue: round2(rows.reduce((s, x) => s + x.revenue, 0)), qty: rows.reduce((s, x) => s + x.qty, 0) } }
}, 'REPORT.PROFIT')
