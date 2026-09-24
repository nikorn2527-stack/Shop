'use client'

/**
 * MemberCardModal — printable wallet card for a member.
 *
 * Mirror of /tmp/Shop/client/src/components/MemberCardModal.tsx, adapted to
 * shadcn/ui Dialog + Tailwind (no bespoke CSS file).
 *
 * Renders BOTH a Code128 barcode and a QR of the member number so the cashier
 * can scan either code with a scanner gun. Two modes:
 *   - Default (print/download): the wallet card itself.
 *   - `confirmForBill=true`: triggered by scanning a member card at POS — shows
 *     the same card so the cashier can verify name/photo/number/balance before
 *     attaching the member to the bill. Buttons swap to "ยืนยันใช้กับบิลนี้".
 */

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import html2canvas from 'html2canvas'
import {
  Barcode,
  CreditCard,
  Download,
  IdCard,
  Printer,
  QrCode as QrIcon,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { money } from '@/lib/format'
import { code128DataUrl } from '@/lib/barcode'
import { memberFullName } from '@/lib/scan'

export interface MemberCardData {
  memberNumber: string
  prename?: string | null
  firstName: string
  lastName: string
  type: string
  balance: number
  status: 'active' | 'suspended'
  createdAt?: string | null
  photoUrl?: string | null
  gender?: string | null
  creditLimit?: number | null
  cardNumber?: string | null
  patientCode?: string | null
}

export interface MemberCardModalProps {
  member: MemberCardData
  onClose: () => void
  /** true = POS scan-confirm mode (ยืนยัน instead of print). */
  confirmForBill?: boolean
  onConfirm?: () => void
  confirmLabel?: string
  confirmHint?: string
}

function formatCardDate(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  })
}

