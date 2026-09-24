import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { round2, bangkokDateString, formatThaiDate, formatThaiDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const rangeDays = Math.min(Math.max(Number(url.searchParams.get('rangeDays') ?? '30'), 1), 365)
  const now = new Date()
  const since = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000)

  const [sales, lowStock, expirySoon, memberWalletAgg, memberCount, recentLogs, newMembers] = await Promise.all([
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
    db.member.count({
      where: { createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
    }),
  ])

  // Aggregate sales per day (Bangkok tz). Use ISO yyyy-MM-dd so the chart can
  // detect weekend bands and sort chronologically.
  const salesByDay = new Map<string, { orders: number; revenue: number; pieces: number }>()
  for (const s of sales) {
    const iso = bangkokDateString(s.createdAt)
    const cur = salesByDay.get(iso) ?? { orders: 0, revenue: 0, pieces: 0 }
    cur.orders += 1
    cur.revenue = round2(cur.revenue + s.total)
    cur.pieces += s.items.reduce((sum, i) => sum + i.qty, 0)
    salesByDay.set(iso, cur)
  }
  const revenueByDay = [...salesByDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([iso, v]) => ({
      date: iso,
      label: formatThaiDate(iso),
      orders: v.orders,
      revenue: v.revenue,
      pieces: v.pieces,
    }))

  // Best sellers (top 10) — by qty, with revenue approximation per item.
  const bestSellerMap = new Map<string, { name: string; qty: number; revenue: number }>()
  const productIds = new Set<string>()
  for (const s of sales) {
    for (const i of s.items) {
      if (i.productId) productIds.add(i.productId)
    }
  }
  const products = productIds.size > 0
    ? await db.product.findMany({ where: { id: { in: [...productIds] } }, select: { id: true, name: true, emoji: true } })
    : []
  const productName = new Map(products.map(p => [p.id, p.name]))
  const productEmoji = new Map(products.map(p => [p.id, p.emoji]))
  for (const s of sales) {
    for (const i of s.items) {
      const name = i.productId ? (productName.get(i.productId) ?? '???') : 'รายการพิเศษ'
      const cur = bestSellerMap.get(name) ?? { name, qty: 0, revenue: 0 }
      cur.qty += i.qty
      cur.revenue = round2(cur.revenue + s.total / Math.max(1, s.items.length))
      bestSellerMap.set(name, cur)
    }
  }
  const bestSellers = [...bestSellerMap.values()]
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10)
    .map(item => ({
      ...item,
      emoji: productEmoji.size > 0
        ? (products.find(p => p.name === item.name)?.emoji ?? '🛍️')
        : '🛍️',
    }))

  const totalSales = round2(sales.reduce((s, x) => s + x.total, 0))
  const totalOrders = sales.length
  const totalPieces = sales.reduce((s, x) => s + x.items.reduce((a, b) => a + b.qty, 0), 0)
  const avgDailySales = round2(totalSales / Math.max(1, rangeDays))
  const bestSellerCount = bestSellers.reduce((sum, b) => sum + b.qty, 0)
  const maxDailyRevenue = revenueByDay.reduce((m, d) => Math.max(m, d.revenue), 0)

  return {
    totalSales,
    totalOrders,
    totalPieces,
    itemsSold: totalPieces,
    avgDailySales,
    revenueByDay,
    bestSellers,
    bestSellerCount,
    maxDailyRevenue,
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
    memberWalletTotal: round2(memberWalletAgg._sum.balance ?? 0),
    memberCount,
    newMembersThisMonth: newMembers,
    recentActivities: recentLogs.map(l => ({
      id: l.id,
      action: l.action,
      actor: l.actor,
      actorRole: l.actorRole,
      detail: l.detail,
      tone: l.tone,
      createdAt: l.createdAt.toISOString(),
      createdAtLabel: formatThaiDateTime(l.createdAt),
    })),
  }
}, 'REPORT.SALES')
