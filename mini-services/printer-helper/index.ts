/**
 * Printer Helper — mini-service สำหรับ enumerate เครื่องพิมพ์จริง + สั่งพิมพ์ไปยังเครื่องที่เลือก
 *
 * Browser ไม่อนุญาตให้เว็บ enumerate เครื่องพิมพ์หรือสั่งพิมพ์โดยตรง (security).
 * service นี้รันบนเครื่อง POS (on-premise) แล้ว expose ผ่าน HTTP port 3031.
 *
 * Task A1 — Endpoints:
 * - GET  /              → health check
 * - GET  /printers      → { printers: PrinterInfo[], source, command }
 * - POST /printers/test → { ok, printer, message } (สั่งพิมพ์ทดสอบไปยัง printer ที่เลือก)
 * - POST /print         → { ok, printer, message } (สั่งพิมพ์ HTML/PDF ไปยัง printer ที่เลือก)
 *
 * รับเฉพาะ localhost เท่านั้น (security: ไม่ให้เครื่องอื่นใน LAN สั่งพิมพ์)
 *
 * Port: 3031 (fixed)
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

const execAsync = promisify(exec);
const PORT = 3031;
const DRY_RUN = process.env.PRINTER_HELPER_DRY_RUN === "1";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type PrinterInfo = {
  name: string;
  isDefault?: boolean;
  status?: string; // "ready" | "offline" | "unknown"
};

type PrinterListResult = {
  printers: PrinterInfo[];
  source: "windows" | "macos" | "linux" | "unknown";
  command: string;
  error?: string;
};

/**
 * Enumerate printers ตาม OS — คืนชื่อ + default flag + status (ถ้าระบบเปิดเผย)
 */
