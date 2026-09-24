'use client'

/**
 * CartPanel — left side of the POS layout.
 *
 * Contains:
 *   - ScanHero: input + camera button + Enter hint (kbd)
 *     · autoFocus, autoComplete="off", name=random (browser history disabled)
 *     · On Enter: try exact match (barcode/sku/memberNumber) → add to cart or
 *       select member; otherwise open smart-match dropdown (max 8 items)
 *   - Cart list: name + qty stepper + unit + line total
 *     · Money-mode variant lines: tier label
 *     · Special lines: badge "พิเศษ"
 *     · Stock check on every qty change (caller decides blocker.error)
 *   - Wallet action form (F2/F3): deposit/withdrawal
 *   - Special items form (F4): name + price + qty + unit
 *   - Held bills strip
 *   - CartFooter: discount input + subtotal + total + ปุ่มชำระเงิน
 */

import { useMemo } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Camera,
  Minus,
  Pause,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { money } from '@/lib/format'
import { smartMatchScore, memberFullName } from '@/lib/scan'
import type { CartItem, HeldBill, MemberLite, Product } from './types'
import { calculateCartSubtotal, formatBillQty, POS_RAIL_BUTTONS } from './types'

export interface CartPanelProps {
  // Scan
  scanInputName: string
  scanHeroRef: React.RefObject<HTMLDivElement | null>
  scanRef: React.RefObject<HTMLInputElement | null>
  scanLayoutHandlers: {
    onKeyDownCapture: (event: React.KeyboardEvent<HTMLElement>) => void
  }
  query: string
  onQueryChange: (value: string) => void
  onScanSubmit: (code?: string) => void
  onOpenCamera: () => void
  scanOpen: boolean
  scanHighlight: number
  scanRows: Array<{ kind: 'product'; product: Product } | { kind: 'member'; member: MemberLite }>
  onPickScanProduct: (product: Product) => void
  onPickScanMember: (member: MemberLite) => void
  onSetScanHighlight: (idx: number) => void
  // Cart
  cart: CartItem[]
  products: Product[]
  onUpdateQty: (id: number, delta: number, variant?: string, step?: number) => void
  onApplyQty: (item: CartItem, qty: number) => void
  onRemoveLine: (item: CartItem) => void
  qtyDrafts: Record<string, string>
  onQtyDraft: (key: string, value: string) => void
  // Wallet form
  walletOpen: 'deposit' | 'withdrawal' | null
  walletAmount: string
  walletNote: string
  walletTarget: MemberLite | null
  walletAfterPreview: number
  onWalletAmountChange: (v: string) => void
  onWalletNoteChange: (v: string) => void
  onWalletSubmit: () => void
  onWalletCancel: () => void
  // Special form
  specialOpen: boolean
  specialName: string
  specialPrice: string
  specialQty: string
  specialUnit: string
  onSpecialChange: (field: 'name' | 'price' | 'qty' | 'unit', value: string) => void
  onSpecialSubmit: () => void
  onSpecialCancel: () => void
  // Held bills
  heldBills: HeldBill[]
  onRestoreHeld: (id: number) => void
  onDiscardHeld: (id: number) => void
  // Footer
  selectedMember: MemberLite | null
  onClearMember: () => void
  discount: string
  onDiscountChange: (v: string) => void
  onCheckout: () => void
  onRailClick: (key: typeof POS_RAIL_BUTTONS[number]['key']) => void
}

