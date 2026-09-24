'use client'

/**
 * ReceiptModal — post-checkout success screen + receipt preview.
 *
 * Mirror of /tmp/Shop/client/src/components/ReceiptModal.tsx behavior:
 *   - mode "new"     → POS after checkout (download/print/new sale)
 *   - mode "reprint" → Reports ประวัติบิล (close instead of new sale)
 *
 * Receipt paper markup is shared verbatim so both flows render identical slips.
 * Download PDF (80mm thermal) via jsPDF · download PNG via html2canvas · print
 * via window.print() (after `document.fonts.ready` so Sarabun renders).
 */

import { useState } from 'react'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import { Check, Download, FileImage, Plus, Printer, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { money, formatThaiDateTime } from '@/lib/format'
import type { CheckoutReceipt } from './types'

export interface ReceiptModalProps {
  receipt: CheckoutReceipt
  onClose: () => void
  onNewSale?: () => void
  mode?: 'new' | 'reprint'
  showBalance?: boolean
  storeName?: string
}

export function ReceiptModal({
  receipt,
  onClose,
  onNewSale,
  mode = 'new',
  showBalance = true,
  storeName = 'ร้านค้าสวัสดิการ',
}: ReceiptModalProps) {
  const [busy, setBusy] = useState<'pdf' | 'image' | ''>('')

  const createdAtLabel = receipt.createdAt
    ? formatThaiDateTime(receipt.createdAt)
    : formatThaiDateTime(new Date().toISOString())

  const download = async (format: 'pdf' | 'image') => {
    const element = document.getElementById('receipt-paper')
    if (!element) return
    setBusy(format)
    try {
      if (document.fonts?.ready) await document.fonts.ready
      const canvas = await html2canvas(element, { scale: 2.5, backgroundColor: '#ffffff' })
      const filename = `${receipt.orderNumber}.${format === 'pdf' ? 'pdf' : 'png'}`
      if (format === 'image') {
        const link = document.createElement('a')
        link.download = filename
        link.href = canvas.toDataURL('image/png')
        link.click()
      } else {
        // 80mm thermal paper width — height derived from canvas aspect ratio.
        const WIDTH_MM = 80
        const pageHeightMm = (canvas.height / canvas.width) * WIDTH_MM
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: [WIDTH_MM, pageHeightMm],
        })
        pdf.addImage(
          canvas.toDataURL('image/png'),
          'PNG',
          0,
          0,
          WIDTH_MM,
          pageHeightMm,
        )
        pdf.save(filename)
      }
    } finally {
      setBusy('')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-card shadow-2xl overflow-hidden my-auto"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'reprint' ? 'พิมพ์ใบเสร็จซ้ำ' : 'ชำระเงินสำเร็จ'}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-5 border-b">
          <span className="shrink-0 size-10 rounded-lg bg-emerald-100 text-emerald-700 grid place-items-center">
            {mode === 'reprint' ? <Printer size={18} /> : <Check size={20} />}
          </span>
          <div className="flex-1 min-w-0">
            <b className="block text-base font-semibold">
              {mode === 'reprint' ? 'พิมพ์ใบเสร็จซ้ำ' : 'ชำระเงินสำเร็จ'}
            </b>
            <small className="block text-xs text-muted-foreground">
              {mode === 'reprint'
                ? 'เรียกดูบิลย้อนหลังจากระบบ'
                : 'ตรวจสอบรายละเอียดก่อนพิมพ์หรือเริ่มรายการใหม่'}
            </small>
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

        <div className="p-5 bg-muted/30 max-h-[60vh] overflow-y-auto">
          <div
            id="receipt-paper"
            className="bg-white text-[#101418] mx-auto p-4 shadow-sm"
            style={{ width: '280px', fontFamily: 'Sarabun, Leelawadee UI, Tahoma, sans-serif' }}
          >
            <div className="text-center">
              <b className="block text-sm">{storeName}</b>
              <small className="block text-[10px] text-gray-500">Welfare Store</small>
            </div>
            <div className="border-t border-dashed border-gray-300 my-2" />
            <div className="text-[11px] flex items-center justify-between">
              <span>ใบเสร็จเลขที่</span>
              <b className="font-mono">{receipt.orderNumber}</b>
            </div>
            <div className="text-[11px] text-gray-600 mb-1">{createdAtLabel}</div>
            <div className="text-[11px] flex items-center justify-between mb-2">
              <span>ผู้ซื้อ</span>
              <b>
                {receipt.memberName
                  ? `สมาชิก ${receipt.memberName}`
                  : 'บุคคลทั่วไป'}
              </b>
            </div>
            <div className="border-t border-dashed border-gray-300 my-2" />
            {receipt.items.map((item, idx) => (
              <div key={`${item.productId ?? 'sp'}-${idx}`} className="text-[11px] py-0.5">
                <div className="flex items-start justify-between">
                  <span className="flex-1 break-words pr-2">
                    {item.name}
                    {item.variant ? <span className="text-gray-500"> · {item.variant}</span> : null}
                  </span>
                  <b className="font-mono">{money(item.amount)}</b>
                </div>
                <small className="text-gray-500">
                  {item.qty} {item.unit ?? ''}
                  {item.price >= 0.05 ? ` × ${money(item.price)}` : ''}
                </small>
              </div>
            ))}
            <div className="border-t border-dashed border-gray-300 my-2" />
            <div className="text-[11px] flex items-center justify-between py-0.5">
              <span>ยอดรวมสินค้า</span>
              <b className="font-mono">{money(receipt.subtotal)}</b>
            </div>
            {receipt.discount > 0 && (
              <div className="text-[11px] flex items-center justify-between py-0.5">
                <span>ส่วนลด</span>
                <b className="font-mono text-red-600">- {money(receipt.discount)}</b>
              </div>
            )}
            <div className="text-[13px] flex items-center justify-between py-1 mt-1 border-t border-gray-800">
              <b>ยอดชำระทั้งหมด</b>
              <b className="font-mono">{money(receipt.total)}</b>
            </div>
            <div className="text-[11px] flex items-center justify-between py-0.5 mt-1">
              <span>วิธีชำระเงิน</span>
              <b>{receipt.paymentMethod}</b>
            </div>
            <div className="text-[11px] flex items-center justify-between py-0.5">
              <span>ผู้ทำรายการ</span>
              <b>{receipt.cashier?.trim() || 'เจ้าหน้าที่ร้านค้า'}</b>
            </div>
            {receipt.memberNumber && receipt.memberBalanceAfter !== undefined && receipt.memberBalanceAfter !== null && showBalance && (
              <div className="text-[11px] flex items-center justify-between py-0.5 mt-1 border-t border-dashed border-gray-300">
                <span>ยอดเงินคงเหลือสมาชิก</span>
                <b className="font-mono">{money(receipt.memberBalanceAfter)}</b>
              </div>
            )}
            <div className="text-center text-[11px] mt-2 pt-2 border-t border-dashed border-gray-300">
              <div>ขอบคุณที่ใช้บริการ</div>
              <small className="block text-[10px] text-gray-500 mt-0.5">
                ข้อมูลรายการถูกบันทึกในระบบแล้ว
              </small>
              <small className="block text-[9px] text-gray-400 mt-1">⚡ Powered by PNG TEAM</small>
            </div>
          </div>
        </div>

        <div className="p-5 border-t grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="h-10"
            disabled={Boolean(busy)}
            onClick={() => void download('pdf')}
          >
            <Download size={14} />
            {busy === 'pdf' ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF'}
          </Button>
          <Button
            variant="outline"
            className="h-10"
            disabled={Boolean(busy)}
            onClick={() => void download('image')}
          >
            <FileImage size={14} />
            {busy === 'image' ? 'กำลังสร้างรูป...' : 'ดาวน์โหลดรูป'}
          </Button>
          <Button
            variant="outline"
            className="h-10 col-span-2"
            onClick={() => window.print()}
          >
            <Printer size={14} /> พิมพ์ใบเสร็จ
          </Button>
          {mode === 'new' && onNewSale ? (
            <Button
              className="h-10 col-span-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={onNewSale}
            >
              <Plus size={14} /> เริ่มรายการขายใหม่
            </Button>
          ) : (
            <Button variant="outline" className="h-10 col-span-2" onClick={onClose}>
              <X size={14} /> ปิดหน้าต่าง
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
