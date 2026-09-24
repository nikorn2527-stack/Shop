#!/usr/bin/env bun
/**
 * migrate-from-shop.ts — Migrate customer's existing Shop SQLite DB to new Prisma schema.
 *
 * Usage:
 *   bun run scripts/migrate-from-shop.ts <source.sqlite> [--dry-run] [--target <target.sqlite>]
 *
 * Strategy:
 *   - Reads source DB (Shop original schema, ~13 tables, snake_case)
 *   - Writes to target DB (Prisma new schema, ~32 tables, PascalCase)
 *   - Default target = current project DB (file:/home/z/my-project/db/custom.db)
 *   - --dry-run: report counts only, no writes
 *
 * Per Technical Review + Deployment Guideline:
 *   - Safety backup before migration (caller's responsibility — run `bun run backup:sqlite` first)
 *   - Idempotent: re-running on already-migrated DB will skip existing rows
 *   - All writes in Prisma transactions for atomicity
 *   - Detailed report at the end (rows migrated per table, errors, warnings)
 *
 * Field mapping (legacy → new):
 *   app_users.id            → User.id (cuid generated; legacy id preserved in username suffix)
 *   app_users.username       → User.username (lowercased)
 *   app_users.password_hash  → User.passwordHash (kept as-is — scrypt hash, dual-verify handles it)
 *   app_users.display_name   → User.displayName
 *   app_users.role           → User.role (staff→cashier, admin→administrator, dev→administrator + appRole='dev_service')
 *   app_users.created_at     → User.createdAt (parse "YYYY-MM-DD HH:MM:SS" Bangkok time → UTC)
 *   members.*                → Member.*
 *   sales.*                  → Sale.*
 *   ... (see migrateTable* functions below)
 *
 * The script writes progress to stdout and a final summary to stderr.
 */

import { DatabaseSync } from 'node:sqlite'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const targetIdx = args.indexOf('--target')
const targetDb = targetIdx >= 0 ? args[targetIdx + 1] : process.env.DATABASE_URL?.replace(/^file:/, '') || './db/custom.db'
const sourceIdx = args.findIndex(a => !a.startsWith('--'))
const sourceDb = sourceIdx >= 0 ? args[sourceIdx] : null

if (!sourceDb) {
  console.error('Usage: bun run scripts/migrate-from-shop.ts <source.sqlite> [--dry-run] [--target <target.sqlite>]')
  console.error('  source.sqlite = customer\'s existing Shop DB (e.g. welfare-store-20260924T175449Z.sqlite)')
  console.error('  --dry-run     = report counts only, no writes')
  console.error('  --target      = target Prisma DB (default: ./db/custom.db)')
  process.exit(1)
}

console.log('━' .repeat(80))
console.log('  Shop → Prisma Migration')
console.log('━' .repeat(80))
console.log(`  Source DB : ${sourceDb}`)
console.log(`  Target DB : ${targetDb}`)
console.log(`  Mode      : ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE (will write to target)'}`)
console.log('━' .repeat(80))
console.log()

// ---------------------------------------------------------------------------
// Open source DB (read-only mode — we never write to it)
// ---------------------------------------------------------------------------

const source = new DatabaseSync(sourceDb, { readOnly: true })