export function CartPanel(props: CartPanelProps) {
  const subtotal = calculateCartSubtotal(props.cart)
  const discountValue = Math.max(0, Number(props.discount) || 0)
  const payable = Math.max(0, subtotal - discountValue)
  const cartPieces = props.cart.reduce((sum, item) => sum + (item.variant ? 1 : item.qty), 0)

  const sortedScanRows = useMemo(() => {
    const q = props.query.trim()
    if (q === '') return props.scanRows
    // Already scored upstream — pass-through.
    return props.scanRows
  }, [props.scanRows, props.query])

  return (
    <section className="flex flex-col h-full bg-card rounded-xl border overflow-hidden">
      {/* Scan Hero */}
      <div ref={props.scanHeroRef} className="p-3 border-b bg-gradient-to-br from-emerald-50 to-card">
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-1.5">
          สแกนสินค้า / ค้นหา
        </label>
        <div className="relative">
          <Input
            ref={props.scanRef}
            name={props.scanInputName}
            value={props.query}
            onChange={(e) => props.onQueryChange(e.target.value)}
            onKeyDownCapture={props.scanLayoutHandlers.onKeyDownCapture}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (props.scanOpen && props.scanHighlight >= 0 && sortedScanRows[props.scanHighlight]) {
                  const row = sortedScanRows[props.scanHighlight]
                  if (row.kind === 'product') props.onPickScanProduct(row.product)
                  else props.onPickScanMember(row.member)
                } else {
                  props.onScanSubmit()
                }
              } else if (e.key === 'ArrowDown' && props.scanOpen) {
                e.preventDefault()
                props.onSetScanHighlight((props.scanHighlight + 1) % Math.min(sortedScanRows.length, 8))
              } else if (e.key === 'ArrowUp' && props.scanOpen) {
                e.preventDefault()
                props.onSetScanHighlight(
                  (props.scanHighlight - 1 + Math.min(sortedScanRows.length, 8)) %
                    Math.min(sortedScanRows.length, 8),
                )
              } else if (e.key === 'Escape') {
                e.preventDefault()
                props.onQueryChange('')
              }
            }}
            placeholder="ยิงบาร์โค้ด พิมพ์ชื่อสินค้า หรือเลขสมาชิก แล้วกด Enter"
            autoComplete="off"
            spellCheck={false}
            className="h-11 pr-24 font-mono text-sm"
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={props.onOpenCamera}
              aria-label="เปิดกล้องสแกน"
            >
              <Camera size={14} />
              <span className="hidden sm:inline">กล้อง</span>
            </Button>
            <kbd className="hidden sm:inline-flex h-6 items-center px-1.5 rounded bg-muted text-[10px] font-mono text-muted-foreground">
              F8
            </kbd>
          </div>
        </div>

        {/* Smart-match dropdown */}
        {props.scanOpen && sortedScanRows.length > 0 && (
          <div className="mt-1.5 bg-card rounded-lg border shadow-lg max-h-72 overflow-y-auto">
            {sortedScanRows.slice(0, 8).map((row, idx) => {
              const active = idx === props.scanHighlight
              return (
                <button
                  key={row.kind === 'product' ? `p-${row.product.id}` : `m-${row.member.memberNumber}`}
                  type="button"
                  onMouseEnter={() => props.onSetScanHighlight(idx)}
                  onClick={() =>
                    row.kind === 'product'
                      ? props.onPickScanProduct(row.product)
                      : props.onPickScanMember(row.member)
                  }
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs border-b last:border-0 ${
                    active ? 'bg-emerald-50' : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {row.kind === 'product' ? (
                      <>
                        <span className="text-base">{row.product.emoji || '🛍️'}</span>
                        <span className="min-w-0">
                          <b className="block truncate">{row.product.name}</b>
                          <small className="block text-muted-foreground">
                            {row.product.sku ?? '—'} · {money(row.product.price)}/{row.product.unit}
                          </small>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="size-7 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-[10px] font-bold">
                          {(row.member.firstName || '?').slice(0, 1)}
                        </span>
                        <span className="min-w-0">
                          <b className="block truncate">{memberFullName(row.member)}</b>
                          <small className="block text-muted-foreground">
                            {row.member.memberNumber} · คงเหลือ {money(row.member.balance)}
                          </small>
                        </span>
                      </>
                    )}
                  </span>
                  <Badge variant="secondary" className="text-[10px]">
                    {row.kind === 'product' ? 'สินค้า' : 'สมาชิก'}
                  </Badge>
                </button>
              )
            })}
          </div>
        )}
        {props.scanOpen && sortedScanRows.length === 0 && props.query.trim() !== '' && (
          <div className="mt-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
            ไม่พบรายการสำหรับ &quot;{props.query}&quot; · ลองยิงบาร์โค้ดจริง หรือกด F10 เพื่อเพิ่มสินค้าใหม่
          </div>
        )}
      </div>

      {/* Cart list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {props.cart.length === 0 ? (
          <div className="h-full grid place-items-center text-center py-12 text-sm text-muted-foreground p-4">
            <div className="space-y-1.5">
              <Pause size={28} className="mx-auto opacity-30" />
              <p>ยังไม่มีรายการในบิล</p>
              <p className="text-xs">ยิงบาร์โค้ดที่ช่องด้านบน หรือเลือกสินค้าจากแผงขวา</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y">
            {props.cart.map((item) => {
              const key = item.variant
                ? `v-${item.id}-${item.variant}`
                : item.special
                  ? `s-${item.id}`
                  : `p-${item.id}`
              const draft = props.qtyDrafts[key] ?? String(item.qty)
              const lineAmount = item.variant
                ? item.price * (item.qty / (item.step || 1))
                : item.price * item.qty
              return (
                <li key={key} className="p-2.5 hover:bg-muted/30">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <b className="text-sm truncate">{item.name}</b>
                        {item.variant && (
                          <Badge className="text-[10px] bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                            {item.variant}
                          </Badge>
                        )}
                        {item.special && (
                          <Badge className="text-[10px] bg-amber-100 text-amber-800 hover:bg-amber-100">
                            <Sparkles size={9} className="mr-0.5" />
                            พิเศษ
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {money(item.price)} / {item.unit}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <b className="block font-mono text-sm text-emerald-700">{money(lineAmount)}</b>
                      <button
                        type="button"
                        onClick={() => props.onRemoveLine(item)}
                        className="text-[11px] text-red-600 hover:text-red-700 inline-flex items-center gap-1 mt-0.5"
                      >
                        <Trash2 size={10} /> ลบ
                      </button>
                    </div>
                  </div>
                  {/* Qty stepper */}
                  <div className="flex items-center gap-1 mt-1.5">
                    <button
                      type="button"
                      onClick={() => props.onUpdateQty(item.id, -1, item.variant, item.step)}
                      className="size-7 rounded-md border bg-background hover:bg-muted grid place-items-center"
                      aria-label="ลดจำนวน"
                    >
                      <Minus size={13} />
                    </button>
                    <input
                      id={`bill-qty-${key}`}
                      type="text"
                      inputMode="numeric"
                      value={draft}
                      onChange={(e) => props.onQtyDraft(key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const parsed = Number(draft.replace(/[,\s]/g, ''))
                          if (Number.isFinite(parsed) && parsed >= 1) {
                            props.onApplyQty(item, parsed)
                          }
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          props.onQtyDraft(key, String(item.qty))
                        }
                      }}
                      onBlur={() => {
                        if (props.qtyDrafts[key] !== undefined) {
                          const parsed = Number(draft.replace(/[,\s]/g, ''))
                          if (Number.isFinite(parsed) && parsed >= 1) {
                            props.onApplyQty(item, parsed)
                          }
                        }
                      }}
                      className="w-16 h-7 text-center text-sm font-mono rounded-md border bg-background"
                      aria-label="จำนวน"
                    />
                    <button
                      type="button"
                      onClick={() => props.onUpdateQty(item.id, +1, item.variant, item.step)}
                      className="size-7 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white grid place-items-center"
                      aria-label="เพิ่มจำนวน"
                    >
                      <Plus size={13} />
                    </button>
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      {formatBillQty(item.qty, item.unit)} {item.unit}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Wallet form (F2/F3) */}
      {props.walletOpen && (
        <div className="border-t bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <b className="text-xs font-semibold flex items-center gap-1.5">
              {props.walletOpen === 'deposit' ? (
                <ArrowDownToLine size={14} className="text-emerald-600" />
              ) : (
                <ArrowUpFromLine size={14} className="text-amber-600" />
              )}
              {props.walletOpen === 'deposit' ? 'เติมเงินสมาชิก' : 'ถอนเงินสมาชิก'}
            </b>
            <button
              type="button"
              onClick={props.onWalletCancel}
              className="size-6 rounded-md hover:bg-muted grid place-items-center text-muted-foreground"
            >
              <X size={13} />
            </button>
          </div>
          {props.walletTarget ? (
            <div className="text-xs">
              สมาชิก: <b>{memberFullName(props.walletTarget)}</b> ({props.walletTarget.memberNumber})
              <br />
              คงเหลือปัจจุบัน: <b className="font-mono">{money(props.walletTarget.balance)}</b>
              <br />
              หลังทำรายการ:{' '}
              <b className={`font-mono ${props.walletAfterPreview < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {money(props.walletAfterPreview)}
              </b>
            </div>
          ) : (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
              ยังไม่ได้เลือกสมาชิก — ยิงบัตรสมาชิกที่ช่องสแกน หรือเลือกจากรายการก่อน
            </div>
          )}
          <Input
            type="number"
            inputMode="decimal"
            placeholder="จำนวนเงิน (บาท)"
            value={props.walletAmount}
            onChange={(e) => props.onWalletAmountChange(e.target.value)}
            className="h-9 font-mono"
          />
          <Input
            type="text"
            placeholder="หมายเหตุ (ถ้ามี)"
            value={props.walletNote}
            onChange={(e) => props.onWalletNoteChange(e.target.value)}
            className="h-9"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-9"
              onClick={props.onWalletCancel}
            >
              ยกเลิก
            </Button>
            <Button
              size="sm"
              className="flex-1 h-9 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={props.onWalletSubmit}
              disabled={!props.walletTarget || !(Number(props.walletAmount) > 0)}
            >
              {props.walletOpen === 'deposit' ? 'เติมเงิน' : 'ถอนเงิน'}
            </Button>
          </div>
        </div>
      )}

      {/* Special items form (F4) */}
      {props.specialOpen && (
        <div className="border-t bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <b className="text-xs font-semibold flex items-center gap-1.5">
              <Sparkles size={14} className="text-amber-500" />
              รายการพิเศษ (นอกแค็ตตาล็อก)
            </b>
            <button
              type="button"
              onClick={props.onSpecialCancel}
              className="size-6 rounded-md hover:bg-muted grid place-items-center text-muted-foreground"
            >
              <X size={13} />
            </button>
          </div>
          <Input
            type="text"
            placeholder="ชื่อรายการ เช่น ข้าวราดแกง"
            value={props.specialName}
            onChange={(e) => props.onSpecialChange('name', e.target.value)}
            className="h-9"
          />
          <div className="grid grid-cols-3 gap-2">
            <Input
              type="number"
              inputMode="decimal"
              placeholder="ราคา"
              value={props.specialPrice}
              onChange={(e) => props.onSpecialChange('price', e.target.value)}
              className="h-9 font-mono"
            />
            <Input
              type="number"
              inputMode="numeric"
              placeholder="จำนวน"
              value={props.specialQty}
              onChange={(e) => props.onSpecialChange('qty', e.target.value)}
              className="h-9 font-mono"
            />
            <Input
              type="text"
              placeholder="หน่วย"
              value={props.specialUnit}
              onChange={(e) => props.onSpecialChange('unit', e.target.value)}
              className="h-9"
            />
          </div>
          <Button
            size="sm"
            className="w-full h-9 bg-amber-500 hover:bg-amber-600 text-white"
            onClick={props.onSpecialSubmit}
            disabled={!props.specialName.trim() || !(Number(props.specialPrice) > 0)}
          >
            <Plus size={14} /> เพิ่มรายการพิเศษ
          </Button>
        </div>
      )}

      {/* Held bills strip */}
      {props.heldBills.length > 0 && (
        <div className="border-t bg-amber-50/50 p-2">
          <div className="flex items-center gap-1.5 text-[11px] text-amber-800 mb-1">
            <Pause size={11} />
            <span className="font-medium">บิลที่พักไว้ ({props.heldBills.length}/{6})</span>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {props.heldBills.map((bill) => (
              <div
                key={bill.id}
                className="shrink-0 inline-flex items-center gap-2 bg-card border border-amber-200 rounded-md pl-2 pr-1 py-1 text-[11px]"
              >
                <button
                  type="button"
                  onClick={() => props.onRestoreHeld(bill.id)}
                  className="text-left"
                >
                  <b className="block">{money(calculateCartSubtotal(bill.items))}</b>
                  <small className="block text-muted-foreground">
                    {bill.items.reduce((s, i) => s + i.qty, 0)} ชิ้น ·{' '}
                    {new Date(bill.savedAt).toLocaleTimeString('th-TH', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </button>
                <button
                  type="button"
                  onClick={() => props.onDiscardHeld(bill.id)}
                  className="size-5 rounded grid place-items-center text-red-600 hover:bg-red-50"
                  aria-label="ยกเลิกบิลที่พักไว้"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="border-t p-3 space-y-2 bg-card">
        {/* Selected member */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0 flex-1">
            {props.selectedMember ? (
              <div className="flex items-center gap-2">
                <div className="size-7 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center text-[10px] font-bold shrink-0">
                  {props.selectedMember.firstName.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <b className="block truncate">{memberFullName(props.selectedMember)}</b>
                  <small className="text-muted-foreground">
                    {props.selectedMember.memberNumber} · คงเหลือ {money(props.selectedMember.balance)}
                  </small>
                </div>
              </div>
            ) : (
              <span className="text-muted-foreground">บุคคลทั่วไป · กด F1 เพื่อเลือกสมาชิก</span>
            )}
          </div>
          {props.selectedMember && (
            <button
              type="button"
              onClick={props.onClearMember}
              className="text-[11px] text-red-600 hover:text-red-700 shrink-0"
            >
              ล้าง
            </button>
          )}
        </div>

        {/* Discount + total */}
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            placeholder="ส่วนลด (บาท)"
            value={props.discount}
            onChange={(e) => props.onDiscountChange(e.target.value)}
            className="h-9 font-mono"
          />
          <div className="text-right shrink-0">
            <div className="text-[10px] text-muted-foreground">ยอดชำระ</div>
            <div className="font-mono text-lg font-bold text-emerald-700 leading-tight">
              {money(payable)}
            </div>
          </div>
        </div>

        {/* Rail buttons */}
        <div className="grid grid-cols-5 gap-1">
          {POS_RAIL_BUTTONS.map((btn) => {
            const Icon = btn.icon
            return (
              <button
                key={btn.key}
                type="button"
                onClick={() => props.onRailClick(btn.key)}
                className="flex flex-col items-center justify-center gap-0.5 h-12 rounded-md border bg-background hover:bg-accent text-[10px] text-muted-foreground hover:text-foreground"
                title={`${btn.label} (${btn.shortcut})`}
              >
                <Icon size={14} />
                <span className="leading-none">{btn.label}</span>
              </button>
            )
          })}
        </div>

        {/* Checkout button */}
        <Button
          type="button"
          className="w-full h-12 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
          disabled={props.cart.length === 0 || payable <= 0}
          onClick={props.onCheckout}
        >
          ชำระเงิน · {money(payable)} ({cartPieces} ชิ้น)
        </Button>
      </div>
    </section>
  )
}

// Re-export for caller convenience
export { smartMatchScore, calculateCartSubtotal }
