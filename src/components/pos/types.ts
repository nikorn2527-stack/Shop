/**
 * POS shared types + helpers — mirror of /tmp/Shop/client/src/pages/pageData.ts.
 *
 * These types live in their own module so the big PosPage.tsx file can import
 * the small pure helpers without pulling in any React state.
 */

import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  IdCard,
  LayoutGrid,
  PackageSearch,
  Pause,
  Plus,
  ScanLine,
  Sparkles,
  UserRound,
} from 'lucide-react'

export type CartItem = {
  id: number
  name: string
  price: number
  qty: number
  unit: string
  special?: boolean
  variant?: string
  step?: number
}

export type PriceTier = { label: string; price: number; qty: number }

export type Product = {
  id: number
  name: string
  category: string
  price: number
  stock: number
  unit: string
  color: string
  emoji: string
  size?: string | null
  imageUrl?: string | null
  sellMode?: string | null
  priceTiers?: string | null
  quickPick?: number | boolean
  sku?: string
  barcode?: string | null
}

export type MemberLite = {
  memberNumber: string
  prename?: string | null
  firstName: string
  lastName: string
  type: string
  balance: number
  status: 'active' | 'suspended'
  lastTransactionAt?: string | null
  cardNumber?: string | null
  patientCode?: string | null
  createdAt?: string | null
  photoUrl?: string | null
  gender?: string | null
  creditLimit?: number | null
}

export type HeldBill = {
  id: number
  savedAt: number
  items: CartItem[]
  discount: string
  memberNumber: string | null
}

/** Subtotal — variant lines price PER SERVING while qty is base units. */
export function calculateCartSubtotal(items: CartItem[]): number {
  return items.reduce(
    (sum, item) =>
      sum + (item.variant ? item.price * (item.qty / (item.step || 1)) : item.price * item.qty),
    0,
  )
}

/** Add (or increment) a regular catalog product line. */
export function addScannedItem(items: CartItem[], product: Product): CartItem[] {
  const existing = items.find((item) => item.id === product.id && !item.variant)
  if (existing) {
    return items.map((item) =>
      item.id === product.id && !item.variant ? { ...item, qty: item.qty + 1 } : item,
    )
  }
  return [
    ...items,
    { id: product.id, name: product.name, price: product.price, qty: 1, unit: product.unit },
  ]
}

/** Money-mode product: one tap = one serving of that price tier. */
export function addTierItem(items: CartItem[], product: Product, tier: PriceTier): CartItem[] {
  const variant = tier.label || `฿${tier.price}`
  const existing = items.find((item) => item.id === product.id && item.variant === variant)
  if (existing) {
    return items.map((item) =>
      item.id === product.id && item.variant === variant
        ? { ...item, qty: item.qty + tier.qty }
        : item,
    )
  }
  return [
    ...items,
    {
      id: product.id,
      name: tier.label ? `${product.name} · ${tier.label}` : product.name,
      price: tier.price,
      qty: tier.qty,
      unit: product.unit,
      variant,
      step: tier.qty,
    },
  ]
}

/** Parses the priceTiers JSON column — invalid entries are dropped silently. */
export function parsePriceTiers(json?: string | null): PriceTier[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((tier): tier is Record<string, unknown> => Boolean(tier) && typeof tier === 'object')
      .map((tier) => ({
        label: String(tier.label ?? '').trim(),
        price: Number(tier.price),
        qty: Number(tier.qty),
      }))
      .filter(
        (tier) =>
          Number.isFinite(tier.price) &&
          tier.price > 0 &&
          Number.isFinite(tier.qty) &&
          tier.qty > 0,
      )
  } catch {
    return []
  }
}

/** localStorage key for parked (held) bills — device-local parking. */
export const HELD_BILLS_KEY = 'png-held-bills-v1'
export const HELD_BILLS_LIMIT = 6

/** Reads parked bills from localStorage, dropping malformed/empty entries. */
export function loadHeldBills(): HeldBill[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(HELD_BILLS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HeldBill[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((bill) => bill && Array.isArray(bill.items) && bill.items.length > 0)
      .slice(0, HELD_BILLS_LIMIT)
  } catch {
    return []
  }
}

/** Persist parked bills to localStorage (silently no-op when full/blocked). */
export function saveHeldBills(bills: HeldBill[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(HELD_BILLS_KEY, JSON.stringify(bills.slice(0, HELD_BILLS_LIMIT)))
  } catch {
    /* storage ถูกบล็อกหรือเต็ม — ใช้เฉพาะในเซสชันนี้ */
  }
}

/** Money-mode products count stock in grams — show 1,200 ก. / 1.2 กก. */
export function formatBillQty(qty: number, unit: string): string {
  const normalized = (unit || '').trim()
  if (normalized === 'กรัม' || normalized === 'ก.' || normalized === 'กรัม (g)') {
    return qty >= 1000
      ? `${(qty / 1000).toLocaleString('th-TH', { maximumFractionDigits: 2 })} กก.`
      : `${qty.toLocaleString('th-TH')} ก.`
  }
  return qty.toLocaleString('th-TH')
}

/** 10 rail buttons + their F-key shortcuts (mirrors the original POS layout). */
export type PosRailKey =
  | 'scan'
  | 'customer'
  | 'deposit'
  | 'withdrawal'
  | 'special'
  | 'hold'
  | 'register'
  | 'manage'
  | 'receive'
  | 'add'

export interface PosRailButton {
  key: PosRailKey
  label: string
  shortcut: string // e.g. "F8"
  icon: LucideIcon
}

export const POS_RAIL_BUTTONS: PosRailButton[] = [
  { key: 'scan', label: 'สแกน', shortcut: 'F8', icon: ScanLine },
  { key: 'customer', label: 'สมาชิก', shortcut: 'F1', icon: UserRound },
  { key: 'deposit', label: 'เติมเงิน', shortcut: 'F2', icon: ArrowDownToLine },
  { key: 'withdrawal', label: 'ถอนเงิน', shortcut: 'F3', icon: ArrowUpFromLine },
  { key: 'special', label: 'รายการพิเศษ', shortcut: 'F4', icon: Sparkles },
  { key: 'hold', label: 'พักบิล', shortcut: 'F5', icon: Pause },
  { key: 'register', label: 'ลงทะเบียน', shortcut: 'F6', icon: IdCard },
  { key: 'manage', label: 'จัดแผง', shortcut: 'F7', icon: LayoutGrid },
  { key: 'receive', label: 'รับเข้า', shortcut: 'F9', icon: PackageSearch },
  { key: 'add', label: 'เพิ่มสินค้า', shortcut: 'F10', icon: Plus },
]

/** Payment method labels — must match the zod enum in /api/pos/checkout. */
export type PaymentMethod = 'เงินสด' | 'QR / สแกน' | 'หักบัญชีสมาชิก'

/** Receipt shape returned by POST /api/pos/checkout. */
export interface CheckoutReceipt {
  saleId: string
  orderNumber: string
  subtotal: number
  discount: number
  total: number
  memberBalanceAfter?: number
  paymentMethod: PaymentMethod
  memberNumber?: string | null
  memberName?: string | null
  cashier?: string | null
  items: {
    productId?: string | null
    name: string
    qty: number
    unit?: string | null
    price: number
    amount: number
    variant?: string | null
  }[]
  createdAt?: string
}
