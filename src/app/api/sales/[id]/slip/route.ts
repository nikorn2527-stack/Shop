import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'
import { NotFoundError } from '@/lib/errors'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  return withAuth(async () => {
    const sale = await db.sale.findUnique({ where: { id }, select: { slipUrl: true } })
    if (!sale) throw new NotFoundError('ไม่พบบิลนี้')
    return { slipImage: sale.slipUrl }
  }, 'REPORT.SALES')(_req)
}