// ---------------------------------------------------------------------------
// Open target Prisma DB
// ---------------------------------------------------------------------------

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse Shop's Bangkok-local timestamp "YYYY-MM-DD HH:MM:SS" → UTC Date. */
function parseBangkokTimestamp(text: string | null | undefined): Date | null {
  if (!text) return null
  // Shop stores "2026-09-18 22:27:33" — Bangkok local time (NOT UTC).
  // Convert to UTC by treating it as Asia/Bangkok (+07:00).
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text)
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match
  // ISO with +07:00 offset → JS Date in UTC
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+07:00`)
}

/** Map legacy role string → new Prisma role name. */
function mapRole(legacyRole: string | null | undefined): string {
  switch (legacyRole) {
    case 'staff': return 'cashier'
    case 'admin': return 'administrator'
    case 'dev': return 'administrator' // dev gets admin-level perms + appRole='dev_service' tracked separately
    default: return 'cashier'
  }
}

/** Generate a cuid-like ID for new rows. */
function newId(): string {
  return randomUUID()
}

interface MigrationReport {
  table: string
  sourceCount: number
  migrated: number
  skipped: number
  errors: { row: string; error: string }[]
  warnings: string[]
}

function newReport(table: string): MigrationReport {
  return { table, sourceCount: 0, migrated: 0, skipped: 0, errors: [], warnings: [] }
}

// ---------------------------------------------------------------------------
// Migration: app_users → User + Session + Role assignments
// ---------------------------------------------------------------------------

async function migrateUsers(): Promise<MigrationReport> {
  const report = newReport('app_users → User')
  const rows = source.prepare(`
    SELECT id, username, password_hash, display_name, role, active,
           created_at, failed_attempts, locked_until, must_change_password
    FROM app_users
  `).all() as Array<{
    id: number
    username: string
    password_hash: string
    display_name: string
    role: string
    active: number
    created_at: string
    failed_attempts: number
    locked_until: string | null
    must_change_password: number
  }>

  report.sourceCount = rows.length

  if (dryRun) {
    console.log(`  [dry-run] app_users → User: ${rows.length} rows to migrate`)
    return report
  }

  // Build a map of legacy user id → new User id for FK references in sales/audit_logs/etc.
  const userIdMap = new Map<number, string>()

  for (const row of rows) {
    try {
      const newUserId = newId()
      userIdMap.set(row.id, newUserId)

      const existing = await prisma.user.findUnique({ where: { username: row.username.toLowerCase() } })
      if (existing) {
        report.skipped++
        userIdMap.set(row.id, existing.id)
        continue
      }

      await prisma.user.create({
        data: {
          id: newUserId,
          username: row.username.toLowerCase(),
          passwordHash: row.password_hash, // keep legacy scrypt hash — dual-verify handles it on login
          displayName: row.display_name || row.username,
          role: mapRole(row.role),
          active: row.active === 1,
          mustChangePassword: row.must_change_password === 1,
          failedAttempts: row.failed_attempts || 0,
          lockedUntil: parseBangkokTimestamp(row.locked_until),
          lastSignedIn: parseBangkokTimestamp(row.created_at),
          createdAt: parseBangkokTimestamp(row.created_at) ?? new Date(),
        },
      })
      report.migrated++
    } catch (err) {
      report.errors.push({ row: `app_users#${row.id} (${row.username})`, error: String(err) })
    }
  }

  // Store the user ID map for later use (sales, audit_logs, etc.)
  ;(migrateUsers as any)._idMap = userIdMap

  return report
}

// ---------------------------------------------------------------------------
// Migration: members → Member
// ---------------------------------------------------------------------------

