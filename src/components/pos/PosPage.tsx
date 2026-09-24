'use client'

/**
 * PosPage — main POS view.
 *
 * 3-column layout on desktop (cart left · products right), single column stack
 * on mobile. Mirrors /tmp/Shop/client/src/pages/Pos.tsx flows but is structured
 * as a thin orchestration layer delegating to CartPanel + ProductPanel + the
 * modals (PayConfirmModal, ReceiptModal, RegisterMemberModal, MemberCardModal,
 * BarcodeCameraModal).
 *
 * State lives here. F1-F10 keyboard shortcuts are captured at window level.
 * Scan input is autofocus + re-selects after every add + refocuses when window
 * regains focus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiGet, apiPost } from '@/lib/api-client'
import { money } from '@/lib/format'
import {
  compressImageToDataUrl,
  memberFullName,
  scanMatches,
  smartMatchScore,
} from '@/lib/scan'
import { blocker } from '@/components/shared/BlockerAlert'
import { CartPanel } from './CartPanel'
import { ProductPanel } from './ProductPanel'
import { PayConfirmModal } from './PayConfirmModal'
import { ReceiptModal } from './ReceiptModal'
import { RegisterMemberModal, type RegisterMemberResult } from './RegisterMemberModal'
import { MemberCardModal, type MemberCardData } from './MemberCardModal'
import { BarcodeCameraModal } from './BarcodeCameraModal'
import { useScanLayout, SCAN_LAYOUT_TOAST } from './useScanLayout'
import type {
  CartItem,
  CheckoutReceipt,
  HeldBill,
  MemberLite,
  PaymentMethod,
  PriceTier,
  Product,
} from './types'
import {
  addScannedItem,
  addTierItem,
  calculateCartSubtotal,
  formatBillQty,
  HELD_BILLS_LIMIT,
  loadHeldBills,
  parsePriceTiers,
  POS_RAIL_BUTTONS,
  saveHeldBills,
} from './types'

// -----------------------------------------------------------------------------
// API response shapes (mirrors what /api/products and /api/members return)
// -----------------------------------------------------------------------------

interface ApiProduct {
  id: string
  sku: string
  barcode: string | null
  name: string
  categoryId: string | null
  category: { id: string; name: string; skuPrefix: string | null } | null
  emoji: string | null
  color: string | null
  unit: string | null
  price: number
  cost: number
  stock: number
  reorderPoint: number
  active: boolean
  size: string | null
  imageUrl: string | null
  quickPick: boolean
  sellMode: string
  priceTiers: string | null
}

interface ApiMember {
  id: string
  memberNumber: string
  prename: string | null
  firstName: string
  lastName: string
  type: string
  balance: number
  status: string
  photoUrl: string | null
  gender: string | null
  cardNumber: string | null
  patientCode: string | null
  creditLimit: number | null
  createdAt: string
  lastTransactionAt: string | null
}

interface ApiCategory {
  id: string
  name: string
  skuPrefix: string | null
}

interface SettingsResponse {
  storeName: string
  appName: string
  promptpayId: string
  showBalanceOnReceipt: boolean
}

interface CheckoutApiResponse {
  saleId: string
  orderNumber: string
  subtotal: number
  discount: number
  total: number
  memberBalanceAfter?: number
}

interface WalletApiResponse {
  balanceAfter: number
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Map raw API product → internal `Product` (id coerced to number for stepper math). */
function mapProduct(p: ApiProduct): Product {
  return {
    id: hashCode(p.id),
    name: p.name,
    category: p.category?.name ?? '—',
    price: p.price,
    stock: p.stock,
    unit: p.unit ?? 'ชิ้น',
    color: p.color ?? '#6d6157',
    emoji: p.emoji ?? '📦',
    size: p.size,
    imageUrl: p.imageUrl,
    sellMode: p.sellMode,
    priceTiers: p.priceTiers,
    quickPick: p.quickPick ? 1 : 0,
    sku: p.sku,
    barcode: p.barcode,
  }
}

function mapMember(m: ApiMember): MemberLite {
  return {
    memberNumber: m.memberNumber,
    prename: m.prename,
    firstName: m.firstName,
    lastName: m.lastName,
    type: m.type,
    balance: m.balance,
    status: m.status === 'suspended' ? 'suspended' : 'active',
    lastTransactionAt: m.lastTransactionAt,
    cardNumber: m.cardNumber,
    patientCode: m.patientCode,
    createdAt: m.createdAt,
    photoUrl: m.photoUrl,
    gender: m.gender,
    creditLimit: m.creditLimit,
  }
}

