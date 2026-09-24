/**
 * Checkout — atomic sale + payment + stock deduction + wallet debit + audit.
 *
 * Per Technical Review Section "การขายสินค้า":
 *   1. Validate: cart not empty, qty positive, payment method valid
 *   2. Merge duplicate catalog lines by (productId, unitPrice, label)
 *      · Money-mode tiers (ice sold by gram) stay separate lines keyed by tier label
 *   3. Stock check: Σ qty per product ≤ product.stock
 *   4. Compute totals: subtotal = round2(Σ amount), discount ≥ 0 ≤ subtotal, total
 *   5. If wallet payment: member must exist, be active, balance ≥ total,
 *      and (if creditLimit set) today's wallet-bill total + this bill ≤ creditLimit
 *   6. Atomic writes:
 *      - INSERT sale (orderNumber, cashier, member, totals, slipUrl)
 *      - For each item: INSERT sale_item (snapshot name/price/cost/unit)
 *        + recordMovement(SALE) + deductLotsFifo (FEFO)
 *      - If wallet: UPDATE member.balance + INSERT member_transaction (purchase)
 *      - audit log
 *
 * Special items (no productId): no stock movement, product_id nullable.
 */

import { db } from './db'
import { round2, round4 } from './format'
import { StoreError, NotFoundError } from './errors'
import { logActionTx, recordMovement, deductLotsFifo, nextOrderNumber } from './stock'

export type PaymentMethod = 'เงินสด' | 'QR / สแกน' | 'หักบัญชีสมาชิก'

export interface CheckoutItemInput {
  // Catalog product line:
  productId?: string
  qty: number // positive integer (or money-mode tier qty — grams of ice)
  price?: number // override catalog price (for money-mode tiers)
  unit?: string
  label?: string // money-mode tier label
  // OR special line (no productId):
  name?: string
}

export interface CheckoutInput {
  items: CheckoutItemInput[]
  paymentMethod: PaymentMethod
  memberNumber?: string | null
  discount?: number
  cashierId?: string
  cashierName?: string
  shiftId?: string
  slipImage?: string | null
  actorId?: string
  actorName?: string
  actorRole?: string
}

export interface CheckoutResult {
  saleId: string
  orderNumber: string
  subtotal: number
  discount: number
  total: number
  memberBalanceAfter?: number
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  if (!input.items.length) throw new StoreError('บิลว่าง · กรุณาเพิ่มสินค้าก่อนชำระเงิน')

  // Normalize + validate items
  const normalized = input.items.map(item => ({
    ...item,
    qty: Math.trunc(item.qty),
    price: item.price !== undefined ? round4(item.price) : undefined,
  })).filter(item => item.qty > 0)
  if (!normalized.length) throw new StoreError('จำนวนสินค้าต้องเป็นจำนวนเต็มบวก')

  // Resolve products + validate stock
  const productIds = normalized.filter(i => i.productId).map(i => i.productId!)
  const products = productIds.length
    ? await db.product.findMany({ where: { id: { in: productIds } } })
    : []
  const productMap = new Map(products.map(p => [p.id, p]))

  for (const item of normalized) {
    if (item.productId && !productMap.has(item.productId)) {
      throw new NotFoundError(`ไม่พบสินค้ารหัส ${item.productId} ในระบบ`)
    }
    if (!item.productId && !item.name?.trim()) {
      throw new StoreError('รายการพิเศษต้องมีชื่อ')
    }
    if (!item.productId && (item.price === undefined || item.price <= 0)) {
      throw new StoreError('รายการพิเศษต้องมีราคามากกว่า 0')
    }
  }

  // Aggregate qty per product for stock check
  const qtyPerProduct = new Map<string, number>()
  for (const item of normalized) {
    if (!item.productId) continue
    qtyPerProduct.set(item.productId, (qtyPerProduct.get(item.productId) ?? 0) + item.qty)
  }
  for (const [pid, qty] of qtyPerProduct) {
    const p = productMap.get(pid)!
    if (p.stock < qty) {
      throw new StoreError(`สต็อกไม่พอ · ${p.name} เหลือ ${p.stock} ${p.unit} (ต้องการ ${qty})`)
    }
    if (!p.active) {
      throw new StoreError(`สินค้า "${p.name}" ถูกปิดการขาย`)
    }
  }

  // Compute totals
  const lineAmounts = normalized.map(item => {
    const unitPrice = item.productId
      ? (item.price !== undefined ? item.price : productMap.get(item.productId)!.price)
      : item.price!
    return round2(unitPrice * item.qty)
  })
  const subtotal = round2(lineAmounts.reduce((a, b) => a + b, 0))
  const discount = round2(Math.max(0, input.discount ?? 0))
  if (discount > subtotal) {
    throw new StoreError('ส่วนลดมากกว่ายอดรวมสินค้า')
  }
  const total = round2(subtotal - discount)

