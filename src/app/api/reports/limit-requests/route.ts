import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const status = url.searchParams.get('status') || undefined
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '200'), 500)

  const where = status ? { status } : {}
  const rows = await db.limitRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const pendingCount = await db.limitRequest.count({ where: { status: 'pending' } })

  return {
    rows: rows.map(r => ({
      id: r.id,
      memberNumber: r.memberNumber,
      currentLimit: r.currentLimit,
      requestedLimit: r.requestedLimit,
      reason: r.reason,
      status: r.status,
      requestedByName: r.requestedByName,
      decidedByName: r.decidedByName,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    pendingCount,
  }
}, 'REPORT.SALES')
