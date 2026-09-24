import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { formatThaiDateTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '200'), 1), 1000)
  const search = url.searchParams.get('search')?.trim() || undefined
  const from = url.searchParams.get('from') || undefined
  const to = url.searchParams.get('to') || undefined

  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { action: { contains: search } },
      { actor: { contains: search } },
      { actorRole: { contains: search } },
      { detail: { contains: search } },
    ]
  }
  if (from || to) {
    const range: Record<string, Date> = {}
    if (from) range.gte = new Date(`${from}T00:00:00+07:00`)
    if (to) range.lte = new Date(`${to}T23:59:59+07:00`)
    where.createdAt = range
  }

  const logs = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const [todayCount, userCount, txCount] = await Promise.all([
    db.auditLog.count({ where: { createdAt: { gte: todayStart } } }),
    db.user.count(),
    db.auditLog.count(),
  ])

  return {
    logs: logs.map(l => ({
      id: l.id,
      action: l.action,
      actor: l.actor,
      actorRole: l.actorRole,
      actorIp: l.actorIp,
      entity: l.entity,
      entityId: l.entityId,
      detail: l.detail,
      tone: l.tone,
      createdAt: l.createdAt.toISOString(),
      createdAtLabel: formatThaiDateTime(l.createdAt),
    })),
    stats: {
      todayCount,
      userCount,
      txCount,
    },
  }
}, 'REPORT.AUDIT')
