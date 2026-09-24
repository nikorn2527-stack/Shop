import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { formatLastActivity } from '@/lib/format'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url)
  const search = url.searchParams.get('search')?.trim() || undefined
  const status = url.searchParams.get('status') || undefined

  const where = {
    ...(status ? { status } : {}),
    ...(search ? {
      OR: [
        { memberNumber: { contains: search } },
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { cardNumber: { contains: search } },
        { patientCode: { contains: search } },
      ],
    } : {}),
  }

  const members = await db.member.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  // Compute last transaction time per member (1 query)
  const lastTxMap = new Map<string, Date>()
  if (members.length > 0) {
    const lastTx = await db.memberTransaction.groupBy({
      by: ['memberNumber'],
      where: { memberNumber: { in: members.map(m => m.memberNumber) } },
      _max: { createdAt: true },
    })
    for (const r of lastTx) {
      if (r._max.createdAt) lastTxMap.set(r.memberNumber, r._max.createdAt)
    }
  }

  return {
    members: members.map(m => ({
      ...m,
      lastTransactionAt: lastTxMap.get(m.memberNumber)?.toISOString() ?? null,
      lastActivityLabel: formatLastActivity(lastTxMap.get(m.memberNumber) ?? null),
    })),
  }
}, 'MEMBER.VIEW')