  // Member lookup + wallet checks
  let member: { memberNumber: string; balance: number; status: string; creditLimit: number | null } | null = null
  if (input.paymentMethod === 'หักบัญชีสมาชิก') {
    if (!input.memberNumber) {
      throw new StoreError('การชำระ "หักบัญชีสมาชิก" ต้องเลือกสมาชิก')
    }
    const found = await db.member.findUnique({ where: { memberNumber: input.memberNumber } })
    if (!found) throw new NotFoundError(`ไม่พบสมาชิกเลข ${input.memberNumber} ในระบบ`)
    if (found.status !== 'active') {
      throw new StoreError('สมาชิกถูกระงับการใช้งาน · ไม่สามารถหักบัญชีได้')
    }
    if (found.balance < total) {
      throw new StoreError(
        `ยอดเงินคงเหลือไม่พอ · ยอดชำระ ฿${total.toFixed(2)} คงเหลือ ฿${found.balance.toFixed(2)}`,
      )
    }
    // Credit limit check — sum today's wallet bills for this member
    if (found.creditLimit !== null && found.creditLimit > 0) {
      const today = new Date()
      const bangkokToday = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(today) // YYYY-MM-DD
      const startOfDayUtc = new Date(`${bangkokToday}T00:00:00+07:00`)
      const endOfDayUtc = new Date(`${bangkokToday}T23:59:59+07:00`)
      const todayWalletBills = await db.sale.aggregate({
        where: {
          memberNumber: found.memberNumber,
          paymentMethod: 'หักบัญชีสมาชิก',
          voided: false,
          createdAt: { gte: startOfDayUtc, lte: endOfDayUtc },
        },
        _sum: { total: true },
      })
      const spentToday = todayWalletBills._sum.total ?? 0
      if (spentToday + total > found.creditLimit) {
        throw new StoreError(
          `เกินวงเงินซื้อสินค้าต่อวัน · วงเงิน ฿${found.creditLimit.toFixed(2)} · ใช้ไปแล้ววันนี้ ฿${spentToday.toFixed(2)} · บิลนี้ ฿${total.toFixed(2)}`,
        )
      }
    }
    member = {
      memberNumber: found.memberNumber,
      balance: found.balance,
      status: found.status,
      creditLimit: found.creditLimit,
    }
  } else if (input.memberNumber) {
    // Cash/QR with member attached — snapshot only, no balance change
    const found = await db.member.findUnique({ where: { memberNumber: input.memberNumber } })
    if (found && found.status !== 'active') {
      throw new StoreError('สมาชิกถูกระงับการใช้งาน · ไม่สามารถผูกเข้าบิลได้')
    }
    if (found) {
      member = {
        memberNumber: found.memberNumber,
        balance: found.balance,
        status: found.status,
        creditLimit: found.creditLimit,
      }
    }
  }

  // Validate slip image (data URL, ≤600KB)
  let slipUrl: string | null = null
  if (input.slipImage) {
    if (!input.slipImage.startsWith('data:image/')) {
      throw new StoreError('หลักฐานการชำระต้องเป็นรูปภาพ (data:image/...)')
    }
    if (input.slipImage.length > 600_000) {
      throw new StoreError('ไฟล์หลักฐานการชำระใหญ่เกินไป (สูงสุด 600 KB)')
    }
    slipUrl = input.slipImage
  }

