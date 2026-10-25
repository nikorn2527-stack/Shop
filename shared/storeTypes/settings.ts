/** Database-independent business contracts. No database clients or server runtime imports. */

/** FIX-5 (user) — บัญชีธนาคารของร้าน (รับเงินโอน)
 *  เก็บเป็น JSON array ใน StoreSettings.bankAccounts ·
 *  ใช้แสดงที่หน้ายืนยันการชำระ POS + ท้ายใบเสร็จ (เมื่อชำระด้วย QR/สแกน)
 *  แทนที่จะมีเฉพาะ QR PromptPay อย่างเดียว */
export type BankAccount = {
  /** id คงที่ (crypto.randomUUID()) — ใช้เป็น React key + อ้างอิงตอนลบ/แก้ */
  id: string;
  /** รหัสธนาคาร — เช่น "BBL" "KBANK" "SCB" "KTB" "BAY" "TTB" "TCD" "CIMBT" "TISCO" "KKTB" "ICB" "TCRB" "LHFB" "GHIB"
   *  เก็บเพื่อ sort/group และแสดงสี/ไอคอน (ถ้ามี) ในอนาคต */
  bankCode: string;
  /** ชื่อธนาคาร (display) เช่น "ธนาคารกสิกรไทย" — ตรงกับที่ผู้ใช้พิมพ์เข้ามา */
  bankName: string;
  /** เลขที่บัญชี (ตัวเลขเท่านั้น, 10-12 หลัก) */
  accountNumber: string;
  /** ชื่อบัญชี (ตัวอักษรตามสมุดบัญชี) — ลูกค้าใช้ตรวจสอบก่อนโอน */
  accountName: string;
  /** ชื่อสาขา (ถ้ามี) — ไม่บังคับ */
  branch?: string;
  /** ปิด/เปิดใช้งาน — ปิดได้โดยไม่ลบ (สำหรับเปลี่ยนบัญชีชั่วคราว) */
  active: boolean;
  /** หมายเหตุ (ถ้ามี) เช่น "บัญชีออมทรัพย์" "เฉพาะโอนภายในเวลาทำการ" */
  note?: string;
  /** Reusable receiving QR exported by the bank, decoded and validated before saving. */
  qrPayload?: string;
};