export function MemberCardModal({
  member,
  onClose,
  confirmForBill = false,
  onConfirm,
  confirmLabel = 'ยืนยันใช้กับบิลนี้',
  confirmHint,
}: MemberCardModalProps) {
  const [busy, setBusy] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const barcodeUrl = code128DataUrl(member.memberNumber, {
    height: 54,
    moduleWidth: 2,
    padding: 10,
  })
  const displayName = memberFullName(member)
  const suspended = member.status === 'suspended'

  useEffect(() => {
    let alive = true
    QRCode.toDataURL(member.memberNumber, {
      margin: 0,
      width: 240,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (alive) setQrDataUrl(url)
      })
      .catch(() => {
        if (alive) setQrDataUrl('')
      })
    return () => {
      alive = false
    }
  }, [member.memberNumber])

  const downloadCard = async () => {
    const element = document.getElementById('member-card')
    if (!element) return
    setBusy(true)
    try {
      if (document.fonts?.ready) await document.fonts.ready
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#ffffff' })
      const link = document.createElement('a')
      link.download = `card-${member.memberNumber}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } finally {
      setBusy(false)
    }
  }

  const printCard = () => {
    window.print()
  }

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card shadow-2xl overflow-hidden my-auto"
        role="dialog"
        aria-modal="true"
        aria-label={confirmForBill ? 'ยืนยันข้อมูลสมาชิก' : 'บัตรสมาชิก'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b">
          <div className="min-w-0">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
              {confirmForBill ? 'Member Verification · Scan' : 'Member Wallet Card'}
            </span>
            <h2 className="text-base font-semibold mt-0.5 truncate">
              {confirmForBill ? 'ยืนยันข้อมูลสมาชิก' : 'บัตรสมาชิก'}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {confirmForBill
                ? `สแกนบัตรของ ${displayName} แล้ว — เทียบชื่อ รูป เลขสมาชิก และยอดคงเหลือบนบัตรกับหน้าจอนี้ ก่อนนำไปใช้ทำรายการ`
                : `${displayName} · บัตรใช้ยืนยันตัวตนที่เคาน์เตอร์ — มีทั้งบาร์โค้ดและคิวอาร์โค้ดในใบเดียว`}
            </p>
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

        {confirmForBill && (
          <div
            className={`px-5 py-2.5 text-xs flex items-start gap-2 ${
              suspended ? 'bg-red-50 text-red-700 border-b border-red-200' : 'bg-amber-50 text-amber-800 border-b border-amber-200'
            }`}
          >
            {suspended ? <ShieldAlert size={14} className="mt-0.5 shrink-0" /> : <IdCard size={14} className="mt-0.5 shrink-0" />}
            <span>
              {confirmHint ??
                (suspended
                  ? 'บัตรใบนี้ถูกระงับการใช้จ่าย — ตรวจสอบกับสมาชิกและผู้บริหารก่อน หากยืนยันจะยังชำระด้วยเงินสด/QR ได้แต่หักบัญชีไม่ได้'
                  : 'ตรวจสอบว่าเป็นสมาชิกที่ถูกต้องแล้วกดยืนยัน — ยอดในบัญชียังไม่ถูกหักจนกว่าจะกดชำระเงินท้ายบิล')}
              {member.creditLimit != null ? <> · วงเงินซื้อ/วัน {money(member.creditLimit)}</> : null}
            </span>
          </div>
        )}

        <div className="p-5 bg-muted/30">
          <div
            id="member-card"
            className="mx-auto bg-white rounded-xl shadow-md ring-1 ring-border overflow-hidden max-w-sm"
            style={{ width: '320px' }}
          >
            <div className="bg-emerald-600 text-white px-4 py-3 flex items-center justify-between">
              <div>
                <b className="block text-sm">PNG Shop</b>
                <small className="block text-[10px] opacity-80">Welfare Store</small>
              </div>
              <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full">{member.type}</span>
            </div>
            <div className="p-4 flex items-center gap-3">
              <div className="shrink-0 size-20 rounded-lg overflow-hidden bg-muted grid place-items-center">
                {member.photoUrl ? (
                  <img
                    src={member.photoUrl}
                    alt={`รูปสมาชิก ${displayName}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <IdCard size={32} className="text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight line-clamp-2 break-words">
                  {displayName}
                </div>
                <div className="text-xs font-mono text-muted-foreground mt-0.5">
                  {member.memberNumber}
                </div>
                {member.cardNumber && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {`บัตร ${member.cardNumber}${member.patientCode ? ` · HN ${member.patientCode}` : ''}`}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1 text-[10px]">
                  {member.createdAt ? (
                    <span>สมาชิกตั้งแต่ {formatCardDate(member.createdAt)}</span>
                  ) : (
                    <span>พร้อมใช้จ่ายที่เคาน์เตอร์</span>
                  )}
                  <span
                    className={`px-1.5 py-0.5 rounded-full font-medium ${
                      suspended ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {suspended ? 'ระงับการใช้จ่าย' : 'ใช้จ่ายได้ปกติ'}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 pb-3">
              <div className="text-center">
                {barcodeUrl ? (
                  <img
                    src={barcodeUrl}
                    alt={`บาร์โค้ดเลขสมาชิก ${member.memberNumber}`}
                    className="w-full h-12 object-contain"
                  />
                ) : (
                  <div className="h-12 grid place-items-center text-muted-foreground text-xs">—</div>
                )}
                <small className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mt-1">
                  <Barcode size={11} /> บาร์โค้ด
                </small>
              </div>
              <div className="text-center">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt={`คิวอาร์โค้ดเลขสมาชิก ${member.memberNumber}`}
                    className="w-16 h-16 mx-auto object-contain"
                  />
                ) : (
                  <div className="w-16 h-16 mx-auto grid place-items-center text-muted-foreground">
                    <QrIcon size={32} />
                  </div>
                )}
                <small className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mt-1">
                  <QrIcon size={11} /> คิวอาร์โค้ด
                </small>
              </div>
            </div>
            <div className="bg-muted/50 px-4 py-2 text-[10px] text-muted-foreground flex items-center justify-between">
              <span>ยื่นบัตรนี้ให้สแกน หรือแจ้งหมายเลขสมาชิก</span>
              <span>
                ยอดคงเหลือ <b className="text-foreground">{money(member.balance)}</b>
              </span>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 text-[11px] text-muted-foreground bg-muted/30 border-t flex items-start gap-2">
          <CreditCard size={14} className="mt-0.5 shrink-0" />
          <span>
            {confirmForBill
              ? 'ทุกครั้งที่ยิงบัตรสมาชิก ระบบจะเด้งข้อมูลบัตรขึ้นมาให้ตรวจสอบเสมอ — ยืนยันเฉพาะเมื่อข้อมูลตรงกับลูกค้าที่ยื่นบัตรเท่านั้น'
              : 'สมาชิกไม่มีบัญชีเข้าสู่ระบบแอป — บัตรใบนี้ใช้ระบุตัวตนที่เคาน์เตอร์ · ทุกครั้งที่สแกนบัตร พนักงานจะเห็นข้อมูลสมาชิกเพื่อยืนยันก่อนหักยอดเสมอ'}
          </span>
        </div>

        <div className="p-5 border-t flex gap-2">
          {confirmForBill ? (
            <>
              <Button variant="outline" className="flex-1 h-10" onClick={onClose}>
                <X size={16} /> ไม่ใช่สมาชิกนี้
              </Button>
              <Button
                className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={busy}
                onClick={() => onConfirm?.()}
              >
                <UserCheck size={16} /> {confirmLabel}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="flex-1 h-10"
                disabled={busy}
                onClick={() => void downloadCard()}
              >
                <Download size={16} /> {busy ? 'กำลังสร้างรูป...' : 'ดาวน์โหลดรูปบัตร'}
              </Button>
              <Button
                className="flex-1 h-10 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={printCard}
              >
                <Printer size={16} /> พิมพ์บัตรสมาชิก
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
