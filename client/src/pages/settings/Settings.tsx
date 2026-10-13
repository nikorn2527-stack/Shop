import { ActionButton } from "@/components/ActionButton";
import { INVENTORY_ACTION_LABELS } from "@/lib/inventoryActions";
import { SharedSearch } from "@/components/SharedSearch";
/**
 * V2-C4 — Settings view extracted from `client/src/pages/Home.tsx` (pure move).
 *
 * This file holds the entire settings page: brand & theme, receipt layout, member
 * number format, payment & PromptPay, POS rail shortcuts, daily cutoff, roles &
 * dev access, edition/license, backup, data import, install/dev tools, and the
 * go-live checklist. The component is wired into the AppShell via the
 * `viewComponents.Settings` slot — Home.tsx now imports it from here.
 *
 * Constants and types declared above the function (SettingsForm, SETTINGS_FIELD_LABELS,
 * POS_RAIL_BUTTONS, import field descriptors, ROLE_MATRIX, formatFileSize,
 * uptimeLabel, DEV_SETTINGS_TAB_IDS, parseGoliveChecks, GO_LIVE_CHECKLIST) were
 * moved together with the function because they are Settings-only — verified by
 * grep'ing their usage across the rest of Home.tsx (none are referenced by the
 * remaining Home default export or by other view modules).
 *
 * Round references preserved: ROUND 17 (settings field labels), ROUND 36 (ข้อ 31 —
 * dev access), ROUND 38 (ข้อ 38 — UI style + ข้อ 39 — backup), ROUND 40 (ข้อ 32 —
 * Excel/CSV import), ROUND 42 (ข้อ 32 ตอนที่ 2 — LAN info), ROUND 56 (go-live
 * checklist), ROUND 61 (edition/license), ROUND 63 (PromptPay), ROUND 68 (help
 * phone), ROUND 75 (POS rail shortcuts), UI-2/UI-5 (member-number demo + disclosure).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Activity,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  TrendingDown,
  Bank,
  Bell,
  CalendarClock,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  CircleHelp,
  Cloud,
  Copy,
  CreditCard,
  Crown,
  DatabaseBackup,
  Download,
  FileSpreadsheet,
  FileUp,
  Globe,
  HardDriveDownload,
  Image as ImageIcon,
  ImagePlus,
  KeyRound,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  ListChecks,
  Monitor,
  Network,
  PackageSearch,
  Palette,
  Pause,
  Pencil,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Table2,
  Terminal,
  Trash2,
  UserCog,
  UserPlus,
  UsersRound,
  WalletCards,
  Wifi,
  Wrench,
  X,
  CircleAlert,
} from "@/lib/icons";
import { toast } from "sonner";
import {
  EDITIONS,
  editionStatusLabel,
} from "@shared/editions";
import {
  DevKeygenTool,
  EditionCompareTable,
  EditionUpgradeModal,
  useEditionStatus,
} from "@/components/EditionUi";
import type { Role, View } from "../pageData";
import type { BankAccount, InstallOverview } from "../../../../server/sqliteStore";
import {
  canAccessView,
  formatMemberNumber,
  isAdminRole,
  money,
} from "../pageData";
import {
  ConfirmDialog,
  SectionHeader,
  StatusPill,
} from "../PagePrimitives";
import { HelpDisclosure } from "@/components/HelpDisclosure";
import { isValidPromptPayId } from "@/promptpay";
import { PrintPreviewModal } from "@/components/PrintPreviewModal";
import { BankAccountsPanel } from "@/components/BankAccountsPanel";
import { PrinterPicker, PrinterHelperStatus } from "@/components/PrinterPicker";
import { getLocalPrinterSettings, updateLocalPrinterSetting, getWorkstationId } from "@/lib/printHelper";
import { trpc } from "@/lib/trpc";
// V2-B — SettingsTab shared between Settings (this file) and AppShell (layouts/).
import { SettingsTab } from "../shared";
import {
  applyFontScale,
  FONT_SCALES,
  readFontScale,
  type FontScaleId,
} from "../../fontScale";
import {
  applyPaperWidth,
  applyBackground,
  applyThemeColor,
  applyUiStyle,
  brandInitial,
  PAPER_WIDTHS,
  resolvePaperWidth,
} from "../../theme";
import {
  formatLogDateTime,
  formatThaiDate,
  getErrorMessage,
  nextMemberSequence,
} from "../viewFormat";

type SettingsForm = {
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
  appName: string;
  appLogo: string;
  appBackground: string;
  appTheme: string;
  /** ROUND 38 (ข้อ 38) — บุคลิกการออกแบบทั้งระบบ: shop | apple | microsoft | android */
  appStyle: string;
  /** ROUND 75 (user) — เมนูลัดหน้าร้าน (POS): JSON array ของรหัสปุ่มที่ปิดใช้งาน · "" = เปิดครบ */
  posRailHidden: string;
  posShortcutKeys: string;
  showBalanceOnReceipt: boolean;
  lowBalanceAlert: boolean;
  lowBalanceThreshold: number;
  lowStockAlert: boolean;
  expiryAlert: boolean;
  expiryAlertDays: number;
  dailyCutOffMode: "auto" | "manual";
  dailyCutOffTime: string;
  /** ROUND 36 (ข้อ 31) — ประตูบัญชีผู้พัฒนา (dev): false = บัญชี dev เข้าสู่ระบบไม่ได้ */
  devAccess: boolean;
  /** ROUND 38 (ข้อ 39) — สำรองข้อมูลอัตโนมัติ */
  backupAutoEnabled: boolean;
  backupIntervalHours: number;
  backupKeepCount: number;
  /** ROUND 42 (ข้อ 4) — ความกว้างกระดาษสลิป: "58" | "72" | "80" */
  receiptPaperWidth: "58" | "72" | "80";
  /** FIX-8 (user) — พรีวิวก่อนพิมพ์ (ใบเสร็จ/บัตร/รายงาน): true = เปิด preview ก่อน (default)
   *  false = กดปุ่มพิมพ์แล้ว window.print() ทันที (เร็ว แต่ไม่มีโอกาสตรวจก่อน) */
  printPreviewBefore: boolean;
  /** FIX-9 (user) — @deprecated ใช้ 3 fields ด้านล่างแทน */
  defaultPrinterName: string;
  /** FIX-15 (user) — เครื่องพิมพ์ใบเสร็จ (thermal) */
  receiptPrinterName: string;
  /** FIX-15 (user) — เครื่องพิมพ์รายงาน (A4 laser/inkjet) */
  reportPrinterName: string;
  /** FIX-15 (user) — เครื่องพิมพ์บัตรสมาชิก */
  cardPrinterName: string;
  /** FIX-18 (user) — toggle พรีวิวแยกตามประเภทเอกสาร */
  receiptPreviewBefore: boolean;
  reportPreviewBefore: boolean;
  cardPreviewBefore: boolean;
  /** ROUND 56 (user) — เช็คลิสต์วันขึ้นระบบ (โซนเครื่องมือติดตั้ง): JSON รหัสรายการที่ติ๊กแล้ว */
  goliveChecks: string;
  /** ROUND 63 (user) — บัญชีพร้อมเพย์ร้าน: เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก */
  promptpayId: string;
  /** เปิด/ปิดพร้อมเพย์โดยไม่ลบหมายเลขที่เคยตั้ง */
  promptpayActive: boolean;
  /** FIX-5 (user) — บัญชีธนาคารร้าน (รับเงินโอน) หลายบัญชีได้ · แสดงที่หน้า POS + ใบเสร็จ */
  bankAccounts: BankAccount[];
  /** ROUND 68 (user) — เบอร์โทรศูนย์ช่วยเหลือ แสดงท้ายหน้าจอ (footer) · ว่าง = ไม่แสดง */
  helpPhone: string;
};

/** Round 17 — Thai labels per settings field, used by the unsaved-changes bar. */
const SETTINGS_FIELD_LABELS: [keyof SettingsForm, string][] = [
  ["memberNumberMode", "รูปแบบเลขสมาชิก"],
  ["memberNumberPrefix", "คำนำหน้าเลขสมาชิก"],
  ["memberNumberYearMode", "ระบบปีของเลขสมาชิก"],
  ["memberNumberYearDigits", "จำนวนหลักปีของเลขสมาชิก"],
  ["memberNumberSeparator", "ตัวคั่นเลขสมาชิก"],
  ["memberNumberResetMonth", "เดือนเริ่มรอบปีสมาชิก"],
  ["memberNumberSequenceDigits", "จำนวนหลักเลขรันสมาชิก"],
  ["storeName", "ชื่อร้าน"],
  ["storeCode", "รหัสร้าน"],
  ["storeAddress", "ที่อยู่"],
  ["appName", "ชื่อแอป"],
  ["appLogo", "โลโก้"],
  ["appTheme", "สีธีม"],
  ["appStyle", "สไตล์หน้าตาแอป"],
  ["posRailHidden", "เมนูลัดหน้าร้าน (POS)"],
  ["posShortcutKeys", "ปุ่มทางลัด POS"],
  ["showBalanceOnReceipt", "แสดงยอดคงเหลือบนใบเสร็จ"],
  ["lowBalanceAlert", "แจ้งเตือนยอดคงเหลือต่ำ"],
  ["lowBalanceThreshold", "เกณฑ์ยอดคงเหลือต่ำ"],
  ["lowStockAlert", "แจ้งเตือนสต็อกต่ำ"],
  ["expiryAlert", "แจ้งเตือนใกล้หมดอายุ"],
  ["expiryAlertDays", "จำนวนวันแจ้งเตือนล่วงหน้า"],
  ["dailyCutOffMode", "โหมดตัดยอดรายวัน"],
  ["dailyCutOffTime", "เวลาตัดยอดรายวัน"],
  ["promptpayId", "บัญชีพร้อมเพย์ร้าน"],
  ["promptpayActive", "เปิดใช้พร้อมเพย์"],
  ["bankAccounts", "บัญชีธนาคารร้าน"],
  ["helpPhone", "เบอร์ศูนย์ช่วยเหลือ"],
  ["devAccess", "การเข้าใช้งานสำหรับผู้พัฒนา"],
  ["backupAutoEnabled", "สำรองข้อมูลอัตโนมัติ"],
  ["backupIntervalHours", "รอบสำรองข้อมูลอัตโนมัติ"],
  ["backupKeepCount", "จำนวนไฟล์สำรองที่เก็บ"],
  ["receiptPaperWidth", "ความกว้างกระดาษสลิป"],
  ["printPreviewBefore", "พรีวิวก่อนพิมพ์"],
  ["defaultPrinterName", "ชื่อเครื่องพิมพ์เริ่มต้น"],
  ["receiptPrinterName", "เครื่องพิมพ์ใบเสร็จ"],
  ["reportPrinterName", "เครื่องพิมพ์รายงาน"],
  ["cardPrinterName", "เครื่องพิมพ์บัตรสมาชิก"],
  ["goliveChecks", "เช็คลิสต์วันขึ้นระบบ"],
];

/** ROUND 75 (user) — รายการปุ่มบนรางซ้ายหน้า POS ที่ตั้งค่าเปิด/ปิดได้ (ตั้งค่า → การขายหน้าร้าน → เมนูลัดหน้าร้าน)
 *  ปุ่ม "เมนู" (Esc) ไม่อยู่ในลิสต์นี้ — เป็นทางกลับสู่ภาพรวมระบบ ใช้งานเสมอ */
const POS_RAIL_BUTTONS: {
  key: string;
  label: string;
  kbd: string;
  detail: string;
  icon: typeof Bell;
}[] = [
  {
    key: "scan",
    label: "สแกน",
    kbd: "F8",
    detail: "โฟกัสช่องสแกนบาร์โค้ด — พร้อมรับค่าเสมอ",
    icon: ScanLine,
  },
  {
    key: "customer",
    label: "ลูกค้า",
    kbd: "F1",
    detail: "เลือกลูกค้า / สมาชิกสำหรับบิลนี้",
    icon: UsersRound,
  },
  {
    key: "deposit",
    label: "เติมเงิน",
    kbd: "F2",
    detail: "เติมเงินเข้าบัญชีสมาชิก — มีสลิปยืนยันทุกครั้ง",
    icon: ArrowDownToLine,
  },
  {
    key: "withdraw",
    label: "ถอนเงิน",
    kbd: "F3",
    detail: "ถอนเงินจากบัญชีสมาชิก — ระบบตรวจยอดก่อนทุกครั้ง",
    icon: ArrowUpFromLine,
  },
  {
    key: "card",
    label: "จัดการบัตร",
    kbd: "",
    detail: "ขอลดวงเงิน คืนบัตร หรือจ่ายบัตรให้สมาชิกเดิม",
    icon: UsersRound,
  },

  {
    key: "special",
    label: "รายการพิเศษ",
    kbd: "F4",
    detail: "ของสั่ง ค่าบริการ รายการนอกแค็ตตาล็อก — ไม่ตัดสต็อก",
    icon: Sparkles,
  },
  {
    key: "hold",
    label: "พักบิล",
    kbd: "F5",
    detail: "พักบิลปัจจุบันไว้ เรียกคืนได้จากแถบใต้ช่องสแกน",
    icon: Pause,
  },
  {
    key: "register",
    label: "สมาชิกใหม่",
    kbd: "F6",
    detail: "ลงทะเบียนสมาชิกใหม่ + พิมพ์บัตร — จบที่หน้าร้านจุดเดียว",
    icon: UserPlus,
  },
  {
    key: "manage",
    label: "จัดแผง",
    kbd: "F7",
    detail: "จัดแผงลัดหน้าร้าน — เพิ่ม/ลบการ์ดสินค้าที่หยิบบ่อย",
    icon: Star,
  },
  {
    key: "receive",
    label: INVENTORY_ACTION_LABELS.receive,
    kbd: "F9",
    detail: "เปิดฟอร์มรับเข้าสินค้าชุดเดียวกับเมนูสต็อกสินค้า โดยตรงจากหน้า POS",
    icon: PackageSearch,
  },
  {
    key: "add",
    label: INVENTORY_ACTION_LABELS.add,
    kbd: "F10",
    detail: "เปิดฟอร์มเพิ่มสินค้าใหม่ชุดเดียวกับเมนูสต็อกสินค้า โดยตรงจากหน้า POS",
    icon: Plus,
  },
];

// ROUND 40 (ข้อ 32) — นำเข้าข้อมูลจาก Excel/CSV: ชนิด + ชีตที่อ่านได้ + ผลลัพธ์
type ImportKindId = "members" | "products";
type ImportSheetLite = {
  name: string;
  headerRowIndex: number;
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  suggestedMapping: Record<string, number>;
};
type ImportResultLite = {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
  safetyBackupFile: string;
  fileName: string;
};

/** คำอธิบาย field นำเข้าสมาชิก — ลำดับตามที่แสดงบนหน้าจอ */
const MEMBER_IMPORT_FIELDS: {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
}[] = [
  { key: "firstName", label: "ชื่อ", required: true },
  {
    key: "prename",
    label: "คำนำหน้า",
    hint: "เช่น นาย / นาง / นางสาว — เว้นว่างได้",
  },
  {
    key: "memberNumber",
    label: "เลขสมาชิก",
    hint: "เว้นว่าง = ระบบสร้างเลขใหม่ให้อัตโนมัติ",
  },
  { key: "lastName", label: "นามสกุล" },
  {
    key: "balance",
    label: "ยอดเงินคงเหลือ (บาท)",
    hint: "บันทึกเป็นรายการ “ยอดยกมา · นำเข้าข้อมูล” ในประวัติสมาชิก",
  },
  { key: "creditLimit", label: "วงเงิน (บาท)", hint: "เว้นว่าง = ไม่จำกัด" },
  {
    key: "status",
    label: "สถานะ",
    hint: "ปกติ/ใช้งาน = ปกติ · ระงับ/พัก = ระงับ",
  },
  { key: "phone", label: "เบอร์โทร" },
  { key: "idCard", label: "เลขบัตรประชาชน" },
  { key: "type", label: "ประเภทสมาชิก" },
  { key: "gender", label: "เพศ" },
];

/** คำอธิบาย field นำเข้าสินค้า — ลำดับตามที่แสดงบนหน้าจอ */
const PRODUCT_IMPORT_FIELDS: {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
}[] = [
  { key: "name", label: "ชื่อสินค้า", required: true },
  { key: "barcode", label: "บาร์โค้ด", hint: "ใช้ตรวจสินค้าซ้ำเป็นอันดับแรก" },
  { key: "sku", label: "รหัสสินค้า (SKU)", hint: "เว้นว่าง = ระบบสร้างให้" },
  { key: "category", label: "หมวดหมู่" },
  { key: "unit", label: "หน่วย", hint: "เว้นว่าง = ชิ้น" },
  { key: "price", label: "ราคาขาย (บาท)" },
  { key: "cost", label: "ต้นทุน (บาท)" },
  {
    key: "stock",
    label: "สต็อกคงเหลือ",
    hint: "สินค้าใหม่จะสร้างเป็น Lot “นำเข้าข้อมูล” ให้อัตโนมัติ",
  },
  { key: "reorderPoint", label: "จุดสั่งซื้อ" },
  { key: "size", label: "ขนาด / สเปค" },
];

/** ชื่อคอลัมน์แบบตัวอักษร (A, B, C …) สำหรับช่วยเลือกคอลัมน์ */
const importColumnLabel = (index: number): string => {
  let label = "";
  let value = index;
  while (value >= 0) {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  }
  return label;
};

/** ย่อรูปโลโก้เป็น data-URL 256px (contain) — กัน settings โตเพราะรูปใหญ่ */
function shrinkLogoToDataUrl(dataUrl: string, max = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas ไม่พร้อมใช้งาน"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("อ่านรูปไม่สำเร็จ"));
    img.src = dataUrl;
  });
}

/** Real permission matrix — mirrored from canAccessView + role gates in the shell. */
const ROLE_MATRIX: {
  role: "staff" | "admin";
  title: string;
  caption: string;
  permits: string[];
}[] = [
  {
    role: "staff",
    title: "เจ้าหน้าที่ร้านค้า",
    caption: "ใช้งานหน้าเคาน์เตอร์ประจำวัน",
    permits: [
      "ขายสินค้าและชำระเงินผ่าน POS",
      "รับเข้าสินค้าและนับสต็อกรายล็อต",
      "ลงทะเบียนสมาชิก · แก้ไขข้อมูล · เติม/ถอนเงิน",
      "พิมพ์บัตรสมาชิกและใบเสร็จ",
      "ดูรายงานและส่งออกไฟล์",
    ],
  },
  {
    role: "admin",
    title: "ผู้บริหารระบบ",
    caption: "มีสิทธิ์ทุกอย่างเท่าเจ้าหน้าที่ และเพิ่ม",
    permits: [
      "แก้ไขและลบสินค้า · ลบสมาชิกที่ไม่มีธุรกรรม",
      "ตั้งค่าระบบและใบเสร็จทั้งหมด",
      "จัดการผู้ใช้ระบบ · รีเซ็ตรหัสผ่าน · ปลดล็อกบัญชี",
      "ดูประวัติระบบ ประวัติการใช้งาน",
      "ยกเลิก/ปรับปรุงข้อมูลเมื่อมีปัญหา",
    ],
  },
];

