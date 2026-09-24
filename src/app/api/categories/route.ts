import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withAuth } from '@/lib/api'

export const GET = withAuth(async () => {
  const categories = await db.category.findMany({ orderBy: { name: 'asc' } })
  return { categories }
}, 'STOCK.VIEW')

export const POST = withAuth(async (req, ctx) => {
  const body = await req.json().catch(() => null) as { name?: string; skuPrefix?: string } | null
  if (!body?.name?.trim()) {
    const { StoreError } = await import('@/lib/api')
    throw new StoreError('ต้องระบุชื่อหมวดหมู่')
  }
  const category = await db.category.create({
    data: {
      name: body.name.trim(),
      skuPrefix: body.skuPrefix?.trim() || null,
    },
  })
  await db.auditLog.create({
    data: {
      action: 'เพิ่มหมวดหมู่',
      actorId: ctx.userId,
      actor: ctx.displayName,
      actorRole: ctx.role,
      entity: 'category',
      entityId: category.id,
      detail: `สร้างหมวดหมู่ ${category.name}`,
      tone: 'blue',
    },
  })
  return { category }
}, 'STOCK.RECEIVE')
