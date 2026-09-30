/**
 * Printer Helper — mini-service สำหรับ enumerate เครื่องพิมพ์จริงในเครื่อง POS
 *
 * Browser ไม่อนุญาตให้เว็บ enumerate เครื่องพิมพ์ในระบบ (security restriction
 * กันเว็บร้ายสั่งพิมพ์เงียบๆ). ทางออก: รัน service นี้บนเครื่อง POS (on-premise)
 * service จะรัน OS commands เพื่อดึงรายการเครื่องพิมพ์ที่ติดตั้งจริง แล้ว expose
 * ผ่าน HTTP endpoint บน port 3031 — web app จะ fetch รายการมาแสดงใน dropdown.
 *
 * Endpoints:
 * - GET /              → health check { ok: true, source: "printer-helper@3031" }
 * - GET /printers       → { printers: string[], source: "windows"|"macos"|"linux"|"unknown", command: string }
 * - GET /printers/test  → { echo: "...", detected: [...] } (debug)
 *
 * OS commands ที่ใช้:
 * - Windows: PowerShell `Get-Printer | Select-Object -ExpandProperty Name`
 *            (fallback: `wmic printer get name /value`)
 * - macOS:   `lpstat -p` (parse "printer <name> ...")
 * - Linux:   `lpstat -p` (same as macOS) หรือ `lpinfo -v` (parse "network ...")
 *
 * Port: 3031 (fixed, ไม่ใช้ PORT env ตามข้อกำหนด mini-services)
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";

const execAsync = promisify(exec);
const PORT = 3031; // fixed port ตามข้อกำหนด mini-services

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type PrinterListResult = {
  printers: string[];
  source: "windows" | "macos" | "linux" | "unknown";
  command: string;
  error?: string;
};

/**
 * Enumerate printers ตาม OS — ลอง command หลักก่อน ถ้า fail ลอง fallback
 * ถ้าไม่มีเครื่องพิมพ์ในระบบ → คืน [] (empty list, ไม่ใช่ error)
 */
async function enumeratePrinters(): Promise<PrinterListResult> {
  const os = platform();
  if (os === "win32") {
    // Windows: PowerShell Get-Printer (modern, Win 8+) → fallback wmic
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"`,
        { timeout: 8000 }
      );
      const printers = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("--") && line.toLowerCase() !== "name");
      return {
        printers,
        source: "windows",
        command: "powershell Get-Printer",
      };
    } catch (err) {
      // fallback to wmic (legacy)
      try {
        const { stdout } = await execAsync(`wmic printer get name /value`, { timeout: 8000 });
        const printers = stdout
          .split("\n")
          .map((line) => line.replace(/^Name=/i, "").trim())
          .filter((line) => line.length > 0);
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

  if (os === "darwin") {
    // macOS: lpstat -p
    try {
      const { stdout } = await execAsync(`lpstat -p`, { timeout: 8000 });
      // output: "printer <NAME> idle since ..." หรือ "printer <NAME> disabled since ..."
      const printers = stdout
        .split("\n")
        .map((line) => {
          const m = line.match(/^printer\s+(\S+)\s+/i);
          return m ? m[1] : "";
        })
        .filter((name) => name.length > 0);
      return { printers, source: "macos", command: "lpstat -p" };
    } catch (err) {
      // lpstat exit code 1 หมายถึง "no destinations added" — ไม่ใช่ error จริง
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("no destinations") || msg.includes("No destinations")) {
        return { printers: [], source: "macos", command: "lpstat -p" };
      }
      return {
        printers: [],
        source: "macos",
        command: "lpstat -p",
        error: msg,
      };
    }
  }

  if (os === "linux") {
    // Linux: lpstat -p (CUPS) — fallback lpinfo -v
    try {
      const { stdout } = await execAsync(`lpstat -p`, { timeout: 8000 });
      const printers = stdout
        .split("\n")
        .map((line) => {
          const m = line.match(/^printer\s+(\S+)\s+/i);
          return m ? m[1] : "";
        })
        .filter((name) => name.length > 0);
      if (printers.length > 0) {
        return { printers, source: "linux", command: "lpstat -p" };
      }
    } catch {
      // try lpinfo -v
    }
    try {
      const { stdout } = await execAsync(`lpinfo -v`, { timeout: 8000 });
      // output: "network ...
      const printers = stdout
        .split("\n")
        .map((line) => {
          const m = line.match(/^(?:network|direct|file|implicitclass)\s+\S+:\/\/([^\s?]+)/i);
          return m ? m[1] : "";
        })
        .filter((name) => name.length > 0);
      return { printers, source: "linux", command: "lpinfo -v" };
    } catch (err) {
      return {
        printers: [],
        source: "linux",
        command: "lpstat -p + lpinfo -v",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { printers: [], source: "unknown", command: "(unsupported OS)" };
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

    // Health check
    if (path === "/" || path === "") {
      return Response.json(
        {
          ok: true,
          service: "printer-helper",
          port: PORT,
          platform: platform(),
          endpoints: ["/", "/printers", "/printers/test"],
        },
        { headers: CORS_HEADERS }
      );
    }

    // Enumerate printers
    if (path === "/printers") {
      const result = await enumeratePrinters();
      return Response.json(result, { headers: CORS_HEADERS });
    }

    // Debug: echo back query + show detected
    if (path === "/printers/test") {
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

    return Response.json(
      { error: "Not found", path },
      { status: 404, headers: CORS_HEADERS }
    );
  },
});

console.log(`🖨️  Printer helper running on http://localhost:${PORT}/`);
console.log(`   GET /printers   → enumerate printers on this machine`);
console.log(`   GET /printers/test?anything=here   → debug echo`);
console.log(`   Platform: ${platform()}`);
