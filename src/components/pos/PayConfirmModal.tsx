'use client'

/**
 * PayConfirmModal — payment-method confirmation dialog.
 *
 * Mirror of /tmp/Shop/client/src/pages/Pos.tsx payment-confirm flow.
 *
 * Three payment methods (เงินสด / QR / หักบัญชีสมาชิก):
 *   - เงินสด → simple confirm
 *   - QR → render PromptPay QR (when settings.promptpayId valid + payable > 0)
 *          + optional slip upload (compressed 800px JPEG)
 *   - หักบัญชีสมาชิก → simple confirm (member already attached by parent)
 *
 * On confirm: parent's `onConfirm(method, slipImage)` POSTs to /api/pos/checkout.
 */

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import {
  Banknote,
  Check,
  CreditCard,
  Loader2,
  Upload,
  Wallet,
  X,
  QrCode as QrIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { money } from '@/lib/format'
import { compressImageToDataUrl } from '@/lib/scan'
import { buildPromptPayPayload, isValidPromptPayId } from '@/lib/promptpay'
import type { PaymentMethod, MemberLite, CartItem } from './types'
import { calculateCartSubtotal } from './types'

export interface PayConfirmModalProps {
  open: boolean
  method: PaymentMethod | null
  items: CartItem[]
  discount: number
  member: MemberLite | null
  promptpayId: string
  storeName: string
  onClose: () => void
  onConfirm: (method: PaymentMethod, slipImage: string | null) => Promise<void>
}

const METHOD_LABEL: Record<PaymentMethod, { Icon: typeof Banknote; label: string; hint: string }> = {
  'เงินสด': {
    Icon: Banknote,
    label: 'เงินสด',
    hint: 'รับเงินสดจากลูกค้าแล้วกดยืนยัน — บิลจะถูกบันทึกและตัดสต็อกทันที',
  },
  'QR / สแกน': {
    Icon: QrIcon,
    label: 'QR / สแกน',
    hint: 'ให้ลูกค้าสแกน QR พร้อมเพย์จ่าย แล้วแนบหลักฐานการโอนก่อนกดยืนยัน',
  },
  'หักบัญชีสมาชิก': {
    Icon: Wallet,
    label: 'หักบัญชีสมาชิก',
    hint: 'หักยอดจากบัญชีสมาชิกทันที — ต้องมีสมาชิกในบิลและยอดเงินต้องพอจ่าย',
  },
}

export function PayConfirmModal({
  open,
  method,
  items,
  discount,
  member,
  promptpayId,
  storeName,
  onClose,
  onConfirm,
}: PayConfirmModalProps) {
  const [qrUrl, setQrUrl] = useState('')
  const [slip, setSlip] = useState<{ dataUrl: string; name: string } | null>(null)
  const [slipBusy, setSlipBusy] = useState(false)
  const [pending, setPending] = useState(false)

  const subtotal = calculateCartSubtotal(items)
  const payable = Math.max(0, subtotal - discount)

  // Generate PromptPay QR when method = QR + valid id + payable > 0
  useEffect(() => {
    if (!open || method !== 'QR / สแกน' || !isValidPromptPayId(promptpayId) || !(payable > 0)) {
      setQrUrl('')
      return
    }
    let cancelled = false
    try {
      const payload = buildPromptPayPayload({ promptpayId, amount: payable })
      QRCode.toDataURL(payload, { margin: 1, width: 250, errorCorrectionLevel: 'M' })
        .then((url) => {
          if (!cancelled) setQrUrl(url)
        })
        .catch(() => {
          if (!cancelled) setQrUrl('')
        })
    } catch {
      setQrUrl('')
    }
    return () => {
      cancelled = true
    }
  }, [open, method, promptpayId, payable])

  // Reset slip + pending when modal closes/reopens
  useEffect(() => {
    if (!open) {
      setSlip(null)
      setPending(false)
      setSlipBusy(false)
    }
  }, [open])

  if (!open || !method) return null

  const meta = METHOD_LABEL[method]
  const Icon = meta.Icon

  const handleSlipFile = async (file?: File) => {
    if (!file) return
    setSlipBusy(true)
    try {
      const dataUrl = await compressImageToDataUrl(file, 800, 0.78)
      setSlip({ dataUrl, name: file.name })
    } catch {
      setSlip(null)
    } finally {
      setSlipBusy(false)
    }
  }

  const handleConfirm = async () => {
    if (pending) return
    setPending(true)
    try {
      await onConfirm(method, slip?.dataUrl ?? null)
    } finally {
      setPending(false)
    }
  }

  const canConfirm =
    method !== 'หักบัญชีสมาชิก' || (member !== null && member.balance >= payable)

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card shadow-2xl overflow-hidden my-auto pay-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`ยืนยันการชำระเงิน · ${meta.label}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 size-10 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center">
              <Icon size={20} />
            </span>
            <div className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                Payment Confirmation
              </span>
              <h2 className="text-base font-semibold truncate">ยืนยันการชำระเงิน · {meta.label}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="shrink-0 size-8 rounded-lg text-muted-foreground hover:bg-muted grid place-items-center"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-muted/50 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">ยอดรวมสินค้า</div>
              <div className="font-mono font-semibold">{money(subtotal)}</div>
            </div>
            <div className="rounded-lg bg-muted/50 px-3 py-2">
              <div className="text-[11px] text-muted-foreground">ส่วนลด</div>
              <div className="font-mono font-semibold text-red-600">- {money(discount)}</div>
            </div>
            <div className="col-span-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
              <div className="text-[11px] text-emerald-700">ยอดชำระทั้งหมด</div>
              <div className="font-mono text-xl font-bold text-emerald-700">{money(payable)}</div>
            </div>
            <div className="col-span-2 rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>วิธีชำระ</span>
                <b className="text-foreground">{meta.label}</b>
              </div>
              {member && (
                <div className="flex items-center justify-between mt-1">
                  <span>สมาชิก</span>
                  <b className="text-foreground">{member.memberNumber}</b>
                </div>
              )}
              {method === 'หักบัญชีสมาชิก' && member && (
                <div className="flex items-center justify-between mt-1">
                  <span>ยอดคงเหลือปัจจุบัน</span>
                  <b className="text-foreground">{money(member.balance)}</b>
                </div>
              )}
            </div>
          </div>

          {/* Method-specific UI */}
          {method === 'QR / สแกน' && (
            <div className="space-y-3">
              {qrUrl ? (
                <div className="flex flex-col items-center gap-2 p-3 rounded-lg bg-white border">
                  <img
                    src={qrUrl}
                    alt="คิวอาร์โค้ดพร้อมเพย์สำหรับยอดชำระ"
                    className="w-48 h-48"
                  />
                  <div className="text-center">
                    <b className="block text-sm">{storeName}</b>
                    <small className="block text-xs text-muted-foreground">
                      สแกนจ่ายผ่านแอปธนาคาร · ยอด {money(payable)}
                    </small>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                  {isValidPromptPayId(promptpayId)
                    ? 'กำลังสร้าง QR พร้อมเพย์... — รอสักครู่'
                    : 'ยังไม่ได้ตั้งค่าบัญชีพร้อมเพย์ · เข้า ตั้งค่า → การชำระเงิน เพื่อเปิดใช้งาน หรือเลือกวิธีชำระอื่น'}
                </div>
              )}

              {/* Slip upload */}
              <div className="rounded-lg border border-dashed border-border p-3">
                <div className="flex items-center gap-3">
                  <input
                    id="slip-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      void handleSlipFile(file)
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={slipBusy}
                    onClick={() => document.getElementById('slip-upload')?.click()}
                  >
                    {slipBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {slipBusy ? 'กำลังย่อรูป...' : slip ? 'เปลี่ยนหลักฐาน' : 'แนบหลักฐานการชำระ'}
                  </Button>
                  {slip && (
                    <div className="text-xs text-emerald-700 truncate">
                      ✓ {slip.name}
                    </div>
                  )}
                </div>
                {slip && (
                  <img
                    src={slip.dataUrl}
                    alt="พรีวิวหลักฐานการชำระ"
                    className="mt-2 max-h-32 rounded-lg border"
                  />
                )}
              </div>
            </div>
          )}

          {method === 'หักบัญชีสมาชิก' && member && member.balance < payable && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
              ยอดเงินคงเหลือไม่พอ · ต้องการ {money(payable)} คงเหลือ {money(member.balance)}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
            <CreditCard size={12} className="mt-0.5 shrink-0" />
            {meta.hint}
          </p>
        </div>

        <div className="p-5 border-t flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-11"
            onClick={onClose}
            disabled={pending}
          >
            ยกเลิก
          </Button>
          <Button
            className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white pay-confirm-button"
            disabled={pending || !canConfirm}
            onClick={() => void handleConfirm()}
          >
            {pending ? (
              <>
                <Loader2 size={16} className="animate-spin" /> กำลังบันทึก...
              </>
            ) : (
              <>
                <Check size={16} /> ยืนยันการชำระเงิน
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
