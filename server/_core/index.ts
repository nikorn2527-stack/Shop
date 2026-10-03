import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "https";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { registerReportPdfRoutes } from "./reportPdf";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { backupSqliteDatabase, listSqliteBackups, pruneSqliteBackupsByCount } from "../sqliteBackup";
import { getBackupDir, getWelfareDb, getWelfareDbPath } from "../welfareStore";
import { getSettings, logAction } from "../sqliteStore";
import { ensureLanHttpsCert, getHttpsCertDir } from "./https";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

// ROUND 38 (ข้อ 39) — สำรองข้อมูลอัตโนมัติ: ตรวจทุก 10 นาทีว่าพ้นรอบเวลาที่ตั้ง
// ไว้ใน settings หรือยัง (เทียบ createdAt ของไฟล์สำรองล่าสุด) — ผิดพลาดเท่าไหร่
// ก็แค่ console.warn ไม่ทำให้เซิร์ฟเวอร์ล้ม
function checkAutoBackup() {
  try {
    const db = getWelfareDb();
    const settings = getSettings(db);
    if (!settings.backupAutoEnabled) return;
    const lastCreatedAt = listSqliteBackups(getBackupDir())[0]?.createdAt;
    const lastMs = lastCreatedAt ? Date.parse(lastCreatedAt) : 0;
    if (Date.now() - (Number.isNaN(lastMs) ? 0 : lastMs) < settings.backupIntervalHours * 3600_000) return;
    const manifest = backupSqliteDatabase({ sourcePath: getWelfareDbPath(), backupDir: getBackupDir(), retentionDays: 3650 });
    pruneSqliteBackupsByCount(getBackupDir(), settings.backupKeepCount);
    logAction(db, "สำรองข้อมูล", "ระบบอัตโนมัติ", `สำรองข้อมูลอัตโนมัติตามรอบเวลา · ${manifest.file}`, "blue");
  } catch (error) {
    console.warn("[Backup] auto:", String(error));
  }
}

/** ROUND 38 (ข้อ 39) — เริ่มตัวตรวจสำรองอัตโนมัติ (timer unref: ไม่ยื้อให้ process ค้าง) */
function startBackupScheduler() {
  const timer = setInterval(checkAutoBackup, 10 * 60_000);
  timer.unref();
  setTimeout(checkAutoBackup, 30_000).unref();
}

async function startServer() {
  const app = express();
  // ROUND 57 (user) — โหมด HTTPS (env HTTPS=1) สำหรับเปิดกล้องบนอุปกรณ์ที่เข้า
  // ผ่าน IP วงแลน: เบราว์เซอร์อนุญาต getUserMedia เฉพาะ secure context
  // (https หรือ localhost) — http://192.168.x.x จะกล้องติด
  const useHttps = process.env.HTTPS === "1";
  let lanIps: string[] = [];
  let server: import("http").Server | HttpsServer;
  if (useHttps) {
    const ensured = await ensureLanHttpsCert(getHttpsCertDir());
    lanIps = ensured.ips;
    server = createHttpsServer({ key: ensured.cert.key, cert: ensured.cert.cert }, app);
    console.log(
      ensured.regenerated
        ? "[HTTPS] สร้างใบรับรอง self-signed ใหม่ (ครั้งแรก หรือไอพีเครื่องเปลี่ยน)"
        : "[HTTPS] ใช้ใบรับรองเดิมจาก data/https/"
    );
  } else {
    server = createServer(app);
  }
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // P0-UX-03 — vector PDF generation via Puppeteer (server-side Chromium printToPDF)
  registerReportPdfRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    const scheme = useHttps ? "https" : "http";
    console.log(`Server running on ${scheme}://localhost:${port}/`);
    if (useHttps) {
      for (const ip of lanIps) {
        console.log(`  อุปกรณ์อื่น (แท็บเล็ต/มือถือ): ${scheme}://${ip}:${port}/`);
      }
      console.log(
        "  ครั้งแรกที่อุปกรณ์เข้า URL นี้ จะมีหน้าเตือนความปลอดภัย — กด ขั้นสูง → ดำเนินการต่อไป (ครั้งเดียวต่อเครื่อง) จากนั้นกล้องสแกนบาร์โค้ดใช้ได้"
      );
    }
    // ROUND 38 (ข้อ 39) — ตัวตรวจสำรองข้อมูลอัตโนมัติ (รอบแรกหลังบูต 30 วินาที)
    startBackupScheduler();
  });
}

startServer().catch(console.error);
