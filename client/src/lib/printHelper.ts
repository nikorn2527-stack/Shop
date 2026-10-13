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

export type PrintResult = {
  ok: boolean;
  message: string;
  usedFallback: boolean;
};

type PrintOptions = {
  paperWidthMm?: number;
  paperHeightMm?: number;
};

const HELPER_BASE = "http://localhost:3031";

/**
 * สั่งพิมพ์ผ่าน Helper — ส่ง HTML content ไปยัง POST http://localhost:3031/print
 * ถ้า Helper ไม่ตอบ → fallback window.print() แล้วแจ้งว่าใช้ fallback
 */
export async function printViaHelper(
  printerName: string,
  htmlContent: string,
  options: PrintOptions = {},
): Promise<PrintResult> {
  if (!printerName) {
    await printHtmlDocument(htmlContent);
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
      body: JSON.stringify({ printerName, content: htmlContent, ...options }),
    });
    if (!res.ok) throw new Error(`Helper HTTP ${res.status}`);
    const data = await res.json();
    if (data.ok !== true) {
      await printHtmlDocument(htmlContent);
      return {
        ok: true,
        message: `เปิดหน้าต่างพิมพ์สำรองแล้ว — ${data.message || "เครื่องพิมพ์ไม่รับงานจาก Local Printer Helper"}`,
        usedFallback: true,
      };
    }
    return {
      ok: true,
      message: data.message ?? "ส่งงานพิมพ์แล้ว",
      usedFallback: false,
    };
  } catch {
    await printHtmlDocument(htmlContent);
    return {
      ok: true,
      message: "⚠️ สั่งพิมพ์ผ่าน Browser (Helper ไม่ทำงาน) — ตรวจสอบว่า printer-helper รันอยู่",
      usedFallback: true,
    };
  }
}

/** Print only the supplied document, not the application behind its popup. */
export async function printHtmlDocument(html: string): Promise<void> {
  const frame = document.createElement("iframe");
  frame.title = "เอกสารสำหรับพิมพ์";
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0";
  await new Promise<void>((resolve, reject) => {
    frame.onload = async () => {
      try {
        const win = frame.contentWindow;
        if (!win) throw new Error("เปิดหน้าต่างพิมพ์ไม่สำเร็จ");
        await win.document.fonts.ready;
        await Promise.all(Array.from(win.document.images, image => image.complete ? Promise.resolve() : new Promise<void>(done => { image.onload = () => done(); image.onerror = () => done(); })));
        win.addEventListener("afterprint", () => frame.remove(), { once: true });
        win.focus();
        win.print();
        resolve();
      } catch (error) { frame.remove(); reject(error); }
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export function printElementDocument(targetId: string, widthMm?: number): Promise<PrintResult> {
  const source = document.getElementById(targetId);
  if (!source) return Promise.reject(new Error("ไม่พบเอกสารสำหรับพิมพ์"));
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.cssText = widthMm ? `width:${widthMm}mm;box-sizing:border-box;margin:0;padding:3mm;height:auto;max-height:none;overflow:visible` : "";
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'), el => el.outerHTML).join("");
  const heightMm = Math.max(60, Math.ceil(source.scrollHeight * (widthMm ?? 210) / Math.max(1, source.offsetWidth)) + 10);
  const pageSize = widthMm ? `${widthMm}mm ${heightMm}mm` : "A4";
  const html = `<!doctype html><html><head><meta charset="utf-8"><base href="${location.origin}/">${styles}<style>@page{size:${pageSize};margin:${widthMm ? 0 : 8}mm}html,body{margin:0;padding:0;background:white}body>*{display:block!important;visibility:visible!important}#${targetId}{position:static!important;transform:none!important;box-shadow:none!important;height:auto!important;max-height:none!important;overflow:visible!important}</style></head><body>${clone.outerHTML}</body></html>`;
  return printViaHelper(getPrinterName(widthMm ? "receipt" : "report"), html, {
    paperWidthMm: widthMm,
    paperHeightMm: widthMm ? heightMm : undefined,
  });
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
