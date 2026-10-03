import type { Express } from "express";
import puppeteer from "puppeteer";
import { readFile } from "fs/promises";
import { join } from "path";
import { buildReportDocumentHtml, thaiStamp, type ReportDocConfig } from "@shared/reportDoc";

/**
 * P0-UX-03 — Server-side vector PDF generation for reports.
 *
 * ใช้ Puppeteer (Chromium headless) printToPDF → ได้ vector PDF จริง
 * (ตัวอักษรคมเมื่อ zoom 200-400% + select/copy text ได้ + ไฟล์เล็กกว่า raster)
 *
 * HTML template ใช้ buildReportDocumentHtml จาก @shared/reportDoc ชุดเดียวกับ
 * client printReportDoc → PDF (vector) = Print (vector) = template เดียวกัน
 *
 * Font: ฝัง Sarabun เป็น base64 data URL เพราะ Puppeteer setContent(html)
 * รันบน about:blank ไม่สามารถโหลด /fonts/* ได้ — ฝังตรงๆ จึง render ไทยคม
 */

let browserPromise: Promise<import("puppeteer").Browser> | null = null;
const fontBase64Cache = new Map<string, string>();

const FONT_WEIGHTS = [300, 400, 500, 600, 700, 800];
const THAI_RANGE = "U+02D7, U+0303, U+0331, U+0E01-0E5B, U+200C-200D, U+25CC";
const LATIN_RANGE = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";

async function getBrowser(): Promise<import("puppeteer").Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
    });
    // ปิด browser ลายเดียวเมื่อ process จบ (dev: never, prod: on exit)
    browserPromise.catch(() => { browserPromise = null; });
  }
  return browserPromise;
}

async function getFontBase64(weight: number, subset: "thai" | "latin"): Promise<string> {
  const key = `${weight}-${subset}`;
  const cached = fontBase64Cache.get(key);
  if (cached) return cached;
  const filePath = join(process.cwd(), "client", "public", "fonts", `Sarabun-${weight}-${subset}.woff2`);
  const buf = await readFile(filePath);
  const b64 = buf.toString("base64");
  fontBase64Cache.set(key, b64);
  return b64;
}

async function buildEmbeddedFontFace(): Promise<string> {
  const faces: string[] = [];
  for (const weight of FONT_WEIGHTS) {
    const thaiB64 = await getFontBase64(weight, "thai");
    const latinB64 = await getFontBase64(weight, "latin");
    faces.push(`@font-face { font-family: "Sarabun"; font-weight: ${weight}; font-style: normal; font-display: block; src: url(data:application/font-woff2;base64,${thaiB64}) format("woff2"); unicode-range: ${THAI_RANGE}; }`);
    faces.push(`@font-face { font-family: "Sarabun"; font-weight: ${weight}; font-style: normal; font-display: block; src: url(data:application/font-woff2;base64,${latinB64}) format("woff2"); unicode-range: ${LATIN_RANGE}; }`);
  }
  return faces.join("\n  ");
}

export function registerReportPdfRoutes(app: Express) {
  app.post("/api/report/pdf", async (req, res) => {
    const startedAt = Date.now();
    try {
      const config = req.body as ReportDocConfig;
      if (!config || typeof config.title !== "string" || !Array.isArray(config.columns) || !Array.isArray(config.rows)) {
        res.status(400).json({ error: "invalid report config — title/columns/rows required" });
        return;
      }
      const fontFace = await buildEmbeddedFontFace();
      const stampText = `สร้างเมื่อ ${thaiStamp(new Date())}`;
      const html = buildReportDocumentHtml(config, { mode: "pdf", stampText, fontFace });
      const browser = await getBrowser();
      const page = await browser.newPage();
      try {
        // setContent บน about:blank — font ฝัง base64 แล้ว จึงไม่ต้องโหลดจาก network
        await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
        // รอ font (Sarabun thai+latin subset) พร้อมก่อน printToPDF — ตัวไทยคม
        await page.evaluate(async () => { if ((document as any).fonts?.ready) { await (document as any).fonts.ready; } });
        // ตรวจทุก @font-face ที่หาเจอแล้ว รอจนโหลดจริง (font-display: block บังคับรอ)
        await page.evaluate(async () => {
          const fonts = (document as any).fonts;
          if (!fonts) return;
          const ready: Promise<unknown>[] = [];
          for (const w of ["300", "400", "500", "600", "700", "800"]) {
            ready.push(fonts.load(`${w} 13px Sarabun`, "ก0A"));
            ready.push(fonts.load(`${w} 13px Sarabun`, "ABCabc123"));
          }
          await Promise.all(ready);
        });
        const pdfBytes = await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" },
          preferCSSPageSize: true,
          timeout: 30_000,
        });
        // Puppeteer คืน Uint8Array — Express ส่งเป็น JSON object ถ้าไม่แปลงเป็น Buffer
        const pdfBuffer = Buffer.from(pdfBytes);
        const fileName = (config.fileName || "report").endsWith(".pdf") ? config.fileName : `${config.fileName}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader("X-PDF-Mode", "vector");
        res.send(pdfBuffer);
        console.log(`[reportPdf] ✓ ${fileName} ${(pdfBuffer.length / 1024).toFixed(0)}KB in ${Date.now() - startedAt}ms`);
      } finally {
        await page.close();
      }
    } catch (error) {
      console.error("[reportPdf] ✗ error:", error instanceof Error ? error.message : error);
      res.status(500).json({ error: "report pdf generation failed", detail: error instanceof Error ? error.message : String(error) });
    }
  });
}
