import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const search = url.searchParams.get('search')?.trim() || undefined
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '100'), 500)

  const where = search ? {
    OR: [
      { orderNumber: { contains: search } },
      { memberNumber: { contains: search } },
    ],
  } : {}

  const sales = await db.sale.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { items: true },
  })

  return { sales }
}, 'REPORT.SALES')
