import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { round2, bangkokDateRange } from '@/lib/format'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || undefined
  const to = url.searchParams.get('to') || undefined
  const days = url.searchParams.get('days') ? Number(url.searchParams.get('days')) : 30
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '1000'), 5000)

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
    where: { sale: { createdAt: { gte: start, lte: end }, voided: false } },
    include: { sale: { select: { orderNumber: true, createdAt: true, cashierName: true, paymentMethod: true } } },
    orderBy: { sale: { createdAt: 'desc' } },
    take: limit,
  })

  return {
    rows: items.map(i => ({
      id: i.id,
      orderNumber: i.sale.orderNumber,
      date: i.sale.createdAt.toISOString(),
      cashier: i.sale.cashierName ?? 'ไม่ระบุ',
      paymentMethod: i.sale.paymentMethod,
      productName: i.name,
      qty: i.qty,
      price: i.price,
      total: round2(i.price * i.qty),
      cost: i.cost,
      profit: round2((i.price - i.cost) * i.qty),
    })),
  }
}, 'REPORT.SALES')
