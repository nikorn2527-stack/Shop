import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { round2, bangkokDateRange, formatThaiDate } from '@/lib/format'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || undefined
  const to = url.searchParams.get('to') || undefined
  const days = url.searchParams.get('days') ? Number(url.searchParams.get('days')) : 30
  const memberNumber = url.searchParams.get('memberNumber') || undefined
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

  const where = {
    createdAt: { gte: start, lte: end },
    ...(memberNumber ? { memberNumber } : {}),
  }

  const txs = await db.memberTransaction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return {
    rows: txs.map(t => ({
      id: t.id,
      memberNumber: t.memberNumber,
      type: t.type,
      detail: t.detail,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      paymentMethod: t.paymentMethod,
      actor: t.actor,
      date: t.createdAt.toISOString(),
      dateLabel: formatThaiDate(t.createdAt),
    })),
  }
}, 'REPORT.SALES')