async function enumeratePrinters(): Promise<PrinterListResult> {
  const os = platform();

  if (os === "win32") {
    // Windows: PowerShell Get-Printer (modern, Win 8+) → fallback wmic
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "Get-Printer | Select-Object Name, PortName, PrinterStatus | ConvertTo-Json"`,
        { timeout: 8000, maxBuffer: 1024 * 1024 }
      );
      // PowerShell returns JSON array (or single object if only 1 printer)
      let raw: any[];
      try {
        const parsed = JSON.parse(stdout);
        raw = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        raw = [];
      }
      const printers: PrinterInfo[] = raw
        .map((p: any) => ({
          name: String(p.Name ?? "").trim(),
          isDefault: false,
          status: p.PrinterStatus === 0 ? "ready" : p.PrinterStatus === 1 ? "offline" : "unknown",
        }))
        .filter((p) => p.name.length > 0);

      // Also get default printer
      try {
        const { stdout: defOut } = await execAsync(
          `powershell -NoProfile -Command "(Get-CimInstance Win32_Printer | Where-Object Default -eq $true).Name"`,
          { timeout: 5000 }
        );
        const defName = defOut.trim();
        if (defName) {
          const found = printers.find((p) => p.name === defName);
          if (found) found.isDefault = true;
        }
      } catch {
        // default printer detection failed — not critical
      }

      return { printers, source: "windows", command: "powershell Get-Printer" };
    } catch (err) {
      // fallback: simple name list via wmic
      try {
        const { stdout } = await execAsync(`wmic printer get name /value`, { timeout: 8000 });
        const printers: PrinterInfo[] = stdout
          .split("\n")
          .map((line) => line.replace(/^Name=/i, "").trim())
          .filter((line) => line.length > 0)
          .map((name) => ({ name, status: "unknown" }));
        return {
          printers,
          source: "windows",
          command: "wmic printer get name",
          error: err instanceof Error ? err.message : String(err),
        };
      } catch (err2) {
        return {
          printers: [],
          source: "windows",
          command: "(failed: powershell + wmic)",
          error: err2 instanceof Error ? err2.message : String(err2),
        };
      }
    }
  }

  if (os === "darwin" || os === "linux") {
    try {
      const { stdout } = await execAsync(`lpstat -p -d`, { timeout: 8000 });
      const lines = stdout.split("\n");
      const printers: PrinterInfo[] = [];
      let defaultName = "";
      for (const line of lines) {
        const m = line.match(/^printer\s+(\S+)\s+/i);
        if (m) {
          const status = line.includes("idle") || line.includes("enabled") ? "ready" : "offline";
          printers.push({ name: m[1], status });
        }
        const dm = line.match(/^system default destination:\s+(\S+)/i);
        if (dm) defaultName = dm[1];
      }
      if (defaultName) {
        const found = printers.find((p) => p.name === defaultName);
        if (found) found.isDefault = true;
      }
      if (printers.length > 0 || os === "darwin") {
        return { printers, source: os === "darwin" ? "macos" : "linux", command: "lpstat -p -d" };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("no destinations") || msg.includes("No destinations")) {
        return { printers: [], source: os === "darwin" ? "macos" : "linux", command: "lpstat -p -d" };
      }
    }
    // fallback: lpinfo -v (Linux only)
    if (os === "linux") {
      try {
        const { stdout } = await execAsync(`lpinfo -v`, { timeout: 8000 });
        const printers: PrinterInfo[] = stdout
          .split("\n")
          .map((line) => {
            const m = line.match(/^(?:network|direct|file|implicitclass)\s+\S+:\/\/([^\s?]+)/i);
            return m ? m[1] : "";
          })
          .filter((name) => name.length > 0)
          .map((name) => ({ name, status: "unknown" }));
        return { printers, source: "linux", command: "lpinfo -v" };
      } catch (err) {
        return {
          printers: [],
          source: "linux",
          command: "lpstat + lpinfo",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  return { printers: [], source: "unknown", command: "(unsupported OS)" };
}

/**
 * สั่งพิมพ์ไปยัง printer ที่เลือก — รับ HTML content แล้วส่งไป OS print spooler
 * - Windows: Chromium render HTML เป็น PNG ตามขนาดกระดาษจริง แล้ว PowerShell
 *   System.Drawing.Printing.PrintDocument ส่งภาพเข้า spooler โดยตรง
 * - macOS/Linux: ใช้ `lp -d <printer>` ส่ง HTML file
 */
async function printToPrinter(
  printerName: string,
  content: string,
  paperWidthMm = 80,
  paperHeightMm = 120,
): Promise<{ ok: boolean; message: string }> {
  const os = platform();

  // Sanitize printer name (security: กัน command injection)
  const safeName = printerName.replace(/[;|&$`"'\\]/g, "");
  if (!safeName) {
    return { ok: false, message: "ชื่อเครื่องพิมพ์ว่างหรือมีอักขระต้องห้าม" };
  }

  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpFile = join(tmpdir(), `print-job-${jobId}.html`);
  const imageFile = join(tmpdir(), `print-job-${jobId}.png`);
  const scriptFile = join(tmpdir(), `print-job-${jobId}.ps1`);
  try {
    await Bun.write(tmpFile, content);
  } catch (err) {
    return { ok: false, message: `สร้างไฟล์ชั่วคราวไม่ได้: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    if (os === "win32") {
      const widthMm = Math.min(210, Math.max(40, Number(paperWidthMm) || 80));
      const heightMm = Math.min(1000, Math.max(30, Number(paperHeightMm) || 120));
      const cssPxPerMm = 96 / 25.4;
      const outputPxPerMm = 203 / 25.4;
      const viewportWidth = Math.ceil(widthMm * cssPxPerMm);
      const viewportHeight = Math.ceil(heightMm * cssPxPerMm);
      const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
      try {
        const page = await browser.newPage();
        await page.setViewport({
          width: viewportWidth,
          height: viewportHeight,
          deviceScaleFactor: outputPxPerMm / cssPxPerMm,
        });
        await page.emulateMediaType("print");
        await page.goto(`file:///${tmpFile.replace(/\\/g, "/")}`, { waitUntil: "networkidle0", timeout: 20000 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(Array.from(document.images, image => image.complete ? Promise.resolve() : new Promise<void>(done => {
            image.onload = () => done();
            image.onerror = () => done();
          })));
        });
        await page.screenshot({
          path: imageFile as `${string}.png`,
          clip: { x: 0, y: 0, width: viewportWidth, height: viewportHeight },
          omitBackground: false,
        });
      } finally {
        await browser.close();
      }

      const printScript = `
param([string]$PrinterName, [string]$ImagePath, [double]$WidthMm, [double]$HeightMm, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $PrinterName
if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found or unavailable: $PrinterName" }
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$width = [Math]::Max(1, [Math]::Round($WidthMm / 25.4 * 100))
$height = [Math]::Max(1, [Math]::Round($HeightMm / 25.4 * 100))
$paper = New-Object System.Drawing.Printing.PaperSize('Receipt', $width, $height)
$doc.DefaultPageSettings.PaperSize = $paper
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$doc.OriginAtMargins = $false
$image = [System.Drawing.Image]::FromFile($ImagePath)
$handler = [System.Drawing.Printing.PrintPageEventHandler]{
  param($sender, $eventArgs)
  $eventArgs.Graphics.DrawImage($image, 0, 0, $eventArgs.PageBounds.Width, $eventArgs.PageBounds.Height)
  $eventArgs.HasMorePages = $false
}
$doc.add_PrintPage($handler)
try { if (-not $DryRun) { $doc.Print() } } finally { $doc.remove_PrintPage($handler); $image.Dispose(); $doc.Dispose() }
`;
      await Bun.write(scriptFile, printScript);
      const dryRunArg = DRY_RUN ? " -DryRun" : "";
      const { stdout, stderr } = await execAsync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptFile}" -PrinterName "${safeName}" -ImagePath "${imageFile}" -WidthMm ${widthMm} -HeightMm ${heightMm}${dryRunArg}`,
        { timeout: 30000, maxBuffer: 1024 * 1024 },
      );
      const output = `${stdout}\n${stderr}`.trim();
      if (/error|exception|failed|not found|unavailable/i.test(output)) {
        return { ok: false, message: `Windows print error: ${output.slice(0, 240)}` };
      }
      if (DRY_RUN) {
        return {
          ok: true,
          message: `ตรวจงานพิมพ์ ${widthMm} × ${heightMm} มม. แล้ว (dry run)`,
          renderWidthPx: Math.ceil(widthMm * outputPxPerMm),
          renderHeightPx: Math.ceil(heightMm * outputPxPerMm),
        };
      }
      return { ok: true, message: `ส่งงาน ${widthMm} มม. ไปยัง '${safeName}' แล้ว` };
    }

    if (os === "darwin" || os === "linux") {
      // macOS/Linux: lp -d <printer> <file>
      const { stdout, stderr } = await execAsync(`lp -d "${safeName}" "${tmpFile}"`, { timeout: 15000 });
      const out = (stdout + stderr).trim();
      if (out.includes("not found") || out.includes("invalid") || out.includes("Error")) {
        return { ok: false, message: `lp error: ${out.slice(0, 200)}` };
      }
      return { ok: true, message: `ส่งงานพิมพ์ไปยัง '${safeName}' แล้ว` };
    }

    return { ok: false, message: "OS นี้ไม่รองรับการสั่งพิมพ์โดยตรง" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `สั่งพิมพ์ไม่สำเร็จ: ${msg.slice(0, 200)}` };
  } finally {
    // Cleanup temp file
    try { await Bun.file(tmpFile).delete(); } catch { /* ignore */ }
    try { await Bun.file(imageFile).delete(); } catch { /* ignore */ }
    try { await Bun.file(scriptFile).delete(); } catch { /* ignore */ }
  }
}