/** Stable 32-bit integer hash from a string (used to coerce Prisma id → number for cart math). */
function hashCode(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export interface PosPageProps {
  /** Display name of the signed-in user — used as cashier snapshot on receipts. */
  userName: string
}

export function PosPage({ userName }: PosPageProps) {
  // Data
  const [products, setProducts] = useState<Product[]>([])
  const [members, setMembers] = useState<MemberLite[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [promptpayId, setPromptpayId] = useState('')
  const [storeName, setStoreName] = useState('ร้านค้าสวัสดิการ')
  const [showBalanceOnReceipt, setShowBalanceOnReceipt] = useState(true)
  const [loading, setLoading] = useState(true)

  // POS state
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('ทั้งหมด')
  const [cart, setCart] = useState<CartItem[]>([])
  const [selectedMemberNumber, setSelectedMemberNumber] = useState<string | null>(null)
  const [discount, setDiscount] = useState('0')
  const [heldBills, setHeldBills] = useState<HeldBill[]>(() => loadHeldBills())

  // Scan dropdown
  const [scanOpen, setScanOpen] = useState(false)
  const [scanHighlight, setScanHighlight] = useState(-1)
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({})

  // Wallet + special forms (driven by rail buttons / F-keys)
  const [walletOpen, setWalletOpen] = useState<'deposit' | 'withdrawal' | null>(null)
  const [walletAmount, setWalletAmount] = useState('')
  const [walletNote, setWalletNote] = useState('')
  const [specialOpen, setSpecialOpen] = useState(false)
  const [specialName, setSpecialName] = useState('')
  const [specialPrice, setSpecialPrice] = useState('')
  const [specialQty, setSpecialQty] = useState('1')
  const [specialUnit, setSpecialUnit] = useState('รายการ')
  const specialSeq = useRef(0)

  // Modals
  const [cameraOpen, setCameraOpen] = useState(false)
  const [payConfirm, setPayConfirm] = useState<PaymentMethod | null>(null)
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [cardForNew, setCardForNew] = useState<MemberCardData | null>(null)
  const [scanMember, setScanMember] = useState<MemberLite | null>(null)

  // Refs
  const scanRef = useRef<HTMLInputElement | null>(null)
  const scanHeroRef = useRef<HTMLDivElement | null>(null)
  const scanLayout = useScanLayout()
  const formNoiseRef = useRef(Math.random().toString(36).slice(2, 9))

  const focusScan = useCallback(() => {
    const input = scanRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const [prodRes, memRes, catRes, setRes] = await Promise.all([
          apiGet<{ products: ApiProduct[] }>('/api/products'),
          apiGet<{ members: ApiMember[] }>('/api/members'),
          apiGet<{ categories: ApiCategory[] }>('/api/categories'),
          apiGet<SettingsResponse>('/api/system/settings').catch(() => null),
        ])
        if (cancelled) return
        setProducts(prodRes.products.map(mapProduct))
        setMembers(memRes.members.map(mapMember))
        setCategories(catRes.categories.map((c) => c.name))
        if (setRes) {
          setPromptpayId(setRes.promptpayId ?? '')
          setStoreName(setRes.storeName || setRes.appName || 'ร้านค้าสวัสดิการ')
          setShowBalanceOnReceipt(setRes.showBalanceOnReceipt !== false)
        }
      } catch (err) {
        blocker.error(
          'โหลดข้อมูล POS ไม่สำเร็จ',
          err instanceof Error ? err.message : 'เกิดข้อผิดพลาดบางอย่าง',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Refocus scan input on window focus (scan gun fires at any moment).
  useEffect(() => {
    const onFocus = () => focusScan()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [focusScan])

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------
  const selectedMember = useMemo(
    () => members.find((m) => m.memberNumber === selectedMemberNumber) ?? null,
    [members, selectedMemberNumber],
  )

  const scanSuggestions = useMemo(() => {
    const q = query.trim()
    if (q === '') return [] as Product[]
    return products
      .map((product) => ({
        product,
        score: Math.max(
          smartMatchScore(product.barcode, q),
          smartMatchScore(product.sku, q),
          smartMatchScore(product.name, q) * 0.92,
        ),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((entry) => entry.product)
  }, [products, query])

  const scanMemberSuggestions = useMemo(() => {
    const q = query.trim()
    if (q === '') return [] as MemberLite[]
    return members
      .map((member) => ({
        member,
        score: Math.max(
          smartMatchScore(member.memberNumber, q),
          Math.max(
            smartMatchScore(memberFullName(member), q),
            smartMatchScore(member.firstName, q),
            smartMatchScore(member.lastName, q),
          ) * 0.9,
        ),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((entry) => entry.member)
  }, [members, query])

  const scanRows = useMemo<
    Array<{ kind: 'product'; product: Product } | { kind: 'member'; member: MemberLite }>
  >(
    () => [
      ...scanSuggestions.map((product) => ({ kind: 'product' as const, product })),
      ...scanMemberSuggestions.map((member) => ({ kind: 'member' as const, member })),
    ],
    [scanSuggestions, scanMemberSuggestions],
  )

  // Open dropdown automatically when typing
  useEffect(() => {
    if (query.trim() === '') {
      setScanOpen(false)
      setScanHighlight(-1)
    } else if (scanRows.length > 0) {
      setScanOpen(true)
      setScanHighlight(0)
    }
  }, [query, scanRows.length])

  const subtotal = calculateCartSubtotal(cart)
  const discountValue = Math.max(0, Number(discount) || 0)
  const payable = Math.max(0, subtotal - discountValue)
  const walletAfterPreview =
    selectedMember && walletOpen
      ? Math.round(
          (selectedMember.balance + (walletOpen === 'deposit' ? 1 : -1) * (Number(walletAmount) || 0)) *
            100,
        ) / 100
      : 0

  // -------------------------------------------------------------------------
  // Cart actions
  // -------------------------------------------------------------------------
  const findStoreProduct = useCallback(
    (id: number) => products.find((p) => p.id === id),
    [products],
  )

  const addProduct = useCallback(
    (product: Product) => {
      const store = findStoreProduct(product.id)
      if (store?.sellMode === 'money' && parsePriceTiers(store.priceTiers).length > 0) {
        blocker.warning(
          'สินค้านี้ขายเป็นราคา — กดปุ่มราคาบนการ์ด',
          `${product.name} — เลือกขนาดที่ปุ่มราคา (฿1 / ฿5 / ฿10) บนการ์ดสินค้า`,
        )
        return
      }
      const currentQty = cart.reduce(
        (sum, item) => (item.id === product.id && !item.variant ? sum + item.qty : sum),
        0,
      )
      if (store && currentQty + 1 > store.stock) {
        blocker.error(
          'สต็อกไม่พอ — เพิ่มเข้าบิลไม่ได้',
          `${product.name} เหลือ ${formatBillQty(store.stock, store.unit)} ในคลัง`,
        )
        return
      }
      setCart((items) => addScannedItem(items, product))
      toast.success('เพิ่มสินค้าเข้าบิลแล้ว', {
        description: product.name,
        duration: 1500,
      })
      setQuery('')
      focusScan()
    },
    [cart, findStoreProduct, focusScan],
  )

  const addTier = useCallback(
    (product: Product, tier: PriceTier) => {
      const store = findStoreProduct(product.id)
      const inBill = cart.reduce((sum, item) => (item.id === product.id ? sum + item.qty : sum), 0)
      if (store && inBill + tier.qty > store.stock) {
        blocker.error(
          'สต็อกไม่พอ — เพิ่มเข้าบิลไม่ได้',
          `${product.name} เหลือ ${formatBillQty(store.stock, store.unit)} ในคลัง`,
        )
        return
      }
      setCart((items) => addTierItem(items, product, tier))
      toast.success(`เพิ่ม ${product.name} ${tier.label} แล้ว`, { duration: 1500 })
      focusScan()
    },
    [cart, findStoreProduct, focusScan],
  )

  const bumpQty = useCallback(
    (id: number, delta: number, variant?: string, step = 1) => {
      if (delta > 0) {
        const store = findStoreProduct(id)
        const inBill = cart.reduce((sum, item) => (item.id === id ? sum + item.qty : sum), 0)
        if (store && inBill + delta * step > store.stock) {
          blocker.error(
            'สต็อกไม่พอ — เพิ่มจำนวนไม่ได้',
            `${store.name} เหลือ ${formatBillQty(store.stock, store.unit)} ในคลัง`,
          )
          return
        }
      }
      setCart((items) =>
        items.flatMap((item) =>
          item.id === id && (item.variant ?? '') === (variant ?? '')
            ? item.qty + delta * step <= 0
              ? []
              : [{ ...item, qty: item.qty + delta * step }]
            : item,
        ),
      )
    },
    [cart, findStoreProduct],
  )

  const applyQtyDirect = useCallback(
    (item: CartItem, qty: number) => {
      if (!Number.isFinite(qty) || qty < 1) return
      const store = findStoreProduct(item.id)
      if (store && !item.variant && !item.special) {
        const others = cart.reduce(
          (sum, entry) =>
            entry.id === item.id && (entry.variant ?? '') !== (item.variant ?? '')
              ? sum + entry.qty
              : sum,
          0,
        )
        if (qty + others > store.stock) {
          blocker.error(
            'สต็อกไม่พอสำหรับจำนวนที่ตั้ง',
            `${store.name} เหลือ ${formatBillQty(store.stock, store.unit)} ในคลัง`,
          )
          return
        }
      }
      setCart((items) => items.map((entry) => (entry === item ? { ...entry, qty } : entry)))
      setQtyDrafts((drafts) => {
        const next = { ...drafts }
        delete next[
          item.variant ? `v-${item.id}-${item.variant}` : item.special ? `s-${item.id}` : `p-${item.id}`
        ]
        return next
      })
    },
    [cart, findStoreProduct],
  )

  const removeLine = useCallback((item: CartItem) => {
    setCart((items) => items.filter((entry) => entry !== item))
  }, [])

  // -------------------------------------------------------------------------
  // Scan submit (Enter)
  // -------------------------------------------------------------------------
  const handleScanSubmit = useCallback(
    (codeArg?: string) => {
      if (codeArg === undefined && scanHighlight >= 0 && scanRows[scanHighlight]) {
        const row = scanRows[scanHighlight]
        if (row.kind === 'member') {
          setScanMember(row.member)
          setQuery('')
          setScanOpen(false)
          focusScan()
        } else {
          addProduct(row.product)
        }
        return
      }
      let code = (codeArg ?? query).trim()
      if (!code) {
        setScanOpen(false)
        return
      }
      // Convert Thai keyboard input back to English/digits
      if (codeArg === undefined) {
        const fixed = scanLayout.normalize(code)
        if (fixed.convertedFrom !== undefined) {
          code = fixed.value
          setQuery(fixed.value)
          toast.info(SCAN_LAYOUT_TOAST.message, {
            description: SCAN_LAYOUT_TOAST.description(fixed.convertedFrom, fixed.value),
            duration: 3200,
          })
        }
      }
      // Exact product match (barcode / SKU)
      const exact = products.find(
        (product) => scanMatches(product.barcode, code) || scanMatches(product.sku, code),
      )
      if (exact) {
        addProduct(exact)
        return
      }
      // Exact member match → verify card
      const memberHit = members.find((member) => scanMatches(member.memberNumber, code))
      if (memberHit) {
        setScanMember(memberHit)
        setQuery('')
        setScanOpen(false)
        focusScan()
        return
      }
      // Ambiguous → keep dropdown open
      if (scanSuggestions.length + scanMemberSuggestions.length > 1) {
        setScanOpen(true)
        setScanHighlight(0)
        return
      }
      // Single suggestion
      if (scanSuggestions.length === 1) {
        addProduct(scanSuggestions[0])
        return
      }
      blocker.warning(
        'ไม่พบรายการที่สแกน',
        `ไม่พบสินค้าหรือสมาชิกสำหรับ "${code}"\nลองยิงบาร์โค้ดจริง หรือกด F10 เพื่อเพิ่มสินค้าใหม่`,
      )
    },
    [
      addProduct,
      focusScan,
      members,
      products,
      query,
      scanHighlight,
      scanLayout,
      scanMemberSuggestions.length,
      scanRows,
      scanSuggestions,
    ],
  )

  const pickScanProduct = useCallback(
    (product: Product) => {
      addProduct(product)
    },
    [addProduct],
  )

  const pickScanMember = useCallback(
    (member: MemberLite) => {
      setScanMember(member)
      setQuery('')
      setScanOpen(false)
      focusScan()
    },
    [focusScan],
  )

  const confirmScanMember = useCallback(() => {
    if (!scanMember) return
    const member = scanMember
    setScanMember(null)
    if (member.status === 'suspended') {
      blocker.warning(
        'บัตรสมาชิกถูกระงับการใช้จ่าย',
        `${memberFullName(member)} · ${member.memberNumber}\nตรวจสอบกับผู้บริหาร — บิลนี้ชำระด้วยเงินสดหรือ QR แทนได้`,
      )
      focusScan()
      return
    }
    setSelectedMemberNumber(member.memberNumber)
    toast.success(`ยืนยันสมาชิก ${memberFullName(member)} แล้ว`, {
      description: `เลขสมาชิก ${member.memberNumber} · ยอดคงเหลือ ${money(member.balance)}`,
      duration: 3200,
    })
    focusScan()
  }, [scanMember, focusScan])

  // -------------------------------------------------------------------------
  // Wallet + special
  // -------------------------------------------------------------------------
  const submitWallet = useCallback(async () => {
    if (!selectedMember) {
      blocker.warning(
        'ยังไม่ได้เลือกสมาชิก',
        'ยิงบัตรสมาชิกที่ช่องด้านบน หรือเลือกจากรายการก่อนบันทึกรายการ',
      )
      return
    }
    const amount = Number(walletAmount)
    if (!(amount > 0)) {
      blocker.warning('กรุณาระบุจำนวนเงินให้ถูกต้อง', 'ใส่ยอดเงินที่จะเติมหรือถอนเป็นตัวเลขมากกว่า 0')
      return
    }
    if (walletOpen === 'withdrawal' && selectedMember.balance < amount) {
      blocker.error(
        'ยอดเงินคงเหลือไม่พอ',
        `${memberFullName(selectedMember)} คงเหลือ ${money(selectedMember.balance)} · ถอน ${money(amount)} ไม่ได้`,
      )
      return
    }
    try {
      const res = await apiPost<WalletApiResponse>(
        `/api/members/${encodeURIComponent(selectedMember.memberNumber)}/wallet`,
        {
          type: walletOpen === 'withdrawal' ? 'withdrawal' : 'deposit',
          amount,
          note: walletNote.trim() || undefined,
        },
      )
      toast.success(
        walletOpen === 'deposit' ? 'เติมเงินสำเร็จ' : 'ถอนเงินสำเร็จ',
        {
          description: `${memberFullName(selectedMember)} · ${money(amount)} → คงเหลือ ${money(res.balanceAfter)}`,
          duration: 4000,
        },
      )
      // Refresh member list + selected member balance
      const memRes = await apiGet<{ members: ApiMember[] }>('/api/members')
      setMembers(memRes.members.map(mapMember))
      setWalletOpen(null)
      setWalletAmount('')
      setWalletNote('')
      focusScan()
    } catch (err) {
      blocker.error(
        'บันทึกรายการไม่สำเร็จ',
        err instanceof Error ? err.message : 'เกิดข้อผิดพลาดบางอย่าง',
      )
    }
  }, [selectedMember, walletAmount, walletOpen, walletNote, focusScan])

  const submitSpecial = useCallback(() => {
    const name = specialName.trim()
    const price = Number(specialPrice)
    const qty = Math.max(1, Math.floor(Number(specialQty) || 1))
    const unit = specialUnit.trim() || 'รายการ'
    if (!name) {
      blocker.warning('กรุณาระบุชื่อรายการพิเศษ', 'เช่น ข้าวราดแกงนอกรายการ / ค่าฝากของ')
      return
    }
    if (!(price > 0)) {
      blocker.warning('ราคาต่อหน่วยต้องมากกว่า 0', 'ใส่ราคาของรายการพิเศษนี้ให้ถูกต้อง')
      return
    }
    const specialId = -(Date.now() + (specialSeq.current += 1))
    setCart((items) => [...items, { id: specialId, name, price, qty, unit, special: true }])
    setSpecialName('')
    setSpecialPrice('')
    setSpecialQty('1')
    setSpecialUnit('รายการ')
    setSpecialOpen(false)
    toast.success('เพิ่มรายการพิเศษเข้าบิลแล้ว', {
      description: `${name} · ${qty} ${unit} · ${money(price * qty)}`,
      duration: 2000,
    })
    focusScan()
  }, [specialName, specialPrice, specialQty, specialUnit, focusScan])

  // -------------------------------------------------------------------------
  // Held bills
  // -------------------------------------------------------------------------
  const holdBill = useCallback(() => {
    if (cart.length === 0) {
      if (heldBills.length > 0) {
        toast.info(`มีบิลที่พักอยู่ ${heldBills.length} บิล`, {
          description: 'เรียกคืนได้จากแถบใต้ช่องสแกน',
        })
      } else {
        blocker.warning('ยังไม่มีรายการในบิลที่จะพักไว้', 'เพิ่มสินค้าเข้าบิลก่อน แล้วกดพักบิล (F5)')
      }
      return
    }
    if (heldBills.length >= HELD_BILLS_LIMIT) {
      blocker.warning(
        `พักบิลได้สูงสุด ${HELD_BILLS_LIMIT} บิล`,
        'เรียกคืนหรือยกเลิกบิลที่พักไว้ก่อน แล้วจึงพักบิลใหม่ได้',
      )
      return
    }
    const newBill: HeldBill = {
      id: Date.now(),
      savedAt: Date.now(),
      items: cart,
      discount,
      memberNumber: selectedMemberNumber,
    }
    const next = [...heldBills, newBill]
    setHeldBills(next)
    saveHeldBills(next)
    setCart([])
    setDiscount('0')
    setSelectedMemberNumber(null)
    toast.success('พักบิลแล้ว', {
      description: `${newBill.items.reduce((s, i) => s + i.qty, 0)} ชิ้น · ${money(calculateCartSubtotal(newBill.items))}`,
      duration: 2400,
    })
    focusScan()
  }, [cart, discount, focusScan, heldBills, selectedMemberNumber])

  const restoreHeld = useCallback(
    (id: number) => {
      const bill = heldBills.find((entry) => entry.id === id)
      if (!bill) return
      let nextHeld = heldBills.filter((entry) => entry.id !== id)
      if (cart.length > 0) {
        // Auto-park current bill before restoring
        const swap: HeldBill = {
          id: Date.now(),
          savedAt: Date.now(),
          items: cart,
          discount,
          memberNumber: selectedMemberNumber,
        }
        nextHeld = [...nextHeld, swap]
      }
      setHeldBills(nextHeld)
      saveHeldBills(nextHeld)
      setCart(bill.items)
      setDiscount(bill.discount)
      setSelectedMemberNumber(bill.memberNumber)
      toast.info('เรียกคืนบิลที่พักไว้แล้ว', {
        description: `${bill.items.reduce((s, i) => s + i.qty, 0)} ชิ้น`,
        duration: 2400,
      })
      focusScan()
    },
    [cart, discount, focusScan, heldBills, selectedMemberNumber],
  )

  const discardHeld = useCallback(
    (id: number) => {
      const next = heldBills.filter((entry) => entry.id !== id)
      setHeldBills(next)
      saveHeldBills(next)
      toast.info('ยกเลิกบิลที่พักไว้แล้ว', {
        description: 'รายการในบิลนั้นถูกล้างออกจากอุปกรณ์นี้',
      })
    },
    [heldBills],
  )

  // -------------------------------------------------------------------------
  // Checkout flow
  // -------------------------------------------------------------------------
  const startCheckout = useCallback(() => {
    if (cart.length === 0) return
    if (discountValue > subtotal) {
      blocker.warning('ส่วนลดมากกว่ายอดรวมสินค้า', 'ปรับส่วนลดให้ไม่เกินยอดรวม แล้วชำระเงินใหม่ได้เลย')
      return
    }
    // Default to cash — user picks method in modal
    setPayConfirm('เงินสด')
  }, [cart.length, discountValue, subtotal])

  const completePayment = useCallback(
    async (method: PaymentMethod, slipImage: string | null) => {
      if (method === 'หักบัญชีสมาชิก' && !selectedMember) {
        blocker.warning('ยังไม่ได้เลือกสมาชิก', 'ชำระแบบหักบัญชีสมาชิก ต้องมีสมาชิกในบิลก่อน')
        return
      }
      try {
        const result = await apiPost<CheckoutApiResponse>('/api/pos/checkout', {
          items: cart.map((item) =>
            item.special
              ? { name: item.name, price: item.price, qty: item.qty, unit: item.unit }
              : item.variant
                ? {
                    productId: String(item.id),
                    qty: item.qty,
                    price: Math.round((item.price / (item.step || 1)) * 10000) / 10000,
                    unit: item.unit,
                    label: item.variant,
                  }
                : { productId: String(item.id), qty: item.qty },
          ),
          paymentMethod: method,
          memberNumber: selectedMember?.memberNumber ?? null,
          discount: discountValue,
          slipImage: slipImage,
        })
        const itemsSnapshot = cart.map((item) => ({
          productId: item.special ? null : String(item.id),
          name: item.name,
          qty: item.qty,
          unit: item.unit,
          price: item.price,
          amount: item.variant
            ? item.price * (item.qty / (item.step || 1))
            : item.price * item.qty,
          variant: item.variant ?? null,
        }))
        const receipt: CheckoutReceipt = {
          saleId: result.saleId,
          orderNumber: result.orderNumber,
          subtotal: result.subtotal,
          discount: result.discount,
          total: result.total,
          memberBalanceAfter: result.memberBalanceAfter,
          paymentMethod: method,
          memberNumber: selectedMember?.memberNumber ?? null,
          memberName: selectedMember ? memberFullName(selectedMember) : null,
          cashier: userName,
          items: itemsSnapshot,
          createdAt: new Date().toISOString(),
        }
        setReceipt(receipt)
        setPayConfirm(null)
        toast.success('ชำระเงินสำเร็จ', {
          description: `บิล ${receipt.orderNumber} · ${method} · ยอด ${money(receipt.total)}`,
          duration: 4500,
        })
      } catch (err) {
        blocker.error(
          'ชำระเงินไม่สำเร็จ',
          err instanceof Error ? err.message : 'เกิดข้อผิดพลาดบางอย่าง',
          { hint: 'บิลนี้ยังไม่ถูกบันทึก — แก้ไขแล้วกดยืนยันใหม่ได้เลย' },
        )
      }
    },
    [cart, discountValue, selectedMember, userName],
  )

  const startNewSale = useCallback(() => {
    setReceipt(null)
    setCart([])
    setDiscount('0')
    setSelectedMemberNumber(null)
    setPayConfirm(null)
    setSpecialOpen(false)
    setWalletOpen(null)
    focusScan()
  }, [focusScan])

  // -------------------------------------------------------------------------
  // Register member
  // -------------------------------------------------------------------------
  const onMemberRegistered = useCallback(
    (result: RegisterMemberResult) => {
      setRegisterOpen(false)
      const m = result.member
      setSelectedMemberNumber(m.memberNumber)
      setCardForNew({
        memberNumber: m.memberNumber,
        prename: m.prename,
        firstName: m.firstName,
        lastName: m.lastName,
        type: m.type,
        balance: m.balance,
        status: m.status === 'suspended' ? 'suspended' : 'active',
        createdAt: m.createdAt,
        photoUrl: m.photoUrl,
        gender: m.gender,
        cardNumber: m.cardNumber,
        patientCode: m.patientCode,
      })
      toast.success('ลงทะเบียนสมาชิกใหม่แล้ว', {
        description: `${memberFullName({ prename: m.prename, firstName: m.firstName, lastName: m.lastName })} · ${m.memberNumber}`,
        duration: 4000,
      })
      // Refresh member list
      void apiGet<{ members: ApiMember[] }>('/api/members').then((res) => {
        setMembers(res.members.map(mapMember))
      })
    },
    [],
  )

  // -------------------------------------------------------------------------
  // F1-F10 keyboard shortcuts (captured at window level when PosPage mounted)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Don't interfere when modal/form/input is focused AND key is not F1-F12
      const target = event.target as HTMLElement | null
      const isFormEl =
        target && typeof target.closest === 'function'
          ? target.closest('input, textarea, select, [contenteditable]')
          : null
      if (!event.key.startsWith('F') || event.key === 'F11') return
      event.preventDefault()
      switch (event.key) {
        case 'F1':
          // Focus the scan input which doubles as member search — cashier types
          // a member number/name and Enter picks from the dropdown.
          focusScan()
          toast.info('ค้นหาสมาชิก', {
            description: 'พิมพ์เลขสมาชิกหรือชื่อที่ช่องสแกน แล้วกด Enter',
            duration: 2000,
          })
          break
        case 'F2':
          setWalletOpen((w) => (w === 'deposit' ? null : 'deposit'))
          setWalletAmount('')
          setWalletNote('')
          break
        case 'F3':
          setWalletOpen((w) => (w === 'withdrawal' ? null : 'withdrawal'))
          setWalletAmount('')
          setWalletNote('')
          break
        case 'F4':
          setSpecialOpen((s) => !s)
          break
        case 'F5':
          holdBill()
          break
        case 'F6':
          setRegisterOpen(true)
          break
        case 'F7':
          toast.info('จัดแผงลัดหน้าร้าน', {
            description: 'หน้านี้จะเปิดใน Task ถัดไป — สามารถติ๊ก quickPick ของแต่ละสินค้าในหน้าสต็อกได้',
          })
          break
        case 'F8':
          focusScan()
          break
        case 'F9':
          toast.info('เปิดหน้ารับเข้า', {
            description: 'หน้ารับสินค้าเข้าคลังจะถูกพัฒนาต่อใน Task 6 (Stock)',
          })
          break
        case 'F10':
          toast.info('เปิดหน้าเพิ่มสินค้า', {
            description: 'หน้าเพิ่มสินค้าใหม่จะถูกพัฒนาต่อใน Task 6 (Stock)',
          })
          break
        default:
          if (isFormEl && event.key === 'Escape') {
            // Let inputs handle Esc themselves
            return
          }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusScan, holdBill])

  // Esc closes any open modal
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (scanMember) {
        event.preventDefault()
        setScanMember(null)
        return
      }
      if (payConfirm) {
        event.preventDefault()
        setPayConfirm(null)
        return
      }
      if (registerOpen) {
        event.preventDefault()
        setRegisterOpen(false)
        return
      }
      if (cardForNew) {
        event.preventDefault()
        setCardForNew(null)
        return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [scanMember, payConfirm, registerOpen, cardForNew])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-sm text-muted-foreground">
        <div className="text-center space-y-2">
          <div className="size-8 mx-auto rounded-full border-2 border-emerald-200 border-t-emerald-600 animate-spin" />
          <p>กำลังโหลดข้อมูล POS…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-3 p-3 min-h-0">
        <CartPanel
          scanInputName={formNoiseRef.current}
          scanHeroRef={scanHeroRef}
          scanRef={scanRef}
          scanLayoutHandlers={{ onKeyDownCapture: scanLayout.onKeyDownCapture }}
          query={query}
          onQueryChange={setQuery}
          onScanSubmit={handleScanSubmit}
          onOpenCamera={() => setCameraOpen(true)}
          scanOpen={scanOpen}
          scanHighlight={scanHighlight}
          scanRows={scanRows}
          onPickScanProduct={pickScanProduct}
          onPickScanMember={pickScanMember}
          onSetScanHighlight={setScanHighlight}
          cart={cart}
          products={products}
          onUpdateQty={bumpQty}
          onApplyQty={applyQtyDirect}
          onRemoveLine={removeLine}
          qtyDrafts={qtyDrafts}
          onQtyDraft={(key, value) => setQtyDrafts((d) => ({ ...d, [key]: value }))}
          walletOpen={walletOpen}
          walletAmount={walletAmount}
          walletNote={walletNote}
          walletTarget={selectedMember}
          walletAfterPreview={walletAfterPreview}
          onWalletAmountChange={setWalletAmount}
          onWalletNoteChange={setWalletNote}
          onWalletSubmit={() => void submitWallet()}
          onWalletCancel={() => {
            setWalletOpen(null)
            setWalletAmount('')
            setWalletNote('')
          }}
          specialOpen={specialOpen}
          specialName={specialName}
          specialPrice={specialPrice}
          specialQty={specialQty}
          specialUnit={specialUnit}
          onSpecialChange={(field, value) => {
            if (field === 'name') setSpecialName(value)
            else if (field === 'price') setSpecialPrice(value)
            else if (field === 'qty') setSpecialQty(value)
            else if (field === 'unit') setSpecialUnit(value)
          }}
          onSpecialSubmit={submitSpecial}
          onSpecialCancel={() => setSpecialOpen(false)}
          heldBills={heldBills}
          onRestoreHeld={restoreHeld}
          onDiscardHeld={discardHeld}
          selectedMember={selectedMember}
          onClearMember={() => setSelectedMemberNumber(null)}
          discount={discount}
          onDiscountChange={setDiscount}
          onCheckout={startCheckout}
          onRailClick={(key) => {
            const btn = POS_RAIL_BUTTONS.find((b) => b.key === key)
            if (!btn) return
            // Dispatch the same F-key handler
            const fakeEvent = new KeyboardEvent('keydown', { key: btn.shortcut })
            window.dispatchEvent(fakeEvent)
          }}
        />

        <ProductPanel
          products={products}
          categories={categories}
          category={category}
          onCategory={setCategory}
          cart={cart}
          onAddProduct={addProduct}
          onAddTier={addTier}
          onBumpQty={(productId, delta) => bumpQty(productId, delta)}
        />
      </div>

      {/* Modals */}
      {cameraOpen && (
        <BarcodeCameraModal
          open={cameraOpen}
          title="สแกนบาร์โค้ดด้วยกล้อง"
          hint="เล็งบาร์โค้ดให้อยู่ในกรอบ — อ่านได้แล้วจะมีเสียงบี๊ปและปิดอัตโนมัติ"
          onClose={() => setCameraOpen(false)}
          onDetect={(code) => {
            setCameraOpen(false)
            setQuery(code)
            handleScanSubmit(code)
          }}
        />
      )}

      {payConfirm && (
        <PayConfirmModal
          open={Boolean(payConfirm)}
          method={payConfirm}
          items={cart}
          discount={discountValue}
          member={selectedMember}
          promptpayId={promptpayId}
          storeName={storeName}
          onClose={() => setPayConfirm(null)}
          onConfirm={completePayment}
        />
      )}

      {receipt && (
        <ReceiptModal
          receipt={receipt}
          onClose={() => setReceipt(null)}
          onNewSale={startNewSale}
          mode="new"
          showBalance={showBalanceOnReceipt}
          storeName={storeName}
        />
      )}

      <RegisterMemberModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onRegistered={onMemberRegistered}
      />

      {scanMember && (
        <MemberCardModal
          member={{
            memberNumber: scanMember.memberNumber,
            prename: scanMember.prename,
            firstName: scanMember.firstName,
            lastName: scanMember.lastName,
            type: scanMember.type,
            balance: scanMember.balance,
            status: scanMember.status,
            createdAt: scanMember.createdAt,
            photoUrl: scanMember.photoUrl,
            gender: scanMember.gender,
            creditLimit: scanMember.creditLimit,
            cardNumber: scanMember.cardNumber,
            patientCode: scanMember.patientCode,
          }}
          onClose={() => setScanMember(null)}
          confirmForBill
          onConfirm={confirmScanMember}
        />
      )}

      {cardForNew && (
        <MemberCardModal
          member={cardForNew}
          onClose={() => setCardForNew(null)}
        />
      )}
    </div>
  )
}
