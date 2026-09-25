import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '30'), 90)

  const closures = await db.dayClosure.findMany({
    orderBy: { closedAt: 'desc' },
    take: limit,
  })

  return {
    rows: closures.map(c => ({
      id: c.id,
      periodStart: c.periodStart.toISOString(),
      closedAt: c.closedAt.toISOString(),
      bills: c.bills,
      pieces: c.pieces,
      revenue: c.revenue,
      cashTotal: c.cashTotal,
      qrTotal: c.qrTotal,
      walletTotal: c.walletTotal,
      deposits: c.deposits,
      withdrawals: c.withdrawals,
      closedByName: c.closedByName,
      note: c.note,
    })),
  }
}, 'REPORT.SALES')
