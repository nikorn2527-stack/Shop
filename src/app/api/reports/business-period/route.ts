import { db } from '@/lib/db'
import { withAuth, StoreError } from '@/lib/api'
import { round2 } from '@/lib/format'

/** Get current business period status (open/closed) + today's running totals. */
export const GET = withAuth(async () => {
  const now = new Date()
  const bangkokToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now)
  const startOfDay = new Date(`${bangkokToday}T00:00:00+07:00`)
  const endOfDay = new Date(`${bangkokToday}T23:59:59+07:00`)

  const lastClosure = await db.dayClosure.findFirst({ orderBy: { periodStart: 'desc' } })
  const periodStart = lastClosure?.closedAt ?? startOfDay

  const sales = await db.sale.findMany({
    where: { createdAt: { gte: periodStart, lte: now }, voided: false },
    select: { id: true, total: true, paymentMethod: true, items: { select: { qty: true } } },
  })

  const totals = {
    bills: sales.length,
    pieces: sales.reduce((s, x) => s + x.items.reduce((a, i) => a + i.qty, 0), 0),
    revenue: round2(sales.reduce((s, x) => s + x.total, 0)),
    cash: round2(sales.filter(s => s.paymentMethod === 'เงินสด').reduce((s, x) => s + x.total, 0)),
    qr: round2(sales.filter(s => s.paymentMethod === 'QR / สแกน').reduce((s, x) => s + x.total, 0)),
    wallet: round2(sales.filter(s => s.paymentMethod === 'หักบัญชีสมาชิก').reduce((s, x) => s + x.total, 0)),
  }

  // Wallet transactions in period
  const deposits = await db.memberTransaction.aggregate({
    where: { type: 'deposit', createdAt: { gte: periodStart, lte: now } },
    _sum: { amount: true },
  })
  const withdrawals = await db.memberTransaction.aggregate({
    where: { type: 'withdrawal', createdAt: { gte: periodStart, lte: now } },
    _sum: { amount: true },
  })

  return {
    periodStart: periodStart.toISOString(),
    nextCutOffAt: endOfDay.toISOString(),
    lastClosureAt: lastClosure?.closedAt.toISOString() ?? null,
    totals: {
      ...totals,
      deposits: round2(deposits._sum.amount ?? 0),
      withdrawals: round2(Math.abs(withdrawals._sum.amount ?? 0)),
    },
  }
}, 'REPORT.SALES')

export const POST = withAuth(async (req, ctx) => {
  const body = await req.json().catch(() => ({})) as { note?: string }
  const now = new Date()
  const bangkokToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now)
  const startOfDay = new Date(`${bangkokToday}T00:00:00+07:00`)
  const lastClosure = await db.dayClosure.findFirst({ orderBy: { periodStart: 'desc' } })
  const periodStart = lastClosure?.closedAt ?? startOfDay

  const sales = await db.sale.findMany({
    where: { createdAt: { gte: periodStart, lte: now }, voided: false },
    select: { total: true, paymentMethod: true, items: { select: { qty: true } } },
  })
  const totals = {
    bills: sales.length,
    pieces: sales.reduce((s, x) => s + x.items.reduce((a, i) => a + i.qty, 0), 0),
    revenue: round2(sales.reduce((s, x) => s + x.total, 0)),
    cashTotal: round2(sales.filter(s => s.paymentMethod === 'เงินสด').reduce((s, x) => s + x.total, 0)),
    qrTotal: round2(sales.filter(s => s.paymentMethod === 'QR / สแกน').reduce((s, x) => s + x.total, 0)),
    walletTotal: round2(sales.filter(s => s.paymentMethod === 'หักบัญชีสมาชิก').reduce((s, x) => s + x.total, 0)),
  }
  const deposits = await db.memberTransaction.aggregate({ where: { type: 'deposit', createdAt: { gte: periodStart, lte: now } }, _sum: { amount: true } })
  const withdrawals = await db.memberTransaction.aggregate({ where: { type: 'withdrawal', createdAt: { gte: periodStart, lte: now } }, _sum: { amount: true } })

  const closure = await db.dayClosure.create({
    data: {
      periodStart,
      closedAt: now,
      bills: totals.bills,
      pieces: totals.pieces,
      revenue: totals.revenue,
      cashTotal: totals.cashTotal,
      qrTotal: totals.qrTotal,
      walletTotal: totals.walletTotal,
      deposits: round2(deposits._sum.amount ?? 0),
      withdrawals: round2(Math.abs(withdrawals._sum.amount ?? 0)),
      closedById: ctx.userId,
      closedByName: ctx.displayName,
      note: body.note ?? null,
    },
  })

  return { closure }
}, 'REPORT.SALES')
