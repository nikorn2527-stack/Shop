import { buildThermalPageCss, getThermalPrintProfile } from "./thermalPrint";

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

const HELPER_BASE = "http://127.0.0.1:3031";

/**
 * สั่งพิมพ์ผ่าน Helper — ส่ง HTML content ไปยัง POST http://127.0.0.1:3031/print
 * ถ้า Helper ไม่ตอบ → fallback window.print() แล้วแจ้งว่าใช้ fallback
 */
export async function printViaHelper(
  printerName: string,
  htmlContent: string,
  options: PrintOptions = {},
): Promise<PrintResult> {
  if (printerName) {
    try {
      const res = await fetch(`${HELPER_BASE}/print`, {
        method: "POST",
        signal: AbortSignal.timeout(8_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printerName, content: htmlContent, ...options }),
      });
      if (!res.ok) throw new Error(`Helper HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok !== true) throw new Error(data.message || "เครื่องพิมพ์ไม่รับงาน");
      return { ok: true, message: data.message ?? "ส่งงานพิมพ์แล้ว", usedFallback: false };
    } catch {
      // Only the helper failed. Try the browser once; propagate browser failures to the dialog.
    }
  }
  await printHtmlDocument(htmlContent);
  return {
    ok: true,
    message: "ปิดหน้าต่างพิมพ์แล้ว · ตรวจเอกสารที่เครื่องพิมพ์ หรือพิมพ์ซ้ำจากประวัติได้",
    usedFallback: true,
  };
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
        // Closing/cancelling the browser dialog completes this step, not the sale.
        // Do not destroy the receipt while the browser is still using its fonts/images.
        const finish = () => { frame.remove(); resolve(); };
        win.addEventListener("afterprint", finish, { once: true });
        win.focus();
        win.print();
      } catch (error) { frame.remove(); reject(error); }
    };
    frame.srcdoc = buildBrowserPrintHtml(html);
    document.body.appendChild(frame);
  });
}

/** Browser page length belongs to the selected driver paper, not a screen estimate. */
export function buildBrowserPrintHtml(html: string): string {
  if (!/<html\b[^>]*\bdata-thermal-paper-width=/i.test(html)) return html;
  return html.replace('</head>', '<style id="browser-driver-page">@page{size:auto;margin:0}</style></head>');
}

/** Measure using the same print rules, fonts and millimetre width sent to the printer. */
async function measureThermalDocument(html: string, targetId: string, widthMm: number): Promise<number> {
  const frame = document.createElement('iframe');
  frame.title = 'เตรียมขนาดเอกสารพิมพ์';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthMm}mm;height:1000px;border:0;visibility:hidden;pointer-events:none`;
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('เตรียมเอกสารพิมพ์ไม่สำเร็จ'));
      frame.srcdoc = html;
      document.body.appendChild(frame);
    });
    const doc = frame.contentDocument;
    if (!doc) throw new Error('อ่านขนาดเอกสารพิมพ์ไม่สำเร็จ');
    // Activate print-only CSS and suppress screen-only CSS in this isolated measuring frame.
    // Only CSSOM is changed; the HTML ultimately sent to the helper retains its original media rules.
    const usePrintMedia = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule.type === CSSRule.MEDIA_RULE) {
          const media = rule as CSSMediaRule;
          media.media.mediaText = media.media.mediaText.split(',').map(query => /\bscreen\b/i.test(query) ? 'not all' : query.replace(/\bprint\b/gi, 'all')).join(',');
        }
        if ('cssRules' in rule) usePrintMedia((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(doc.styleSheets)) {
      try { usePrintMedia(sheet.cssRules); } catch { /* Cross-origin CSS is not used by local document layouts. */ }
    }
    doc.getElementById(targetId)?.getBoundingClientRect(); // Flush the print layout before waiting for its fonts.
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images, image => image.decode().catch(() => undefined)));
    const target = doc.getElementById(targetId);
    if (!target) throw new Error('ไม่พบเอกสารสำหรับวัดขนาดพิมพ์');
    const pixels = Math.max(target.scrollHeight, target.getBoundingClientRect().height);
    if (pixels <= 0) throw new Error('เอกสารพิมพ์ไม่มีเนื้อหาที่แสดงได้');
    return pixels * 25.4 / 96;
  } finally { frame.remove(); }
}

export async function printElementDocument(targetId: string, widthMm?: number): Promise<PrintResult> {
  const source = document.getElementById(targetId);
  if (!source) throw new Error("ไม่พบเอกสารสำหรับพิมพ์");
  const thermalProfile = widthMm ? getThermalPrintProfile(widthMm) : null;
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.cssText = thermalProfile ? `width:${thermalProfile.printableWidthMm}mm;box-sizing:border-box;margin:0;height:auto;max-height:none;overflow:visible` : "";
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'), el => el.outerHTML).join("");
  let heightMm = 297;
  let runtimeCss = thermalProfile
    ? buildThermalPageCss(thermalProfile, 1000, targetId)
    : `@page{size:A4;margin:8mm}html,body{margin:0;padding:0;background:white}#${targetId}{position:static!important;transform:none!important;box-shadow:none!important;height:auto!important;max-height:none!important;overflow:visible!important}`;
  const marker = thermalProfile ? ` data-thermal-paper-width="${thermalProfile.paperWidthMm}" data-paper-width="${thermalProfile.paperWidthMm}"` : '';
  let html = `<!doctype html><html lang="th"${marker}><head><meta charset="utf-8"><base href="${location.origin}/">${styles}<style>${runtimeCss}body>*{display:block!important;visibility:visible!important}</style></head><body>${clone.outerHTML}</body></html>`;
  if (thermalProfile) {
    const measured = await measureThermalDocument(html, targetId, thermalProfile.paperWidthMm);
    heightMm = Math.max(30, Math.ceil(measured + thermalProfile.bottomFeedMm));
    html = html.replace(runtimeCss, buildThermalPageCss(thermalProfile, heightMm, targetId));
  }
  return printViaHelper(getPrinterName(widthMm ? "receipt" : "report"), html, {
    paperWidthMm: thermalProfile?.paperWidthMm,
    paperHeightMm: thermalProfile ? heightMm : undefined,
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
