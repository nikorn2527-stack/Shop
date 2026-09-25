import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { round2, formatThaiDate } from '@/lib/format'

export const GET = withAuth(async (req) => {
  const url = new URL(req.url as string)
  const search = url.searchParams.get('search') || undefined

  const where = search ? {
    OR: [
      { memberNumber: { contains: search } },
      { firstName: { contains: search } },
      { lastName: { contains: search } },
      { cardNumber: { contains: search } },
      { patientCode: { contains: search } },
    ],
  } : {}

  const members = await db.member.findMany({
    where,
    orderBy: { memberNumber: 'asc' },
    take: 500,
  })

  // Compute total in/out per member
  const memberNumbers = members.map(m => m.memberNumber)
  const txAgg = memberNumbers.length > 0
    ? await db.memberTransaction.groupBy({
        by: ['memberNumber'],
        where: { memberNumber: { in: memberNumbers } },
        _sum: { amount: true },
      })
    : []
  const inOutMap = new Map<string, { totalIn: number; totalOut: number }>()
  for (const a of txAgg) {
    const sum = a._sum.amount ?? 0
    inOutMap.set(a.memberNumber, {
      totalIn: round2(Math.max(0, sum)),
      totalOut: round2(Math.abs(Math.min(0, sum))),
    })
  }

  return {
    rows: members.map(m => {
      const io = inOutMap.get(m.memberNumber) ?? { totalIn: 0, totalOut: 0 }
      return {
        id: m.id,
        memberNumber: m.memberNumber,
        name: `${m.prename ?? ''} ${m.firstName} ${m.lastName}`.trim(),
        firstName: m.firstName,
        lastName: m.lastName,
        type: m.type,
        balance: round2(m.balance),
        totalIn: io.totalIn,
        totalOut: io.totalOut,
        status: m.status,
        cardNumber: m.cardNumber,
        patientCode: m.patientCode,
        createdAt: m.createdAt.toISOString(),
        createdLabel: formatThaiDate(m.createdAt),
      }
    }),
    totals: {
      memberCount: members.length,
      totalBalance: round2(members.reduce((s, m) => s + m.balance, 0)),
      totalIn: round2(members.reduce((s, m) => s + (inOutMap.get(m.memberNumber)?.totalIn ?? 0), 0)),
      totalOut: round2(members.reduce((s, m) => s + (inOutMap.get(m.memberNumber)?.totalOut ?? 0), 0)),
    },
  }
}, 'REPORT.SALES')
