import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Activity,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
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
  FileBarChart,
  FileSpreadsheet,
  FileText,
  FileUp,
  Globe,
  HardDriveDownload,
  Image as ImageIcon,
  ImagePlus,
  LockKeyhole,
  LogOut,
  IdCard,
  KeyRound,
  LayoutDashboard,
  Lock,
  Menu,
  Monitor,
  MoreHorizontal,
  PackageSearch,
  Network,
  Palette,
  Pause,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Table2,
  Terminal,
  Trash2,
  TrendingDown,
  UserCog,
  UserPlus,
  UsersRound,
  WalletCards,
  Wifi,
  Wrench,
  X,
  CircleAlert,
  ListChecks,
  FileImage,
  QrCode,
} from "lucide-react";
import { toast } from "sonner";
import { blocker } from "@/components/BlockerAlert";

import { EDITIONS, EDITION_COMPARE_ROWS, EDITION_FEATURE_INFO, EDITION_TRIAL_DAYS, editionStatusLabel, type Edition, type EditionFeatureKey } from "@shared/editions";
import { DevKeygenTool, EditionCompareTable, EditionPill, EditionUpgradeModal, useEditionStatus } from "@/components/EditionUi";
import type { EditionStatus } from "../../../server/license";

import type { MemberLite, Role, View } from "./pageData";
import type { InstallOverview, MemberTransactionRow, SaleHistoryEntry } from "../../../server/sqliteStore";
import type { User } from "../../../drizzle/schema";
import { PRENAME_OPTIONS, canAccessView, compressImageToDataUrl, formatMemberNumber, isAdminRole, loadHeldBills, memberFullName, money, navItems, roleThaiLabel, scanCandidates } from "./pageData";
import { ConfirmDialog, SectionHeader, StatusPill, formEnterNav } from "./PagePrimitives";
import { HelpDisclosure } from "@/components/HelpDisclosure";
import { Dashboard } from "./Dashboard";
import { GlobalSearch } from "@/components/GlobalSearch";
import { ThaiDatePicker } from "@/components/ThaiDatePicker";
import { downloadReportPdf, printReportDoc, type ReportDocConfig } from "@/reportDoc";
import { ExportPreviewModal, type ExportFormat, type ExportPreviewState } from "@/components/ExportPreviewModal";
import { downloadCsvFile, downloadSlipFile, downloadXlsxFile, exportCount, exportNumber } from "@/exportUtils";
import { MemberScanPicker } from "@/components/ScanPickers";
import { LoginView } from "@/components/LoginView";
import { SetupView } from "@/components/SetupView";
import { ForceChangeView } from "@/components/ForceChangeView";
import { MemberCardModal } from "@/components/MemberCardModal";
import { StatementModal } from "@/components/StatementModal";
import { CameraCaptureModal } from "@/components/CameraCaptureModal";
import { SlipViewModal, SlipViewButton } from "@/components/SlipViewModal";
import { isValidPromptPayId } from "@/promptpay";
import { ReceiptModal } from "@/components/ReceiptModal";
import { PrintPreviewModal } from "@/components/PrintPreviewModal";
import { Pos } from "./Pos";
import { Stock } from "./Stock";
import { Users } from "./Users";
import { trpc } from "@/lib/trpc";
import { applyFontScale, FONT_SCALES, readFontScale, type FontScaleId } from "../fontScale";
import { applyBrand, applyCachedBrand, applyPaperWidth, applyThemeColor, applyUiStyle, brandInitial, PAPER_WIDTHS, resolvePaperWidth, resolveThemeColor, THEME_PRESETS, UI_STYLE_PRESETS, type BrandSettings } from "../theme";
import {
  getErrorMessage,
  isSameDay,
  isSameMonth,
  MEMBER_STATUS_META,
  formatHistoryDate,
  formatLastActivity,
  formatLogDateTime,
  formatShortDay,
  formatThaiDate,
  formatThaiMonthYear,
  nextMemberSequence,
  parseBahtFromDetail,
  parseStoreDate,
  WALLET_TX_META,
} from "./viewFormat";

export { addScannedItem, calculateCartSubtotal, canAccessView, formatMemberNumber, isStockAlert } from "./pageData";


/** Payment method → StatusPill tone for the ประวัติบิล table (Reports view). */
const PAYMENT_PILL_TONE: Record<string, string> = {
  "เงินสด": "green",
  "QR / สแกน": "blue",
  "หักบัญชีสมาชิก": "purple",
};

/** Max member rows shown in the bell dropdown before the "+N รายการเพิ่มเติม" hint. */
const MEMBER_NOTIF_LIMIT = 6;

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
  /** ROUND 56 (user) — เช็คลิสต์วันขึ้นระบบ (โซนเครื่องมือติดตั้ง): JSON รหัสรายการที่ติ๊กแล้ว */
  goliveChecks: string;
  /** ROUND 63 (user) — บัญชีพร้อมเพย์ร้าน: เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก */
  promptpayId: string;
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
  ["memberNumberResetMonth", "เดือนเริ่มรอบเลขสมาชิก"],
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
  ["helpPhone", "เบอร์ศูนย์ช่วยเหลือ"],
  ["devAccess", "การเข้าใช้งานสำหรับผู้พัฒนา"],
  ["backupAutoEnabled", "สำรองข้อมูลอัตโนมัติ"],
  ["backupIntervalHours", "รอบสำรองข้อมูลอัตโนมัติ"],
  ["backupKeepCount", "จำนวนไฟล์สำรองที่เก็บ"],
  ["receiptPaperWidth", "ความกว้างกระดาษสลิป"],
  ["goliveChecks", "เช็คลิสต์วันขึ้นระบบ"],
];

/** ROUND 75 (user) — รายการปุ่มบนรางซ้ายหน้า POS ที่ตั้งค่าเปิด/ปิดได้ (ตั้งค่า → การขายหน้าร้าน → เมนูลัดหน้าร้าน)
 *  ปุ่ม "เมนู" (Esc) ไม่อยู่ในลิสต์นี้ — เป็นทางกลับสู่ภาพรวมระบบ ใช้งานเสมอ */
const POS_RAIL_BUTTONS: { key: string; label: string; kbd: string; detail: string; icon: typeof Bell }[] = [
  { key: "scan", label: "สแกน", kbd: "F8", detail: "โฟกัสช่องสแกนบาร์โค้ด — พร้อมรับค่าเสมอ", icon: ScanLine },
  { key: "customer", label: "ลูกค้า", kbd: "F1", detail: "เลือกลูกค้า / สมาชิกสำหรับบิลนี้", icon: UsersRound },
  { key: "deposit", label: "เติมเงิน", kbd: "F2", detail: "เติมเงินเข้าบัญชีสมาชิก — มีสลิปยืนยันทุกครั้ง", icon: ArrowDownToLine },
  { key: "withdraw", label: "ถอนเงิน", kbd: "F3", detail: "ถอนเงินจากบัญชีสมาชิก — ระบบตรวจยอดก่อนทุกครั้ง", icon: ArrowUpFromLine },
  { key: "special", label: "รายการพิเศษ", kbd: "F4", detail: "ของสั่ง ค่าบริการ รายการนอกแค็ตตาล็อก — ไม่ตัดสต็อก", icon: Sparkles },
  { key: "hold", label: "พักบิล", kbd: "F5", detail: "พักบิลปัจจุบันไว้ เรียกคืนได้จากแถบใต้ช่องสแกน", icon: Pause },
  { key: "register", label: "สมาชิกใหม่", kbd: "F6", detail: "ลงทะเบียนสมาชิกใหม่ + พิมพ์บัตร — จบที่หน้าร้านจุดเดียว", icon: UserPlus },
  { key: "manage", label: "จัดแผง", kbd: "F7", detail: "จัดแผงลัดหน้าร้าน — เพิ่ม/ลบการ์ดสินค้าที่หยิบบ่อย", icon: Star },
  { key: "receive", label: "รับเข้าสินค้า", kbd: "F9", detail: "เปิดหน้ารับสินค้าเข้าโดยตรงจากหน้า POS", icon: PackageSearch },
  { key: "add", label: "เพิ่มไอเทมใหม่", kbd: "F10", detail: "เปิดหน้าเพิ่มสินค้าใหม่โดยตรงจากหน้า POS", icon: Plus },
];

function MemberDetail({ member, onBack, role, userName, onDeleted }: { member: MemberLite; onBack: () => void; role: Role; userName: string; onDeleted: (message: string) => void }) {
  const utils = trpc.useUtils();
  const detailQuery = trpc.member.detail.useQuery({ memberNumber: member.memberNumber });
  // Enhancement panel — real spending stats from sales (hidden silently on error).
  const statsQuery = trpc.member.stats.useQuery({ memberNumber: member.memberNumber }, { enabled: Boolean(member.memberNumber) });
  const [tab, setTab] = useState<"ทั้งหมด" | "ซื้อสินค้า" | "เติมเงิน" | "ถอนเงิน" | "เปิดใช้บัตร" | "คืนบัตรเงินสด">("ทั้งหมด");
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [walletOpen, setWalletOpen] = useState<"deposit" | "withdrawal" | "refund" | null>(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  // ROUND 77 (user) — สลิปเติม/ถอน/คืนบัตรที่หน้าสมาชิก: หลังบันทึกโมดัลเปลี่ยนเป็นสลิป
  // พร้อมปุ่มเหมือนใบเสร็จ (ดาวน์โหลด PDF / ดาวน์โหลดรูป / พิมพ์ผ่านพรีวิว) แทนการปิดทันที
  const [walletResult, setWalletResult] = useState<{ memberNumber: string; memberName: string; type: "deposit" | "withdrawal" | "refund"; amount: number; balanceBefore: number; balanceAfter: number; detail: string } | null>(null);
  const [walletDoneAt, setWalletDoneAt] = useState<Date | null>(null);
  const [walletSlipBusy, setWalletSlipBusy] = useState("");
  const [walletPrintPreview, setWalletPrintPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<{ prename: string; firstName: string; lastName: string; type: string; phone: string; idCard: string; gender: "ชาย" | "หญิง" | "ไม่ระบุ"; photoUrl: string; creditLimit: string; cardNumber: string; patientCode: string } | null>(null);
  // ROUND 38 (ข้อ 37) — ถ่ายรูปสมาชิกจากกล้อง ในโมดัลแก้ไขข้อมูล
  const [editCameraOpen, setEditCameraOpen] = useState(false);
  // Round 31 — เติม/ถอนจากหน้ารายละเอียดก็เป็น 2 ขั้นเหมือน POS: กรอก → ยืนยัน → บันทึก
  const [walletConfirm, setWalletConfirm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  // ROUND 34 (req 23.2) — ขอลดวงเงินซื้อสินค้าต่อวัน: 2 ขั้นเหมือนเติม/ถอน (กรอก → ยืนยัน → ส่ง)
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitStep, setLimitStep] = useState<"form" | "confirm">("form");
  const [limitValue, setLimitValue] = useState("");
  const [limitReason, setLimitReason] = useState("");
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = roleThaiLabel(role);
  const profile = detailQuery.data?.member ?? member;
  const transactions = detailQuery.data?.transactions ?? [];
  const monthPurchase = transactions.filter((tx) => tx.type === "purchase" && isSameMonth(parseStoreDate(tx.createdAt), new Date())).reduce((sum, tx) => sum - tx.amount, 0);
  const totalDeposited = transactions.filter((tx) => tx.type === "deposit" || tx.type === "activation").reduce((sum, tx) => sum + tx.amount, 0);
  const lastActivity = formatLastActivity(transactions[0]?.createdAt ?? member.lastTransactionAt);
  const displayName = memberFullName(profile);
  const statusMeta = MEMBER_STATUS_META[profile.status];
  const filtered = transactions.filter((tx) => tab === "ทั้งหมด" || WALLET_TX_META[tx.type]?.label === tab);
  const walletPreviewAmount = Number(walletAmount) || 0;
  const balanceAfterWallet = walletOpen === "deposit" ? profile.balance + walletPreviewAmount : profile.balance - walletPreviewAmount;
  // ROUND 65 — ป้ายประเภทการเติม/ถอน/คืนบัตร ใช้ร่วมกันทั้งโมดัล
  const walletModeLabel = walletOpen === "deposit" ? "เติมเงิน" : walletOpen === "refund" ? "คืนบัตรเงินสด" : "ถอนเงิน";
  const walletMutation = trpc.member.wallet.useMutation({
    onSuccess: (result) => {
      // ROUND 77 — ไม่ปิดโมดัลทันที: เปลี่ยนเป็นหน้าสลิกให้พิมพ์/ดาวน์โหลดก่อน
      setWalletResult(result);
      setWalletDoneAt(new Date());
      setWalletConfirm(false);
      setWalletAmount("");
      setWalletNote("");
      setError("");
      setNotice(`${result.type === "deposit" ? "เติมเงิน" : result.type === "refund" ? "คืนบัตรเงินสด" : "ถอนเงิน"} ${result.memberName} (${result.memberNumber}) สำเร็จ · ยอดคงเหลือ ${money(result.balanceAfter)}`);
      void utils.member.list.invalidate();
      void utils.member.detail.invalidate();
    },
    // ROUND 78 — เติม/ถอน/คืนบัตรไม่สำเร็จ (เช่น "ยอดเงินคงเหลือไม่พอ") — เด้งกลางจอ
    // ให้ชัด (notice-bar ในโมดัลยังอยู่เป็นหลักฐานหลังปิดกล่อง)
    onError: (mutationError) => { setError(getErrorMessage(mutationError)); blocker.error("บันทึกรายการไม่สำเร็จ", getErrorMessage(mutationError), { hint: "รายการนี้ยังไม่ถูกบันทึก — แก้ไขจำนวนแล้วยืนยันใหม่ได้เลย" }); },
  });
  // ROUND 77 — ปิดสลิป (และล้างผลลัพธ์) กลับไปหน้ารายละเอียดสมาชิก
  const closeWalletSlip = () => {
    setWalletOpen(null);
    setWalletResult(null);
    setWalletDoneAt(null);
    setWalletSlipBusy("");
    setWalletPrintPreview(false);
  };
  const downloadWalletSlip = async (format: "pdf" | "image") => {
    if (!walletResult) return;
    setWalletSlipBusy(format);
    try {
      const stamp = walletDoneAt
        ? `${String(walletDoneAt.getFullYear() + 543).slice(2)}${String(walletDoneAt.getMonth() + 1).padStart(2, "0")}${String(walletDoneAt.getDate()).padStart(2, "0")}-${String(walletDoneAt.getHours()).padStart(2, "0")}${String(walletDoneAt.getMinutes()).padStart(2, "0")}`
        : String(Date.now());
      const kindLabel = walletResult.type === "deposit" ? "เติมเงิน" : walletResult.type === "refund" ? "คืนบัตรเงินสด" : "ถอนเงิน";
      await downloadSlipFile("member-wallet-slip", `สลิป${kindLabel}-${walletResult.memberNumber}-${stamp}`, format);
    } finally { setWalletSlipBusy(""); }
  };
  const statusMutation = trpc.member.setStatus.useMutation({
    onSuccess: (result) => {
      const member = result?.member;
      if (!member) return;
      setNotice(`${member.status === "suspended" ? "ระงับการใช้งาน" : "คืนสถานะการใช้งาน"} ${memberFullName(member)} แล้ว`);
      void utils.member.list.invalidate();
      void utils.member.detail.invalidate();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const updateMutation = trpc.member.update.useMutation({
    onSuccess: (result) => {
      setEditOpen(false);
      setError("");
      setNotice(`บันทึกการแก้ไขข้อมูลสมาชิกเรียบร้อยแล้ว · ${memberFullName(result)}`);
      void utils.member.detail.invalidate({ memberNumber: member.memberNumber });
      void utils.member.list.invalidate();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  // ROUND 34 (req 23.2) — ยื่นคำขอลดวงเงิน: เจ้าหน้าที่ทุกคนทำได้ คำขอเข้าสถานะรอพิจารณา
  const limitRequestMutation = trpc.member.requestLimitReduction.useMutation({
    onSuccess: () => {
      setLimitOpen(false);
      setLimitStep("form");
      setLimitValue("");
      setLimitReason("");
      setError("");
      setNotice("ส่งคำขอลดวงเงินเรียบร้อย · รอผู้บริหารพิจารณา");
      void utils.member.list.invalidate();
      void utils.member.detail.invalidate();
      void utils.reports.memberTransactions.invalidate();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const deleteMutation = trpc.member.delete.useMutation({
    onSuccess: (result) => {
      void utils.member.list.invalidate();
      void utils.dashboard.stats.invalidate();
      onDeleted(`ลบสมาชิก ${result.memberName} (${result.memberNumber}) ออกจากระบบแล้ว`);
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const openEdit = () => {
    const detail = detailQuery.data?.member;
    setEditForm({ prename: detail?.prename ?? profile.prename ?? "", firstName: detail?.firstName ?? profile.firstName, lastName: detail?.lastName ?? profile.lastName, type: detail?.type ?? profile.type, phone: detail?.phone ?? "", idCard: detail?.idCard ?? "", gender: detail?.gender === "ชาย" ? "ชาย" : detail?.gender === "หญิง" ? "หญิง" : "ไม่ระบุ", photoUrl: detail?.photoUrl ?? "", creditLimit: detail?.creditLimit != null ? String(detail.creditLimit) : "", cardNumber: detail?.cardNumber ?? profile.cardNumber ?? "", patientCode: detail?.patientCode ?? profile.patientCode ?? "" });
    setError("");
    setEditOpen(true);
  };
  // Round 31 — member photo upload in the edit dialog (shrunk to a data-URL).
  const onEditPhotoPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) { setError("รองรับเฉพาะไฟล์รูป PNG JPG WEBP"); return; }
    if (file.size > 8_000_000) { setError("ไฟล์รูปใหญ่เกิน 8MB — เลือกไฟล์เล็กลง"); return; }
    compressImageToDataUrl(file, 480, 0.72).then((dataUrl) => { setEditForm((current) => (current ? { ...current, photoUrl: dataUrl } : current)); setError(""); }).catch(() => setError("อ่านไฟล์รูปไม่สำเร็จ"));
  };
  const submitEdit = () => {
    if (!editForm) return;
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) { setError("กรุณาระบุชื่อและนามสกุลสมาชิก"); return; }
    // ROUND 34 — วงเงินซื้อสินค้าต่อวัน: เว้นว่าง = ไม่จำกัด (null) ไม่งั้นต้องเป็นจำนวนเต็มบวก
    const creditLimitDraft = editForm.creditLimit.trim();
    const creditLimitValue = creditLimitDraft === "" ? null : Number(creditLimitDraft);
    if (creditLimitValue !== null && (!Number.isFinite(creditLimitValue) || !Number.isInteger(creditLimitValue) || creditLimitValue <= 0 || creditLimitValue > 1_000_000)) { setError("วงเงินต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1,000,000"); return; }
    setError("");
    updateMutation.mutate({
      memberNumber: member.memberNumber,
      prename: editForm.prename.trim() || null,
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
      idCard: editForm.idCard.trim() || null,
      phone: editForm.phone.trim() || null,
      type: editForm.type,
      gender: editForm.gender,
      photoUrl: editForm.photoUrl || null,
      creditLimit: creditLimitValue,
      cardNumber: editForm.cardNumber.trim() || null,
      patientCode: editForm.patientCode.trim() || null,
      actor,
      actorRole,
    });
  };
  const submitWallet = () => {
    if (!walletOpen) return;
    const amount = Number(walletAmount);
    if (!(amount > 0)) { setError("กรุณาระบุจำนวนเงินมากกว่า 0"); return; }
    if (walletOpen !== "deposit" && amount > profile.balance) { setError(`ยอดเงินคงเหลือไม่พอ · ${walletOpen === "refund" ? "คืนบัตร" : "ถอน"} ${money(amount)} คงเหลือ ${money(profile.balance)}`); return; }
    setError("");
    setWalletConfirm(true);
  };
  const confirmWallet = () => {
    if (!walletOpen || !(Number(walletAmount) > 0)) { setWalletConfirm(false); return; }
    walletMutation.mutate({ memberNumber: member.memberNumber, type: walletOpen, amount: Number(walletAmount), note: walletNote.trim() || undefined, actor, actorRole });
  };
  // ROUND 34 (req 23.2) — ขอลดวงเงิน: เปิดโมดัล + ตรวจข้อมูลก่อนขั้นยืนยัน + ส่งคำขอ
  const openLimitDialog = () => { setLimitValue(""); setLimitReason(""); setLimitStep("form"); setError(""); setLimitOpen(true); };
  const submitLimitRequest = () => {
    const value = Number(limitValue);
    if (limitValue.trim() === "" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > 1_000_000) { setError("วงเงินใหม่ต้องเป็นตัวเลขจำนวนเต็มมากกว่า 0 และไม่เกิน 1,000,000"); return; }
    if (profile.creditLimit != null && value >= profile.creditLimit) { setError(`วงเงินใหม่ต้องน้อยกว่าวงเงินปัจจุบัน (${money(profile.creditLimit)})`); return; }
    setError("");
    setLimitStep("confirm");
  };
  const confirmLimitRequest = () => {
    const value = Number(limitValue);
    if (!Number.isInteger(value) || value <= 0) { setLimitStep("form"); return; }
    limitRequestMutation.mutate({ memberNumber: member.memberNumber, requestedLimit: value, reason: limitReason.trim() || undefined, actor, actorRole });
  };
  return <><SectionHeader eyebrow="สมาชิกและบัญชี / รายละเอียด" title={`รายละเอียด ${displayName}`} description="ตรวจสอบประวัติการซื้อสินค้า เติมเงิน และถอนเงินของสมาชิกแต่ละราย" action={<button className="outline-button" onClick={onBack}><ArrowDownToLine size={16} style={{ transform: "rotate(90deg)" }} /> กลับไปรายการสมาชิก</button>} /><div className="member-detail-head"><div className="member-detail-profile"><span className="member-detail-avatar">{profile.firstName.slice(0, 1)}</span><div><span className="eyebrow">{profile.type} · {profile.memberNumber}</span><h2>{displayName}</h2><p>บัตร <b className="cell-mono">{profile.cardNumber ?? "—"}</b> · รหัสผู้ป่วย <b className="cell-mono">{profile.patientCode ?? "—"}</b> · เปิดใช้ {formatThaiDate(profile.createdAt)}<br />สถานะ <StatusPill tone={statusMeta.tone}>{statusMeta.label}</StatusPill> <span className="member-limit-chip" title="วงเงินซื้อสินค้าต่อวันของสมาชิกนี้ (ชำระหักบัญชี) — เว้นว่างคือไม่จำกัด">วงเงินซื้อ/วัน {profile.creditLimit != null ? money(profile.creditLimit) : "ไม่จำกัด"}</span></p></div></div><div className="member-detail-actions"><button className="primary-button" disabled={profile.status !== "active"} onClick={() => { setWalletOpen("deposit"); setWalletConfirm(false); setWalletResult(null); setError(""); }}><ArrowDownToLine size={15} /> เติมเงิน</button><button className="outline-button" disabled={profile.status !== "active"} onClick={() => { setWalletOpen("withdrawal"); setWalletConfirm(false); setWalletResult(null); setError(""); }}><ArrowUpFromLine size={15} /> ถอนเงิน</button><button className="outline-button refund-card-button" disabled={profile.status !== "active" || profile.balance <= 0} onClick={() => { setWalletOpen("refund"); setWalletAmount(profile.balance > 0 ? String(profile.balance) : ""); setWalletConfirm(false); setWalletResult(null); setError(""); }} title="ผู้ป่วยคืนบัตรเมื่อออกจากโรงพยาบาล — จ่ายเงินสดคืนตามยอดคงเหลือ แล้วยอดเหลือเป็น 0"><IdCard size={15} /> คืนบัตรเงินสด</button><button className="outline-button" onClick={openLimitDialog} title="ยื่นคำขอลดวงเงินซื้อสินค้าต่อวัน — รอผู้บริหารพิจารณา"><TrendingDown size={15} /> ขอลดวงเงิน</button>{profile.status === "active" ? <button className="danger-outline-button" onClick={() => setConfirmStatus(true)}><LockKeyhole size={15} /> ระงับการใช้งาน</button> : <button className="outline-button" onClick={() => setConfirmStatus(true)}><Check size={15} /> คืนสถานะ</button>}<button className="outline-button" onClick={openEdit}><Settings2 size={15} /> แก้ไขข้อมูลสมาชิก</button><button className="outline-button" disabled={detailQuery.isLoading} onClick={() => setStatementOpen(true)}><FileText size={15} /> ส่งออกรายงานธุรกรรม</button><button className="outline-button" onClick={() => setCardOpen(true)}><IdCard size={15} /> พิมพ์บัตรสมาชิก</button>{isAdminRole(role) && <button className="danger-outline-button" onClick={() => { setConfirmDelete(true); setError(""); }}><Trash2 size={15} /> ลบสมาชิก</button>}</div></div>{error && !walletOpen && !editOpen && !limitOpen && <div className="notice-bar error" style={{ marginBottom: 14 }}><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="member-detail-stats"><div><span className="stat-icon green"><WalletCards size={18} /></span><div><small>ยอดเงินคงเหลือ</small><strong>{money(profile.balance)}</strong></div></div><div><span className="stat-icon blue"><ShoppingCart size={18} /></span><div><small>ยอดซื้อเดือนนี้</small><strong>{money(monthPurchase)}</strong></div></div><div><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>เติมเงินสะสม</small><strong>{money(totalDeposited)}</strong></div></div><div><span className="stat-icon amber"><CalendarDays size={18} /></span><div><small>รายการล่าสุด</small><strong>{lastActivity}</strong></div></div></div>{statsQuery.isLoading ? <div className="member-detail-stats member-purchase-stats" aria-busy="true">{Array.from({ length: 4 }, (_, index) => <div key={`stat-skeleton-${index}`}><span className="skeleton-avatar" /><div className="member-stat-skeleton"><span className="skeleton-cell-n" /><span className="skeleton-cell-w" /></div></div>)}</div> : statsQuery.data ? <div className="member-detail-stats member-purchase-stats"><div><span className="stat-icon blue"><ReceiptText size={18} /></span><div><small>ยอดซื้อสะสม</small><strong>{money(statsQuery.data.totalSpent)}</strong></div></div><div><span className="stat-icon green"><ShoppingBag size={18} /></span><div><small>จำนวนบิล</small><strong>{statsQuery.data.billCount} บิล</strong></div></div><div><span className="stat-icon purple"><CalendarDays size={18} /></span><div><small>ซื้อครั้งล่าสุด</small><strong>{statsQuery.data.lastPurchaseAt ? formatHistoryDate(statsQuery.data.lastPurchaseAt) : "ยังไม่เคยซื้อ"}</strong></div></div><div><span className="stat-icon amber"><Star size={18} /></span><div className="member-top-products"><small>สินค้าที่ซื้อบ่อย</small>{statsQuery.data.topProducts.length === 0 ? <span className="top-products-empty">ยังไม่มีประวัติการซื้อสินค้า</span> : <div className="top-products-list">{statsQuery.data.topProducts.map((product) => <span className="top-product-chip" key={product.name}>{product.name} <b>×{product.qty}</b></span>)}</div>}</div></div></div> : null}<section className="panel table-panel member-history-panel"><div className="table-toolbar"><div><h2>ประวัติการทำรายการ</h2><p>ข้อมูลย้อนหลังของ {displayName} · รวม {transactions.length} รายการ</p></div><div className="filter-pills history-tabs">{["ทั้งหมด", "ซื้อสินค้า", "เติมเงิน", "ถอนเงิน", "เปิดใช้บัตร", "คืนบัตรเงินสด"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item as typeof tab)}>{item}</button>)}</div></div><div className="member-history-list">{detailQuery.isLoading ? <div className="table-loading"><ReceiptText size={22} /><b>กำลังโหลดประวัติการทำรายการ</b><span>ดึงข้อมูลธุรกรรมของสมาชิกจากระบบ</span></div> : filtered.length === 0 ? <div className="table-loading"><ReceiptText size={22} /><b>ไม่พบรายการตามเงื่อนไข</b><span>ลองเปลี่ยนแท็บหรือทำรายการผ่าน POS</span></div> : filtered.map((transaction) => { const meta = WALLET_TX_META[transaction.type] ?? { label: transaction.type, tone: "blue" }; return <div className="history-row" key={transaction.id}><span className={`history-icon ${meta.tone}`}>{transaction.type === "purchase" ? <ShoppingCart size={16} /> : transaction.type === "deposit" ? <ArrowDownToLine size={16} /> : transaction.type === "activation" ? <IdCard size={16} /> : <ArrowUpFromLine size={16} />}</span><div className="history-main"><div><b>{meta.label}</b><span>{`TX-${String(transaction.id).padStart(3, "0")}`}</span></div><small>{transaction.detail}</small><time>{formatHistoryDate(transaction.createdAt)}</time></div>{transaction.hasSlip === 1 && <SlipViewButton kind="tx" id={transaction.id} title={`หลักฐาน${meta.label}`} subtitle={`${profile.memberNumber} · ${formatHistoryDate(transaction.createdAt)}`} />}<strong className={transaction.amount > 0 ? "positive" : "negative"}>{transaction.amount > 0 ? "+ " : "- "}{money(Math.abs(transaction.amount))}</strong></div>; })}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section>{walletOpen && <div className="modal-backdrop" onClick={closeWalletSlip}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">{walletResult ? (walletResult.type === "deposit" ? "WALLET SLIP · DEPOSIT" : walletResult.type === "refund" ? "WALLET SLIP · REFUND" : "WALLET SLIP · WITHDRAWAL") : "WALLET TRANSACTION"}</span><h2>{walletResult ? (walletResult.type === "deposit" ? "สลิปเติมเงิน" : walletResult.type === "refund" ? "สลิปคืนบัตรเงินสด" : "สลิปถอนเงิน") : walletOpen === "deposit" ? "เติมเงินเข้าบัญชีสมาชิก" : walletOpen === "refund" ? "คืนบัตรเงินสด (จ่ายเงินคืนผู้ป่วย)" : "ถอนเงินจากบัญชีสมาชิก"}</h2><p>{walletResult ? `${walletResult.memberName} · ${walletResult.memberNumber} · บันทึกเรียบร้อย` : `${displayName} · ${profile.memberNumber} · ยอดคงเหลือ ${money(profile.balance)}${walletOpen === "refund" ? " · บัตรที่คืนต้องเหลือยอด 0" : ""}`}</p></div><button className="icon-button" onClick={closeWalletSlip}><X size={17} /></button></div>{walletResult ? <><div className="wallet-success"><div className="receipt-paper wallet-slip" id="member-wallet-slip"><div className="receipt-success slip"><span>{walletResult.type === "deposit" ? <ArrowDownToLine size={22} /> : <ArrowUpFromLine size={22} />}</span><div><b>{walletResult.type === "deposit" ? "เติมเงินสำเร็จ" : walletResult.type === "refund" ? "คืนบัตรเงินสดสำเร็จ" : "ถอนเงินสำเร็จ"}</b><small>บันทึกลงรายการธุรกรรมของสมาชิกแล้ว</small></div></div><div className="receipt-divider" /><div className="receipt-meta"><span>{walletResult.type === "deposit" ? "ใบยืนยันการเติมเงิน" : walletResult.type === "refund" ? "ใบยืนยันการคืนบัตรเงินสด" : "ใบยืนยันการถอนเงิน"}</span><b>{walletDoneAt ? `${walletDoneAt.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })} · ${walletDoneAt.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น.` : ""}</b></div><div className="receipt-customer"><span>สมาชิก</span><b>{walletResult.memberName} · {walletResult.memberNumber}</b></div><div className="receipt-line"><span>{walletResult.type === "deposit" ? "จำนวนเงินที่เติม" : walletResult.type === "refund" ? "จำนวนเงินที่คืน" : "จำนวนเงินที่ถอน"}</span><b>{money(walletResult.amount)}</b></div><div className="receipt-line"><span>ยอดคงเหลือก่อนรายการ</span><b>{money(walletResult.balanceBefore)}</b></div><div className="receipt-total"><span>ยอดคงเหลือหลังรายการ</span><b>{money(walletResult.balanceAfter)}</b></div><div className="receipt-payment"><span>ผู้ทำรายการ</span><b>{actor} · {actorRole}</b></div><div className="receipt-thanks">บันทึกเข้าระบบเรียบร้อย ตรวจสอบยอดได้ที่ประวัติการทำรายการด้านล่าง<br /><small>ข้อมูลถูกบันทึกในระบบ Log แล้ว</small></div></div><div className="wallet-success-actions"><button className="outline-button" disabled={Boolean(walletSlipBusy)} onClick={() => void downloadWalletSlip("pdf")}><Download size={16} /> {walletSlipBusy === "pdf" ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}</button><button className="outline-button" disabled={Boolean(walletSlipBusy)} onClick={() => void downloadWalletSlip("image")}><FileImage size={16} /> {walletSlipBusy === "image" ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปภาพ"}</button><button className="outline-button" onClick={() => setWalletPrintPreview(true)}><Printer size={16} /> พิมพ์สลิป</button><button className="primary-button" onClick={closeWalletSlip}><Check size={16} /> เสร็จสิ้น · ปิดหน้าต่าง</button></div></div></> : walletConfirm ? <><div className="wallet-confirm-warning"><ShieldCheck size={16} /><span>ยอดเงินจะยังไม่ถูกบันทึกเข้าบัญชี จนกว่าจะกด “ยืนยันการทำรายการ”</span></div><div className="wallet-confirm-rows"><div><span>ประเภทรายการ</span><b className={walletOpen === "deposit" ? "green-text" : "amber-text"}>{walletModeLabel}</b></div><div><span>สมาชิก</span><b>{displayName} · {profile.memberNumber}</b></div><div><span>จำนวนเงิน</span><b>{money(walletPreviewAmount)}</b></div><div><span>ยอดคงเหลือก่อนรายการ</span><b>{money(profile.balance)}</b></div><div><span>ยอดคงเหลือหลังยืนยัน</span><b className={balanceAfterWallet < 0 ? "red-text" : ""}>{money(balanceAfterWallet)}</b></div><div><span>ผู้ทำรายการ</span><b>{actor} · {actorRole}</b></div>{walletNote.trim() && <div><span>หมายเหตุ</span><b>{walletNote.trim()}</b></div>}</div>{balanceAfterWallet < 0 && <div className="notice-bar error"><ShieldCheck size={16} /> ยอดเงินคงเหลือไม่พอสำหรับถอนจำนวนนี้ — ย้อนกลับแก้ไขจำนวนเงิน<button onClick={() => setError("")}><X size={14} /></button></div>}{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setWalletConfirm(false)}><RotateCcw size={15} /> ย้อนกลับแก้ไข</button><button className="primary-button" disabled={walletMutation.isPending || balanceAfterWallet < 0} onClick={confirmWallet}><Check size={16} /> {walletMutation.isPending ? "กำลังบันทึก…" : "ยืนยันการทำรายการ"}</button></div></> : <><div className="member-number-preview"><span><WalletCards size={16} /> ยอดคงเหลือหลังรายการ</span><b className={balanceAfterWallet < 0 ? "red-text" : ""}>{money(balanceAfterWallet)}</b></div>{balanceAfterWallet < 0 && <div className="notice-bar error"><ShieldCheck size={16} /> ยอดเงินคงเหลือไม่พอสำหรับถอนจำนวนนี้<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="form-grid compact-form"><label>จำนวนเงิน (฿) *<input autoFocus type="number" min="0" step="0.01" value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitWallet(); } }} placeholder="0.00" /></label><label className="wide">หมายเหตุ<input value={walletNote} onChange={(event) => setWalletNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitWallet(); } }} placeholder={walletOpen === "deposit" ? "เช่น เติมเงินสดที่เคาน์เตอร์" : walletOpen === "refund" ? "เช่น ผู้ป่วยคืนบัตร ออกจากโรงพยาบาลแล้ว" : "เช่น ถอนเพื่อใช้จ่ายส่วนตัว"} /></label></div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setWalletOpen(null)}>ยกเลิก</button><button className="primary-button" disabled={walletMutation.isPending || !(Number(walletAmount) > 0) || balanceAfterWallet < 0} onClick={submitWallet}><Check size={16} /> {walletMutation.isPending ? "กำลังบันทึก…" : walletOpen === "deposit" ? "บันทึกการเติมเงิน" : walletOpen === "refund" ? "ยืนยันคืนบัตรเงินสด" : "บันทึกการถอนเงิน"}</button></div></>}</div></div>}<ConfirmDialog open={confirmStatus} title={profile.status === "active" ? "ยืนยันการระงับสมาชิก?" : "ยืนยันการคืนสถานะสมาชิก?"} description={profile.status === "active" ? `สมาชิก ${displayName} จะไม่สามารถใช้ยอดคงเหลือซื้อสินค้าได้จนกว่าจะเปิดใช้งานอีกครั้ง` : `สมาชิก ${displayName} จะสามารถใช้ยอดคงเหลือซื้อสินค้าและรับการเติมเงินได้อีกครั้ง`} confirmLabel={profile.status === "active" ? "ยืนยันระงับการใช้งาน" : "ยืนยันคืนสถานะการใช้งาน"} onCancel={() => setConfirmStatus(false)} onConfirm={() => { setConfirmStatus(false); statusMutation.mutate({ memberNumber: member.memberNumber, suspended: profile.status === "active", actor, actorRole }); }} />{editOpen && editForm && <div className="modal-backdrop" onClick={() => setEditOpen(false)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">EDIT MEMBER</span><h2>แก้ไขข้อมูลสมาชิก</h2><p>{displayName} · {profile.memberNumber}</p></div><button className="icon-button" onClick={() => setEditOpen(false)}><X size={17} /></button></div><div className="form-grid compact-form" onKeyDownCapture={(event) => formEnterNav(event, submitEdit)}><label>คำนำหน้า<input list="prename-options" value={editForm.prename} onChange={(event) => setEditForm({ ...editForm, prename: event.target.value })} placeholder="เช่น นาย / นาง / นางสาว" maxLength={30} title="คำนำหน้าชื่อสมาชิก — เลือกจากรายการหรือพิมพ์เอง เว้นว่างได้" /><datalist id="prename-options">{PRENAME_OPTIONS.map((option) => <option key={option} value={option} />)}</datalist></label><label>ชื่อ *<input autoFocus value={editForm.firstName} onChange={(event) => setEditForm({ ...editForm, firstName: event.target.value })} placeholder="ชื่อ" /></label><label>นามสกุล *<input value={editForm.lastName} onChange={(event) => setEditForm({ ...editForm, lastName: event.target.value })} placeholder="นามสกุล" /></label><label>ประเภทสมาชิก<select value={editForm.type} onChange={(event) => setEditForm({ ...editForm, type: event.target.value })}><option>สมาชิก</option><option>เจ้าหน้าที่</option></select></label><label>วงเงินซื้อสินค้าต่อวัน (บาท)<input type="number" inputMode="numeric" min="1" step="1" value={editForm.creditLimit} onChange={(event) => setEditForm({ ...editForm, creditLimit: event.target.value })} placeholder="เว้นว่าง = ไม่จำกัด" title="ยอดซื้อรวมต่อวันเมื่อชำระหักบัญชีสมาชิก · เว้นว่าง = ไม่จำกัด" /></label><label>เบอร์โทรศัพท์<input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} placeholder="เช่น 08x-xxx-xxxx" /></label><label>รหัสบัตรเงินสด<input value={editForm.cardNumber} onChange={(event) => setEditForm({ ...editForm, cardNumber: event.target.value })} placeholder="เช่น 2395100201" maxLength={30} title="รหัสบัตรเงินสดของสมาชิก — ใช้ค้นหาและขึ้นรายงานยอดเงินในบัตร" /></label><label>รหัสผู้ป่วย (HN)<input value={editForm.patientCode} onChange={(event) => setEditForm({ ...editForm, patientCode: event.target.value })} placeholder="เช่น 70001" maxLength={30} title="รหัสผู้ป่วยที่ผูกกับบัตร — แสดงในรายงานยอดเงินในบัตร" /></label><label className="wide">เลขที่บัตรประชาชน<input value={editForm.idCard} onChange={(event) => setEditForm({ ...editForm, idCard: event.target.value })} placeholder="-" /></label><label className="wide">รูปสมาชิก (แสดงบนบัตร)<div className="member-photo-uploader">{editForm.photoUrl ? <><img className="member-photo-preview" src={editForm.photoUrl} alt="รูปสมาชิกปัจจุบัน" /><div className="member-photo-actions"><div className="photo-action-row"><button type="button" className="outline-button compact" onClick={() => setEditCameraOpen(true)}><Camera size={15} /> ถ่ายใหม่จากกล้อง</button><button type="button" className="danger-outline-button compact" onClick={() => setEditForm((current) => (current ? { ...current, photoUrl: "" } : current))}><Trash2 size={15} /> ลบรูป</button></div></div></> : <><div className="photo-action-row"><label className="upload-drop member-photo-drop" htmlFor="edit-member-photo"><ImagePlus size={17} /><span><b>เลือกรูปจากไฟล์</b><small>PNG JPG WEBP · ระบบย่อ 480px อัตโนมัติ</small></span><input id="edit-member-photo" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onEditPhotoPick} /></label></div><button type="button" className="outline-button compact camera-hint-inline" onClick={() => setEditCameraOpen(true)}><Camera size={15} /> หรือถ่ายรูปจากกล้องเลย</button></>}</div></label></div><div className="initial-balance-note"><ShieldCheck size={15} /> การแก้ไขจะบันทึกลงระบบทันทีและบันทึกลง Log</div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setEditOpen(false)}>ยกเลิก</button><button className="primary-button" disabled={updateMutation.isPending || !editForm.firstName.trim() || !editForm.lastName.trim()} onClick={submitEdit}><Check size={16} /> {updateMutation.isPending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div></div></div>}{walletPrintPreview && walletResult && <PrintPreviewModal targetId="member-wallet-slip" title={walletResult.type === "deposit" ? "พรีวิวก่อนพิมพ์สลิปเติมเงิน" : walletResult.type === "refund" ? "พรีวิวก่อนพิมพ์สลิปคืนบัตรเงินสด" : "พรีวิวก่อนพิมพ์สลิปถอนเงิน"} subtitle={`${walletResult.memberName} · ${walletResult.memberNumber} · ${money(walletResult.amount)}`} paper="thermal" chips={[walletResult.type === "deposit" ? "เติมเงินเข้าบัญชีสมาชิก" : walletResult.type === "refund" ? "คืนบัตรเงินสด" : "ถอนเงินจากบัญชีสมาชิก", `คงเหลือ ${money(walletResult.balanceAfter)}`]} onClose={() => setWalletPrintPreview(false)} />}{editCameraOpen && <CameraCaptureModal open title={`ถ่ายรูปสมาชิก · ${displayName}`} hint="ตรวจสอบรูปก่อนกด “ใช้รูปนี้” — รูปจะแทนที่รูปเดิมของสมาชิกทันทีในฟอร์ม (ยังไม่บันทึกจนกดบันทึกการแก้ไข)" onClose={() => setEditCameraOpen(false)} onCapture={(dataUrl) => { setEditForm((current) => (current ? { ...current, photoUrl: dataUrl } : current)); setError(""); }} />}{limitOpen && <div className="modal-backdrop" onClick={() => setLimitOpen(false)}><div className="form-modal limit-dialog" role="dialog" aria-modal="true" aria-label="ยื่นคำขอลดวงเงินซื้อสินค้าต่อวัน" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">LIMIT REDUCTION REQUEST</span><h2>ขอลดวงเงินซื้อสินค้าต่อวัน</h2><p>{displayName} · {profile.memberNumber}</p></div><button className="icon-button" onClick={() => setLimitOpen(false)} aria-label="ปิดหน้าต่าง"><X size={17} /></button></div><div className="member-number-preview"><span><TrendingDown size={16} /> วงเงินซื้อ/วัน ปัจจุบัน</span><b>{profile.creditLimit != null ? money(profile.creditLimit) : "ไม่จำกัด"}</b></div>{limitStep === "form" ? <><div className="form-grid compact-form"><label>วงเงินใหม่ (฿) *<input autoFocus type="number" inputMode="numeric" min="1" step="1" value={limitValue} onChange={(event) => setLimitValue(event.target.value)} placeholder={profile.creditLimit != null ? "ต่ำกว่าวงเงินปัจจุบัน" : "0"} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitLimitRequest(); } }} /></label><label>เหตุผล (ไม่บังคับ)<input value={limitReason} maxLength={500} onChange={(event) => setLimitReason(event.target.value)} placeholder="เช่น ขอควบคุมการใช้จ่ายของตนเอง" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitLimitRequest(); } }} /></label></div><div className="initial-balance-note"><CircleHelp size={15} /> {profile.creditLimit != null ? "วงเงินใหม่ต้องน้อยกว่าวงเงินปัจจุบัน · คำขอจะเข้าสถานะรอพิจารณา — วงเงินเปลี่ยนเมื่อผู้บริหารอนุมัติ" : "สมาชิกนี้ยังไม่จำกัดวงเงิน — ระบุวงเงินที่ต้องการ · คำขอจะเข้าสถานะรอพิจารณา ผู้บริหารพิจารณาที่รายงาน → ประวัติธุรกรรม"}</div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setLimitOpen(false)}>ยกเลิก</button><button className="primary-button" onClick={submitLimitRequest}><Check size={16} /> ต่อไป: ตรวจสอบคำขอ</button></div></> : <><div className="wallet-confirm-warning"><ShieldCheck size={16} /><span>คำขอจะยังไม่ถูกส่งจนกว่าจะกด “ส่งคำขอ” — วงเงินของสมาชิกยังไม่เปลี่ยนจนกว่าผู้บริหารจะอนุมัติ</span></div><div className="wallet-confirm-rows"><div><span>สมาชิก</span><b>{displayName} · {profile.memberNumber}</b></div><div><span>วงเงินปัจจุบัน</span><b>{profile.creditLimit != null ? money(profile.creditLimit) : "ไม่จำกัด"}</b></div><div><span>วงเงินใหม่ที่ขอ</span><b className="purple-text">{money(Number(limitValue) || 0)}</b></div>{limitReason.trim() && <div><span>เหตุผล</span><b>{limitReason.trim()}</b></div>}<div><span>ผู้ยื่นคำขอ</span><b>{actor} · {actorRole}</b></div></div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setLimitStep("form")}>ย้อนกลับ</button><button className="primary-button" disabled={limitRequestMutation.isPending} onClick={confirmLimitRequest}><Check size={16} /> {limitRequestMutation.isPending ? "กำลังส่งคำขอ…" : "ส่งคำขอ"}</button></div></>}</div></div>}<ConfirmDialog open={confirmDelete} title="ยืนยันการลบสมาชิก?" description={`ลบ ${displayName} (${member.memberNumber}) ออกจากระบบถาวร · ลบได้เฉพาะบัญชีที่ยอดเงินเป็น 0 และไม่มีประวัติธุรกรรม หากมีประวัติการใช้งาน แนะนำใช้การระงับการใช้งานแทน`} confirmLabel="ยืนยันลบสมาชิก" onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); deleteMutation.mutate({ memberNumber: member.memberNumber, actor, actorRole }); }} />{cardOpen && <MemberCardModal member={detailQuery.data?.member ?? { ...member, createdAt: new Date().toISOString() }} onClose={() => setCardOpen(false)} />}{statementOpen && <StatementModal member={detailQuery.data?.member ?? { ...member, createdAt: new Date().toISOString() }} transactions={transactions} onClose={() => setStatementOpen(false)} />}</>;
}

