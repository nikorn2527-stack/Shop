import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'

export const GET = withAuth(async () => {
  const rows = await db.sale.findMany({
    where: { voided: false },
    select: { cashierName: true },
    distinct: ['cashierName'],
  })
  const cashiers = rows.map(r => r.cashierName?.trim() || 'ไม่ระบุพนักงาน')
  const unique = [...new Set(cashiers)]
  return { cashiers: unique }
}, 'REPORT.SALES')
