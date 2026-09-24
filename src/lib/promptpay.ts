/**
 * PromptPay (Thai EMVCo QR) payload generator — used by POS checkout screen
 * to render a QR code the customer can scan with their banking app.
 *
 * Mirror of /tmp/Shop/client/src/promptpay.ts.
 *
 * Payload structure:
 *   00 = Payload format (01) · 01 = Point of initiation (11 static / 12 dynamic)
 *   29 = merchant info: 00 = AID PromptPay + 01/02/03 = target (phone/idcard/wallet)
 *   58 = country (TH) · 53 = currency (764 = THB) · 54 = amount (when present)
 *   63 = CRC-16/CCITT-FALSE of entire payload (including "6304")
 */

/** ID + 2-digit length + value. */
function fmd(id: string, value: string): string {
  return id + String(value.length).padStart(2, '0') + value
}

function sanitizeTarget(id: string): string {
  return id.replace(/[^0-9]/g, '')
}

/** Phone → 66 + zero-pad to 13 digits; idCard passes through; wallet stays as-is. */
function formatTarget(id: string): string {
  const numbers = sanitizeTarget(id)
  if (numbers.length >= 13) return numbers
  return ('0000000000000' + numbers.replace(/^0/, '66')).slice(-13)
}

/** 01 = phone · 02 = citizen ID / corporate · 03 = e-Wallet. */
function targetType(id: string): '01' | '02' | '03' {
  const numbers = sanitizeTarget(id)
  if (numbers.length >= 15) return '03'
  if (numbers.length >= 13) return '02'
  return '01'
}

/** CRC-16/CCITT-FALSE (poly 0x1021 · init 0xFFFF · no reflection). */
function crc16(payload: string): string {
  let crc = 0xffff
  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export interface PromptPayInput {
  /** Phone (10 digits) or citizen ID (13 digits) of the store's PromptPay account. */
  promptpayId: string
  /** When > 0 the QR is dynamic (amount-bearing). */
  amount?: number
}

/** Build the EMVCo payload string ready for `qrcode.toDataURL`. */
export function buildPromptPayPayload({ promptpayId, amount }: PromptPayInput): string {
  const numbers = sanitizeTarget(promptpayId)
  if (numbers.length < 9 || numbers.length > 16) {
    throw new Error(
      'รูปแบบบัญชีพร้อมเพย์ไม่ถูกต้อง — ใช้เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก',
    )
  }
  const hasAmount = typeof amount === 'number' && amount > 0
  const merchant = fmd(
    '29',
    fmd('00', 'A000000677010111') + fmd(targetType(numbers), formatTarget(numbers)),
  )
  const parts = [
    fmd('00', '01'),
    fmd('01', hasAmount ? '12' : '11'),
    merchant,
    fmd('58', 'TH'),
    fmd('53', '764'),
    ...(hasAmount ? [fmd('54', amount!.toFixed(2))] : []),
  ]
  const body = parts.join('')
  return `${body}6304${crc16(body + '6304')}`
}

/** True when the given ID can be used as a PromptPay target. */
export function isValidPromptPayId(id: string): boolean {
  const numbers = sanitizeTarget(id)
  return (
    (numbers.length >= 9 && numbers.length <= 10) ||
    numbers.length === 13 ||
    (numbers.length >= 15 && numbers.length <= 16)
  )
}
