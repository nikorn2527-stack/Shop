import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withAuth, logAction } from '@/lib/api'
import { StoreError } from '@/lib/errors'
import { getSettings, setSettings, type StoreSettings } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** GET — return the current store settings (admin only). */
export const GET = withAuth(async () => {
  return await getSettings()
}, 'SYSTEM.SETTING')

const patchSchema = z.object({
  storeName: z.string().max(120).optional(),
  storeCode: z.string().max(20).optional(),
  appName: z.string().max(120).optional(),
  appTheme: z.string().max(40).optional(),
  appStyle: z.string().max(40).optional(),
  memberNumberMode: z.enum(['running', 'year', 'manual']).optional(),
  memberNumberPrefix: z.string().max(20).optional(),
  memberNumberYearMode: z.enum(['none', 'buddhist', 'gregorian']).optional(),
  memberNumberYearDigits: z.union([z.literal(2), z.literal(4)]).optional(),
  memberNumberSeparator: z.enum(['-', '/', '_', '']).optional(),
  memberNumberResetMonth: z.number().int().min(1).max(12).optional(),
  memberNumberSequenceDigits: z.number().int().min(1).max(10).optional(),
  dailyCutOffMode: z.enum(['auto', 'manual']).optional(),
  dailyCutOffTime: z.string().max(8).optional(),
  receiptPaperWidth: z.enum(['58', '72', '80']).optional(),
  showBalanceOnReceipt: z.boolean().optional(),
  lowBalanceAlert: z.boolean().optional(),
  lowBalanceThreshold: z.number().min(0).max(1_000_000).optional(),
  lowStockAlert: z.boolean().optional(),
  expiryAlert: z.boolean().optional(),
  expiryAlertDays: z.number().int().min(1).max(365).optional(),
  backupAutoEnabled: z.boolean().optional(),
  backupIntervalHours: z.number().int().min(1).max(720).optional(),
  backupKeepCount: z.number().int().min(1).max(365).optional(),
  promptpayId: z.string().max(40).optional(),
  helpPhone: z.string().max(40).optional(),
  posRailHidden: z.string().max(2000).optional(),
  posShortcutKeys: z.string().max(2000).optional(),
  devAccess: z.boolean().optional(),
  fontScale: z.enum(['base', 'large', 'xlarge']).optional(),
}).strict()

/** PATCH — update a subset of store settings (admin only). */
export const PATCH = withAuth(async (req, ctx) => {
  const body = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    throw new StoreError(parsed.error.issues[0]?.message ?? 'ข้อมูลตั้งค่าไม่ถูกต้อง')
  }
  const patch = parsed.data as Partial<StoreSettings>

  // Snapshot the changed keys for the audit log detail.
  const changedKeys = Object.keys(patch)
  if (changedKeys.length === 0) {
    throw new StoreError('ไม่มีฟิลด์ที่ต้องการแก้ไข')
  }
  await setSettings(patch)

  await logAction({
    action: 'แก้ไขการตั้งค่าระบบ',
    actorId: ctx.userId,
    actor: ctx.displayName,
    actorRole: ctx.role,
    entity: 'settings',
    entityId: 'app_settings',
    detail: `ฟิลด์ที่แก้ไข: ${changedKeys.join(', ')}`,
    tone: 'blue',
  })

  return await getSettings()
}, 'SYSTEM.SETTING')

// Touch unused import so type-check keeps the binding alive even if the
// compiler strips runtime references.
void db