/** ROUND 38 (ข้อ 39) — แสดงขนาดไฟล์สำรองเป็น KB/MB อ่านง่าย */
function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** ROUND 42 — แปลงวินาทีที่เซิร์ฟเวอร์เปิดมาแล้ว เป็นข้อความไทยสั้น ๆ */
function uptimeLabel(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} วัน ${hours} ชั่วโมง`;
  if (hours > 0) return `${hours} ชั่วโมง ${minutes} นาที`;
  return `${minutes} นาที`;
}

/** ROUND 56 (user) — แท็บที่อยู่ในโซนผู้พัฒนา (ต้องเป็นบัญชี dev จึงเห็น/ใช้ได้):
 *  เครื่องมือติดตั้ง · การเชื่อมต่อ (r87 — แท็บสำรองข้อมูลย้ายไปหมวดระบบและความปลอดภัย เพื่อให้ผู้บริหารใช้ได้ เช่น อัปโหลด/กู้คืนข้อมูลตอนย้ายร้านขึ้นคลาวด์) */
const DEV_SETTINGS_TAB_IDS: SettingsTab[] = ["install", "network"];

/** อ่านรหัสรายการเช็คลิสต์วันขึ้นระบบจากค่า settings (JSON array) — เสีย/ว่าง = ยังไม่ได้ติ๊กอะไร */
function parseGoliveChecks(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** ROUND 56 (user) — เช็คลิสต์วันขึ้นระบบ: ใช้ในโซนเครื่องมือติดตั้ง (dev) ·
 *  auto = ระบบตรวจให้ได้จากตัวเลขในฐานข้อมูลจริง (แสดงป้าย ตรวจแล้ว/ยังไม่ครบ) */
const GO_LIVE_CHECKLIST: {
  id: string;
  label: string;
  hint: string;
  action?: "import" | "users" | "printer" | "backup" | "roles";
  auto?: (overview: InstallOverview) => boolean;
}[] = [
  {
    id: "brand",
    label: "ตั้งชื่อร้าน โลโก้ และที่อยู่ครบถ้วน",
    hint: "แสดงบนหน้าจอ หน้าเข้าสู่ระบบ และหัวใบเสร็จ — ตั้งที่แท็บแบรนด์และธีม",
  },
  {
    id: "users",
    label: "สร้างบัญชีผู้ใช้ครบทุกจุดขาย",
    hint: "แต่ละจุดขายควรมีบัญชีของตัวเอง (ไม่ใช้ร่วมกัน) — สร้างที่เมนูผู้ใช้ระบบ",
    action: "users",
    auto: overview => overview.users.active >= 2,
  },
  {
    id: "dev-account",
    label: "สร้างบัญชีผู้พัฒนาไว้ดูแลระยะยาว",
    hint: "ไว้ให้ผู้ติดตั้งกลับมาตรวจ/อัปเดตระบบภายหลัง — สร้างที่เมนูผู้ใช้ระบบ (รหัสผ่าน 12 ตัวขึ้นไป + มีสัญลักษณ์)",
    action: "users",
    auto: overview => overview.users.devAccounts >= 1,
  },
  {
    id: "products",
    label: "นำเข้าสินค้า + ตั้งราคาครบทุกรายการ",
    hint: "สินค้าที่ยังเป็น ฿0 = ยังไม่ได้ตั้งราคาขาย — แก้ที่หน้าสต็อกสินค้าได้เลย",
    action: "import",
    auto: overview =>
      overview.products.active > 0 && overview.products.zeroPrice === 0,
  },
  {
    id: "members",
    label: "นำเข้าสมาชิก + ยอดเงินเริ่มต้น",
    hint: "ข้อมูลลูกค้าที่เตรียมมานำเข้าที่แท็บนำเข้าข้อมูล (Excel/CSV) — สมาชิกใหม่ภายหลังลงทะเบียนที่ POS (F6) ได้",
    action: "import",
    auto: overview => overview.members.active > 0,
  },
  {
    id: "test-sale",
    label: "ทดสอบขายจริงครบทุกวิธีชำระ",
    hint: "เงินสด · QR · หักบัญชีสมาชิก — ทุกบิลมีขั้นตอนยืนยันก่อนบันทึก ลองให้ครบทั้ง 3 แบบ",
  },
  {
    id: "printer",
    label: "พิมพ์สลิปทดสอบที่เครื่องพิมพ์จริง",
    hint: "สั่งพิมพ์ทดสอบแล้วเช็คว่าตัวอักษรไทยอ่านชัด ครบทุกบรรทัด ไม่ถูกตัด",
    action: "printer",
  },
  {
    id: "lan",
    label: "เครื่องอื่นเข้าระบบผ่าน LAN URL ได้",
    hint: "เปิด URL ด้านบนที่แท็บเล็ต/มือถือของร้าน — ทุกจุดขายต้องเข้าได้ก่อนส่งมอบ",
  },
  {
    id: "backup",
    label: "ตั้งสำรองอัตโนมัติ + ก๊อปไฟล์สำรองออกนอกเครื่อง",
    hint: "สำรองอัตโนมัติทุก 24 ชม. (ปรับได้ที่แท็บสำรองข้อมูล) — ดาวน์โหลดไฟล์เก็บที่ USB/คลาวด์ด้วย",
    action: "backup",
  },
  {
    id: "handover",
    label: "เปลี่ยนรหัสผ่านผู้บริหาร + ปิดประตูผู้พัฒนา",
    hint: "ส่งมอบแล้วให้ผู้บริหารเปลี่ยนรหัสของตัวเอง และปิด Dev Access ที่แท็บสิทธิ์และความปลอดภัย — เปิดใหม่ได้เมื่อช่างมาถึง",
    action: "roles",
  },
];

/** LocalPrinterSettings — 3 แถว dropdown + ปุ่มพิมพ์ทดสอบ บันทึก localStorage */
function LocalPrinterSettings() {
  const [settings, setSettings] = useState(() => getLocalPrinterSettings());
  const docs: { type: "receipt" | "report" | "card"; label: string; hint: string }[] = [
    { type: "receipt", label: "ใบเสร็จ", hint: "พิมพ์ใบเสร็จจากหน้า POS" },
    { type: "report", label: "รายงาน", hint: "พิมพ์รายงาน A4" },
  ];
  return (
    <div className="printer-settings-list">
      {docs.map((doc) => (
        <div key={doc.type} className="printer-doc-row">
          <div className="printer-doc-label">
            <b>{doc.label}</b>
            <small>{doc.hint}</small>
          </div>
          <PrinterPicker
            docType={doc.type}
            value={settings[doc.type]}
            onChange={(name) => {
              updateLocalPrinterSetting(doc.type, name);
              setSettings(getLocalPrinterSettings());
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function Settings({
  setView,
  role,
  initialTab,
}: {
  setView: (view: View) => void;
  role: Role;
  initialTab?: SettingsTab;
}) {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  // ROUND 61 — สถานะเวอร์ชัน 3 แบบ (แท็บเวอร์ชันและลิขสิทธิ์ + ปุ่มล็อกตามจุดต่าง ๆ)
  const edition = useEditionStatus();
  const canImportExport = edition.status?.has("importExport") ?? false;
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const membersQuery = trpc.member.list.useQuery();
  const logsStatsQuery = trpc.logs.list.useQuery({ limit: 200 });
  const [tab, setTab] = useState<SettingsTab>("receipt");
  // ROUND 61 — ป้ายเวอร์ชันที่ sidebar กดแล้วพามาแท็บเวอร์ชันโดยตรง
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  // ROUND 56 — โซนผู้พัฒนา: บัญชีที่ไม่ใช่ dev ห้ามค้างอยู่ในแท็บโซนช่าง (เช่น สลับบัญชีระหว่างเปิดหน้าค้างไว้)
  const isDevRole = role === "dev";
  // r87 — ผู้บริหารเห็นแท็บสำรองข้อมูล (server mutation ตรวจสิทธิ์ผู้บริหารอยู่แล้ว)
  const isAdminRole = role === "admin" || role === "dev";
  useEffect(() => {
    if (!isDevRole && DEV_SETTINGS_TAB_IDS.includes(tab)) setTab("receipt");
  }, [isDevRole, tab]);
  const [fontScale, setFontScale] = useState<FontScaleId>(() =>
    readFontScale()
  );
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [promptPayEditing, setPromptPayEditing] = useState(false);
  const [promptPayDraft, setPromptPayDraft] = useState("");
  // Threshold input keeps raw digits while typing (cleared field = 0) —
  // committed into the shared form on every keystroke via updateForm.
  const [thresholdText, setThresholdText] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // UI-5 — advanced member-number fields hidden behind a disclosure by default
  const [memberAdvancedOpen, setMemberAdvancedOpen] = useState(false);
  // ROUND 36 (ข้อ 31) — จำนวนบัญชี dev + โมดัลยืนยันตอนเปิด Dev Access
  const usersQuery = trpc.user.list.useQuery(undefined);
  const [devAccessConfirm, setDevAccessConfirm] = useState(false);
  const devAccounts = (usersQuery.data ?? []).filter(
    user => user.role === "dev" && user.active === 1
  );
  // ROUND 42 (ข้อ 32 ตอนที่ 2) — แท็บการเชื่อมต่อ: ข้อมูล LAN จากเซิร์ฟเวอร์ + วัดความหน่วง
  // + สถานะออนไลน์ของเบราว์เซอร์ (โหลดเฉพาะตอนเปิดแท็บนี้ — ไม่วุ่นวายตอนอยู่แท็บอื่น)
  // ROUND 56 — ใช้ร่วมกับแท็บเครื่องมือติดตั้ง (โซนผู้พัฒนา) ด้วย
  const lanInfoQuery = trpc.system.lanInfo.useQuery(undefined, {
    enabled: tab === "network" || (tab === "install" && isDevRole),
  });
  const lanInfo = lanInfoQuery.data ?? null;
  // ROUND 56 — ภาพรวมตรวจรับข้อมูลวันขึ้นระบบ (โซนผู้พัฒนา): จำนวนบัญชี/สมาชิก/สินค้า/บิลวันนี้/ขนาด DB
  const installOverviewQuery = trpc.install.overview.useQuery(undefined, {
    enabled: tab === "install" && isDevRole,
    retry: false,
  });
  const installOverview = installOverviewQuery.data ?? null;
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [latencyAt, setLatencyAt] = useState("");
  const [latencyError, setLatencyError] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  useEffect(() => {
    const sync = () => setBrowserOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  const measureLatency = () => {
    const started = performance.now();
    utils.client.system.health
      .query({ timestamp: Date.now() })
      .then(() => {
        setLatencyMs(Math.round(performance.now() - started));
        setLatencyError(false);
        setLatencyAt(
          new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hourCycle: "h23",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        );
      })
      .catch(() => {
        setLatencyError(true);
        setLatencyMs(null);
      });
  };
  useEffect(() => {
    if (tab === "network") measureLatency();
  }, [tab]);
  const copyLanUrl = (text: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() =>
        toast.success("คัดลอก URL เรียบร้อย", {
          description: "นำไปวางที่เบราว์เซอร์ของเครื่องอื่นได้เลย",
          duration: 2400,
        })
      )
      .catch(() =>
        toast.error("คัดลอกไม่สำเร็จ", {
          description: `คัดลอกด้วยตนเอง: ${text}`,
        })
      );
  };
  // ROUND 38 (ข้อ 39) — ระบบสำรองข้อมูล: รายการไฟล์ + สร้าง/ดาวน์โหลด/กู้คืน (admin เท่านั้น — เมนูตั้งค่าเข้าได้ admin อยู่แล้ว)
  // ROUND 56 — ดึงด้วยเมื่ออยู่แท็บเครื่องมือติดตั้ง (แสดงไฟล์สำรองล่าสุดให้ช่าง)
  const backupQuery = trpc.backup.list.useQuery(undefined, {
    enabled: tab === "backup" || (tab === "install" && isDevRole),
  });
  const lastBackupFile = (backupQuery.data?.backups ?? [])[0] ?? null;
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const createBackupMutation = trpc.backup.create.useMutation({
    onSuccess: data => {
      toast.success("สำรองข้อมูลเรียบร้อย", {
        description: `${data.file} · ${formatFileSize(data.sizeBytes)} · ตรวจสอบความถูกต้องผ่าน (เก็บตามจำนวนที่ตั้งไว้ ${data.keepCount} ไฟล์)`,
        duration: 5000,
      });
      void backupQuery.refetch();
    },
    onError: mutationError =>
      toast.error("สำรองข้อมูลไม่สำเร็จ", {
        description: getErrorMessage(mutationError),
      }),
  });
  const downloadBackupMutation = trpc.backup.download.useMutation({
    onSuccess: data => {
      try {
        const binary = atob(data.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1)
          bytes[index] = binary.charCodeAt(index);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(
          new Blob([bytes], { type: "application/x-sqlite3" })
        );
        link.download = data.file;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 4000);
        toast.success("กำลังดาวน์โหลดไฟล์สำรอง", {
          description: `${data.file} · ${formatFileSize(data.sizeBytes)} — เก็บไว้นอกเครื่อง เช่น USB หรือคลาวด์ กันกรณีเครื่องพัง`,
        });
      } catch {
        toast.error("เปิดไฟล์สำรองไม่สำเร็จ", {
          description: "ลองดาวน์โหลดอีกครั้ง",
        });
      }
    },
    onError: mutationError =>
      toast.error("ดาวน์โหลดไม่สำเร็จ", {
        description: getErrorMessage(mutationError),
      }),
  });
  const restoreBackupMutation = trpc.backup.restore.useMutation({
    onSuccess: async data => {
      setRestoreTarget(null);
      toast.success("กู้คืนข้อมูลเรียบร้อย", {
        description: `ระบบสำรองไฟล์ป้องกันไว้ก่อน (${data.safetyBackupFile}) แล้วเปลี่ยนฐานข้อมูลเป็นไฟล์ที่เลือก — ข้อมูลทั้งระบบกลับมาเป็นช่วงเวลาของไฟล์สำรองนั้น`,
        duration: 6500,
      });
      await utils.invalidate();
      void backupQuery.refetch();
    },
    onError: mutationError => {
      setRestoreTarget(null);
      toast.error("กู้คืนไม่สำเร็จ", {
        description: getErrorMessage(mutationError),
        duration: 5500,
      });
    },
  });
  // r87 — อัปโหลดไฟล์ฐานข้อมูล .sqlite จากเครื่องอื่น (ย้ายร้าน/ขึ้นคลาวด์): ตรวจก่อนเข้ารายการสำรอง แล้วกดกู้คืนได้เลย
  const uploadBackupInputRef = useRef<HTMLInputElement | null>(null);
  const uploadBackupMutation = trpc.backup.upload.useMutation({
    onSuccess: async data => {
      toast.success("อัปโหลดไฟล์สำเร็จ — ตรวจความถูกต้องผ่านแล้ว", {
        description: `${data.file} · ${formatFileSize(data.sizeBytes)} — อยู่ใน “ไฟล์สำรองทั้งหมด” ด้านล่างแล้ว กด “กู้คืน” เพื่อนำข้อมูลชุดนี้กลับมาใช้งานทั้งระบบ`,
        duration: 9000,
      });
      await utils.invalidate();
      void backupQuery.refetch();
    },
    onError: mutationError =>
      toast.error("อัปโหลดไฟล์ไม่สำเร็จ", {
        description: getErrorMessage(mutationError),
        duration: 7000,
      }),
  });
  const startUploadBackupFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!/\.sqlite$/i.test(file.name)) {
      toast.error("รองรับเฉพาะไฟล์ .sqlite", {
        description: `ได้รับไฟล์ ${file.name} — เลือกไฟล์ welfare-store.sqlite ของระบบเท่านั้น`,
      });
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      toast.error("ไฟล์ใหญ่เกิน 200MB", {
        description:
          "ตรวจอีกครั้งว่าเลือกไฟล์ฐานข้อมูลของระบบร้านค้าสวัสดิการถูกตัว",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataBase64 = String(reader.result ?? "").split(",")[1] ?? "";
      if (!dataBase64) {
        toast.error("อ่านไฟล์ไม่สำเร็จ", {
          description: "ลองเลือกไฟล์ใหม่อีกครั้ง",
        });
        return;
      }
      uploadBackupMutation.mutate({ fileName: file.name, dataBase64 });
    };
    reader.readAsDataURL(file);
  };
  // ROUND 40 (ข้อ 32) — นำเข้าข้อมูลจาก Excel/CSV: พรีวิว → map คอลัมน์ → execute → ผลลัพธ์
  const [importKind, setImportKind] = useState<ImportKindId>("members");
  const [importFile, setImportFile] = useState<{
    name: string;
    base64: string;
  } | null>(null);
  const [importSheets, setImportSheets] = useState<ImportSheetLite[] | null>(
    null
  );
  const [importSheetIndex, setImportSheetIndex] = useState(0);
  const [importHeaderRow, setImportHeaderRow] = useState(0);
  const [importMapping, setImportMapping] = useState<Record<string, number>>(
    {}
  );
  const [duplicateMode, setDuplicateMode] = useState<"skip" | "replace">(
    "skip"
  );
  const [importResult, setImportResult] = useState<ImportResultLite | null>(
    null
  );
  const [importConfirm, setImportConfirm] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const currentSheet = importSheets?.[importSheetIndex] ?? null;
  const importFields =
    importKind === "members" ? MEMBER_IMPORT_FIELDS : PRODUCT_IMPORT_FIELDS;
  const applySheetPreview = (sheets: ImportSheetLite[], sheetIndex = 0) => {
    setImportSheets(sheets);
    const sheet = sheets[sheetIndex];
    setImportSheetIndex(sheetIndex);
    if (sheet) {
      setImportHeaderRow(sheet.headerRowIndex);
      setImportMapping({ ...sheet.suggestedMapping });
    }
  };
  const importPreviewMutation = trpc.importData.preview.useMutation({
    onSuccess: data => {
      applySheetPreview(data.sheets);
      setImportResult(null);
      const first = data.sheets[0];
      toast.success("อ่านไฟล์สำเร็จ", {
        description: `พบข้อมูล ${first ? first.totalRows.toLocaleString("th-TH") : 0} แถว ใน ${data.sheets.length} ชีต — ตรวจการจับคู่คอลัมน์ด้านล่างก่อนนำเข้า`,
      });
    },
    onError: mutationError => {
      setImportSheets(null);
      toast.error("อ่านไฟล์ไม่สำเร็จ", {
        description: getErrorMessage(mutationError),
        duration: 5000,
      });
    },
  });
  const importExecuteMutation = trpc.importData.execute.useMutation({
    onSuccess: async data => {
      setImportConfirm(false);
      setImportResult(data);
      if (data.errors.length === 0) {
        toast.success("นำเข้าข้อมูลเรียบร้อย", {
          description: `เพิ่มใหม่ ${data.inserted.toLocaleString("th-TH")} · อัปเดต ${data.updated.toLocaleString("th-TH")} · ข้าม ${data.skipped.toLocaleString("th-TH")} รายการ — สำรองไฟล์ป้องกันไว้ก่อนนำเข้าแล้ว`,
          duration: 6000,
        });
      } else {
        toast.warning("นำเข้าเสร็จแล้ว — มีบางแถวที่ผิดพลาด", {
          description: `สำเร็จ ${data.inserted + data.updated} · ข้าม ${data.skipped} · ผิดพลาด ${data.errors.length} แถว — ดูรายละเอียดที่ผลลัพธ์ด้านล่าง`,
          duration: 7000,
        });
      }
      await utils.invalidate();
    },
    onError: mutationError => {
      setImportConfirm(false);
      toast.error("นำเข้าข้อมูลไม่สำเร็จ", {
        description: getErrorMessage(mutationError),
        duration: 6000,
      });
    },
  });
  const importTemplateMutation = trpc.importData.template.useMutation({
    onSuccess: data => {
      try {
        const binary = atob(data.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1)
          bytes[index] = binary.charCodeAt(index);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(
          new Blob([bytes], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          })
        );
        link.download = data.fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 4000);
        toast.success("กำลังดาวน์โหลดเทมเพลต", {
          description: `${data.fileName} — เติมข้อมูลตามหัวคอลัมน์ แล้วกลับมาอัปโหลดที่นี่`,
        });
      } catch {
        toast.error("เปิดไฟล์เทมเพลตไม่สำเร็จ");
      }
    },
    onError: mutationError =>
      toast.error("ดาวน์โหลดเทมเพลตไม่สำเร็จ", {
        description: getErrorMessage(mutationError),
      }),
  });
  const startImportFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast.error("รองรับเฉพาะไฟล์ .xlsx .xls .csv", {
        description: `ได้รับไฟล์ ${file.name}`,
      });
      return;
    }
    if (file.size > 5_000_000) {
      toast.error("ไฟล์ใหญ่เกิน 5MB", {
        description: "แบ่งข้อมูลเป็นหลายไฟล์ แล้วนำเข้าทีละไฟล์",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result ?? "").split(",")[1] ?? "";
      if (!base64) {
        toast.error("อ่านไฟล์ไม่สำเร็จ", {
          description: "ลองเลือกไฟล์ใหม่อีกครั้ง",
        });
        return;
      }
      setImportFile({ name: file.name, base64 });
      importPreviewMutation.mutate({
        kind: importKind,
        fileName: file.name,
        base64,
      });
    };
    reader.readAsDataURL(file);
  };
  const changeImportKind = (kind: ImportKindId) => {
    if (kind === importKind) return;
    setImportKind(kind);
    setImportResult(null);
    if (importFile)
      importPreviewMutation.mutate({
        kind,
        fileName: importFile.name,
        base64: importFile.base64,
      });
  };
  const changeImportSheet = (index: number) => {
    if (!importSheets) return;
    applySheetPreview(importSheets, index);
  };
  const changeImportHeaderRow = (row: number) => {
    setImportHeaderRow(row);
    if (importFile)
      importPreviewMutation.mutate({
        kind: importKind,
        fileName: importFile.name,
        base64: importFile.base64,
        headerRowOverride: row,
      });
  };
  const setMappingField = (field: string, column: number) => {
    setImportMapping(current => {
      const next = { ...current };
      if (column < 0) delete next[field];
      else next[field] = column;
      // คอลัมน์หนึ่งใช้กับ field เดียว — ย้ายออกจาก field อื่นที่ชนกัน
      for (const key of Object.keys(next)) {
        if (key !== field && next[key] === column) delete next[key];
      }
      return next;
    });
  };
  const runImport = () => {
    if (!importFile || !currentSheet) return;
    const memberMappingPayload = {
      firstName: importMapping.firstName ?? -1,
      memberNumber: importMapping.memberNumber ?? -1,
      lastName: importMapping.lastName ?? -1,
      balance: importMapping.balance ?? -1,
      creditLimit: importMapping.creditLimit ?? -1,
      status: importMapping.status ?? -1,
      phone: importMapping.phone ?? -1,
      idCard: importMapping.idCard ?? -1,
      type: importMapping.type ?? -1,
      gender: importMapping.gender ?? -1,
    };
    const productMappingPayload = {
      name: importMapping.name ?? -1,
      barcode: importMapping.barcode ?? -1,
      sku: importMapping.sku ?? -1,
      category: importMapping.category ?? -1,
      unit: importMapping.unit ?? -1,
      price: importMapping.price ?? -1,
      cost: importMapping.cost ?? -1,
      stock: importMapping.stock ?? -1,
      reorderPoint: importMapping.reorderPoint ?? -1,
      size: importMapping.size ?? -1,
    };
    importExecuteMutation.mutate({
      kind: importKind,
      fileName: importFile.name,
      base64: importFile.base64,
      sheetName: currentSheet.name,
      headerRowIndex: importHeaderRow,
      duplicateMode,
      ...(importKind === "members"
        ? { memberMapping: memberMappingPayload }
        : { productMapping: productMappingPayload }),
    });
  };
  const resetImportFlow = () => {
    setImportFile(null);
    setImportSheets(null);
    setImportSheetIndex(0);
    setImportHeaderRow(0);
    setImportMapping({});
    setImportResult(null);
  };
  useEffect(() => {
    if (settingsQuery.data && !hydrated) {
      setForm(settingsQuery.data);
      setThresholdText(String(settingsQuery.data.lowBalanceThreshold));
      setHydrated(true);
    }
  }, [settingsQuery.data, hydrated]);
  const numberMode = form?.memberNumberMode ?? "running";
  const automaticMemberNumbers = numberMode !== "manual";
  // The UI presents one automatic mode. The saved backend mode remains
  // running/year and is derived from whether the selected format includes a year.
  const memberModeIndex = automaticMemberNumbers ? 0 : 1;
  const memberYearMode = numberMode === "running"
    ? "none"
    : form?.memberNumberYearMode === "gregorian"
      ? "gregorian"
      : "buddhist";
  const numberFormat = form
    ? {
        prefix: form.memberNumberPrefix,
        yearMode: form.memberNumberYearMode,
        yearDigits: form.memberNumberYearDigits,
        resetMonth: form.memberNumberResetMonth,
        sequenceDigits: form.memberNumberSequenceDigits,
        separator: form.memberNumberSeparator,
      }
    : undefined;
  const nextNumber = formatMemberNumber(
    numberMode,
    nextMemberSequence(membersQuery.data ?? [], numberMode, numberFormat),
    numberFormat
  );
  // Round 17 — dirty-state tracking: compare the working form against the
  // server settings field by field so the sticky save bar can tell the
  // user exactly what has changed and is still unsaved (the old UI only
  // had a far-away save button in the header, which read as "settings
  // don't work" when toggles were flipped and never saved).
  const serverSettings = settingsQuery.data ?? null;
  // ROUND 75 (user) — เมนูลัดหน้าร้าน: ชุดปุ่มที่ถูกปิด (จาก form ที่ยังไม่บันทึกก็เห็นสด ๆ)
  const railHiddenFormSet = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(form?.posRailHidden || "[]");
      return new Set<string>(
        Array.isArray(parsed)
          ? parsed.filter((item): item is string => typeof item === "string")
          : []
      );
    } catch {
      return new Set<string>();
    }
  }, [form?.posRailHidden]);
  const toggleRailButton = (key: string) => {
    if (!form) return;
    const next = new Set<string>(railHiddenFormSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    updateForm({ posRailHidden: JSON.stringify(Array.from(next)) });
  };
  const shortcutKeyMap = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(form?.posShortcutKeys || "{}");
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }, [form?.posShortcutKeys]);
  const updateShortcutKey = (action: string, value: string) => {
    const next = { ...shortcutKeyMap, [action]: value.trim().toUpperCase() };
    updateForm({ posShortcutKeys: JSON.stringify(next) });
  };
  const captureShortcutKey = (
    action: string,
    event: ReactKeyboardEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    if (
      event.key === "Escape" ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    )
      return;
    const key =
      event.key.length === 1
        ? event.key.toUpperCase()
        : event.key.toUpperCase();
    const allowed =
      /^F(?:[1-9]|1[0-2])$/.test(key) ||
      key === "HOME" ||
      /^[A-Z0-9]$/.test(key);
    if (allowed) updateShortcutKey(action, key);
  };
  const dirtyKeys = useMemo(() => {
    if (!form || !serverSettings) return [] as string[];
    return SETTINGS_FIELD_LABELS.filter(
      ([key]) => form[key] !== serverSettings[key]
    ).map(([, label]) => label);
  }, [form, serverSettings]);
  const dirtyCount = dirtyKeys.length;
  const discardChanges = () => {
    if (!serverSettings) return;
    setForm(serverSettings);
    setThresholdText(String(serverSettings.lowBalanceThreshold));
    applyThemeColor(serverSettings.appTheme); // ยกเลิกพรีวิวสีที่ยังไม่ได้บันทึก
    applyUiStyle(serverSettings.appStyle); // ROUND 38 — ยกเลิกพรีวิวสไตล์ด้วย
    applyPaperWidth(serverSettings.receiptPaperWidth); // ROUND 42 — ยกเลิกพรีวิวขนาดกระดาษด้วย
  };
  const saveMutation = trpc.settings.set.useMutation({
    onSuccess: () => {
      setSaved(false);
      setError("");
      toast.success("บันทึกการตั้งค่าแล้ว");
      void utils.settings.get.invalidate();
    },
    onError: mutationError => {
      const message = getErrorMessage(mutationError);
      setError(message);
      toast.error("บันทึกไม่สำเร็จ", { description: message, duration: Infinity });
    },
  });
  const updateForm = (patch: Partial<SettingsForm>) =>
    setForm(current => (current ? { ...current, ...patch } : current));
  // ROUND 42 — พรีวิวขนาดกระดาษสลิปแบบสด: เลือกแล้วลอง “พิมพ์ทดสอบ” ได้เลยก่อนบันทึก
  const paperWidth = resolvePaperWidth(form?.receiptPaperWidth);
  useEffect(() => {
    applyPaperWidth(form?.receiptPaperWidth);
  }, [form?.receiptPaperWidth]);
  const saveSettings = () => {
    if (!form) return;
    setSaved(false);
    saveMutation.mutate({ ...form, appStyle: "shop" });
  };
  const savePromptPay = () => {
    if (!form) return;
    const promptpayId = promptPayDraft.trim();
    if (promptpayId && !isValidPromptPayId(promptpayId)) {
      toast.error("เลขพร้อมเพย์ไม่ถูกต้อง", { description: "ใช้เบอร์โทร 9–10 หลัก หรือเลขประจำตัวประชาชน 13 หลัก" });
      return;
    }
    saveMutation.mutate(
      { promptpayId },
      {
        onSuccess: () => {
          updateForm({ promptpayId });
          setPromptPayEditing(false);
        },
      }
    );
  };
  const startEditPromptPay = () => {
    setPromptPayDraft(form?.promptpayId ?? "");
    setPromptPayEditing(true);
  };
  const cancelEditPromptPay = () => {
    setPromptPayDraft(form?.promptpayId ?? "");
    setPromptPayEditing(false);
  };
  const copyPromptPay = async () => {
    const promptpayId = form?.promptpayId.trim() ?? "";
    if (!promptpayId) {
      toast.error("ยังไม่มีเลขพร้อมเพย์ให้คัดลอก");
      return;
    }
    try {
      await navigator.clipboard.writeText(promptpayId);
      toast.success("คัดลอกเลขพร้อมเพย์แล้ว", { duration: 2200 });
    } catch {
      toast.error("คัดลอกไม่สำเร็จ", { description: promptpayId, duration: 4000 });
    }
  };
  const togglePromptPay = () => {
    if (!form) return;
    const promptpayActive = !form.promptpayActive;
    updateForm({ promptpayActive });
    saveMutation.mutate({ promptpayActive });
  };
  const chooseFontScale = (id: FontScaleId) => {
    setFontScale(id);
    applyFontScale(id);
  };
  // ROUND 36 — เปิด Dev Access ต้องยืนยันก่อน (ความปลอดภัยสูง) · ปิดได้ทันที
  const toggleDevAccess = () => {
    if (!form) return;
    if (!form.devAccess) setDevAccessConfirm(true);
    else updateForm({ devAccess: false });
  };
  // ROUND 56 — เช็คลิสต์วันขึ้นระบบ (โซนเครื่องมือติดตั้ง): ติ๊ก/ยกเลิกแล้วบันทึงทันที
  // (บันทึงเฉพาะฟิลด์นี้ — ไม่ยุ่งกับการตั้งค่าอื่นที่ยังแก้ค้างไว้ในฟอร์ม)
  const goliveCheckedIds = parseGoliveChecks(form?.goliveChecks);
  const goliveDone = goliveCheckedIds.filter(id =>
    GO_LIVE_CHECKLIST.some(item => item.id === id)
  ).length;
  const toggleGoliveCheck = (id: string) => {
    if (!form) return;
    const next = goliveCheckedIds.includes(id)
      ? goliveCheckedIds.filter(item => item !== id)
      : [...goliveCheckedIds, id];
    const serialized = JSON.stringify(next);
    updateForm({ goliveChecks: serialized });
    saveMutation.mutate({ goliveChecks: serialized });
  };
  const resetGoliveChecks = () => {
    if (!form) return;
    updateForm({ goliveChecks: "" });
    saveMutation.mutate({ goliveChecks: "" });
    toast.info("ล้างเช็คลิสต์แล้ว", {
      description: "เริ่มติ๊กรายการใหม่สำหรับรอบขึ้นระบบถัดไป",
      duration: 3000,
    });
  };
  // ROUND 25 — แบรนด์และธีม: พรีวิวสี/ชื่อ/โลโก้สดก่อนบันทึก
  const logoInputRef = useRef<HTMLInputElement>(null);
  const onLogoPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) {
      setError("รองรับเฉพาะไฟล์รูป PNG JPG WEBP SVG");
      return;
    }
    if (file.size > 2_000_000) {
      setError("ไฟล์โลโก้ใหญ่เกิน 2MB — เลือกไฟล์เล็กลง");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (!dataUrl) {
        setError("อ่านไฟล์โลโก้ไม่สำเร็จ");
        return;
      }
      if (file.type === "image/svg+xml") {
        updateForm({ appLogo: dataUrl });
        setError("");
        return;
      } // SVG เก็บต้นฉบับได้ ขนาดเล็กอยู่แล้ว
      shrinkLogoToDataUrl(dataUrl)
        .then(shrunk => {
          updateForm({ appLogo: shrunk });
          setError("");
        })
        .catch(() => {
          updateForm({ appLogo: dataUrl });
          setError("");
        });
    };
    reader.readAsDataURL(file);
  };
  const onBackgroundPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 2_000_000) {
      setError("เลือกภาพ PNG JPG WEBP ขนาดไม่เกิน 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError("อ่านภาพพื้นหลังไม่สำเร็จ");
    reader.onload = async () => {
      try {
        const image = await shrinkLogoToDataUrl(String(reader.result), 1600);
        if (image.length > 1_500_000) throw new Error("ภาพหลังย่อยังใหญ่เกินไป กรุณาเลือกรูปขนาดเล็กลง");
        updateForm({ appBackground: image });
        applyBackground(image);
        setError("");
      } catch (error) {
        setError(getErrorMessage(error));
      }
    };
    reader.readAsDataURL(file);
  };
  // ROUND 56 (user) — แยกสิทธิ์เมนูตั้งค่า: แท็บร้านค้า (ผู้บริหาร+ผู้พัฒนา) กับแท็บโซนระบบ
  // (เครื่องมือติดตั้ง/สำรอง/เชื่อมต่อ) ที่สงวนไว้สำหรับบัญชีผู้พัฒนาเท่านั้น
  // ROUND 61 — เพิ่มแท็บ “เวอร์ชันและลิขสิทธิ์” + ย้าย “นำเข้าข้อมูล” มากลุ่มร้านค้า (เวอร์ชันโปรขึ้นไป + dev เห็นเสมอ)
  // ROUND 62 (user) — จัดระเบียบหน้าตั้งค่าใหม่: แบ่งเป็น 3 หมวดตามการใช้งานจริง
  //   หมวด 1 การขายหน้าร้าน — ตั้งค่าที่เกี่ยวกับการขาย/เงิน (ใช้บ่อยที่สุด อยู่บนสุด)
  //   หมวด 2 ร้านค้าและหน้าจอ — แต่งหน้าตา + อุปกรณ์ต่อเครื่อง
  //   หมวด 3 ระบบและความปลอดภัย — สิทธิ์ + Log (r62 รวม "การบันทึก Log" เข้าแท็บสิทธิ์) + นำเข้า + เวอร์ชัน
  //   โซนผู้พัฒนาแยกท้ายสุด (dev เท่านั้น — เดิมจาก r56)
  // ย้ายหัวข้อที่เคยอยู่ผิดที่: การ์ด "ติดตั้งบน Windows 11" จากแท็บใบเสร็จ → แท็บอุปกรณ์และหน้าจอ
  const storeTabGroups: {
    label: string;
    icon: typeof Bell;
    tabs: { id: SettingsTab; label: string; icon: typeof Bell }[];
  }[] = [
    {
      label: "การขายหน้าร้าน",
      icon: ShoppingCart,
      tabs: [
        { id: "receipt", label: "ใบเสร็จและเครื่องพิมพ์", icon: ReceiptText },
        { id: "payment", label: "การชำระเงิน", icon: WalletCards },
        { id: "posmenu", label: "เมนูลัดหน้าร้าน", icon: LayoutDashboard },
        { id: "member", label: "เลขสมาชิก", icon: CreditCard },
        { id: "cutoff", label: "รอบตัดยอด", icon: CalendarClock },
        { id: "alert", label: "การแจ้งเตือน", icon: Bell },
      ],
    },
    {
      label: "ร้านค้าและหน้าจอ",
      icon: Palette,
      tabs: [
        { id: "brand", label: "แบรนด์และธีม", icon: Palette },
        { id: "display", label: "อุปกรณ์และหน้าจอ", icon: Monitor },
      ],
    },
    {
      label: "ระบบและความปลอดภัย",
      icon: ShieldCheck,
      tabs: [
        { id: "roles", label: "สิทธิ์และความปลอดภัย", icon: ShieldCheck },
        ...(canImportExport || isDevRole
          ? [
              {
                id: "import" as SettingsTab,
                label: "นำเข้าข้อมูล",
                icon: FileSpreadsheet,
              },
            ]
          : []),
        ...(isAdminRole
          ? [
              {
                id: "backup" as SettingsTab,
                label: "สำรองข้อมูล",
                icon: DatabaseBackup,
              },
            ]
          : []),
        { id: "edition", label: "เวอร์ชันและลิขสิทธิ์", icon: Crown },
      ],
    },
  ];
  const devTabs: { id: SettingsTab; label: string; icon: typeof Bell }[] = [
    { id: "install", label: "เครื่องมือติดตั้ง", icon: Wrench },
    { id: "network", label: "การเชื่อมต่อ", icon: Network },
  ];
  // ROUND 69 (user) — ยกระดับ 4 หมวดหลักของหน้าตั้งค่าขึ้นเป็นแถวหัวข้อใหญ่ด้านบน
  // เดิม (r62) ชื่อหมวดเป็นข้อความจาง 9.5px แทรกระหว่างปุ่มแท็บในแถบเดียวกัน และถูก
  // display:none ทั้งหมดในจอแคบกว่า 820px — ผู้ใช้จึงมองไม่เห็นว่าหน้าตั้งค่ามี "หัวข้อหลัก"
  // อะไรบ้าง (การขายหน้าร้าน · ร้านค้าและหน้าจอ · ระบบและความปลอดภัย · โซนผู้พัฒนา)
  // แก้โดยแยกเป็นสองชั้น: แถวการ์ดหมวดด้านบน (กดเลือกหมวด) + แท็บย่อยของหมวดนั้นแถวถัดลงมา
  // หมวดปัจจุบัน "อนุมาน" จากแท็บที่เปิดอยู่ — setTab จากจุดอื่น (ป้ายเวอร์ชันที่ sidebar,
  // ปุ่มในการ์ดเครื่องมือติดตั้ง) ยังเดินทางมาถึงหมวดที่ถูกต้องโดยอัตโนมัติ ไม่ต้องซิงก์สอง state
  const settingsCategories: {
    label: string;
    icon: typeof Bell;
    dev?: boolean;
    tabs: { id: SettingsTab; label: string; icon: typeof Bell }[];
  }[] = [
    ...storeTabGroups,
    ...(isDevRole
      ? [
          {
            label: "โซนผู้พัฒนา · ติดตั้งระบบ",
            icon: Wrench,
            dev: true,
            tabs: devTabs,
          },
        ]
      : []),
  ];
  const activeCategoryIndex = Math.max(
    0,
    settingsCategories.findIndex(group =>
      group.tabs.some(item => item.id === tab)
    )
  );
  const activeCategory = settingsCategories[activeCategoryIndex];
  const [settingsSearch, setSettingsSearch] = useState("");
  const matchingSettings = settingsCategories.flatMap(group => group.tabs)
    .filter(item => item.label.toLowerCase().includes(settingsSearch.trim().toLowerCase()));
  const logs = logsStatsQuery.data ?? [];
  const lastLog = logs[0];
  // Round 31-7 — ทดสอบเครื่องพิมพ์: เปิดพรีวิวสลิปตัวอย่างก่อน (ROUND 51 — เหมือนจุดพิมพ์อื่น) แล้วค่อยสั่งพิมพ์
  const [printerTestOpen, setPrinterTestOpen] = useState(false);
  const [printerPreviewOpen, setPrinterPreviewOpen] = useState(false);
  const testPrintReceipt = () => {
    setPrinterTestOpen(true);
    setPrinterPreviewOpen(true);
  };
  // Round 31 — รอบตัดยอด: live view of the CURRENT business period so the admin
  // sees what the cut-off setting actually does before saving it.
  const periodQuery = trpc.reports.businessPeriod.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const period = periodQuery.data;
  return (
    <>
      <SectionHeader
        eyebrow="ระบบและการกำหนดค่า"
        title="ตั้งค่า"
        description=""
        action={
          <button
            className="primary-button"
            disabled={!form || saveMutation.isPending}
            onClick={saveSettings}
          >
            <Check size={16} />{" "}
            {saveMutation.isPending
              ? "กำลังบันทึก…"
              : dirtyCount > 0
                ? `บันทึกการตั้งค่า · ${dirtyCount} รายการ`
                : "บันทึกการตั้งค่า"}
          </button>
        }
      />
      <div className="settings-layout">
        <SharedSearch label="ตั้งค่า · ค้นหาเมนู">
          <div className="settings-search-wrap">
            <div className="search-field">
              <input value={settingsSearch} onChange={event => setSettingsSearch(event.target.value)}
                placeholder="ค้นหาเมนูตั้งค่า" aria-label="ค้นหาเมนูตั้งค่า" autoComplete="off" />
            </div>
            {settingsSearch.trim() && <div className="member-scan-list">
              {matchingSettings.length === 0 ? <div className="command-empty">ไม่พบเมนูตั้งค่า</div> : matchingSettings.map(item =>
                <button type="button" className="member-option" key={item.id} onClick={() => { setTab(item.id); setSettingsSearch(""); }}>
                  {item.label}
                </button>)}
            </div>}
          </div>
        </SharedSearch>
        <div
          className="settings-cat-row"
          role="group"
          aria-label="หมวดหลักของการตั้งค่า"
        >
          {settingsCategories.map((group, index) => {
            const CatIcon = group.icon;
            return (
              <button
                key={group.label}
                type="button"
                className={`settings-cat${group.dev ? " dev-zone" : ""}${index === activeCategoryIndex ? " active" : ""}`}
                aria-pressed={index === activeCategoryIndex}
                onClick={() => setTab(group.tabs[0].id)}
                title={group.label}
              >
                <span className="cat-ico" aria-hidden="true">
                  <CatIcon size={17} />
                </span>
                <span className="cat-text">
                  <b>{group.label}</b>
                  <small>{group.tabs.length} แท็บ</small>
                </span>
              </button>
            );
          })}
        </div>
        <div
          className="settings-nav"
          role="tablist"
          aria-label={`แท็บย่อยของหมวด${activeCategory.label}`}
        >
          {activeCategory.tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={17} /> {label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          {tab === "install" && isDevRole && (
            <>
              <section className="panel settings-card install-hero">
                <div className="settings-heading">
                  <div>
                    <h2>เครื่องมือติดตั้งระบบ</h2>
                    <p>
                      รวมทุกอย่างที่ช่างต้องใช้ในวันขึ้นระบบที่หน้างาน —
                      ข้อมูลเครื่อง ตรวจรับข้อมูลลูกค้า ทดสอบเครื่องพิมพ์
                      และเช็คลิสต์ส่งมอบ
                    </p>
                  </div>
                  <Wrench size={20} className="muted-icon" />
                </div>
                <div className="install-chip-row">
                  <span className="install-chip">
                    <HardDriveDownload size={13} /> ฐานข้อมูล{" "}
                    {formatFileSize(installOverview?.dbSizeBytes ?? 0)}
                  </span>
                  <span className="install-chip">
                    <Activity size={13} /> เปิดมาแล้ว{" "}
                    {uptimeLabel(lanInfo?.uptimeSeconds ?? 0)}
                  </span>
                  <span className="install-chip">
                    <Wifi size={13} /> พอร์ต {lanInfo?.port ?? "—"}
                  </span>
                  <span className="install-chip dev">
                    โซนผู้พัฒนา — มองเห็นเฉพาะบัญชี dev
                  </span>
                </div>
              </section>
              <div className="install-grid">
                <section className="panel settings-card">
                  <div className="settings-heading">
                    <div>
                      <h2>เครื่องเซิร์ฟเวอร์และ URL ของร้าน</h2>
                      <p>
                        URL ที่เครื่องอื่นในวงแลนใช้เข้าระบบ —
                        กดคัดลอกแล้วส่งให้ทุกจุดขาย
                      </p>
                    </div>
                    <Terminal size={20} className="muted-icon" />
                  </div>
                  <div className="install-info-rows">
                    <div>
                      <span>ชื่อเครื่อง</span>
                      <b>{lanInfo?.hostname ?? "…"}</b>
                    </div>
                    <div>
                      <span>ระบบปฏิบัติการ</span>
                      <b>{lanInfo?.platform ?? "…"}</b>
                    </div>
                    <div>
                      <span>หน่วยความจำ</span>
                      <b>
                        {lanInfo
                          ? `${lanInfo.totalMemoryMb.toLocaleString("th-TH")} MB`
                          : "…"}
                      </b>
                    </div>
                    <div>
                      <span>เวลาที่เปิดมาแล้ว</span>
                      <b>
                        {lanInfo ? uptimeLabel(lanInfo.uptimeSeconds) : "…"}
                      </b>
                    </div>
                  </div>
                  <div className="install-lan-urls">
                    {(lanInfo?.addresses ?? []).length > 0 ? (
                      lanInfo!.addresses.map(address => (
                        <button
                          key={address}
                          type="button"
                          className="install-url-row"
                          onClick={() =>
                            copyLanUrl(
                              `${lanInfo!.https ? "https" : "http"}://${address}:${lanInfo!.port}`
                            )
                          }
                          title="กดเพื่อคัดลอก URL นี้"
                        >
                          <Globe size={14} />
                          <b>
                            {lanInfo!.https ? "https" : "http"}://{address}:
                            {lanInfo!.port}
                          </b>
                          <Copy size={13} />
                        </button>
                      ))
                    ) : (
                      <div className="install-url-empty">
                        <Wifi size={15} /> ไม่พบไอพีวงแลน —
                        เครื่องอาจออฟไลน์อยู่ หรือเข้าผ่าน localhost
                      </div>
                    )}
                  </div>
                </section>
                <section className="panel settings-card">
                  <div className="settings-heading">
                    <div>
                      <h2>ตรวจรับข้อมูลก่อนส่งมอบ</h2>
                      <p>
                        ตัวเลขปัจจุบันในระบบ —
                        เทียบกับข้อมูลลูกค้าที่เตรียมมาวันนี้
                      </p>
                    </div>
                    <ShieldCheck size={20} className="muted-icon" />
                  </div>
                  <div className="install-stat-grid">
                    <div>
                      <span>บัญชีผู้ใช้</span>
                      <b>
                        {installOverview
                          ? `${installOverview.users.active}/${installOverview.users.total} ใช้งาน`
                          : "…"}
                      </b>
                      <small>
                        บัญชี dev {installOverview?.users.devAccounts ?? "…"}{" "}
                        รายการ
                      </small>
                    </div>
                    <div>
                      <span>สมาชิก</span>
                      <b>
                        {installOverview
                          ? `${installOverview.members.active.toLocaleString("th-TH")}/${installOverview.members.total.toLocaleString("th-TH")}`
                          : "…"}
                      </b>
                      <small>
                        เงินในบัญชีรวม{" "}
                        {money(installOverview?.members.walletTotal ?? 0)}
                      </small>
                    </div>
                    <div>
                      <span>สินค้า</span>
                      <b>
                        {installOverview
                          ? `${installOverview.products.active}/${installOverview.products.total}`
                          : "…"}
                      </b>
                      <small>
                        ถึงจุดสั่งซื้อ{" "}
                        {installOverview?.products.lowStock ?? "…"} รายการ
                      </small>
                    </div>
                    <div>
                      <span>บิลวันนี้</span>
                      <b>{installOverview?.sales.todayBills ?? "…"} บิล</b>
                      <small>
                        ยอดขาย {money(installOverview?.sales.todayRevenue ?? 0)}
                      </small>
                    </div>
                  </div>
                  {(installOverview?.products.zeroPrice ?? 0) > 0 && (
                    <div className="notice-bar error install-warn">
                      <CircleAlert size={15} /> มีสินค้า{" "}
                      {installOverview!.products.zeroPrice}{" "}
                      รายการที่ยังไม่ได้ตั้งราคา (฿0) —
                      ตั้งราคาให้ครบก่อนวันขึ้นระบบ ที่หน้าสต็อกสินค้า
                    </div>
                  )}
                  <div className="install-action-row">
                    <button
                      type="button"
                      className="outline-button compact"
                      onClick={() => setTab("import")}
                    >
                      <FileSpreadsheet size={14} /> นำเข้าสมาชิก/สินค้า
                    </button>
                    <button
                      type="button"
                      className="outline-button compact"
                      onClick={() => setView("users")}
                    >
                      <UserCog size={14} /> จัดบัญชีผู้ใช้
                    </button>
                  </div>
                </section>
                <section className="panel settings-card">
                  <div className="settings-heading">
                    <div>
                      <h2>ทดสอบเครื่องพิมพ์สลิป</h2>
                      <p>
                        พิมพ์สลิปทดสอบที่เครื่องจริง — ตรวจว่าไทยอ่านชัด
                        ครบทุกบรรทัด ขนาดกระดาษตรง
                      </p>
                    </div>
                    <Printer size={20} className="muted-icon" />
                  </div>
                  <div className="install-action-row">
                    <span className="install-chip">
                      กระดาษ {paperWidth} มม. — เปลี่ยนได้ที่แท็บใบเสร็จ
                    </span>
                    <button
                      type="button"
                      className="primary-button compact"
                      onClick={testPrintReceipt}
                    >
                      <Printer size={15} /> พิมพ์สลิปทดสอบ
                    </button>
                  </div>
                </section>
                <section className="panel settings-card">
                  <div className="settings-heading">
                    <div>
                      <h2>สำรองข้อมูลก่อนส่งมอบ</h2>
                      <p>
                        สำรองตัวเลขไว้ก่อนวันขึ้นระบบเสมอ —
                        และดาวน์โหลดเก็บนอกเครื่อง
                      </p>
                    </div>
                    <DatabaseBackup size={20} className="muted-icon" />
                  </div>
                  {lastBackupFile ? (
                    <div className="install-last-backup">
                      <Check size={14} /> ล่าสุด: <b>{lastBackupFile.file}</b> ·{" "}
                      {formatFileSize(lastBackupFile.sizeBytes)} ·{" "}
                      {formatLogDateTime(lastBackupFile.createdAt)}
                    </div>
                  ) : (
                    <div className="install-last-backup none">
                      <CircleAlert size={14} /> ยังไม่มีไฟล์สำรองเลย —
                      สร้างไฟล์แรกก่อนส่งมอบ
                    </div>
                  )}
                  <div className="install-action-row">
                    <button
                      type="button"
                      className="primary-button compact"
                      disabled={createBackupMutation.isPending}
                      onClick={() => createBackupMutation.mutate()}
                    >
                      <DatabaseBackup size={15} />{" "}
                      {createBackupMutation.isPending
                        ? "กำลังสำรอง…"
                        : "สำรองข้อมูลเดี๋ยวนี้"}
                    </button>
                    <button
                      type="button"
                      className="outline-button compact"
                      onClick={() => setTab("backup")}
                    >
                      ดูไฟล์สำรองทั้งหมด
                    </button>
                  </div>
                </section>
              </div>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>เช็คลิสต์วันขึ้นระบบ</h2>
                    <p>
                      ติ๊กทำเสร็จทีละข้อ — บันทึกไว้กลางระบบ
                      ทีมงานเห็นตรงกันทุกเครื่อง ·
                      บางข้อระบบตรวจให้อัตโนมัติจากตัวเลขจริง
                    </p>
                  </div>
                  <ListChecks size={20} className="muted-icon" />
                </div>
                <div className="golive-progress">
                  <div className="golive-progress-bar">
                    <i
                      style={{
                        width: `${Math.round((goliveDone / GO_LIVE_CHECKLIST.length) * 100)}%`,
                      }}
                    />
                  </div>
                  <b>
                    {goliveDone}/{GO_LIVE_CHECKLIST.length} ข้อ
                  </b>
                </div>
                <div className="golive-list">
                  {GO_LIVE_CHECKLIST.map(item => {
                    const checked = goliveCheckedIds.includes(item.id);
                    const autoPass =
                      item.auto && installOverview
                        ? item.auto(installOverview)
                        : null;
                    return (
                      <label
                        key={item.id}
                        className={`golive-item${checked ? " checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleGoliveCheck(item.id)}
                          aria-label={item.label}
                        />
                        <span className="golive-item-body">
                          <b>{item.label}</b>
                          <small>{item.hint}</small>
                        </span>
                        {autoPass != null && (
                          <span
                            className={`golive-auto ${autoPass ? "pass" : "warn"}`}
                          >
                            <ShieldCheck size={12} />{" "}
                            {autoPass ? "ตรวจแล้ว" : "ยังไม่ครบ"}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <div className="install-action-row">
                  <button
                    type="button"
                    className="danger-outline-button compact"
                    onClick={resetGoliveChecks}
                    disabled={!form || saveMutation.isPending}
                  >
                    <RotateCcw size={14} /> ล้างเช็คลิสต์ (เริ่มรอบใหม่)
                  </button>
                </div>
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>ส่งมอบและปิดงาน</h2>
                    <p>
                      ทำตามลำดับนี้ก่อนจากหน้างาน —
                      แล้วร้านใช้งานต่อได้เองโดยไม่ต้องมีช่างอยู่
                    </p>
                  </div>
                  <LogOut size={20} className="muted-icon" />
                </div>
                <div className="install-handover-steps">
                  <div className="install-handover-step">
                    <b>1</b>
                    <div>
                      <b>ให้ผู้บริหารเปลี่ยนรหัสผ่านของตัวเอง</b>
                      <small>
                        เมนูผู้ใช้ระบบ → แก้ไข → เปลี่ยนรหัสผ่าน —
                        ช่างไม่ควรรู้รหัสของลูกค้า
                      </small>
                    </div>
                  </div>
                  <div className="install-handover-step">
                    <b>2</b>
                    <div>
                      <b>ปิดประตูผู้พัฒนา (Dev Access)</b>
                      <small>
                        ปัจจุบัน
                        {form?.devAccess
                          ? "เปิดอยู่ — ปิดที่แท็บสิทธิ์และความปลอดภัยก่อนจาก"
                          : "ปิดอยู่แล้ว"}{" "}
                        · บัญชี dev จะเข้าไม่ได้จนกว่าร้านจะเปิดใหม่
                        (โทรติดต่อช่าง)
                      </small>
                    </div>
                  </div>
                  <div className="install-handover-step">
                    <b>3</b>
                    <div>
                      <b>สรุปวิธีใช้หลักให้ทีมร้าน</b>
                      <small>
                        ขายหน้าร้าน · เติม/ถอนเงิน (F2/F3) · ลงทะเบียนสมาชิก
                        (F6) · ดูรายงานประจำวัน · สำรองข้อมูลเป็นระยะ
                      </small>
                    </div>
                  </div>
                </div>
                <div className="install-action-row">
                  <button
                    type="button"
                    className="outline-button compact"
                    onClick={() => setTab("roles")}
                  >
                    <ShieldCheck size={14} /> ไปแท็บสิทธิ์และความปลอดภัย
                  </button>
                  <button
                    type="button"
                    className="outline-button compact"
                    onClick={() => setView("users")}
                  >
                    <UserCog size={14} /> ไปเมนูผู้ใช้ระบบ
                  </button>
                </div>
              </section>
            </>
          )}
          {tab === "brand" && (
            <>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>ชื่อร้านและโลโก้</h2>
                    <p>
                      ชื่อและโลโก้จะแสดงบนหน้าจอ แถบเมนู หน้าเข้าสู่ระบบ
                      และหัวใบเสร็จ
                    </p>
                  </div>
                  <Palette size={20} className="muted-icon" />
                </div>
                <div className="form-grid">
                  <label className="wide">
                    ชื่อแอป / ร้านค้า
                    <input
                      value={form?.appName ?? ""}
                      onChange={event =>
                        updateForm({ appName: event.target.value })
                      }
                      placeholder="เช่น ร้านค้าสวัสดิการ"
                      disabled={!form}
                      maxLength={80}
                    />
                  </label>
                  <label className="wide">
                    โลโก้ร้านค้า
                    <div className="logo-uploader">
                      {form?.appLogo ? (
                        <img
                          className="logo-preview"
                          src={form.appLogo}
                          alt="โลโก้ปัจจุบัน"
                        />
                      ) : (
                        <span className="logo-empty">
                          <ImageIcon size={20} />
                        </span>
                      )}
                      <div className="logo-actions">
                        <div className="logo-button-row">
                          <button
                            type="button"
                            className="outline-button compact"
                            disabled={!form}
                            onClick={() => logoInputRef.current?.click()}
                          >
                            <ImagePlus size={15} />{" "}
                            {form?.appLogo ? "เปลี่ยนรูป" : "เลือกรูปโลโก้"}
                          </button>
                          {form?.appLogo && (
                            <button
                              type="button"
                              className="danger-outline-button compact"
                              disabled={!form}
                              onClick={() => updateForm({ appLogo: "" })}
                            >
                              <Trash2 size={15} /> ลบโลโก้
                            </button>
                          )}
                        </div>
                        <small>
                          รองรับ PNG JPG WEBP SVG · ระบบย่อเป็น 256px อัตโนมัติ
                          · ไม่ใส่ก็ได้ จะใช้อักษรย่อแทน
                        </small>
                      </div>
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        hidden
                        onChange={onLogoPick}
                      />
                    </div>
                  </label>
                  <label className="wide">
                    เบอรโทรศูนย์ช่วยเหลือร้าน (021234567 หรือ 0812345678)
                    <input
                      value={form?.helpPhone ?? ""}
                      onChange={event =>
                        updateForm({ helpPhone: event.target.value })
                      }
                      placeholder="เช่น 023456789 หรือ 0812345678 — ใส่แล้วจะขึ้นท้ายหน้าจอทุกหน้า"
                      disabled={!form}
                      maxLength={32}
                      inputMode="tel"
                      title="เบอรติดต่อภายในร้าน แสดงที่แถบล่างของทุกหน้าจอ — ไม่กรอกจะไม่แสดง"
                    />
                  </label>
                </div>
                <div className="background-settings">
                  <label>ภาพพื้นหลังพื้นที่ทำงาน
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onBackgroundPick} disabled={!form} />
                  </label>
                  <p>PNG JPG WEBP ไม่เกิน 2MB · แสดงหลังการ์ดเท่านั้น ไม่ติดเอกสารพิมพ์ · กดบันทึกเพื่อใช้ครั้งถัดไป</p>
                  {form?.appBackground && <>
                    <img src={form.appBackground} alt="ตัวอย่างภาพพื้นหลัง" style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 8 }} />
                    <button type="button" className="outline-button" onClick={() => { updateForm({ appBackground: "" }); applyBackground(""); }}>ลบภาพพื้นหลัง</button>
                  </>}
                </div>
                <div className="brand-live-preview" aria-label="ตัวอย่างหน้าจอ">
                  <span className="eyebrow">ตัวอย่างการแสดงผล</span>
                  <div className="brand-preview-card">
                    {(form?.appLogo ?? "") ? (
                      <img src={form?.appLogo ?? ""} alt="" />
                    ) : (
                      <div className="brand-mark">
                        <span>
                          {brandInitial(form?.appName || "ร้านค้าสวัสดิการ")}
                        </span>
                      </div>
                    )}
                    <div>
                      <b>
                        {(form?.appName ?? "").trim() || "ร้านค้าสวัสดิการ"}
                      </b>
                      <small>Welfare Store</small>
                    </div>
                  </div>
                </div>
              </section>

            </>
          )}
          {tab === "receipt" && (
            <>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>ข้อมูลร้านบนใบเสร็จ</h2>
                    <p>ชื่อ รหัส และที่อยู่ — แสดงที่หัวใบเสร็จและรายงาน</p>
                  </div>
                  <ShoppingBag size={20} className="muted-icon" />
                </div>
                <div className="form-grid">
                  <label>
                    ชื่อร้านค้า
                    <input
                      value={form?.storeName ?? ""}
                      onChange={event =>
                        updateForm({ storeName: event.target.value })
                      }
                      placeholder="ชื่อร้านค้า"
                      disabled={!form}
                    />
                  </label>
                  <label>
                    รหัสร้านค้า
                    <input
                      value={form?.storeCode ?? ""}
                      onChange={event =>
                        updateForm({ storeCode: event.target.value })
                      }
                      placeholder="รหัสร้านค้า"
                      disabled={!form}
                    />
                  </label>
                  <label className="wide">
                    ที่อยู่
                    <input
                      value={form?.storeAddress ?? ""}
                      onChange={event =>
                        updateForm({ storeAddress: event.target.value })
                      }
                      placeholder="ที่อยู่"
                      disabled={!form}
                    />
                  </label>
                </div>
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>ใบเสร็จรับเงิน</h2>
                    <p>กำหนดรายละเอียดที่ต้องการแสดงบนใบเสร็จ</p>
                  </div>
                  <ReceiptText size={20} className="muted-icon" />
                </div>
                <div className="toggle-row">
                  <div>
                    <b>พิมพ์ใบเสร็จหลังชำระเงิน</b>
                    <small>
                      ชำระเสร็จแล้วระบบแสดงหน้าใบเสร็จพร้อมปุ่ม พิมพ์ ·
                      บันทึกรูป · ดาวน์โหลด PDF —
                      ไม่เด้งไปหน้าสั่งพิมพ์ด้วยตัวเอง (รอบ 75)
                    </small>
                  </div>
                  <span className="pos-rail-locked-pill">พร้อมใช้</span>
                </div>
                <div className="toggle-row">
                  <div>
                    <b>แสดงยอดคงเหลือสมาชิกบนใบเสร็จ</b>
                    <small>
                      แสดงยอดคงเหลือล่าสุดบนทุกใบเสร็จที่ระบุสมาชิก
                      พร้อมชื่อผู้ทำรายการ
                    </small>
                  </div>
                  <button
                    className={`toggle ${form?.showBalanceOnReceipt ? "on" : ""}`}
                    onClick={() =>
                      updateForm({
                        showBalanceOnReceipt: !form?.showBalanceOnReceipt,
                      })
                    }
                    disabled={!form}
                    aria-label="แสดงยอดคงเหลือบนใบเสร็จ"
                  >
                    <span />
                  </button>
                </div>
              </section>
              <section className="panel settings-card printer-card">
                <div className="settings-heading">
                  <div>
                    <h2>เครื่องพิมพ์หน้าร้าน</h2>
                    <p>เลือกเครื่องพิมพ์จริงจาก Windows — บันทึกแยกตามเครื่อง</p>
                  </div>
                  <Printer size={20} className="muted-icon" />
                </div>
                {/* สถานะ Helper แสดงครั้งเดียวด้านบน */}
                <PrinterHelperStatus />
                <div className="printer-workstation-note">
                  <small>💻 คอมพิวเตอร์เครื่องนี้: <b>{getWorkstationId()}</b> — การตั้งค่านี้ใช้กับเครื่องนี้เท่านั้น</small>
                </div>
                <LocalPrinterSettings />
                <div className="settings-inline-note">
                  <b>ขนาดสลิปใช้ค่าที่ตั้งในระบบ</b> — รองรับ 58, 72 และ 80 มม. ระบบจะจัดความกว้างและเนื้อหาให้ตรงค่านี้ ส่วน Windows/ไดรเวอร์เครื่องพิมพ์ต้องเลือกกระดาษกว้างเท่ากัน และตั้งการตัดกระดาษตามรุ่นเครื่อง หากเปลี่ยนเครื่องหรือเปลี่ยนม้วน ให้ปรับทั้งสองจุดให้ตรงกัน
                </div>
              </section>

            </>
          )}
          {tab === "member" && (
            <div className="settings-single">
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>การออกเลขสมาชิกใหม่</h2>
                    <p>เลือกวิธีออกหมายเลขให้สมาชิกที่ลงทะเบียนใหม่</p>
                  </div>
                  <CreditCard size={20} className="muted-icon" />
                </div>
                <div
                  className="member-mode-segmented"
                  role="tablist"
                  aria-label="รูปแบบเลขสมาชิก"
                >
                  <span
                    className="member-mode-slider"
                    aria-hidden="true"
                    style={{
                      transform: `translateX(${memberModeIndex * 100}%)`,
                    }}
                  />
                  {[
                    { value: "automatic" as const, label: "ระบบออกเลขให้อัตโนมัติ" },
                    { value: "manual" as const, label: "กรอกเลขเอง" },
                  ].map(({ value, label }) => (
                    <button
                      type="button"
                      role="tab"
                      key={value}
                      aria-selected={value === "automatic" ? automaticMemberNumbers : !automaticMemberNumbers}
                      className={`member-mode-seg${(value === "automatic" ? automaticMemberNumbers : !automaticMemberNumbers) ? " active" : ""}`}
                      onClick={() =>
                        updateForm({
                          memberNumberMode: value === "manual"
                            ? "manual"
                            : (form?.memberNumberYearMode ?? "none") === "none"
                              ? "running"
                              : "year",
                          ...(value === "manual"
                            ? { memberNumberYearMode: memberYearMode }
                            : {}),
                        })
                      }
                      disabled={!form}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {numberMode === "manual" ? (
                  <div className="member-manual-guidance" role="status">
                    <div>
                      <span className="label">ระบบจะไม่สร้างเลขให้อัตโนมัติ</span>
                      <b>กรอกเลขสมาชิกเองตอนลงทะเบียน</b>
                    </div>
                    <p>
                      ช่องหมายเลขสมาชิกจะแสดงในฟอร์มลงทะเบียน ทั้งจากหน้า
                      “สมาชิกและบัญชี” และ POS
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="member-preview-card">
                      <span className="label">สมาชิกใหม่คนถัดไปจะได้เลข</span>
                      <b className="value">{nextNumber}</b>
                    </div>
                    <button
                      type="button"
                      className="member-advanced-toggle"
                      onClick={() => setMemberAdvancedOpen(v => !v)}
                      aria-expanded={memberAdvancedOpen}
                    >
                      <ChevronDown
                        size={14}
                        style={{
                          transform: memberAdvancedOpen ? "rotate(180deg)" : "none",
                        }}
                      />
                      {memberAdvancedOpen
                        ? "ซ่อนการตั้งค่ารูปแบบเลข"
                        : "ตั้งค่ารูปแบบเลข"}
                    </button>
                  </>
                )}
                {numberMode !== "manual" && memberAdvancedOpen && (
                  <div className="member-advanced-wrap">
                    <div className="member-number-format-grid">
                      <label>
                        คำนำหน้าเลขสมาชิก
                        <input
                          value={form?.memberNumberPrefix ?? ""}
                          onChange={event =>
                            updateForm({
                              memberNumberPrefix: event.target.value,
                            })
                          }
                          maxLength={20}
                          placeholder="เช่น M หรือ WEL"
                          disabled={!form}
                        />
                      </label>
                      <label>
                        จำนวนหลักเลขรัน
                        <select
                          value={form?.memberNumberSequenceDigits ?? 6}
                          onChange={event =>
                            updateForm({
                              memberNumberSequenceDigits: Number(
                                event.target.value
                              ),
                            })
                          }
                          disabled={!form}
                        >
                          {[3, 4, 5, 6, 7, 8, 9, 10].map(digits => (
                            <option value={digits} key={digits}>
                              {digits} หลัก
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        ใส่ปีในเลขสมาชิก
                        <select
                          aria-label="ใส่ปีในเลขสมาชิก"
                          value={memberYearMode}
                          onChange={event => {
                            const yearMode = event.target
                              .value as SettingsForm["memberNumberYearMode"];
                            updateForm({
                              memberNumberMode: yearMode === "none" ? "running" : "year",
                              memberNumberYearMode: yearMode,
                            });
                          }}
                          disabled={!form}
                        >
                          <option value="none">ไม่ใส่ปี — นับต่อเนื่อง</option>
                          <option value="buddhist">พ.ศ. — เริ่มเลขใหม่ตามรอบปี</option>
                          <option value="gregorian">ค.ศ. — เริ่มเลขใหม่ตามรอบปี</option>
                        </select>
                      </label>
                      {memberYearMode !== "none" && (
                        <>
                          <label>
                            จำนวนหลักปี
                            <select
                              value={form?.memberNumberYearDigits ?? 2}
                              onChange={event =>
                                updateForm({
                                  memberNumberYearDigits: Number(
                                    event.target.value
                                  ) as 2 | 4,
                                })
                              }
                              disabled={!form}
                            >
                              <option value={2}>2 หลัก เช่น 69</option>
                              <option value={4}>4 หลัก เช่น 2569</option>
                            </select>
                          </label>
                          <label>
                            ตัวคั่นระหว่างส่วน
                            <select
                              value={form?.memberNumberSeparator ?? "-"}
                              onChange={event =>
                                updateForm({
                                  memberNumberSeparator: event.target
                                    .value as SettingsForm["memberNumberSeparator"],
                                })
                              }
                              disabled={!form}
                            >
                              <option value="-">ขีดกลาง (-)</option>
                              <option value="/">ทับ (/)</option>
                              <option value="_">ขีดล่าง (_)</option>
                              <option value="">ไม่ใช้ตัวคั่น</option>
                            </select>
                          </label>
                          <label>
                            เดือนเริ่มรอบปี
                            <select
                              value={((form?.memberNumberResetMonth ?? 12) % 12) + 1}
                              onChange={event =>
                                updateForm({
                                  memberNumberResetMonth: Number(event.target.value) === 1
                                    ? 12 : Number(event.target.value) - 1,
                                })
                              }
                              disabled={!form}
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(
                                month => (
                                  <option value={month} key={month}>
                                    {new Date(
                                      2000,
                                      month - 1,
                                      1
                                    ).toLocaleString("th-TH", {
                                      month: "long",
                                    })}
                                  </option>
                                )
                              )}
                            </select>
                          </label>
                        </>
                      )}
                    </div>
                    <div className="member-number-presets">
                      <b>รูปแบบสำเร็จรูป</b>
                      <button
                        type="button"
                        className="outline-button compact"
                        onClick={() =>
                          updateForm({
                            memberNumberMode: "year",
                            memberNumberPrefix: "",
                            memberNumberYearMode: "buddhist",
                            memberNumberYearDigits: 2,
                            memberNumberSeparator: "",
                            memberNumberSequenceDigits: 5,
                          })
                        }
                        disabled={!form}
                      >
                        ปี พ.ศ. 2 หลัก + เลข 5 หลัก · 6900001
                      </button>
                      <small>
                        เปลี่ยนปีวันที่ 1 ของเดือนถัดจากเดือนที่เลือก
                      </small>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
          {tab === "payment" && (
            <div className="settings-single payment-settings-compact">
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>พร้อมเพย์รับเงิน</h2>
                    <p>เปิดหรือปิดได้ทันที โดยไม่ต้องลบเลขพร้อมเพย์</p>
                  </div>
                </div>
                <div className={`promptpay-details-row${form?.promptpayActive === false ? " inactive" : ""}`}>
                  <div className="bank-row-ico">
                    <QrCode size={18} />
                  </div>
                  <div className="promptpay-details-info">
                    <b>พร้อมเพย์</b>
                    <small>
                      {(form?.promptpayId ?? "").trim() || "ยังไม่ได้ตั้งค่าเลขพร้อมเพย์"}
                      {form?.promptpayActive === false
                        ? " · ปิดรับเงินอยู่"
                        : (form?.promptpayId ?? "").trim()
                          ? " · พร้อมสร้าง QR ตามยอดบิล"
                          : ""}
                    </small>
                  </div>
                  <div className="promptpay-row-actions">
                    <button type="button" className="icon-button" onClick={() => void copyPromptPay()} disabled={!form?.promptpayId.trim()} title="คัดลอกเลขพร้อมเพย์" aria-label="คัดลอกเลขพร้อมเพย์">
                      <Copy size={15} />
                    </button>
                    <button type="button" className="icon-button" onClick={startEditPromptPay} disabled={!form || saveMutation.isPending} title="แก้ไขเลขพร้อมเพย์" aria-label="แก้ไขเลขพร้อมเพย์">
                      <Pencil size={15} />
                    </button>
                    <button type="button" className={`toggle promptpay-row-toggle ${form?.promptpayActive !== false ? "on" : ""}`} onClick={togglePromptPay} disabled={!form || saveMutation.isPending} aria-pressed={form?.promptpayActive !== false} aria-label={form?.promptpayActive !== false ? "ปิดรับเงินผ่านพร้อมเพย์" : "เปิดรับเงินผ่านพร้อมเพย์"} title={form?.promptpayActive !== false ? "ปิดรับเงินผ่านพร้อมเพย์" : "เปิดรับเงินผ่านพร้อมเพย์"}><span /></button>
                  </div>
                </div>
                {promptPayEditing && (
                  <div className="promptpay-edit-panel">
                    <label>
                      เบอร์โทร / เลขประจำตัวประชาชน
                      <input
                        autoFocus
                        value={promptPayDraft}
                        onChange={event => setPromptPayDraft(event.target.value)}
                        onKeyDown={event => {
                          if (event.key === "Enter") savePromptPay();
                          if (event.key === "Escape") cancelEditPromptPay();
                        }}
                        placeholder="เช่น 0812345678 หรือ 1234567890123"
                        disabled={!form || saveMutation.isPending}
                        maxLength={20}
                        inputMode="numeric"
                        title="ใช้เบอร์โทร 9–10 หลัก หรือเลขบัตรประชาชน 13 หลัก ของบัญชีพร้อมเพย์ที่รับเงินของร้าน"
                      />
                    </label>
                    <div className="compact-edit-actions">
                      <button type="button" className="outline-button" onClick={cancelEditPromptPay} disabled={saveMutation.isPending}>
                        <X size={15} /> ยกเลิก
                      </button>
                      <button type="button" className="primary-button" onClick={savePromptPay} disabled={!form || saveMutation.isPending || (!!promptPayDraft.trim() && !isValidPromptPayId(promptPayDraft))}>
                        <Check size={15} /> {saveMutation.isPending ? "กำลังบันทึก…" : "บันทึก"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
              <BankAccountsPanel
                value={form?.bankAccounts ?? []}
                onChange={next => updateForm({ bankAccounts: next })}
                disabled={!form}
                storeName={form?.storeName}
              />
            </div>
          )}
          {tab === "posmenu" && (
            <div className="settings-single">
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>เมนูลัดหน้าร้าน (POS)</h2>
                    <p>
                      เปิด/ปิดปุ่มและคีย์ลัด F บนรางซ้าย POS ·
                      บันทึกแล้วทุกเครื่องเห็นเหมือนกัน
                    </p>
                  </div>
                  <LayoutDashboard size={20} className="muted-icon" />
                </div>
                <div className="pos-rail-manage-list">
                  {POS_RAIL_BUTTONS.map(button => {
                    const hidden = railHiddenFormSet.has(button.key);
                    const Icon = button.icon;
                    return (
                      <div
                        className={`pos-rail-manage-row${hidden ? " off" : ""}`}
                        key={button.key}
                      >
                        <span className="pos-rail-manage-ico">
                          <Icon size={17} />
                        </span>
                        <div>
                          <b>
                            {button.label} <kbd>{shortcutKeyMap[button.key] ?? button.kbd}</kbd>
                          </b>
                          <small>{button.detail}</small>
                        </div>
                        <div className="pos-rail-key-control">
                          <button
                            type="button"
                            className="pos-rail-key-input"
                            aria-label={`ปุ่มลัด${button.label}`}
                            onKeyDown={event =>
                              captureShortcutKey(button.key, event)
                            }
                            disabled={!form || hidden}
                            title="กดปุ่มนี้ แล้วกดคีย์บนคีย์บอร์ดที่ต้องการ"
                          >
                            {shortcutKeyMap[button.key] ?? button.kbd}
                          </button>
                          <button
                            className={`toggle ${!hidden ? "on" : ""}`}
                            onClick={() => toggleRailButton(button.key)}
                            disabled={!form}
                            aria-label={`${hidden ? "เพิ่มกลับ" : "ปิดใช้งาน"}ปุ่ม${button.label} บนราง POS`}
                            title={
                              hidden
                                ? "กดเพื่อเพิ่มปุ่มนี้กลับเข้าราง POS"
                                : "กดเพื่อปิดปุ่มนี้ — ซ่อนจากรางและคีย์ลัดหยุดทำงาน"
                            }
                          >
                            <span />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="pos-rail-manage-row locked">
                    <span className="pos-rail-manage-ico">
                      <LayoutDashboard size={17} />
                    </span>
                    <div>
                      <b>
                        เมนู <kbd>Esc</kbd>
                      </b>
                      <small>
                        กลับสู่เมนูหลัก · ภาพรวมระบบ — ปุ่มทางออกของหน้า POS
                        ใช้งานเสมอ (รอบ 75: ใช้ Esc แทน F9 เพราะมือถือไม่มีปุ่ม
                        F9 แต่มี Esc บนคีย์บอร์ดเสมือน)
                      </small>
                    </div>
                    <span className="pos-rail-locked-pill">ใช้งานเสมอ</span>
                  </div>
                </div>
                <div className="settings-inline-note">
                  <ShieldCheck size={16} />
                  <span>
                    เปิด/ปิดปุ่มและกำหนดคีย์ลัดได้ในแถวเดียวกัน ·
                    ปุ่มที่ปิดจะซ่อนจาก POS และปุ่มลัดจะหยุดทำงาน ·
                    กดปุ่มช่องคีย์ลัดแล้วกด F1–F12, Home
                    หรือปุ่มตัวอักษรบนคีย์บอร์ด (ห้ามใช้ Esc)
                  </span>
                </div>
                <div className="settings-jump">
                  <button
                    className="outline-button"
                    onClick={() => setView("pos")}
                  >
                    <ArrowRight size={16} /> ไปดูผลที่หน้าร้าน / POS
                  </button>
                </div>
              </section>
            </div>
          )}
          {tab === "cutoff" && (
            <>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>รอบตัดยอดประจำวัน</h2>
                    <p>ให้ระบบตัดยอดอัตโนมัติตามเวลา หรือเจ้าหน้าที่กดตัดเอง</p>
                  </div>
                  <CalendarClock size={20} className="muted-icon" />
                </div>
                <div className="number-mode-grid">
                  {[
                    [
                      "auto",
                      "ระบบตัดยอดให้อัตโนมัติ",
                      `รอบวิ่งตามเวลาที่กำหนด เช่น ${form?.dailyCutOffTime ?? "00:00"} ทุกวัน`,
                    ],
                    [
                      "manual",
                      "เจ้าหน้าที่ตัดยอดเอง",
                      "กดปุ่ม “ตัดยอดรอบนี้” ที่หน้าภาพรวมเมื่อพร้อม",
                    ],
                  ].map(([value, title, detail]) => (
                    <button
                      className={
                        (form?.dailyCutOffMode ?? "auto") === value
                          ? "selected"
                          : ""
                      }
                      key={value}
                      onClick={() =>
                        updateForm({
                          dailyCutOffMode:
                            value as SettingsForm["dailyCutOffMode"],
                        })
                      }
                      disabled={!form}
                    >
                      <span className="number-radio">
                        {(form?.dailyCutOffMode ?? "auto") === value && <i />}
                      </span>
                      <span>
                        <b>{title}</b>
                        <small>{detail}</small>
                      </span>
                    </button>
                  ))}
                </div>
                {(form?.dailyCutOffMode ?? "auto") === "auto" && (
                  <div className="cutoff-time-row">
                    <label>
                      เวลาตัดยอดของรอบอัตโนมัติ
                      <input
                        type="time"
                        value={form?.dailyCutOffTime ?? "00:00"}
                        onChange={event =>
                          updateForm({ dailyCutOffTime: event.target.value })
                        }
                        disabled={!form}
                        aria-label="เวลาตัดยอด (ชั่วโมง:นาที)"
                      />
                    </label>
                  </div>
                )}
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>รอบปัจจุบัน</h2>
                  </div>
                  <Activity size={20} className="muted-icon" />
                </div>
                {periodQuery.isLoading ? (
                  <div className="cutoff-period-loading">
                    กำลังโหลดข้อมูลรอบปัจจุบัน…
                  </div>
                ) : period ? (
                  <div className="cutoff-period">
                    <div className="cutoff-period-head">
                      <StatusPill
                        tone={period.mode === "auto" ? "blue" : "purple"}
                      >
                        {period.mode === "auto"
                          ? `ระบบตัดอัตโนมัติ · ${period.cutOffTime} ทุกวัน`
                          : "เจ้าหน้าที่ตัดยอดเอง"}
                      </StatusPill>
                      <small>
                        รอบเริ่ม {formatLogDateTime(period.periodStart)}
                        {period.nextCutOffAt
                          ? ` · รอบถัดไป ${formatLogDateTime(period.nextCutOffAt)}`
                          : ""}
                      </small>
                    </div>
                    <div className="cutoff-period-stats">
                      <div>
                        <small>บิลในรอบ</small>
                        <strong>
                          {period.totals.bills.toLocaleString("th-TH")}
                        </strong>
                      </div>
                      <div>
                        <small>ชิ้นที่ขาย</small>
                        <strong>
                          {period.totals.pieces.toLocaleString("th-TH")}
                        </strong>
                      </div>
                      <div>
                        <small>ยอดขายรอบนี้</small>
                        <strong>{money(period.totals.revenue)}</strong>
                      </div>
                      <div>
                        <small>เงินสด / QR</small>
                        <strong>
                          {money(period.totals.cashTotal)} /{" "}
                          {money(period.totals.qrTotal)}
                        </strong>
                      </div>
                      <div>
                        <small>หักบัญชีสมาชิก</small>
                        <strong>{money(period.totals.walletTotal)}</strong>
                      </div>
                      <div>
                        <small>เติม / ถอน</small>
                        <strong>
                          {money(period.totals.deposits)} /{" "}
                          {money(period.totals.withdrawals)}
                        </strong>
                      </div>
                    </div>
                    {period.lastClosure && (
                      <div className="cutoff-last">
                        <CalendarDays size={15} />
                        <div>
                          <b>
                            ตัดยอดล่าสุด{" "}
                            {formatLogDateTime(period.lastClosure.closedAt)}
                          </b>
                          <small>
                            โดย {period.lastClosure.closedBy ?? "—"} · รอบ{" "}
                            {formatLogDateTime(period.lastClosure.periodStart)}{" "}
                            → {formatLogDateTime(period.lastClosure.closedAt)} ·{" "}
                            {period.lastClosure.bills} บิล ·{" "}
                            {money(period.lastClosure.revenue)}
                          </small>
                        </div>
                      </div>
                    )}
                    <div className="settings-jump">
                      <button
                        className="outline-button"
                        onClick={() => setView("dashboard")}
                      >
                        <ArrowRight size={16} /> ไปที่หน้าภาพรวมเพื่อตัดยอด
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="cutoff-period-loading">
                    ยังไม่มีข้อมูลรอบปัจจุบัน
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "edition" && (
            <>
              <section className="settings-section edition-section">
                <div className="settings-section-head">
                  <h2>เวอร์ชันที่ใช้งานอยู่</h2>
                  <p>
                    ตามลิขสิทธิ์ของร้าน — เปลี่ยนได้ทุกเมื่อด้วยรหัสลิขสิทธิ์
                    (ไม่กระทบข้อมูลทั้งหมด)
                  </p>
                </div>
                {edition.status ? (
                  <>
                    <div className="edition-status-card">
                      <div
                        className={`edition-status-icon tone-${EDITIONS[edition.status.edition].tone}`}
                      >
                        <Crown size={22} />
                      </div>
                      <div className="edition-status-body">
                        <b>{editionStatusLabel(edition.status)}</b>
                        <p>{EDITIONS[edition.status.edition].caption}</p>
                        <div className="edition-status-chips">
                          {edition.status.licensedTo && (
                            <span>
                              ผู้ถือลิขสิทธิ์: {edition.status.licensedTo}
                            </span>
                          )}
                          {edition.status.licenseExpiresAt && (
                            <span>
                              ลิขสิทธิ์ถึง {edition.status.licenseExpiresAt}
                            </span>
                          )}
                          {edition.status.source === "trial" && (
                            <span className="trial">
                              ทดลองใช้เหลือ {edition.status.trialDaysLeft} วัน
                            </span>
                          )}
                          {edition.status.licenseState === "expired" && (
                            <span>
                              รหัสเดิมหมดอายุแล้ว — ใส่รหัสใหม่ด้านล่าง
                            </span>
                          )}
                          <span>
                            ข้อมูลร้านค้าทั้งหมดปลอดภัยไม่ว่าเวอร์ชันไหน
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 7,
                        }}
                      >
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => setUpgradeOpen(true)}
                        >
                          <KeyRound size={15} /> ใช้รหัสลิขสิทธิ์ /
                          เริ่มทดลองใช้
                        </button>
                        <button
                          type="button"
                          className="outline-button"
                          onClick={() => void edition.refetch()}
                        >
                          <RefreshCw size={15} /> ตรวจสถานะใหม่
                        </button>
                      </div>
                    </div>
                    <EditionCompareTable current={edition.status.edition} />
                    <div className="settings-inline-note">
                      <CircleHelp size={16} />
                      <span>
                        เปลี่ยนเวอร์ชันไม่กระทบข้อมูลของร้าน —
                        สิทธิ์ที่ถูกปิดจะซ่อนจากหน้าจอเท่านั้น ข้อมูลสินค้า
                        สมาชิก และบิลยังอยู่ครบทุกอย่าง ·
                        ระบบใหม่เริ่มที่เวอร์ชันทั่วไปและทดลองใช้โปรพลัส 30
                        วันได้ฟรี
                      </span>
                    </div>
                    {isDevRole && <DevKeygenTool />}
                  </>
                ) : (
                  <div className="table-loading">
                    <Crown size={22} />
                    <b>กำลังตรวจสอบเวอร์ชัน…</b>
                    <span>อ่านลิขสิทธิ์จากเซิร์ฟเวอร์</span>
                  </div>
                )}
                {upgradeOpen && (
                  <EditionUpgradeModal
                    open
                    onClose={() => setUpgradeOpen(false)}
                    status={edition.status}
                    onApplied={() => void edition.refetch()}
                  />
                )}
              </section>
            </>
          )}
          {tab === "import" && (
            <>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>นำเข้าข้อมูลจากไฟล์ Excel / CSV</h2>
                    <p>
                      เลือกประเภทข้อมูล · ระบบสำรองข้อมูลก่อนนำเข้าทุกครั้ง
                    </p>
                  </div>
                  <FileSpreadsheet size={20} className="muted-icon" />
                </div>
                <div className="import-kind-grid">
                  {[
                    [
                      "members",
                      "สมาชิกและยอดเงิน",
                      "ข้อมูลสมาชิก · ยอดคงเหลือ · วงเงิน",
                      <UsersRound size={19} key="icon-m" />,
                    ],
                    [
                      "products",
                      "สินค้าและสต็อก",
                      "ข้อมูลสินค้า · ราคา · จำนวนสต็อก",
                      <ShoppingBag size={19} key="icon-p" />,
                    ],
                  ].map(([value, title, detail, icon]) => (
                    <button
                      type="button"
                      key={String(value)}
                      className={`import-kind-card${importKind === value ? " selected" : ""}`}
                      onClick={() => changeImportKind(value as ImportKindId)}
                      aria-pressed={importKind === value}
                    >
                      <span className="import-kind-icon">{icon}</span>
                      <span>
                        <b>{String(title)}</b>
                        <small>{String(detail)}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="import-template-row">
                  <div>
                    <b>เริ่มจากไฟล์ตัวอย่าง</b>
                    <small>
                      ดาวน์โหลด กรอกข้อมูล แล้วอัปโหลด
                    </small>
                  </div>
                  <button
                    type="button"
                    className="outline-button"
                    disabled={importTemplateMutation.isPending}
                    onClick={() =>
                      importTemplateMutation.mutate({ kind: importKind })
                    }
                  >
                    <FileSpreadsheet size={16} />{" "}
                    {importTemplateMutation.isPending
                      ? "กำลังสร้างไฟล์…"
                      : "ดาวน์โหลดเทมเพลต .xlsx"}
                  </button>
                </div>
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>อัปโหลดไฟล์ข้อมูล</h2>
                    <p>
                      .xlsx / .xls / .csv ไม่เกิน 5MB · ตรวจข้อมูลก่อนยืนยันนำเข้า
                    </p>
                  </div>
                  <FileUp size={20} className="muted-icon" />
                </div>
                {!importFile ? (
                  <div
                    className="import-dropzone"
                    role="button"
                    tabIndex={0}
                    aria-label="เลือกหรือลากไฟล์ Excel มาวางเพื่ออัปโหลด"
                    onClick={() => importInputRef.current?.click()}
                    onKeyDown={event => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        importInputRef.current?.click();
                      }
                    }}
                    onDragOver={event => event.preventDefault()}
                    onDrop={event => {
                      event.preventDefault();
                      startImportFile(event.dataTransfer.files?.[0]);
                    }}
                  >
                    <FileSpreadsheet size={30} />
                    <b>เลือกไฟล์ หรือลากมาวาง</b>
                    <small>
                      {importKind === "members"
                        ? "ไฟล์รายชื่อสมาชิก"
                        : "ไฟล์รายการสินค้า"}
                    </small>
                  </div>
                ) : (
                  <div className="import-file-info">
                    <span className="import-file-icon">
                      <FileSpreadsheet size={19} />
                    </span>
                    <div>
                      <b>{importFile.name}</b>
                      <small>
                        {currentSheet
                          ? `อ่านแล้ว · ${currentSheet.totalRows.toLocaleString("th-TH")} แถว · ${Math.max(1, Math.round((importFile.base64.length * 3) / 4 / 1024)).toLocaleString("th-TH")} KB`
                          : importPreviewMutation.isPending
                            ? "กำลังอ่านไฟล์…"
                            : "อ่านไฟล์แล้ว"}
                      </small>
                    </div>
                    <div className="import-file-actions">
                      <button
                        type="button"
                        className="outline-button compact"
                        onClick={() => importInputRef.current?.click()}
                      >
                        <FileUp size={14} /> เปลี่ยนไฟล์
                      </button>
                      <button
                        type="button"
                        className="danger-outline-button compact"
                        onClick={resetImportFlow}
                      >
                        <X size={14} /> ล้าง
                      </button>
                    </div>
                  </div>
                )}
                {importPreviewMutation.isPending && (
                  <div className="import-reading-row">
                    <span className="mini-spinner" aria-hidden="true" />{" "}
                    กำลังอ่านไฟล์และจับคู่คอลัมน์…
                  </div>
                )}
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  hidden
                  onChange={event => {
                    startImportFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </section>
              {currentSheet && importFile && (
                <section className="panel settings-card">
                  <div className="settings-heading">
                    <div>
                      <h2>ตรวจสอบการจับคู่คอลัมน์</h2>
                      <p>
                        ระบบเดาให้แล้วจากชื่อหัวตาราง —
                        ตรวจทานและปรับได้ก่อนนำเข้า ·
                        คอลัมน์หนึ่งใช้กับข้อมูลชนิดเดียว
                      </p>
                    </div>
                    <Table2 size={20} className="muted-icon" />
                  </div>
                  <div className="import-preview-controls">
                    {(importSheets ?? []).length > 1 && (
                      <label>
                        ชีต
                        <select
                          value={importSheetIndex}
                          onChange={event =>
                            changeImportSheet(Number(event.target.value))
                          }
                        >
                          {(importSheets ?? []).map((sheet, index) => (
                            <option key={sheet.name} value={index}>
                              {sheet.name} (
                              {sheet.totalRows.toLocaleString("th-TH")} แถว)
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      แถวหัวตารางอยู่แถวที่
                      <select
                        value={importHeaderRow}
                        onChange={event =>
                          changeImportHeaderRow(Number(event.target.value))
                        }
                      >
                        {[0, 1, 2, 3, 4].map(row => (
                          <option key={row} value={row}>
                            {row + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="import-row-count">
                      <b>{currentSheet.totalRows.toLocaleString("th-TH")}</b>{" "}
                      แถวข้อมูล จะนำเข้า
                    </span>
                  </div>
                  <div className="import-mapping-grid">
                    {importFields.map(field => (
                      <label
                        key={field.key}
                        className={
                          field.required && (importMapping[field.key] ?? -1) < 0
                            ? "import-field missing"
                            : "import-field"
                        }
                      >
                        <span>
                          {field.label}
                          {field.required ? " *" : ""}
                        </span>
                        <select
                          value={importMapping[field.key] ?? -1}
                          onChange={event =>
                            setMappingField(
                              field.key,
                              Number(event.target.value)
                            )
                          }
                          aria-label={`คอลัมน์สำหรับ ${field.label}`}
                        >
                          <option value={-1}>— ไม่นำเข้า —</option>
                          {currentSheet.headers.map((header, index) => (
                            <option key={`${header}-${index}`} value={index}>
                              คอลัมน์ {importColumnLabel(index)} · {header}
                            </option>
                          ))}
                        </select>
                        {field.hint && <small>{field.hint}</small>}
                      </label>
                    ))}
                  </div>
                  <div className="import-sample-block">
                    <div className="import-sample-head">
                      <Table2 size={15} /> ตัวอย่าง 8 แถวแรกจากไฟล์{" "}
                      <span>ตรวจว่าคอลัมน์ที่จับคู่มีข้อมูลถูกชนิด</span>
                    </div>
                    <div className="import-sample-table">
                      <table>
                        <thead>
                          <tr>
                            {currentSheet.headers.map((header, index) => (
                              <th
                                key={`${header}-${index}`}
                                className={
                                  Object.values(importMapping).includes(index)
                                    ? "mapped"
                                    : ""
                                }
                                title={header}
                              >
                                {importColumnLabel(index)}
                                <span>{header}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {currentSheet.sampleRows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                              {row.map((cell, cellIndex) => (
                                <td key={cellIndex}>
                                  {cell === "" ? (
                                    <i className="import-blank">ว่าง</i>
                                  ) : (
                                    cell
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="import-duplicate-row">
                    <div>
                      <b>รายการที่ซ้ำกับข้อมูลในระบบ</b>
                      <small>
                        {importKind === "members"
                          ? "ตรวจซ้ำจากเลขสมาชิก — ไม่กรอกเลขสมาชิก = สร้างเป็นสมาชิกใหม่เสมอ"
                          : "ตรวจซ้ำจากบาร์โค้ด → รหัสสินค้า → ชื่อสินค้า"}
                      </small>
                    </div>
                    <div
                      className="import-duplicate-options"
                      role="radiogroup"
                      aria-label="วิธีจัดการรายการซ้ำ"
                    >
                      {[
                        [
                          "skip",
                          "ข้ามรายการซ้ำ",
                          "เห็นว่ามีแล้ว ไม่แตะข้อมูลเดิม (ปลอดภัยสุด)",
                        ],
                        [
                          "replace",
                          "อัปเดตข้อมูลที่ซ้ำ",
                          "เอาข้อมูลใหม่จากไฟล์ทับรายการเดิมในระบบ",
                        ],
                      ].map(([value, title, detail]) => (
                        <button
                          type="button"
                          key={value}
                          role="radio"
                          aria-checked={duplicateMode === value}
                          className={duplicateMode === value ? "selected" : ""}
                          onClick={() =>
                            setDuplicateMode(value as "skip" | "replace")
                          }
                        >
                          <span className="number-radio">
                            {duplicateMode === value && <i />}
                          </span>
                          <span>
                            <b>{title}</b>
                            <small>{detail}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="import-run-row">
                    <div>
                      <b>
                        พร้อมนำเข้า{" "}
                        {currentSheet.totalRows.toLocaleString("th-TH")} แถว
                      </b>
                      <small>
                        ระบบสำรองข้อมูลทั้งระบบเป็นไฟล์ป้องกันก่อนนำเข้าเสมอ —
                        หาผลไม่ตามที่คิด กู้คืนกลับได้ที่แท็บสำรองข้อมูล
                      </small>
                    </div>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={
                        importExecuteMutation.isPending ||
                        (importMapping[
                          importFields.find(f => f.required)?.key ?? ""
                        ] ?? -1) < 0
                      }
                      onClick={() => setImportConfirm(true)}
                    >
                      <Check size={16} />{" "}
                      {importExecuteMutation.isPending
                        ? "กำลังนำเข้า…"
                        : "นำเข้าข้อมูล"}
                    </button>
                  </div>
                </section>
              )}
              {importResult && (
                <section className="panel settings-card import-result-card">
                  <div className="settings-heading">
                    <div>
                      <h2>ผลการนำเข้า</h2>
                      <p>
                        จากไฟล์ {importResult.fileName} ·
                        บันทึกลงระบบเรียบร้อยแล้ว
                      </p>
                    </div>
                    <Check size={20} className="muted-icon" />
                  </div>
                  <div className="import-result-stats">
                    <div className="ok">
                      <small>เพิ่มใหม่</small>
                      <strong>
                        {importResult.inserted.toLocaleString("th-TH")}
                      </strong>
                    </div>
                    <div className="ok">
                      <small>อัปเดต</small>
                      <strong>
                        {importResult.updated.toLocaleString("th-TH")}
                      </strong>
                    </div>
                    <div>
                      <small>ข้าม</small>
                      <strong>
                        {importResult.skipped.toLocaleString("th-TH")}
                      </strong>
                    </div>
                    <div
                      className={importResult.errors.length > 0 ? "bad" : ""}
                    >
                      <small>ผิดพลาด</small>
                      <strong>
                        {importResult.errors.length.toLocaleString("th-TH")}
                      </strong>
                    </div>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="import-error-list">
                      <div className="import-error-head">
                        แถวที่นำเข้าไม่สำเร็จ (แสดงไม่เกิน 20 แถวแรก)
                      </div>
                      {importResult.errors.slice(0, 20).map(rowError => (
                        <div className="import-error-row" key={rowError.row}>
                          <b>แถว {rowError.row}</b>
                          <span>{rowError.message}</span>
                        </div>
                      ))}
                      {importResult.errors.length > 20 && (
                        <div className="import-error-row more">
                          และอีก {importResult.errors.length - 20} แถว —
                          แก้ไขในไฟล์แล้วนำเข้าเฉพาะแถวที่เหลืออีกครั้งได้
                        </div>
                      )}
                    </div>
                  )}
                  <div className="settings-inline-note">
                    <DatabaseBackup size={16} />
                    <span>
                      ไฟล์ป้องกันก่อนนำเข้า:{" "}
                      <b>{importResult.safetyBackupFile}</b> — หากผลไม่ต้องการ
                      ไปที่แท็บ “สำรองข้อมูล” แล้วกู้คืนไฟล์นี้ได้ทันที
                    </span>
                  </div>
                  <div className="import-result-actions">
                    <button
                      type="button"
                      className="outline-button"
                      onClick={() => {
                        resetImportFlow();
                        importInputRef.current?.click();
                      }}
                    >
                      <FileUp size={16} /> นำเข้าไฟล์อื่นต่อ
                    </button>
                    <button
                      type="button"
                      className="outline-button"
                      onClick={() =>
                        setView(importKind === "members" ? "members" : "stock")
                      }
                    >
                      <ArrowRight size={16} /> ไปดู
                      {importKind === "members"
                        ? "ข้อมูลสมาชิก"
                        : "สต็อกสินค้า"}
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
          {tab === "backup" && (
            <>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>สำรองข้อมูล</h2>
                    <p>
                      เก็บข้อมูลร้านทั้งหมดเป็นไฟล์เดียว
                    </p>
                  </div>
                  <HardDriveDownload size={20} className="muted-icon" />
                </div>
                <div className="backup-now-row">
                  <div>
                    <b>สร้างไฟล์สำรอง</b>
                    <small>
                      รวมข้อมูลและการตั้งค่า · ตรวจสอบไฟล์อัตโนมัติ
                    </small>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => createBackupMutation.mutate()}
                    disabled={createBackupMutation.isPending}
                  >
                    <DatabaseBackup size={16} />{" "}
                    {createBackupMutation.isPending
                      ? "กำลังสำรอง…"
                      : "สำรองตอนนี้"}
                  </button>
                </div>
                <div className="backup-now-row backup-upload-row">
                  <div>
                    <b>อัปโหลดไฟล์จากเครื่องอื่น</b>
                    <small>
                      ตรวจสอบไฟล์ก่อนเพิ่มในรายการ · กด “กู้คืน” เพื่อแทนที่ข้อมูลทั้งระบบ รวมบัญชีและรหัสผ่าน
                    </small>
                  </div>
                  <button
                    className="outline-button"
                    onClick={() => uploadBackupInputRef.current?.click()}
                    disabled={uploadBackupMutation.isPending}
                  >
                    <FileUp size={16} />{" "}
                    {uploadBackupMutation.isPending
                      ? "กำลังตรวจสอบไฟล์…"
                      : "เลือกไฟล์ .sqlite"}
                  </button>
                  <input
                    ref={uploadBackupInputRef}
                    type="file"
                    hidden
                    onChange={event => {
                      startUploadBackupFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </div>
                <div className="settings-inline-note">
                  <ShieldCheck size={16} />
                  <span>
                    สำรองทุกวัน และดาวน์โหลดเก็บใน USB หรือคลาวด์ เผื่อเครื่องเสีย
                  </span>
                </div>
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>สำรองอัตโนมัติ</h2>
                    <p>
                      ตั้งรอบเวลา แล้วกด “บันทึกการตั้งค่า”
                    </p>
                  </div>
                  <CalendarClock size={20} className="muted-icon" />
                </div>
                <div className="toggle-row">
                  <div>
                    <b>เปิดสำรองข้อมูลอัตโนมัติ</b>
                    <small>
                      ตรวจรอบเวลาทุก 10 นาที
                    </small>
                  </div>
                  <button
                    className={`toggle ${form?.backupAutoEnabled ? "on" : ""}`}
                    onClick={() =>
                      updateForm({
                        backupAutoEnabled: !form?.backupAutoEnabled,
                      })
                    }
                    disabled={!form}
                    aria-label="เปิดสำรองข้อมูลอัตโนมัติ"
                  >
                    <span />
                  </button>
                </div>
                {form?.backupAutoEnabled && (
                  <div className="backup-interval-grid">
                    <label>
                      รอบเวลาสำรองอัตโนมัติ
                      <select
                        value={String(form?.backupIntervalHours ?? 24)}
                        onChange={event =>
                          updateForm({
                            backupIntervalHours: Number(event.target.value),
                          })
                        }
                        disabled={!form}
                        aria-label="รอบเวลาสำรองอัตโนมัติ"
                      >
                        {[
                          [6, "ทุก 6 ชั่วโมง (วันละ 4 ครั้ง)"],
                          [12, "ทุก 12 ชั่วโมง (วันละ 2 ครั้ง)"],
                          [24, "ทุก 24 ชั่วโมง (วันละครั้ง — แนะนำ)"],
                          [48, "ทุก 2 วัน"],
                          [168, "ทุกสัปดาห์"],
                        ].map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      เก็บไฟล์สำรองไว้ไม่เกิน
                      <select
                        value={String(form?.backupKeepCount ?? 14)}
                        onChange={event =>
                          updateForm({
                            backupKeepCount: Number(event.target.value),
                          })
                        }
                        disabled={!form}
                        aria-label="จำนวนไฟล์สำรองที่เก็บ"
                      >
                        {[
                          [7, "7 ไฟล์ล่าสุด"],
                          [14, "14 ไฟล์ล่าสุด (แนะนำ)"],
                          [30, "30 ไฟล์ล่าสุด"],
                          [60, "60 ไฟล์ล่าสุด"],
                        ].map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <div className="settings-inline-note">
                  <CalendarClock size={16} />
                  <span>
                    ลบไฟล์เก่าที่เกินจำนวนที่ตั้ง · ไม่ลบไฟล์ที่ดาวน์โหลดไว้นอกเครื่อง
                  </span>
                </div>
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>ไฟล์สำรองทั้งหมด</h2>
                    <p>
                      ล่าสุดอยู่บนสุด · ดาวน์โหลดหรือกู้คืนได้
                    </p>
                  </div>
                  <ArchiveRestore size={20} className="muted-icon" />
                </div>
                {backupQuery.isLoading ? (
                  <div className="cutoff-period-loading">
                    กำลังโหลดรายการไฟล์สำรอง…
                  </div>
                ) : backupQuery.isError ? (
                  <div className="inline-message error" role="alert">
                    <ShieldCheck size={15} /> โหลดรายการไฟล์สำรองไม่สำเร็จ —{" "}
                    {getErrorMessage(backupQuery.error)}
                  </div>
                ) : (backupQuery.data?.backups ?? []).length === 0 ? (
                  <div className="backup-empty">
                    <DatabaseBackup size={30} />
                    <b>ยังไม่มีไฟล์สำรอง</b>
                    <small>
                      กด “สำรองตอนนี้” ด้านบนเพื่อสร้างไฟล์แรก
                      หรือเปิดสำรองอัตโนมัติให้ระบบจัดการให้
                    </small>
                  </div>
                ) : (
                  <div className="backup-list">
                    {(backupQuery.data?.backups ?? []).map(row => (
                      <div className="backup-row" key={row.file}>
                        <span className="backup-icon">
                          <DatabaseBackup size={16} />
                        </span>
                        <div>
                          <b title={row.file}>{row.file}</b>
                          <small>
                            {formatLogDateTime(row.createdAt)} ·{" "}
                            {formatFileSize(row.sizeBytes)}
                            {row.integrity === "ok"
                              ? " · ตรวจสอบความถูกต้องผ่าน"
                              : ""}
                          </small>
                        </div>
                        <div className="backup-actions">
                          <button
                            type="button"
                            className="outline-button compact"
                            disabled={downloadBackupMutation.isPending}
                            onClick={() =>
                              downloadBackupMutation.mutate({ file: row.file })
                            }
                            title={`ดาวน์โหลด ${row.file} เก็บไว้นอกเครื่อง`}
                          >
                            <Download size={14} /> ดาวน์โหลด
                          </button>
                          <button
                            type="button"
                            className="danger-outline-button compact"
                            disabled={restoreBackupMutation.isPending}
                            onClick={() => setRestoreTarget(row.file)}
                            title={`กู้คืนข้อมูลกลับไปเป็นช่วงเวลาของ ${row.file}`}
                          >
                            <ArchiveRestore size={14} /> กู้คืน
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="settings-inline-note backup-restore-note">
                  <ShieldCheck size={16} />
                  <span>
                    การกู้คืนจะ<b>แทนที่ข้อมูลทั้งระบบ</b>ด้วยไฟล์สำรองนั้น —
                    ระบบสำรองข้อมูลปัจจุบันไว้เป็นไฟล์ป้องกันก่อนเสมอ
                    และบันทึกลง Log เป็นสีแดง
                  </span>
                </div>
              </section>
            </>
          )}
          {tab === "network" && (
            <>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>สถานะการเชื่อมต่อ</h2>
                    <p>
                      ตรวจสอบว่าเครื่องนี้คุยกับเซิร์ฟเวอร์ของระบบได้ปกติ —
                      เปิดหน้านี้ระบบวัดให้ทันที และวัดใหม่ได้ทุกเมื่อ
                    </p>
                  </div>
                  <Wifi size={20} className="muted-icon" />
                </div>
                <div className="net-stat-grid">
                  <div className="net-stat">
                    <small>ที่อยู่ที่เปิดอยู่ตอนนี้</small>
                    <b>
                      {typeof window !== "undefined"
                        ? window.location.origin
                        : "—"}
                    </b>
                    <span>เครื่องนี้เรียกใช้ระบบจาก URL นี้</span>
                  </div>
                  <div className="net-stat">
                    <small>สัญญาณเครือข่ายของเครื่องนี้</small>
                    <b className={browserOnline ? "green-text" : "red-text"}>
                      {browserOnline ? "ออนไลน์" : "ออฟไลน์"}
                    </b>
                    <span>
                      {browserOnline
                        ? "เชื่อมต่อเครือข่ายอยู่ — ใช้งานได้ปกติ"
                        : "เครื่องนี้ไม่มีสัญญาณเครือข่าย — เช็ค Wi-Fi หรือสายแลน"}
                    </span>
                  </div>
                  <div className="net-stat">
                    <small>ความหน่วงถึงเซิร์ฟเวอร์ (ping)</small>
                    <b>
                      {latencyError
                        ? "เชื่อมต่อไม่ได้"
                        : latencyMs == null
                          ? "กำลังวัด…"
                          : `${latencyMs} มิลลิวินาที`}
                    </b>
                    <span>
                      {latencyAt
                        ? `วัดล่าสุด ${latencyAt}`
                        : "วัดอัตโนมัติตอนเปิดแท็บนี้"}{" "}
                      ·{" "}
                      <button
                        type="button"
                        className="link-inline"
                        onClick={measureLatency}
                      >
                        <RefreshCw size={12} /> วัดใหม่
                      </button>
                    </span>
                  </div>
                </div>
                {lanInfoQuery.data && (
                  <div className="net-server-row">
                    <Globe size={15} />
                    <div>
                      <b>เซิร์ฟเวอร์: {lanInfoQuery.data.hostname}</b>
                      <small>
                        {lanInfoQuery.data.platform} ·
                        เปิดให้บริการต่อเนื่องมาแล้ว{" "}
                        {uptimeLabel(lanInfoQuery.data.uptimeSeconds)} ·
                        หน่วยความจำ{" "}
                        {lanInfoQuery.data.totalMemoryMb.toLocaleString(
                          "th-TH"
                        )}{" "}
                        MB
                      </small>
                    </div>
                  </div>
                )}
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>ใช้งานหลายจุดขายในร้าน (LAN)</h2>
                    <p>
                      เครื่องอื่นในเครือข่ายเดียวกันเปิดระบบด้วย URL
                      ด้านล่างนี้ได้เลย — ข้อมูลชุดเดียวกันทั้งร้าน
                      ทุกเครื่องเห็นยอดแบบสด
                    </p>
                  </div>
                  <Network size={20} className="muted-icon" />
                </div>
                {lanInfoQuery.isLoading ? (
                  <div className="table-loading">
                    <Network size={22} />
                    <b>กำลังอ่านไอพีของเครื่องเซิร์ฟเวอร์</b>
                    <span>ใช้เวลาไม่กี่วินาที</span>
                  </div>
                ) : (lanInfoQuery.data?.addresses.length ?? 0) === 0 ? (
                  <div className="settings-inline-note">
                    <Wifi size={16} />
                    <span>
                      ไม่พบไอพี LAN บนเครื่องเซิร์ฟเวอร์ — เชื่อม Wi-Fi
                      หรือสายแลนให้เครื่องเซิร์ฟเวอร์ก่อน
                      แล้วกลับมาเปิดหน้านี้ใหม่ (หรือใช้ที่อยู่ในช่อง
                      “ที่อยู่ที่เปิดอยู่ตอนนี้” ด้านบน)
                    </span>
                  </div>
                ) : (
                  <div className="lan-url-list">
                    {lanInfoQuery.data?.addresses.map(ip => {
                      const lanScheme = lanInfoQuery.data?.https
                        ? "https"
                        : "http";
                      const url = `${lanScheme}://${ip}:${lanInfoQuery.data?.port ?? 3000}`;
                      return (
                        <div className="lan-url-row" key={ip}>
                          <span className="lan-url-ip">{ip}</span>
                          <code>{url}</code>
                          <button
                            type="button"
                            className="outline-button compact"
                            onClick={() => copyLanUrl(url)}
                          >
                            <Copy size={14} /> คัดลอก
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="printer-flow-steps lan-steps">
                  <div className="printer-step">
                    <b>1</b>
                    <div>
                      <b>เชื่อมเครือข่ายเดียวกัน</b>
                      <small>
                        เครื่องที่จะใช้ (จุดขายเพิ่ม / หลังบ้าน) ต้องอยู่ Wi-Fi
                        หรือสายแลนเดียวกับเครื่องที่ติดตั้งระบบไว้
                      </small>
                    </div>
                  </div>
                  <div className="printer-step">
                    <b>2</b>
                    <div>
                      <b>เปิด URL ด้านบนด้วย Chrome หรือ Edge</b>
                      <small>
                        พิมพ์ URL ในช่องที่อยู่ → เข้าสู่ระบบด้วยบัญชีของแต่ละคน
                        · คลิกขวาที่แท็บ → “ปักหมุด” (Pin to taskbar)
                        ให้เปิดได้เร็วทุกวัน
                      </small>
                    </div>
                  </div>
                  <div className="printer-step">
                    <b>3</b>
                    <div>
                      <b>เครื่องพิมพ์ของเครื่องไหน พิมพ์ที่เครื่องนั้น</b>
                      <small>
                        ใบเสร็จถูกส่งไปเครื่องพิมพ์เริ่มต้นของ
                        “เครื่องที่กดชำระเงิน” —
                        ตั้งเครื่องพิมพ์สลิปของแต่ละจุดขายเป็นค่าเริ่มต้น
                        (วิธีตั้งอยู่ที่แท็บใบเสร็จและเครื่องพิมพ์)
                      </small>
                    </div>
                  </div>
                </div>
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>กล้องสแกนบาร์โค้ดบนมือถือ / แท็บเล็ต</h2>
                    <p>
                      เบราว์เซอร์ (Chrome / Edge / Safari)
                      อนุญาตให้เปิดกล้องเฉพาะหน้าเว็บที่เป็น HTTPS หรือ
                      localhost เท่านั้น — อุปกรณ์ที่เข้าผ่าน http://IP
                      จึงกดปุ่มกล้องไม่ได้ ไม่ใช่ความผิดของระบบ
                    </p>
                  </div>
                  <Camera size={20} className="muted-icon" />
                </div>
                {lanInfoQuery.data?.https ? (
                  <>
                    <div className="dual-mode-note">
                      <ShieldCheck size={15} />
                      <span>
                        <b>เซิร์ฟเวอร์เปิด HTTPS แล้ว</b> — อุปกรณ์ที่เข้าด้วย
                        URL https:// ด้านบนจะใช้กล้องสแกนบาร์โค้ดได้ทุกเครื่อง
                        (ปุ่มกล้องหน้าขาย · สมาชิก · สต็อก)
                      </span>
                    </div>
                    <div className="printer-flow-steps lan-steps">
                      <div className="printer-step">
                        <b>1</b>
                        <div>
                          <b>เปิดด้วย URL ที่ขึ้นต้น https:// เท่านั้น</b>
                          <small>
                            พิมพ์ URL ด้านบนในช่องที่อยู่ของอุปกรณ์ —
                            ห้ามเปลี่ยนเป็น http:// (กล้องจะเปิดไม่ได้ทันที)
                          </small>
                        </div>
                      </div>
                      <div className="printer-step">
                        <b>2</b>
                        <div>
                          <b>ครั้งแรกจะมีหน้าเตือน “ไม่ปลอดภัย”</b>
                          <small>
                            เป็นเพราะใบรับรองที่ระบบสร้างเองภายในร้าน — กด
                            ขั้นสูง (Advanced) → ดำเนินการต่อไปยังเว็บไซต์
                            ครั้งเดียว เบราว์เซอร์จำไว้ทั้งเครื่อง
                          </small>
                        </div>
                      </div>
                      <div className="printer-step">
                        <b>3</b>
                        <div>
                          <b>กดอนุญาตกล้องเมื่อเบราว์เซอร์ถาม</b>
                          <small>
                            ไอคอน 🔒 ในแถบที่อยู่ → อนุญาตกล้อง →
                            จากนั้นปุ่มกล้องใช้ได้ปกติทุกหน้า
                          </small>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="settings-inline-note amber">
                      <CircleAlert size={16} />
                      <span>
                        ตอนนี้เซิร์ฟเวอร์เปิดแบบ <b>http</b> —
                        อุปกรณ์ที่เข้าผ่าน IP (ไม่ใช่ localhost) จะ
                        <b>เปิดกล้องไม่ได้</b> · แก้ได้ 2 วิธี:
                      </span>
                    </div>
                    <div className="printer-flow-steps lan-steps">
                      <div className="printer-step">
                        <b>ก</b>
                        <div>
                          <b>
                            เปิด HTTPS ที่เซิร์ฟเวอร์ (แนะนำ —
                            ตั้งครั้งเดียวจบทั้งร้าน)
                          </b>
                          <small>
                            ที่เครื่องเซิร์ฟเวอร์: เปิดไฟล์ .env
                            (สร้างใหม่ถ้ายังไม่มี) เพิ่มบรรทัด{" "}
                            <code>HTTPS=1</code> → บันทึก → รีสตาร์ทเซิร์ฟเวอร์
                            (Ctrl+C แล้ว <code>pnpm dev</code> อีกครั้ง) —
                            ระบบสร้างใบรับรองให้เอง
                            จากนั้นให้อุปกรณ์ทุกเครื่องเข้าด้วย URL https://
                            ด้านบน (ผ่านหน้าเตือนครั้งแรกครั้งเดียว)
                          </small>
                        </div>
                      </div>
                      <div className="printer-step">
                        <b>ข</b>
                        <div>
                          <b>
                            ทางเลือก — ยังใช้ http แต่เปิด flag ของ Chrome
                            (ทำทีละเครื่อง)
                          </b>
                          <small>
                            บนอุปกรณ์ที่ต้องใช้กล้อง: เปิด{" "}
                            <code>
                              chrome://flags/#unsafely-treat-insecure-origin-as-secure
                            </code>{" "}
                            → ใส่ URL http://IP:พอร์ต ของร้าน → เลือก Enabled →
                            กด Relaunch — วิธีนี้ต้องทำซ้ำทุกเครื่อง
                            และบางเบราว์เซอร์ไม่มี flag นี้
                          </small>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>LAN วันนี้ + คลาวด์ในอนาคต — ทำพร้อมกันได้</h2>
                    <p>
                      สรุปแนวทางสำหรับร้าน: เริ่มใช้ใน LAN ก่อน
                      แล้วต่อยอดขึ้นคลาวด์ทีละขั้น โดยไม่ต้องเริ่มใหม่
                    </p>
                  </div>
                  <Cloud size={20} className="muted-icon" />
                </div>
                <div className="dual-mode-note">
                  <Check size={15} />
                  <span>
                    ระบบเก็บข้อมูลทั้งหมดไว้ที่เครื่องเซิร์ฟเวอร์ในร้าน (SQLite)
                    — แม้อินเทอร์เน็ตหลุด การขายหน้าร้านก็ไม่สะดุด
                    นี่คือหัวใจของโหมด “Offline-First” ที่จะต่อยอดขึ้นคลาวด์ได้
                  </span>
                </div>
                <div className="printer-flow-steps">
                  <div className="printer-step">
                    <b>1</b>
                    <div>
                      <b>วันนี้ — ใช้ผ่าน LAN ในร้าน</b>
                      <small>
                        ข้อมูลอยู่ในเครื่องร้าน 100% ·
                        สำรองข้อมูลอัตโนมัติทุกวันตามที่ตั้งไว้
                        (แท็บสำรองข้อมูล) · เร็ว ปลอดภัย ไม่ต้องพึ่งอินเทอร์เน็ต
                      </small>
                    </div>
                  </div>
                  <div className="printer-step">
                    <b>2</b>
                    <div>
                      <b>ขั้นถัดไป — ต่อคลาวด์เป็นตัวสำรองที่สอง</b>
                      <small>
                        เปิดโหมดคลาวด์ควบคู่: หน้าร้านทำงานเหมือนเดิมทุกอย่าง
                        แต่ระบบผลักสำเนาข้อมูลขึ้นคลาวด์ทันทีที่เน็ตกลับมา —
                        สำรอง 2 ที่ ดูย้อนหลังได้จากที่ไหนก็ได้
                      </small>
                    </div>
                  </div>
                  <div className="printer-step">
                    <b>3</b>
                    <div>
                      <b>อนาคต — ผู้บริหารดูยอดจากนอกร้าน / หลายสาขา</b>
                      <small>
                        เพิ่มระบบซิงก์: ขายที่ร้านเหมือนเดิม
                        ยอดวิ่งขึ้นคลาวด์แบบใกล้ทันที ·
                        ผู้บริหารเปิดดูรายงานจากมือถือหรือบ้านได้
                        โดยหน้าร้านไม่ต้องเปลี่ยนวิธีทำงานแม้แต่ปุ่มเดียว
                      </small>
                    </div>
                  </div>
                </div>
                <div className="initial-balance-note">
                  <ShieldCheck size={15} />
                  <span>
                    แนวทางนี้ไม่ต้องเปลี่ยนเครื่องหรือทิ้งข้อมูลเดิม — เริ่มจาก
                    LAN วันนี้ แล้วต่อยอดขึ้นคลาวด์ทีละขั้น
                    ใช้ข้อมูลชุดเดียวกันตลอด
                  </span>
                </div>
              </section>
            </>
          )}
          {tab === "display" && (
            <>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>ขนาดตัวอักษร</h2>
                    <p>ปรับขนาดตัวอักษรทั้งระบบให้อ่านง่ายขึ้น · มีผลทันที</p>
                  </div>
                  <Monitor size={20} className="muted-icon" />
                </div>
                <div className="number-mode-grid">
                  {FONT_SCALES.map(scale => (
                    <button
                      className={fontScale === scale.id ? "selected" : ""}
                      key={scale.id}
                      onClick={() => chooseFontScale(scale.id)}
                    >
                      <span className="number-radio">
                        {fontScale === scale.id && <i />}
                      </span>
                      <span>
                        <b>
                          {scale.label} · {Math.round(scale.zoom * 100)}%
                        </b>
                        <small>{scale.detail}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="font-scale-sample">
                  <span>ตัวอย่างข้อความ</span>
                  <b>ร้านค้าสวัสดิการ · ยอดรวม ฿1,234.56</b>
                  <small>
                    สมาชิก M-000001 · บิล RC-260918-010 · 18 ก.ย. 2569
                  </small>
                </div>
              </section>

            </>
          )}
          {tab === "alert" && (
            <div className="settings-single">
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>การแจ้งเตือน</h2>
                    <p>ช่วยให้เจ้าหน้าที่ติดตามรายการสำคัญได้ทันเวลา</p>
                  </div>
                  <Bell size={20} className="muted-icon" />
                </div>
                <div className="toggle-row">
                  <div>
                    <b>แจ้งเตือนเมื่อสมาชิกมียอดคงเหลือต่ำ</b>
                    <small>
                      แสดงในกระดิ่งแจ้งเตือนเมื่อยอดต่ำกว่า{" "}
                      {money(form?.lowBalanceThreshold ?? 100)}
                    </small>
                  </div>
                  <div className="toggle-row-controls">
                    <label
                      className="threshold-input"
                      title="เกณฑ์ยอดคงเหลือต่ำ (บาท)"
                    >
                      <span>฿</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        aria-label="เกณฑ์ยอดคงเหลือต่ำ (บาท)"
                        placeholder="100"
                        value={thresholdText}
                        onChange={event => {
                          const digits = event.target.value.replace(
                            /[^0-9]/g,
                            ""
                          );
                          setThresholdText(digits);
                          updateForm({
                            lowBalanceThreshold:
                              digits === "" ? 0 : Number(digits),
                          });
                        }}
                        disabled={!form}
                      />
                    </label>
                    <button
                      className={`toggle ${form?.lowBalanceAlert ? "on" : ""}`}
                      onClick={() =>
                        updateForm({ lowBalanceAlert: !form?.lowBalanceAlert })
                      }
                      disabled={!form}
                      aria-label="แจ้งเตือนยอดคงเหลือต่ำ"
                    >
                      <span />
                    </button>
                  </div>
                </div>
                <div className="toggle-row">
                  <div>
                    <b>แจ้งเตือนสินค้าใกล้หมดสต็อก</b>
                    <small>แจ้งเตือนเมื่อจำนวนต่ำกว่าจุดสั่งซื้อ</small>
                  </div>
                  <button
                    className={`toggle ${form?.lowStockAlert ? "on" : ""}`}
                    onClick={() =>
                      updateForm({ lowStockAlert: !form?.lowStockAlert })
                    }
                    disabled={!form}
                    aria-label="แจ้งเตือนสต็อกต่ำ"
                  >
                    <span />
                  </button>
                </div>
                <div className="toggle-row">
                  <div>
                    <b>แจ้งเตือนสินค้าใกล้หมดอายุ</b>
                    <small>
                      แจ้งเตือนล่วงหน้า {form?.expiryAlertDays ?? 30} วัน
                    </small>
                  </div>
                  <button
                    className={`toggle ${form?.expiryAlert ? "on" : ""}`}
                    onClick={() =>
                      updateForm({ expiryAlert: !form?.expiryAlert })
                    }
                    disabled={!form}
                    aria-label="แจ้งเตือนใกล้หมดอายุ"
                  >
                    <span />
                  </button>
                </div>
              </section>
            </div>
          )}
          {tab === "roles" && (
            <>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>สิทธิ์ผู้ใช้</h2>
                  </div>
                  <ShieldCheck size={20} className="muted-icon" />
                </div>
                <div className="role-matrix">
                  {ROLE_MATRIX.map(entry => (
                    <div
                      className={`role-matrix-card ${entry.role}`}
                      key={entry.role}
                    >
                      <div className="role-matrix-head">
                        <span className="role-avatar small">
                          <Crown size={17} />
                        </span>
                        <div>
                          <b>{entry.title}</b>
                          <small>{entry.caption}</small>
                        </div>
                      </div>
                      <ul>
                        {entry.permits.map(permit => (
                          <li key={permit}>
                            <Check size={14} /> {permit}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel settings-card dev-warning-card">
                <div className="settings-heading">
                  <div>
                    <h2>การเข้าถึงของผู้พัฒนา</h2>
                    <p>
                      สำหรับบัญชี dev · ปิดไว้เป็นค่าเริ่มต้น
                    </p>
                  </div>
                  <Terminal size={20} className="muted-icon" />
                </div>
                <div className="dev-access-warning">
                  <ShieldCheck size={16} />
                  <span>
                    ผู้พัฒนาเข้าถึง<b>ข้อมูลทั้งหมดเท่าผู้บริหาร</b> · บันทึกทุกการเข้าสู่ระบบเป็นสีแดงในประวัติ
                  </span>
                </div>
                <div className="toggle-row">
                  <div>
                    <b>อนุญาตให้บัญชีผู้พัฒนาเข้าสู่ระบบ</b>
                    <small>
                      เปิดเฉพาะตอนซ่อมระบบ แล้วปิดเมื่อเสร็จ
                    </small>
                  </div>
                  <button
                    className={`toggle ${form?.devAccess ? "on" : ""}`}
                    onClick={toggleDevAccess}
                    disabled={!form}
                    aria-label="อนุญาตให้บัญชีผู้พัฒนาเข้าสู่ระบบ"
                  >
                    <span />
                  </button>
                </div>
                <div
                  className={`dev-status-line${form?.devAccess ? " on" : ""}`}
                >
                  <i aria-hidden="true" />
                  {form?.devAccess
                    ? "เปิดอยู่ — บัญชีผู้พัฒนาเข้าสู่ระบบได้"
                    : "ปิดอยู่ (แนะนำ) — ผู้พัฒนาเข้าสู่ระบบไม่ได้"}
                </div>
                <div className="dev-account-count">
                  บัญชีผู้พัฒนาในระบบ <b>{devAccounts.length} บัญชี</b>
                  {devAccounts.length > 0 && (
                    <span className="cell-sub">
                      {" "}
                      ·{" "}
                      {devAccounts.map(user => `@${user.username}`).join(", ")}
                    </span>
                  )}{" "}
                  · จัดการที่{" "}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setView("users")}
                  >
                    ผู้ใช้ระบบ
                  </button>
                </div>
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>การล็อกบัญชี</h2>
                  </div>
                  <LockKeyhole size={20} className="muted-icon" />
                </div>
                <div className="settings-inline-note">
                  <LockKeyhole size={16} />
                  <span>
                    รหัสผ่านผิด 5 ครั้ง ล็อกบัญชี 15 นาที · ผู้บริหารปลดล็อกได้ที่หน้าผู้ใช้ระบบ
                  </span>
                </div>
                <div className="settings-jump">
                  <button
                    className="outline-button"
                    onClick={() => setView("users")}
                  >
                    <ArrowRight size={16} /> ไปที่หน้าผู้ใช้ระบบ
                  </button>
                </div>
              </section>
              <section className="panel settings-card">
                <div className="settings-heading">
                  <div>
                    <h2>ประวัติระบบ</h2>
                    <p>
                      บันทึกกิจกรรม ผู้ทำรายการ และเวลาอัตโนมัติ
                    </p>
                  </div>
                  <Activity size={20} className="muted-icon" />
                </div>
                <div className="log-settings-grid">
                  <div className="log-settings-stat">
                    <span>รายการล่าสุดในระบบ</span>
                    <strong>
                      {logsStatsQuery.isLoading
                        ? "…"
                        : logs.length.toLocaleString("th-TH")}
                    </strong>
                    <small>แสดงไม่เกิน 200 รายการล่าสุด</small>
                  </div>
                  <div className="log-settings-stat">
                    <span>กิจกรรมล่าสุด</span>
                    <strong>
                      {lastLog ? formatLogDateTime(lastLog.createdAt) : "—"}
                    </strong>
                    <small>
                      {lastLog
                        ? `${lastLog.actor} · ${lastLog.action}`
                        : "ยังไม่มีข้อมูล"}
                    </small>
                  </div>
                </div>
                <div className="settings-jump">
                  <button
                    className="outline-button"
                    onClick={() => setView("logs")}
                  >
                    <ArrowRight size={16} /> ไปที่ประวัติระบบ
                  </button>
                </div>
              </section>
            </>
          )}
          {dirtyCount > 0 && form && (
            <div className="settings-save-bar" role="status" aria-live="polite">
              <span className="save-dot" aria-hidden="true" />
              <div className="save-bar-text">
                <b>ยังไม่ได้บันทึก · {dirtyCount} รายการ</b>
                <small>
                  แก้ไขแล้ว: {dirtyKeys.slice(0, 3).join(" · ")}
                  {dirtyCount > 3 ? ` และอีก ${dirtyCount - 3} รายการ` : ""}
                </small>
              </div>
              <div className="save-bar-actions">
                <button
                  type="button"
                  className="outline-button"
                  disabled={saveMutation.isPending}
                  onClick={discardChanges}
                >
                  ย้อนการแก้ไข
                </button>
                <ActionButton busy={saveMutation.isPending}
                  type="button"
                  className="primary-button"
                  disabled={saveMutation.isPending}
                  onClick={saveSettings}
                >
                  <Check size={16} />{" "}
                  {saveMutation.isPending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
                </ActionButton>
              </div>
            </div>
          )}
          {saved && (
            <div className="notice-bar">
              <Check size={16} /> บันทึกการตั้งค่าเรียบร้อยแล้ว
              <button onClick={() => setSaved(false)}>
                <X size={14} />
              </button>
            </div>
          )}
          {error && (
            <div className="notice-bar error">
              <ShieldCheck size={16} /> {error}
              <button onClick={() => setError("")}>
                <X size={14} />
              </button>
            </div>
          )}
          <ConfirmDialog
            open={devAccessConfirm}
            title="ยืนยันการเปิด Dev Access?"
            description="การเปิดสวิตช์นี้อนุญาตให้บัญชีผู้พัฒนา (dev) เข้าสู่ระบบและเข้าถึงข้อมูลของร้านได้ทั้งหมดเท่าผู้บริหาร · ทุกการเข้าสู่ระบบจะถูกบันทึกลงประวัติระบบ เป็นสีแดง · แนะนำให้เปิดเฉพาะช่วงที่จำเป็น แล้วปิดกลับเมื่อเสร็จ (ต้องกดบันทึกการตั้งค่าจึงมีผล)"
            confirmLabel="ยืนยันเปิด Dev Access"
            onCancel={() => setDevAccessConfirm(false)}
            onConfirm={() => {
              setDevAccessConfirm(false);
              updateForm({ devAccess: true });
            }}
          />
          <ConfirmDialog
            open={importConfirm}
            title="ยืนยันการนำเข้าข้อมูล?"
            description={`จะนำเข้า ${currentSheet ? currentSheet.totalRows.toLocaleString("th-TH") : ""} แถว จากไฟล์ ${importFile?.name ?? ""} (${importKind === "members" ? "สมาชิก" : "สินค้า"} · ${duplicateMode === "skip" ? "ข้ามรายการซ้ำ" : "อัปเดตข้อมูลที่ซ้ำ"}) · ระบบจะสำรองข้อมูลทั้งระบบเป็นไฟล์ป้องกันก่อนนำเข้าเสมอ และบันทึกการนำเข้าลง Log`}
            confirmLabel="ยืนยันนำเข้าข้อมูล"
            onCancel={() => setImportConfirm(false)}
            onConfirm={runImport}
          />
          <ConfirmDialog
            open={restoreTarget !== null}
            title="ยืนยันการกู้คืนข้อมูลจากไฟล์สำรอง?"
            description={`ข้อมูลทั้งระบบจะกลับไปเป็นช่วงเวลาของไฟล์สำรองนี้ (${restoreTarget ?? ""}) — ทุกอย่างที่ทำหลังจากนั้นจะถูกแทนที่ · ระบบจะสำรองข้อมูลปัจจุบันไว้เป็นไฟล์ป้องกันก่อนเสมอ และบันทึกการกู้คืนลง Log เป็นสีแดง · หากไฟล์สำรองเก่ากว่าเซสชันที่ใช้อยู่ อาจต้องเข้าสู่ระบบใหม่หลังกู้คืน`}
            confirmLabel="ยืนยันกู้คืนข้อมูล"
            onCancel={() => setRestoreTarget(null)}
            onConfirm={() => {
              if (restoreTarget)
                restoreBackupMutation.mutate({ file: restoreTarget });
            }}
          />
        </div>
      </div>
    </>
  );
}