function Members({ role, userName, focusMemberNumber, onFocusMemberConsumed }: { role: Role; userName: string; focusMemberNumber: string | null; onFocusMemberConsumed: () => void }) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ทั้งหมด");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Round 32-16 — ลงทะเบียนสมาชิกใหม่+พิมพ์บัตร อยู่ที่ POS จุดเดียว (F6) แล้ว
  // หน้านี้คงไว้เฉพาะการจัดการสมาชิกที่มีอยู่ (ดูรายละเอียด เติม/ถอน ระงับ พิมพ์บัตร)
  const [selectedMember, setSelectedMember] = useState<MemberLite | null>(null);
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = roleThaiLabel(role);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(scanCandidates(query.trim()).pop() ?? query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);
  const allMembersQuery = trpc.member.list.useQuery();
  const statusParam = statusFilter === "ใช้งาน" ? "active" : statusFilter === "ระงับ" ? "suspended" : undefined;
  const hasFilter = Boolean(debouncedSearch) || statusParam !== undefined;
  const filteredQuery = trpc.member.list.useQuery(hasFilter ? { search: debouncedSearch || undefined, status: statusParam } : undefined, { placeholderData: (previous) => previous });
  const allMembers = allMembersQuery.data ?? [];
  useEffect(() => {
    if (!focusMemberNumber || allMembersQuery.isLoading || !allMembersQuery.isSuccess) return;
    const match = allMembers.find((row) => row.memberNumber === focusMemberNumber);
    if (match) setSelectedMember(match);
    onFocusMemberConsumed();
  }, [focusMemberNumber, allMembersQuery.isLoading, allMembersQuery.isSuccess, allMembers, onFocusMemberConsumed]);
  // Round 31 — sidebar “เพิ่มสมาชิกใหม่” lands here: open the register modal once.
  const rows = hasFilter ? (filteredQuery.data ?? []) : allMembers;
  const walletTotal = allMembers.reduce((sum, member) => sum + member.balance, 0);
  const activeCount = allMembers.filter((member) => member.status === "active").length;
  const suspendedCount = allMembers.length - activeCount;
  const newThisMonth = allMembers.filter((member) => isSameMonth(parseStoreDate(member.createdAt), new Date())).length;
  if (selectedMember) return <MemberDetail member={selectedMember} onBack={() => setSelectedMember(null)} role={role} userName={userName} onDeleted={(message) => { setSelectedMember(null); setNotice(message); }} />;
  return <><SectionHeader eyebrow="สมาชิกและบัญชีสวัสดิการ" title="จัดการสมาชิก" description="ดูรายละเอียด เติม/ถอนเงิน ระงับการใช้งาน และพิมพ์บัตรสมาชิกรายคน — ลงทะเบียนสมาชิกใหม่+พิมพ์บัตร ทำที่ POS · ขายสินค้า (F6) จุดเดียว" /><div className="member-scope-note compact" role="note"><span className="member-scope-icon"><IdCard size={16} /></span><div><b>ระบบสมาชิกแยกจากผู้ใช้ระบบ</b></div><HelpDisclosure id="members-scope-help" label="ดูรายละเอียด"><span>บัญชีสมาชิกสวัสดิการใช้เพื่อใช้จ่ายที่เคาน์เตอร์เท่านั้น — สมาชิกไม่มีบัญชีเข้าสู่ระบบแอปนี้ · แอปนี้สำหรับเจ้าหน้าที่และผู้บริหารร้านค้า (จัดการบัญชีเข้าสู่ระบบที่เมนูผู้ใช้ระบบ)</span></HelpDisclosure></div><div className="member-top-grid"><div className="member-balance-card"><div><span className="eyebrow">ยอดเงินในบัญชีสมาชิกทั้งหมด</span><strong>{money(walletTotal)}</strong><small>สมาชิกใช้งาน {activeCount} ราย · ระงับ {suspendedCount} ราย</small></div><div className="balance-orb"><WalletCards size={26} /></div></div><div className="member-mini-card"><span className="stat-icon green"><UsersRound size={18} /></span><div><small>สมาชิกทั้งหมด</small><strong>{allMembers.length.toLocaleString("th-TH")} <em>ราย</em></strong><p><span className="green-text">{activeCount} ใช้งาน</span> · {suspendedCount} ระงับ</p></div></div><div className="member-mini-card"><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>ลงทะเบียนเดือนนี้</small><strong>{newThisMonth} <em>ราย</em></strong><p>ลงทะเบียนที่ POS (F6) · ดูยอดรวมได้ในรายงาน</p></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>สมาชิกทั้งหมด</h2><p>ค้นหาและกรองตามสถานะการใช้งานได้ทันที</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ เลขสมาชิก หรือพิมพ์เลขบางส่วน/ท้ายเลข" /></div><div className="filter-pills">{["ทั้งหมด", "ใช้งาน", "ระงับ"].map((item) => <button className={statusFilter === item ? "active" : ""} key={item} onClick={() => setStatusFilter(item)}>{item}{item === "ใช้งาน" && <span>{activeCount}</span>}{item === "ระงับ" && <span>{suspendedCount}</span>}</button>)}</div></div></div><div className="table-filter-summary"><span><Search size={13} /> {query ? `ค้นหา “${query}”` : "สมาชิกทั้งหมด · กดแถวเพื่อดูรายละเอียด เติม/ถอนเงิน"}</span><span>แสดง {rows.length} จาก {allMembers.length} รายการ</span></div><div className="table-wrap">{allMembersQuery.isLoading ? <div className="table-loading"><UsersRound size={22} /><b>กำลังโหลดรายการสมาชิก</b><span>ดึงข้อมูลจากระบบ</span></div> : allMembersQuery.isError ? <div className="entity-state error" role="alert"><ShieldCheck size={22} /><b>โหลดรายการสมาชิกไม่สำเร็จ</b><span>{getErrorMessage(allMembersQuery.error)}</span></div> : rows.length === 0 ? <div className="entity-state"><UsersRound size={22} /><b>ไม่พบสมาชิกตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ · ลงทะเบียนใหม่ที่ POS (F6)</span></div> : <table className="entity-table rows-members" aria-label="รายการสมาชิก"><thead><tr><th>หมายเลขสมาชิก</th><th>ชื่อ-นามสกุล</th><th>สถานะ</th><th className="num">ยอดเงินคงเหลือ</th><th className="hide-sm">รายการล่าสุด</th><th aria-label="เปิดรายละเอียด" /></tr></thead><tbody>{rows.map((row) => { const statusMeta = MEMBER_STATUS_META[row.status]; return <tr className="clickable" key={row.memberNumber} onClick={() => setSelectedMember(row)} title={`ดูรายละเอียด ${memberFullName(row)} — เติม/ถอนเงิน พิมพ์บัตรสมาชิก`}><td className="cell-mono">{row.memberNumber}{row.cardNumber && <small className="cell-sub cell-mono-line">{`บัตร ${row.cardNumber}`}</small>}</td><td><span className="cell-strong">{memberFullName(row)}</span><small className="cell-sub">{row.type}{row.patientCode ? ` · HN ${row.patientCode}` : ""}</small></td><td><StatusPill tone={statusMeta.tone}>{statusMeta.label}</StatusPill></td><td className="cell-num"><span className={row.balance < 0 ? "negative" : ""}>{money(row.balance)}</span></td><td className="hide-sm"><small className="cell-sub" style={{ marginTop: 0 }}>{formatLastActivity(row.lastTransactionAt)}</small></td><td><span className="row-chevron"><ArrowRight size={15} /></span></td></tr>; })}</tbody></table>}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section></>;
}

const TX_TYPE_LABEL: Record<"purchase" | "deposit" | "withdrawal" | "activation" | "refund" | "limit_request", string> = { purchase: "ใช้จ่าย", deposit: "เติมเงิน", withdrawal: "ถอนเงิน", activation: "เปิดใช้บัตร", refund: "คืนบัตรเงินสด", limit_request: "ขอลดวงเงิน" };
const TX_TYPE_TONE: Record<"purchase" | "deposit" | "withdrawal" | "activation" | "refund" | "limit_request", "blue" | "green" | "amber" | "purple" | "red"> = { purchase: "blue", deposit: "green", withdrawal: "amber", activation: "green", refund: "red", limit_request: "purple" };

/** ROUND 34 (req 23.2) — สถานะคำขอลดวงเงิน → ป้ายสี (แถว kind "limit" ในตารางธุรกรรม) */
const LIMIT_STATUS_META: Record<"pending" | "approved" | "rejected", { label: string; tone: string }> = {
  pending: { label: "รอพิจารณา", tone: "amber" },
  approved: { label: "อนุมัติ", tone: "green" },
  rejected: { label: "ปฏิเสธ", tone: "red" },
};

/** memberTransactions merges limit rows with ids offset by 1,000,000 so they stay
 *  unique next to member_transactions ids — reverse the offset to get the real
 *  limit_requests.id needed by member.decideLimitRequest. */
const LIMIT_ROW_ID_OFFSET = 1_000_000;

/** ROUND 48 — แถวสรุปตามช่วงเวลา พร้อมช่วงวันที่จริงของแถว (date → end) สำหรับกดขยายดูรายการสินค้า */
type TimelineRow = { label: string; date: string; end: string; orders: number; items: number; revenue: number; cogs: number; profit: number };

/**
 * ROUND 48 (user) — "แสดงเป็นจำนวนบิลแต่ไม่แสดงสินค้า ทำให้ไม่รู้ว่ามีรายการอะไร"
 * กดแถวในมุมมองภาพรวมตามช่วงเวลา → ขยายดูรายการสินค้าที่ขายในช่วงนั้นทันที
 */
function TimelineDrilldown({ from, to, cashiers }: { from: string; to: string; cashiers?: string[] }) {
  const query = trpc.reports.byProduct.useQuery({ from, to, cashiers: cashiers && cashiers.length > 0 ? cashiers : undefined }, { placeholderData: (previous) => previous });
  if (query.isLoading) return <div className="timeline-drill-loading"><FileBarChart size={15} /> กำลังรวบรวมรายการสินค้าในช่วงนี้…</div>;
  if (query.isError) return <div className="timeline-drill-loading error"><FileBarChart size={15} /> โหลดรายการไม่สำเร็จ — {getErrorMessage(query.error)}</div>;
  const rows = query.data ?? [];
  if (rows.length === 0) return <div className="timeline-drill-loading"><FileBarChart size={15} /> ไม่มีรายการขายในช่วงเวลานี้</div>;
  return <table className="timeline-drill-table" aria-label="รายการสินค้าที่ขายในช่วงเวลานี้"><thead><tr><th>สินค้าที่ขายในช่วงนี้</th><th className="num">บิล</th><th className="num">ชิ้น</th><th className="num">ยอดขาย</th></tr></thead><tbody>{rows.map((row) => <tr key={row.productId ?? row.name}><td><b>{row.name}</b>{row.sku && <small className="cell-sub cell-mono">{row.sku}</small>}</td><td className="num">{row.bills.toLocaleString("th-TH")}</td><td className="num">{row.qty.toLocaleString("th-TH")}</td><td className="num"><strong>{money(row.revenue)}</strong></td></tr>)}</tbody></table>;
}

// ROUND 49 — เครื่องมือเลือกช่วงเวลาฉบับเรียบง่าย: ปุ่มลัดกดครั้งเดียวได้ช่วงที่ตั้งใจ
// "วันนี้/เมื่อวาน" = เลือกวันเดียวโดยไม่ต้องแตะปฏิทิน · "กำหนดเอง" = เลือกวันเดียวหรือช่วง
type ReportRangeMode = "today" | "yesterday" | "7d" | "thisMonth" | "custom";
type ReportGroupBy = "day" | "week" | "month";
const REPORT_RANGE_CHIPS: { value: ReportRangeMode; label: string }[] = [
  { value: "today", label: "วันนี้" },
  { value: "yesterday", label: "เมื่อวาน" },
  { value: "7d", label: "7 วันล่าสุด" },
  { value: "thisMonth", label: "เดือนนี้" },
  { value: "custom", label: "กำหนดเอง" },
];
const REPORT_GROUPBY_CHIPS: { value: ReportGroupBy; label: string }[] = [
  { value: "day", label: "รายวัน" },
  { value: "week", label: "รายสัปดาห์" },
  { value: "month", label: "รายเดือน" },
];