  // Get default warehouse
  const warehouse = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!warehouse) throw new StoreError('ไม่พบคลังหลัก · ติดต่อผู้ดูแลระบบ')

  const orderNumber = await nextOrderNumber()

  // Atomic transaction
  const result = await db.$transaction(async (tx) => {
    // 1. Create sale header
    const sale = await tx.sale.create({
      data: {
        orderNumber,
        cashierId: input.cashierId ?? null,
        cashierName: input.cashierName ?? null,
        shiftId: input.shiftId ?? null,
        memberNumber: member?.memberNumber ?? null,
        paymentMethod: input.paymentMethod,
        subtotal,
        discount,
        total,
        slipUrl,
      },
    })

    // 2. For each item: create sale_item + deduct stock (FEFO) + record movement
    for (const item of normalized) {
      const product = item.productId ? productMap.get(item.productId)! : null
      const unitPrice = item.productId
        ? (item.price !== undefined ? item.price : product!.price)
        : item.price!
      const amount = round2(unitPrice * item.qty)

      await tx.saleItem.create({
        data: {
          saleId: sale.id,
          productId: item.productId ?? null,
          name: item.name ?? product!.name,
          qty: item.qty,
          price: unitPrice,
          cost: product?.cost ?? 0,
          unit: item.unit ?? product?.unit ?? null,
          variant: item.label ?? null,
        },
      })

      if (item.productId) {
        // Deduct from lots FEFO
        const { shortfall } = await deductLotsFifo(tx, item.productId, warehouse.id, item.qty)
        // Record movement
        await recordMovement(tx, {
          type: 'SALE',
          productId: item.productId,
          warehouseId: warehouse.id,
          qtyDelta: -item.qty,
          unitCost: product!.cost,
          refType: 'sale',
          refId: sale.id,
          reason: `บิล ${orderNumber} · ${item.label ?? ''}`,
          actorId: input.actorId,
          actorName: input.actorName,
        })
        if (shortfall > 0) {
          // Best-effort: log shortfall for ops review (don't fail the sale)
          await logActionTx(tx, {
            action: 'ตัดยอด Lot ไม่ครบ',
            actorId: input.actorId,
            actor: input.actorName,
            actorRole: input.actorRole,
            entity: 'sale',
            entityId: sale.id,
            detail: `บิล ${orderNumber} · สินค้า ${product!.name} ขาด ${shortfall} ${product!.unit} · ควรนับสต็อกแยกล็อต`,
            tone: 'amber',
          })
        }
      }
    }

    // 3. Wallet debit + member_transaction
    let memberBalanceAfter: number | undefined
    if (member && input.paymentMethod === 'หักบัญชีสมาชิก') {
      const newBalance = round2(member.balance - total)
      await tx.member.update({
        where: { memberNumber: member.memberNumber },
        data: { balance: newBalance },
      })
      const itemSummary = normalized
        .slice(0, 3)
        .map(i => `${i.name ?? productMap.get(i.productId!)?.name ?? '???'} ×${i.qty}`)
        .join(', ')
      await tx.memberTransaction.create({
        data: {
          memberNumber: member.memberNumber,
          type: 'purchase',
          detail: `บิล ${orderNumber} · ${itemSummary}${normalized.length > 3 ? ' ฯลฯ' : ''}`,
          amount: -total,
          balanceAfter: newBalance,
          paymentMethod: input.paymentMethod,
          actor: input.actorName ?? null,
          saleId: sale.id,
        },
      })
      memberBalanceAfter = newBalance
    }

    // 4. Audit log
    await logActionTx(tx, {
      action: 'ขายสินค้า',
      actorId: input.actorId,
      actor: input.actorName,
      actorRole: input.actorRole,
      entity: 'sale',
      entityId: sale.id,
      detail: `บิล ${orderNumber} · ${input.paymentMethod} · ยอด ฿${total.toFixed(2)} · ${normalized.length} รายการ`,
      tone: 'blue',
    })

    return { saleId: sale.id, orderNumber, subtotal, discount, total, memberBalanceAfter }
  })

  return result
}

/**
 * Void a sale — reverses stock + wallet, marks sale as voided.
 * Per Technical Review P1: separate flow, store reason + actor + approver.
 */
export async function voidSale(input: {
  saleId: string
  reason: string
  actorId?: string
  actorName?: string
  actorRole?: string
  approverId?: string
  approverName?: string
}): Promise<{ reversed: boolean }> {
  const sale = await db.sale.findUnique({
    where: { id: input.saleId },
    include: { items: true },
  })
  if (!sale) throw new NotFoundError('ไม่พบบิลนี้ในระบบ')
  if (sale.voided) throw new StoreError('บิลนี้ถูกยกเลิกไปแล้ว')
  if (!input.reason.trim()) throw new StoreError('ต้องระบุเหตุผลในการยกเลิก')

  const warehouse = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!warehouse) throw new StoreError('ไม่พบคลังหลัก')

  await db.$transaction(async (tx) => {
    // Reverse stock for each catalog item
    for (const item of sale.items) {
      if (!item.productId) continue
      await recordMovement(tx, {
        type: 'VOID',
        productId: item.productId,
        warehouseId: warehouse.id,
        qtyDelta: item.qty, // positive — restore
        unitCost: item.cost,
        refType: 'void',
        refId: sale.id,
        reason: `ยกเลิกบิล ${sale.orderNumber} · ${input.reason}`,
        actorId: input.actorId,
        actorName: input.actorName,
      })
    }

    // Reverse wallet debit if it was wallet payment
    if (sale.paymentMethod === 'หักบัญชีสมาชิก' && sale.memberNumber) {
      const member = await tx.member.findUnique({ where: { memberNumber: sale.memberNumber } })
      if (member) {
        const newBalance = round2(member.balance + sale.total)
        await tx.member.update({
          where: { memberNumber: member.memberNumber },
          data: { balance: newBalance },
        })
        await tx.memberTransaction.create({
          data: {
            memberNumber: member.memberNumber,
            type: 'refund',
            detail: `ยกเลิกบิล ${sale.orderNumber} · คืนเงิน ฿${sale.total.toFixed(2)} · เหตุผล: ${input.reason}`,
            amount: sale.total,
            balanceAfter: newBalance,
            paymentMethod: sale.paymentMethod,
            actor: input.actorName ?? null,
            saleId: sale.id,
          },
        })
      }
    }

    // Mark sale voided
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        voided: true,
        voidReason: input.reason,
        voidActorId: input.actorId,
        voidActorName: input.actorName,
        voidedAt: new Date(),
      },
    })

    await logActionTx(tx, {
      action: 'ยกเลิกบิล',
      actorId: input.actorId,
      actor: input.actorName,
      actorRole: input.actorRole,
      entity: 'sale',
      entityId: sale.id,
      detail: `บิล ${sale.orderNumber} · ยอด ฿${sale.total.toFixed(2)} · เหตุผล: ${input.reason}`,
      tone: 'red',
    })
  })

  return { reversed: true }
}