export type StoreSettings = {
  memberNumberMode: "running" | "year" | "manual";
  memberNumberPrefix: string;
  memberNumberYearMode: "none" | "buddhist" | "gregorian";
  memberNumberYearDigits: 2 | 4;
  memberNumberSeparator: "-" | "/" | "_" | "";
  memberNumberResetMonth: number;
  memberNumberSequenceDigits: number;
  storeName: string;
  storeCode: string;
  storeAddress: string;
  /** Round 25 — ปรับแต่งแอป: ชื่อที่แสดงบน sidebar/login/title */
  appName: string;
  /** data-URL รูปโลโก้ (สูงสุด ~512KB) — ว่าง = ใช้อักษรย่อ */
  appLogo: string;
  appBackground: string;
  loginBackground: string;
  /** สีธีมหลัก: preset id เช่น "emerald" หรือ hex "#007a55" */
  appTheme: string;
  /** ROUND 75 (user) — หน้าแจ้งผลหลังชำระเงิน ไม่เด้งไปหน้าสั่งพิมพ์อีกต่อไป:
   *  แสดงหน้าใบเสร็จพร้อมปุ่ม พิมพ์/บันทึกรูป/ดาวน์โหลด PDF ให้ผู้ใช้กดเอง —
   *  ตัวตั้ง autoPrintReceipt เดิมถูกลบออก (พฤติกรรม window.print() อัตโนมัติ)
   *  · เพิ่ม posRailHidden: ปุ่มรางซ้าย POS ที่ปิดใช้งาน (JSON array ของ key) */
  posRailHidden: string;
  posShortcutKeys: string;
  showBalanceOnReceipt: boolean;
  lowBalanceAlert: boolean;
  lowBalanceThreshold: number;
  lowStockAlert: boolean;
  expiryAlert: boolean;
  expiryAlertDays: number;
  /** Round 31 — รอบตัดยอดประจำวัน: auto = ระบบตัดตามเวลาที่กำหนด · manual = เจ้าหน้าที่กดตัดยอดเอง */
  dailyCutOffMode: "auto" | "manual";
  /** "HH:MM" เวลาตัดยอดของรอบอัตโนมัติ (เช่น "02:00" = รอบวันวิ่ง 02:00→02:00 ของวันถัดไป) */
  dailyCutOffTime: string;
  /** ROUND 36 (ข้อ 31) — ประตูบัญชีผู้พัฒนา (dev): ปิดอยู่ (false) = บัญชี dev เข้าสู่ระบบไม่ได้ทั้งหมด */
  devAccess: boolean;
  /** ROUND 38 (ข้อ 39) — สไตล์การแสดงผลของแอป: "shop" (ค่าเริ่มต้น) | "apple" | "microsoft" | "android" */
  appStyle: string;
  /** ROUND 38 (ข้อ 39) — สำรองข้อมูลอัตโนมัติ: เปิด/ปิดตัวตรวจตามรอบเวลาของเซิร์ฟเวอร์ */
  backupAutoEnabled: boolean;
  /** ROUND 38 (ข้อ 39) — รอบสำรองข้อมูลอัตโนมัติเป็นชั่วโมง (1-168) */
  backupIntervalHours: number;
  /** ROUND 38 (ข้อ 39) — จำนวนไฟล์สำรองที่เก็บสูงสุด (3-60) — เกินจากนี้ลบไฟล์เก่าสุด */
  backupKeepCount: number;
  /** ROUND 42 (ข้อ 32 ตอนที่ 3 — ข้อ 4) — ความกว้างกระดาษสลิปเครื่องพิมพ์: "58" (สลิปเล็ก) | "72" (มาตรฐานเดิม) | "80" (สลิปใหญ่) */
  receiptPaperWidth: "58" | "72" | "80";
  /** FIX-8 (user) — พรีวิวก่อนพิมพ์ (ใบเสร็จ/บัตร/รายงาน): true = เปิดก่อน (default ปลอดภัย)
   *  false = กดปุ่มพิมพ์แล้ว window.print() ทันที (เร็ว แต่ไม่มีโอกาสตรวจก่อน) */
  printPreviewBefore: boolean;
  /** FIX-9 (user) — @deprecated ใช้ receiptPrinterName/reportPrinterName/cardPrinterName แทน
   *  เก็บไว้เพื่อ backward compat (บิลเก่าที่ยังไม่ได้อัปเดต) */
  defaultPrinterName: string;
  /** FIX-15 (user) — เครื่องพิมพ์ใบเสร็จ (thermal) — พิมพ์ใบเสร็จ/สลิปเติม-ถอน · "" = ยังไม่ตั้ง */
  receiptPrinterName: string;
  /** FIX-15 (user) — เครื่องพิมพ์รายงาน (A4 laser/inkjet) — พิมพ์รายงานสมาชิก/สรุปยอด · "" = ยังไม่ตั้ง */
  reportPrinterName: string;
  /** FIX-15 (user) — เครื่องพิมพ์บัตรสมาชิก — พิมพ์บัตรสมาชิก · "" = ยังไม่ตั้ง */
  cardPrinterName: string;
  /** FIX-18 (user) — toggle พรีวิวแยกตามประเภทเอกสาร */
  receiptPreviewBefore: boolean;
  reportPreviewBefore: boolean;
  cardPreviewBefore: boolean;
  /** ROUND 56 (user) — เช็คลิสต์วันขึ้นระบบ (โซนเครื่องมือติดตั้ง): JSON array ของ id ที่ติ๊กแล้ว
   *  เก็บฝั่งเซิร์ฟเวอร์ให้ทุกเครื่องเห็นตรงกัน · "" = ยังไม่ได้ติ๊กอะไร */
  goliveChecks: string;
  /** ROUND 61 (user) — ระบบเวอร์ชัน 3 แบบ (ทั่วไป/โปร/โปรพลัส): รหัสลิขสิทธิ์ที่ใส่แล้ว ("" = ยังไม่มี) ·
   *  เปลี่ยนผ่าน edition.applyLicense เท่านั้น (settings.set กลั่น fields เหล่านี้ทิ้งเสมอ) */
  licenseKey: string;
  /** ชื่อผู้ถือลิขสิทธิ์ที่พิมพ์ตอนใช้รหัส — แสดงบนหน้าเวอร์ชันและโซนช่าง */
  licenseName: string;
  /** วันเริ่มทดลองใช้โปรพลัส 30 วัน "YYYY-MM-DD" · "" = ยังไม่เคยทดลอง · ตั้งผ่าน edition.startTrial เท่านั้น */
  trialStart: string;
  /** ROUND 63 (user) — บัญชีพร้อมเพย์ของร้าน (เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก)
   *  ใช้สร้าง QR ให้ลูกค้าสแกนจ่ายที่หน้ายืนยันการชำระเงิน · "" = ยังไม่ตั้ง (ไม่แสดง QR) */
  promptpayId: string;
  /** เปิด/ปิดการรับเงินพร้อมเพย์ โดยไม่ต้องลบหมายเลขที่ตั้งค่าไว้ */
  promptpayActive: boolean;
  /** Preferred receiving QR: promptpay or a bank account id. */
  paymentQrSource: string;
  /** FIX-5 (user) — บัญชีธนาคารของร้าน (รับเงินโอน) · เก็บเป็น JSON array ใน store_settings
   *  แสดงที่หน้ายืนยันการชำระ POS (ควบคู่กับ QR) และท้ายใบเสร็จเมื่อชำระด้วย QR / สแกน ·
   *  [] = ยังไม่มีบัญชี (ลูกค้าไม่เห็นตัวเลือกโอนผ่านธนาคาร) */
  bankAccounts: BankAccount[];
  /** ROUND 68 (user) — เบอร์โทรศูนย์ช่วยเหลือของร้าน แสดงท้ายหน้าจอทุกหน้า
   *  (แถบ footer) · "" = ไม่แสดง (เดิมเคยเป็นข้อความล็อก 02-XXX-XXXX แก้ไม่ได้) */
  helpPhone: string;
};