function Reports({ focusBill, onFocusBillConsumed, role, userName }: { focusBill: string | null; onFocusBillConsumed: () => void; role: Role; userName: string }) {
  const utils = trpc.useUtils();
  const logsQuery = trpc.logs.list.useQuery({ limit: 1000 });
  // ROUND 61 (user) — เวอร์ชัน: มุมมอง “แยกตามสินค้า / รายการในบิล / พนักงานขาย” เป็นรายงานขั้นสูง (เวอร์ชันโปรขึ้นไป)
  const edition = useEditionStatus();
  const hasAdvancedReports = edition.status?.has("reportsAdvanced") ?? false;
  const [upgradeFeature, setUpgradeFeature] = useState<EditionFeatureKey | null>(null);
  // ROUND 49 — ช่วงเวลา (ปุ่มลัด) แยกจากการจัดกลุ่มแถว (รายวัน/สัปดาห์/เดือน) อย่างชัดเจน
  const [rangeMode, setRangeMode] = useState<ReportRangeMode>("7d");
  const [groupBy, setGroupBy] = useState<ReportGroupBy>("day");
  // กำหนดเอง: เว้นวันสิ้นสุดว่าง = วันเดียวกับวันเริ่มต้น (เลือกวันเดียวแบบกดครั้งเดียว)
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  // ROUND 51 — ตัวกรองพนักงานขายแบบเจาะจง: ใช้ร่วมกับทุกมุมมอง ทุกช่วงเวลา
  // ROUND 79 (user) — เลือกได้หลายคนพร้อมกัน (เช่น รวม 2 กะในรายงานเดียว) · [] = ทุกคน
  const [staffFilters, setStaffFilters] = useState<string[]>([]);
  // ROUND 30 — สรุปยอดขายแยกตามชนิดสินค้า / พนักงานขาย + ประวัติธุรกรรมสมาชิก
  const [salesView, setSalesView] = useState<"timeline" | "category" | "product" | "items" | "cashier">("timeline");
  // ROUND 48 — แถวช่วงเวลาที่กดขยายอยู่ (ดูรายการสินค้าของช่วงนั้น)
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);
  const [billMember, setBillMember] = useState<MemberLite | null>(null);
  const [txMember, setTxMember] = useState<MemberLite | null>(null);
  // ROUND 77 (user) — เลือกประเภทธุรกรรมได้หลายอย่างพร้อมกัน (เช่น เติมเงิน+ถอนเงิน+คืนบัตร):
  // ชุดว่าง = ทุกประเภท · กดทับตัวที่กดอยู่เพื่อถอนออก · “ทั้งหมด” ล้างชุด
  const [txTypes, setTxTypes] = useState<("purchase" | "deposit" | "withdrawal" | "activation" | "refund" | "limit_request")[]>([]);
  const toggleTxType = (value: "purchase" | "deposit" | "withdrawal" | "activation" | "refund" | "limit_request") => {
    setTxTypes((current) => (current.includes(value) ? current.filter((type) => type !== value) : [...current, value]));
  };
  const [txFrom, setTxFrom] = useState("");
  const [txTo, setTxTo] = useState("");
  // ROUND 49 — เลือกวันเดียวในแท็บธุรกรรม: กดวันที่ฝั่งเดียว อีกฝั่งเว้นว่าง → วันเดียวกันทันที (ไม่ดึงถึงวันนี้แบบเดิม)
  const pickTxFrom = (iso: string) => { setTxFrom(iso); if (iso && !txTo) setTxTo(iso); };
  const pickTxTo = (iso: string) => { setTxTo(iso); if (iso && !txFrom) setTxFrom(iso); };
  // ROUND 65 — ช่องค้นหาของรายงานใหม่: ยอดเงินในบัตร + สินค้าคงคลัง (debounce เหมือนประวัติบิล)
  const [balanceSearch, setBalanceSearch] = useState("");
  const [debouncedBalanceSearch, setDebouncedBalanceSearch] = useState("");
  const [stockSearch, setStockSearch] = useState("");
  const [debouncedStockSearch, setDebouncedStockSearch] = useState("");
  // ROUND 34 (req 23.2) — การพิจารณาคำขอลดวงเงิน: ผู้บริหารกดอนุมัติ/ปฏิเสธที่แถวรอพิจารณา
  const [limitDecision, setLimitDecision] = useState<{ row: MemberTransactionRow; decision: "approve" | "reject" } | null>(null);
  const [limitError, setLimitError] = useState("");
  const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  // ROUND 49 — ช่วงเวลาของรายงานมาจากแหล่งเดียว: ปุ่มลัด หรือช่องกำหนดเอง
  // (เดิม: เลือกวันเดียวแต่ "ถึง" ยังค้างช่วงเดือน → รายงานดึงทั้งเดือนโดยไม่ตรงกับที่เลือก)
  const quickRangeOf = (mode: ReportRangeMode): { from: string; to: string } | null => {
    const now = new Date();
    if (mode === "today") return { from: isoDay(now), to: isoDay(now) };
    if (mode === "yesterday") { const y = new Date(Date.now() - 86_400_000); return { from: isoDay(y), to: isoDay(y) }; }
    if (mode === "7d") return { from: isoDay(new Date(Date.now() - 6 * 86_400_000)), to: isoDay(now) };
    if (mode === "thisMonth") return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) };
    return null;
  };
  const lastQuickRange = useRef({ from: isoDay(new Date(Date.now() - 6 * 86_400_000)), to: isoDay(new Date()) });
  const pickRangeChip = (mode: ReportRangeMode) => {
    if (mode === "custom") { setRangeFrom(""); setRangeTo(""); setRangeMode("custom"); return; }
    const quick = quickRangeOf(mode);
    if (quick) lastQuickRange.current = quick;
    setRangeMode(mode);
  };
  // กำหนดเองแบบเลือกวันเดียว: กดวันที่ฝั่งเดียว อีกฝั่งเว้นว่าง → วันสิ้นสุด = วันเริ่มต้นทันที
  const pickCustomFrom = (iso: string) => {
    setRangeFrom(iso);
    if (iso && (!rangeTo || rangeTo < iso)) setRangeTo(iso);
  };
  const pickCustomTo = (iso: string) => {
    setRangeTo(iso);
    if (iso && (!rangeFrom || rangeFrom > iso)) setRangeFrom(iso);
  };
  // ช่วงที่ใช้จริง — ปุ่มลัดใช้ค่าของปุ่มนั้น · กำหนดเอง: ฝั่งว่างสะท้อนอีกฝั่ง (วันเดียว) · ว่างทั้งคู่ = ช่วงปุ่มลัดล่าสุด
  const quickActive = rangeMode !== "custom" ? quickRangeOf(rangeMode) : null;
  const customFrom = rangeFrom || rangeTo || lastQuickRange.current.from;
  const customTo = rangeTo || rangeFrom || lastQuickRange.current.to;
  const effectiveFrom = quickActive?.from ?? (customFrom <= customTo ? customFrom : customTo);
  const effectiveTo = quickActive?.to ?? (customFrom <= customTo ? customTo : customFrom);
  const effectiveDays = Math.round((Date.parse(`${effectiveTo}T00:00:00`) - Date.parse(`${effectiveFrom}T00:00:00`)) / 86_400_000) + 1;
  const rangeChipLabel = rangeMode !== "custom"
    ? (REPORT_RANGE_CHIPS.find((chip) => chip.value === rangeMode)?.label ?? "7 วันล่าสุด")
    : ((rangeFrom || rangeTo) ? (rangeFrom === rangeTo || (!rangeFrom || !rangeTo) ? formatThaiDate(effectiveFrom) : `${formatShortDay(effectiveFrom)}–${formatShortDay(effectiveTo)}`) : "ล่าสุด (7 วัน)");
  const rangeLabel = effectiveFrom === effectiveTo ? formatThaiDate(effectiveFrom) : `${formatThaiDate(effectiveFrom)} – ${formatThaiDate(effectiveTo)}`;
  // ROUND 51 — ป้ายกำกับตัวกรองพนักงาน สำหรับสถานะ/การ์ดสรุป/หัวเอกสารส่งออก
  const staffSuffix = staffFilters.length > 0 ? ` · พนักงาน: ${staffFilters.length === 1 ? staffFilters[0] : `${staffFilters.length} คน`}` : "";
  // ทุกมุมมอง (ภาพรวม/สินค้า/รายการในบิล/ชนิดสินค้า/พนักงาน) ใช้ช่วงเวลาและพนักงานเดียวกันเสมอ
  const dailyQuery = trpc.reports.daily.useQuery({ from: effectiveFrom, to: effectiveTo, cashiers: staffFilters.length > 0 ? staffFilters : undefined }, { placeholderData: (previous) => previous });
  // ROUND 27 — รายงานเป็น tab workspace: สรุปยอดขาย / ประวัติบิล / การส่งออก
  const [reportTab, setReportTab] = useState<"sales" | "bills" | "transactions" | "stock" | "balances" | "export">("sales");
  // Round 32-21 — แท็บย่อยในส่งออกข้อมูล: ไม่ต้องเลื่อนลงไปให้หัวข้อท้ายหลุดจอ
  const [exportTopic, setExportTopic] = useState<"sales" | "bills" | "transactions">("sales");
  // ROUND 51 — รายชื่อพนักงานขายจากบิลจริง (ตัวเลือกในดรอปดาวน์ พร้อมจำนวนบิลให้เทียบว่าใครขายเยอะ)
  const cashiersQuery = trpc.reports.cashiers.useQuery(undefined, { enabled: reportTab === "sales" });
  const cashierOptions = cashiersQuery.data ?? [];
  // ROUND 79 — กดทับถอนออก / กดเพิ่มเข้า — สไตล์เดียวกับชิปหลายประเภทธุรกรรม (r77)
  const toggleStaffFilter = (name: string) => setStaffFilters((current) => (current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]));
  const resetReportFilters = () => { setRangeMode("7d"); setRangeFrom(""); setRangeTo(""); setGroupBy("day"); setStaffFilters([]); setSalesView("timeline"); setTxMember(null); setTxTypes([]); setTxFrom(""); setTxTo(""); setBalanceSearch(""); setStockSearch(""); setReportTab("sales"); };
  const membersQuery = trpc.member.list.useQuery();
  const members = membersQuery.data ?? [];
  // Round 32-23 — การ์ดสมาชิก (สมาชิกใหม่/เปิดใช้งาน + ยอดเงินคงเหลือ) แทนการ์ดเติม/ถอน
  // ที่ย้ายไปอยู่ในแท็บประวัติธุรกรรมสมาชิกแล้ว
  const memberActiveCount = members.filter((member) => member.status === "active").length;
  const memberNewThisMonth = members.filter((member) => isSameMonth(parseStoreDate(member.createdAt), new Date())).length;
  const memberWalletTotal = members.reduce((sum, member) => sum + member.balance, 0);
  const categoryQuery = trpc.reports.byCategory.useQuery({ from: effectiveFrom, to: effectiveTo, cashiers: staffFilters.length > 0 ? staffFilters : undefined }, { enabled: reportTab === "sales" && salesView === "category", placeholderData: (previous) => previous });
  const cashierQuery = trpc.reports.byCashier.useQuery({ from: effectiveFrom, to: effectiveTo, cashiers: staffFilters.length > 0 ? staffFilters : undefined }, { enabled: reportTab === "sales" && salesView === "cashier", placeholderData: (previous) => previous });
  const productQuery = trpc.reports.byProduct.useQuery({ from: effectiveFrom, to: effectiveTo, cashiers: staffFilters.length > 0 ? staffFilters : undefined }, { enabled: reportTab === "sales" && salesView === "product", placeholderData: (previous) => previous });
  // ROUND 48 — มุมมอง "แยกตามรายการในบิล": ทุกบรรทัดสินค้าจากทุกบิลในช่วงเวลา
  const lineItemsQuery = trpc.reports.lineItems.useQuery({ from: effectiveFrom, to: effectiveTo, cashiers: staffFilters.length > 0 ? staffFilters : undefined }, { enabled: reportTab === "sales" && salesView === "items", placeholderData: (previous) => previous });
  const txQuery = trpc.reports.memberTransactions.useQuery({ memberNumber: txMember?.memberNumber, types: txTypes.length > 0 ? txTypes : undefined, from: txFrom || undefined, to: txTo || undefined, limit: 300 });
  const txRows = txQuery.data ?? [];
  // ROUND 65 — รายงานใหม่: ยอดเงินในบัตรทุกใบ + สินค้าคงคลังตามช่วงเวลา (ยอดยกมา/ยอดขาย/คงเหลือ)
  const balancesQuery = trpc.reports.memberBalances.useQuery({ search: debouncedBalanceSearch || undefined }, { enabled: reportTab === "balances" });
  const balanceRows = balancesQuery.data ?? [];
  const stockBalanceQuery = trpc.reports.stockBalance.useQuery({ from: effectiveFrom, to: effectiveTo, search: debouncedStockSearch || undefined }, { enabled: reportTab === "stock" });
  const stockBalanceRows = stockBalanceQuery.data ?? [];
  const balanceTotals = useMemo(() => ({
    members: balanceRows.length,
    active: balanceRows.filter((row) => row.status === "active").length,
    totalIn: balanceRows.reduce((sum, row) => sum + row.totalIn, 0),
    totalOut: balanceRows.reduce((sum, row) => sum + row.totalOut, 0),
    balance: balanceRows.reduce((sum, row) => sum + row.balance, 0),
  }), [balanceRows]);
  const stockTotals = useMemo(() => ({
    items: stockBalanceRows.length,
    opening: stockBalanceRows.reduce((sum, row) => sum + row.opening, 0),
    sold: stockBalanceRows.reduce((sum, row) => sum + row.sold, 0),
    remaining: stockBalanceRows.reduce((sum, row) => sum + row.remaining, 0),
  }), [stockBalanceRows]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBalanceSearch(balanceSearch.trim()), 350);
    return () => clearTimeout(timer);
  }, [balanceSearch]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedStockSearch(stockSearch.trim()), 350);
    return () => clearTimeout(timer);
  }, [stockSearch]);
  // ROUND 34 (req 23.2) — คำขอลดวงเงินค้างพิจารณา (ข้อมูลน้อย ดึงตลอดเพื่อการ์ดสรุปและ badge)
  const limitRequestsQuery = trpc.reports.limitRequests.useQuery({ status: "pending", limit: 200 });
  const pendingLimitCount = limitRequestsQuery.data?.pendingCount ?? 0;
  // ผู้บริหารอนุมัติ/ปฏิเสธคำขอจากแถวรอพิจารณาในตาราง (approve = ตั้งวงเงินเป็นค่าที่ขอ)
  const decideLimitMutation = trpc.member.decideLimitRequest.useMutation({
    onSuccess: (result) => {
      const name = result.memberName ?? result.memberNumber;
      setLimitDecision(null);
      setLimitError("");
      setNotice(result.status === "approved"
        ? `อนุมัติคำขอลดวงเงิน ${name} แล้ว · วงเงินใหม่ ${money(result.requestedLimit)}`
        : `ปฏิเสธคำขอลดวงเงิน ${name} แล้ว · วงเงินคงเดิม ${result.currentLimit != null ? money(result.currentLimit) : "ไม่จำกัด"}`);
      void utils.reports.memberTransactions.invalidate();
      void utils.reports.limitRequests.invalidate();
      void utils.member.list.invalidate();
    },
    onError: (mutationError) => setLimitError(getErrorMessage(mutationError)),
  });
  const confirmLimitDecision = () => {
    if (!limitDecision) return;
    decideLimitMutation.mutate({ requestId: limitDecision.row.id - LIMIT_ROW_ID_OFFSET, decision: limitDecision.decision, actor: userName || "ผู้ใช้ระบบ", actorRole: role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่" });
  };
  const [notice, setNotice] = useState("");
  const [billSearch, setBillSearch] = useState("");
  const [debouncedBillSearch, setDebouncedBillSearch] = useState("");
  // Render caps (round 15): bills history starts collapsed (ยอดขายเห็นครบในกรอบเลื่อนแล้ว).
  const [billsVisible, setBillsVisible] = useState(15);
  const [viewedReceipt, setViewedReceipt] = useState<SaleHistoryEntry | null>(null);
  const salesHistoryQuery = trpc.sales.list.useQuery(billMember ? { search: billMember.memberNumber, limit: 200 } : debouncedBillSearch ? { search: debouncedBillSearch } : undefined, { placeholderData: (previous) => previous });
  const salesHistory = salesHistoryQuery.data ?? [];
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBillSearch(scanCandidates(billSearch.trim()).pop() ?? billSearch.trim()), 350);
    return () => clearTimeout(timer);
  }, [billSearch]);
  // A new search returns the bills list to its first page.
  useEffect(() => { setBillsVisible(15); }, [debouncedBillSearch, billMember]);
  // Auto-open the reprint modal for a bill requested from the ⌘K palette.
  // Waits until the list has loaded (50 newest bills), opens the same modal a
  // row click uses, and consumes the request exactly once — silently skips if
  // the bill is not among the loaded rows.
  const consumedBillRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusBill || consumedBillRef.current === focusBill) return;
    if (salesHistoryQuery.isLoading || !salesHistoryQuery.isSuccess) return;
    const match = salesHistory.find((entry) => entry.orderNumber === focusBill);
    consumedBillRef.current = focusBill;
    onFocusBillConsumed();
    setReportTab("bills"); // ⌘K ส่งมาที่บิล — สลับไปแท็บประวัติบิลให้อัตโนมัติ
    if (match) setViewedReceipt(match);
  }, [focusBill, salesHistoryQuery.isLoading, salesHistoryQuery.isSuccess, salesHistory, onFocusBillConsumed]);
  const dailyRows = dailyQuery.data ?? [];
  const walletTotals = useMemo(() => {
    const totals = { deposit: 0, depositCount: 0, withdraw: 0, withdrawCount: 0 };
    for (const log of logsQuery.data ?? []) {
      const amount = parseBahtFromDetail(log.detail);
      if (log.action === "เติมเงินสมาชิก") { totals.deposit += amount; totals.depositCount += 1; }
      else if (log.action === "ถอนเงินสมาชิก") { totals.withdraw += amount; totals.withdrawCount += 1; }
    }
    return totals;
  }, [logsQuery.data]);
  // ROUND 49 — จัดกลุ่มแถว (รายวัน/สัปดาห์/เดือน) บนข้อมูลของ "ช่วงเวลาที่เลือกจริง" เท่านั้น
  // ทุกแถวพกวันที่จริงของตัวเอง (date → end) เพื่อกดขยายดูรายการสินค้าของช่วงนั้น
  const reportRows = useMemo(() => {
    const sum = (list: typeof dailyRows) => list.reduce((acc, row) => ({ orders: acc.orders + row.orders, items: acc.items + row.items, revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, profit: acc.profit + row.profit }), { orders: 0, items: 0, revenue: 0, cogs: 0, profit: 0 });
    if (dailyRows.length === 0) return [] as TimelineRow[];
    if (groupBy === "month") {
      const months: { key: string; rows: typeof dailyRows }[] = [];
      for (const row of dailyRows) {
        const key = row.date.slice(0, 7);
        const last = months[months.length - 1];
        if (last && last.key === key) last.rows.push(row);
        else months.push({ key, rows: [row] });
      }
      return months.map((group) => ({ label: formatThaiMonthYear(group.rows[0].date), date: group.rows[0].date, end: group.rows[group.rows.length - 1].date, ...sum(group.rows) }));
    }
    if (groupBy === "week") {
      const weeks: TimelineRow[] = [];
      for (let start = 0; start < dailyRows.length; start += 7) {
        const chunk = dailyRows.slice(start, start + 7);
        weeks.push({ label: `${formatShortDay(chunk[0].date)}–${formatShortDay(chunk[chunk.length - 1].date)}`, date: chunk[0].date, end: chunk[chunk.length - 1].date, ...sum(chunk) });
      }
      return weeks;
    }
    return dailyRows.map((row) => ({ label: formatShortDay(row.date), date: row.date, end: row.date, orders: row.orders, items: row.items, revenue: row.revenue, cogs: row.cogs, profit: row.profit }));
  }, [dailyRows, groupBy]);
  const totals = reportRows.reduce((acc, row) => ({ orders: acc.orders + row.orders, items: acc.items + row.items, revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, profit: acc.profit + row.profit }), { orders: 0, items: 0, revenue: 0, cogs: 0, profit: 0 });
  const marginPercent = totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : "0.0";
  // ROUND 79 (user) — การ์ดสรุป 4 ใบ: เตี้ยลงแต่ใส่ข้อมูลเพิ่ม (ชิ้น · เฉลี่ยต่อบิล · ต้นทุน · เฉลี่ยต่อบัญชี)
  const avgPerBill = totals.orders > 0 ? Math.round((totals.revenue / totals.orders) * 100) / 100 : 0;
  const avgWalletPerMember = members.length > 0 ? Math.round((memberWalletTotal / members.length) * 100) / 100 : 0;
  const maxRevenue = Math.max(...reportRows.map((row) => row.revenue), 1);
  // ROUND 30 — ตัวเลขสำหรับมุมมองแยกตามชนิดสินค้า / พนักงานขาย และประวัติธุรกรรม
  const categoryRows = categoryQuery.data ?? [];
  const categoryTotal = categoryRows.reduce((acc, row) => ({ orders: acc.orders + row.orders, qty: acc.qty + row.qty, revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, profit: acc.profit + row.profit }), { orders: 0, qty: 0, revenue: 0, cogs: 0, profit: 0 });
  const productRows = productQuery.data ?? [];
  const productTotal = productRows.reduce((acc, row) => ({ bills: acc.bills + row.bills, qty: acc.qty + row.qty, revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, profit: acc.profit + row.profit }), { bills: 0, qty: 0, revenue: 0, cogs: 0, profit: 0 });
  const cashierRows = cashierQuery.data ?? [];
  const cashierTotal = cashierRows.reduce((acc, row) => ({ orders: acc.orders + row.orders, items: acc.items + row.items, memberBills: acc.memberBills + row.memberBills, discount: acc.discount + row.discount, total: acc.total + row.total }), { orders: 0, items: 0, memberBills: 0, discount: 0, total: 0 });
  // ROUND 48 — ข้อมูลมุมมอง "แยกตามรายการในบิล" + ตัวรวมสำหรับสรุปหัวรายงาน
  const lineItemRows = lineItemsQuery.data ?? [];
  const lineItemTotals = useMemo(() => ({
    bills: new Set(lineItemRows.map((row) => row.orderNumber)).size,
    lines: lineItemRows.length,
    qty: lineItemRows.reduce((sum, row) => sum + row.qty, 0),
    revenue: lineItemRows.reduce((sum, row) => sum + row.amount, 0),
  }), [lineItemRows]);
  const txTotals = {
    spend: txRows.filter((row) => row.type === "purchase").reduce((sum, row) => sum + row.amount, 0),
    spendCount: txRows.filter((row) => row.type === "purchase").length,
    deposit: txRows.filter((row) => row.type === "deposit").reduce((sum, row) => sum + row.amount, 0),
    depositCount: txRows.filter((row) => row.type === "deposit").length,
    withdraw: txRows.filter((row) => row.type === "withdrawal").reduce((sum, row) => sum + row.amount, 0),
    withdrawCount: txRows.filter((row) => row.type === "withdrawal").length,
    // ROUND 65 — เปิดใช้บัตร (พร้อมเงินเริ่มต้น) + คืนบัตรเงินสด
    activation: txRows.filter((row) => row.type === "activation").reduce((sum, row) => sum + row.amount, 0),
    activationCount: txRows.filter((row) => row.type === "activation").length,
    refund: txRows.filter((row) => row.type === "refund").reduce((sum, row) => sum + row.amount, 0),
    refundCount: txRows.filter((row) => row.type === "refund").length,
    // ROUND 34 — แถวคำขอลดวงเงินตามตัวกรองปัจจุบัน
    limitCount: txRows.filter((row) => row.kind === "limit").length,
  };
  const dailySalesRows = [
    ["วันที่ / ช่วงเวลา", "จำนวนบิล", "รายการที่ขาย", "ยอดขาย", "ต้นทุน", "กำไร"],
    ...reportRows.map((row) => [row.label, exportCount(row.orders), exportCount(row.items), exportNumber(row.revenue), exportNumber(row.cogs), exportNumber(row.profit)]),
    ["รวม", exportCount(totals.orders), exportCount(totals.items), exportNumber(totals.revenue), exportNumber(totals.cogs), exportNumber(totals.profit)],
  ];
  // ROUND 45 — ชุดข้อมูลส่งออกตามมุมมองที่เลือก (timeline / สินค้า / ชนิดสินค้า / พนักงานขาย)
  // CSV กับ Excel ใช้แถวชุดเดียวกับ PDF (dailySalesDocConfig) เพื่อให้ตัวเลขตรงกันทุกไฟล์
  const dailySalesExportPack = (): { rows: string[][]; fileName: string; sheetName: string; label: string } => {
    if (salesView === "product") {
      return {
        fileName: "sales-by-product", sheetName: "ยอดขายตามสินค้า", label: "แยกตามสินค้า",
        rows: [
          ["สินค้า (รหัส)", "บิล", "ชิ้น", "ยอดขาย (บาท)", "ต้นทุน (บาท)", "กำไร (บาท)"],
          ...productRows.map((row) => [`${row.name}${row.sku ? ` (${row.sku})` : ""}`, exportCount(row.bills), exportCount(row.qty), exportNumber(row.revenue), exportNumber(row.cogs), exportNumber(row.profit)]),
          ["รวมทุกสินค้า", exportCount(productTotal.bills), exportCount(productTotal.qty), exportNumber(productTotal.revenue), exportNumber(productTotal.cogs), exportNumber(productTotal.profit)],
        ],
      };
    }
    if (salesView === "category") {
      return {
        fileName: "sales-by-category", sheetName: "ยอดขายตามชนิดสินค้า", label: "แยกตามชนิดสินค้า",
        rows: [
          ["ชนิดสินค้า", "บิล", "ชิ้น", "ยอดขาย (บาท)", "ต้นทุน (บาท)", "กำไร (บาท)"],
          ...categoryRows.map((row) => [row.category, exportCount(row.orders), exportCount(row.qty), exportNumber(row.revenue), exportNumber(row.cogs), exportNumber(row.profit)]),
          ["รวมทุกชนิดสินค้า", exportCount(categoryTotal.orders), exportCount(categoryTotal.qty), exportNumber(categoryTotal.revenue), exportNumber(categoryTotal.cogs), exportNumber(categoryTotal.profit)],
        ],
      };
    }
    if (salesView === "cashier") {
      return {
        fileName: "sales-by-cashier", sheetName: "ยอดขายตามพนักงานขาย", label: "แยกตามพนักงานขาย",
        rows: [
          ["พนักงานขาย (ผู้ทำรายการ)", "บิล", "ชิ้น", "บิลสมาชิก", "ส่วนลดรวม (บาท)", "ยอดขายรวม (บาท)"],
          ...cashierRows.map((row) => [row.cashier, exportCount(row.orders), exportCount(row.items), exportCount(row.memberBills), exportNumber(row.discount), exportNumber(row.total)]),
          ["รวมทุกพนักงาน", exportCount(cashierTotal.orders), exportCount(cashierTotal.items), exportCount(cashierTotal.memberBills), exportNumber(cashierTotal.discount), exportNumber(cashierTotal.total)],
        ],
      };
    }
    if (salesView === "items") {
      return {
        fileName: "sales-line-items", sheetName: "รายการขายรายบิล", label: "แยกตามรายการในบิล",
        rows: [
          ["วันที่ · เวลา", "เลขที่บิล", "รายการสินค้า", "ชิ้น", "ราคา/ชิ้น (บาท)", "ยอดรวม (บาท)", "ชำระโดย", "พนักงานขาย"],
          ...lineItemRows.map((row) => [formatLogDateTime(row.createdAt), row.orderNumber, row.productName, exportCount(row.qty), exportNumber(row.price), exportNumber(row.amount), row.paymentMethod, row.cashier]),
          ["รวม", `${exportCount(lineItemTotals.bills)} บิล`, `${exportCount(lineItemTotals.lines)} รายการ`, exportCount(lineItemTotals.qty), "—", exportNumber(lineItemTotals.revenue), "—", "—"],
        ],
      };
    }
    return { fileName: "daily-sales-summary", sheetName: "สรุปยอดขาย", label: "", rows: dailySalesRows };
  };
  // Round 31-10 — PDF คือ "เอกสารรายงาน A4" ที่สร้างจากข้อมูลจริงตามมุมมองที่เลือก
  // (ไม่ใช่การจับภาพหน้าแอปอีกต่อไป)
  const dailySalesDocConfig = (): ReportDocConfig => {
    if (salesView === "timeline") {
      return {
        fileName: "daily-sales-summary.pdf", title: "รายงานสรุปยอดขายตามช่วงเวลา", periodLabel: `ช่วงข้อมูล ${rangeLabel}${staffSuffix}${salesView === "timeline" ? ` · จัดกลุ่มราย${groupBy === "day" ? "วัน" : groupBy === "week" ? "สัปดาห์" : "เดือน"}` : ""}`,
        meta: [["จำนวนบิล", `${totals.orders.toLocaleString("th-TH")} บิล`], ["ยอดขายรวม", money(totals.revenue)], ["กำไรขั้นต้น", `${money(totals.profit)} (${marginPercent}%)`]],
        columns: ["วันที่ / ช่วงเวลา", "บิล", "รายการที่ขาย", "ยอดขาย (บาท)", "ต้นทุน (บาท)", "กำไร (บาท)"], numericCols: [1, 2, 3, 4, 5],
        rows: reportRows.map((row) => [row.label, exportCount(row.orders), exportCount(row.items), exportNumber(row.revenue), exportNumber(row.cogs), exportNumber(row.profit)]),
        totalsRow: ["รวมทั้งช่วง", exportCount(totals.orders), exportCount(totals.items), exportNumber(totals.revenue), exportNumber(totals.cogs), exportNumber(totals.profit)],
        brandName: "ร้านค้าสวัสดิการ", footnote: "ตัวเลขจากระบบขายหน้าร้าน · รายงานสร้างตามช่วงเวลาที่เลือกไว้",
      };
    }
    if (salesView === "product" || salesView === "category") {
      const rows = salesView === "product"
        ? productRows.map((row) => [`${row.name}${row.sku ? ` (${row.sku})` : ""}`, exportCount(row.bills), exportCount(row.qty), exportNumber(row.revenue), exportNumber(row.cogs), exportNumber(row.profit)])
        : categoryRows.map((row) => [row.category, exportCount(row.orders), exportCount(row.qty), exportNumber(row.revenue), exportNumber(row.cogs), exportNumber(row.profit)]);
      const totalsRow = salesView === "product"
        ? ["รวมทุกสินค้า", exportCount(productTotal.bills), exportCount(productTotal.qty), exportNumber(productTotal.revenue), exportNumber(productTotal.cogs), exportNumber(productTotal.profit)]
        : ["รวมทุกชนิดสินค้า", exportCount(categoryTotal.orders), exportCount(categoryTotal.qty), exportNumber(categoryTotal.revenue), exportNumber(categoryTotal.cogs), exportNumber(categoryTotal.profit)];
      return {
        fileName: "daily-sales-summary.pdf", title: salesView === "product" ? "รายงานสรุปยอดขายแยกตามสินค้า" : "รายงานสรุปยอดขายแยกตามชนิดสินค้า", periodLabel: `ช่วงข้อมูล ${rangeLabel}${staffSuffix}`,
        columns: [salesView === "product" ? "สินค้า (รหัส)" : "ชนิดสินค้า", "บิล", "ชิ้น", "ยอดขาย (บาท)", "ต้นทุน (บาท)", "กำไร (บาท)"], numericCols: [1, 2, 3, 4, 5],
        rows, totalsRow, brandName: "ร้านค้าสวัสดิการ", footnote: "เรียงตามยอดขายสูงสุดก่อน · ตัวเลขจากระบบขายหน้าร้าน",
      };
    }
    if (salesView === "items") {
      return {
        fileName: "sales-line-items.pdf", title: "รายงานรายการสินค้าที่ขาย (รายบิล)", periodLabel: `ช่วงข้อมูล ${rangeLabel}${staffSuffix}`,
        meta: [["จำนวนบิล", `${lineItemTotals.bills.toLocaleString("th-TH")} บิล`], ["จำนวนรายการ", `${lineItemTotals.lines.toLocaleString("th-TH")} รายการ`], ["ยอดขายรวม", money(lineItemTotals.revenue)]],
        columns: ["วันที่ · เวลา", "เลขที่บิล", "รายการสินค้า", "ชิ้น", "ราคา/ชิ้น (บาท)", "ยอดรวม (บาท)", "ชำระโดย", "พนักงานขาย"], numericCols: [3, 4, 5],
        rows: lineItemRows.map((row) => [formatLogDateTime(row.createdAt), row.orderNumber, row.productName, exportCount(row.qty), exportNumber(row.price), exportNumber(row.amount), row.paymentMethod, row.cashier]),
        totalsRow: ["รวม", `${exportCount(lineItemTotals.bills)} บิล`, `${exportCount(lineItemTotals.lines)} รายการ`, exportCount(lineItemTotals.qty), "—", exportNumber(lineItemTotals.revenue), "—", "—"],
        brandName: "ร้านค้าสวัสดิการ", footnote: "ทุกบรรทัดสินค้าจากทุกบิลในช่วงเวลาที่เลือก · เรียงจากล่าสุดขึ้นก่อน · แสดงสูงสุด 1,000 รายการ",
        compact: true, // ตาราง 8 คอลัมน์ — ลดขนาดตามฟอร์มให้อยู่บรรทัดเดียว
      };
    }
    return {
      fileName: "daily-sales-summary.pdf", title: "รายงานสรุปยอดขายแยกตามพนักงานขาย", periodLabel: `ช่วงข้อมูล ${rangeLabel}${staffSuffix}`,
      columns: ["พนักงานขาย (ผู้ทำรายการ)", "บิล", "ชิ้น", "บิลสมาชิก", "ส่วนลดรวม (บาท)", "ยอดขายรวม (บาท)"], numericCols: [1, 2, 3, 4, 5],
      rows: cashierRows.map((row) => [row.cashier, exportCount(row.orders), exportCount(row.items), exportCount(row.memberBills), exportNumber(row.discount), exportNumber(row.total)]),
      totalsRow: ["รวมทุกพนักงาน", exportCount(cashierTotal.orders), exportCount(cashierTotal.items), exportCount(cashierTotal.memberBills), exportNumber(cashierTotal.discount), exportNumber(cashierTotal.total)],
      brandName: "ร้านค้าสวัสดิการ", footnote: "สรุปจากบิลขายจริง · แยกตามผู้ทำรายการที่หน้าร้าน",
    };
  };
  // ROUND 48 (user) — "ก่อนจะ Export ควรมีพรีวิวดูก่อนได้"
  // ทุกปุ่มส่งออกเปิดโมดัลพรีวิวข้อมูลก่อน แล้วผู้ใช้เลือกรูปแบบที่ต้องการ
  // (CSV / Excel / PDF / พิมพ์) จากในโมดัล — ปุ่มที่กดเข้ามาถูกไฮไลต์ไว้ให้
  const [exportPreview, setExportPreview] = useState<ExportPreviewState | null>(null);
  const waitBriefly = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const salesRowsLoaded = () => (salesView === "items" ? lineItemRows.length : salesView === "product" ? productRows.length : salesView === "category" ? categoryRows.length : salesView === "cashier" ? cashierRows.length : reportRows.length) > 0;
  const openSalesExportPreview = async (preferred: ExportFormat) => {
    // เปิดจากแท็บอื่น (เช่น แท็บการส่งออกข้อมูล) → สลับมาแท็บสรุปยอดขายแวบเดียวให้ query ของมุมมองนี้รันก่อน
    if (reportTab !== "sales") { setReportTab("sales"); await waitBriefly(250); }
    if (!salesRowsLoaded()) { setNotice("ยังไม่มีข้อมูลยอดขายในช่วงนี้"); return; }
    const pack = dailySalesExportPack();
    if (pack.rows.length <= 1) { setNotice("ยังไม่มีข้อมูลยอดขายในช่วงนี้"); return; }
    const doc = dailySalesDocConfig();
    setExportPreview({
      kind: "sales", title: doc.title, periodLabel: doc.periodLabel, label: pack.label,
      fileName: pack.fileName, sheetName: pack.sheetName, rows: pack.rows, numericCols: doc.numericCols ?? [], preferred, doc,
      hasTotalsRow: true,
      downloadNoticeBase: `รายงานยอดขาย${pack.label ? " " + pack.label : ""}`,
      printNotice: "สั่งพิมพ์รายงานยอดขายแล้ว — เอกสาร A4 ผ่านเครื่องพิมพ์เริ่มต้น",
    });
  };
  const billsExportRows = () => [
    ["เลขที่บิล", "วันที่ · เวลา", "ลูกค้า", "เลขสมาชิก", "จำนวนรายการ", "ชำระโดย", "ยอดรวม (บาท)"],
    ...salesHistory.map((entry) => [entry.orderNumber, formatLogDateTime(entry.createdAt), entry.memberName ? `สมาชิก ${entry.memberName}` : "บุคคลทั่วไป", entry.memberNumber ?? "—", exportCount(entry.items.length), entry.paymentMethod, exportNumber(entry.total)]),
  ];
  const billExportBase = billMember ? `bills-${billMember.memberNumber}` : "bills-history";
  const billsDocConfig = (): ReportDocConfig => {
    const total = salesHistory.reduce((sum, entry) => sum + entry.total, 0);
    return {
      fileName: `${billExportBase}.pdf`, title: "รายงานประวัติบิลขาย",
      periodLabel: billMember ? `แยกรายสมาชิก ${billMember.memberNumber} · สมาชิก${billMember.firstName} ${billMember.lastName}` : `บิลล่าสุดที่โหลดไว้ ${salesHistory.length} บิล`,
      meta: [["จำนวนบิล", `${salesHistory.length} บิล`], ["ยอดรวมทั้งหมด", money(total)]],
      columns: ["เลขที่บิล", "วันที่ · เวลา", "ลูกค้า", "เลขสมาชิก", "รายการ", "ชำระโดย", "ยอดรวม (บาท)"], numericCols: [4, 6],
      rows: salesHistory.map((entry) => [entry.orderNumber, formatLogDateTime(entry.createdAt), entry.memberName ? `สมาชิก ${entry.memberName}` : "บุคคลทั่วไป", entry.memberNumber ?? "—", exportCount(entry.items.length), entry.paymentMethod, exportNumber(entry.total)]),
      totalsRow: ["รวม", "—", "—", "—", exportCount(salesHistory.reduce((sum, entry) => sum + entry.items.length, 0)), "—", exportNumber(total)],
      brandName: "ร้านค้าสวัสดิการ", footnote: "กดแถวบนหน้าจอเพื่อเปิดใบเสร็จฉบับเต็มได้ · รายงานนี้สร้างจากบิลที่โหลดไว้ตามตัวกรอง",
      compact: true, // ตาราง 7 คอลัมน์ — ลดขนาดตามฟอร์มให้อยู่บรรทัดเดียว
    };
  };
  const openBillsExportPreview = (preferred: ExportFormat) => {
    if (salesHistory.length === 0) { setNotice("ยังไม่มีบิลที่จะส่งออก"); return; }
    const doc = billsDocConfig();
    setExportPreview({
      kind: "bills", title: doc.title, periodLabel: doc.periodLabel, label: "ประวัติบิล",
      fileName: billExportBase, sheetName: "ประวัติบิล", rows: [...billsExportRows(), ...(doc.totalsRow ? [doc.totalsRow] : [])], numericCols: doc.numericCols ?? [], preferred, doc,
      hasTotalsRow: true,
      downloadNoticeBase: `ประวัติบิล · ${salesHistory.length} บิล${billMember ? ` · สมาชิก ${billMember.memberNumber}` : ""}`,
      printNotice: `สั่งพิมพ์ประวัติบิลแล้ว · ${salesHistory.length} บิล`,
    });
  };
  const txExportRows = () => [
    ["วันที่ · เวลา", "เลขสมาชิก", "ชื่อสมาชิก", "ประเภท", "รายละเอียด", "ยอด (บาท)", "คงเหลือหลังรายการ (บาท)", "เจ้าหน้าที่ผู้ทำรายการ"],
    ...txRows.map((row) => [formatLogDateTime(row.createdAt), row.memberNumber, row.memberName ?? "—", TX_TYPE_LABEL[row.type], row.detail, exportNumber(row.amount), row.balanceAfter !== null ? exportNumber(row.balanceAfter) : "—", row.actor ?? "ไม่ระบุ"]),
  ];
  const txExportBase = txMember ? `member-transactions-${txMember.memberNumber}` : "member-transactions";
  const txDocConfig = (): ReportDocConfig => ({
    fileName: `${txExportBase}.pdf`, title: "รายงานประวัติธุรกรรมสมาชิก",
    periodLabel: txMember ? `สมาชิก ${txMember.memberNumber} · สมาชิก${txMember.firstName} ${txMember.lastName}` : "ทุกสมาชิก · แสดง 300 รายการล่าสุด",
    meta: [["ชนิดธุรกรรม", txTypes.length === 0 ? "ทั้งหมด" : txTypes.map((type) => TX_TYPE_LABEL[type]).join(" + ")], ["ช่วงวันที่", txFrom || txTo ? `${txFrom || "ต้นช่วง"} → ${txTo || "ปัจจุบัน"}` : "ทั้งหมด"], ["จำนวนรายการ", `${txRows.length} รายการ`]],
    columns: ["วันที่ · เวลา", "เลขสมาชิก", "ชื่อสมาชิก", "ประเภท", "รายละเอียด", "ยอด (บาท)", "คงเหลือหลังรายการ (บาท)", "เจ้าหน้าที่ผู้ทำรายการ"], numericCols: [5, 6],
    rows: txRows.map((row) => [formatLogDateTime(row.createdAt), row.memberNumber, row.memberName ?? "—", TX_TYPE_LABEL[row.type], row.detail, exportNumber(row.amount), row.balanceAfter !== null ? exportNumber(row.balanceAfter) : "—", row.actor ?? "ไม่ระบุ"]),
    // แยกสรุปประเภทเงินออกเป็นกล่อง เพื่อไม่ให้ข้อความยาวถูกบีบอยู่ในคอลัมน์รายละเอียด
    summaryBlocks: [
      ["เติมเงิน", `+${exportNumber(txTotals.deposit)} · ${exportCount(txTotals.depositCount)} รายการ`],
      ["ถอนเงิน", `-${exportNumber(txTotals.withdraw)} · ${exportCount(txTotals.withdrawCount)} รายการ`],
      ["ซื้อสินค้า", `-${exportNumber(txTotals.spend)} · ${exportCount(txTotals.spendCount)} รายการ`],
      ["เปิดใช้บัตร", `+${exportNumber(txTotals.activation)} · ${exportCount(txTotals.activationCount)} รายการ`],
      ["คืนเงิน", `+${exportNumber(txTotals.refund)} · ${exportCount(txTotals.refundCount)} รายการ`],
      ["ยอดสุทธิ", exportNumber(txRows.reduce((sum, row) => sum + row.amount, 0))],
    ],
    totalsRow: [`รวมทั้งหมด ${txRows.length} รายการ`, "—", "—", "—", "—", "—", "—", "—"],
    brandName: "ร้านค้าสวัสดิการ", footnote: "ข้อมูลจากบัญชีสมาชิกโดยตรง · แยกสรุปยอดเติมเงิน ถอนเงิน ซื้อสินค้า เปิดใช้บัตร และคืนเงินด้านบน",
    compact: true, // ตาราง 10 คอลัมน์ — ลดขนาดตามฟอร์มให้อยู่บรรทัดเดียว
  });
  const openTxExportPreview = (preferred: ExportFormat) => {
    if (txRows.length === 0) { setNotice("ยังไม่มีธุรกรรมที่จะส่งออกตามตัวกรองนี้"); return; }
    const doc = txDocConfig();
    setExportPreview({
      kind: "transactions", title: doc.title, periodLabel: doc.periodLabel, label: "ประวัติธุรกรรม",
      fileName: txExportBase, sheetName: "ประวัติธุรกรรม", rows: [...txExportRows(), ...(doc.totalsRow ? [doc.totalsRow] : [])], numericCols: doc.numericCols ?? [], preferred, doc,
      hasTotalsRow: true,
      downloadNoticeBase: `ประวัติธุรกรรม · ${txRows.length} รายการ${txMember ? ` · สมาชิก ${txMember.memberNumber}` : ""}`,
      printNotice: `สั่งพิมพ์ประวัติธุรกรรมแล้ว · ${txRows.length} รายการ`,
    });
  };
  // ROUND 65 — ชุดส่งออกของรายงานใหม่ 2 ตัว (ยอดเงินในบัตร + สินค้าคงคลัง)
  const balancesDocConfig = (): ReportDocConfig => ({
    fileName: "member-card-balances.pdf", title: "รายงานยอดเงินในบัตรสมาชิก",
    periodLabel: `ณ วันที่สร้างรายงาน ${formatThaiDate(new Date())}${debouncedBalanceSearch ? ` · ค้นหา “${debouncedBalanceSearch}”` : ""}`,
    meta: [["จำนวนสมาชิก", `${balanceTotals.members.toLocaleString("th-TH")} ราย`], ["ยอดเงินเข้ารวม", money(balanceTotals.totalIn)], ["คงเหลือรวม", money(balanceTotals.balance)]],
    columns: ["ลำดับ", "เลขสมาชิก", "ชื่อ-นามสกุล", "วันที่เปิดใช้สมาชิก", "ยอดทั้งหมด (บาท)", "ยอดจ่าย (บาท)", "คงเหลือ (บาท)"], numericCols: [4, 5, 6],
    rows: balanceRows.map((row, index) => [exportCount(index + 1), row.memberNumber, memberFullName(row), formatThaiDate(row.createdAt), exportNumber(row.totalIn), exportNumber(row.totalOut), exportNumber(row.balance)]),
    totalsRow: ["รวม", `${balanceTotals.members} ราย`, "", "", exportNumber(balanceTotals.totalIn), exportNumber(balanceTotals.totalOut), exportNumber(balanceTotals.balance)],
    brandName: "ร้านค้าสวัสดิการ", footnote: "ยอดทั้งหมด = เปิดใช้บัตร + เติมเงิน · ยอดจ่าย = ใช้ซื้อ + ถอน + คืนบัตรเงินสด · คงเหลือ = ยอดปัจจุบัน",
  });
  const openBalancesExportPreview = (preferred: ExportFormat) => {
    if (balanceRows.length === 0) { setNotice("ยังไม่มีข้อมูลสมาชิกที่จะส่งออก"); return; }
    const doc = balancesDocConfig();
    setExportPreview({
      kind: "balances", title: doc.title, periodLabel: doc.periodLabel, label: "ยอดเงินในบัตร",
      fileName: "member-card-balances", sheetName: "ยอดเงินในบัตร", rows: [
        ["ลำดับ", "เลขสมาชิก", "ชื่อ-นามสกุล", "วันที่เปิดใช้สมาชิก", "ยอดทั้งหมด (บาท)", "ยอดจ่าย (บาท)", "คงเหลือ (บาท)"],
        ...balanceRows.map((row, index) => [exportCount(index + 1), row.memberNumber, memberFullName(row), formatThaiDate(row.createdAt), exportNumber(row.totalIn), exportNumber(row.totalOut), exportNumber(row.balance)]),
        ["รวม", `${balanceTotals.members} ราย`, "", "", exportNumber(balanceTotals.totalIn), exportNumber(balanceTotals.totalOut), exportNumber(balanceTotals.balance)],
      ],
      numericCols: doc.numericCols ?? [], preferred, doc, hasTotalsRow: true,
      downloadNoticeBase: `ยอดเงินในบัตร · ${balanceRows.length} ราย`,
      printNotice: `สั่งพิมพ์รายงานยอดเงินในบัตรแล้ว · ${balanceRows.length} ราย`,
    });
  };
  const stockBalanceDocConfig = (): ReportDocConfig => ({
    fileName: "stock-balance-period.pdf", title: "รายงานสินค้าคงคลัง",
    periodLabel: `ช่วงข้อมูล ${rangeLabel} · ยอดยกมา ณ ต้นช่วง${debouncedStockSearch ? ` · ค้นหา “${debouncedStockSearch}”` : ""}`,
    meta: [["จำนวนรายการ", `${stockTotals.items.toLocaleString("th-TH")} รายการ`], ["ขายออกในช่วง", `${stockTotals.sold.toLocaleString("th-TH")} ชิ้น`], ["คงเหลือรวม", `${stockTotals.remaining.toLocaleString("th-TH")} ชิ้น`]],
    columns: ["ลำดับ", "รหัสสินค้า", "ชื่อสินค้า", "หน่วย", "ยอดยกมา", "ยอดขาย", "คงเหลือ"], numericCols: [4, 5, 6],
    rows: stockBalanceRows.map((row, index) => [exportCount(index + 1), row.code, row.name, row.unit, exportCount(row.opening), exportCount(row.sold), exportCount(row.remaining)]),
    totalsRow: ["รวม", `${stockTotals.items} รายการ`, "", "", exportCount(stockTotals.opening), exportCount(stockTotals.sold), exportCount(stockTotals.remaining)],
    brandName: "ร้านค้าสวัสดิการ", footnote: "ยอดยกมา = จำนวนต้นช่วง · ยอดขาย = ขายออกในช่วงที่เลือก · คงเหลือ = สต็อกปัจจุบัน",
    compact: true, // ตาราง 7 คอลัมน์ — ลดขนาดตามฟอร์มให้อยู่บรรทัดเดียว
  });
  const openStockBalanceExportPreview = (preferred: ExportFormat) => {
    if (stockBalanceRows.length === 0) { setNotice("ยังไม่มีรายการคงคลังที่จะส่งออก"); return; }
    const doc = stockBalanceDocConfig();
    setExportPreview({
      kind: "stockBalance", title: doc.title, periodLabel: doc.periodLabel, label: "สินค้าคงคลัง",
      fileName: "stock-balance-period", sheetName: "สินค้าคงคลัง", rows: [
        ["ลำดับ", "รหัสสินค้า", "ชื่อสินค้า", "หน่วย", "ยอดยกมา", "ยอดขาย", "คงเหลือ"],
        ...stockBalanceRows.map((row, index) => [exportCount(index + 1), row.code, row.name, row.unit, exportCount(row.opening), exportCount(row.sold), exportCount(row.remaining)]),
        ["รวม", `${stockTotals.items} รายการ`, "", "", exportCount(stockTotals.opening), exportCount(stockTotals.sold), exportCount(stockTotals.remaining)],
      ],
      numericCols: doc.numericCols ?? [], preferred, doc, hasTotalsRow: true,
      downloadNoticeBase: `สินค้าคงคลัง · ${stockBalanceRows.length} รายการ · ${rangeLabel}`,
      printNotice: `สั่งพิมพ์รายงานสินค้าคงคลังแล้ว · ${stockBalanceRows.length} รายการ`,
    });
  };
  const runExportPreview = async (format: ExportFormat) => {
    const state = exportPreview;
    if (!state) return;
    try {
      if (format === "csv") {
        downloadCsvFile(state.fileName, state.rows);
        setNotice(`ดาวน์โหลด${state.downloadNoticeBase} CSV แล้ว`);
      } else if (format === "xlsx") {
        downloadXlsxFile(state.fileName, state.sheetName, state.rows, state.numericCols);
        setNotice(`ดาวน์โหลด${state.downloadNoticeBase} Excel แล้ว`);
      } else if (format === "pdf") {
        await downloadReportPdf(state.doc);
        setNotice(`ดาวน์โหลด${state.downloadNoticeBase} PDF แล้ว`);
      } else {
        printReportDoc(state.doc);
        setNotice(state.printNotice);
      }
    } finally {
      setExportPreview(null);
    }
  };
  return <>
  <SectionHeader eyebrow="สรุปผลและวิเคราะห์ข้อมูล" title="รายงาน" description="" action={<div className="report-header-actions"><button type="button" className="outline-button compact" onClick={resetReportFilters}><RotateCcw size={14} /> ล้างตัวกรอง</button><button className="outline-button" title="สลับไปรายงานยอดขาย · แสดงเฉพาะวันนี้" onClick={() => { setReportTab("sales"); pickRangeChip("today"); }}><CalendarDays size={16} /> {formatThaiDate(new Date())} <ChevronDown size={15} /></button></div>} />{(reportTab === "sales" || reportTab === "bills") && <div className="report-cards report-cards-dense"><div className="report-card"><span>ยอดขายสินค้า</span><strong>{dailyQuery.isLoading ? "…" : money(totals.revenue)}</strong><div className="report-card-facts"><i>{totals.orders.toLocaleString("th-TH")} บิล</i><i>{totals.items.toLocaleString("th-TH")} ชิ้น</i><i>เฉลี่ย {money(avgPerBill)}/บิล</i>{staffFilters.length > 0 && <i>พนักงาน {staffFilters.length} คน</i>}</div></div><div className="report-card"><span>กำไรขั้นต้น (ประมาณ)</span><strong className="green-text">{dailyQuery.isLoading ? "…" : money(totals.profit)}</strong><div className="report-card-facts"><i>ต้นทุน {money(totals.cogs)}</i><i>มาร์จิ้น {marginPercent}%</i></div></div><div className="report-card"><span>สมาชิกใหม่ · เปิดใช้งาน</span><strong>{membersQuery.isLoading ? "…" : memberNewThisMonth} <em className="card-unit">ราย</em></strong><div className="report-card-facts"><i>ใช้งาน {memberActiveCount}/{members.length} ราย</i></div></div><div className="report-card"><span>เงินคงเหลือในบัตรสมาชิก</span><strong>{membersQuery.isLoading ? "…" : money(memberWalletTotal)}</strong><div className="report-card-facts"><i>{members.length} บัญชี</i><i>เฉลี่ย {money(avgWalletPerMember)}/บัญชี</i></div></div></div>}<div className="dash-workbench report-workbench"><div className="dash-tabbar"><button type="button" className={`dash-tab${reportTab === "sales" ? " active" : ""}`} onClick={() => setReportTab("sales")}><FileBarChart size={15} /> สรุปยอดขาย</button><button type="button" className={`dash-tab${reportTab === "bills" ? " active" : ""}`} onClick={() => setReportTab("bills")}><ReceiptText size={15} /> ประวัติบิล<i className="tab-badge neutral">{salesHistory.length}</i></button><button type="button" className={`dash-tab${reportTab === "transactions" ? " active" : ""}`} onClick={() => setReportTab("transactions")}><Activity size={15} /> ประวัติธุรกรรม{txRows.length > 0 && <i className="tab-badge neutral">{txRows.length}</i>}</button><button type="button" className={`dash-tab${reportTab === "stock" ? " active" : ""}`} onClick={() => setReportTab("stock")}><PackageSearch size={15} /> สินค้าคงคลัง{stockBalanceRows.length > 0 && <i className="tab-badge neutral">{stockBalanceRows.length}</i>}</button><button type="button" className={`dash-tab${reportTab === "balances" ? " active" : ""}`} onClick={() => setReportTab("balances")}><WalletCards size={15} /> ยอดเงินในบัตร{balanceRows.length > 0 && <i className="tab-badge neutral">{balanceRows.length}</i>}</button><button type="button" className={`dash-tab${reportTab === "export" ? " active" : ""}`} onClick={() => setReportTab("export")}><Download size={15} /> การส่งออกข้อมูล</button></div><div className="dash-tab-body">{reportTab === "sales" && <section className="panel" id="daily-sales-report"><div className="panel-heading"><div><h2>สรุปยอดขาย</h2><p>ช่วงข้อมูล {rangeLabel} · เลือกมุมมองรายช่วงเวลา (กดแถวดูรายการสินค้าที่ขาย) หรือแยกตามสินค้า / รายการในบิล / ชนิดสินค้า / พนักงานขาย</p></div><div className="report-export-actions" aria-label="พรีวิวข้อมูลก่อนส่งออกรายงานตามมุมมองที่เลือก"><button className="outline-button compact" onClick={() => void openSalesExportPreview("csv")} title="พรีวิวแล้วส่งออก CSV ตามมุมมองปัจจุบัน"><Download size={15} /> CSV</button><button className="outline-button compact" onClick={() => void openSalesExportPreview("xlsx")} title="พรีวิวแล้วส่งออก Excel ตามมุมมองปัจจุบัน"><FileBarChart size={15} /> Excel</button><button className="outline-button compact" onClick={() => void openSalesExportPreview("pdf")} title="พรีวิวแล้วส่งออก PDF ตามมุมมองปัจจุบัน"><FileBarChart size={15} /> PDF</button></div></div><div className="report-control-bar"><div className="report-tabs report-view-pills" role="tablist" aria-label="มุมมองรายงานยอดขาย"><button type="button" role="tab" aria-selected={salesView === "timeline"} className={salesView === "timeline" ? "active" : ""} onClick={() => setSalesView("timeline")}>ภาพรวมตามช่วงเวลา</button><button type="button" role="tab" aria-selected={salesView === "product"} className={`${salesView === "product" ? "active" : ""}${hasAdvancedReports ? "" : " edition-locked-tab"}`} onClick={() => (hasAdvancedReports ? setSalesView("product") : setUpgradeFeature("reportsAdvanced"))}>แยกตามสินค้า{!hasAdvancedReports && <Lock size={11} />}</button><button type="button" role="tab" aria-selected={salesView === "items"} className={`${salesView === "items" ? "active" : ""}${hasAdvancedReports ? "" : " edition-locked-tab"}`} onClick={() => (hasAdvancedReports ? setSalesView("items") : setUpgradeFeature("reportsAdvanced"))}>แยกตามรายการในบิล{!hasAdvancedReports && <Lock size={11} />}</button><button type="button" role="tab" aria-selected={salesView === "category"} className={salesView === "category" ? "active" : ""} onClick={() => setSalesView("category")}>แยกตามชนิดสินค้า</button><button type="button" role="tab" aria-selected={salesView === "cashier"} className={`${salesView === "cashier" ? "active" : ""}${hasAdvancedReports ? "" : " edition-locked-tab"}`} onClick={() => (hasAdvancedReports ? setSalesView("cashier") : setUpgradeFeature("reportsAdvanced"))}>แยกตามพนักงานขาย{!hasAdvancedReports && <Lock size={11} />}</button></div><div className="report-range-row"><div className="report-tabs report-period-pills" role="group" aria-label="เลือกช่วงเวลาของรายงาน">{REPORT_RANGE_CHIPS.map((chip) => <button type="button" key={chip.value} className={rangeMode === chip.value ? "active" : ""} onClick={() => pickRangeChip(chip.value)} title={chip.value === "today" || chip.value === "yesterday" ? "เลือกวันเดียว" : undefined}>{chip.label}</button>)}</div><div className="tx-type-pills report-staff-pills" role="group" aria-label="กรองตามพนักงานขาย — กดได้หลายคนพร้อมกัน"><button type="button" className={staffFilters.length === 0 ? "active" : ""} onClick={() => setStaffFilters([])} title="แสดงบิลของพนักงานทุกคน">{cashierOptions.length > 0 ? `ทุกคน (${cashierOptions.reduce((sum, option) => sum + option.bills, 0).toLocaleString("th-TH")} บิล)` : "พนักงานขาย: ทุกคน"}</button>{cashierOptions.map((option) => { const selected = staffFilters.includes(option.cashier); return <button type="button" key={option.cashier} aria-pressed={selected} className={selected ? "active" : ""} onClick={() => toggleStaffFilter(option.cashier)} title={selected ? `กดอีกครั้งเพื่อถอน “${option.cashier}” ออกจากตัวกรอง` : `เพิ่ม “${option.cashier}” เข้าตัวกรอง — เลือกหลายคนพร้อมกันได้ เช่น รวม 2 กะในรายงานเดียว`}>{option.cashier} · {option.bills.toLocaleString("th-TH")} บิล{selected && <i className="pill-check" aria-hidden="true">✓</i>}</button>; })}</div></div>{salesView === "timeline" && <div className="report-groupby" role="group" aria-label="จัดกลุ่มแถวรายงาน"><span>แยกตาม</span>{REPORT_GROUPBY_CHIPS.map((chip) => <button type="button" key={chip.value} className={groupBy === chip.value ? "active" : ""} onClick={() => setGroupBy(chip.value)}>{chip.label}</button>)}</div>}</div>{rangeMode === "custom" && <div className="range-picker report-custom-picker" role="group" aria-label="กำหนดช่วงวันที่"><span>ช่วงวันที่</span><ThaiDatePicker value={rangeFrom} onChange={pickCustomFrom} max={rangeTo || undefined} ariaLabel="วันเริ่มต้น — เลือกวันเดียวก็แค่กดวันนี้" /><span className="range-sep" aria-hidden="true">→</span><ThaiDatePicker value={rangeTo} onChange={pickCustomTo} min={rangeFrom || undefined} ariaLabel="วันสิ้นสุด — เว้นว่างไว้คือวันเดียวกับวันเริ่มต้น" /><span className="range-hint">เลือกวันเดียว: กำหนดวันเริ่มต้นอย่างเดียวก็พอ · ช่วงหลายวัน: กำหนดวันสิ้นสุดเพิ่ม</span></div>}<div className="report-range-status" role="status"><CalendarDays size={13} /> แสดงข้อมูล <b>{formatThaiDate(effectiveFrom)}</b>{effectiveFrom !== effectiveTo ? <> ถึง <b>{formatThaiDate(effectiveTo)}</b></> : null} · {effectiveDays.toLocaleString("th-TH")} วัน · {totals.orders.toLocaleString("th-TH")} บิล{staffFilters.length > 0 ? <> · พนักงาน <b>{staffFilters.length === 1 ? staffFilters[0] : `${staffFilters.length} คน`}</b></> : null}{rangeMode === "custom" && !rangeFrom && !rangeTo ? <span className="range-pending-note"> — ยังไม่ได้เลือกวันที่ ใช้ช่วงปุ่มลัดล่าสุดอยู่</span> : null}</div>{salesView === "timeline" && <div className="category-report">{dailyQuery.isLoading ? <div className="table-loading"><FileBarChart size={22} /><b>กำลังโหลดรายงานยอดขาย</b><span>ดึงข้อมูล {rangeChipLabel} จากระบบ</span></div> : dailyQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(dailyQuery.error)}</span></div> : reportRows.length === 0 ? <div className="table-loading"><FileBarChart size={22} /><b>{rangeMode === "custom" ? "ไม่มีข้อมูลในวันที่เลือก" : "ยังไม่มีข้อมูลการขาย"}</b><span>{rangeMode === "custom" ? "ลองเลือกวันอื่น หรือสลับปุ่มลัดเป็น 7 วันล่าสุด" : "เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน"}</span></div> : <table className="report-sales-table" aria-label="สรุปยอดขายรายช่วง"><thead><tr><th>วันที่ / ช่วงเวลา</th><th className="num">บิล</th><th className="num">ชิ้น</th><th className="num">ยอดขาย</th><th className="num">ต้นทุน</th><th className="num">กำไร</th><th className="num">กำไร/ยอดขาย</th></tr></thead><tbody>{reportRows.map((row, index) => <Fragment key={row.label}><tr className={`timeline-row${expandedPeriod === row.label ? " expanded" : ""}`} aria-expanded={expandedPeriod === row.label} title="กดเพื่อดูรายการสินค้าที่ขายในช่วงนี้" onClick={() => setExpandedPeriod(expandedPeriod === row.label ? null : row.label)}><td><span className="row-label"><i className="drill-caret" aria-hidden="true">▾</i>{row.label}</span><span className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`} aria-hidden="true"><i style={{ width: `${Math.round((row.revenue / maxRevenue) * 100)}%` }} /></span></td><td className="num">{row.orders.toLocaleString("th-TH")}</td><td className="num">{row.items.toLocaleString("th-TH")}</td><td className="num"><strong>{money(row.revenue)}</strong></td><td className="num">{money(row.cogs)}</td><td className="num"><span className={row.profit >= 0 ? "profit-pos" : "profit-neg"}>{money(row.profit)}</span></td><td className="num">{row.revenue > 0 ? `${((row.profit / row.revenue) * 100).toFixed(1)}%` : "—"}</td></tr>{expandedPeriod === row.label && <tr className="timeline-drill-row"><td colSpan={7}><TimelineDrilldown from={row.date} to={row.end} cashiers={staffFilters} /></td></tr>}</Fragment>)}</tbody><tfoot><tr><td>รวมทั้งช่วง · {reportRows.length} แถว</td><td className="num">{totals.orders.toLocaleString("th-TH")}</td><td className="num">{totals.items.toLocaleString("th-TH")}</td><td className="num">{money(totals.revenue)}</td><td className="num">{money(totals.cogs)}</td><td className="num">{money(totals.profit)}</td><td className="num">{marginPercent}%</td></tr></tfoot></table>}</div>}{salesView === "category" && <div className="category-report report-breakdown">{categoryQuery.isLoading ? <div className="table-loading"><ShoppingBag size={22} /><b>กำลังรวบรวมยอดขายตามชนิดสินค้า</b><span>ช่วง {effectiveFrom} → {effectiveTo}</span></div> : categoryQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(categoryQuery.error)}</span></div> : categoryRows.length === 0 ? <div className="table-loading"><ShoppingBag size={22} /><b>ยังไม่มีข้อมูลการขายในช่วงนี้</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน</span></div> : <table className="report-sales-table report-breakdown-table" aria-label="สรุปยอดขายแยกตามชนิดสินค้า"><thead><tr><th>ชนิดสินค้า</th><th className="num">บิล</th><th className="num">ชิ้น</th><th className="num">ยอดขาย</th><th className="num">ต้นทุน</th><th className="num">กำไร</th><th className="num">สัดส่วนยอดขาย</th></tr></thead><tbody>{categoryRows.map((row, index) => { const share = categoryTotal.revenue > 0 ? (row.revenue / categoryTotal.revenue) * 100 : 0; return <tr key={row.category}><td><span className="row-label">{row.category}</span><span className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`} aria-hidden="true"><i style={{ width: `${Math.round(share)}%` }} /></span></td><td className="num">{row.orders.toLocaleString("th-TH")}</td><td className="num">{row.qty.toLocaleString("th-TH")}</td><td className="num"><strong>{money(row.revenue)}</strong></td><td className="num">{money(row.cogs)}</td><td className="num"><span className={row.profit >= 0 ? "profit-pos" : "profit-neg"}>{money(row.profit)}</span></td><td className="num">{categoryTotal.revenue > 0 ? `${share.toFixed(1)}%` : "—"}</td></tr>; })}</tbody><tfoot><tr><td>รวมทุกชนิดสินค้า · {categoryRows.length} ชนิด</td><td className="num">{categoryTotal.orders.toLocaleString("th-TH")}</td><td className="num">{categoryTotal.qty.toLocaleString("th-TH")}</td><td className="num">{money(categoryTotal.revenue)}</td><td className="num">{money(categoryTotal.cogs)}</td><td className="num">{money(categoryTotal.profit)}</td><td className="num">{categoryTotal.revenue > 0 ? `${((categoryTotal.profit / categoryTotal.revenue) * 100).toFixed(1)}%` : "—"}</td></tr></tfoot></table>}</div>}{salesView === "product" && <div className="category-report report-breakdown">{productQuery.isLoading ? <div className="table-loading"><ShoppingBag size={22} /><b>กำลังรวบรวมยอดขายแยกตามสินค้ารายชิ้น</b><span>ช่วง {effectiveFrom} → {effectiveTo}</span></div> : productQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(productQuery.error)}</span></div> : productRows.length === 0 ? <div className="table-loading"><ShoppingBag size={22} /><b>ยังไม่มีข้อมูลการขายในช่วงนี้</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงานรายสินค้า</span></div> : <table className="report-sales-table report-breakdown-table" aria-label="สรุปยอดขายแยกตามสินค้า"><thead><tr><th>สินค้า</th><th className="num">บิล</th><th className="num">ชิ้น</th><th className="num">ยอดขาย</th><th className="num">ต้นทุน</th><th className="num">กำไร</th><th className="num">สัดส่วนยอดขาย</th></tr></thead><tbody>{productRows.map((row, index) => { const share = productTotal.revenue > 0 ? (row.revenue / productTotal.revenue) * 100 : 0; return <tr key={row.productId ?? `special-${index}`}><td><span className="row-label">{row.name}</span><small className="cell-sub cell-mono">{row.sku ?? row.barcode ?? "รายการพิเศษ · ไม่มีรหัส"}</small><span className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`} aria-hidden="true"><i style={{ width: `${Math.round(share)}%` }} /></span></td><td className="num">{row.bills.toLocaleString("th-TH")}</td><td className="num">{row.qty.toLocaleString("th-TH")}</td><td className="num"><strong>{money(row.revenue)}</strong></td><td className="num">{money(row.cogs)}</td><td className="num"><span className={row.profit >= 0 ? "profit-pos" : "profit-neg"}>{money(row.profit)}</span></td><td className="num">{productTotal.revenue > 0 ? `${share.toFixed(1)}%` : "—"}</td></tr>; })}</tbody><tfoot><tr><td>รวมทุกสินค้า · {productRows.length} รายการ</td><td className="num">{productTotal.bills.toLocaleString("th-TH")}</td><td className="num">{productTotal.qty.toLocaleString("th-TH")}</td><td className="num">{money(productTotal.revenue)}</td><td className="num">{money(productTotal.cogs)}</td><td className="num">{money(productTotal.profit)}</td><td className="num">{productTotal.revenue > 0 ? `${((productTotal.profit / productTotal.revenue) * 100).toFixed(1)}%` : "—"}</td></tr></tfoot></table>}</div>}{salesView === "items" && <div className="category-report report-breakdown line-items-report">{lineItemsQuery.isLoading ? <div className="table-loading"><ShoppingBag size={22} /><b>กำลังรวบรวมรายการสินค้าจากทุกบิล</b><span>ช่วง {effectiveFrom} → {effectiveTo}</span></div> : lineItemsQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(lineItemsQuery.error)}</span></div> : lineItemRows.length === 0 ? <div className="table-loading"><ShoppingBag size={22} /><b>ยังไม่มีรายการขายในช่วงนี้</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายการ</span></div> : <div className="line-items-wrap"><table className="report-sales-table report-breakdown-table line-items-table" aria-label="รายการสินค้าที่ขายในทุกบิล"><thead><tr><th>วันที่ · เวลา</th><th>เลขที่บิล</th><th>รายการสินค้า</th><th className="num">ชิ้น</th><th className="num">ราคา/ชิ้น</th><th className="num">ยอดรวม</th><th>ชำระโดย</th><th>พนักงานขาย</th></tr></thead><tbody>{lineItemRows.map((row, index) => <tr key={`${row.orderNumber}-${index}`}><td><small className="cell-mono">{formatLogDateTime(row.createdAt)}</small></td><td><b className="cell-mono">{row.orderNumber}</b><small className="cell-sub">{row.memberNumber ? `สมาชิก ${row.memberNumber}${row.memberName ? ` · ${row.memberName}` : ""}` : "บุคคลทั่วไป"}</small></td><td><span className="row-label">{row.productName}</span><small className="cell-sub">{row.unit}</small></td><td className="num">{row.qty.toLocaleString("th-TH")}</td><td className="num">{money(row.price)}</td><td className="num"><strong>{money(row.amount)}</strong></td><td>{row.paymentMethod}</td><td><small>{row.cashier}</small></td></tr>)}</tbody><tfoot><tr><td colSpan={3}>รวม · {lineItemTotals.bills.toLocaleString("th-TH")} บิล · {lineItemTotals.lines.toLocaleString("th-TH")} รายการ</td><td className="num">{lineItemTotals.qty.toLocaleString("th-TH")}</td><td className="num">—</td><td className="num">{money(lineItemTotals.revenue)}</td><td colSpan={2} /></tr></tfoot></table><small className="line-items-note">แสดงสูงสุด 1,000 รายการล่าสุดในช่วงที่เลือก · กดปุ่ม CSV / Excel / PDF ด้านบนเพื่อพรีวิวและส่งออก</small></div>}</div>}{salesView === "cashier" && <div className="category-report report-breakdown">{cashierQuery.isLoading ? <div className="table-loading"><UsersRound size={22} /><b>กำลังรวบรวมยอดขายตามพนักงานขาย</b><span>ช่วง {effectiveFrom} → {effectiveTo}</span></div> : cashierQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(cashierQuery.error)}</span></div> : cashierRows.length === 0 ? <div className="table-loading"><UsersRound size={22} /><b>ยังไม่มีข้อมูลการขายในช่วงนี้</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน</span></div> : <table className="report-sales-table report-breakdown-table" aria-label="สรุปยอดขายแยกตามพนักงานขาย"><thead><tr><th>พนักงานขาย (ผู้ทำรายการ)</th><th className="num">บิล</th><th className="num">ชิ้น</th><th className="num">บิลสมาชิก</th><th className="num">ส่วนลดรวม</th><th className="num">ยอดขายรวม</th><th className="num">สัดส่วนยอดขาย</th></tr></thead><tbody>{cashierRows.map((row, index) => { const share = cashierTotal.total > 0 ? (row.total / cashierTotal.total) * 100 : 0; return <tr key={row.cashier}><td><span className="row-label">{row.cashier}</span><span className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`} aria-hidden="true"><i style={{ width: `${Math.round(share)}%` }} /></span></td><td className="num">{row.orders.toLocaleString("th-TH")}</td><td className="num">{row.items.toLocaleString("th-TH")}</td><td className="num">{row.memberBills.toLocaleString("th-TH")}</td><td className="num">{money(row.discount)}</td><td className="num"><strong>{money(row.total)}</strong></td><td className="num">{cashierTotal.total > 0 ? `${share.toFixed(1)}%` : "—"}</td></tr>; })}</tbody><tfoot><tr><td>รวมทุกพนักงาน · {cashierRows.length} คน</td><td className="num">{cashierTotal.orders.toLocaleString("th-TH")}</td><td className="num">{cashierTotal.items.toLocaleString("th-TH")}</td><td className="num">{cashierTotal.memberBills.toLocaleString("th-TH")}</td><td className="num">{money(cashierTotal.discount)}</td><td className="num">{money(cashierTotal.total)}</td><td className="num">{cashierTotal.total > 0 ? "100%" : "—"}</td></tr></tfoot></table>}</div>}</section>}{reportTab === "bills" && <section className="panel table-panel" id="bills-history-report"><div className="table-toolbar"><div><h2>ประวัติบิล</h2><p>กดแถวเพื่อเปิดใบเสร็จย้อนหลังได้ทันที · แสดง 50 บิลล่าสุด · รวม {salesHistory.length} บิล</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={billSearch} onChange={(event) => setBillSearch(event.target.value)} placeholder="ค้นหาเลขที่บิล หรือเลขสมาชิก (คีย์/สแกนได้)" /></div><button className="outline-button compact" onClick={() => openBillsExportPreview("csv")}><Download size={15} /> CSV</button><button className="outline-button compact" onClick={() => openBillsExportPreview("xlsx")}><FileBarChart size={15} /> Excel</button><button className="outline-button compact" onClick={() => openBillsExportPreview("pdf")}><FileBarChart size={15} /> PDF</button></div></div><div className="bill-member-filter"><MemberScanPicker members={members} selectedNumber={billMember?.memberNumber ?? null} onSelect={(member) => setBillMember(member)} placeholder="กรองตามสมาชิก — คีย์เลขสมาชิก หรือยิงบาร์โค้ด" inputId="bill-member-filter-input" /></div><div className="table-filter-summary"><span><Search size={13} /> {billMember ? <>สมาชิก <b>{billMember.memberNumber} · สมาชิก{billMember.firstName} {billMember.lastName}</b> — แยกรายบิลของสมาชิกรายนี้</> : billSearch ? `ค้นหา “${billSearch}”` : "บิลล่าสุดจากระบบ"}</span><span>แสดง <b>{Math.min(billsVisible, salesHistory.length)}</b> จาก <b>{salesHistory.length}</b> บิล{billMember && ` · ยอดรวม ${money(salesHistory.slice(0, billsVisible).reduce((sum, entry) => sum + entry.total, 0))}`}</span></div><div className="table-wrap">{salesHistoryQuery.isLoading ? <div className="table-loading"><ReceiptText size={22} /><b>กำลังโหลดประวัติบิล</b><span>ดึง 50 บิลล่าสุดจากระบบ</span></div> : salesHistoryQuery.isError ? <div className="entity-state error" role="alert"><ShieldCheck size={22} /><b>โหลดประวัติบิลไม่สำเร็จ</b><span>{getErrorMessage(salesHistoryQuery.error)}</span></div> : salesHistory.length === 0 ? <div className="entity-state"><ReceiptText size={22} /><b>ไม่พบบิลตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหา</span></div> : <table className="bill-history-table" aria-label="ประวัติบิล"><thead><tr><th>เลขที่บิล</th><th>วันที่ · เวลา</th><th>ลูกค้า</th><th>รายการ</th><th>ชำระโดย</th><th className="hide-sm">พนักงานขาย</th><th className="num">ยอดรวม</th><th aria-label="เปิดใบเสร็จ" /></tr></thead><tbody>{salesHistory.slice(0, billsVisible).map((entry) => { const paymentTone = PAYMENT_PILL_TONE[entry.paymentMethod] ?? "amber"; return <tr className="clickable" key={entry.orderNumber} onClick={() => setViewedReceipt(entry)} title={`ดูใบเสร็จ ${entry.orderNumber}`}><td><b className="bill-number">{entry.orderNumber}</b></td><td><small className="cell-mono">{formatLogDateTime(entry.createdAt)}</small></td><td><b>{entry.memberName ? `สมาชิก ${entry.memberName}` : "บุคคลทั่วไป"}</b>{entry.memberNumber && <small className="cell-mono">{entry.memberNumber}</small>}</td><td><span className="bill-items-cell">{entry.items[0]?.name ?? "—"}{entry.items.length > 1 ? ` +${entry.items.length - 1} รายการ` : ""}</span></td><td><StatusPill tone={paymentTone}>{entry.paymentMethod}</StatusPill></td><td className="hide-sm"><small className="bill-cashier-cell">{entry.cashier ?? "—"}</small></td><td className="num"><strong className="bill-total-cell">{money(entry.total)}</strong></td><td><div className="row-actions-cell">{entry.hasSlip && <SlipViewButton kind="sale" id={entry.id} title={`บิล ${entry.orderNumber}`} subtitle={`${entry.paymentMethod} · ${money(entry.total)} · ${formatLogDateTime(entry.createdAt)}`} />}<button type="button" className="row-open" onClick={() => setViewedReceipt(entry)} title={`ดูใบเสร็จ ${entry.orderNumber}`}>ใบเสร็จ <ArrowRight size={13} /></button></div></td></tr>; })}</tbody></table>}</div>{!salesHistoryQuery.isLoading && !salesHistoryQuery.isError && (billsVisible < salesHistory.length ? <button type="button" className="table-show-more" onClick={() => setBillsVisible((current) => current + 15)}><ChevronDown size={15} /> แสดงบิลเพิ่มอีก <b>{salesHistory.length - billsVisible}</b> บิล</button> : salesHistory.length > 15 && <div className="table-show-more done">แสดงทั้งหมด {salesHistory.length} บิลแล้ว</div>)}</section>}{reportTab === "transactions" && <section className="panel table-panel" id="tx-report"><div className="table-toolbar"><div><h2>ประวัติธุรกรรมสมาชิก</h2><p>ใช้จ่าย · เติมเงิน · ถอนเงิน พร้อมเจ้าหน้าที่ทำรายการทุกรายการ · กรองตามสมาชิก ประเภท และช่วงเวลาได้</p></div><div className="toolbar-actions"><div className="tx-date-range" role="group" aria-label="ช่วงวันที่ของธุรกรรม"><ThaiDatePicker value={txFrom} onChange={pickTxFrom} max={txTo || undefined} ariaLabel="วันเริ่มต้นของธุรกรรม — เลือกวันเดียวก็แค่กดวันนี้" /><span aria-hidden="true">→</span><ThaiDatePicker value={txTo} onChange={pickTxTo} min={txFrom || undefined} ariaLabel="วันสิ้นสุดของธุรกรรม — เว้นว่างไว้คือวันเดียวกับวันเริ่มต้น" /></div><button className="outline-button compact" onClick={() => openTxExportPreview("csv")}><Download size={15} /> CSV</button><button className="outline-button compact" onClick={() => openTxExportPreview("xlsx")}><FileBarChart size={15} /> Excel</button><button className="outline-button compact" onClick={() => openTxExportPreview("pdf")}><FileBarChart size={15} /> PDF</button></div></div><div className="tx-filter-bar"><MemberScanPicker members={members} selectedNumber={txMember?.memberNumber ?? null} onSelect={(member) => setTxMember(member)} placeholder="กรองตามสมาชิก — คีย์เลขสมาชิก หรือยิงบาร์โค้ด" inputId="tx-member-filter-input" /><div className="tx-type-pills" role="group" aria-label="กรองตามประเภทธุรกรรม — กดได้หลายประเภทพร้อมกัน"><button type="button" className={txTypes.length === 0 ? "active" : ""} onClick={() => setTxTypes([])} title="แสดงทุกประเภทธุรกรรม">ทั้งหมด</button>{([["purchase", "ใช้จ่าย"], ["deposit", "เติมเงิน"], ["withdrawal", "ถอนเงิน"], ["activation", "เปิดใช้บัตร"], ["refund", "คืนบัตรเงินสด"], ["limit_request", "ขอลดวงเงิน"]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={txTypes.includes(value)} className={txTypes.includes(value) ? "active" : ""} onClick={() => toggleTxType(value)} title={txTypes.includes(value) ? `กดอีกครั้งเพื่อถอน “${label}” ออกจากตัวกรอง` : `เพิ่ม “${label}” เข้าตัวกรอง — เลือกหลายประเภทพร้อมกันได้`}>{label}{txTypes.includes(value) && <i className="pill-check" aria-hidden="true">✓</i>}</button>)}</div></div><div className="tx-log-strip" role="note"><WalletCards size={14} /><span>การเงินสมาชิกทั้งระบบ (จาก Log): <b className="green-text">เติมเงิน {walletTotals.depositCount} รายการ · {money(walletTotals.deposit)}</b> · <b className="amber-text">ถอนเงิน {walletTotals.withdrawCount} รายการ · {money(walletTotals.withdraw)}</b></span></div><div className="tx-summary-cards six"><div><small>ใช้จ่ายรวม</small><strong className="red-text">−{money(Math.abs(txTotals.spend))}</strong><span>{txTotals.spendCount} รายการ</span></div><div><small>เติมเงินรวม</small><strong className="green-text">+{money(txTotals.deposit)}</strong><span>{txTotals.depositCount} รายการ</span></div><div><small>ถอนเงินรวม</small><strong className="amber-text">−{money(Math.abs(txTotals.withdraw))}</strong><span>{txTotals.withdrawCount} รายการ</span></div><div><small>เปิดใช้บัตรรวม</small><strong className="green-text">+{money(txTotals.activation)}</strong><span>{txTotals.activationCount} รายการ</span></div><div><small>คืนบัตรเงินสดรวม</small><strong className="red-text">−{money(Math.abs(txTotals.refund))}</strong><span>{txTotals.refundCount} รายการ</span></div><div><small>ขอลดวงเงิน</small><strong className="purple-text">{txTotals.limitCount}</strong><span>{limitRequestsQuery.isLoading ? "…" : `รอพิจารณา ${pendingLimitCount} รายการ`}</span></div></div><div className="table-wrap">{txQuery.isLoading ? <div className="table-loading"><Activity size={22} /><b>กำลังโหลดประวัติธุรกรรม</b><span>ดึงข้อมูลจากบัญชีสมาชิกทุกรายการ</span></div> : txQuery.isError ? <div className="entity-state error" role="alert"><Activity size={22} /><b>โหลดประวัติธุรกรรมไม่สำเร็จ</b><span>{getErrorMessage(txQuery.error)}</span></div> : txRows.length === 0 ? <div className="table-loading"><Activity size={22} /><b>ไม่พบธุรกรรมตามเงื่อนไขที่เลือก</b><span>ลองเปลี่ยนตัวกรอง หรือขยายช่วงวันที่</span></div> : <table className="entity-table tx-table" aria-label="ประวัติธุรกรรมสมาชิก"><thead><tr><th>วันที่ · เวลา</th><th>สมาชิก / เลขสมาชิก</th><th>ประเภท</th><th className="hide-sm">รายละเอียด</th><th className="num">ยอดเคลือน</th><th className="num hide-sm">คงเหลือหลังรายการ</th><th className="hide-sm">เจ้าหน้าที่ทำรายการ</th>{isAdminRole(role) && <th>พิจารณา</th>}</tr></thead><tbody>{txRows.map((row) => { const isLimit = row.kind === "limit"; const limitStatus = LIMIT_STATUS_META[row.status ?? "pending"]; return <tr key={row.id} className={isLimit ? "tx-limit" : `tx-${row.type}`}><td><small className="cell-mono" style={{ marginTop: 0 }}>{formatLogDateTime(row.createdAt)}</small></td><td><span className="cell-strong">{row.memberName ?? "—"}</span><small className="cell-sub">เลขสมาชิก {row.memberNumber}</small></td><td>{isLimit ? <span className="tx-type-cell"><StatusPill tone={TX_TYPE_TONE[row.type]}>{TX_TYPE_LABEL[row.type]}</StatusPill><StatusPill tone={limitStatus.tone}>{limitStatus.label}</StatusPill></span> : <StatusPill tone={TX_TYPE_TONE[row.type]}>{TX_TYPE_LABEL[row.type]}</StatusPill>}</td><td className="hide-sm"><span className="tx-detail">{row.detail}</span></td><td className="num">{isLimit ? <span className="tx-limit-amount">{money(row.amount)}<small>วงเงินใหม่ที่ขอ</small></span> : <span className={row.amount >= 0 ? "profit-pos" : "profit-neg"}>{row.amount >= 0 ? "+" : "−"}{money(Math.abs(row.amount))}</span>}</td><td className="num hide-sm">{row.balanceAfter !== null ? money(row.balanceAfter) : "—"}</td><td className="hide-sm"><small className="cell-sub" style={{ marginTop: 0 }}>{row.actor ?? "ไม่ระบุ"}</small></td>{isAdminRole(role) && <td>{isLimit && row.status === "pending" ? <span className="limit-act-row"><button type="button" className="limit-act limit-act-approve" disabled={decideLimitMutation.isPending} onClick={() => { setLimitError(""); setLimitDecision({ row, decision: "approve" }); }}><Check size={12} /> อนุมัติ</button><button type="button" className="limit-act limit-act-reject" disabled={decideLimitMutation.isPending} onClick={() => { setLimitError(""); setLimitDecision({ row, decision: "reject" }); }}><X size={12} /> ปฏิเสธ</button></span> : <small className="cell-sub" style={{ marginTop: 0 }}>—</small>}</td>}</tr>; })}</tbody></table>}</div><div className="session-table-note"><span>{txMember ? `สมาชิก ${txMember.memberNumber} · แสดง 300 รายการล่าสุด` : `แสดง 300 รายการล่าสุดของทุกสมาชิก`}{txFrom || txTo ? ` · ช่วง ${txFrom || "ต้นช่วง"}` : ""}{txTo ? ` → ${txTo}` : ""}</span><span>ข้อมูลจากบัญชีสมาชิกโดยตรง</span></div></section>}{reportTab === "stock" && <section className="panel" id="stock-balance-report"><div className="panel-heading"><div><h2>สินค้าคงคลัง</h2><p>ตามชีทรายงานโรงพยาบาล — รหัสสินค้า · ยอดยกมา · ยอดขาย · คงเหลือ · ช่วงข้อมูล {rangeLabel} (ยอดยกมาคำนวณจากสต็อกปัจจุบันบวกที่ขายออกในช่วง)</p></div><div className="report-export-actions" aria-label="พรีวิวข้อมูลก่อนส่งออกรายงานสินค้าคงคลัง"><button className="outline-button compact" onClick={() => void openStockBalanceExportPreview("csv")} title="พรีวิวแล้วส่งออก CSV"><Download size={15} /> CSV</button><button className="outline-button compact" onClick={() => void openStockBalanceExportPreview("xlsx")} title="พรีวิวแล้วส่งออก Excel"><FileSpreadsheet size={15} /> Excel</button><button className="outline-button compact" onClick={() => void openStockBalanceExportPreview("pdf")} title="พรีวิวแล้วดาวน์โหลด PDF แบบเอกสาร A4"><FileText size={15} /> PDF</button><button className="outline-button compact" onClick={() => void openStockBalanceExportPreview("print")} title="พรีวิวก่อนสั่งพิมพ์"><Printer size={15} /> พิมพ์</button></div></div><div className="report-range-row"><div className="report-tabs report-period-pills" role="group" aria-label="เลือกช่วงเวลาของรายงานสินค้าคงคลัง">{REPORT_RANGE_CHIPS.map((chip) => <button type="button" key={`stock-${chip.value}`} className={rangeMode === chip.value ? "active" : ""} onClick={() => pickRangeChip(chip.value)} title={chip.value === "today" || chip.value === "yesterday" ? "เลือกวันเดียว" : undefined}>{chip.label}</button>)}</div>{rangeMode === "custom" && <div className="report-custom-range"><ThaiDatePicker value={rangeFrom} onChange={pickCustomFrom} max={rangeTo || undefined} ariaLabel="วันเริ่มต้นของรายงานสินค้าคงคลัง" /><span className="range-sep" aria-hidden="true">→</span><ThaiDatePicker value={rangeTo} onChange={pickCustomTo} min={rangeFrom || undefined} ariaLabel="วันสิ้นสุดของรายงานสินค้าคงคลัง — เว้นว่างไว้คือวันเดียวกับวันเริ่มต้น" /></div>}</div><div className="tx-summary-cards"><div><small>รายการทั้งหมด</small><strong>{stockBalanceQuery.isLoading ? "…" : <>{stockTotals.items.toLocaleString("th-TH")} <em className="card-unit">รายการ</em></>}</strong><span>ทุกสินค้าในระบบ</span></div><div><small>ยอดยกมารวม</small><strong>{stockBalanceQuery.isLoading ? "…" : <>{stockTotals.opening.toLocaleString("th-TH")} <em className="card-unit">ชิ้น</em></>}</strong><span>ต้นช่วง {rangeLabel}</span></div><div><small>ขายออกในช่วง</small><strong className="red-text">{stockBalanceQuery.isLoading ? "…" : <>{stockTotals.sold.toLocaleString("th-TH")} <em className="card-unit">ชิ้น</em></>}</strong><span>{rangeLabel}</span></div><div><small>คงเหลือรวม</small><strong className="green-text">{stockBalanceQuery.isLoading ? "…" : <>{stockTotals.remaining.toLocaleString("th-TH")} <em className="card-unit">ชิ้น</em></>}</strong><span>สต็อกปัจจุบัน</span></div></div><div className="table-toolbar"><div><h3>รายการสินค้าคงคลัง</h3><p>{stockBalanceQuery.isLoading ? "กำลังโหลด…" : `${stockBalanceRows.length} รายการ${stockTotals.sold > 0 ? ` · ขายออกไปแล้ว ${stockTotals.sold.toLocaleString("th-TH")} ชิ้นในช่วงนี้` : ""}`}</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={stockSearch} onChange={(event) => setStockSearch(event.target.value)} placeholder="ค้นหาชื่อสินค้า / รหัส / บาร์โค้ด" aria-label="ค้นหารายการสินค้าคงคลัง" /></div></div></div><div className="table-wrap">{stockBalanceQuery.isLoading ? <div className="table-loading"><PackageSearch size={22} /><b>กำลังโหลดรายงานสินค้าคงคลัง</b><span>คำนวณยอดยกมา · ยอดขาย · คงเหลือ ตามช่วงเวลา</span></div> : stockBalanceQuery.isError ? <div className="entity-state error" role="alert"><PackageSearch size={22} /><b>โหลดรายงานสินค้าคงคลังไม่สำเร็จ</b><span>{getErrorMessage(stockBalanceQuery.error)}</span></div> : stockBalanceRows.length === 0 ? <div className="table-loading"><PackageSearch size={22} /><b>ไม่พบรายการสินค้าตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหา</span></div> : <table className="entity-table stock-balance-table" aria-label="รายงานสินค้าคงคลัง"><thead><tr><th className="hide-sm">ลำดับ</th><th>รหัสสินค้า</th><th>ชื่อสินค้า</th><th className="hide-sm">หน่วย</th><th className="num">ยอดยกมา</th><th className="num">ยอดขาย</th><th className="num">คงเหลือ</th></tr></thead><tbody>{stockBalanceRows.map((row, index) => <tr key={row.productId}><td className="hide-sm cell-mono">{exportCount(index + 1)}</td><td><small className="cell-mono" style={{ marginTop: 0 }}>{row.code}</small></td><td><span className="cell-strong">{row.name}</span><small className="cell-sub">{row.category}{row.active === 0 ? " · ปิดการขาย" : ""}</small></td><td className="hide-sm"><small className="cell-sub" style={{ marginTop: 0 }}>{row.unit}</small></td><td className="num cell-mono">{exportCount(row.opening)}</td><td className="num cell-mono">{row.sold > 0 ? <span className="red-text">{exportCount(row.sold)}</span> : exportCount(row.sold)}</td><td className="num cell-mono"><strong className={row.remaining <= 0 ? "red-text" : row.sold > 0 ? "green-text" : undefined}>{exportCount(row.remaining)}</strong></td></tr>)}</tbody></table>}</div><div className="session-table-note"><span>ยอดยกมา = จำนวนต้นช่วง · ยอดขาย = ขายออกในช่วงที่เลือก · คงเหลือ = สต็อกปัจจุบัน</span><span>เปลี่ยนช่วงเวลาได้ที่ปุ่มลัดด้านบนของหน้ารายงาน</span></div></section>}{reportTab === "balances" && <section className="panel" id="member-balances-report"><div className="panel-heading"><div><h2>ยอดเงินในบัตรสมาชิก</h2><p>สรุปยอดสมาชิก — เลขสมาชิก · ยอดทั้งหมด (เปิดใช้ + เติมเงิน) · ยอดจ่าย (ใช้ซื้อ + ถอน + คืนบัตร) · คงเหลือ · วันที่เปิดใช้สมาชิก</p></div><div className="report-export-actions" aria-label="พรีวิวข้อมูลก่อนส่งออกรายงานยอดเงินในบัตร"><button className="outline-button compact" onClick={() => void openBalancesExportPreview("csv")} title="พรีวิวแล้วส่งออก CSV"><Download size={15} /> CSV</button><button className="outline-button compact" onClick={() => void openBalancesExportPreview("xlsx")} title="พรีวิวแล้วส่งออก Excel"><FileSpreadsheet size={15} /> Excel</button><button className="outline-button compact" onClick={() => void openBalancesExportPreview("pdf")} title="พรีวิวแล้วดาวน์โหลด PDF แบบเอกสาร A4"><FileText size={15} /> PDF</button><button className="outline-button compact" onClick={() => void openBalancesExportPreview("print")} title="พรีวิวก่อนสั่งพิมพ์"><Printer size={15} /> พิมพ์</button></div></div><div className="tx-summary-cards"><div><small>สมาชิกทั้งหมด</small><strong>{balancesQuery.isLoading ? "…" : <>{balanceTotals.members.toLocaleString("th-TH")} <em className="card-unit">ราย</em></>}</strong><span>ใช้งาน {balanceTotals.active} · ระงับ {balanceTotals.members - balanceTotals.active}</span></div><div><small>ยอดเงินเข้ารวม</small><strong className="green-text">{balancesQuery.isLoading ? "…" : `+${money(balanceTotals.totalIn)}`}</strong><span>เปิดใช้บัตร + เติมเงิน ทุกใบ</span></div><div><small>ยอดจ่ายรวม</small><strong className="red-text">{balancesQuery.isLoading ? "…" : `−${money(balanceTotals.totalOut)}`}</strong><span>ใช้ซื้อ + ถอน + คืนบัตรเงินสด</span></div><div><small>คงเหลือรวม</small><strong>{balancesQuery.isLoading ? "…" : money(balanceTotals.balance)}</strong><span>ยอดเงินในบัตรทุกใบขณะนี้</span></div></div><div className="table-toolbar"><div><h3>บัตรทุกใบในระบบ</h3><p>{balancesQuery.isLoading ? "กำลังโหลด…" : `${balanceRows.length} ราย · ค้นหาจากชื่อหรือเลขสมาชิก`}</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={balanceSearch} onChange={(event) => setBalanceSearch(event.target.value)} placeholder="ค้นหาชื่อ / เลขสมาชิก" aria-label="ค้นหารายงานยอดเงินในบัตร" /></div></div></div><div className="table-wrap">{balancesQuery.isLoading ? <div className="table-loading"><WalletCards size={22} /><b>กำลังโหลดยอดเงินในบัตร</b><span>สรุปยอดทั้งหมด · ยอดจ่าย · คงเหลือ ของบัตรทุกใบ</span></div> : balancesQuery.isError ? <div className="entity-state error" role="alert"><WalletCards size={22} /><b>โหลดรายงานยอดเงินในบัตรไม่สำเร็จ</b><span>{getErrorMessage(balancesQuery.error)}</span></div> : balanceRows.length === 0 ? <div className="table-loading"><WalletCards size={22} /><b>ไม่พบสมาชิกตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหา</span></div> : <table className="entity-table balances-table" aria-label="รายงานยอดเงินในบัตรสมาชิก"><thead><tr><th className="hide-sm">ลำดับ</th><th>เลขสมาชิก</th><th>ชื่อ-นามสกุล</th><th className="hide-sm">วันที่เปิดใช้สมาชิก</th><th className="num hide-sm">ยอดทั้งหมด</th><th className="num">ยอดจ่าย</th><th className="num">คงเหลือ</th></tr></thead><tbody>{balanceRows.map((row, index) => <tr key={row.memberNumber} className={row.status === "suspended" ? "row-muted" : undefined}><td className="hide-sm cell-mono">{exportCount(index + 1)}</td><td><small className="cell-mono" style={{ marginTop: 0 }}>{row.memberNumber}</small></td><td><span className="cell-strong">{memberFullName(row)}</span><small className="cell-sub">{row.type}{row.status === "suspended" ? " · ระงับ" : ""}</small></td><td className="hide-sm"><small className="cell-sub" style={{ marginTop: 0 }}>{formatThaiDate(row.createdAt)}</small></td><td className="num cell-mono hide-sm">{money(row.totalIn)}</td><td className="num cell-mono">{money(row.totalOut)}</td><td className="num cell-mono"><strong className={row.balance <= 0 ? "red-text" : "green-text"}>{money(row.balance)}</strong></td></tr>)}</tbody></table>}</div><div className="session-table-note"><span>ยอดทั้งหมด = เปิดใช้บัตร + เติมเงิน · ยอดจ่าย = ใช้ซื้อ + ถอน + คืนบัตรเงินสด</span><span>คงเหลือต้องเท่ากับ ยอดทั้งหมด − ยอดจ่าย เสมอ</span></div></section>}{reportTab === "export" && <section className="panel export-panel"><div className="panel-heading"><div><h2>การส่งออกข้อมูล</h2><p>เลือกหัวข้อเป็นแท็บ — ทุกหัวข้อครบ 4 คำสั่ง: PDF พร้อมพิมพ์ · พิมพ์ทันที · Excel · CSV</p></div><FileBarChart size={19} className="muted-icon" /></div><div className="export-topic-tabs" role="tablist" aria-label="เลือกหัวข้อที่จะส่งออก"><button type="button" role="tab" aria-selected={exportTopic === "sales"} className={exportTopic === "sales" ? "active" : ""} onClick={() => setExportTopic("sales")}><FileBarChart size={15} /> ยอดขาย<small>{reportRows.length + (salesView === "product" ? productRows.length : salesView === "items" ? lineItemRows.length : salesView === "category" ? categoryRows.length : salesView === "cashier" ? cashierRows.length : 0)} แถว</small></button><button type="button" role="tab" aria-selected={exportTopic === "bills"} className={exportTopic === "bills" ? "active" : ""} onClick={() => setExportTopic("bills")}><ReceiptText size={15} /> ประวัติบิล<small>{salesHistory.length} บิล</small></button><button type="button" role="tab" aria-selected={exportTopic === "transactions"} className={exportTopic === "transactions" ? "active" : ""} onClick={() => setExportTopic("transactions")}><Activity size={15} /> ธุรกรรมสมาชิก<small>{txRows.length} รายการ</small></button></div><div className="export-topic-body">{exportTopic === "sales" && <div className="export-group"><div className="export-group-head"><h3>รายงานยอดขาย</h3><small>ตามมุมมองและช่วงเวลาที่เลือกไว้ · ช่วง {rangeLabel} · มุมมอง{salesView === "timeline" ? "ภาพรวมตามช่วงเวลา" : salesView === "product" ? "แยกตามสินค้า" : salesView === "items" ? "แยกตามรายการในบิล" : salesView === "category" ? "แยกตามชนิดสินค้า" : "แยกตามพนักงานขาย"}</small></div><div className="export-row export-row-4"><button onClick={() => void openSalesExportPreview("pdf")}><span className="file-icon pdf">PDF</span><span><b>ดาวน์โหลด PDF</b><small>เอกสารรายงาน A4 พร้อมแถวรวม</small></span><Download size={16} /></button><button onClick={() => void openSalesExportPreview("print")}><span className="file-icon print"><Printer size={14} /></span><span><b>สั่งพิมพ์เลย</b><small>เอกสารเดียวกัน ส่งเครื่องพิมพ์เริ่มต้น</small></span><Printer size={16} /></button><button onClick={() => void openSalesExportPreview("xlsx")}><span className="file-icon xls">XLS</span><span><b>Excel</b><small>หัวคอลัมน์ไทย คำนวณต่อได้</small></span><Download size={16} /></button><button onClick={() => void openSalesExportPreview("csv")}><span className="file-icon csv">CSV</span><span><b>CSV</b><small>UTF-8 BOM นำเข้าระบบอื่นได้</small></span><Download size={16} /></button></div></div>}{exportTopic === "bills" && <div className="export-group"><div className="export-group-head"><h3>ประวัติบิล</h3><small>{billMember ? `สมาชิก ${billMember.memberNumber} · ` : billSearch.trim() ? `ตามคำค้น “${billSearch.trim()}” · ` : ""}{salesHistory.length} บิลที่โหลดไว้{billMember ? " · เพิ่มเป็น 200 บิลสำหรับสมาชิกรายนี้" : " · แสดงสูงสุด 50 บิลล่าสุด"}</small></div><div className="export-row export-row-4"><button onClick={() => openBillsExportPreview("pdf")}><span className="file-icon pdf">PDF</span><span><b>ดาวน์โหลด PDF</b><small>เอกสาร A4 รายบิล พร้อมยอดรวมท้ายตาราง</small></span><Download size={16} /></button><button onClick={() => openBillsExportPreview("print")}><span className="file-icon print"><Printer size={14} /></span><span><b>สั่งพิมพ์เลย</b><small>เอกสารเดียวกัน ส่งเครื่องพิมพ์เริ่มต้น</small></span><Printer size={16} /></button><button onClick={() => openBillsExportPreview("xlsx")}><span className="file-icon xls">XLS</span><span><b>Excel</b><small>รายบิล พร้อมวิธีชำระและยอดรวม</small></span><Download size={16} /></button><button onClick={() => openBillsExportPreview("csv")}><span className="file-icon csv">CSV</span><span><b>CSV</b><small>UTF-8 BOM นำเข้าระบบอื่นได้</small></span><Download size={16} /></button></div></div>}{exportTopic === "transactions" && <div className="export-group"><div className="export-group-head"><h3>ประวัติธุรกรรมสมาชิก</h3><small>ตามตัวกรองในแท็บประวัติธุรกรรม · {txRows.length} รายการ{txMember ? ` · สมาชิก ${txMember.memberNumber}` : ""}</small></div><div className="export-row export-row-4"><button onClick={() => openTxExportPreview("pdf")}><span className="file-icon pdf">PDF</span><span><b>ดาวน์โหลด PDF</b><small>เอกสาร A4 ตามตัวกรอง พร้อมผู้ทำรายการ</small></span><Download size={16} /></button><button onClick={() => openTxExportPreview("print")}><span className="file-icon print"><Printer size={14} /></span><span><b>สั่งพิมพ์เลย</b><small>เอกสารเดียวกัน ส่งเครื่องพิมพ์เริ่มต้น</small></span><Printer size={16} /></button><button onClick={() => openTxExportPreview("xlsx")}><span className="file-icon xls">XLS</span><span><b>Excel</b><small>หัวคอลัมน์ไทย คำนวณต่อได้</small></span><Download size={16} /></button><button onClick={() => openTxExportPreview("csv")}><span className="file-icon csv">CSV</span><span><b>CSV</b><small>UTF-8 BOM นำเข้าระบบอื่นได้</small></span><Download size={16} /></button></div></div>}<div className="settings-inline-note"><ShieldCheck size={16} /><span>ไฟล์ PDF และการสั่งพิมพ์เป็นเอกสารรายงาน A4 ที่สร้างใหม่จากข้อมูลที่เลือกไว้ (ไม่ใช่ภาพหน้าจอ) · Excel และ CSV สร้างจากข้อมูลตรงจากระบบ</span></div></div></section>}</div></div>{limitDecision && <div className="modal-backdrop" onClick={() => setLimitDecision(null)}><div className="confirm-modal limit-decide-modal" role="dialog" aria-modal="true" aria-label="ยืนยันการพิจารณาคำขอลดวงเงิน" onClick={(event) => event.stopPropagation()}><div className="confirm-icon"><TrendingDown size={21} /></div><div className="modal-heading"><div><h2>{limitDecision.decision === "approve" ? "ยืนยันการอนุมัติคำขอลดวงเงิน?" : "ยืนยันการปฏิเสธคำขอลดวงเงิน?"}</h2><p>ผู้พิจารณา: {userName || "ผู้ใช้ระบบ"} · ผู้บริหาร</p></div><button className="icon-button" onClick={() => setLimitDecision(null)} aria-label="ปิดหน้าต่าง"><X size={17} /></button></div><div className="wallet-confirm-rows"><div><span>สมาชิก</span><b>{limitDecision.row.memberName ?? "—"} · {limitDecision.row.memberNumber}</b></div><div><span>วงเงินปัจจุบัน</span><b>{limitDecision.row.currentLimit != null ? money(limitDecision.row.currentLimit) : "ไม่จำกัด"}</b></div><div><span>วงเงินใหม่ที่ขอ</span><b className="purple-text">{money(limitDecision.row.amount)}</b></div>{limitDecision.row.reason && <div><span>เหตุผล</span><b>{limitDecision.row.reason}</b></div>}<div><span>ผู้ยื่นคำขอ</span><b>{limitDecision.row.actor ?? "ไม่ระบุ"}</b></div></div><div className="limit-decide-note"><ShieldCheck size={15} /> {limitDecision.decision === "approve" ? `อนุมัติแล้ว วงเงินซื้อสินค้าต่อวันของสมาชิกจะถูกตั้งเป็น ${money(limitDecision.row.amount)} ทันที และบันทึกลง Log` : `ปฏิเสธแล้ว วงเงินของสมาชิกคงเดิม (${limitDecision.row.currentLimit != null ? money(limitDecision.row.currentLimit) : "ไม่จำกัด"}) · สมาชิกยื่นคำขอใหม่ได้`}</div>{limitError && <div className="notice-bar error"><ShieldCheck size={16} /> {limitError}<button onClick={() => setLimitError("")}><X size={14} /></button></div>}<div className="confirm-actions"><button className="outline-button" onClick={() => setLimitDecision(null)}>ยกเลิก</button><button className={limitDecision.decision === "approve" ? "primary-button" : "danger-button"} disabled={decideLimitMutation.isPending} onClick={confirmLimitDecision}><Check size={16} /> {decideLimitMutation.isPending ? "กำลังบันทึก…" : limitDecision.decision === "approve" ? "ยืนยันอนุมัติ" : "ยืนยันปฏิเสธ"}</button></div></div></div>}{viewedReceipt && <ReceiptModal receipt={viewedReceipt} onClose={() => setViewedReceipt(null)} mode="reprint" />}{exportPreview && <ExportPreviewModal state={exportPreview} onClose={() => setExportPreview(null)} onRun={(format) => void runExportPreview(format)} />}{upgradeFeature && <EditionUpgradeModal open onClose={() => setUpgradeFeature(null)} status={edition.status} focusFeature={upgradeFeature} onApplied={() => void edition.refetch()} />}{notice && <div className="notice-bar floating-notice"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</>;
}

type SettingsTab = "install" | "brand" | "receipt" | "member" | "payment" | "posmenu" | "cutoff" | "edition" | "import" | "backup" | "network" | "display" | "alert" | "roles";

// ROUND 40 (ข้อ 32) — นำเข้าข้อมูลจาก Excel/CSV: ชนิด + ชีตที่อ่านได้ + ผลลัพธ์
type ImportKindId = "members" | "products";
type ImportSheetLite = { name: string; headerRowIndex: number; headers: string[]; sampleRows: string[][]; totalRows: number; suggestedMapping: Record<string, number> };
type ImportResultLite = { total: number; inserted: number; updated: number; skipped: number; errors: { row: number; message: string }[]; safetyBackupFile: string; fileName: string };

/** คำอธิบาย field นำเข้าสมาชิก — ลำดับตามที่แสดงบนหน้าจอ */
const MEMBER_IMPORT_FIELDS: { key: string; label: string; required?: boolean; hint?: string }[] = [
  { key: "firstName", label: "ชื่อ", required: true },
  { key: "prename", label: "คำนำหน้า", hint: "เช่น นาย / นาง / นางสาว — เว้นว่างได้" },
  { key: "memberNumber", label: "เลขสมาชิก", hint: "เว้นว่าง = ระบบสร้างเลขใหม่ให้อัตโนมัติ" },
  { key: "lastName", label: "นามสกุล" },
  { key: "balance", label: "ยอดเงินคงเหลือ (บาท)", hint: "บันทึกเป็นรายการ “ยอดยกมา · นำเข้าข้อมูล” ในประวัติสมาชิก" },
  { key: "creditLimit", label: "วงเงิน (บาท)", hint: "เว้นว่าง = ไม่จำกัด" },
  { key: "status", label: "สถานะ", hint: "ปกติ/ใช้งาน = ปกติ · ระงับ/พัก = ระงับ" },
  { key: "phone", label: "เบอร์โทร" },
  { key: "idCard", label: "เลขบัตรประชาชน" },
  { key: "type", label: "ประเภทสมาชิก" },
  { key: "gender", label: "เพศ" },
];

/** คำอธิบาย field นำเข้าสินค้า — ลำดับตามที่แสดงบนหน้าจอ */
const PRODUCT_IMPORT_FIELDS: { key: string; label: string; required?: boolean; hint?: string }[] = [
  { key: "name", label: "ชื่อสินค้า", required: true },
  { key: "barcode", label: "บาร์โค้ด", hint: "ใช้ตรวจสินค้าซ้ำเป็นอันดับแรก" },
  { key: "sku", label: "รหัสสินค้า (SKU)", hint: "เว้นว่าง = ระบบสร้างให้" },
  { key: "category", label: "หมวดหมู่" },
  { key: "unit", label: "หน่วย", hint: "เว้นว่าง = ชิ้น" },
  { key: "price", label: "ราคาขาย (บาท)" },
  { key: "cost", label: "ต้นทุน (บาท)" },
  { key: "stock", label: "สต็อกคงเหลือ", hint: "สินค้าใหม่จะสร้างเป็น Lot “นำเข้าข้อมูล” ให้อัตโนมัติ" },
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
        if (!ctx) { reject(new Error("canvas ไม่พร้อมใช้งาน")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      } catch (err) { reject(err); }
    };
    img.onerror = () => reject(new Error("อ่านรูปไม่สำเร็จ"));
    img.src = dataUrl;
  });
}

