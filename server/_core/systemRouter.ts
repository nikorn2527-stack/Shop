import os from "node:os";
import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  /**
   * ROUND 42 (ข้อ 32 ตอนที่ 2 — LAN + คลาวด์) — ข้อมูลเครื่องเซิร์ฟเวอร์สำหรับ
   * หน้า "ตั้งค่า → การเชื่อมต่อ": ไอพี LAN ที่เครื่องอื่นในร้านจะใช้เข้าระบบ,
   * พอร์ต, เวลาที่เซิร์ฟเวอร์เปิดมาแล้ว, แพลตฟอร์ม — ให้ผู้บริหารตรวจสอบและ
   * แจ้ง URL ให้จุดขายอื่นได้เองโดยไม่ต้องเข้าเครื่องเซิร์ฟเวอร์
   */
  lanInfo: adminProcedure.query(() => {
    const addresses: string[] = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const net of list ?? []) {
        // IPv4 ที่ไม่ใช่ loopback ภายใน = ไอพีที่ใช้ได้จริงบน LAN (Wi-Fi / สายแลน)
        if (net.family === "IPv4" && !net.internal) addresses.push(net.address);
      }
    }
    return {
      addresses,
      port: parseInt(process.env.PORT || "3000", 10),
      uptimeSeconds: Math.round(process.uptime()),
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    };
  }),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),
});
