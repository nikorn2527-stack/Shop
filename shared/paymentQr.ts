/** Bank-issued reusable QR data. Account numbers are never treated as PromptPay phone numbers. */
export const QR_BANKS = [
  { code: "KTB", name: "ธนาคารกรุงไทย" },
  { code: "KBANK", name: "ธนาคารกสิกรไทย" },
  { code: "SCB", name: "ธนาคารไทยพาณิชย์" },
  { code: "GSB", name: "ธนาคารออมสิน" },
] as const;

function readTags(data: string): Map<string, string> {
  const tags = new Map<string, string>();
  let cursor = 0;
  while (cursor < data.length) {
    const header = data.slice(cursor, cursor + 4);
    if (!/^\d{4}$/.test(header)) throw new Error("รูปแบบ QR รับเงินไม่ถูกต้อง");
    const length = Number(header.slice(2));
    const end = cursor + 4 + length;
    const id = header.slice(0, 2);
    if (!length || end > data.length || tags.has(id)) throw new Error("ข้อมูล QR รับเงินไม่ครบหรือซ้ำ");
    tags.set(id, data.slice(cursor + 4, end));
    cursor = end;
  }
  return tags;
}

export function paymentQrChecksum(data: string): string {
  let crc = 0xffff;
  for (const byte of Array.from(new TextEncoder().encode(data))) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Accept a reusable Thai payment QR, never a slip-verification QR, URL or fixed-amount invoice. */
export function validateBankPaymentQr(payload: string): string {
  if (payload.length > 2048 || !/^000201/.test(payload) || !/6304[0-9A-Fa-f]{4}$/.test(payload)) {
    throw new Error("ใช้ QR รับเงินจากแอปธนาคาร ไม่ใช่ QR บนสลิปหรือ QR เว็บไซต์");
  }
  if (paymentQrChecksum(payload.slice(0, -4)) !== payload.slice(-4).toUpperCase()) throw new Error("ข้อมูล QR ไม่สมบูรณ์ กรุณาเลือกรูปต้นฉบับจากธนาคาร");
  const tags = readTags(payload);
  if (tags.get("01") !== "11" || tags.has("54")) throw new Error("ใช้ QR รับเงินแบบไม่ระบุยอด เพื่อใช้กับบิลได้หลายยอด");
  if (tags.get("53") !== "764" || tags.get("58") !== "TH") throw new Error("ใช้ QR รับเงินสกุลบาทของธนาคารไทย");
  const anyId = tags.has("29") ? readTags(tags.get("29")!) : null;
  const bill = tags.has("30") ? readTags(tags.get("30")!) : null;
  const hasRecipient = anyId?.get("00") === "A000000677010111" && ["01", "02", "03", "04"].some(id => anyId.has(id));
  const hasBiller = bill?.get("00") === "A000000677010112" && bill.has("01") && bill.has("02");
  if (!hasRecipient && !hasBiller) throw new Error("QR นี้ไม่ใช่ QR รับเงินที่รองรับ กรุณาใช้ QR รับเงินจากธนาคาร");
  return payload;
}
