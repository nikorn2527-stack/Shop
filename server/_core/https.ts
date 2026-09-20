import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generate as generateSelfSigned } from "selfsigned";

/**
 * ROUND 57 (user) — HTTPS สำหรับเปิดกล้องบนอุปกรณ์ที่เข้าผ่าน IP วงแลน
 *
 * เบราว์เซอร์บล็อก Web API อย่างกล้อง (getUserMedia) บนหน้าเว็บที่ไม่ใช่
 * "secure context" — คือ http://192.168.x.x:3001 (IP ธรรมดา) เปิดกล้องไม่ได้
 * ต้องเป็น https:// หรือ localhost เท่านั้น (กติกาความปลอดภัยของ W3C)
 *
 * วิธีแก้ของระบบนี้: เปิดโหมด HTTPS ด้วย env HTTPS=1 → เซิร์ฟเวอร์สร้างใบ
 * รับรอง self-signed ให้เอง (ไลบรารี selfsigned เขียนด้วย JS ล้วน ไม่ต้อง
 * ติดตั้ง openssl บน Windows) แล้วเสิร์ฟ https://IP:พอร์ต — อุปกรณ์ที่เข้า
 * ครั้งแรกจะเจอหน้าเตือน "ไม่ปลอดภัย" ให้กด ขั้นสูง → ดำเนินการต่อ ครั้งเดียว
 * (เบราว์เซอร์จำข้อยกเว้นไว้ทั้งเครื่อง) จากนั้นกล้องใช้ได้ปกติ
 */

/** โฟลเดอร์เก็บใบรับรอง (HTTPS_CERT_DIR, defaults to data/https) */
export function getHttpsCertDir(): string {
  return process.env.HTTPS_CERT_DIR ?? "data/https";
}

/** ไอพี IPv4 ที่ไม่ใช่ loopback ของเครื่องนี้ (Wi-Fi / สายแลน) — ไม่ซ้ำ */
export function getLanIpv4Addresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal && !out.includes(net.address)) {
        out.push(net.address);
      }
    }
  }
  return out;
}

interface CertMeta {
  ips: string[];
  createdAt: string;
}

export interface LanHttpsCert {
  key: string;
  cert: string;
}

/**
 * จัดใบรับรอง self-signed สำหรับ HTTPS บน LAN
 * - เก็บที่ {certDir}/cert.pem, key.pem, meta.json
 * - ใช้ซ้ำถ้ายังครอบคลุมไอพีปัจจุบันทั้งหมด (กันเบราว์เซอร์เตือนใหม่ทุกครั้งที่รีสตาร์ท)
 * - สร้างใหม่อัตโนมัติเมื่อไอพีเครื่องเปลี่ยน (เช่น DHCP แจกเลขใหม่) เพื่อให้
 *   ชื่อในใบรับรองตรงกับ URL ที่อุปกรณ์ใช้เข้าจริงเสมอ
 */
export async function ensureLanHttpsCert(certDir = getHttpsCertDir()): Promise<{
  cert: LanHttpsCert;
  ips: string[];
  regenerated: boolean;
}> {
  const certPath = path.join(certDir, "cert.pem");
  const keyPath = path.join(certDir, "key.pem");
  const metaPath = path.join(certDir, "meta.json");
  const lanIps = getLanIpv4Addresses();

  // มีใบรับรองเดิมและยังครอบคลุมไอพีปัจจุบันครบ → ใช้ซ้ำ
  try {
    const [key, cert, metaRaw] = await Promise.all([
      fs.promises.readFile(keyPath, "utf-8"),
      fs.promises.readFile(certPath, "utf-8"),
      fs.promises.readFile(metaPath, "utf-8"),
    ]);
    const meta = JSON.parse(metaRaw) as Partial<CertMeta>;
    const covered = [...(meta?.ips ?? []), "127.0.0.1"];
    if (lanIps.every((ip) => covered.includes(ip))) {
      return { cert: { key, cert }, ips: lanIps, regenerated: false };
    }
  } catch {
    /* ยังไม่มีไฟล์ / ไฟล์เสียหาย — สร้างใหม่ด้านล่าง */
  }

  const commonName = String(os.hostname() || "POS").slice(0, 50);
  const pems = await generateSelfSigned([{ name: "commonName", value: commonName }], {
    keySize: 2048,
    algorithm: "sha256",
    // อายุ ~10 ปี — ร้านไม่ต้องมาต่ออายุใบรับรองเอง
    notAfterDate: new Date(Date.now() + 3650 * 24 * 3600 * 1000),
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true, clientAuth: true },
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
          ...lanIps.map((ip) => ({ type: 7 as const, ip })),
        ],
      },
    ],
  });

  await fs.promises.mkdir(certDir, { recursive: true });
  await fs.promises.writeFile(certPath, pems.cert, { mode: 0o644 });
  await fs.promises.writeFile(keyPath, pems.private, { mode: 0o600 });
  const meta: CertMeta = { ips: lanIps, createdAt: new Date().toISOString() };
  await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), { mode: 0o644 });

  return { cert: { key: pems.private, cert: pems.cert }, ips: lanIps, regenerated: true };
}
