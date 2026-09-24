import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'

export const GET = withAuth(async () => {
  const warehouses = await db.warehouse.findMany({ orderBy: { code: 'asc' } })
  return { warehouses }
}, 'STOCK.VIEW')
