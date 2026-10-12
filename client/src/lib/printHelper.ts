/**
 * printHelper — Task A3: สั่งพิมพ์ผ่าน Local Printer Helper
 *
 * ฟังก์ชันกลางที่ใช้ร่วมกันสำหรับทุกจุดพิมพ์ (ใบเสร็จ, รายงาน, บัตรสมาชิก)
 * ถ้า Helper ไม่ทำงาน → fallback ไป window.print() พร้อมแจ้งเตือน
 *
 * Task A3 v2 — บันทึกการตั้งค่าตามเครื่อง (localStorage) ไม่ใช่ server settings
 * เพราะแต่ละเครื่องมี printer ไม่เหมือนกัน
 */

export type PrintDocType = "receipt" | "report" | "card";

export type LocalPrinterSettings = {
  receipt: string;
  report: string;
  card: string;
};

const STORAGE_KEY = "local-printer-settings";

/** อ่านการตั้งค่า printer จาก localStorage (ของเครื่องนี้) */
export function getLocalPrinterSettings(): LocalPrinterSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { receipt: "", report: "", card: "" };
}

/** บันทึกการตั้งค่า printer ลง localStorage (ของเครื่องนี้) */
export function saveLocalPrinterSettings(settings: LocalPrinterSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

/** อัปเดตเพียง 1 ประเภท */
export function updateLocalPrinterSetting(docType: PrintDocType, printerName: string): void {
  const current = getLocalPrinterSettings();
  current[docType] = printerName;
  saveLocalPrinterSettings(current);
}

/** ดึงชื่อเครื่องปัจจุบัน (สุ่ม ID ครั้งเดียว เก็บใน localStorage) */
export function getWorkstationId(): string {
  const KEY = "workstation-id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = `WS-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "WS-UNKNOWN";
  }
}

type PrintResult = {
  ok: boolean;
  message: string;
  usedFallback: boolean;
};

const HELPER_BASE = "http://localhost:3031";

/**
 * สั่งพิมพ์ผ่าน Helper — ส่ง HTML content ไปยัง POST http://localhost:3031/print
 * ถ้า Helper ไม่ตอบ → fallback window.print() แล้วแจ้งว่าใช้ fallback
 */
export async function printViaHelper(
  printerName: string,
  htmlContent: string,
): Promise<PrintResult> {
  if (!printerName) {
    window.print();
    return {
      ok: true,
      message: "ใช้ Browser Print Dialog — เลือกเครื่องพิมพ์เองในหน้าต่างพิมพ์",
      usedFallback: true,
    };
  }

  try {
    const res = await fetch(`${HELPER_BASE}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printerName, content: htmlContent }),
    });
    if (!res.ok) throw new Error(`Helper HTTP ${res.status}`);
    const data = await res.json();
    return {
      ok: data.ok ?? false,
      message: data.message ?? "ส่งงานพิมพ์แล้ว",
      usedFallback: false,
    };
  } catch {
    window.print();
    return {
      ok: true,
      message: "⚠️ สั่งพิมพ์ผ่าน Browser (Helper ไม่ทำงาน) — ตรวจสอบว่า printer-helper รันอยู่",
      usedFallback: true,
    };
  }
}

/**
 * เลือกชื่อ printer ตามประเภทเอกสาร (จาก localStorage ของเครื่องนี้)
 */
/** เลือกชื่อ printer ตามประเภทเอกสาร (จาก localStorage ของเครื่องนี้) */
export function getPrinterName(docType: PrintDocType): string {
  return getLocalPrinterSettings()[docType];
}

/** ตรวจสอบว่ามีการระบุเครื่องพิมพ์สำหรับประเภทเอกสารนี้ไหม (จากการตั้งค่าบนเครื่องนี้) */
export function isPrinterDesignated(docType: PrintDocType): boolean {
  return getPrinterName(docType).trim() !== "";
}

/** คำอธิบายประเภทเอกสารสำหรับแสดงในเมนูตั้งค่าและข้อความเตือน */
export const PRINTER_DOC_LABELS: Record<PrintDocType, string> = {
  receipt: "ใบเสร็จ",
  report: "รายงาน",
  card: "บัตรสมาชิก",
};

/**
 * ตรวจสอบว่า Helper ทำงานอยู่ไหม
 */
export async function checkHelperHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${HELPER_BASE}/`);
    if (!res.ok) return false;
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}
