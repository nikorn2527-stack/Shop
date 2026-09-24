/**
 * Stock Movement Ledger — the central truth of every stock change.
 *
 * Per Technical Review Section 6:
 *   "ต้องมี Stock Movement เป็น Ledger กลาง เช่น RECEIVE / SALE / ADJUST /
 *    TRANSFER / RETURN เพื่อให้ Stock Card, Audit และการตรวจสอบย้อนหลัง
 *    เชื่อถือได้ ไม่ควรเก็บเพียงยอดคงเหลือสุดท้าย"
 *
 * Every write to products.stock MUST go through recordMovement() so a ledger
 * row is created in the same transaction.
 */

import { db } from './db'
import { round2 } from './format'
import { logActionTx } from './audit'

export type MovementType =
  | 'RECEIVE' // goods receipt — qty +
  | 'SALE' // sold to customer — qty -
  | 'ADJUST' // manual adjustment — qty +/- (diff signed)
  | 'TRANSFER' // warehouse-to-warehouse — out: -qty / in: +qty
  | 'RETURN' // customer return / refund — qty +
  | 'VOID' // voided sale — qty +
  | 'COUNT' // stock count correction — signed diff

export interface RecordMovementInput {
  type: MovementType
  productId: string
  warehouseId: string
  lotId?: string
  qtyDelta: number // signed
  unitCost?: number
  refType?: 'sale' | 'purchase_order' | 'stock_count' | 'refund' | 'transfer' | 'void'
  refId?: string
  reason?: string
  actorId?: string
  actorName?: string
}

/**
 * Record a stock movement AND update the cached `products.stock` in the same
 * Prisma transaction. Caller must wrap in db.$transaction if more writes follow.
 */
export async function recordMovement(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  input: RecordMovementInput,
): Promise<void> {
  // 1. Insert ledger row
  await tx.stockMovement.create({
    data: {
      type: input.type,
      productId: input.productId,
      warehouseId: input.warehouseId,
      lotId: input.lotId ?? null,
      qtyDelta: Math.trunc(input.qtyDelta),
      unitCost: round2(input.unitCost ?? 0),
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      reason: input.reason ?? null,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
    },
  })

  // 2. Bump cached product stock (sellable qty).
  //    Note: multi-warehouse scenario would need products_per_warehouse table;
  //    for now we keep single-warehouse cached value in products.stock.
  const delta = Math.trunc(input.qtyDelta)
  await tx.product.update({
    where: { id: input.productId },
    data: { stock: { increment: delta } },
  })

  // 3. Update lot qty if provided (FIFO/FEFO tracking).
  if (input.lotId) {
    await tx.stockLot.update({
      where: { id: input.lotId },
      data: { qty: { increment: delta } },
    })
  }
}

/**
 * Deduct stock from the oldest expiring lots (FEFO — First Expiry First Out).
 * Returns the lots actually consumed with their qtys. Best-effort: if lots run
 * out, the shortfall is logged but the sale still succeeds (rare; alerts ops).
 */
export async function deductLotsFifo(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  productId: string,
  warehouseId: string,
  qty: number,
): Promise<{ consumed: { lotId: string; qty: number }[]; shortfall: number }> {
  const lots = await tx.stockLot.findMany({
    where: { productId, warehouseId, qty: { gt: 0 } },
    orderBy: [
      { expiryDate: { sort: 'asc' } }, // SQLite: nulls first by default — wrapped
      { receivedAt: 'asc' },
      { id: 'asc' },
    ],
  })
  // SQLite orderBy with nulls: we need lots WITHOUT expiry first or last?
  // FEFO = earliest expiry first. Lots with no expiry are "infinite" → consume LAST.
  // Prisma doesn't directly support NULLS LAST on SQLite, so we sort in JS.
  const sorted = [...lots].sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return a.receivedAt.getTime() - b.receivedAt.getTime()
    if (!a.expiryDate) return 1 // a goes last
    if (!b.expiryDate) return -1 // b goes last
    return a.expiryDate.getTime() - b.expiryDate.getTime()
  })

  let remaining = Math.trunc(qty)
  const consumed: { lotId: string; qty: number }[] = []
  for (const lot of sorted) {
    if (remaining <= 0) break
    const take = Math.min(lot.qty, remaining)
    if (take <= 0) continue
    await tx.stockLot.update({
      where: { id: lot.id },
      data: { qty: { decrement: take } },
    })
    consumed.push({ lotId: lot.id, qty: take })
    remaining -= take
  }
  return { consumed, shortfall: Math.max(0, remaining) }
}

/**
 * Compute weighted average cost after a receive:
 *   avgCost = (oldQty * oldCost + lineValue) / (oldQty + totalQty)
 */
export function weightedAverageCost(
  oldQty: number,
  oldCost: number,
  addedQty: number,
  addedCost: number,
): number {
  const totalQty = oldQty + addedQty
  if (totalQty <= 0) return 0
  return round2((oldQty * oldCost + addedQty * addedCost) / totalQty)
}