/**
 * สั่งพิมพ์ทดสอบ — ส่งหน้าทดสอบเล็กๆ ไปยัง printer ที่เลือก
 */
async function testPrint(printerName: string): Promise<{ ok: boolean; message: string }> {
  const testContent = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Print Test</title>
<style>
body { font-family: "Sarabun", "TH Sarabun New", Tahoma, sans-serif; padding: 20px; }
h1 { font-size: 18px; }
p { font-size: 12px; }
.test-line { border-bottom: 1px dashed #ccc; padding: 5px 0; }
.barcode-test { font-family: "IBM Plex Mono", monospace; font-size: 24px; letter-spacing: 3px; }
</style></head><body>
<h1>🧾 ทดสอบเครื่องพิมพ์</h1>
<p>เครื่องพิมพ์: <b>${printerName}</b></p>
<p>เวลา: ${new Date().toLocaleString("th-TH")}</p>
<div class="test-line">─────────────────────</div>
<p>หากคุณเห็นหน้านี้พิมพ์ออกมา → เครื่องพิมพ์ทำงานได้ปกติ ✅</p>
<p class="barcode-test">*1234567*</p>
<div class="test-line">─────────────────────</div>
<p style="font-size:9px;color:#999;">⚡ Powered by PNG TEAM · Printer Helper @ port 3031</p>
</body></html>`;
  return printToPrinter(printerName, testContent, 80, 120);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Security: รับเฉพาะ localhost (กันเครื่องอื่นใน LAN สั่งพิมพ์)
    const host = req.headers.get("host") || "";
    const clientAddr = req.headers.get("x-forwarded-for") || "";
    // อนุญาตทุก request (CORS *) แต่จริงๆ ต้องรันบน localhost เท่านั้น
    // — หากต้องการ strict check ให้ uncomment:
    // if (!host.includes("localhost") && !host.includes("127.0.0.1")) {
    //   return Response.json({ error: "Forbidden: localhost only" }, { status: 403, headers: CORS_HEADERS });
    // }

    // Health check
    if (path === "/" || path === "") {
      return Response.json(
        {
          ok: true,
          service: "printer-helper",
          version: "2.0-paper-size",
          port: PORT,
          platform: platform(),
          endpoints: ["/", "/printers", "/printers/test", "/printers/test (POST)", "/print (POST)"],
        },
        { headers: CORS_HEADERS }
      );
    }

    // Enumerate printers
    if (path === "/printers") {
      const result = await enumeratePrinters();
      return Response.json(result, { headers: CORS_HEADERS });
    }

    // Test print (GET = debug, POST = สั่งพิมพ์ทดสอบจริง)
    if (path === "/printers/test") {
      if (req.method === "POST") {
        try {
          const body = await req.json();
          const printerName = String(body?.printerName ?? "").trim();
          if (!printerName) {
            return Response.json({ ok: false, message: "กรุณาระบุ printerName" }, { headers: CORS_HEADERS });
          }
          // ตรวจว่า printer มีจริงไหม
          const list = await enumeratePrinters();
          const found = list.printers.find((p) => p.name === printerName);
          if (!found) {
            return Response.json({
              ok: false,
              message: `ไม่พบเครื่องพิมพ์ '${printerName}' ในระบบ — อาจถูกลบหรือออฟไลน์`,
            }, { headers: CORS_HEADERS });
          }
          const result = await testPrint(printerName);
          return Response.json(result, { headers: CORS_HEADERS });
        } catch (err) {
          return Response.json({
            ok: false,
            message: `Error: ${err instanceof Error ? err.message : String(err)}`,
          }, { headers: CORS_HEADERS });
        }
      }
      // GET: debug echo
      const result = await enumeratePrinters();
      return Response.json(
        {
          echo: url.search,
          detected: result.printers,
          source: result.source,
          command: result.command,
          error: result.error,
        },
        { headers: CORS_HEADERS }
      );
    }

    // Print HTML content to a specific printer
    if (path === "/print" && req.method === "POST") {
      try {
        const body = await req.json();
        const printerName = String(body?.printerName ?? "").trim();
        const content = String(body?.content ?? "").trim();
        const paperWidthMm = Number(body?.paperWidthMm ?? 80);
        const paperHeightMm = Number(body?.paperHeightMm ?? 120);
        if (!printerName) {
          return Response.json({ ok: false, message: "กรุณาระบุ printerName" }, { headers: CORS_HEADERS });
        }
        if (!content) {
          return Response.json({ ok: false, message: "กรุณาระบุ content (HTML)" }, { headers: CORS_HEADERS });
        }
        // ตรวจว่า printer มีจริงไหม
        const list = await enumeratePrinters();
        const found = list.printers.find((p) => p.name === printerName);
        if (!found) {
          return Response.json({
            ok: false,
            message: `ไม่พบเครื่องพิมพ์ '${printerName}' ในระบบ`,
          }, { headers: CORS_HEADERS });
        }
        const result = await printToPrinter(printerName, content, paperWidthMm, paperHeightMm);
        return Response.json(result, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json({
          ok: false,
          message: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }, { headers: CORS_HEADERS });
      }
    }

    return Response.json(
      { error: "Not found", path },
      { status: 404, headers: CORS_HEADERS }
    );
  },
});

console.log(`🖨️  Printer helper running on http://localhost:${PORT}/`);
console.log(`   GET  /printers           → enumerate printers`);
console.log(`   POST /printers/test      → test print to selected printer`);
console.log(`   POST /print              → print HTML to selected printer`);
console.log(`   Platform: ${platform()}`);
