/**
 * printHelper — Task A3: สั่งพิมพ์ผ่าน Local Printer Helper
 *
 * ฟังก์ชันกลางที่ใช้ร่วมกันสำหรับทุกจุดพิมพ์ (ใบเสร็จ, รายงาน, บัตรสมาชิก)
 * ถ้า Helper ไม่ทำงาน → fallback ไป window.print() พร้อมแจ้งเตือน
 */

export type PrintDocType = "receipt" | "report" | "card";

export type PrintSettings = {
  receiptPrinterName: string;
  reportPrinterName: string;
  cardPrinterName: string;
};

type PrintResult = {
  ok: boolean;
  message: string;
  usedFallback: boolean;
};

/**
 * สั่งพิมพ์ผ่าน Helper — ส่ง HTML content ไปยัง POST /print?XTransformPort=3031
 * ถ้า Helper ไม่ตอบ → fallback window.print() แล้วแจ้งว่าใช้ fallback
 */
export async function printViaHelper(
  printerName: string,
  htmlContent: string,
): Promise<PrintResult> {
  if (!printerName) {
    // ไม่ได้เลือก printer → ใช้ browser print dialog
    window.print();
    return {
      ok: true,
      message: "ใช้ Browser Print Dialog — เลือกเครื่องพิมพ์เองในหน้าต่างพิมพ์",
      usedFallback: true,
    };
  }

  try {
    const res = await fetch("/print?XTransformPort=3031", {
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
  } catch (err) {
    // Helper ไม่ทำงาน → fallback window.print()
    window.print();
    return {
      ok: true,
      message: "⚠️ สั่งพิมพ์ผ่าน Browser (Helper ไม่ทำงาน) — ตรวจสอบว่า printer-helper รันอยู่",
      usedFallback: true,
    };
  }
}

/**
 * เลือกชื่อ printer ตามประเภทเอกสาร
 */
export function getPrinterName(settings: PrintSettings, docType: PrintDocType): string {
  switch (docType) {
    case "receipt": return settings.receiptPrinterName;
    case "report": return settings.reportPrinterName;
    case "card": return settings.cardPrinterName;
  }
}

/**
 * ตรวจสอบว่า Helper ทำงานอยู่ไหม
 */
export async function checkHelperHealth(): Promise<boolean> {
  try {
    const res = await fetch("/?XTransformPort=3031");
    if (!res.ok) return false;
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}