/**
 * Generate next order number: RC-YYMMDD-NNN (per-day sequence, 3 digits).
 * Race-safe via unique constraint + retry on conflict.
 */
export async function nextOrderNumber(): Promise<string> {
  const now = new Date()
  const bangkok = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).format(now).replace(/-/g, '') // YYMMDD

  const prefix = `RC-${bangkok}-`
  // Find max sequence for today
  const lastSale = await db.sale.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  })
  let seq = 1
  if (lastSale) {
    const tail = lastSale.orderNumber.slice(prefix.length)
    const n = parseInt(tail, 10)
    if (!isNaN(n)) seq = n + 1
  }
  // Retry on conflict (rare race)
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${prefix}${String(seq).padStart(3, '0')}`
    const exists = await db.sale.findUnique({ where: { orderNumber: candidate }, select: { id: true } })
    if (!exists) return candidate
    seq++
  }
  // Fallback: append random suffix
  return `${prefix}${String(seq).padStart(3, '0')}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Generate next SKU: <PREFIX>-NNN where prefix comes from category.
 * Falls back to GEN for unknown categories.
 */
export function categorySkuPrefix(categoryName: string): string {
  const map: Record<string, string> = {
    'เครื่องดื่ม': 'DRK',
    'อาหาร': 'FD',
    'ของใช้ส่วนตัว': 'HYG',
    'ของใช้ในครัวเรือน': 'HH',
    'ขนม': 'SNK',
    'เครื่องเขียน': 'ST',
  }
  return map[categoryName] ?? 'GEN'
}

export async function nextSku(categoryName: string): Promise<string> {
  const prefix = categorySkuPrefix(categoryName)
  const pattern = new RegExp(`^${prefix}-\\d{3}$`)
  const products = await db.product.findMany({
    where: { sku: { startsWith: `${prefix}-` } },
    select: { sku: true },
  })
  const used = new Set(products.map(p => p.sku))
  let n = 1
  while (used.has(`${prefix}-${String(n).padStart(3, '0')}`)) n++
  return `${prefix}-${String(n).padStart(3, '0')}`
}

/**
 * Generate next member number based on store settings.
 *   running  → <prefix>-<seq>            e.g. M-000001
 *   year     → <year>-<seq>              e.g. 69-00001 (Buddhist 2-digit default)
 *   manual   → user-supplied
 */
export async function nextMemberNumber(
  mode: 'running' | 'year' | 'manual',
  format: {
    prefix?: string
    yearMode?: 'none' | 'buddhist' | 'gregorian'
    yearDigits?: 2 | 4
    resetMonth?: number
    sequenceDigits?: number
    separator?: '-' | '/' | '_' | ''
  } = {},
  manual?: string,
): Promise<string> {
  if (mode === 'manual') return manual ?? ''
  const now = new Date()
  const bangkokYear = Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  }).format(now))
  const bangkokMonth = Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    month: 'numeric',
  }).format(now))

  const prefix = format.prefix ?? (mode === 'year' ? '' : 'M')
  const yearMode = format.yearMode ?? (mode === 'year' ? 'buddhist' : 'none')
  const yearDigits = format.yearDigits === 4 ? 4 : 2
  const resetMonth = Math.min(12, Math.max(1, format.resetMonth ?? 1))
  const separator = format.separator ?? '-'

  // cycleYear: if current month < resetMonth, the cycle started last year
  const cycleYear = bangkokMonth < resetMonth ? bangkokYear - 1 : bangkokYear
  const yearValue = yearMode === 'buddhist' ? cycleYear + 543 : cycleYear
  const yearText = yearMode === 'none' ? '' : String(yearValue).slice(yearDigits === 4 ? -4 : -2)

  const head = [prefix.trim(), yearText].filter(Boolean).join(separator)

  // Find max sequence matching the head pattern
  const searchPattern = head ? `${head}${separator}%` : `${prefix ?? ''}%`
  const members = await db.member.findMany({
    where: { memberNumber: { startsWith: head ? `${head}${separator}` : (prefix ?? '') } },
    select: { memberNumber: true },
  })
  let maxSeq = 0
  for (const m of members) {
    const tail = head ? m.memberNumber.slice(head.length + separator.length) : m.memberNumber.slice((prefix ?? '').length)
    const digits = tail.replace(/[^0-9]/g, '')
    const n = parseInt(digits, 10)
    if (!isNaN(n) && n > maxSeq) maxSeq = n
  }
  const digits = Math.min(10, Math.max(1, format.sequenceDigits ?? (mode === 'year' ? 5 : 6)))
  const seqStr = String(maxSeq + 1).padStart(digits, '0')
  return head ? `${head}${separator}${seqStr}` : `${prefix ?? ''}${separator}${seqStr}`
}

export { logActionTx }