/** Real permission matrix — mirrored from canAccessView + role gates in the shell. */
const ROLE_MATRIX: { role: "staff" | "admin"; title: string; caption: string; permits: string[] }[] = [
  {
    role: "staff",
    title: "เจ้าหน้าที่ร้านค้า",
    caption: "ใช้งานหน้าเคาน์เตอร์ประจำวัน",
    permits: ["ขายสินค้าและชำระเงินผ่าน POS", "รับสินค้าเข้าและนับสต็อกรายล็อต", "ลงทะเบียนสมาชิก · แก้ไขข้อมูล · เติม/ถอนเงิน", "พิมพ์บัตรสมาชิกและใบเสร็จ", "ดูรายงานและส่งออกไฟล์"],
  },
  {
    role: "admin",
    title: "ผู้บริหารระบบ",
    caption: "มีสิทธิ์ทุกอย่างเท่าเจ้าหน้าที่ และเพิ่ม",
    permits: ["แก้ไขและลบสินค้า · ลบสมาชิกที่ไม่มีธุรกรรม", "ตั้งค่าระบบและใบเสร็จทั้งหมด", "จัดการผู้ใช้ระบบ · รีเซ็ตรหัสผ่าน · ปลดล็อกบัญชี", "ดูระบบ Log ประวัติการใช้งาน", "ยกเลิก/ปรับปรุงข้อมูลเมื่อมีปัญหา"],
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
const GO_LIVE_CHECKLIST: { id: string; label: string; hint: string; action?: "import" | "users" | "printer" | "backup" | "roles"; auto?: (overview: InstallOverview) => boolean }[] = [
  { id: "brand", label: "ตั้งชื่อร้าน โลโก้ และที่อยู่ครบถ้วน", hint: "แสดงบนหน้าจอ หน้าเข้าสู่ระบบ และหัวใบเสร็จ — ตั้งที่แท็บแบรนด์และธีม" },
  { id: "users", label: "สร้างบัญชีผู้ใช้ครบทุกจุดขาย", hint: "แต่ละจุดขายควรมีบัญชีของตัวเอง (ไม่ใช้ร่วมกัน) — สร้างที่เมนูผู้ใช้ระบบ", action: "users", auto: (overview) => overview.users.active >= 2 },
  { id: "dev-account", label: "สร้างบัญชีผู้พัฒนาไว้ดูแลระยะยาว", hint: "ไว้ให้ผู้ติดตั้งกลับมาตรวจ/อัปเดตระบบภายหลัง — สร้างที่เมนูผู้ใช้ระบบ (รหัสผ่าน 12 ตัวขึ้นไป + มีสัญลักษณ์)", action: "users", auto: (overview) => overview.users.devAccounts >= 1 },
  { id: "products", label: "นำเข้าสินค้า + ตั้งราคาครบทุกรายการ", hint: "สินค้าที่ยังเป็น ฿0 = ยังไม่ได้ตั้งราคาขาย — แก้ที่หน้าสต็อกสินค้าได้เลย", action: "import", auto: (overview) => overview.products.active > 0 && overview.products.zeroPrice === 0 },
  { id: "members", label: "นำเข้าสมาชิก + ยอดเงินเริ่มต้น", hint: "ข้อมูลลูกค้าที่เตรียมมานำเข้าที่แท็บนำเข้าข้อมูล (Excel/CSV) — สมาชิกใหม่ภายหลังลงทะเบียนที่ POS (F6) ได้", action: "import", auto: (overview) => overview.members.active > 0 },
  { id: "test-sale", label: "ทดสอบขายจริงครบทุกวิธีชำระ", hint: "เงินสด · QR · หักบัญชีสมาชิก — ทุกบิลมีขั้นตอนยืนยันก่อนบันทึก ลองให้ครบทั้ง 3 แบบ" },
  { id: "printer", label: "พิมพ์สลิปทดสอบที่เครื่องพิมพ์จริง", hint: "สั่งพิมพ์ทดสอบแล้วเช็คว่าตัวอักษรไทยอ่านชัด ครบทุกบรรทัด ไม่ถูกตัด", action: "printer" },
  { id: "lan", label: "เครื่องอื่นเข้าระบบผ่าน LAN URL ได้", hint: "เปิด URL ด้านบนที่แท็บเล็ต/มือถือของร้าน — ทุกจุดขายต้องเข้าได้ก่อนส่งมอบ" },
  { id: "backup", label: "ตั้งสำรองอัตโนมัติ + ก๊อปไฟล์สำรองออกนอกเครื่อง", hint: "สำรองอัตโนมัติทุก 24 ชม. (ปรับได้ที่แท็บสำรองข้อมูล) — ดาวน์โหลดไฟล์เก็บที่ USB/คลาวด์ด้วย", action: "backup" },
  { id: "handover", label: "เปลี่ยนรหัสผ่านผู้บริหาร + ปิดประตูผู้พัฒนา", hint: "ส่งมอบแล้วให้ผู้บริหารเปลี่ยนรหัสของตัวเอง และปิด Dev Access ที่แท็บสิทธิ์และความปลอดภัย — เปิดใหม่ได้เมื่อช่างมาถึง", action: "roles" },
];

function Settings({ setView, role, initialTab }: { setView: (view: View) => void; role: Role; initialTab?: SettingsTab }) {
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
  const [fontScale, setFontScale] = useState<FontScaleId>(() => readFontScale());
  const [form, setForm] = useState<SettingsForm | null>(null);
  // Threshold input keeps raw digits while typing (cleared field = 0) —
  // committed into the shared form on every keystroke via updateForm.
  const [thresholdText, setThresholdText] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // ROUND 36 (ข้อ 31) — จำนวนบัญชี dev + โมดัลยืนยันตอนเปิด Dev Access
  const usersQuery = trpc.user.list.useQuery(undefined);
  const [devAccessConfirm, setDevAccessConfirm] = useState(false);
  const devAccounts = (usersQuery.data ?? []).filter((user) => user.role === "dev" && user.active === 1);
  // ROUND 42 (ข้อ 32 ตอนที่ 2) — แท็บการเชื่อมต่อ: ข้อมูล LAN จากเซิร์ฟเวอร์ + วัดความหน่วง
  // + สถานะออนไลน์ของเบราว์เซอร์ (โหลดเฉพาะตอนเปิดแท็บนี้ — ไม่วุ่นวายตอนอยู่แท็บอื่น)
  // ROUND 56 — ใช้ร่วมกับแท็บเครื่องมือติดตั้ง (โซนผู้พัฒนา) ด้วย
  const lanInfoQuery = trpc.system.lanInfo.useQuery(undefined, { enabled: tab === "network" || (tab === "install" && isDevRole) });
  const lanInfo = lanInfoQuery.data ?? null;
  // ROUND 56 — ภาพรวมตรวจรับข้อมูลวันขึ้นระบบ (โซนผู้พัฒนา): จำนวนบัญชี/สมาชิก/สินค้า/บิลวันนี้/ขนาด DB
  const installOverviewQuery = trpc.install.overview.useQuery(undefined, { enabled: tab === "install" && isDevRole, retry: false });
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
    return () => { window.removeEventListener("online", sync); window.removeEventListener("offline", sync); };
  }, []);
  const measureLatency = () => {
    const started = performance.now();
    utils.client.system.health.query({ timestamp: Date.now() })
      .then(() => {
        setLatencyMs(Math.round(performance.now() - started));
        setLatencyError(false);
        setLatencyAt(new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      })
      .catch(() => { setLatencyError(true); setLatencyMs(null); });
  };
  useEffect(() => { if (tab === "network") measureLatency(); }, [tab]);
  const copyLanUrl = (text: string) => {
    navigator.clipboard?.writeText(text)
      .then(() => toast.success("คัดลอก URL เรียบร้อย", { description: "นำไปวางที่เบราว์เซอร์ของเครื่องอื่นได้เลย", duration: 2400 }))
      .catch(() => toast.error("คัดลอกไม่สำเร็จ", { description: `คัดลอกด้วยตนเอง: ${text}` }));
  };
  // ROUND 38 (ข้อ 39) — ระบบสำรองข้อมูล: รายการไฟล์ + สร้าง/ดาวน์โหลด/กู้คืน (admin เท่านั้น — เมนูตั้งค่าเข้าได้ admin อยู่แล้ว)
  // ROUND 56 — ดึงด้วยเมื่ออยู่แท็บเครื่องมือติดตั้ง (แสดงไฟล์สำรองล่าสุดให้ช่าง)
  const backupQuery = trpc.backup.list.useQuery(undefined, { enabled: tab === "backup" || (tab === "install" && isDevRole) });
  const lastBackupFile = (backupQuery.data?.backups ?? [])[0] ?? null;
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const createBackupMutation = trpc.backup.create.useMutation({
    onSuccess: (data) => {
      toast.success("สำรองข้อมูลเรียบร้อย", { description: `${data.file} · ${formatFileSize(data.sizeBytes)} · ตรวจสอบความถูกต้องผ่าน (เก็บตามจำนวนที่ตั้งไว้ ${data.keepCount} ไฟล์)`, duration: 5000 });
      void backupQuery.refetch();
    },
    onError: (mutationError) => toast.error("สำรองข้อมูลไม่สำเร็จ", { description: getErrorMessage(mutationError) }),
  });
  const downloadBackupMutation = trpc.backup.download.useMutation({
    onSuccess: (data) => {
      try {
        const binary = atob(data.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([bytes], { type: "application/x-sqlite3" }));
        link.download = data.file;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 4000);
        toast.success("กำลังดาวน์โหลดไฟล์สำรอง", { description: `${data.file} · ${formatFileSize(data.sizeBytes)} — เก็บไว้นอกเครื่อง เช่น USB หรือคลาวด์ กันกรณีเครื่องพัง` });
      } catch {
        toast.error("เปิดไฟล์สำรองไม่สำเร็จ", { description: "ลองดาวน์โหลดอีกครั้ง" });
      }
    },
    onError: (mutationError) => toast.error("ดาวน์โหลดไม่สำเร็จ", { description: getErrorMessage(mutationError) }),
  });
  const restoreBackupMutation = trpc.backup.restore.useMutation({
    onSuccess: async (data) => {
      setRestoreTarget(null);
      toast.success("กู้คืนข้อมูลเรียบร้อย", { description: `ระบบสำรองไฟล์ป้องกันไว้ก่อน (${data.safetyBackupFile}) แล้วเปลี่ยนฐานข้อมูลเป็นไฟล์ที่เลือก — ข้อมูลทั้งระบบกลับมาเป็นช่วงเวลาของไฟล์สำรองนั้น`, duration: 6500 });
      await utils.invalidate();
      void backupQuery.refetch();
    },
    onError: (mutationError) => { setRestoreTarget(null); toast.error("กู้คืนไม่สำเร็จ", { description: getErrorMessage(mutationError), duration: 5500 }); },
  });
  // r87 — อัปโหลดไฟล์ฐานข้อมูล .sqlite จากเครื่องอื่น (ย้ายร้าน/ขึ้นคลาวด์): ตรวจก่อนเข้ารายการสำรอง แล้วกดกู้คืนได้เลย
  const uploadBackupInputRef = useRef<HTMLInputElement | null>(null);
  const uploadBackupMutation = trpc.backup.upload.useMutation({
    onSuccess: async (data) => {
      toast.success("อัปโหลดไฟล์สำเร็จ — ตรวจความถูกต้องผ่านแล้ว", { description: `${data.file} · ${formatFileSize(data.sizeBytes)} — อยู่ใน “ไฟล์สำรองทั้งหมด” ด้านล่างแล้ว กด “กู้คืน” เพื่อนำข้อมูลชุดนี้กลับมาใช้งานทั้งระบบ`, duration: 9000 });
      await utils.invalidate();
      void backupQuery.refetch();
    },
    onError: (mutationError) => toast.error("อัปโหลดไฟล์ไม่สำเร็จ", { description: getErrorMessage(mutationError), duration: 7000 }),
  });
  const startUploadBackupFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!/\.sqlite$/i.test(file.name)) {
      toast.error("รองรับเฉพาะไฟล์ .sqlite", { description: `ได้รับไฟล์ ${file.name} — เลือกไฟล์ welfare-store.sqlite ของระบบเท่านั้น` });
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      toast.error("ไฟล์ใหญ่เกิน 200MB", { description: "ตรวจอีกครั้งว่าเลือกไฟล์ฐานข้อมูลของระบบร้านค้าสวัสดิการถูกตัว" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataBase64 = String(reader.result ?? "").split(",")[1] ?? "";
      if (!dataBase64) {
        toast.error("อ่านไฟล์ไม่สำเร็จ", { description: "ลองเลือกไฟล์ใหม่อีกครั้ง" });
        return;
      }
      uploadBackupMutation.mutate({ fileName: file.name, dataBase64 });
    };
    reader.readAsDataURL(file);
  };
  // ROUND 40 (ข้อ 32) — นำเข้าข้อมูลจาก Excel/CSV: พรีวิว → map คอลัมน์ → execute → ผลลัพธ์
  const [importKind, setImportKind] = useState<ImportKindId>("members");
  const [importFile, setImportFile] = useState<{ name: string; base64: string } | null>(null);
  const [importSheets, setImportSheets] = useState<ImportSheetLite[] | null>(null);
  const [importSheetIndex, setImportSheetIndex] = useState(0);
  const [importHeaderRow, setImportHeaderRow] = useState(0);
  const [importMapping, setImportMapping] = useState<Record<string, number>>({});
  const [duplicateMode, setDuplicateMode] = useState<"skip" | "replace">("skip");
  const [importResult, setImportResult] = useState<ImportResultLite | null>(null);
  const [importConfirm, setImportConfirm] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const currentSheet = importSheets?.[importSheetIndex] ?? null;
  const importFields = importKind === "members" ? MEMBER_IMPORT_FIELDS : PRODUCT_IMPORT_FIELDS;
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
    onSuccess: (data) => {
      applySheetPreview(data.sheets);
      setImportResult(null);
      const first = data.sheets[0];
      toast.success("อ่านไฟล์สำเร็จ", { description: `พบข้อมูล ${first ? first.totalRows.toLocaleString("th-TH") : 0} แถว ใน ${data.sheets.length} ชีต — ตรวจการจับคู่คอลัมน์ด้านล่างก่อนนำเข้า` });
    },
    onError: (mutationError) => {
      setImportSheets(null);
      toast.error("อ่านไฟล์ไม่สำเร็จ", { description: getErrorMessage(mutationError), duration: 5000 });
    },
  });
  const importExecuteMutation = trpc.importData.execute.useMutation({
    onSuccess: async (data) => {
      setImportConfirm(false);
      setImportResult(data);
      if (data.errors.length === 0) {
        toast.success("นำเข้าข้อมูลเรียบร้อย", { description: `เพิ่มใหม่ ${data.inserted.toLocaleString("th-TH")} · อัปเดต ${data.updated.toLocaleString("th-TH")} · ข้าม ${data.skipped.toLocaleString("th-TH")} รายการ — สำรองไฟล์ป้องกันไว้ก่อนนำเข้าแล้ว`, duration: 6000 });
      } else {
        toast.warning("นำเข้าเสร็จแล้ว — มีบางแถวที่ผิดพลาด", { description: `สำเร็จ ${data.inserted + data.updated} · ข้าม ${data.skipped} · ผิดพลาด ${data.errors.length} แถว — ดูรายละเอียดที่ผลลัพธ์ด้านล่าง`, duration: 7000 });
      }
      await utils.invalidate();
    },
    onError: (mutationError) => {
      setImportConfirm(false);
      toast.error("นำเข้าข้อมูลไม่สำเร็จ", { description: getErrorMessage(mutationError), duration: 6000 });
    },
  });
  const importTemplateMutation = trpc.importData.template.useMutation({
    onSuccess: (data) => {
      try {
        const binary = atob(data.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        link.download = data.fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 4000);
        toast.success("กำลังดาวน์โหลดเทมเพลต", { description: `${data.fileName} — เติมข้อมูลตามหัวคอลัมน์ แล้วกลับมาอัปโหลดที่นี่` });
      } catch {
        toast.error("เปิดไฟล์เทมเพลตไม่สำเร็จ");
      }
    },
    onError: (mutationError) => toast.error("ดาวน์โหลดเทมเพลตไม่สำเร็จ", { description: getErrorMessage(mutationError) }),
  });
  const startImportFile = (file: File | null | undefined) => {
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast.error("รองรับเฉพาะไฟล์ .xlsx .xls .csv", { description: `ได้รับไฟล์ ${file.name}` });
      return;
    }
    if (file.size > 5_000_000) {
      toast.error("ไฟล์ใหญ่เกิน 5MB", { description: "แบ่งข้อมูลเป็นหลายไฟล์ แล้วนำเข้าทีละไฟล์" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result ?? "").split(",")[1] ?? "";
      if (!base64) {
        toast.error("อ่านไฟล์ไม่สำเร็จ", { description: "ลองเลือกไฟล์ใหม่อีกครั้ง" });
        return;
      }
      setImportFile({ name: file.name, base64 });
      importPreviewMutation.mutate({ kind: importKind, fileName: file.name, base64 });
    };
    reader.readAsDataURL(file);
  };
  const changeImportKind = (kind: ImportKindId) => {
    if (kind === importKind) return;
    setImportKind(kind);
    setImportResult(null);
    if (importFile) importPreviewMutation.mutate({ kind, fileName: importFile.name, base64: importFile.base64 });
  };
  const changeImportSheet = (index: number) => {
    if (!importSheets) return;
    applySheetPreview(importSheets, index);
  };
  const changeImportHeaderRow = (row: number) => {
    setImportHeaderRow(row);
    if (importFile) importPreviewMutation.mutate({ kind: importKind, fileName: importFile.name, base64: importFile.base64, headerRowOverride: row });
  };
  const setMappingField = (field: string, column: number) => {
    setImportMapping((current) => {
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
      ...(importKind === "members" ? { memberMapping: memberMappingPayload } : { productMapping: productMappingPayload }),
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
  const numberFormat = form ? { prefix: form.memberNumberPrefix, yearMode: form.memberNumberYearMode, yearDigits: form.memberNumberYearDigits, resetMonth: form.memberNumberResetMonth, sequenceDigits: form.memberNumberSequenceDigits, separator: form.memberNumberSeparator } : undefined;
  const nextNumber = formatMemberNumber(numberMode, nextMemberSequence(membersQuery.data ?? [], numberMode, numberFormat), numberFormat);
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
      return new Set<string>(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [form?.posRailHidden]);
  const toggleRailButton = (key: string) => {
    if (!form) return;
    const next = new Set<string>(railHiddenFormSet);
    if (next.has(key)) next.delete(key); else next.add(key);
    updateForm({ posRailHidden: JSON.stringify(Array.from(next)) });
  };
  const shortcutKeyMap = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(form?.posShortcutKeys || "{}");
      return parsed && typeof parsed === "object" ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  }, [form?.posShortcutKeys]);
  const updateShortcutKey = (action: string, value: string) => {
    const next = { ...shortcutKeyMap, [action]: value.trim().toUpperCase() };
    updateForm({ posShortcutKeys: JSON.stringify(next) });
  };
  const captureShortcutKey = (action: string, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (event.key === "Escape" || event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key.toUpperCase();
    const allowed = /^F(?:[1-9]|1[0-2])$/.test(key) || key === "HOME" || /^[A-Z0-9]$/.test(key);
    if (allowed) updateShortcutKey(action, key);
  };
  const dirtyKeys = useMemo(() => {
    if (!form || !serverSettings) return [] as string[];
    return SETTINGS_FIELD_LABELS.filter(([key]) => form[key] !== serverSettings[key]).map(([, label]) => label);
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
      setSaved(true);
      setError("");
      void utils.settings.get.invalidate();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const updateForm = (patch: Partial<SettingsForm>) => setForm((current) => (current ? { ...current, ...patch } : current));
  // ROUND 42 — พรีวิวขนาดกระดาษสลิปแบบสด: เลือกแล้วลอง “พิมพ์ทดสอบ” ได้เลยก่อนบันทึก
  const paperWidth = resolvePaperWidth(form?.receiptPaperWidth);
  useEffect(() => { applyPaperWidth(form?.receiptPaperWidth); }, [form?.receiptPaperWidth]);
  const saveSettings = () => {
    if (!form) return;
    setSaved(false);
    saveMutation.mutate(form);
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
  const goliveDone = goliveCheckedIds.filter((id) => GO_LIVE_CHECKLIST.some((item) => item.id === id)).length;
  const toggleGoliveCheck = (id: string) => {
    if (!form) return;
    const next = goliveCheckedIds.includes(id) ? goliveCheckedIds.filter((item) => item !== id) : [...goliveCheckedIds, id];
    const serialized = JSON.stringify(next);
    updateForm({ goliveChecks: serialized });
    saveMutation.mutate({ goliveChecks: serialized });
  };
  const resetGoliveChecks = () => {
    if (!form) return;
    updateForm({ goliveChecks: "" });
    saveMutation.mutate({ goliveChecks: "" });
    toast.info("ล้างเช็คลิสต์แล้ว", { description: "เริ่มติ๊กรายการใหม่สำหรับรอบขึ้นระบบถัดไป", duration: 3000 });
  };
  // ROUND 25 — แบรนด์และธีม: พรีวิวสี/ชื่อ/โลโก้สดก่อนบันทึก
  const logoInputRef = useRef<HTMLInputElement>(null);
  const chooseTheme = (theme: string) => {
    updateForm({ appTheme: theme });
    applyThemeColor(theme); // พรีวิวทันที — ทุกเครื่องใช้จริงหลังกดบันทึก
  };
  // ROUND 38 (ข้อ 38) — เลือกสไตล์ = เปลี่ยนบุคลิก + สีเน้นของแพลตฟอร์มนั้นพร้อมกัน (พรีวิวสด เหมือนสีธีม)
  const chooseStyle = (styleId: string) => {
    const preset = UI_STYLE_PRESETS.find((item) => item.id === styleId);
    if (!preset) return;
    const theme = styleId === "shop" ? "emerald" : preset.accent; // กลับร้านค้า = กลับเขียวมรกตมาตรฐาน
    updateForm({ appStyle: styleId, appTheme: theme });
    applyUiStyle(styleId);
    applyThemeColor(theme);
  };
  const customThemeHex = /^#[0-9a-fA-F]{6}$/.test(form?.appTheme ?? "") ? (form?.appTheme ?? "#007a55") : resolveThemeColor(form?.appTheme);
  const onLogoPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) { setError("รองรับเฉพาะไฟล์รูป PNG JPG WEBP SVG"); return; }
    if (file.size > 2_000_000) { setError("ไฟล์โลโก้ใหญ่เกิน 2MB — เลือกไฟล์เล็กลง"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      if (!dataUrl) { setError("อ่านไฟล์โลโก้ไม่สำเร็จ"); return; }
      if (file.type === "image/svg+xml") { updateForm({ appLogo: dataUrl }); setError(""); return; } // SVG เก็บต้นฉบับได้ ขนาดเล็กอยู่แล้ว
      shrinkLogoToDataUrl(dataUrl).then((shrunk) => { updateForm({ appLogo: shrunk }); setError(""); }).catch(() => { updateForm({ appLogo: dataUrl }); setError(""); });
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
  const storeTabGroups: { label: string; icon: typeof Bell; tabs: { id: SettingsTab; label: string; icon: typeof Bell }[] }[] = [
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
        ...((canImportExport || isDevRole) ? [{ id: "import" as SettingsTab, label: "นำเข้าข้อมูล", icon: FileSpreadsheet }] : []),
        ...(isAdminRole ? [{ id: "backup" as SettingsTab, label: "สำรองข้อมูล", icon: DatabaseBackup }] : []),
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
  const settingsCategories: { label: string; icon: typeof Bell; dev?: boolean; tabs: { id: SettingsTab; label: string; icon: typeof Bell }[] }[] = [
    ...storeTabGroups,
    ...(isDevRole ? [{ label: "โซนผู้พัฒนา · ติดตั้งระบบ", icon: Wrench, dev: true, tabs: devTabs }] : []),
  ];
  const activeCategoryIndex = Math.max(0, settingsCategories.findIndex((group) => group.tabs.some((item) => item.id === tab)));
  const activeCategory = settingsCategories[activeCategoryIndex];
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
  const periodQuery = trpc.reports.businessPeriod.useQuery(undefined, { refetchInterval: 60_000 });
  const period = periodQuery.data;
  return <><SectionHeader eyebrow="ระบบและการกำหนดค่า" title="ตั้งค่า" description={`ตั้งค่าร้านค้าแบ่งเป็น ${settingsCategories.length} หมวดหลัก — เลือกหมวดด้านบน แล้วเลือกแท็บย่อยของหมวดนั้นต่อได้เลย`} action={<button className="primary-button" disabled={!form || saveMutation.isPending} onClick={saveSettings}><Check size={16} /> {saveMutation.isPending ? "กำลังบันทึก…" : dirtyCount > 0 ? `บันทึกการตั้งค่า · ${dirtyCount} รายการ` : "บันทึกการตั้งค่า"}</button>} /><div className="settings-layout"><div className="settings-cat-row" role="group" aria-label="หมวดหลักของการตั้งค่า">{settingsCategories.map((group, index) => { const CatIcon = group.icon; return <button key={group.label} type="button" className={`settings-cat${group.dev ? " dev-zone" : ""}${index === activeCategoryIndex ? " active" : ""}`} aria-pressed={index === activeCategoryIndex} onClick={() => setTab(group.tabs[0].id)} title={group.label}><span className="cat-ico" aria-hidden="true"><CatIcon size={17} /></span><span className="cat-text"><b>{group.label}</b><small>{group.tabs.length} แท็บ</small></span></button>; })}</div><div className="settings-nav" role="tablist" aria-label={`แท็บย่อยของหมวด${activeCategory.label}`}>{activeCategory.tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={17} /> {label}</button>)}</div><div className="settings-content">{tab === "install" && isDevRole && <><section className="panel settings-card install-hero"><div className="settings-heading"><div><h2>เครื่องมือติดตั้งระบบ</h2><p>รวมทุกอย่างที่ช่างต้องใช้ในวันขึ้นระบบที่หน้างาน — ข้อมูลเครื่อง ตรวจรับข้อมูลลูกค้า ทดสอบเครื่องพิมพ์ และเช็คลิสต์ส่งมอบ</p></div><Wrench size={20} className="muted-icon" /></div><div className="install-chip-row"><span className="install-chip"><HardDriveDownload size={13} /> ฐานข้อมูล {formatFileSize(installOverview?.dbSizeBytes ?? 0)}</span><span className="install-chip"><Activity size={13} /> เปิดมาแล้ว {uptimeLabel(lanInfo?.uptimeSeconds ?? 0)}</span><span className="install-chip"><Wifi size={13} /> พอร์ต {lanInfo?.port ?? "—"}</span><span className="install-chip dev">โซนผู้พัฒนา — มองเห็นเฉพาะบัญชี dev</span></div></section><div className="install-grid"><section className="panel settings-card"><div className="settings-heading"><div><h2>เครื่องเซิร์ฟเวอร์และ URL ของร้าน</h2><p>URL ที่เครื่องอื่นในวงแลนใช้เข้าระบบ — กดคัดลอกแล้วส่งให้ทุกจุดขาย</p></div><Terminal size={20} className="muted-icon" /></div><div className="install-info-rows"><div><span>ชื่อเครื่อง</span><b>{lanInfo?.hostname ?? "…"}</b></div><div><span>ระบบปฏิบัติการ</span><b>{lanInfo?.platform ?? "…"}</b></div><div><span>หน่วยความจำ</span><b>{lanInfo ? `${lanInfo.totalMemoryMb.toLocaleString("th-TH")} MB` : "…"}</b></div><div><span>เวลาที่เปิดมาแล้ว</span><b>{lanInfo ? uptimeLabel(lanInfo.uptimeSeconds) : "…"}</b></div></div><div className="install-lan-urls">{(lanInfo?.addresses ?? []).length > 0 ? lanInfo!.addresses.map((address) => <button key={address} type="button" className="install-url-row" onClick={() => copyLanUrl(`${lanInfo!.https ? "https" : "http"}://${address}:${lanInfo!.port}`)} title="กดเพื่อคัดลอก URL นี้"><Globe size={14} /><b>{lanInfo!.https ? "https" : "http"}://{address}:{lanInfo!.port}</b><Copy size={13} /></button>) : <div className="install-url-empty"><Wifi size={15} /> ไม่พบไอพีวงแลน — เครื่องอาจออฟไลน์อยู่ หรือเข้าผ่าน localhost</div>}</div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ตรวจรับข้อมูลก่อนส่งมอบ</h2><p>ตัวเลขปัจจุบันในระบบ — เทียบกับข้อมูลลูกค้าที่เตรียมมาวันนี้</p></div><ShieldCheck size={20} className="muted-icon" /></div><div className="install-stat-grid"><div><span>บัญชีผู้ใช้</span><b>{installOverview ? `${installOverview.users.active}/${installOverview.users.total} ใช้งาน` : "…"}</b><small>บัญชี dev {installOverview?.users.devAccounts ?? "…"} รายการ</small></div><div><span>สมาชิก</span><b>{installOverview ? `${installOverview.members.active.toLocaleString("th-TH")}/${installOverview.members.total.toLocaleString("th-TH")}` : "…"}</b><small>เงินในบัญชีรวม {money(installOverview?.members.walletTotal ?? 0)}</small></div><div><span>สินค้า</span><b>{installOverview ? `${installOverview.products.active}/${installOverview.products.total}` : "…"}</b><small>ถึงจุดสั่งซื้อ {installOverview?.products.lowStock ?? "…"} รายการ</small></div><div><span>บิลวันนี้</span><b>{installOverview?.sales.todayBills ?? "…"} บิล</b><small>ยอดขาย {money(installOverview?.sales.todayRevenue ?? 0)}</small></div></div>{(installOverview?.products.zeroPrice ?? 0) > 0 && <div className="notice-bar error install-warn"><CircleAlert size={15} /> มีสินค้า {installOverview!.products.zeroPrice} รายการที่ยังไม่ได้ตั้งราคา (฿0) — ตั้งราคาให้ครบก่อนวันขึ้นระบบ ที่หน้าสต็อกสินค้า</div>}<div className="install-action-row"><button type="button" className="outline-button compact" onClick={() => setTab("import")}><FileSpreadsheet size={14} /> นำเข้าสมาชิก/สินค้า</button><button type="button" className="outline-button compact" onClick={() => setView("users")}><UserCog size={14} /> จัดบัญชีผู้ใช้</button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ทดสอบเครื่องพิมพ์สลิป</h2><p>พิมพ์สลิปทดสอบที่เครื่องจริง — ตรวจว่าไทยอ่านชัด ครบทุกบรรทัด ขนาดกระดาษตรง</p></div><Printer size={20} className="muted-icon" /></div><div className="install-action-row"><span className="install-chip">กระดาษ {paperWidth} มม. — เปลี่ยนได้ที่แท็บใบเสร็จ</span><button type="button" className="primary-button compact" onClick={testPrintReceipt}><Printer size={15} /> พิมพ์สลิปทดสอบ</button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>สำรองข้อมูลก่อนส่งมอบ</h2><p>สำรองตัวเลขไว้ก่อนวันขึ้นระบบเสมอ — และดาวน์โหลดเก็บนอกเครื่อง</p></div><DatabaseBackup size={20} className="muted-icon" /></div>{lastBackupFile ? <div className="install-last-backup"><Check size={14} /> ล่าสุด: <b>{lastBackupFile.file}</b> · {formatFileSize(lastBackupFile.sizeBytes)} · {formatLogDateTime(lastBackupFile.createdAt)}</div> : <div className="install-last-backup none"><CircleAlert size={14} /> ยังไม่มีไฟล์สำรองเลย — สร้างไฟล์แรกก่อนส่งมอบ</div>}<div className="install-action-row"><button type="button" className="primary-button compact" disabled={createBackupMutation.isPending} onClick={() => createBackupMutation.mutate()}><DatabaseBackup size={15} /> {createBackupMutation.isPending ? "กำลังสำรอง…" : "สำรองข้อมูลเดี๋ยวนี้"}</button><button type="button" className="outline-button compact" onClick={() => setTab("backup")}>ดูไฟล์สำรองทั้งหมด</button></div></section></div><section className="panel settings-card"><div className="settings-heading"><div><h2>เช็คลิสต์วันขึ้นระบบ</h2><p>ติ๊กทำเสร็จทีละข้อ — บันทึกไว้กลางระบบ ทีมงานเห็นตรงกันทุกเครื่อง · บางข้อระบบตรวจให้อัตโนมัติจากตัวเลขจริง</p></div><ListChecks size={20} className="muted-icon" /></div><div className="golive-progress"><div className="golive-progress-bar"><i style={{ width: `${Math.round((goliveDone / GO_LIVE_CHECKLIST.length) * 100)}%` }} /></div><b>{goliveDone}/{GO_LIVE_CHECKLIST.length} ข้อ</b></div><div className="golive-list">{GO_LIVE_CHECKLIST.map((item) => { const checked = goliveCheckedIds.includes(item.id); const autoPass = item.auto && installOverview ? item.auto(installOverview) : null; return <label key={item.id} className={`golive-item${checked ? " checked" : ""}`}><input type="checkbox" checked={checked} onChange={() => toggleGoliveCheck(item.id)} aria-label={item.label} /><span className="golive-item-body"><b>{item.label}</b><small>{item.hint}</small></span>{autoPass != null && <span className={`golive-auto ${autoPass ? "pass" : "warn"}`}><ShieldCheck size={12} /> {autoPass ? "ตรวจแล้ว" : "ยังไม่ครบ"}</span>}</label>; })}</div><div className="install-action-row"><button type="button" className="danger-outline-button compact" onClick={resetGoliveChecks} disabled={!form || saveMutation.isPending}><RotateCcw size={14} /> ล้างเช็คลิสต์ (เริ่มรอบใหม่)</button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ส่งมอบและปิดงาน</h2><p>ทำตามลำดับนี้ก่อนจากหน้างาน — แล้วร้านใช้งานต่อได้เองโดยไม่ต้องมีช่างอยู่</p></div><LogOut size={20} className="muted-icon" /></div><div className="install-handover-steps"><div className="install-handover-step"><b>1</b><div><b>ให้ผู้บริหารเปลี่ยนรหัสผ่านของตัวเอง</b><small>เมนูผู้ใช้ระบบ → แก้ไข → เปลี่ยนรหัสผ่าน — ช่างไม่ควรรู้รหัสของลูกค้า</small></div></div><div className="install-handover-step"><b>2</b><div><b>ปิดประตูผู้พัฒนา (Dev Access)</b><small>ปัจจุบัน{form?.devAccess ? "เปิดอยู่ — ปิดที่แท็บสิทธิ์และความปลอดภัยก่อนจาก" : "ปิดอยู่แล้ว"} · บัญชี dev จะเข้าไม่ได้จนกว่าร้านจะเปิดใหม่ (โทรติดต่อช่าง)</small></div></div><div className="install-handover-step"><b>3</b><div><b>สรุปวิธีใช้หลักให้ทีมร้าน</b><small>ขายหน้าร้าน · เติม/ถอนเงิน (F2/F3) · ลงทะเบียนสมาชิก (F6) · ดูรายงานประจำวัน · สำรองข้อมูลเป็นระยะ</small></div></div></div><div className="install-action-row"><button type="button" className="outline-button compact" onClick={() => setTab("roles")}><ShieldCheck size={14} /> ไปแท็บสิทธิ์และความปลอดภัย</button><button type="button" className="outline-button compact" onClick={() => setView("users")}><UserCog size={14} /> ไปเมนูผู้ใช้ระบบ</button></div></section></>}{tab === "brand" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>ชื่อร้านและโลโก้</h2><p>ชื่อและโลโก้จะแสดงบนหน้าจอ แถบเมนู หน้าเข้าสู่ระบบ และหัวใบเสร็จ</p></div><Palette size={20} className="muted-icon" /></div><div className="form-grid"><label className="wide">ชื่อแอป / ร้านค้า<input value={form?.appName ?? ""} onChange={(event) => updateForm({ appName: event.target.value })} placeholder="เช่น ร้านค้าสวัสดิการ" disabled={!form} maxLength={80} /></label><label className="wide">โลโก้ร้านค้า<div className="logo-uploader">{form?.appLogo ? <img className="logo-preview" src={form.appLogo} alt="โลโก้ปัจจุบัน" /> : <span className="logo-empty"><ImageIcon size={20} /></span>}<div className="logo-actions"><div className="logo-button-row"><button type="button" className="outline-button compact" disabled={!form} onClick={() => logoInputRef.current?.click()}><ImagePlus size={15} /> {form?.appLogo ? "เปลี่ยนรูป" : "เลือกรูปโลโก้"}</button>{form?.appLogo && <button type="button" className="danger-outline-button compact" disabled={!form} onClick={() => updateForm({ appLogo: "" })}><Trash2 size={15} /> ลบโลโก้</button>}</div><small>รองรับ PNG JPG WEBP SVG · ระบบย่อเป็น 256px อัตโนมัติ · ไม่ใส่ก็ได้ จะใช้อักษรย่อแทน</small></div><input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={onLogoPick} /></div></label><label className="wide">เบอรโทรศูนย์ช่วยเหลือร้าน (021234567 หรือ 0812345678)<input value={form?.helpPhone ?? ""} onChange={(event) => updateForm({ helpPhone: event.target.value })} placeholder="เช่น 023456789 หรือ 0812345678 — ใส่แล้วจะขึ้นท้ายหน้าจอทุกหน้า" disabled={!form} maxLength={32} inputMode="tel" title="เบอรติดต่อภายในร้าน แสดงที่แถบล่างของทุกหน้าจอ — ไม่กรอกจะไม่แสดง" /></label></div><div className="brand-live-preview" aria-label="ตัวอย่างหน้าจอ"><span className="eyebrow">ตัวอย่างการแสดงผล</span><div className="brand-preview-card">{(form?.appLogo ?? "") ? <img src={form?.appLogo ?? ""} alt="" /> : <div className="brand-mark"><span>{brandInitial(form?.appName || "ร้านค้าสวัสดิการ")}</span></div>}<div><b>{(form?.appName ?? "").trim() || "ร้านค้าสวัสดิการ"}</b><small>Welfare Store</small></div></div></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>สีธีมของแอป</h2><p>สีหลักของระบบ — ปุ่ม แถบเมนู จุดเน้นทั้งแอป · เห็นพรีวิวทันที กดบันทึกเพื่อใช้กับทุกเครื่อง</p></div><Palette size={20} className="muted-icon" /></div><div className="theme-swatches">{THEME_PRESETS.map((preset) => <button type="button" key={preset.id} className={`theme-swatch${(form?.appTheme ?? "") === preset.id ? " active" : ""}`} onClick={() => chooseTheme(preset.id)}><span className="swatch-dot" style={{ background: preset.base }} /><b>{preset.label}</b><small>{preset.base.toUpperCase()}</small></button>)}</div><div className="theme-custom-row"><span>สีกำหนดเอง</span><input type="color" value={customThemeHex} onChange={(event) => chooseTheme(event.target.value)} aria-label="เลือกสีธีมกำหนดเอง" /><code>{customThemeHex.toUpperCase()}</code><small>เลือกจากพาเลตต์ด้านบน หรือกำหนดโค้ดสีเอง</small></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>สไตล์หน้าตาแอป (Design Style)</h2><p>บุคลิกการออกแบบทั้งระบบ — ฟอนต์ ความมนของปุ่ม พื้นหลัง · เลือกแล้วเห็นทันทีบนหน้าจอนี้ กดบันทึกเพื่อใช้กับทุกเครื่อง</p></div><Sparkles size={20} className="muted-icon" /></div><div className="ui-style-grid">{UI_STYLE_PRESETS.map((style) => <button type="button" key={style.id} className={`ui-style-card${(form?.appStyle ?? "shop") === style.id ? " active" : ""}`} onClick={() => chooseStyle(style.id)} disabled={!form} aria-pressed={(form?.appStyle ?? "shop") === style.id}><span className="ui-style-preview" data-preview={style.id} aria-hidden="true"><i className="pv-side" /><span className="pv-body"><b className="pv-title" /><b className="pv-chip" /><b className="pv-btn" /></span></span><b>{style.label}</b><small>{style.detail}</small><small className="style-font-hint">ฟอนต์: {style.fontFamily}</small></button>)}</div><div className="settings-inline-note style-note-row"><Sparkles size={16} /><span>สไตล์จะพาสีเน้นของแพลตฟอร์มนั้นมาด้วย (เช่น Apple = น้ำเงิน) — ปรับสีเน้นแยกได้ที่พาเลตต์ด้านบน · กลับ “ร้านค้า” = คืนเขียวมรกตมาตรฐาน</span></div></section></>}{tab === "receipt" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>ข้อมูลร้านบนใบเสร็จ</h2><p>ชื่อ รหัส และที่อยู่ — แสดงที่หัวใบเสร็จและรายงาน</p></div><ShoppingBag size={20} className="muted-icon" /></div><div className="form-grid"><label>ชื่อร้านค้า<input value={form?.storeName ?? ""} onChange={(event) => updateForm({ storeName: event.target.value })} placeholder="ชื่อร้านค้า" disabled={!form} /></label><label>รหัสร้านค้า<input value={form?.storeCode ?? ""} onChange={(event) => updateForm({ storeCode: event.target.value })} placeholder="รหัสร้านค้า" disabled={!form} /></label><label className="wide">ที่อยู่<input value={form?.storeAddress ?? ""} onChange={(event) => updateForm({ storeAddress: event.target.value })} placeholder="ที่อยู่" disabled={!form} /></label></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ใบเสร็จรับเงิน</h2><p>กำหนดรายละเอียดที่ต้องการแสดงบนใบเสร็จ</p></div><ReceiptText size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>พิมพ์ใบเสร็จหลังชำระเงิน</b><small>ชำระเสร็จแล้วระบบแสดงหน้าใบเสร็จพร้อมปุ่ม พิมพ์ · บันทึกรูป · ดาวน์โหลด PDF — ไม่เด้งไปหน้าสั่งพิมพ์ด้วยตัวเอง (รอบ 75)</small></div><span className="pos-rail-locked-pill">พร้อมใช้</span></div><div className="toggle-row"><div><b>แสดงยอดคงเหลือสมาชิกบนใบเสร็จ</b><small>แสดงยอดคงเหลือล่าสุดบนทุกใบเสร็จที่ระบุสมาชิก พร้อมชื่อผู้ทำรายการ</small></div><button className={`toggle ${form?.showBalanceOnReceipt ? "on" : ""}`} onClick={() => updateForm({ showBalanceOnReceipt: !form?.showBalanceOnReceipt })} disabled={!form} aria-label="แสดงยอดคงเหลือบนใบเสร็จ"><span /></button></div></section><section className="panel settings-card printer-card"><div className="settings-heading"><div><h2>เครื่องพิมพ์หน้าร้าน</h2><p>ระบบส่งงานพิมพ์ทันทีที่กดยืนยัน — ที่เครื่องพิมพ์เริ่มต้นของเครื่องนี้โดยตรง</p></div><Printer size={20} className="muted-icon" /></div><div className="printer-flow-steps"><div className="printer-step"><b>1</b><div><b>ตั้งเครื่องพิมพ์เริ่มต้นที่เครื่องคอมพิวเตอร์</b><small>Windows: การตั้งค่า → อุปกรณ์ → เครื่องพิมพ์และสแกนเนอร์ → กด “ตั้งเป็นค่าเริ่มต้น” · macOS: การตั้งค่าระบบ → เครื่องพิมพ์และสแกนเนอร์ → เครื่องพิมพ์เริ่มต้น · ตั้งครั้งเดียว ทุกใบเสร็จ/สลิป/บัตรจะวิ่งไปเครื่องนี้</small></div></div><div className="printer-step"><b>2</b><div><b>กด “พิมพ์ใบเสร็จ” ที่หน้าสำเร็จหลังชำระเงิน</b><small>ชำระเสร็จแล้วระบบแสดงหน้าใบเสร็จให้เลือกเอง — พิมพ์ (ผ่านพรีวิว) · บันทึกรูป PNG · ดาวน์โหลด PDF · แล้วเริ่มรายการขายใหม่ได้ทันที ไม่มีการเด้งไปหน้าสั่งพิมพ์ระหว่างทาง</small></div></div><div className="printer-step"><b>3</b><div><b>อยากให้พิมพ์เงียบ ๆ ไม่ต้องกด</b><small>เปิด Chrome ด้วยคำสั่ง --kiosk-printing (เมนู Start → Chrome → Properties → เพิ่มท้าย Target) — สลิปจะออกจากเครื่องพิมพ์ทันทีที่ยืนยัน ไม่มีหน้าต่าง · ตั้งครั้งเดียวโดยผู้ดูแลระบบ</small></div></div><div className="printer-step"><b>4</b><div><b>กระดาษออกมายาวเกินหลังท้ายรายการ?</b><small>ระบบจัดความยาวสลิปตามจำนวนรายการให้แล้ว (ไม่มีขอบกระดาษ) — ส่วนที่เกินมาจากขนาดกระดาษในไดรเวอร์เครื่องพิมพ์: หน้าต่างพิมพ์ของ Chrome → ขอบกระดาษ “ไม่มี” + ปิดหัว-ท้ายกระดาษ และตั้งความสูงกระดาษที่ Windows การตั้งค่า → อุปกรณ์ → เครื่องพิมพ์ → ปรับแต่งการพิมพ์ ให้ใกล้ความยาวสลิปจริง (ดูวิธีทีละขั้นได้ที่ปุ่ม “ข้อแนะนำ” ในหน้าต่างพรีวิวก่อนพิมพ์)</small></div></div></div><div className="paper-width-block"><div className="paper-width-head"><b>ขนาดกระดาษสลิปของเครื่องพิมพ์</b><small>เลือกตามความกว้างกระดาษจริงในเครื่องพิมพ์หน้าร้าน — ใบเสร็จ สลิปเติม/ถอนเงิน และสลิปทดสอบจะจัดหน้าตามขนาดนี้เวลาพิมพ์ (หน้าจอยังเหมือนเดิม) · เลือกแล้วลอง “พิมพ์ทดสอบ” ได้เลยก่อนบันทึก</small></div><div className="number-mode-grid paper-width-grid">{PAPER_WIDTHS.map((option) => <button className={paperWidth === option.id ? "selected" : ""} key={option.id} onClick={() => updateForm({ receiptPaperWidth: option.id })} disabled={!form} aria-pressed={paperWidth === option.id} title={`พิมพ์สลิปกว้าง ${option.label}`}><span className="number-radio">{paperWidth === option.id && <i />}</span><span><b>{option.label}</b><small>{option.detail}</small></span></button>)}</div></div><div className="printer-test-row"><div><b>ทดสอบการพิมพ์</b><small>พรีวิวสลิปตัวอย่างก่อน แล้วส่งไปเครื่องพิมพ์เริ่มต้น — เช็คกระดาษ/หมึก/ความชัดก่อนเปิดร้าน</small></div><button type="button" className="outline-button" onClick={testPrintReceipt}><Printer size={16} /> พิมพ์ทดสอบ</button></div><div className="printer-tips"><span className="eyebrow">ขนาดกระดาษที่ระบบออกแบบไว้</span><div className="printer-tip-pills"><span>ใบเสร็จ / สลิปเติม–ถอน / สรุปรอบตัดยอด · เลือกได้ด้านบน (58–80 มม.)</span><span>บัตรสมาชิก · 85.6 × 54 มม. (CR80)</span><span>รายงาน PDF · A4</span></div></div>{printerTestOpen && <div className="receipt-paper printer-test-slip" id="printer-test-slip"><div className="receipt-brand"><div><b>{form?.storeName || "ร้านค้าสวัสดิการ"}</b><small>ทดสอบการพิมพ์</small></div></div><div className="receipt-divider" /><div className="receipt-meta"><span>สลิปทดสอบเครื่องพิมพ์</span><b>{formatThaiDate(new Date())}</b></div><div className="receipt-line"><span>ตัวอักษรไทย</span><b>กขคง ๑๒๓</b></div><div className="receipt-line"><span>ตัวเลข</span><b>฿1,234.56</b></div><div className="receipt-total"><span>ถ้าอ่านชัดทุกบรรทัด</span><b>เครื่องพิมพ์พร้อม</b></div><div className="receipt-thanks">สลิปนี้พิมพ์จากเครื่องพิมพ์เริ่มต้นของเครื่อง<br /><small>ปรับกระดาษหรือหัวพิมพ์ถ้าตัวอักษรจาง</small></div></div>}{printerPreviewOpen && <PrintPreviewModal targetId="printer-test-slip" title="พรีวิวก่อนพิมพ์สลิปทดสอบ" subtitle="สลิปตัวอย่างสำหรับเช็คเครื่องพิมพ์ — ตัวอักษรไทย ตัวเลข และจุดตัดบรรทัด" paper="thermal" chips={["สลิปทดสอบเครื่องพิมพ์", formatThaiDate(new Date())]} onClose={() => { setPrinterPreviewOpen(false); setPrinterTestOpen(false); }} onPrint={() => { toast.success("ส่งสลิปทดสอบไปเครื่องพิมพ์แล้ว", { description: "ถ้าไม่มีอะไรออกมา ตรวจกระดาษ / สาย USB / เครื่องพิมพ์เริ่มต้นของเครื่อง" }); }} />}</section></>}{tab === "member" && <div className="settings-single"><section className="panel settings-card"><div className="settings-heading"><div><h2>การออกเลขสมาชิกใหม่</h2><p>เลือกวิธีออกหมายเลขให้สมาชิกที่ลงทะเบียนใหม่</p></div><CreditCard size={20} className="muted-icon" /></div><div className="number-mode-grid">{[["running", "รันเลขต่อเนื่อง", "M-000001, M-000002, ..."], ["year", "ขึ้นต้นด้วยปี", "69-00001, 69-00002, ..."], ["manual", "กำหนดเอง", "เจ้าหน้าที่กรอกหมายเลขเอง"]].map(([value, title, detail]) => <button className={numberMode === value ? "selected" : ""} key={value} onClick={() => updateForm({ memberNumberMode: value as SettingsForm["memberNumberMode"] })} disabled={!form}><span className="number-radio">{numberMode === value && <i />}</span><span><b>{title}</b><small>{detail}</small></span></button>)}</div><div className="member-number-format-grid"><label>คำนำหน้าเลขสมาชิก<input value={form?.memberNumberPrefix ?? ""} onChange={(event) => updateForm({ memberNumberPrefix: event.target.value })} maxLength={20} placeholder="เช่น M หรือ WEL" disabled={!form || numberMode === "manual"} /></label><label>จำนวนหลักเลขรัน<select value={form?.memberNumberSequenceDigits ?? 6} onChange={(event) => updateForm({ memberNumberSequenceDigits: Number(event.target.value) })} disabled={!form || numberMode === "manual"}>{[3, 4, 5, 6, 7, 8, 9, 10].map((digits) => <option value={digits} key={digits}>{digits} หลัก</option>)}</select></label><label>รูปแบบปี<select value={form?.memberNumberYearMode ?? "none"} onChange={(event) => updateForm({ memberNumberYearMode: event.target.value as SettingsForm["memberNumberYearMode"] })} disabled={!form || numberMode === "manual"}><option value="none">ไม่ใช้ปี</option><option value="buddhist">พ.ศ.</option><option value="gregorian">ค.ศ.</option></select></label>{(form?.memberNumberYearMode ?? "none") !== "none" && <><label>จำนวนหลักปี<select value={form?.memberNumberYearDigits ?? 2} onChange={(event) => updateForm({ memberNumberYearDigits: Number(event.target.value) as 2 | 4 })} disabled={!form}><option value={2}>2 หลัก เช่น 69</option><option value={4}>4 หลัก เช่น 2569</option></select></label><label>ตัวคั่นระหว่างส่วน<select value={form?.memberNumberSeparator ?? "-"} onChange={(event) => updateForm({ memberNumberSeparator: event.target.value as SettingsForm["memberNumberSeparator"] })} disabled={!form}><option value="-">ขีดกลาง (-)</option><option value="/">ทับ (/)</option><option value="_">ขีดล่าง (_)</option><option value="">ไม่ใช้ตัวคั่น</option></select></label><label>เดือนเริ่มรอบเลข<select value={form?.memberNumberResetMonth ?? 1} onChange={(event) => updateForm({ memberNumberResetMonth: Number(event.target.value) })} disabled={!form}>{[1,2,3,4,5,6,7,8,9,10,11,12].map((month) => <option value={month} key={month}>{new Date(2000, month - 1, 1).toLocaleString("th-TH", { month: "long" })}</option>)}</select></label></>}</div><div className="member-number-presets"><b>รูปแบบสำเร็จรูป</b><button type="button" className="outline-button compact" onClick={() => updateForm({ memberNumberMode: "year", memberNumberPrefix: "", memberNumberYearMode: "buddhist", memberNumberYearDigits: 2, memberNumberSeparator: "", memberNumberSequenceDigits: 5 })} disabled={!form}>ปี พ.ศ. 2 หลัก + เลข 5 หลัก · 6900001</button><small>ปีจะเปลี่ยนอัตโนมัติตาม “เดือนเริ่มรอบเลข” ที่กำหนดไว้ด้านบน</small></div><div className="settings-inline-note"><ShieldCheck size={16} /><span>รูปแบบตัวอย่าง: คำนำหน้า + ปี + เลขรัน · เช่น WEL-69-00001, WEL/69/00001 หรือ 6900001 ตามตัวคั่นที่เลือก · เมื่อถึงเดือนเริ่มรอบ ระบบจะเริ่มเลขรันชุดใหม่ของปีนั้น</span></div><div className="number-preview"><span>ตัวอย่างสมาชิกถัดไป</span><b>{nextNumber}</b></div></section></div>}{tab === "payment" && <div className="settings-single"><section className="panel settings-card"><div className="settings-heading"><div><h2>รูปแบบการชำระเงินที่รองรับ</h2><p>วิธีชำระเงินที่เจ้าหน้าที่สามารถใช้ได้ที่หน้าร้าน / POS</p></div><WalletCards size={20} className="muted-icon" /></div><div className="payment-method-list"><div className="payment-method-row"><span className="pay-icon cash"><WalletCards size={19} /></span><div><b>เงินสด</b><small>รับเงินสดที่เคาน์เตอร์ · เหมาะกับบุคคลทั่วไปที่ไม่ได้เป็นสมาชิก</small></div><StatusPill tone="green">ใช้งานได้</StatusPill></div><div className="payment-method-row"><span className="pay-icon qr"><CreditCard size={19} /></span><div><b>QR / สแกน</b><small>ลูกค้าสแกนจ่ายผ่านแอปธนาคาร แล้วเจ้าหน้าที่กดยืนยันบิล</small></div><StatusPill tone="blue">ใช้งานได้</StatusPill></div><div className="payment-method-row"><span className="pay-icon member"><UsersRound size={19} /></span><div><b>หักบัญชีสมาชิก</b><small>หักยอดจากบัญชีสวัสดิการทันที · ต้องเลือกสมาชิกในบิลก่อนกดชำระ และสมาชิกต้องไม่ถูกระงับ</small></div><StatusPill tone="purple">ใช้งานได้</StatusPill></div></div><div className="settings-inline-note"><ShieldCheck size={16} /><span>การเติมเงินและถอนเงินสมาชิก ทำที่หน้าร้านผ่านทางลัด F2 / F3 · สมาชิกใช้จ่ายที่เคาน์เตอร์ด้วยหมายเลขสมาชิกเท่านั้น</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("pos")}><ArrowRight size={16} /> ไปที่หน้าร้าน / POS</button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>บัญชีพร้อมเพย์ร้าน (QR รับเงิน)</h2><p>ใส่ครั้งเดียว — หน้ายืนยันชำระเงินจะขึ้นคิวอาร์ให้ลูกค้าสแกนจ่ายตามยอดบิลอัตโนมัติ</p></div><QrCode size={20} className="muted-icon" /></div><div className="form-grid"><label className="wide">เบอร์โทรศัพท์หรือเลขบัตรประชาชนของบัญชีพร้อมเพย์ร้าน<input value={form?.promptpayId ?? ""} onChange={(event) => updateForm({ promptpayId: event.target.value })} placeholder="เช่น 0812345678 หรือ 1234567890123" disabled={!form} maxLength={20} inputMode="numeric" title="ใช้เบอร์โทร 10 หลัก หรือเลขบัตรประชาชน 13 หลัก ของบัญชีพร้อมเพย์ที่รับเงินของร้าน" /></label></div>{(form?.promptpayId ?? "").trim() === "" ? <div className="settings-inline-note amber"><CircleAlert size={16} /><span>ยังไม่ได้ตั้ง — หน้า POS ยังยืนยันบิล QR ได้ตามปกติ แต่จะไม่มีคิวอาร์ให้ลูกค้าสแกน และเก็บหลักฐานสลิปเอง</span></div> : !isValidPromptPayId(form?.promptpayId ?? "") ? <div className="notice-bar error"><CircleAlert size={16} /> รูปแบบไม่ถูกต้อง — ต้องเป็นเบอร์โทร 9–10 หลัก หรือเลขบัตรประชาชน 13 หลัก (ตัวเลขเท่านั้น)</div> : <div className="settings-inline-note"><ShieldCheck size={16} /><span>พร้อมใช้ — คิวอาร์ที่ขึ้นหน้า POS เป็นแบบระบุยอดตามบิล (พร้อมเพย์มาตรฐานธนาคาร) ลูกค้าสแกนแล้วโอนได้เลย</span></div>}<div className="settings-inline-note"><ShieldCheck size={16} /><span>ตอนขายด้วยวิธี “QR / สแกน” เจ้าหน้าที่ยังถ่ายรูปหรือแนบสลิปการโอนไว้กับบิลได้ — เปิดดูย้อนหลังได้ที่รายงาน → ประวัติบิล</span></div></section></div>}{tab === "posmenu" && <div className="settings-single"><section className="panel settings-card"><div className="settings-heading"><div><h2>เมนูลัดหน้าร้าน (POS)</h2><p>เพิ่มหรือปิดปุ่มบนรางซ้ายหน้า POS ได้ตามการใช้งานจริงของร้าน — ปุ่มที่ปิดจะซ่อนจากรางทันที และคีย์ลัด F ของปุ่มนั้นหยุดทำงานด้วย (กันกดพลาดจากคีย์ลัด) บันทึกแล้วทุกเครื่องเห็นเหมือนกัน</p></div><LayoutDashboard size={20} className="muted-icon" /></div><div className="pos-rail-manage-list">{POS_RAIL_BUTTONS.map((button) => { const hidden = railHiddenFormSet.has(button.key); const Icon = button.icon; return <div className={`pos-rail-manage-row${hidden ? " off" : ""}`} key={button.key}><span className="pos-rail-manage-ico"><Icon size={17} /></span><div><b>{button.label} <kbd>{button.kbd}</kbd></b><small>{button.detail}</small></div><div className="pos-rail-key-control"><button type="button" className="pos-rail-key-input" aria-label={`ปุ่มลัด${button.label}`} onKeyDown={(event) => captureShortcutKey(button.key, event)} disabled={!form || hidden} title="กดปุ่มนี้ แล้วกดคีย์บนคีย์บอร์ดที่ต้องการ">{shortcutKeyMap[button.key] ?? button.kbd}</button><button className={`toggle ${!hidden ? "on" : ""}`} onClick={() => toggleRailButton(button.key)} disabled={!form} aria-label={`${hidden ? "เพิ่มกลับ" : "ปิดใช้งาน"}ปุ่ม${button.label} บนราง POS`} title={hidden ? "กดเพื่อเพิ่มปุ่มนี้กลับเข้าราง POS" : "กดเพื่อปิดปุ่มนี้ — ซ่อนจากรางและคีย์ลัดหยุดทำงาน"}><span /></button></div></div>; })}<div className="pos-rail-manage-row locked"><span className="pos-rail-manage-ico"><LayoutDashboard size={17} /></span><div><b>เมนู <kbd>Esc</kbd></b><small>กลับสู่เมนูหลัก · ภาพรวมระบบ — ปุ่มทางออกของหน้า POS ใช้งานเสมอ (รอบ 75: ใช้ Esc แทน F9 เพราะมือถือไม่มีปุ่ม F9 แต่มี Esc บนคีย์บอร์ดเสมือน)</small></div><span className="pos-rail-locked-pill">ใช้งานเสมอ</span></div></div><div className="settings-inline-note"><ShieldCheck size={16} /><span>เปิด/ปิดปุ่มและกำหนดคีย์ลัดได้ในแถวเดียวกัน · ปุ่มที่ปิดจะซ่อนจาก POS และปุ่มลัดจะหยุดทำงาน · กดปุ่มช่องคีย์ลัดแล้วกด F1–F12, Home หรือปุ่มตัวอักษรบนคีย์บอร์ด (ห้ามใช้ Esc)</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("pos")}><ArrowRight size={16} /> ไปดูผลที่หน้าร้าน / POS</button></div></section></div>}{tab === "cutoff" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>รอบตัดยอดประจำวัน</h2><p>กำหนดว่าสรุปยอดขายและธุรกรรมของ “หนึ่งวัน” จะถูกตัดเมื่อไร — ให้ระบบตัดให้เองตามเวลา หรือให้เจ้าหน้าที่กดตัดยอดเอง</p></div><CalendarClock size={20} className="muted-icon" /></div><div className="number-mode-grid">{[["auto", "ระบบตัดยอดให้อัตโนมัติ", `รอบวิ่งตามเวลาที่กำหนด เช่น ${(form?.dailyCutOffTime ?? "00:00")} ทุกวัน`], ["manual", "เจ้าหน้าที่ตัดยอดเอง", "กดปุ่ม “ตัดยอดรอบนี้” ที่หน้าภาพรวมเมื่อพร้อม"]].map(([value, title, detail]) => <button className={(form?.dailyCutOffMode ?? "auto") === value ? "selected" : ""} key={value} onClick={() => updateForm({ dailyCutOffMode: value as SettingsForm["dailyCutOffMode"] })} disabled={!form}><span className="number-radio">{(form?.dailyCutOffMode ?? "auto") === value && <i />}</span><span><b>{title}</b><small>{detail}</small></span></button>)}</div>{(form?.dailyCutOffMode ?? "auto") === "auto" && <div className="cutoff-time-row"><label>เวลาตัดยอดของรอบอัตโนมัติ<input type="time" value={form?.dailyCutOffTime ?? "00:00"} onChange={(event) => updateForm({ dailyCutOffTime: event.target.value })} disabled={!form} aria-label="เวลาตัดยอด (ชั่วโมง:นาที)" /></label><div className="cutoff-time-hint"><CalendarClock size={15} /><span>รอบการขาย 1 วัน จะเริ่ม–จบตามเวลานี้ เช่น 02:00 = รอบวิ่ง 02:00 ของวันนี้ ถึง 02:00 ของวันถัดไป · เหมาะกับร้านที่ปิดหลังเที่ยงคืน แล้วให้ยอดข้ามคืนไปรวมกับวันเดียวกัน</span></div></div>}</section><section className="panel settings-card"><div className="settings-heading"><div><h2>รอบปัจจุบัน (สดจากระบบ)</h2><p>ตามการตั้งค่าที่บันทึกไว้ในขณะนี้ — ไม่ใช่ค่าที่ยังแก้ไม่ได้บันทึก</p></div><Activity size={20} className="muted-icon" /></div>{periodQuery.isLoading ? <div className="cutoff-period-loading">กำลังโหลดข้อมูลรอบปัจจุบัน…</div> : period ? <div className="cutoff-period"><div className="cutoff-period-head"><StatusPill tone={period.mode === "auto" ? "blue" : "purple"}>{period.mode === "auto" ? `ระบบตัดอัตโนมัติ · ${period.cutOffTime} ทุกวัน` : "เจ้าหน้าที่ตัดยอดเอง"}</StatusPill><small>รอบเริ่ม {formatLogDateTime(period.periodStart)}{period.nextCutOffAt ? ` · รอบถัดไป ${formatLogDateTime(period.nextCutOffAt)}` : ""}</small></div><div className="cutoff-period-stats"><div><small>บิลในรอบ</small><strong>{period.totals.bills.toLocaleString("th-TH")}</strong></div><div><small>ชิ้นที่ขาย</small><strong>{period.totals.pieces.toLocaleString("th-TH")}</strong></div><div><small>ยอดขายรอบนี้</small><strong>{money(period.totals.revenue)}</strong></div><div><small>เงินสด / QR</small><strong>{money(period.totals.cashTotal)} / {money(period.totals.qrTotal)}</strong></div><div><small>หักบัญชีสมาชิก</small><strong>{money(period.totals.walletTotal)}</strong></div><div><small>เติม / ถอน</small><strong>{money(period.totals.deposits)} / {money(period.totals.withdrawals)}</strong></div></div>{period.lastClosure && <div className="cutoff-last"><CalendarDays size={15} /><div><b>ตัดยอดล่าสุด {formatLogDateTime(period.lastClosure.closedAt)}</b><small>โดย {period.lastClosure.closedBy ?? "—"} · รอบ {formatLogDateTime(period.lastClosure.periodStart)} → {formatLogDateTime(period.lastClosure.closedAt)} · {period.lastClosure.bills} บิล · {money(period.lastClosure.revenue)}</small></div></div>}<div className="settings-inline-note"><ShieldCheck size={16} /><span>ปุ่ม “ตัดยอดรอบนี้” อยู่ที่หน้าภาพรวม — ทั้งเจ้าหน้าที่และผู้บริหารกดได้ · ทุกครั้งที่ตัดยอด ระบบสร้างสรุปรอบใหม่และบันทึกลง Log ทันที</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("dashboard")}><ArrowRight size={16} /> ไปที่หน้าภาพรวมเพื่อตัดยอด</button></div></div> : <div className="cutoff-period-loading">ยังไม่มีข้อมูลรอบปัจจุบัน</div>}</section></>}{tab === "edition" && <>
          <section className="settings-section edition-section">
            <div className="settings-section-head"><h2>เวอร์ชันที่ใช้งานอยู่</h2><p>ตามลิขสิทธิ์ของร้าน — เปลี่ยนได้ทุกเมื่อด้วยรหัสลิขสิทธิ์ (ไม่กระทบข้อมูลทั้งหมด)</p></div>
            {edition.status ? <>
              <div className="edition-status-card">
                <div className={`edition-status-icon tone-${EDITIONS[edition.status.edition].tone}`}><Crown size={22} /></div>
                <div className="edition-status-body">
                  <b>{editionStatusLabel(edition.status)}</b>
                  <p>{EDITIONS[edition.status.edition].caption}</p>
                  <div className="edition-status-chips">
                    {edition.status.licensedTo && <span>ผู้ถือลิขสิทธิ์: {edition.status.licensedTo}</span>}
                    {edition.status.licenseExpiresAt && <span>ลิขสิทธิ์ถึง {edition.status.licenseExpiresAt}</span>}
                    {edition.status.source === "trial" && <span className="trial">ทดลองใช้เหลือ {edition.status.trialDaysLeft} วัน</span>}
                    {edition.status.licenseState === "expired" && <span>รหัสเดิมหมดอายุแล้ว — ใส่รหัสใหม่ด้านล่าง</span>}
                    <span>ข้อมูลร้านค้าทั้งหมดปลอดภัยไม่ว่าเวอร์ชันไหน</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  <button type="button" className="primary-button" onClick={() => setUpgradeOpen(true)}><KeyRound size={15} /> ใช้รหัสลิขสิทธิ์ / เริ่มทดลองใช้</button>
                  <button type="button" className="outline-button" onClick={() => void edition.refetch()}><RefreshCw size={15} /> ตรวจสถานะใหม่</button>
                </div>
              </div>
              <EditionCompareTable current={edition.status.edition} />
              <div className="settings-inline-note"><CircleHelp size={16} /><span>เปลี่ยนเวอร์ชันไม่กระทบข้อมูลของร้าน — สิทธิ์ที่ถูกปิดจะซ่อนจากหน้าจอเท่านั้น ข้อมูลสินค้า สมาชิก และบิลยังอยู่ครบทุกอย่าง · ระบบใหม่เริ่มที่เวอร์ชันทั่วไปและทดลองใช้โปรพลัส 30 วันได้ฟรี</span></div>
              {isDevRole && <DevKeygenTool />}
            </> : <div className="table-loading"><Crown size={22} /><b>กำลังตรวจสอบเวอร์ชัน…</b><span>อ่านลิขสิทธิ์จากเซิร์ฟเวอร์</span></div>}
            {upgradeOpen && <EditionUpgradeModal open onClose={() => setUpgradeOpen(false)} status={edition.status} onApplied={() => void edition.refetch()} />}
          </section>
        </>}{tab === "import" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>นำเข้าข้อมูลจากไฟล์ Excel / CSV</h2><p>ขึ้นข้อมูลจริงจากไฟล์ที่ร้านมีอยู่ — ระบบอ่านหัวตารางให้ จับคู่คอลัมน์ให้อัตโนมัติ และสำรองข้อมูลเป็นไฟล์ป้องกันก่อนนำเข้าทุกครั้ง</p></div><FileSpreadsheet size={20} className="muted-icon" /></div><div className="import-kind-grid">{[["members", "สมาชิกและยอดเงิน", "เลขสมาชิก · ชื่อ-นามสกุล · ยอดคงเหลือ · วงเงิน · สถานะ · เบอร์โทร", <UsersRound size={19} key="icon-m" />], ["products", "สินค้าและสต็อก", "บาร์โค้ด · ชื่อสินค้า · หมวด · หน่วย · ราคา · ต้นทุน · สต็อก · จุดสั่งซื้อ", <ShoppingBag size={19} key="icon-p" />]].map(([value, title, detail, icon]) => <button type="button" key={String(value)} className={`import-kind-card${importKind === value ? " selected" : ""}`} onClick={() => changeImportKind(value as ImportKindId)} aria-pressed={importKind === value}><span className="import-kind-icon">{icon}</span><span><b>{String(title)}</b><small>{String(detail)}</small></span></button>)}</div><div className="import-template-row"><div><b>ยังไม่มีไฟล์ หรือจะเริ่มจากต้นแบบ?</b><small>ดาวน์โหลดเทมเพลต .xlsx ที่หัวคอลัมน์ภาษาไทยตรงกับระบบ — กรอกเสร็จแล้วกลับมาอัปโหลดที่นี่ได้เลย</small></div><button type="button" className="outline-button" disabled={importTemplateMutation.isPending} onClick={() => importTemplateMutation.mutate({ kind: importKind })}><FileSpreadsheet size={16} /> {importTemplateMutation.isPending ? "กำลังสร้างไฟล์…" : "ดาวน์โหลดเทมเพลต .xlsx"}</button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>อัปโหลดไฟล์ข้อมูล</h2><p>รองรับ .xlsx .xls .csv · ขนาดไม่เกิน 5MB · ไฟล์จะถูกอ่านเพื่อพรีวิวก่อนเสมอ — ยังไม่แตะข้อมูลจริงจนกว่าจะกดยืนยัน</p></div><FileUp size={20} className="muted-icon" /></div>{!importFile ? <div className="import-dropzone" role="button" tabIndex={0} aria-label="เลือกหรือลากไฟล์ Excel มาวางเพื่ออัปโหลด" onClick={() => importInputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); importInputRef.current?.click(); } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); startImportFile(event.dataTransfer.files?.[0]); }}><FileSpreadsheet size={30} /><b>คลิกเลือกไฟล์ หรือลากไฟล์มาวางที่นี่</b><small>{importKind === "members" ? "ไฟล์รายชื่อสมาชิก เช่น รายชื่อสมาชิก.xlsx · สมาชิก.csv" : "ไฟล์รายการสินค้า เช่น สินค้าทั้งหมด.xlsx · คลังสินค้า.csv"}</small><span className="import-drop-hint">ระบบจะอ่านหัวตารางและจับคู่คอลัมน์ให้อัตโนมัติ</span></div> : <div className="import-file-info"><span className="import-file-icon"><FileSpreadsheet size={19} /></span><div><b>{importFile.name}</b><small>{currentSheet ? `อ่านแล้ว · ${currentSheet.totalRows.toLocaleString("th-TH")} แถว · ${(Math.max(1, Math.round((importFile.base64.length * 3) / 4 / 1024))).toLocaleString("th-TH")} KB` : importPreviewMutation.isPending ? "กำลังอ่านไฟล์…" : "อ่านไฟล์แล้ว"}</small></div><div className="import-file-actions"><button type="button" className="outline-button compact" onClick={() => importInputRef.current?.click()}><FileUp size={14} /> เปลี่ยนไฟล์</button><button type="button" className="danger-outline-button compact" onClick={resetImportFlow}><X size={14} /> ล้าง</button></div></div>}{importPreviewMutation.isPending && <div className="import-reading-row"><span className="mini-spinner" aria-hidden="true" /> กำลังอ่านไฟล์และจับคู่คอลัมน์…</div>}<input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => { startImportFile(event.target.files?.[0]); event.target.value = ""; }} /></section>{currentSheet && importFile && <section className="panel settings-card"><div className="settings-heading"><div><h2>ตรวจสอบการจับคู่คอลัมน์</h2><p>ระบบเดาให้แล้วจากชื่อหัวตาราง — ตรวจทานและปรับได้ก่อนนำเข้า · คอลัมน์หนึ่งใช้กับข้อมูลชนิดเดียว</p></div><Table2 size={20} className="muted-icon" /></div><div className="import-preview-controls">{(importSheets ?? []).length > 1 && <label>ชีต<select value={importSheetIndex} onChange={(event) => changeImportSheet(Number(event.target.value))}>{(importSheets ?? []).map((sheet, index) => <option key={sheet.name} value={index}>{sheet.name} ({sheet.totalRows.toLocaleString("th-TH")} แถว)</option>)}</select></label>}<label>แถวหัวตารางอยู่แถวที่<select value={importHeaderRow} onChange={(event) => changeImportHeaderRow(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((row) => <option key={row} value={row}>{row + 1}</option>)}</select></label><span className="import-row-count"><b>{currentSheet.totalRows.toLocaleString("th-TH")}</b> แถวข้อมูล จะนำเข้า</span></div><div className="import-mapping-grid">{importFields.map((field) => <label key={field.key} className={field.required && (importMapping[field.key] ?? -1) < 0 ? "import-field missing" : "import-field"}><span>{field.label}{field.required ? " *" : ""}</span><select value={importMapping[field.key] ?? -1} onChange={(event) => setMappingField(field.key, Number(event.target.value))} aria-label={`คอลัมน์สำหรับ ${field.label}`}><option value={-1}>— ไม่นำเข้า —</option>{currentSheet.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>คอลัมน์ {importColumnLabel(index)} · {header}</option>)}</select>{field.hint && <small>{field.hint}</small>}</label>)}</div><div className="import-sample-block"><div className="import-sample-head"><Table2 size={15} /> ตัวอย่าง 8 แถวแรกจากไฟล์ <span>ตรวจว่าคอลัมน์ที่จับคู่มีข้อมูลถูกชนิด</span></div><div className="import-sample-table"><table><thead><tr>{currentSheet.headers.map((header, index) => <th key={`${header}-${index}`} className={(Object.values(importMapping).includes(index)) ? "mapped" : ""} title={header}>{importColumnLabel(index)}<span>{header}</span></th>)}</tr></thead><tbody>{currentSheet.sampleRows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell === "" ? <i className="import-blank">ว่าง</i> : cell}</td>)}</tr>)}</tbody></table></div></div><div className="import-duplicate-row"><div><b>รายการที่ซ้ำกับข้อมูลในระบบ</b><small>{importKind === "members" ? "ตรวจซ้ำจากเลขสมาชิก — ไม่กรอกเลขสมาชิก = สร้างเป็นสมาชิกใหม่เสมอ" : "ตรวจซ้ำจากบาร์โค้ด → รหัสสินค้า → ชื่อสินค้า"}</small></div><div className="import-duplicate-options" role="radiogroup" aria-label="วิธีจัดการรายการซ้ำ">{[["skip", "ข้ามรายการซ้ำ", "เห็นว่ามีแล้ว ไม่แตะข้อมูลเดิม (ปลอดภัยสุด)"], ["replace", "อัปเดตข้อมูลที่ซ้ำ", "เอาข้อมูลใหม่จากไฟล์ทับรายการเดิมในระบบ"]].map(([value, title, detail]) => <button type="button" key={value} role="radio" aria-checked={duplicateMode === value} className={duplicateMode === value ? "selected" : ""} onClick={() => setDuplicateMode(value as "skip" | "replace")}><span className="number-radio">{duplicateMode === value && <i />}</span><span><b>{title}</b><small>{detail}</small></span></button>)}</div></div><div className="import-run-row"><div><b>พร้อมนำเข้า {currentSheet.totalRows.toLocaleString("th-TH")} แถว</b><small>ระบบสำรองข้อมูลทั้งระบบเป็นไฟล์ป้องกันก่อนนำเข้าเสมอ — หาผลไม่ตามที่คิด กู้คืนกลับได้ที่แท็บสำรองข้อมูล</small></div><button type="button" className="primary-button" disabled={importExecuteMutation.isPending || (importMapping[importFields.find((f) => f.required)?.key ?? ""] ?? -1) < 0} onClick={() => setImportConfirm(true)}><Check size={16} /> {importExecuteMutation.isPending ? "กำลังนำเข้า…" : "นำเข้าข้อมูล"}</button></div></section>}{importResult && <section className="panel settings-card import-result-card"><div className="settings-heading"><div><h2>ผลการนำเข้า</h2><p>จากไฟล์ {importResult.fileName} · บันทึกลงระบบเรียบร้อยแล้ว</p></div><Check size={20} className="muted-icon" /></div><div className="import-result-stats"><div className="ok"><small>เพิ่มใหม่</small><strong>{importResult.inserted.toLocaleString("th-TH")}</strong></div><div className="ok"><small>อัปเดต</small><strong>{importResult.updated.toLocaleString("th-TH")}</strong></div><div><small>ข้าม</small><strong>{importResult.skipped.toLocaleString("th-TH")}</strong></div><div className={importResult.errors.length > 0 ? "bad" : ""}><small>ผิดพลาด</small><strong>{importResult.errors.length.toLocaleString("th-TH")}</strong></div></div>{importResult.errors.length > 0 && <div className="import-error-list"><div className="import-error-head">แถวที่นำเข้าไม่สำเร็จ (แสดงไม่เกิน 20 แถวแรก)</div>{importResult.errors.slice(0, 20).map((rowError) => <div className="import-error-row" key={rowError.row}><b>แถว {rowError.row}</b><span>{rowError.message}</span></div>)}{importResult.errors.length > 20 && <div className="import-error-row more">และอีก {importResult.errors.length - 20} แถว — แก้ไขในไฟล์แล้วนำเข้าเฉพาะแถวที่เหลืออีกครั้งได้</div>}</div>}<div className="settings-inline-note"><DatabaseBackup size={16} /><span>ไฟล์ป้องกันก่อนนำเข้า: <b>{importResult.safetyBackupFile}</b> — หากผลไม่ต้องการ ไปที่แท็บ “สำรองข้อมูล” แล้วกู้คืนไฟล์นี้ได้ทันที</span></div><div className="import-result-actions"><button type="button" className="outline-button" onClick={() => { resetImportFlow(); importInputRef.current?.click(); }}><FileUp size={16} /> นำเข้าไฟล์อื่นต่อ</button><button type="button" className="outline-button" onClick={() => setView(importKind === "members" ? "members" : "stock")}><ArrowRight size={16} /> ไปดู{importKind === "members" ? "ข้อมูลสมาชิก" : "สต็อกสินค้า"}</button></div></section>}</>}{tab === "backup" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>สำรองข้อมูลด้วยตนเอง (Manual)</h2><p>กดปุ่มเดียวจบ — ได้ไฟล์สำรองข้อมูลร้านทั้งหมดตรวจสอบความถูกต้องแล้ว</p></div><HardDriveDownload size={20} className="muted-icon" /></div><div className="backup-now-row"><div><b>สำรองข้อมูลร้านทั้งหมดเป็นไฟล์เดียว</b><small>สมาชิก · สต็อก · ธุรกรรม · บิล · ผู้ใช้ระบบ · การตั้งค่า — ตรวจสอบความถูกต้อง (integrity check) อัตโนมัติทุกไฟล์ ใช้เวลาไม่กี่วินาที</small></div><button className="primary-button" onClick={() => createBackupMutation.mutate()} disabled={createBackupMutation.isPending}><DatabaseBackup size={16} /> {createBackupMutation.isPending ? "กำลังสำรอง…" : "สำรองตอนนี้"}</button></div><div className="backup-now-row backup-upload-row"><div><b>นำไฟล์ฐานข้อมูลจากเครื่องอื่นเข้าระบบ</b><small>เช่น welfare-store.sqlite จากเครื่องร้านเดิม — ระบบตรวจสอบไฟล์ให้ก่อนทุกครั้ง แล้วเพิ่มเข้า “ไฟล์สำรองทั้งหมด” ด้านล่าง กด “กู้คืน” เพื่อย้ายข้อมูลทั้งระบบ (สมาชิก · สต็อก · บิล · ผู้ใช้และรหัสผ่านเดิม) มาใช้ที่นี่ได้เลย</small></div><button className="outline-button" onClick={() => uploadBackupInputRef.current?.click()} disabled={uploadBackupMutation.isPending}><FileUp size={16} /> {uploadBackupMutation.isPending ? "กำลังตรวจสอบไฟล์…" : "เลือกไฟล์ .sqlite"}</button><input ref={uploadBackupInputRef} type="file" hidden onChange={(event) => { startUploadBackupFile(event.target.files?.[0]); event.target.value = ""; }} /></div><div className="settings-inline-note"><ShieldCheck size={16} /><span>แนะนำกดสำรองก่อนปิดร้านทุกวัน และกด “ดาวน์โหลด” เก็บไฟล์ลง USB หรือคลาวด์เป็นชุดที่สอง — กันกรณีเครื่องพังทั้งเครื่อง ไฟล์ในเครื่องจะหายไปด้วย</span></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>สำรองข้อมูลอัตโนมัติ (Auto)</h2><p>ระบบสำรองให้เองตามรอบเวลา — ไม่ต้องจำ ไม่ต้องกด · ปรับแล้วกด “บันทึกการตั้งค่า” ด้านล่าง</p></div><CalendarClock size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>เปิดสำรองข้อมูลอัตโนมัติ</b><small>ตรวจทุก 10 นาที — ครบรอบเวลาที่กำหนดจะสำรองให้เอง พร้อมเก็บไว้เท่าจำนวนที่ตั้ง</small></div><button className={`toggle ${form?.backupAutoEnabled ? "on" : ""}`} onClick={() => updateForm({ backupAutoEnabled: !form?.backupAutoEnabled })} disabled={!form} aria-label="เปิดสำรองข้อมูลอัตโนมัติ"><span /></button></div>{form?.backupAutoEnabled && <div className="backup-interval-grid"><label>รอบเวลาสำรองอัตโนมัติ<select value={String(form?.backupIntervalHours ?? 24)} onChange={(event) => updateForm({ backupIntervalHours: Number(event.target.value) })} disabled={!form} aria-label="รอบเวลาสำรองอัตโนมัติ">{[[6, "ทุก 6 ชั่วโมง (วันละ 4 ครั้ง)"], [12, "ทุก 12 ชั่วโมง (วันละ 2 ครั้ง)"], [24, "ทุก 24 ชั่วโมง (วันละครั้ง — แนะนำ)"], [48, "ทุก 2 วัน"], [168, "ทุกสัปดาห์"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>เก็บไฟล์สำรองไว้ไม่เกิน<select value={String(form?.backupKeepCount ?? 14)} onChange={(event) => updateForm({ backupKeepCount: Number(event.target.value) })} disabled={!form} aria-label="จำนวนไฟล์สำรองที่เก็บ">{[[7, "7 ไฟล์ล่าสุด"], [14, "14 ไฟล์ล่าสุด (แนะนำ)"], [30, "30 ไฟล์ล่าสุด"], [60, "60 ไฟล์ล่าสุด"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>}<div className="settings-inline-note"><CalendarClock size={16} /><span>ไฟล์เก่ากว่าจำนวนที่ตั้ง จะถูกลบออกเองเพื่อไม่ให้ฮาร์ดดิสก์เต็ม — ไฟล์ที่ดาวน์โหลดเก็บไว้นอกเครื่องจะไม่ถูกลบ</span></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ไฟล์สำรองทั้งหมด</h2><p>ใหม่สุดขึ้นก่อน · ดาวน์โหลดเก็บนอกเครื่อง หรือกู้คืนกลับมาใช้เมื่อข้อมูลมีปัญหา</p></div><ArchiveRestore size={20} className="muted-icon" /></div>{backupQuery.isLoading ? <div className="cutoff-period-loading">กำลังโหลดรายการไฟล์สำรอง…</div> : backupQuery.isError ? <div className="inline-message error" role="alert"><ShieldCheck size={15} /> โหลดรายการไฟล์สำรองไม่สำเร็จ — {getErrorMessage(backupQuery.error)}</div> : (backupQuery.data?.backups ?? []).length === 0 ? <div className="backup-empty"><DatabaseBackup size={30} /><b>ยังไม่มีไฟล์สำรอง</b><small>กด “สำรองตอนนี้” ด้านบนเพื่อสร้างไฟล์แรก หรือเปิดสำรองอัตโนมัติให้ระบบจัดการให้</small></div> : <div className="backup-list">{(backupQuery.data?.backups ?? []).map((row) => <div className="backup-row" key={row.file}><span className="backup-icon"><DatabaseBackup size={16} /></span><div><b title={row.file}>{row.file}</b><small>{formatLogDateTime(row.createdAt)} · {formatFileSize(row.sizeBytes)}{row.integrity === "ok" ? " · ตรวจสอบความถูกต้องผ่าน" : ""}</small></div><div className="backup-actions"><button type="button" className="outline-button compact" disabled={downloadBackupMutation.isPending} onClick={() => downloadBackupMutation.mutate({ file: row.file })} title={`ดาวน์โหลด ${row.file} เก็บไว้นอกเครื่อง`}><Download size={14} /> ดาวน์โหลด</button><button type="button" className="danger-outline-button compact" disabled={restoreBackupMutation.isPending} onClick={() => setRestoreTarget(row.file)} title={`กู้คืนข้อมูลกลับไปเป็นช่วงเวลาของ ${row.file}`}><ArchiveRestore size={14} /> กู้คืน</button></div></div>)}</div>}<div className="settings-inline-note backup-restore-note"><ShieldCheck size={16} /><span>การกู้คืนจะ<b>แทนที่ข้อมูลทั้งระบบ</b>ด้วยไฟล์สำรองนั้น — ระบบสำรองข้อมูลปัจจุบันไว้เป็นไฟล์ป้องกันก่อนเสมอ และบันทึกลง Log เป็นสีแดง</span></div></section></>}{tab === "network" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>สถานะการเชื่อมต่อ</h2><p>ตรวจสอบว่าเครื่องนี้คุยกับเซิร์ฟเวอร์ของระบบได้ปกติ — เปิดหน้านี้ระบบวัดให้ทันที และวัดใหม่ได้ทุกเมื่อ</p></div><Wifi size={20} className="muted-icon" /></div><div className="net-stat-grid"><div className="net-stat"><small>ที่อยู่ที่เปิดอยู่ตอนนี้</small><b>{typeof window !== "undefined" ? window.location.origin : "—"}</b><span>เครื่องนี้เรียกใช้ระบบจาก URL นี้</span></div><div className="net-stat"><small>สัญญาณเครือข่ายของเครื่องนี้</small><b className={browserOnline ? "green-text" : "red-text"}>{browserOnline ? "ออนไลน์" : "ออฟไลน์"}</b><span>{browserOnline ? "เชื่อมต่อเครือข่ายอยู่ — ใช้งานได้ปกติ" : "เครื่องนี้ไม่มีสัญญาณเครือข่าย — เช็ค Wi-Fi หรือสายแลน"}</span></div><div className="net-stat"><small>ความหน่วงถึงเซิร์ฟเวอร์ (ping)</small><b>{latencyError ? "เชื่อมต่อไม่ได้" : latencyMs == null ? "กำลังวัด…" : `${latencyMs} มิลลิวินาที`}</b><span>{latencyAt ? `วัดล่าสุด ${latencyAt}` : "วัดอัตโนมัติตอนเปิดแท็บนี้"} · <button type="button" className="link-inline" onClick={measureLatency}><RefreshCw size={12} /> วัดใหม่</button></span></div></div>{lanInfoQuery.data && <div className="net-server-row"><Globe size={15} /><div><b>เซิร์ฟเวอร์: {lanInfoQuery.data.hostname}</b><small>{lanInfoQuery.data.platform} · เปิดให้บริการต่อเนื่องมาแล้ว {uptimeLabel(lanInfoQuery.data.uptimeSeconds)} · หน่วยความจำ {lanInfoQuery.data.totalMemoryMb.toLocaleString("th-TH")} MB</small></div></div>}</section><section className="panel settings-card"><div className="settings-heading"><div><h2>ใช้งานหลายจุดขายในร้าน (LAN)</h2><p>เครื่องอื่นในเครือข่ายเดียวกันเปิดระบบด้วย URL ด้านล่างนี้ได้เลย — ข้อมูลชุดเดียวกันทั้งร้าน ทุกเครื่องเห็นยอดแบบสด</p></div><Network size={20} className="muted-icon" /></div>{lanInfoQuery.isLoading ? <div className="table-loading"><Network size={22} /><b>กำลังอ่านไอพีของเครื่องเซิร์ฟเวอร์</b><span>ใช้เวลาไม่กี่วินาที</span></div> : (lanInfoQuery.data?.addresses.length ?? 0) === 0 ? <div className="settings-inline-note"><Wifi size={16} /><span>ไม่พบไอพี LAN บนเครื่องเซิร์ฟเวอร์ — เชื่อม Wi-Fi หรือสายแลนให้เครื่องเซิร์ฟเวอร์ก่อน แล้วกลับมาเปิดหน้านี้ใหม่ (หรือใช้ที่อยู่ในช่อง “ที่อยู่ที่เปิดอยู่ตอนนี้” ด้านบน)</span></div> : <div className="lan-url-list">{lanInfoQuery.data?.addresses.map((ip) => { const lanScheme = lanInfoQuery.data?.https ? "https" : "http"; const url = `${lanScheme}://${ip}:${lanInfoQuery.data?.port ?? 3000}`; return <div className="lan-url-row" key={ip}><span className="lan-url-ip">{ip}</span><code>{url}</code><button type="button" className="outline-button compact" onClick={() => copyLanUrl(url)}><Copy size={14} /> คัดลอก</button></div>; })}</div>}<div className="printer-flow-steps lan-steps"><div className="printer-step"><b>1</b><div><b>เชื่อมเครือข่ายเดียวกัน</b><small>เครื่องที่จะใช้ (จุดขายเพิ่ม / หลังบ้าน) ต้องอยู่ Wi-Fi หรือสายแลนเดียวกับเครื่องที่ติดตั้งระบบไว้</small></div></div><div className="printer-step"><b>2</b><div><b>เปิด URL ด้านบนด้วย Chrome หรือ Edge</b><small>พิมพ์ URL ในช่องที่อยู่ → เข้าสู่ระบบด้วยบัญชีของแต่ละคน · คลิกขวาที่แท็บ → “ปักหมุด” (Pin to taskbar) ให้เปิดได้เร็วทุกวัน</small></div></div><div className="printer-step"><b>3</b><div><b>เครื่องพิมพ์ของเครื่องไหน พิมพ์ที่เครื่องนั้น</b><small>ใบเสร็จถูกส่งไปเครื่องพิมพ์เริ่มต้นของ “เครื่องที่กดชำระเงิน” — ตั้งเครื่องพิมพ์สลิปของแต่ละจุดขายเป็นค่าเริ่มต้น (วิธีตั้งอยู่ที่แท็บใบเสร็จและเครื่องพิมพ์)</small></div></div></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>กล้องสแกนบาร์โค้ดบนมือถือ / แท็บเล็ต</h2><p>เบราว์เซอร์ (Chrome / Edge / Safari) อนุญาตให้เปิดกล้องเฉพาะหน้าเว็บที่เป็น HTTPS หรือ localhost เท่านั้น — อุปกรณ์ที่เข้าผ่าน http://IP จึงกดปุ่มกล้องไม่ได้ ไม่ใช่ความผิดของระบบ</p></div><Camera size={20} className="muted-icon" /></div>{lanInfoQuery.data?.https ? <><div className="dual-mode-note"><ShieldCheck size={15} /><span><b>เซิร์ฟเวอร์เปิด HTTPS แล้ว</b> — อุปกรณ์ที่เข้าด้วย URL https:// ด้านบนจะใช้กล้องสแกนบาร์โค้ดได้ทุกเครื่อง (ปุ่มกล้องหน้าขาย · สมาชิก · สต็อก)</span></div><div className="printer-flow-steps lan-steps"><div className="printer-step"><b>1</b><div><b>เปิดด้วย URL ที่ขึ้นต้น https:// เท่านั้น</b><small>พิมพ์ URL ด้านบนในช่องที่อยู่ของอุปกรณ์ — ห้ามเปลี่ยนเป็น http:// (กล้องจะเปิดไม่ได้ทันที)</small></div></div><div className="printer-step"><b>2</b><div><b>ครั้งแรกจะมีหน้าเตือน “ไม่ปลอดภัย”</b><small>เป็นเพราะใบรับรองที่ระบบสร้างเองภายในร้าน — กด ขั้นสูง (Advanced) → ดำเนินการต่อไปยังเว็บไซต์ ครั้งเดียว เบราว์เซอร์จำไว้ทั้งเครื่อง</small></div></div><div className="printer-step"><b>3</b><div><b>กดอนุญาตกล้องเมื่อเบราว์เซอร์ถาม</b><small>ไอคอน 🔒 ในแถบที่อยู่ → อนุญาตกล้อง → จากนั้นปุ่มกล้องใช้ได้ปกติทุกหน้า</small></div></div></div></> : <><div className="settings-inline-note amber"><CircleAlert size={16} /><span>ตอนนี้เซิร์ฟเวอร์เปิดแบบ <b>http</b> — อุปกรณ์ที่เข้าผ่าน IP (ไม่ใช่ localhost) จะ<b>เปิดกล้องไม่ได้</b> · แก้ได้ 2 วิธี:</span></div><div className="printer-flow-steps lan-steps"><div className="printer-step"><b>ก</b><div><b>เปิด HTTPS ที่เซิร์ฟเวอร์ (แนะนำ — ตั้งครั้งเดียวจบทั้งร้าน)</b><small>ที่เครื่องเซิร์ฟเวอร์: เปิดไฟล์ .env (สร้างใหม่ถ้ายังไม่มี) เพิ่มบรรทัด <code>HTTPS=1</code> → บันทึก → รีสตาร์ทเซิร์ฟเวอร์ (Ctrl+C แล้ว <code>pnpm dev</code> อีกครั้ง) — ระบบสร้างใบรับรองให้เอง จากนั้นให้อุปกรณ์ทุกเครื่องเข้าด้วย URL https:// ด้านบน (ผ่านหน้าเตือนครั้งแรกครั้งเดียว)</small></div></div><div className="printer-step"><b>ข</b><div><b>ทางเลือก — ยังใช้ http แต่เปิด flag ของ Chrome (ทำทีละเครื่อง)</b><small>บนอุปกรณ์ที่ต้องใช้กล้อง: เปิด <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> → ใส่ URL http://IP:พอร์ต ของร้าน → เลือก Enabled → กด Relaunch — วิธีนี้ต้องทำซ้ำทุกเครื่อง และบางเบราว์เซอร์ไม่มี flag นี้</small></div></div></div></>}</section><section className="panel settings-card"><div className="settings-heading"><div><h2>LAN วันนี้ + คลาวด์ในอนาคต — ทำพร้อมกันได้</h2><p>สรุปแนวทางสำหรับร้าน: เริ่มใช้ใน LAN ก่อน แล้วต่อยอดขึ้นคลาวด์ทีละขั้น โดยไม่ต้องเริ่มใหม่</p></div><Cloud size={20} className="muted-icon" /></div><div className="dual-mode-note"><Check size={15} /><span>ระบบเก็บข้อมูลทั้งหมดไว้ที่เครื่องเซิร์ฟเวอร์ในร้าน (SQLite) — แม้อินเทอร์เน็ตหลุด การขายหน้าร้านก็ไม่สะดุด นี่คือหัวใจของโหมด “Offline-First” ที่จะต่อยอดขึ้นคลาวด์ได้</span></div><div className="printer-flow-steps"><div className="printer-step"><b>1</b><div><b>วันนี้ — ใช้ผ่าน LAN ในร้าน</b><small>ข้อมูลอยู่ในเครื่องร้าน 100% · สำรองข้อมูลอัตโนมัติทุกวันตามที่ตั้งไว้ (แท็บสำรองข้อมูล) · เร็ว ปลอดภัย ไม่ต้องพึ่งอินเทอร์เน็ต</small></div></div><div className="printer-step"><b>2</b><div><b>ขั้นถัดไป — ต่อคลาวด์เป็นตัวสำรองที่สอง</b><small>เปิดโหมดคลาวด์ควบคู่: หน้าร้านทำงานเหมือนเดิมทุกอย่าง แต่ระบบผลักสำเนาข้อมูลขึ้นคลาวด์ทันทีที่เน็ตกลับมา — สำรอง 2 ที่ ดูย้อนหลังได้จากที่ไหนก็ได้</small></div></div><div className="printer-step"><b>3</b><div><b>อนาคต — ผู้บริหารดูยอดจากนอกร้าน / หลายสาขา</b><small>เพิ่มระบบซิงก์: ขายที่ร้านเหมือนเดิม ยอดวิ่งขึ้นคลาวด์แบบใกล้ทันที · ผู้บริหารเปิดดูรายงานจากมือถือหรือบ้านได้ โดยหน้าร้านไม่ต้องเปลี่ยนวิธีทำงานแม้แต่ปุ่มเดียว</small></div></div></div><div className="initial-balance-note"><ShieldCheck size={15} /><span>แนวทางนี้ไม่ต้องเปลี่ยนเครื่องหรือทิ้งข้อมูลเดิม — เริ่มจาก LAN วันนี้ แล้วต่อยอดขึ้นคลาวด์ทีละขั้น ใช้ข้อมูลชุดเดียวกันตลอด</span></div></section></>}{tab === "display" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>ขนาดตัวอักษร</h2><p>ปรับขนาดตัวอักษรทั้งระบบให้อ่านง่ายขึ้น · มีผลทันที</p></div><Monitor size={20} className="muted-icon" /></div><div className="number-mode-grid">{FONT_SCALES.map((scale) => <button className={fontScale === scale.id ? "selected" : ""} key={scale.id} onClick={() => chooseFontScale(scale.id)}><span className="number-radio">{fontScale === scale.id && <i />}</span><span><b>{scale.label} · {Math.round(scale.zoom * 100)}%</b><small>{scale.detail}</small></span></button>)}</div><div className="font-scale-sample"><span>ตัวอย่างข้อความ</span><b>ร้านค้าสวัสดิการ · ยอดรวม ฿1,234.56</b><small>สมาชิก M-000001 · บิล RC-260918-010 · 18 ก.ย. 2569</small></div><div className="settings-inline-note"><Monitor size={16} /><span>ค่านี้เก็บไว้ในเครื่องที่ใช้อยู่ ไม่กระทบเครื่องอื่น · ไม่ต้องกดบันทึก · ไม่มีผลกับใบเสร็จและบัตรสมาชิก ซึ่งใช้ขนาดมาตรฐานของกระดาษเสมอ</span></div></section><section className="panel settings-card windows-card"><div className="settings-heading"><div><h2>ติดตั้งแอปบนเครื่องนี้ (Windows)</h2><p>ทำให้ระบบเปิดเหมือนโปรแกรมทั่วไป — ไอคอนบนเดสก์ท็อป เปิดเต็มจอ ไม่มีแถบที่อยู่</p></div><Monitor size={20} className="muted-icon" /></div><div className="printer-flow-steps"><div className="printer-step"><b>1</b><div><b>ติดตั้งแอปจากเบราว์เซอร์ (ใช้ได้วันนี้)</b><small>เปิดระบบด้วย Chrome หรือ Edge → เมนู ⋮ มุมขวาบน → “ติดตั้งแอป” (Edge: “สร้างทางลัด”) → ไอคอนขึ้นบนเดสก์ท็อปและ Start ทันที · ทำทีละเครื่องของจุดขาย</small></div></div><div className="printer-step"><b>2</b><div><b>เสียบเครื่องพิมพ์สลิปแล้วทดสอบ</b><small>ติดตั้งไดรเวอร์ที่มาพร้อมเครื่อง → ตั้งเป็นเครื่องพิมพ์เริ่มต้น → เลือกขนาดกระดาษให้ตรงกระดาษจริง แล้วกด “พิมพ์ทดสอบ” — ดูวิธีละเอียดที่แท็บใบเสร็จและเครื่องพิมพ์</small></div></div><div className="printer-step"><b>3</b><div><b>แผนต่อยอดเป็นโปรแกรม .exe (Tauri)</b><small>จะแพ็กเป็นไฟล์ติดตั้ง Windows ไฟล์เดียว (~10-20MB ใช้ WebView2 ที่มีใน Win 11 แล้ว) — ติดตั้งง่าย พิมพ์สลิปแบบเงียบ (ESC/POS) ไม่ต้องผ่านหน้าต่างพิมพ์ของเบราว์เซอร์</small></div></div></div><div className="initial-balance-note"><ShieldCheck size={15} /><span>ทุกขั้นใช้ข้อมูลชุดเดิม — ไม่ต้องย้ายข้อมูลหรือตั้งค่าใหม่</span></div></section></>}{tab === "alert" && <div className="settings-single"><section className="panel settings-card"><div className="settings-heading"><div><h2>การแจ้งเตือน</h2><p>ช่วยให้เจ้าหน้าที่ติดตามรายการสำคัญได้ทันเวลา</p></div><Bell size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>แจ้งเตือนเมื่อสมาชิกมียอดคงเหลือต่ำ</b><small>แสดงในกระดิ่งแจ้งเตือนเมื่อยอดต่ำกว่า {money(form?.lowBalanceThreshold ?? 100)}</small></div><div className="toggle-row-controls"><label className="threshold-input" title="เกณฑ์ยอดคงเหลือต่ำ (บาท)"><span>฿</span><input type="number" min={0} step={1} inputMode="numeric" aria-label="เกณฑ์ยอดคงเหลือต่ำ (บาท)" placeholder="100" value={thresholdText} onChange={(event) => { const digits = event.target.value.replace(/[^0-9]/g, ""); setThresholdText(digits); updateForm({ lowBalanceThreshold: digits === "" ? 0 : Number(digits) }); }} disabled={!form} /></label><button className={`toggle ${form?.lowBalanceAlert ? "on" : ""}`} onClick={() => updateForm({ lowBalanceAlert: !form?.lowBalanceAlert })} disabled={!form} aria-label="แจ้งเตือนยอดคงเหลือต่ำ"><span /></button></div></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดสต็อก</b><small>แจ้งเตือนเมื่อจำนวนต่ำกว่าจุดสั่งซื้อ</small></div><button className={`toggle ${form?.lowStockAlert ? "on" : ""}`} onClick={() => updateForm({ lowStockAlert: !form?.lowStockAlert })} disabled={!form} aria-label="แจ้งเตือนสต็อกต่ำ"><span /></button></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดอายุ</b><small>แจ้งเตือนล่วงหน้า {form?.expiryAlertDays ?? 30} วัน</small></div><button className={`toggle ${form?.expiryAlert ? "on" : ""}`} onClick={() => updateForm({ expiryAlert: !form?.expiryAlert })} disabled={!form} aria-label="แจ้งเตือนใกล้หมดอายุ"><span /></button></div></section></div>}{tab === "roles" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>สิทธิ์และบทบาทผู้ใช้ระบบ</h2><p>สิทธิ์ตามที่ระบบบังคับใช้จริงในปัจจุบัน</p></div><ShieldCheck size={20} className="muted-icon" /></div><div className="role-matrix">{ROLE_MATRIX.map((entry) => <div className={`role-matrix-card ${entry.role}`} key={entry.role}><div className="role-matrix-head"><span className="role-avatar small"><Crown size={17} /></span><div><b>{entry.title}</b><small>{entry.caption}</small></div></div><ul>{entry.permits.map((permit) => <li key={permit}><Check size={14} /> {permit}</li>)}</ul></div>)}</div></section><section className="panel settings-card dev-warning-card"><div className="settings-heading"><div><h2>การเข้าใช้งานสำหรับผู้พัฒนา (Dev Access)</h2><p>ประตูพิเศษสำหรับบัญชีผู้พัฒนา (dev) เท่านั้น — ปิดไว้เป็นค่าเริ่มต้น</p></div><Terminal size={20} className="muted-icon" /></div><div className="dev-access-warning"><ShieldCheck size={16} /><span>บัญชีผู้พัฒนา (dev) สามารถเข้าถึง<b>ข้อมูลของร้านได้ทั้งหมด</b> เท่าผู้บริหารทุกอย่าง · ระบบปิดการเข้าใช้งานไว้โดยอัตโนมัติ และ<b>บันทึกทุกการเข้าสู่ระบบลงระบบ Log เป็นสีแดง</b>เสมอ</span></div><div className="toggle-row"><div><b>อนุญาตให้บัญชีผู้พัฒนาเข้าสู่ระบบ</b><small>เปิดเฉพาะช่วงที่ผู้พัฒนามาตรวจสอบ/ซ่อมแซมระบบ แล้วปิดกลับทันทีเมื่อเสร็จ</small></div><button className={`toggle ${form?.devAccess ? "on" : ""}`} onClick={toggleDevAccess} disabled={!form} aria-label="อนุญาตให้บัญชีผู้พัฒนาเข้าสู่ระบบ"><span /></button></div><div className={`dev-status-line${form?.devAccess ? " on" : ""}`}><i aria-hidden="true" />{form?.devAccess ? "เปิดอยู่ — บัญชีผู้พัฒนาเข้าสู่ระบบได้" : "ปิดอยู่ (แนะนำ) — บัญชีผู้พัฒนาไม่สามารถเข้าสู่ระบบได้"}</div><div className="dev-account-count">บัญชีผู้พัฒนาในระบบ <b>{devAccounts.length} บัญชี</b>{devAccounts.length > 0 && <span className="cell-sub"> · {devAccounts.map((user) => `@${user.username}`).join(", ")}</span>} · สร้าง/จัดการบัญชีผู้พัฒนาได้ที่หน้า <button type="button" className="link-button" onClick={() => setView("users")}>ผู้ใช้ระบบ</button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ข้อควรทราบ</h2><p>ความปลอดภัยของระบบ</p></div><LockKeyhole size={20} className="muted-icon" /></div><div className="settings-inline-note"><LockKeyhole size={16} /><span>บัญชีผู้ใช้ระบบถูกระงับชั่วคราวเมื่อกรอกรหัสผ่านผิด 5 ครั้ง และปลดล็อกอัตโนมัติใน 15 นาที · ผู้บริหารสามารถปลดล็อกก่อนกำหนดได้ที่หน้าผู้ใช้ระบบ</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("users")}><ArrowRight size={16} /> ไปที่หน้าผู้ใช้ระบบ</button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ระบบบันทึก Log</h2><p>ทุกกิจกรรมสำคัญถูกบันทึกอัตโนมัติ พร้อมผู้ทำรายการและเวลา</p></div><Activity size={20} className="muted-icon" /></div><div className="log-settings-grid"><div className="log-settings-stat"><span>รายการล่าสุดในระบบ</span><strong>{logsStatsQuery.isLoading ? "…" : logs.length.toLocaleString("th-TH")}</strong><small>แสดงไม่เกิน 200 รายการล่าสุด</small></div><div className="log-settings-stat"><span>กิจกรรมล่าสุด</span><strong>{lastLog ? formatLogDateTime(lastLog.createdAt) : "—"}</strong><small>{lastLog ? `${lastLog.actor} · ${lastLog.action}` : "ยังไม่มีข้อมูล"}</small></div></div><div className="settings-inline-note"><Activity size={16} /><span>ตัวอย่างกิจกรรมที่บันทึก: ขายสินค้า · เติมเงิน · ถอนเงิน · รับสินค้าเข้า · นับสต็อก · แก้ไขสินค้า · ลงทะเบียนสมาชิก · จัดการผู้ใช้ระบบ · การตั้งค่า</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("logs")}><ArrowRight size={16} /> ไปที่ระบบ Log</button></div></section></>}{dirtyCount > 0 && form && <div className="settings-save-bar" role="status" aria-live="polite"><span className="save-dot" aria-hidden="true" /><div className="save-bar-text"><b>มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</b><small>แก้ไขแล้ว: {dirtyKeys.slice(0, 3).join(" · ")}{dirtyCount > 3 ? ` และอีก ${dirtyCount - 3} รายการ` : ""}</small></div><div className="save-bar-actions"><button type="button" className="outline-button" disabled={saveMutation.isPending} onClick={discardChanges}>ย้อนการแก้ไข</button><button type="button" className="primary-button" disabled={saveMutation.isPending} onClick={saveSettings}><Check size={16} /> {saveMutation.isPending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}</button></div></div>}{saved && <div className="notice-bar"><Check size={16} /> บันทึกการตั้งค่าเรียบร้อยแล้ว<button onClick={() => setSaved(false)}><X size={14} /></button></div>}{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<ConfirmDialog open={devAccessConfirm} title="ยืนยันการเปิด Dev Access?" description="การเปิดสวิตช์นี้อนุญาตให้บัญชีผู้พัฒนา (dev) เข้าสู่ระบบและเข้าถึงข้อมูลของร้านได้ทั้งหมดเท่าผู้บริหาร · ทุกการเข้าสู่ระบบจะถูกบันทึกลงระบบ Log เป็นสีแดง · แนะนำให้เปิดเฉพาะช่วงที่จำเป็น แล้วปิดกลับเมื่อเสร็จ (ต้องกดบันทึกการตั้งค่าจึงมีผล)" confirmLabel="ยืนยันเปิด Dev Access" onCancel={() => setDevAccessConfirm(false)} onConfirm={() => { setDevAccessConfirm(false); updateForm({ devAccess: true }); }} /><ConfirmDialog open={importConfirm} title="ยืนยันการนำเข้าข้อมูล?" description={`จะนำเข้า ${currentSheet ? currentSheet.totalRows.toLocaleString("th-TH") : ""} แถว จากไฟล์ ${importFile?.name ?? ""} (${importKind === "members" ? "สมาชิก" : "สินค้า"} · ${duplicateMode === "skip" ? "ข้ามรายการซ้ำ" : "อัปเดตข้อมูลที่ซ้ำ"}) · ระบบจะสำรองข้อมูลทั้งระบบเป็นไฟล์ป้องกันก่อนนำเข้าเสมอ และบันทึกการนำเข้าลง Log`} confirmLabel="ยืนยันนำเข้าข้อมูล" onCancel={() => setImportConfirm(false)} onConfirm={runImport} /><ConfirmDialog open={restoreTarget !== null} title="ยืนยันการกู้คืนข้อมูลจากไฟล์สำรอง?" description={`ข้อมูลทั้งระบบจะกลับไปเป็นช่วงเวลาของไฟล์สำรองนี้ (${restoreTarget ?? ""}) — ทุกอย่างที่ทำหลังจากนั้นจะถูกแทนที่ · ระบบจะสำรองข้อมูลปัจจุบันไว้เป็นไฟล์ป้องกันก่อนเสมอ และบันทึกการกู้คืนลง Log เป็นสีแดง · หากไฟล์สำรองเก่ากว่าเซสชันที่ใช้อยู่ อาจต้องเข้าสู่ระบบใหม่หลังกู้คืน`} confirmLabel="ยืนยันกู้คืนข้อมูล" onCancel={() => setRestoreTarget(null)} onConfirm={() => { if (restoreTarget) restoreBackupMutation.mutate({ file: restoreTarget }); }} /></div></div></>;
}

function Logs() {
  const logsQuery = trpc.logs.list.useQuery({ limit: 200 });
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  // Render cap (round 15): 30 rows up front, +30 per show-more click.
  const [visible, setVisible] = useState(30);
  // Real date-range filter (round 15) — replaces the dead "ช่วงเวลา" button.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const logs = logsQuery.data ?? [];
  const filtered = logs.filter((log) => {
    const term = query.trim().toLowerCase();
    const matchesTerm = !term || `${log.action} ${log.actor} ${log.detail} ${log.actorRole ?? ""}`.toLowerCase().includes(term);
    const logDate = log.createdAt.slice(0, 10);
    const matchesFrom = !dateFrom || logDate >= dateFrom;
    const matchesTo = !dateTo || logDate <= dateTo;
    return matchesTerm && matchesFrom && matchesTo;
  });
  // Changing any filter returns to the first page of results.
  useEffect(() => { setVisible(30); }, [query, dateFrom, dateTo]);
  const todayCount = logs.filter((log) => isSameDay(parseStoreDate(log.createdAt), new Date())).length;
  const actorCount = new Set(logs.map((log) => log.actor)).size;
  const downloadLogsCsv = () => {
    downloadCsvFile("activity-logs", [["วันและเวลา", "ผู้ทำรายการ", "กิจกรรม", "รายละเอียด", "ระดับสิทธิ์"], ...filtered.map((log) => [formatLogDateTime(log.createdAt), log.actor, log.action, log.detail, log.actorRole ?? ""])]);
    setNotice(`ดาวน์โหลดรายการ Log แล้ว · ${filtered.length} รายการ`);
  };
  return <><SectionHeader eyebrow="ตรวจสอบย้อนหลังและความโปร่งใส" title="ระบบ Log" description="บันทึกทุกกิจกรรมสำคัญของผู้ใช้งานและธุรกรรมในระบบ" action={<button className="outline-button" onClick={downloadLogsCsv}><Download size={16} /> ส่งออก Log</button>} /><div className="log-summary"><div><Activity size={18} /><span>รายการวันนี้<strong>{todayCount}</strong></span></div><div><ShieldCheck size={18} /><span>ผู้ใช้งานในระบบ<strong>{actorCount}</strong></span></div><div><ReceiptText size={18} /><span>ธุรกรรมที่บันทึก<strong>100%</strong></span></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>กิจกรรมทั้งหมด</h2><p>ข้อมูลสำหรับตรวจสอบย้อนหลังของเจ้าหน้าที่และผู้บริหาร</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหากิจกรรม หรือผู้ใช้งาน" /></div><div className="date-range-filter"><div className="search-field" title="ตั้งแต่วันที่"><CalendarDays size={15} /><input type="date" value={dateFrom} max={dateTo || undefined} aria-label="กรองตั้งแต่วันที่" onChange={(event) => setDateFrom(event.target.value)} /></div><span className="date-range-sep">→</span><div className="search-field" title="ถึงวันที่"><CalendarDays size={15} /><input type="date" value={dateTo} min={dateFrom || undefined} aria-label="กรองถึงวันที่" onChange={(event) => setDateTo(event.target.value)} /></div>{(dateFrom || dateTo) && <button type="button" className="date-range-clear" aria-label="ล้างตัวกรองช่วงเวลา" title="ล้างตัวกรองช่วงเวลา" onClick={() => { setDateFrom(""); setDateTo(""); }}><X size={15} /></button>}</div></div></div><div className="table-filter-summary"><span><Search size={13} /> {query || dateFrom || dateTo ? <>กรองตามเงื่อนไข{(dateFrom || dateTo) ? ` · ${dateFrom || "เริ่มต้น"} ถึง ${dateTo || "ปัจจุบัน"}` : ""}</> : "กิจกรรมทั้งหมด"}</span><span>แสดง <b>{Math.min(visible, filtered.length)}</b> จาก <b>{filtered.length}</b> รายการ</span></div><div className="table-wrap">{logsQuery.isLoading ? <div className="table-loading"><Activity size={22} /><b>กำลังโหลดรายการ Log</b><span>ดึง 200 รายการล่าสุดจากระบบ</span></div> : logsQuery.isError ? <div className="entity-state error" role="alert"><ShieldCheck size={22} /><b>โหลดรายการ Log ไม่สำเร็จ</b><span>{getErrorMessage(logsQuery.error)}</span></div> : filtered.length === 0 ? <div className="entity-state"><Activity size={22} /><b>ไม่พบกิจกรรมตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือช่วงวันที่</span></div> : <table className="log-table" aria-label="รายการกิจกรรม"><thead><tr><th aria-label="ระดับกิจกรรม" /><th>วันที่ · เวลา</th><th>ผู้ทำรายการ</th><th>กิจกรรม</th><th>รายละเอียด</th></tr></thead><tbody>{filtered.slice(0, visible).map((log) => <tr key={log.id}><td className="log-tone-cell"><i className={`log-dot-mini tone-${log.tone ?? "green"}`} aria-hidden="true" /></td><td><small className="cell-mono">{formatLogDateTime(log.createdAt)}</small></td><td><b>{log.actor}</b>{log.actorRole && <small>{log.actorRole}</small>}</td><td><b>{log.action}</b></td><td><span className="log-detail-text" title={log.detail}>{log.detail}</span></td></tr>)}</tbody></table>}</div>{visible < filtered.length ? <button type="button" className="table-show-more" onClick={() => setVisible((current) => current + 30)}><ChevronDown size={15} /> แสดงรายการเพิ่มอีก <b>{filtered.length - visible}</b> รายการ</button> : filtered.length > 30 && <div className="table-show-more done">แสดงทั้งหมด {filtered.length} รายการแล้ว</div>}{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section></>;
}

function AppShell({ user, brand, onLogout }: { user: User; brand?: BrandSettings | null | undefined; onLogout: () => void }) {
  const [activeView, setActiveView] = useState<View>("dashboard");
  // ROUND 61 — ป้ายเวอร์ชัน sidebar กดแล้วพาไปแท็บ “เวอร์ชันและลิขสิทธิ์” โดยตรง
  const [settingsFocusTab, setSettingsFocusTab] = useState<SettingsTab | null>(null);
  const edition = useEditionStatus();
  const openEditionTab = () => {
    setSettingsFocusTab("edition");
    setActiveView("settings");
    setMobileNav(false);
  };
  const [mobileNav, setMobileNav] = useState(false);
  const [posShortcut, setPosShortcut] = useState("");
  // POS rail badge: parked-bill count, seeded from this device's storage and
  // kept in sync by the "pos-held" events Pos dispatches whenever they change.
  const [posHeldCount, setPosHeldCount] = useState(() => loadHeldBills().length);
  useEffect(() => {
    const onHeld = (event: Event) => setPosHeldCount((event as CustomEvent<number>).detail ?? 0);
    window.addEventListener("pos-held", onHeld);
    return () => window.removeEventListener("pos-held", onHeld);
  }, []);
  // ROUND 73 — ปุ่มลัด F9 ที่ POS: สั่งเปิดเมนูหลัก (ภาพรวมระบบ) จากแป้นพิมพ์เหมือนกดปุ่ม
  // "เมนู" ท้ายรางซ้าย — Pos dispatch มาที่นี่เพราะ activeView อยู่ที่ Home (เกิด pos-rail เดิม)
  useEffect(() => {
    const onPosOpenMenu = () => setActiveView("dashboard");
    window.addEventListener("pos-open-menu", onPosOpenMenu);
    return () => window.removeEventListener("pos-open-menu", onPosOpenMenu);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pendingMemberNumber, setPendingMemberNumber] = useState<string | null>(null);
  const [pendingBillNumber, setPendingBillNumber] = useState<string | null>(null);
  // Round 32-16 — ลงทะเบียนสมาชิกใหม่อยู่ที่ POS จุดเดียว (F6): ปุ่มบนรางซ้าย
  // ของ POS เปิดโมดัลที่หน้าขายสินค้าเอง ไม่ต้องออกจากหน้าร้านอีกต่อไป
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const logoutMutation = trpc.auth.logout.useMutation({ onSuccess: () => onLogout() });
  // Stock rows feed both the bell dropdown and the sidebar nav badge.
  // Server statuses (listStockRows): "สต็อกต่ำ" = product stock ≤ reorder
  // point, "ใกล้หมดอายุ" = lot expiry within 30 days ("ปิดการขาย" excluded).
  const stockRowsQuery = trpc.stock.rows.useQuery(undefined, { refetchInterval: 60_000 });
  const lowStock = useMemo(() => {
    const rows = (stockRowsQuery.data ?? []).filter((row) => row.active && row.status === "สต็อกต่ำ");
    // One alert per product (a product with several lots shares the same stock).
    return rows.filter((row, index) => rows.findIndex((other) => other.productId === row.productId) === index);
  }, [stockRowsQuery.data]);
  const expiring = useMemo(() => (stockRowsQuery.data ?? []).filter((row) => row.active && row.status === "ใกล้หมดอายุ"), [stockRowsQuery.data]);
  // Member low-balance alerts — driven by the real settings (ตั้งค่า → การแจ้งเตือน:
  // lowBalanceAlert + lowBalanceThreshold) and the member list. Mirrors the stock
  // poll cadence so the bell stays fresh after wallet top-ups/withdrawals too.
  // Same no-input query as the Members view, so both share one cache entry.
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const memberRowsQuery = trpc.member.list.useQuery(undefined, { refetchInterval: 60_000 });
  // ROUND 42 (ข้อ 4) — ขนาดกระดาษสลิปจาก settings มีผลทันทีทุกครั้งที่เข้าแอป
  // (ทุก view — พิมพ์ใบเสร็จ/สลิปได้โดยไม่ต้องเปิดหน้าตั้งค่าก่อน)
  useEffect(() => { applyPaperWidth(settingsQuery.data?.receiptPaperWidth); }, [settingsQuery.data?.receiptPaperWidth]);
  const lowBalanceAlertOn = settingsQuery.data?.lowBalanceAlert ?? true;
  const lowBalanceThreshold = settingsQuery.data?.lowBalanceThreshold ?? 100;
  const memberLowBalance = useMemo(() => {
    if (!lowBalanceAlertOn) return [];
    return (memberRowsQuery.data ?? [])
      .filter((member) => member.status === "active" && member.balance < lowBalanceThreshold)
      .sort((a, b) => a.balance - b.balance); // lowest (most negative) first
  }, [memberRowsQuery.data, lowBalanceAlertOn, lowBalanceThreshold]);
  const memberLowBalanceShown = memberLowBalance.slice(0, MEMBER_NOTIF_LIMIT);
  const memberNegative = memberLowBalanceShown.filter((member) => member.balance < 0);
  const memberLowPositive = memberLowBalanceShown.filter((member) => member.balance >= 0);
  const memberLowBalanceHidden = memberLowBalance.length - memberLowBalanceShown.length;
  // Header count pill + bell red dot include member alerts; the sidebar
  // nav-badge on สต็อกสินค้า intentionally stays stock-only.
  const notifCount = lowStock.length + expiring.length + memberLowBalance.length;
  // ROUND 37 (req 35) — แจ้งเตือนเชิงรุก: ตอนเปิดระบบสรุปครั้งเดียวว่ามีอะไร
  // ต้องดู และระหว่างใช้งานถ้ามีรายการ “ใหม่” (ขายจนต่ำกว่าจุดสั่งซื้อ /
  // สมาชิกยอดต่ำลง) toast เด้งทันทีโดยไม่ต้องเปิดกระดิ่ง
  const notifiedAlertsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const keys: string[] = [];
    lowStock.forEach((row) => keys.push(`low-${row.productId}`));
    expiring.forEach((row) => keys.push(`exp-${row.id}`));
    memberLowBalance.forEach((member) => keys.push(`bal-${member.memberNumber}`));
    if (keys.length === 0) return;
    const fresh = keys.filter((key) => !notifiedAlertsRef.current.has(key));
    if (fresh.length === 0) return;
    const isBoot = notifiedAlertsRef.current.size === 0;
    fresh.forEach((key) => notifiedAlertsRef.current.add(key));
    if (isBoot) {
      const parts: string[] = [];
      if (lowStock.length > 0) parts.push(`สต็อกต่ำ ${lowStock.length} รายการ`);
      if (expiring.length > 0) parts.push(`ใกล้หมดอายุ ${expiring.length} รายการ`);
      if (memberLowBalance.length > 0) parts.push(`สมาชิกยอดคงเหลือต่ำ ${memberLowBalance.length} รายการ`);
      toast.info("การแจ้งเตือนของระบบ", { description: `${parts.join(" · ")} — ดูรายละเอียดได้ที่กระดิ่งมุมขวาบน`, duration: 5200 });
      return;
    }
    let shown = 0;
    fresh.forEach((key) => {
      if (shown >= 3) return;
      shown += 1;
      if (key.startsWith("low-")) {
        const row = lowStock.find((entry) => `low-${entry.productId}` === key);
        if (row) toast.warning("สต็อกต่ำกว่าจุดสั่งซื้อ", { description: `${row.name} เหลือ ${row.stock} ${row.unit} · ต่ำกว่าจุดสั่งซื้อ ${row.reorderPoint}`, duration: 5000 });
      } else if (key.startsWith("exp-")) {
        const row = expiring.find((entry) => `exp-${entry.id}` === key);
        if (row) toast.warning("สินค้าใกล้หมดอายุ", { description: `${row.name}${row.expiry ? ` · หมดอายุ ${formatThaiDate(row.expiry)}` : ""}`, duration: 5000 });
      } else {
        const member = memberLowBalance.find((entry) => `bal-${entry.memberNumber}` === key);
        if (member) toast.warning("สมาชิกยอดคงเหลือต่ำ", { description: `${memberFullName(member)} · ${member.memberNumber} · คงเหลือ ${money(member.balance)}`, duration: 5000 });
      }
    });
    if (fresh.length > shown) toast.info(`+ การแจ้งเตือนใหม่อีก ${fresh.length - shown} รายการ`, { description: "ดูรายการทั้งหมดได้ที่กระดิ่งแจ้งเตือนมุมขวาบน" });
  }, [lowStock, expiring, memberLowBalance]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  // Close the bell dropdown on outside click and Escape.
  useEffect(() => {
    if (!notifOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && notifRef.current && !notifRef.current.contains(event.target)) setNotifOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotifOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [notifOpen]);
  // Role/profile now come from the login session (auth.me) — no client switcher.
  // ROUND 36 — dev มาผ่าน appRole บน ctx.user (drizzle role = admin + appRole = dev)
  const role: Role = user.appRole === "dev" ? "dev" : user.role === "admin" ? "admin" : "staff";
  const profileName = user.name ?? "ผู้ใช้ระบบ";
  const profileAvatar = profileName.slice(0, 1);
  // ROUND 25 — แบรนด์ที่ผู้บริหารตั้งเอง (ตั้งค่า → แบรนด์และธีม)
  const appName = (brand?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const appLogo = brand?.appLogo ?? "";
  // ROUND 68 (user) — เบอร์ศูนย์ช่วยเหลือจาก settings แสดงท้ายหน้าจอ (ว่าง = ซ่อนแถบนี้)
  const helpPhone = (settingsQuery.data?.helpPhone ?? "").trim();
  // ROUND 75 (user) — ตั้งค่าเมนูลัดหน้าร้าน: ปุ่มที่ปิดไว้ซ่อนจากรางซ้าย POS ทันที
  const railHidden = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(settingsQuery.data?.posRailHidden || "[]");
      return new Set<string>(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [settingsQuery.data?.posRailHidden]);
  const safeView = canAccessView(role, activeView) ? activeView : "dashboard";
  const pageTitle = navItems.find((item) => item.id === safeView)?.label ?? (safeView === "settings" ? "ตั้งค่า" : safeView === "logs" ? "ระบบ Log" : safeView === "users" ? "ผู้ใช้ระบบ" : "ภาพรวม");
  const logout = () => { if (!logoutMutation.isPending) logoutMutation.mutate(); };
  return <div className={safeView === "pos" ? "app-shell pos-terminal" : "app-shell"}>{safeView === "pos" && <aside className="pos-rail" aria-label="เมนูด่วนหน้าร้าน"><div className="rail-brand" title={appName}>{appLogo ? <img className="brand-logo" src={appLogo} alt={appName} /> : <span className="brand-mark">{brandInitial(appName)}</span>}<span className="rail-caption">POS</span></div>{!railHidden.has("scan") && <button type="button" className="rail-btn rail-scan" title="โฟกัสช่องสแกนบาร์โค้ด — พร้อมรับค่าเสมอ (F8)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "scan" }))}><ScanLine size={20} /><b>สแกน</b><kbd>F8</kbd></button>}{!railHidden.has("customer") && <button type="button" className="rail-btn rail-customer" title="เลือกลูกค้า / สมาชิกสำหรับบิลนี้ (F1)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "member" }))}><UsersRound size={20} /><b>ลูกค้า</b><kbd>F1</kbd></button>}{!railHidden.has("deposit") && <button type="button" className={`rail-btn rail-deposit${posShortcut === "เติมเงิน" ? " active" : ""}`} title="เติมเงินเข้าบัญชีสมาชิก (F2)" onClick={() => setPosShortcut(posShortcut === "เติมเงิน" ? "" : "เติมเงิน")}><ArrowDownToLine size={20} /><b>เติมเงิน</b><kbd>F2</kbd></button>}{!railHidden.has("withdraw") && <button type="button" className={`rail-btn rail-withdraw${posShortcut === "ถอนเงิน" ? " active" : ""}`} title="ถอนเงินจากบัญชีสมาชิก (F3)" onClick={() => setPosShortcut(posShortcut === "ถอนเงิน" ? "" : "ถอนเงิน")}><ArrowUpFromLine size={20} /><b>ถอนเงิน</b><kbd>F3</kbd></button>}{!railHidden.has("special") && <button type="button" className={`rail-btn rail-special${posShortcut === "สินค้าไม่ระบุตายตัว" ? " active" : ""}`} title="เพิ่มรายการพิเศษ — ของสั่ง ค่าบริการ (F4)" onClick={() => { if (edition.status?.has("specialOrders")) setPosShortcut(posShortcut === "สินค้าไม่ระบุตายตัว" ? "" : "สินค้าไม่ระบุตายตัว"); else openEditionTab(); }}><Sparkles size={20} /><b>รายการพิเศษ</b><kbd>F4</kbd></button>}{!railHidden.has("hold") && <button type="button" className="rail-btn rail-hold" title="พักบิลปัจจุบันไว้ แล้วเริ่มบิลใหม่ — เรียกคืนได้จากแถบใต้ช่องสแกน (F5)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "hold" }))}><Pause size={20} /><b>พักบิล</b><kbd>F5</kbd>{posHeldCount > 0 && <span className="rail-badge">{posHeldCount}</span>}</button>}{!railHidden.has("register") && <button type="button" className="rail-btn rail-register" title="ลงทะเบียนสมาชิกใหม่ + พิมพ์บัตร — ทำที่นี่ที่เดียว (F6)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "register" }))}><UserPlus size={20} /><b>สมาชิกใหม่</b><kbd>F6</kbd></button>}{!railHidden.has("manage") && <button type="button" className="rail-btn rail-manage" title="จัดแผงลัดหน้าร้าน — เลือกสินค้าที่หยิบบ่อยขึ้นแผง (F7)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "quickmanage" }))}><Star size={20} /><b>จัดแผง</b><kbd>F7</kbd></button>}{!railHidden.has("receive") && <button type="button" className="rail-btn rail-inventory" title="รับเข้าสินค้าจากหน้า POS โดยตรง (F9)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "receive" }))}><PackageSearch size={20} /><b>รับเข้าสินค้า</b><kbd>F9</kbd></button>}{!railHidden.has("add") && <button type="button" className="rail-btn rail-add" title="เพิ่มไอเทมใหม่จากหน้า POS โดยตรง (F10)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "add" }))}><Plus size={20} /><b>เพิ่มไอเทม</b><kbd>F10</kbd></button>}<span className="rail-spacer" aria-hidden="true" /><button type="button" className="rail-btn rail-exit" title="เปิดเมนูหลัก — ภาพรวมระบบ (Esc)" onClick={() => setActiveView("dashboard")}><LayoutDashboard size={20} /><b>เมนู</b><kbd>Esc</kbd></button></aside>}<aside className={`sidebar ${mobileNav ? "open" : ""}${safeView === "pos" ? " pos-context" : ""}`}><div className="brand">{appLogo ? <img className="brand-logo" src={appLogo} alt={appName} /> : <div className="brand-mark"><span>{brandInitial(appName)}</span></div>}<div><b>{appName}</b><small>Welfare Store</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={19} /></button></div><div className="role-card"><div className={`role-avatar ${role}`}>{profileAvatar}</div><div><b>{profileName}</b><span>{role === "admin" ? "ผู้บริหารระบบ" : role === "dev" ? "ผู้พัฒนาระบบ" : "เจ้าหน้าที่ร้านค้า"}{role === "dev" && <i className="dev-role-badge">DEV</i>}</span></div></div><div className="nav-group-label">เมนูหลัก</div><nav>{navItems.map(({ id, label, icon: Icon }) => <button className={safeView === id ? "active" : ""} key={id} onClick={() => { setActiveView(id); setMobileNav(false); }}><Icon size={20} /><b>{label}</b>{id === "stock" && lowStock.length > 0 && <i className="nav-badge">{lowStock.length}</i>}</button>)}</nav>{isAdminRole(role) ? <><div className="nav-group-label">สำหรับผู้บริหาร</div><nav className="secondary-nav"><button className={safeView === "settings" ? "active" : ""} onClick={() => { setActiveView("settings"); setMobileNav(false); }}><Settings2 size={20} /><b>ตั้งค่า</b></button><button className={safeView === "users" ? "active" : ""} onClick={() => { setActiveView("users"); setMobileNav(false); }}><UserCog size={20} /><b>ผู้ใช้ระบบ</b></button><button className={safeView === "logs" ? "active" : ""} onClick={() => { setActiveView("logs"); setMobileNav(false); }}><Activity size={20} /><b>ระบบ Log</b></button></nav></> : <div className="locked-nav"><LockKeyhole size={15} /><span>เมนูผู้บริหารถูกซ่อน</span></div>}<div className="sidebar-footer">{edition.status && <EditionPill status={edition.status} onClick={openEditionTab} />}<button type="button" className="sidebar-logout" onClick={logout} disabled={logoutMutation.isPending} title="ออกจากระบบ" aria-label="ออกจากระบบ"><LogOut size={16} /> ออกจากระบบ</button><div className="sidebar-version">v1.0.0 · ระบบร้านค้าสวัสดิการ</div><div className="sidebar-powered">⚡ Powered by <b>PNG TEAM</b></div></div></aside><main className="main-shell"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div className="breadcrumb"><span>{appName}</span><b>/</b><strong>{pageTitle}</strong></div><div className="topbar-actions"><div className="global-search" role="button" tabIndex={0} aria-label="เปิดค้นหาเมนู สมาชิก หรือสินค้า" onClick={() => setSearchOpen(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSearchOpen(true); } }}><Search size={17} /><span>ค้นหาเมนูหรือรายการ...</span><kbd>⌘ K</kbd></div><button type="button" className="top-icon" title="ออกจากระบบ" aria-label="ออกจากระบบ" onClick={logout} disabled={logoutMutation.isPending}><LogOut size={18} /></button><div className="notif-wrap" ref={notifRef}><button type="button" className={`top-icon notif-bell${notifCount > 0 ? " has-alert" : ""}`} title={notifCount > 0 ? `การแจ้งเตือน · ${notifCount} รายการรอดู` : "การแจ้งเตือน"} aria-label={notifCount > 0 ? `การแจ้งเตือน ${notifCount} รายการ` : "การแจ้งเตือน"} aria-haspopup="menu" aria-expanded={notifOpen} onClick={() => setNotifOpen((current) => !current)}><Bell size={18} />{notifCount > 0 && <span className="notif-badge" aria-hidden="true">{notifCount > 99 ? "99+" : notifCount}</span>}</button>{notifOpen && <div className="notif-dropdown" role="menu" aria-label="การแจ้งเตือน"><div className="notif-header"><b>การแจ้งเตือน</b>{notifCount > 0 && <span className="notif-count">{notifCount}</span>}</div>{notifCount === 0 ? <div className="notif-empty"><Bell size={22} /><b>ไม่มีการแจ้งเตือน</b><small>สต็อก · วันหมดอายุ · ยอดสมาชิกปกติดี</small></div> : <div className="notif-scroll">{lowStock.length > 0 && <div className="notif-section-label"><i className="notif-dot red" />สินค้าใกล้หมดสต็อก</div>}{lowStock.map((row) => <button type="button" className="notif-row" role="menuitem" key={`low-${row.id}`} onClick={() => { setNotifOpen(false); setActiveView("stock"); }}><div><b>{row.name}</b><small>เหลือ {row.stock} {row.unit} · ต่ำกว่าจุดสั่งซื้อ {row.reorderPoint}</small></div><i className="notif-dot red" /></button>)}{expiring.length > 0 && <div className="notif-section-label"><i className="notif-dot amber" />ใกล้หมดอายุ</div>}{expiring.map((row) => <button type="button" className="notif-row" role="menuitem" key={`exp-${row.id}`} onClick={() => { setNotifOpen(false); setActiveView("stock"); }}><div><b>{row.name}</b><small>{row.expiry ? `หมดอายุ ${formatThaiDate(row.expiry)}` : "ตรวจสอบวันหมดอายุ"}</small></div><i className="notif-dot amber" /></button>)}{memberNegative.length > 0 && <div className="notif-section-label"><i className="notif-dot red" />สมาชิกยอดคงเหลือติดลบ</div>}{memberNegative.map((member) => <button type="button" className="notif-row member-row" role="menuitem" key={`neg-${member.memberNumber}`} onClick={() => { setNotifOpen(false); setPendingMemberNumber(member.memberNumber); setActiveView("members"); }}><div><b>{memberFullName(member)}</b><small>ยอดติดลบ <b className="amount-negative">{money(member.balance)}</b></small></div><i className="notif-dot red" /></button>)}{memberLowPositive.length > 0 && <div className="notif-section-label"><i className="notif-dot amber" />สมาชิกยอดคงเหลือต่ำ</div>}{memberLowPositive.map((member) => <button type="button" className="notif-row member-row" role="menuitem" key={`lowbal-${member.memberNumber}`} onClick={() => { setNotifOpen(false); setPendingMemberNumber(member.memberNumber); setActiveView("members"); }}><div><b>{memberFullName(member)}</b><small>คงเหลือ <b className="amount-low">{money(member.balance)}</b> · ต่ำกว่า {money(lowBalanceThreshold)}</small></div><i className="notif-dot amber" /></button>)}{memberLowBalanceHidden > 0 && <div className="notif-more">+ {memberLowBalanceHidden} รายการเพิ่มเติม</div>}</div>}<button type="button" className="notif-footer" role="menuitem" onClick={() => { setNotifOpen(false); setActiveView("stock"); }}>ดูสต็อกทั้งหมด →</button></div>}</div><div className="profile-pill"><span className={`profile-avatar ${role}`}>{profileAvatar}</span><div><b>{profileName}</b><small>{role === "admin" ? "ผู้บริหาร" : role === "dev" ? "ผู้พัฒนา" : "เจ้าหน้าที่"}{role === "dev" && <i className="dev-role-badge">DEV</i>}</small></div></div></div></header><div className="page-content" key={safeView}>{safeView === "dashboard" && <Dashboard setView={setActiveView} role={role} userName={profileName} />}{safeView === "pos" && <Pos shortcut={posShortcut} setShortcut={setPosShortcut} role={role} userName={profileName} />}{safeView === "stock" && <Stock role={role} userName={profileName} />}{safeView === "members" && <Members role={role} userName={profileName} focusMemberNumber={pendingMemberNumber} onFocusMemberConsumed={() => setPendingMemberNumber(null)} />}{safeView === "reports" && <Reports focusBill={pendingBillNumber} onFocusBillConsumed={() => setPendingBillNumber(null)} role={role} userName={profileName} />}{safeView === "settings" && isAdminRole(role) && <Settings setView={setActiveView} role={role} initialTab={settingsFocusTab ?? undefined} />}{safeView === "users" && isAdminRole(role) && <Users selfUsername={user.openId} />}{safeView === "logs" && isAdminRole(role) && <Logs />}</div><footer className="app-footer"><span className="footer-brand">{appName}<small> · ระบบร้านค้าสวัสดิการ</small></span><span className="footer-powered">⚡ Powered by <b>PNG TEAM</b></span>{helpPhone && <span className="footer-help"><CircleHelp size={12} /> ศูนย์ช่วยเหลือ {helpPhone}</span>}</footer><GlobalSearch role={role} open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={(view) => { setActiveView(view); setSearchOpen(false); setMobileNav(false); }} onOpenMember={(memberNumber) => { setSearchOpen(false); setPendingMemberNumber(memberNumber); setActiveView("members"); }} onOpenBill={(orderNumber) => { setSearchOpen(false); setPendingBillNumber(orderNumber); setActiveView("reports"); }} /></main></div>;
}