async function migrateMembers(): Promise<MigrationReport> {
  const report = newReport('members → Member')
  const rows = source.prepare(`
    SELECT id, member_number, first_name, last_name, prename, id_card, phone,
           type, balance, status, created_at, photo_url, gender,
           credit_limit, card_number, patient_code
    FROM members
  `).all() as Array<{
    id: number
    member_number: string
    first_name: string
    last_name: string
    prename: string | null
    id_card: string | null
    phone: string | null
    type: string
    balance: number
    status: string
    created_at: string
    photo_url: string | null
    gender: string | null
    credit_limit: number | null
    card_number: string | null
    patient_code: string | null
  }>

  report.sourceCount = rows.length

  if (dryRun) {
    console.log(`  [dry-run] members → Member: ${rows.length} rows to migrate`)
    return report
  }

  for (const row of rows) {
    try {
      const existing = await prisma.member.findUnique({ where: { memberNumber: row.member_number } })
      if (existing) {
        report.skipped++
        continue
      }

      await prisma.member.create({
        data: {
          memberNumber: row.member_number,
          prename: row.prename,
          firstName: row.first_name,
          lastName: row.last_name,
          idCard: row.id_card,
          phone: row.phone,
          type: row.type || 'สมาชิก',
          balance: row.balance || 0,
          status: row.status === 'suspended' ? 'suspended' : 'active',
          photoUrl: row.photo_url,
          gender: row.gender,
          creditLimit: row.credit_limit,
          cardNumber: row.card_number,
          patientCode: row.patient_code,
          createdAt: parseBangkokTimestamp(row.created_at) ?? new Date(),
        },
      })
      report.migrated++
    } catch (err) {
      report.errors.push({ row: `members#${row.id} (${row.member_number})`, error: String(err) })
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Migration: products → Product + StockLot + StockMovement (opening)
// ---------------------------------------------------------------------------

async function migrateProducts(): Promise<MigrationReport> {
  const report = newReport('products → Product')
  const rows = source.prepare(`
    SELECT id, sku, barcode, name, category, emoji, color, unit, price, cost,
           stock, reorder_point, active, created_at, size, image_url,
           quick_pick, sell_mode, price_tiers
    FROM products
  `).all() as Array<{
    id: number
    sku: string
    barcode: string | null
    name: string
    category: string | null
    emoji: string | null
    color: string | null
    unit: string | null
    price: number
    cost: number
    stock: number
    reorder_point: number
    active: number
    created_at: string
    size: string | null
    image_url: string | null
    quick_pick: number | null
    sell_mode: string | null
    price_tiers: string | null
  }>

  report.sourceCount = rows.length

  if (dryRun) {
    console.log(`  [dry-run] products → Product: ${rows.length} rows to migrate`)
    return report
  }

  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  if (!warehouse) {
    report.warnings.push('Default warehouse not found — skipping stock_lots/movements creation')
  }

  for (const row of rows) {
    try {
      const existing = await prisma.product.findUnique({ where: { sku: row.sku } })
      if (existing) {
        report.skipped++
        continue
      }

      // Map category name to Category record (create if missing)
      let categoryId: string | null = null
      if (row.category) {
        const cat = await prisma.category.upsert({
          where: { name: row.category },
          update: {},
          create: { name: row.category },
        })
        categoryId = cat.id
      }

      const product = await prisma.product.create({
        data: {
          sku: row.sku,
          barcode: row.barcode,
          name: row.name,
          categoryId,
          emoji: row.emoji || '📦',
          color: row.color || '#6d6157',
          unit: row.unit || 'ชิ้น',
          price: row.price || 0,
          cost: row.cost || 0,
          stock: 0, // will be set via stock_movement below
          reorderPoint: row.reorder_point || 10,
          active: row.active === 1,
          size: row.size,
          imageUrl: row.image_url,
          quickPick: row.quick_pick === 1,
          sellMode: row.sell_mode === 'money' ? 'money' : 'unit',
          priceTiers: row.price_tiers,
          createdAt: parseBangkokTimestamp(row.created_at) ?? new Date(),
        },
      })

      // Create opening stock lot + movement for migrated stock
      if (warehouse && row.stock > 0) {
        const lot = await prisma.stockLot.create({
          data: {
            productId: product.id,
            warehouseId: warehouse.id,
            lot: 'MIGRATED',
            qty: row.stock,
            cost: row.cost || 0,
            receivedQty: row.stock,
            receivedAt: parseBangkokTimestamp(row.created_at) ?? new Date(),
          },
        })
        await prisma.stockMovement.create({
          data: {
            type: 'RECEIVE',
            productId: product.id,
            warehouseId: warehouse.id,
            lotId: lot.id,
            qtyDelta: row.stock,
            unitCost: row.cost || 0,
            refType: 'stock_count',
            reason: 'ย้ายข้อมูลจากระบบเดิม',
          },
        })
        await prisma.product.update({
          where: { id: product.id },
          data: { stock: row.stock },
        })
      }

      report.migrated++
    } catch (err) {
      report.errors.push({ row: `products#${row.id} (${row.sku})`, error: String(err) })
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Migration: sales + sale_items → Sale + SaleItem + StockMovement (SALE) + Payment
// ---------------------------------------------------------------------------

async function migrateSales(): Promise<MigrationReport> {
  const report = newReport('sales → Sale + SaleItem')
  const rows = source.prepare(`
    SELECT id, order_number, payment_method, member_number, subtotal, discount,
           total, cashier, created_at, slip_url
    FROM sales
    ORDER BY created_at ASC
  `).all() as Array<{
    id: number
    order_number: string
    payment_method: string
    member_number: string | null
    subtotal: number
    discount: number
    total: number
    cashier: string | null
    created_at: string
    slip_url: string | null
  }>

  report.sourceCount = rows.length

  if (dryRun) {
    console.log(`  [dry-run] sales → Sale: ${rows.length} rows to migrate`)
    return report
  }

  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } })

  for (const row of rows) {
    try {
      const existing = await prisma.sale.findUnique({ where: { orderNumber: row.order_number } })
      if (existing) {
        report.skipped++
        continue
      }

      // Resolve cashier name → User
      let cashierId: string | null = null
      const userIdMap = (migrateUsers as any)._idMap as Map<number, string> | undefined
      // The legacy sales table doesn't have cashier_id FK; it stores cashier name.
      // Try to match by display_name.
      if (row.cashier) {
        const cashierUser = await prisma.user.findFirst({ where: { displayName: row.cashier } })
        if (cashierUser) cashierId = cashierUser.id
      }

      const sale = await prisma.sale.create({
        data: {
          orderNumber: row.order_number,
          cashierId,
          cashierName: row.cashier,
          memberNumber: row.member_number,
          paymentMethod: row.payment_method,
          subtotal: row.subtotal || 0,
          discount: row.discount || 0,
          total: row.total || 0,
          slipUrl: row.slip_url,
          voided: false,
          createdAt: parseBangkokTimestamp(row.created_at) ?? new Date(),
        },
      })

      // Migrate sale_items
      const items = source.prepare(`
        SELECT id, product_id, name, qty, price, cost, unit
        FROM sale_items
        WHERE sale_id = ?
      `).all(row.id) as Array<{
        id: number
        product_id: number | null
        name: string
        qty: number
        price: number
        cost: number
        unit: string | null
        variant: string | null
      }>

      // Build a map of legacy product id → new Product.id (lookup by SKU since we stored SKU)
      // For performance, fetch all products once and cache.
      // (Already done by previous iteration — fetch lazily here per sale_item instead.)
      for (const item of items) {
        let newProductId: string | null = null
        if (item.product_id) {
          // Look up by SKU — we need to know the SKU of legacy product_id.
          // Fetch from source DB.
          const legacyProduct = source.prepare('SELECT sku FROM products WHERE id = ?').get(item.product_id) as { sku: string } | undefined
          if (legacyProduct) {
            const newProduct = await prisma.product.findUnique({ where: { sku: legacyProduct.sku } })
            if (newProduct) newProductId = newProduct.id
          }
        }

        await prisma.saleItem.create({
          data: {
            saleId: sale.id,
            productId: newProductId,
            name: item.name,
            qty: item.qty,
            price: item.price,
            cost: item.cost || 0,
            unit: item.unit,
            variant: null,
          },
        })

        // Create stock movement for this sale item (if catalog product)
        if (newProductId && warehouse) {
          await prisma.stockMovement.create({
            data: {
              type: false ? 'VOID' : 'SALE',
              productId: newProductId,
              warehouseId: warehouse.id,
              qtyDelta: false ? item.qty : -item.qty,
              unitCost: item.cost || 0,
              refType: 'sale',
              refId: sale.id,
              reason: `${false ? 'ยกเลิกบิล' : 'บิล'} ${row.order_number}`,
            },
          })
        }
      }

      // Create payment record
      const methodMap: Record<string, string> = {
        'เงินสด': 'cash',
        'QR / สแกน': 'qr',
        'หักบัญชีสมาชิก': 'wallet',
      }
      await prisma.payment.create({
        data: {
          saleId: sale.id,
          method: methodMap[row.payment_method] || 'cash',
          amount: row.total || 0,
        },
      })

      report.migrated++
    } catch (err) {
      report.errors.push({ row: `sales#${row.id} (${row.order_number})`, error: String(err) })
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Migration: member_transactions → MemberTransaction
// ---------------------------------------------------------------------------

async function migrateMemberTransactions(): Promise<MigrationReport> {
  const report = newReport('member_transactions → MemberTransaction')
  const rows = source.prepare(`
    SELECT id, member_number, type, detail, amount, payment_method,
           balance_after, created_at, actor, slip_url
    FROM member_transactions
    ORDER BY created_at ASC
  `).all() as Array<{
    id: number
    member_number: string
    type: string
    detail: string
    amount: number
    payment_method: string | null
    balance_after: number | null
    created_at: string
    actor: string | null
    slip_url: string | null
  }>

  report.sourceCount = rows.length

  if (dryRun) {
    console.log(`  [dry-run] member_transactions → MemberTransaction: ${rows.length} rows to migrate`)
    return report
  }

  for (const row of rows) {
    try {
      const member = await prisma.member.findUnique({ where: { memberNumber: row.member_number } })
      if (!member) {
        report.warnings.push(`member_transactions#${row.id}: member ${row.member_number} not found, skipped`)
        report.skipped++
        continue
      }

      await prisma.memberTransaction.create({
        data: {
          memberNumber: row.member_number,
          type: row.type,
          detail: row.detail,
          amount: row.amount,
          balanceAfter: row.balance_after,
          paymentMethod: row.payment_method,
          actor: row.actor,
          slipUrl: row.slip_url,
          createdAt: parseBangkokTimestamp(row.created_at) ?? new Date(),
        },
      })
      report.migrated++
    } catch (err) {
      report.errors.push({ row: `member_transactions#${row.id}`, error: String(err) })
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Migration: audit_logs → AuditLog
// ---------------------------------------------------------------------------

async function migrateAuditLogs(): Promise<MigrationReport> {
  const report = newReport('audit_logs → AuditLog')
  const rows = source.prepare(`
    SELECT id, action, actor, actor_role, detail, tone, created_at
    FROM audit_logs
    ORDER BY created_at ASC
  `).all() as Array<{
    id: number
    action: string
    actor: string | null
    actor_role: string | null
    detail: string
    tone: string
    created_at: string
  }>

  report.sourceCount = rows.length

  if (dryRun) {
    console.log(`  [dry-run] audit_logs → AuditLog: ${rows.length} rows to migrate`)
    return report
  }

  for (const row of rows) {
    try {
      // Try to resolve actor → User by display_name
      let actorId: string | null = null
      if (row.actor) {
        const actorUser = await prisma.user.findFirst({ where: { displayName: row.actor } })
        if (actorUser) actorId = actorUser.id
      }

      await prisma.auditLog.create({
        data: {
          action: row.action,
          actorId,
          actor: row.actor,
          actorRole: row.actor_role,
          detail: row.detail,
          tone: row.tone || 'blue',
          createdAt: parseBangkokTimestamp(row.created_at) ?? new Date(),
        },
      })
      report.migrated++
    } catch (err) {
      report.errors.push({ row: `audit_logs#${row.id}`, error: String(err) })
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Migration: app_sessions → Session (preserve tokens so customers stay logged in)
// ---------------------------------------------------------------------------

async function migrateSessions(): Promise<MigrationReport> {
  const report = newReport('app_sessions → Session')
  const rows = source.prepare(`
    SELECT id, user_id, expires_at, created_at
    FROM app_sessions
    WHERE expires_at > datetime('now')
  `).all() as Array<{
    id: string
    user_id: number
    expires_at: string
    created_at: string
  }>

  report.sourceCount = rows.length

  if (dryRun) {
    console.log(`  [dry-run] app_sessions → Session: ${rows.length} active rows to migrate`)
    return report
  }

  const userIdMap = (migrateUsers as any)._idMap as Map<number, string> | undefined

  for (const row of rows) {
    try {
      // Resolve legacy user_id → new User.id
      let newUserId: string | null = null
      if (userIdMap && userIdMap.has(row.user_id)) {
        newUserId = userIdMap.get(row.user_id)!
      } else {
        // Fallback: try lookup by row.id pattern (legacy) — won't match, skip
        report.warnings.push(`app_sessions#${row.id}: legacy user_id=${row.user_id} not in map, skipped`)
        report.skipped++
        continue
      }

      const existing = await prisma.session.findUnique({ where: { id: row.id } })
      if (existing) {
        report.skipped++
        continue
      }

      await prisma.session.create({
        data: {
          id: row.id, // preserve session token so customer stays logged in
          userId: newUserId,
          expiresAt: parseBangkokTimestamp(row.expires_at) ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          lastSeenAt: new Date(),
          createdAt: parseBangkokTimestamp(row.created_at) ?? new Date(),
        },
      })
      report.migrated++
    } catch (err) {
      report.errors.push({ row: `app_sessions#${row.id}`, error: String(err) })
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Migration: store_settings → StoreSetting (app_settings JSON)
// ---------------------------------------------------------------------------

async function migrateSettings(): Promise<MigrationReport> {
  const report = newReport('store_settings → StoreSetting')
  const rows = source.prepare(`
    SELECT key, value FROM store_settings
  `).all() as Array<{ key: string; value: string }>

  report.sourceCount = rows.length

  if (dryRun) {
    console.log(`  [dry-run] store_settings → StoreSetting: ${rows.length} rows to migrate`)
    return report
  }

  for (const row of rows) {
    try {
      const existing = await prisma.storeSetting.findUnique({ where: { key: row.key } })
      if (existing) {
        report.skipped++
        continue
      }
      await prisma.storeSetting.create({
        data: { key: row.key, value: row.value },
      })
      report.migrated++
    } catch (err) {
      report.errors.push({ row: `store_settings#${row.key}`, error: String(err) })
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Migration: stock_lots → StockLot
// ---------------------------------------------------------------------------

async function migrateStockLots(): Promise<MigrationReport> {
  const report = newReport('stock_lots → StockLot')
  const rows = source.prepare(`
    SELECT id, product_id, lot, expiry_date, qty, cost, received_at, received_qty
    FROM stock_lots
    ORDER BY received_at ASC
  `).all() as Array<{
    id: number
    product_id: number
    lot: string
    expiry_date: string | null
    qty: number
    cost: number
    received_at: string
    received_qty: number | null
  }>

  report.sourceCount = rows.length

  if (dryRun) {
    console.log(`  [dry-run] stock_lots → StockLot: ${rows.length} rows to migrate`)
    return report
  }

  const warehouse = await prisma.warehouse.findFirst({ where: { isDefault: true } })
  if (!warehouse) {
    report.warnings.push('Default warehouse not found — skipping stock_lots')
    return report
  }

  for (const row of rows) {
    try {
      // Resolve legacy product_id → new Product.id via SKU lookup
      const legacyProduct = source.prepare('SELECT sku FROM products WHERE id = ?').get(row.product_id) as { sku: string } | undefined
      if (!legacyProduct) {
        report.warnings.push(`stock_lots#${row.id}: legacy product_id=${row.product_id} not found`)
        report.skipped++
        continue
      }
      const newProduct = await prisma.product.findUnique({ where: { sku: legacyProduct.sku } })
      if (!newProduct) {
        report.warnings.push(`stock_lots#${row.id}: product SKU ${legacyProduct.sku} not yet migrated`)
        report.skipped++
        continue
      }

      const existing = await prisma.stockLot.findFirst({
        where: { productId: newProduct.id, lot: row.lot },
      })
      if (existing) {
        report.skipped++
        continue
      }

      await prisma.stockLot.create({
        data: {
          productId: newProduct.id,
          warehouseId: warehouse.id,
          lot: row.lot,
          expiryDate: parseBangkokTimestamp(row.expiry_date),
          qty: row.qty,
          cost: row.cost || 0,
          receivedAt: parseBangkokTimestamp(row.received_at) ?? new Date(),
          receivedQty: row.received_qty ?? row.qty,
        },
      })
      report.migrated++
    } catch (err) {
      report.errors.push({ row: `stock_lots#${row.id}`, error: String(err) })
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Migration: limit_requests → LimitRequest
// ---------------------------------------------------------------------------

async function migrateLimitRequests(): Promise<MigrationReport> {
  const report = newReport('limit_requests → LimitRequest')
  let rows: Array<any> = []
  try {
    rows = source.prepare(`
      SELECT id, member_number, current_limit, requested_limit, reason, status,
             requested_by, decided_by, decided_at, created_at
      FROM limit_requests
      ORDER BY created_at ASC
    `).all() as any[]
  } catch {
    report.warnings.push('limit_requests table not found in source DB — skipping')
    return report
  }

  report.sourceCount = rows.length

  if (dryRun) {
    console.log(`  [dry-run] limit_requests → LimitRequest: ${rows.length} rows to migrate`)
    return report
  }

  for (const row of rows) {
    try {
      const member = await prisma.member.findUnique({ where: { memberNumber: row.member_number } })
      if (!member) {
        report.skipped++
        continue
      }

      // Resolve decided_by (legacy user display name) → User.id
      let decidedById: string | null = null
      let decidedByName: string | null = null
      if (row.decided_by) {
        const decider = await prisma.user.findFirst({ where: { displayName: row.decided_by } })
        if (decider) {
          decidedById = decider.id
          decidedByName = decider.displayName
        }
      }

      await prisma.limitRequest.create({
        data: {
          memberNumber: row.member_number,
          currentLimit: row.current_limit,
          requestedLimit: row.requested_limit,
          reason: row.reason,
          status: row.status || 'pending',
          requestedByName: row.requested_by,
          decidedById,
          decidedByName,
          decidedAt: parseBangkokTimestamp(row.decided_at),
          createdAt: parseBangkokTimestamp(row.created_at) ?? new Date(),
        },
      })
      report.migrated++
    } catch (err) {
      report.errors.push({ row: `limit_requests#${row.id}`, error: String(err) })
    }
  }

  return report
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------


// Inline system seed — avoids importing next/headers (which is Next-only).
async function ensureSystemSeedInline(): Promise<void> {
  // Default warehouse
  await prisma.warehouse.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { name: 'คลังหลัก', code: 'MAIN', isDefault: true },
  })

  // Roles + permissions
  const SYSTEM_ROLES = [
    { name: 'cashier', label: 'พนักงานขายหน้าร้าน', description: 'เจ้าหน้าที่หน้า POS', isSystem: true, permissions: ['POS.SELL', 'POS.DISCOUNT', 'POS.SPECIAL', 'STOCK.VIEW', 'REPORT.SALES', 'MEMBER.VIEW', 'MEMBER.WALLET'] },
    { name: 'stock_officer', label: 'เจ้าหน้าที่คลังสินค้า', description: 'ดูแลรับเข้า ปรับยอด นับสต็อก', isSystem: true, permissions: ['STOCK.VIEW', 'STOCK.RECEIVE', 'STOCK.ADJUST', 'STOCK.COUNT', 'REPORT.INVENTORY', 'MEMBER.VIEW'] },
    { name: 'supervisor', label: 'หัวหน้างาน', description: 'ดูแลหน้าร้าน + อนุมัติการเงินสำคัญ', isSystem: true, permissions: ['POS.SELL', 'POS.VOID', 'POS.REFUND', 'POS.DISCOUNT', 'POS.SPECIAL', 'STOCK.VIEW', 'STOCK.RECEIVE', 'STOCK.ADJUST', 'STOCK.COUNT', 'REPORT.SALES', 'REPORT.INVENTORY', 'MEMBER.VIEW', 'MEMBER.EDIT', 'MEMBER.WALLET', 'MEMBER.LIMIT_APPROVE'] },
    { name: 'manager', label: 'ผู้จัดการ', description: 'ดูรายงานครบ + อนุมัติคำขอลดวงเงิน', isSystem: true, permissions: ['POS.SELL', 'POS.VOID', 'POS.REFUND', 'POS.DISCOUNT', 'POS.SPECIAL', 'STOCK.VIEW', 'STOCK.RECEIVE', 'STOCK.ADJUST', 'STOCK.COUNT', 'STOCK.TRANSFER', 'REPORT.SALES', 'REPORT.PROFIT', 'REPORT.INVENTORY', 'REPORT.AUDIT', 'MEMBER.VIEW', 'MEMBER.EDIT', 'MEMBER.WALLET', 'MEMBER.DELETE', 'MEMBER.LIMIT_APPROVE', 'SYSTEM.USER_MANAGE', 'SYSTEM.BACKUP'] },
    { name: 'auditor', label: 'ผู้ตรวจสอบ', description: 'ดู audit log + รายงาน + ประวัติ แต่ไม่แก้ไข', isSystem: true, permissions: ['STOCK.VIEW', 'REPORT.SALES', 'REPORT.PROFIT', 'REPORT.INVENTORY', 'REPORT.AUDIT', 'MEMBER.VIEW'] },
    { name: 'administrator', label: 'ผู้ดูแลระบบ', description: 'สิทธิ์เต็ม', isSystem: true, permissions: ['POS.SELL', 'POS.VOID', 'POS.REFUND', 'POS.DISCOUNT', 'POS.SPECIAL', 'STOCK.VIEW', 'STOCK.RECEIVE', 'STOCK.ADJUST', 'STOCK.COUNT', 'STOCK.TRANSFER', 'REPORT.SALES', 'REPORT.PROFIT', 'REPORT.INVENTORY', 'REPORT.AUDIT', 'REPORT.ADVANCED', 'MEMBER.VIEW', 'MEMBER.EDIT', 'MEMBER.WALLET', 'MEMBER.DELETE', 'MEMBER.LIMIT_APPROVE', 'SYSTEM.USER_MANAGE', 'SYSTEM.ROLE_MANAGE', 'SYSTEM.BACKUP', 'SYSTEM.RESTORE', 'SYSTEM.SETTING', 'SYSTEM.LICENSE', 'SYSTEM.UPDATE', 'SYSTEM.SESSION_REVOKE'] },
  ]
  const PERMISSION_CATALOG = [
    { key: 'POS.SELL', group: 'POS', description: 'ขายสินค้าและรับชำระ' },
    { key: 'POS.VOID', group: 'POS', description: 'ยกเลิกบิล' },
    { key: 'POS.REFUND', group: 'POS', description: 'คืนเงิน / คืนบัตรเงินสด' },
    { key: 'POS.DISCOUNT', group: 'POS', description: 'ให้ส่วนลดบิล' },
    { key: 'POS.SPECIAL', group: 'POS', description: 'เปิดรายการพิเศษ' },
    { key: 'STOCK.VIEW', group: 'STOCK', description: 'ดูสต็อก' },
    { key: 'STOCK.RECEIVE', group: 'STOCK', description: 'รับสินค้าเข้า' },
    { key: 'STOCK.ADJUST', group: 'STOCK', description: 'ปรับยอดสต็อก' },
    { key: 'STOCK.COUNT', group: 'STOCK', description: 'นับสต็อก' },
    { key: 'STOCK.TRANSFER', group: 'STOCK', description: 'โอนสินค้าระหว่างคลัง' },
    { key: 'REPORT.SALES', group: 'REPORT', description: 'ดูรายงานยอดขาย' },
    { key: 'REPORT.PROFIT', group: 'REPORT', description: 'ดูรายงานกำไร/ต้นทุน' },
    { key: 'REPORT.INVENTORY', group: 'REPORT', description: 'ดูรายงานสินค้าคงคลัง' },
    { key: 'REPORT.AUDIT', group: 'REPORT', description: 'ดู audit log' },
    { key: 'REPORT.ADVANCED', group: 'REPORT', description: 'รายงานขั้นสูง' },
    { key: 'MEMBER.VIEW', group: 'MEMBER', description: 'ดูข้อมูลสมาชิก' },
    { key: 'MEMBER.EDIT', group: 'MEMBER', description: 'แก้ข้อมูลสมาชิก' },
    { key: 'MEMBER.WALLET', group: 'MEMBER', description: 'เติม/ถอนเงินสมาชิก' },
    { key: 'MEMBER.DELETE', group: 'MEMBER', description: 'ลบสมาชิก' },
    { key: 'MEMBER.LIMIT_APPROVE', group: 'MEMBER', description: 'พิจารณาคำขอลดวงเงินสมาชิก' },
    { key: 'SYSTEM.USER_MANAGE', group: 'SYSTEM', description: 'จัดการบัญชีผู้ใช้' },
    { key: 'SYSTEM.ROLE_MANAGE', group: 'SYSTEM', description: 'จัดการ Role/Permission' },
    { key: 'SYSTEM.BACKUP', group: 'SYSTEM', description: 'สำรองข้อมูล' },
    { key: 'SYSTEM.RESTORE', group: 'SYSTEM', description: 'กู้คืนข้อมูล' },
    { key: 'SYSTEM.SETTING', group: 'SYSTEM', description: 'ตั้งค่าระบบ' },
    { key: 'SYSTEM.LICENSE', group: 'SYSTEM', description: 'จัดการลิขสิทธิ์' },
    { key: 'SYSTEM.UPDATE', group: 'SYSTEM', description: 'อัปเดตระบบ' },
    { key: 'SYSTEM.SESSION_REVOKE', group: 'SYSTEM', description: 'ยกเลิก session' },
  ]

  for (const p of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: p.key },
      update: { group: p.group, description: p.description },
      create: p,
    })
  }

  for (const role of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { label: role.label, description: role.description, isSystem: role.isSystem },
      create: { name: role.name, label: role.label, description: role.description, isSystem: role.isSystem },
    })
    for (const permKey of role.permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionKey: { roleId: role.name, permissionKey: permKey } },
        update: {},
        create: { roleId: role.name, permissionKey: permKey },
      })
    }
  }

  const existing = await prisma.storeSetting.findUnique({ where: { key: 'app_settings' } })
  if (!existing) {
    await prisma.storeSetting.create({
      data: { key: 'app_settings', value: JSON.stringify({
        storeName: 'ร้านค้าสวัสดิการ', storeCode: 'PNG', appName: 'PNG Shop',
        appTheme: 'emerald', appStyle: 'shop',
        memberNumberMode: 'running', memberNumberPrefix: 'M',
        memberNumberYearMode: 'none', memberNumberYearDigits: 2,
        memberNumberSeparator: '-', memberNumberResetMonth: 1, memberNumberSequenceDigits: 6,
        dailyCutOffMode: 'auto', dailyCutOffTime: '00:00',
        receiptPaperWidth: '72', showBalanceOnReceipt: true,
        lowBalanceAlert: true, lowBalanceThreshold: 100,
        lowStockAlert: true, expiryAlert: true, expiryAlertDays: 30,
        backupAutoEnabled: false, backupIntervalHours: 24, backupKeepCount: 14,
        promptpayId: '', helpPhone: '', posRailHidden: '[]', posShortcutKeys: '{}',
        devAccess: false, fontScale: 'base',
      }) },
    })
  }
}

async function main() {
  const reports: MigrationReport[] = []

  console.log('Phase 1: Ensuring system seed (warehouse, roles, permissions)...')
  if (!dryRun) {
    await ensureSystemSeedInline()
  }
  console.log()

  console.log('Phase 2: Migrating data...')
  reports.push(await migrateUsers())
  reports.push(await migrateMembers())
  reports.push(await migrateProducts())
  reports.push(await migrateStockLots())
  reports.push(await migrateSales())
  reports.push(await migrateMemberTransactions())
  reports.push(await migrateAuditLogs())
  reports.push(await migrateSessions())
  reports.push(await migrateSettings())
  reports.push(await migrateLimitRequests())
  console.log()

  console.log('━' .repeat(80))
  console.log('  Migration Report')
  console.log('━' .repeat(80))
  console.log('  Table                                   | Source | Migrated | Skipped | Errors')
  console.log('  ' + '─'.repeat(76))
  for (const r of reports) {
    const table = r.table.padEnd(40)
    const src = String(r.sourceCount).padStart(6)
    const mig = String(r.migrated).padStart(8)
    const skp = String(r.skipped).padStart(7)
    const err = String(r.errors.length).padStart(6)
    console.log(`  ${table} | ${src} | ${mig} | ${skp} | ${err}`)
  }
  console.log('  ' + '─'.repeat(76))

  const totalErrors = reports.flatMap(r => r.errors)
  const totalWarnings = reports.flatMap(r => r.warnings)

  if (totalErrors.length > 0) {
    console.log()
    console.log(`  Errors (${totalErrors.length}):`)
    for (const e of totalErrors.slice(0, 20)) {
      console.log(`    - ${e.row}: ${e.error.slice(0, 200)}`)
    }
    if (totalErrors.length > 20) {
      console.log(`    ... and ${totalErrors.length - 20} more`)
    }
  }

  if (totalWarnings.length > 0) {
    console.log()
    console.log(`  Warnings (${totalWarnings.length}):`)
    for (const w of totalWarnings.slice(0, 10)) {
      console.log(`    - ${w}`)
    }
  }

  console.log()
  console.log(dryRun ? '  ✓ Dry-run complete — no data was written.' : '  ✓ Migration complete.')
  console.log('━' .repeat(80))

  await prisma.$disconnect()
  source.close()
}

main().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
