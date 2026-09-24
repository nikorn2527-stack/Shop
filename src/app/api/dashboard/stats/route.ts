import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { round2, bangkokDateRange, formatThaiDate } from '@/lib/format'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const rangeDays = Math.min(Math.max(Number(url.searchParams.get('rangeDays') ?? '30'), 1), 365)
  const now = new Date()
  const since = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000)

  const [sales, lowStock, expirySoon, memberWalletTotal, memberCount, recentLogs] = await Promise.all([
    db.sale.findMany({
      where: { createdAt: { gte: since }, voided: false },
      select: { total: true, createdAt: true, paymentMethod: true, items: { select: { qty: true, productId: true } } },
    }),
    db.product.findMany({
      where: { active: true, stock: { lte: db.product.fields.reorderPoint } },
      select: { id: true, name: true, stock: true, unit: true, reorderPoint: true },
    }),
    db.stockLot.findMany({
      where: {
        expiryDate: { gte: now, lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
        qty: { gt: 0 },
      },
      include: { product: { select: { name: true, unit: true } } },
    }),
    db.member.aggregate({ _sum: { balance: true }, _count: true }),
    db.member.count(),
    db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
  ])

  // Aggregate sales per day (Bangkok tz)
  const salesByDay = new Map<string, { orders: number; revenue: number; pieces: number }>()
  for (const s of sales) {
    const dayKey = formatThaiDate(s.createdAt)
    const cur = salesByDay.get(dayKey) ?? { orders: 0, revenue: 0, pieces: 0 }
    cur.orders += 1
    cur.revenue = round2(cur.revenue + s.total)
    cur.pieces += s.items.reduce((sum, i) => sum + i.qty, 0)
    salesByDay.set(dayKey, cur)
  }
  const revenueByDay = [...salesByDay.entries()].map(([day, v]) => ({ day, ...v }))

  // Best sellers (top 5)
  const bestSellerMap = new Map<string, { name: string; qty: number; revenue: number }>()
  // We need product names — fetch them
  const productIds = new Set<string>()
  for (const s of sales) {
    for (const i of s.items) {
      if (i.productId) productIds.add(i.productId)
    }
  }
  const products = productIds.size > 0 ? await db.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, name: true } }) : []
  const productName = new Map(products.map(p => [p.id, p.name]))
  for (const s of sales) {
    for (const i of s.items) {
      const name = i.productId ? (productName.get(i.productId) ?? '???') : 'รายการพิเศษ'
      const cur = bestSellerMap.get(name) ?? { name, qty: 0, revenue: 0 }
      cur.qty += i.qty
      cur.revenue = round2(cur.revenue + s.total) // approximate
      bestSellerMap.set(name, cur)
    }
  }
  const bestSellers = [...bestSellerMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5)

  const totalSales = round2(sales.reduce((s, x) => s + x.total, 0))
  const totalOrders = sales.length
  const totalPieces = sales.reduce((s, x) => s + x.items.reduce((a, b) => a + b.qty, 0), 0)
  const avgDailySales = round2(totalSales / Math.max(1, rangeDays))

  return {
    totalSales,
    totalOrders,
    totalPieces,
    avgDailySales,
    revenueByDay,
    bestSellers,
    lowStock,
    expirySoon: expirySoon.map(l => ({
      lotId: l.id,
      productId: l.productId,
      productName: l.product.name,
      unit: l.product.unit,
      lot: l.lot,
      expiryDate: l.expiryDate?.toISOString() ?? null,
      expiryLabel: formatThaiDate(l.expiryDate),
      qty: l.qty,
    })),
    memberWalletTotal: round2(memberWalletTotal._sum.balance ?? 0),
    memberCount,
    recentActivities: recentLogs.map(l => ({
      id: l.id,
      action: l.action,
      actor: l.actor,
      actorRole: l.actorRole,
      detail: l.detail,
      tone: l.tone,
      createdAt: l.createdAt.toISOString(),
      createdLabel: formatThaiDate(l.createdAt),
    })),
  }
}, 'REPORT.SALES')