/** Auth gate: session check (auth.me) → splash → first-time setup → login view → forced password change → app shell. */
export default function Home() {
  const authQuery = trpc.auth.me.useQuery();
  // ROUND 25 — แบรนด์ (ชื่อ/โลโก้/สี) โหลดจาก settings สาธารณะ ใช้ทั้งก่อน/หลัง login
  const brandQuery = trpc.settings.get.useQuery(undefined);
  // ROUND 36 (ข้อ 31) — สถานะลงทะเบียนครั้งแรก (ฐานข้อมูลยังไม่มีบัญชีผู้ใช้เลย)
  // ถามเฉพาะตอนยังไม่มีเซสชัน เพื่อไม่ให้ทุก request ไปนับตาราง app_users
  const setupStatusQuery = trpc.auth.setupStatus.useQuery(undefined, { enabled: !authQuery.data });
  useEffect(() => {
    applyCachedBrand(); // ธีมที่จำไว้ ใช้ทันทีตอนบูต กันกระพริบ
  }, []);
  useEffect(() => {
    applyBrand(brandQuery.data);
  }, [brandQuery.data]);
  if (authQuery.isLoading) {
    return <div className="auth-splash"><div className="brand-mark"><span>ส</span></div><p>กำลังตรวจสอบสิทธิ์การใช้งาน…</p></div>;
  }
  const user = authQuery.data;
  if (!user) {
    // ระบบใหม่ที่ยังไม่มีบัญชีผู้ใช้ → หน้าลงทะเบียนผู้บริหารหลักก่อนเข้าสู่ระบบ
    if (setupStatusQuery.data?.needsSetup) {
      return <SetupView brand={brandQuery.data} onAuthed={() => { void authQuery.refetch(); void setupStatusQuery.refetch(); }} />;
    }
    return <LoginView brand={brandQuery.data} onAuthed={() => void authQuery.refetch()} />;
  }
  // ROUND 36 — บัญชีที่ยังต้องเปลี่ยนรหัสผ่าน (ลงทะเบียนครั้งแรก/ผู้บริหารตั้งรหัสให้)
  // ต้องเปลี่ยนก่อนจึงจะไปหน้าหลักได้ — ไม่มีทางข้าม
  if (user.mustChangePassword) {
    return <ForceChangeView user={user} brand={brandQuery.data} onDone={() => void authQuery.refetch()} onLogout={() => void authQuery.refetch()} />;
  }
  return <AppShell user={user} brand={brandQuery.data} onLogout={() => void authQuery.refetch()} />;
}
