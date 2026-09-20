/**
 * ROUND 63 (user) — สร้าง payload QR พร้อมเพย์ (PromptPay) ตามมาตรฐาน EMVCo
 * ที่ธนาคารแห่งประเทศไทยกำหนด ใช้แสดง QR ให้ลูกค้าสแกนจ่ายที่หน้า POS
 *
 * โครงสร้าง payload:
 *   00 = Payload format (01) · 01 = Point of initiation (11 static / 12 dynamic)
 *   29 = ข้อมูลบัญชีร้าน: 00 = AID PromptPay + 01/02/03 = ปลายทาง (โทร/บัตรฯ/e-Wallet)
 *   58 = ประเทศ (TH) · 53 = สกุลเงิน (764 = THB) · 54 = จำนวนเงิน (เมื่อมี)
 *   63 = CRC-16/CCITT-FALSE ของทั้งข้อความ (รวม "6304")
 *
 * การแปลงเบอร์โทร: ตัด 0 นำหน้า ใส่ 66 แทน แล้วเติม 0 ซ้ายให้ครบ 13 หลัก
 * เช่น 0812345678 → 0066812345678 (ตรงตามที่ธนาคารอ่านเบอร์ไทยใน QR)
 */

/** ID ตัวช่วย EMVCo: id + ความยาว 2 หลัก + ค่า */
function fmd(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

function sanitizeTarget(id: string): string {
  return id.replace(/[^0-9]/g, "");
}

/** แปลงเลขปลายทางเป็นรูปแบบที่ธนาคารอ่าน (เบอร์โทร → 66 + เติม 0 ซ้าย 13 หลัก) */
function formatTarget(id: string): string {
  const numbers = sanitizeTarget(id);
  if (numbers.length >= 13) return numbers;
  return ("0000000000000" + numbers.replace(/^0/, "66")).slice(-13);
}

/** ประเภทปลายทาง: 01 = เบอร์โทร · 02 = เลขบัตรประชาชน/นิติบุคคล · 03 = e-Wallet */
function targetType(id: string): "01" | "02" | "03" {
  const numbers = sanitizeTarget(id);
  if (numbers.length >= 15) return "03";
  if (numbers.length >= 13) return "02";
  return "01";
}

/** CRC-16/CCITT-FALSE (poly 0x1021 · init 0xFFFF · ไม่มี reflection) ตามมาตรฐาน EMVCo */
function crc16(payload: string): string {
  let crc = 0xffff;
  for (let index = 0; index < payload.length; index++) {
    crc ^= payload.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export type PromptPayInput = {
  /** เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก ของบัญชีพร้อมเพย์ร้าน */
  promptpayId: string;
  /** จำนวนเงินที่จะเรียกเก็บ — มีค่า > 0 = QR แบบระบุยอด (dynamic จ่ายได้ครั้งเดียว) */
  amount?: number;
};

/** สร้าง payload สตริง QR พร้อมเพย์พร้อมส่งต่อให้ qrcode.toDataURL / toCanvas */
export function buildPromptPayPayload({ promptpayId, amount }: PromptPayInput): string {
  const numbers = sanitizeTarget(promptpayId);
  if (numbers.length < 9 || numbers.length > 16) {
    throw new Error("รูปแบบบัญชีพร้อมเพย์ไม่ถูกต้อง — ใช้เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก");
  }
  const hasAmount = typeof amount === "number" && amount > 0;
  const merchant = fmd("29", fmd("00", "A000000677010111") + fmd(targetType(numbers), formatTarget(numbers)));
  const parts = [
    fmd("00", "01"),
    fmd("01", hasAmount ? "12" : "11"),
    merchant,
    fmd("58", "TH"),
    fmd("53", "764"),
    ...(hasAmount ? [fmd("54", amount!.toFixed(2))] : []),
  ];
  const body = parts.join("");
  return `${body}6304${crc16(body + "6304")}`;
}

/** ตรวจว่าใช้ตั้งค่าบัญชีพร้อมเพย์ได้ไหม (เบอร์โทร 9-10 หลัก / บัตร 13 หลัก / e-Wallet 15-16 หลัก) */
export function isValidPromptPayId(id: string): boolean {
  const numbers = sanitizeTarget(id);
  return (numbers.length >= 9 && numbers.length <= 10) || numbers.length === 13 || (numbers.length >= 15 && numbers.length <= 16);
}