/**
 * P4 (release/rollback) — One row per install/update/rollback/hotfix action,
 * so the on-premise deployment has an auditable release history that pairs
 * with `scripts/update.sh` and `scripts/rollback.sh`. Action is constrained
 * to the four canonical values by a CHECK clause on the table itself; the
 * TypeScript union here mirrors that and keeps callers type-safe.
 */
export type ReleaseAction = "install" | "update" | "rollback" | "hotfix";

export type ReleaseLogRow = {
  id: number;
  version: string;
  action: ReleaseAction;
  notes: string | null;
  migrations: string | null;
  backupFile: string | null;
  healthCheck: string | null;
  actor: string | null;
  createdAt: string;
};

export type LogReleaseInput = {
  version: string;
  action: ReleaseAction;
  notes?: string | null;
  migrations?: string | null;
  backupFile?: string | null;
  healthCheck?: string | null;
  actor?: string | null;
  /** actorRole is preserved for audit-trail parity with logAction. */
  actorRole?: string | null;
};

/** ROUND 56 (user) — ภาพรวมสำหรับ "เครื่องมือติดตั้งระบบ" (โซนผู้พัฒนา): ตัวเลขที่ช่าง
 *  ต้องเห็นในวันขึ้นระบบ — จำนวนบัญชี/สมาชิก/สินค้า/บิลวันนี้/สินค้ายังไม่ตั้งราคา
 *  ขนาดฐานข้อมูล — ไว้ตรวจรับข้อมูลก่อนส่งมอบระบบให้ลูกค้า */
export type InstallOverview = {
  users: { total: number; active: number; devAccounts: number };
  members: { total: number; active: number; walletTotal: number };
  products: {
    total: number;
    active: number;
    zeroPrice: number;
    lowStock: number;
  };
  sales: { todayBills: number; todayRevenue: number; totalBills: number };
  dbSizeBytes: number;
};
