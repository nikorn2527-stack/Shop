import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { round2, bangkokDateRange } from '@/lib/format'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || undefined
  const to = url.searchParams.get('to') || undefined
  const days = url.searchParams.get('days') ? Number(url.searchParams.get('days')) : 30
  const cashier = url.searchParams.get('cashier') || undefined

  let start: Date
  let end: Date = new Date()
  if (from && to) {
    const range = bangkokDateRange(from, to)
    start = range.gte ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    if (range.lte) end = range.lte
  } else {
    start = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  }

  const where: Record<string, unknown> = {
    createdAt: { gte: start, lte: end },
    voided: false,
  }
  if (cashier) {
    if (cashier === '__UNASSIGNED__') {
      where.OR = [{ cashierName: null }, { cashierName: '' }]
    } else {
      where.cashierName = cashier
    }
  }

  const sales = await db.sale.findMany({
    where,
    select: { id: true, total: true, subtotal: true, discount: true, paymentMethod: true, cashierName: true, createdAt: true, items: { select: { qty: true } } },
  })

  const byCashier = new Map<string, { cashierName: string; orders: number; items: number; revenue: number; discount: number; walletBills: number }>()
  for (const s of sales) {
    const name = s.cashierName?.trim() || 'ไม่ระบุพนักงาน'
    const cur = byCashier.get(name) ?? { cashierName: name, orders: 0, items: 0, revenue: 0, discount: 0, walletBills: 0 }
    cur.orders += 1
    cur.revenue = round2(cur.revenue + s.total)
    cur.discount = round2(cur.discount + s.discount)
    cur.items += s.items.reduce((a, b) => a + b.qty, 0)
    if (s.paymentMethod === 'หักบัญชีสมาชิก') cur.walletBills += 1
    byCashier.set(name, cur)
  }
  const rows = [...byCashier.values()].sort((a, b) => b.revenue - a.revenue)
  return { rows, totals: { orders: rows.reduce((s, x) => s + x.orders, 0), revenue: round2(rows.reduce((s, x) => s + x.revenue, 0)) } }
}, 'REPORT.AUDIT')
