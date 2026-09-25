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

  const sales = await db.sale.findMany({
    where: { createdAt: { gte: start, lte: end }, voided: false },
    include: { items: { select: { qty: true, price: true, cost: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const byDay = new Map<string, { date: string; orders: number; items: number; revenue: number; cogs: number; profit: number }>()
  for (const s of sales) {
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(s.createdAt)
    const cur = byDay.get(dayKey) ?? { date: dayKey, orders: 0, items: 0, revenue: 0, cogs: 0, profit: 0 }
    cur.orders += 1
    cur.revenue = round2(cur.revenue + s.total)
    const lineCogs = s.items.reduce((sum, i) => sum + i.qty * i.cost, 0)
    cur.cogs = round2(cur.cogs + lineCogs)
    cur.items += s.items.reduce((sum, i) => sum + i.qty, 0)
    byDay.set(dayKey, cur)
  }
  const rows = [...byDay.values()].map(d => ({ ...d, profit: round2(d.revenue - d.cogs) }))

  return {
    range: { from: from ?? null, to: to ?? null, days: days ?? null },
    rows,
    totals: {
      orders: rows.reduce((s, x) => s + x.orders, 0),
      items: rows.reduce((s, x) => s + x.items, 0),
      revenue: round2(rows.reduce((s, x) => s + x.revenue, 0)),
      cogs: round2(rows.reduce((s, x) => s + x.cogs, 0)),
      profit: round2(rows.reduce((s, x) => s + x.profit, 0)),
    },
  }
}, 'REPORT.SALES')
