import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import * as XLSX from "xlsx";
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
  LayoutDashboard,
  Menu,
  Monitor,
  MoreHorizontal,
  Network,
  Palette,
  Pause,
  Plus,
  Printer,
  ReceiptText,
  RefreshCw,
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
  X,
} from "lucide-react";
import { toast } from "sonner";

import type { MemberLite, Role, View } from "./pageData";
import type { MemberTransactionRow, SaleHistoryEntry } from "../../../server/sqliteStore";
import type { User } from "../../../drizzle/schema";
import { canAccessView, compressImageToDataUrl, formatMemberNumber, isAdminRole, loadHeldBills, money, navItems, roleThaiLabel, scanCandidates } from "./pageData";
import { ConfirmDialog, SectionHeader, StatusPill } from "./PagePrimitives";
import { Dashboard } from "./Dashboard";
import { GlobalSearch } from "@/components/GlobalSearch";
import { ThaiDatePicker } from "@/components/ThaiDatePicker";
import { downloadReportPdf, printReportDoc, type ReportDocConfig } from "@/reportDoc";
import { MemberScanPicker } from "@/components/ScanPickers";
import { LoginView } from "@/components/LoginView";
import { SetupView } from "@/components/SetupView";
import { ForceChangeView } from "@/components/ForceChangeView";
import { MemberCardModal } from "@/components/MemberCardModal";
import { StatementModal } from "@/components/StatementModal";
import { CameraCaptureModal } from "@/components/CameraCaptureModal";
import { ReceiptModal } from "@/components/ReceiptModal";
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
  storeName: string;
  storeCode: string;
  storeAddress: string;
  appName: string;
  appLogo: string;
  appTheme: string;
  /** ROUND 38 (ข้อ 38) — บุคลิกการออกแบบทั้งระบบ: shop | apple | microsoft | android */
  appStyle: string;
  autoPrintReceipt: boolean;
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
};

/** Round 17 — Thai labels per settings field, used by the unsaved-changes bar. */
const SETTINGS_FIELD_LABELS: [keyof SettingsForm, string][] = [
  ["memberNumberMode", "รูปแบบเลขสมาชิก"],
  ["storeName", "ชื่อร้าน"],
  ["storeCode", "รหัสร้าน"],
  ["storeAddress", "ที่อยู่"],
  ["appName", "ชื่อแอป"],
  ["appLogo", "โลโก้"],
  ["appTheme", "สีธีม"],
  ["appStyle", "สไตล์หน้าตาแอป"],
  ["autoPrintReceipt", "พิมพ์ใบเสร็จอัตโนมัติ"],
  ["showBalanceOnReceipt", "แสดงยอดคงเหลือบนใบเสร็จ"],
  ["lowBalanceAlert", "แจ้งเตือนยอดคงเหลือต่ำ"],
  ["lowBalanceThreshold", "เกณฑ์ยอดคงเหลือต่ำ"],
  ["lowStockAlert", "แจ้งเตือนสต็อกต่ำ"],
  ["expiryAlert", "แจ้งเตือนใกล้หมดอายุ"],
  ["expiryAlertDays", "จำนวนวันแจ้งเตือนล่วงหน้า"],
  ["dailyCutOffMode", "โหมดตัดยอดรายวัน"],
  ["dailyCutOffTime", "เวลาตัดยอดรายวัน"],
  ["devAccess", "การเข้าใช้งานสำหรับผู้พัฒนา"],
  ["backupAutoEnabled", "สำรองข้อมูลอัตโนมัติ"],
  ["backupIntervalHours", "รอบสำรองข้อมูลอัตโนมัติ"],
  ["backupKeepCount", "จำนวนไฟล์สำรองที่เก็บ"],
  ["receiptPaperWidth", "ความกว้างกระดาษสลิป"],
];

function MemberDetail({ member, onBack, role, userName, onDeleted }: { member: MemberLite; onBack: () => void; role: Role; userName: string; onDeleted: (message: string) => void }) {
  const utils = trpc.useUtils();
  const detailQuery = trpc.member.detail.useQuery({ memberNumber: member.memberNumber });
  // Enhancement panel — real spending stats from sales (hidden silently on error).
  const statsQuery = trpc.member.stats.useQuery({ memberNumber: member.memberNumber }, { enabled: Boolean(member.memberNumber) });
  const [tab, setTab] = useState<"ทั้งหมด" | "ซื้อสินค้า" | "เติมเงิน" | "ถอนเงิน">("ทั้งหมด");
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [walletOpen, setWalletOpen] = useState<"deposit" | "withdrawal" | null>(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<{ firstName: string; lastName: string; type: string; phone: string; idCard: string; gender: "ชาย" | "หญิง" | "ไม่ระบุ"; photoUrl: string; creditLimit: string } | null>(null);
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
  const totalDeposited = transactions.filter((tx) => tx.type === "deposit").reduce((sum, tx) => sum + tx.amount, 0);
  const lastActivity = formatLastActivity(transactions[0]?.createdAt ?? member.lastTransactionAt);
  const displayName = `${profile.firstName} ${profile.lastName}`.trim();
  const statusMeta = MEMBER_STATUS_META[profile.status];
  const filtered = transactions.filter((tx) => tab === "ทั้งหมด" || WALLET_TX_META[tx.type]?.label === tab);
  const walletPreviewAmount = Number(walletAmount) || 0;
  const balanceAfterWallet = walletOpen === "deposit" ? profile.balance + walletPreviewAmount : profile.balance - walletPreviewAmount;
  const walletMutation = trpc.member.wallet.useMutation({
    onSuccess: (result) => {
      setWalletOpen(null);
      setWalletAmount("");
      setWalletNote("");
      setError("");
      setNotice(`${result.type === "deposit" ? "เติมเงิน" : "ถอนเงิน"} ${result.memberName} (${result.memberNumber}) สำเร็จ · ยอดคงเหลือ ${money(result.balanceAfter)}`);
      void utils.member.list.invalidate();
      void utils.member.detail.invalidate();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const statusMutation = trpc.member.setStatus.useMutation({
    onSuccess: (result) => {
      const member = result?.member;
      if (!member) return;
      setNotice(`${member.status === "suspended" ? "ระงับการใช้งาน" : "คืนสถานะการใช้งาน"} ${member.firstName} ${member.lastName} แล้ว`);
      void utils.member.list.invalidate();
      void utils.member.detail.invalidate();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  const updateMutation = trpc.member.update.useMutation({
    onSuccess: (result) => {
      setEditOpen(false);
      setError("");
      setNotice(`บันทึกการแก้ไขข้อมูลสมาชิกเรียบร้อยแล้ว · ${result.firstName} ${result.lastName}`);
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
    setEditForm({ firstName: detail?.firstName ?? profile.firstName, lastName: detail?.lastName ?? profile.lastName, type: detail?.type ?? profile.type, phone: detail?.phone ?? "", idCard: detail?.idCard ?? "", gender: detail?.gender === "ชาย" ? "ชาย" : detail?.gender === "หญิง" ? "หญิง" : "ไม่ระบุ", photoUrl: detail?.photoUrl ?? "", creditLimit: detail?.creditLimit != null ? String(detail.creditLimit) : "" });
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
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
      idCard: editForm.idCard.trim() || null,
      phone: editForm.phone.trim() || null,
      type: editForm.type,
      gender: editForm.gender,
      photoUrl: editForm.photoUrl || null,
      creditLimit: creditLimitValue,
      actor,
      actorRole,
    });
  };
  const submitWallet = () => {
    if (!walletOpen) return;
    const amount = Number(walletAmount);
    if (!(amount > 0)) { setError("กรุณาระบุจำนวนเงินมากกว่า 0"); return; }
    if (walletOpen === "withdrawal" && amount > profile.balance) { setError(`ยอดเงินคงเหลือไม่พอ · ถอน ${money(amount)} คงเหลือ ${money(profile.balance)}`); return; }
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
  return <><SectionHeader eyebrow="สมาชิกและบัญชี / รายละเอียด" title={`รายละเอียด ${displayName}`} description="ตรวจสอบประวัติการซื้อสินค้า เติมเงิน และถอนเงินของสมาชิกแต่ละราย" action={<button className="outline-button" onClick={onBack}><ArrowDownToLine size={16} style={{ transform: "rotate(90deg)" }} /> กลับไปรายการสมาชิก</button>} /><div className="member-detail-head"><div className="member-detail-profile"><span className="member-detail-avatar">{profile.firstName.slice(0, 1)}</span><div><span className="eyebrow">{profile.type} · {profile.memberNumber}</span><h2>{displayName}</h2><p>สถานะ <StatusPill tone={statusMeta.tone}>{statusMeta.label}</StatusPill> <span className="member-limit-chip" title="วงเงินซื้อสินค้าต่อวันของสมาชิกนี้ (ชำระหักบัญชี) — เว้นว่างคือไม่จำกัด">วงเงินซื้อ/วัน {profile.creditLimit != null ? money(profile.creditLimit) : "ไม่จำกัด"}</span></p></div></div><div className="member-detail-actions"><button className="primary-button" disabled={profile.status !== "active"} onClick={() => { setWalletOpen("deposit"); setError(""); }}><ArrowDownToLine size={15} /> เติมเงิน</button><button className="outline-button" disabled={profile.status !== "active"} onClick={() => { setWalletOpen("withdrawal"); setError(""); }}><ArrowUpFromLine size={15} /> ถอนเงิน</button><button className="outline-button" onClick={openLimitDialog} title="ยื่นคำขอลดวงเงินซื้อสินค้าต่อวัน — รอผู้บริหารพิจารณา"><TrendingDown size={15} /> ขอลดวงเงิน</button>{profile.status === "active" ? <button className="danger-outline-button" onClick={() => setConfirmStatus(true)}><LockKeyhole size={15} /> ระงับการใช้งาน</button> : <button className="outline-button" onClick={() => setConfirmStatus(true)}><Check size={15} /> คืนสถานะ</button>}<button className="outline-button" onClick={openEdit}><Settings2 size={15} /> แก้ไขข้อมูลสมาชิก</button><button className="outline-button" disabled={detailQuery.isLoading} onClick={() => setStatementOpen(true)}><FileText size={15} /> ส่งออกรายงานธุรกรรม</button><button className="outline-button" onClick={() => setCardOpen(true)}><IdCard size={15} /> พิมพ์บัตรสมาชิก</button>{isAdminRole(role) && <button className="danger-outline-button" onClick={() => { setConfirmDelete(true); setError(""); }}><Trash2 size={15} /> ลบสมาชิก</button>}</div></div>{error && !walletOpen && !editOpen && !limitOpen && <div className="notice-bar error" style={{ marginBottom: 14 }}><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="member-detail-stats"><div><span className="stat-icon green"><WalletCards size={18} /></span><div><small>ยอดเงินคงเหลือ</small><strong>{money(profile.balance)}</strong></div></div><div><span className="stat-icon blue"><ShoppingCart size={18} /></span><div><small>ยอดซื้อเดือนนี้</small><strong>{money(monthPurchase)}</strong></div></div><div><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>เติมเงินสะสม</small><strong>{money(totalDeposited)}</strong></div></div><div><span className="stat-icon amber"><CalendarDays size={18} /></span><div><small>รายการล่าสุด</small><strong>{lastActivity}</strong></div></div></div>{statsQuery.isLoading ? <div className="member-detail-stats member-purchase-stats" aria-busy="true">{Array.from({ length: 4 }, (_, index) => <div key={`stat-skeleton-${index}`}><span className="skeleton-avatar" /><div className="member-stat-skeleton"><span className="skeleton-cell-n" /><span className="skeleton-cell-w" /></div></div>)}</div> : statsQuery.data ? <div className="member-detail-stats member-purchase-stats"><div><span className="stat-icon blue"><ReceiptText size={18} /></span><div><small>ยอดซื้อสะสม</small><strong>{money(statsQuery.data.totalSpent)}</strong></div></div><div><span className="stat-icon green"><ShoppingBag size={18} /></span><div><small>จำนวนบิล</small><strong>{statsQuery.data.billCount} บิล</strong></div></div><div><span className="stat-icon purple"><CalendarDays size={18} /></span><div><small>ซื้อครั้งล่าสุด</small><strong>{statsQuery.data.lastPurchaseAt ? formatHistoryDate(statsQuery.data.lastPurchaseAt) : "ยังไม่เคยซื้อ"}</strong></div></div><div><span className="stat-icon amber"><Star size={18} /></span><div className="member-top-products"><small>สินค้าที่ซื้อบ่อย</small>{statsQuery.data.topProducts.length === 0 ? <span className="top-products-empty">ยังไม่มีประวัติการซื้อสินค้า</span> : <div className="top-products-list">{statsQuery.data.topProducts.map((product) => <span className="top-product-chip" key={product.name}>{product.name} <b>×{product.qty}</b></span>)}</div>}</div></div></div> : null}<section className="panel table-panel member-history-panel"><div className="table-toolbar"><div><h2>ประวัติการทำรายการ</h2><p>ข้อมูลย้อนหลังของ {displayName} · รวม {transactions.length} รายการ</p></div><div className="filter-pills history-tabs">{["ทั้งหมด", "ซื้อสินค้า", "เติมเงิน", "ถอนเงิน"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item as typeof tab)}>{item}</button>)}</div></div><div className="member-history-list">{detailQuery.isLoading ? <div className="table-loading"><ReceiptText size={22} /><b>กำลังโหลดประวัติการทำรายการ</b><span>ดึงข้อมูลธุรกรรมของสมาชิกจากระบบ</span></div> : filtered.length === 0 ? <div className="table-loading"><ReceiptText size={22} /><b>ไม่พบรายการตามเงื่อนไข</b><span>ลองเปลี่ยนแท็บหรือทำรายการผ่าน POS</span></div> : filtered.map((transaction) => { const meta = WALLET_TX_META[transaction.type] ?? { label: transaction.type, tone: "blue" }; return <div className="history-row" key={transaction.id}><span className={`history-icon ${meta.tone}`}>{transaction.type === "purchase" ? <ShoppingCart size={16} /> : transaction.type === "deposit" ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</span><div className="history-main"><div><b>{meta.label}</b><span>{`TX-${String(transaction.id).padStart(3, "0")}`}</span></div><small>{transaction.detail}</small><time>{formatHistoryDate(transaction.createdAt)}</time></div><strong className={transaction.amount > 0 ? "positive" : "negative"}>{transaction.amount > 0 ? "+ " : "- "}{money(Math.abs(transaction.amount))}</strong></div>; })}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section>{walletOpen && <div className="modal-backdrop" onClick={() => setWalletOpen(null)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">WALLET TRANSACTION</span><h2>{walletOpen === "deposit" ? "เติมเงินเข้าบัญชีสมาชิก" : "ถอนเงินจากบัญชีสมาชิก"}</h2><p>{displayName} · {profile.memberNumber} · ยอดคงเหลือ {money(profile.balance)}</p></div><button className="icon-button" onClick={() => setWalletOpen(null)}><X size={17} /></button></div><div className="member-number-preview"><span><WalletCards size={16} /> ยอดคงเหลือหลังรายการ</span><b className={balanceAfterWallet < 0 ? "red-text" : ""}>{money(balanceAfterWallet)}</b></div>{balanceAfterWallet < 0 && <div className="notice-bar error"><ShieldCheck size={16} /> ยอดเงินคงเหลือไม่พอสำหรับถอนจำนวนนี้<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="form-grid compact-form"><label>จำนวนเงิน (฿) *<input autoFocus type="number" min="0" step="0.01" value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} placeholder="0.00" /></label><label className="wide">หมายเหตุ<input value={walletNote} onChange={(event) => setWalletNote(event.target.value)} placeholder={walletOpen === "deposit" ? "เช่น เติมเงินสดที่เคาน์เตอร์" : "เช่น ถอนเพื่อใช้จ่ายส่วนตัว"} /></label></div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setWalletOpen(null)}>ยกเลิก</button><button className="primary-button" disabled={walletMutation.isPending || !(Number(walletAmount) > 0) || balanceAfterWallet < 0} onClick={submitWallet}><Check size={16} /> {walletMutation.isPending ? "กำลังบันทึก…" : walletOpen === "deposit" ? "บันทึกการเติมเงิน" : "บันทึกการถอนเงิน"}</button></div></div></div>}<ConfirmDialog open={confirmStatus} title={profile.status === "active" ? "ยืนยันการระงับสมาชิก?" : "ยืนยันการคืนสถานะสมาชิก?"} description={profile.status === "active" ? `สมาชิก ${displayName} จะไม่สามารถใช้ยอดคงเหลือซื้อสินค้าได้จนกว่าจะเปิดใช้งานอีกครั้ง` : `สมาชิก ${displayName} จะสามารถใช้ยอดคงเหลือซื้อสินค้าและรับการเติมเงินได้อีกครั้ง`} confirmLabel={profile.status === "active" ? "ยืนยันระงับการใช้งาน" : "ยืนยันคืนสถานะการใช้งาน"} onCancel={() => setConfirmStatus(false)} onConfirm={() => { setConfirmStatus(false); statusMutation.mutate({ memberNumber: member.memberNumber, suspended: profile.status === "active", actor, actorRole }); }} />{editOpen && editForm && <div className="modal-backdrop" onClick={() => setEditOpen(false)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">EDIT MEMBER</span><h2>แก้ไขข้อมูลสมาชิก</h2><p>{displayName} · {profile.memberNumber}</p></div><button className="icon-button" onClick={() => setEditOpen(false)}><X size={17} /></button></div><div className="form-grid compact-form"><label>ชื่อ *<input autoFocus value={editForm.firstName} onChange={(event) => setEditForm({ ...editForm, firstName: event.target.value })} placeholder="ชื่อ" /></label><label>นามสกุล *<input value={editForm.lastName} onChange={(event) => setEditForm({ ...editForm, lastName: event.target.value })} placeholder="นามสกุล" /></label><label>ประเภทสมาชิก<select value={editForm.type} onChange={(event) => setEditForm({ ...editForm, type: event.target.value })}><option>สมาชิก</option><option>เจ้าหน้าที่</option></select></label><label>วงเงินซื้อสินค้าต่อวัน (บาท)<input type="number" inputMode="numeric" min="1" step="1" value={editForm.creditLimit} onChange={(event) => setEditForm({ ...editForm, creditLimit: event.target.value })} placeholder="เว้นว่าง = ไม่จำกัด" title="ยอดซื้อรวมต่อวันเมื่อชำระหักบัญชีสมาชิก · เว้นว่าง = ไม่จำกัด" /></label><label>เบอร์โทรศัพท์<input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} placeholder="เช่น 08x-xxx-xxxx" /></label><label className="wide">เลขที่บัตรประชาชน<input value={editForm.idCard} onChange={(event) => setEditForm({ ...editForm, idCard: event.target.value })} placeholder="-" /></label><label className="wide">รูปสมาชิก (แสดงบนบัตร)<div className="member-photo-uploader">{editForm.photoUrl ? <><img className="member-photo-preview" src={editForm.photoUrl} alt="รูปสมาชิกปัจจุบัน" /><div className="member-photo-actions"><div className="photo-action-row"><button type="button" className="outline-button compact" onClick={() => setEditCameraOpen(true)}><Camera size={15} /> ถ่ายใหม่จากกล้อง</button><button type="button" className="danger-outline-button compact" onClick={() => setEditForm((current) => (current ? { ...current, photoUrl: "" } : current))}><Trash2 size={15} /> ลบรูป</button></div></div></> : <><div className="photo-action-row"><label className="upload-drop member-photo-drop" htmlFor="edit-member-photo"><ImagePlus size={17} /><span><b>เลือกรูปจากไฟล์</b><small>PNG JPG WEBP · ระบบย่อ 480px อัตโนมัติ</small></span><input id="edit-member-photo" type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onEditPhotoPick} /></label></div><button type="button" className="outline-button compact camera-hint-inline" onClick={() => setEditCameraOpen(true)}><Camera size={15} /> หรือถ่ายรูปจากกล้องเลย</button></>}</div></label></div><div className="initial-balance-note"><ShieldCheck size={15} /> การแก้ไขจะบันทึกลงระบบทันทีและบันทึกลง Log</div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setEditOpen(false)}>ยกเลิก</button><button className="primary-button" disabled={updateMutation.isPending || !editForm.firstName.trim() || !editForm.lastName.trim()} onClick={submitEdit}><Check size={16} /> {updateMutation.isPending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div></div></div>}{editCameraOpen && <CameraCaptureModal open title={`ถ่ายรูปสมาชิก · ${displayName}`} hint="ตรวจสอบรูปก่อนกด “ใช้รูปนี้” — รูปจะแทนที่รูปเดิมของสมาชิกทันทีในฟอร์ม (ยังไม่บันทึกจนกดบันทึกการแก้ไข)" onClose={() => setEditCameraOpen(false)} onCapture={(dataUrl) => { setEditForm((current) => (current ? { ...current, photoUrl: dataUrl } : current)); setError(""); }} />}{limitOpen && <div className="modal-backdrop" onClick={() => setLimitOpen(false)}><div className="form-modal limit-dialog" role="dialog" aria-modal="true" aria-label="ยื่นคำขอลดวงเงินซื้อสินค้าต่อวัน" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">LIMIT REDUCTION REQUEST</span><h2>ขอลดวงเงินซื้อสินค้าต่อวัน</h2><p>{displayName} · {profile.memberNumber}</p></div><button className="icon-button" onClick={() => setLimitOpen(false)} aria-label="ปิดหน้าต่าง"><X size={17} /></button></div><div className="member-number-preview"><span><TrendingDown size={16} /> วงเงินซื้อ/วัน ปัจจุบัน</span><b>{profile.creditLimit != null ? money(profile.creditLimit) : "ไม่จำกัด"}</b></div>{limitStep === "form" ? <><div className="form-grid compact-form"><label>วงเงินใหม่ (฿) *<input autoFocus type="number" inputMode="numeric" min="1" step="1" value={limitValue} onChange={(event) => setLimitValue(event.target.value)} placeholder={profile.creditLimit != null ? "ต่ำกว่าวงเงินปัจจุบัน" : "0"} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitLimitRequest(); } }} /></label><label>เหตุผล (ไม่บังคับ)<input value={limitReason} maxLength={500} onChange={(event) => setLimitReason(event.target.value)} placeholder="เช่น ขอควบคุมการใช้จ่ายของตนเอง" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitLimitRequest(); } }} /></label></div><div className="initial-balance-note"><CircleHelp size={15} /> {profile.creditLimit != null ? "วงเงินใหม่ต้องน้อยกว่าวงเงินปัจจุบัน · คำขอจะเข้าสถานะรอพิจารณา — วงเงินเปลี่ยนเมื่อผู้บริหารอนุมัติ" : "สมาชิกนี้ยังไม่จำกัดวงเงิน — ระบุวงเงินที่ต้องการ · คำขอจะเข้าสถานะรอพิจารณา ผู้บริหารพิจารณาที่รายงาน → ประวัติธุรกรรม"}</div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setLimitOpen(false)}>ยกเลิก</button><button className="primary-button" onClick={submitLimitRequest}><Check size={16} /> ต่อไป: ตรวจสอบคำขอ</button></div></> : <><div className="wallet-confirm-warning"><ShieldCheck size={16} /><span>คำขอจะยังไม่ถูกส่งจนกว่าจะกด “ส่งคำขอ” — วงเงินของสมาชิกยังไม่เปลี่ยนจนกว่าผู้บริหารจะอนุมัติ</span></div><div className="wallet-confirm-rows"><div><span>สมาชิก</span><b>{displayName} · {profile.memberNumber}</b></div><div><span>วงเงินปัจจุบัน</span><b>{profile.creditLimit != null ? money(profile.creditLimit) : "ไม่จำกัด"}</b></div><div><span>วงเงินใหม่ที่ขอ</span><b className="purple-text">{money(Number(limitValue) || 0)}</b></div>{limitReason.trim() && <div><span>เหตุผล</span><b>{limitReason.trim()}</b></div>}<div><span>ผู้ยื่นคำขอ</span><b>{actor} · {actorRole}</b></div></div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setLimitStep("form")}>ย้อนกลับ</button><button className="primary-button" disabled={limitRequestMutation.isPending} onClick={confirmLimitRequest}><Check size={16} /> {limitRequestMutation.isPending ? "กำลังส่งคำขอ…" : "ส่งคำขอ"}</button></div></>}</div></div>}<ConfirmDialog open={confirmDelete} title="ยืนยันการลบสมาชิก?" description={`ลบ ${displayName} (${member.memberNumber}) ออกจากระบบถาวร · ลบได้เฉพาะบัญชีที่ยอดเงินเป็น 0 และไม่มีประวัติธุรกรรม หากมีประวัติการใช้งาน แนะนำใช้การระงับการใช้งานแทน`} confirmLabel="ยืนยันลบสมาชิก" onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); deleteMutation.mutate({ memberNumber: member.memberNumber, actor, actorRole }); }} />{cardOpen && <MemberCardModal member={detailQuery.data?.member ?? { ...member, createdAt: new Date().toISOString() }} onClose={() => setCardOpen(false)} />}{statementOpen && <StatementModal member={detailQuery.data?.member ?? { ...member, createdAt: new Date().toISOString() }} transactions={transactions} onClose={() => setStatementOpen(false)} />}</>;
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
  return <><SectionHeader eyebrow="สมาชิกและบัญชีสวัสดิการ" title="จัดการสมาชิก" description="ดูรายละเอียด เติม/ถอนเงิน ระงับการใช้งาน และพิมพ์บัตรสมาชิกรายคน — ลงทะเบียนสมาชิกใหม่+พิมพ์บัตร ทำที่ POS · ขายสินค้า (F6) จุดเดียว" /><div className="member-scope-note" role="note"><span className="member-scope-icon"><IdCard size={16} /></span><div><b>ระบบสมาชิกแยกจากผู้ใช้ระบบ</b><small>บัญชีสมาชิกสวัสดิการใช้เพื่อใช้จ่ายที่เคาน์เตอร์เท่านั้น — สมาชิกไม่มีบัญชีเข้าสู่ระบบแอปนี้ · แอปนี้สำหรับเจ้าหน้าที่และผู้บริหารร้านค้า (จัดการบัญชีเข้าสู่ระบบที่เมนูผู้ใช้ระบบ)</small></div></div><div className="member-top-grid"><div className="member-balance-card"><div><span className="eyebrow">ยอดเงินในบัญชีสมาชิกทั้งหมด</span><strong>{money(walletTotal)}</strong><small>สมาชิกใช้งาน {activeCount} ราย · ระงับ {suspendedCount} ราย</small></div><div className="balance-orb"><WalletCards size={26} /></div></div><div className="member-mini-card"><span className="stat-icon green"><UsersRound size={18} /></span><div><small>สมาชิกทั้งหมด</small><strong>{allMembers.length.toLocaleString("th-TH")} <em>ราย</em></strong><p><span className="green-text">{activeCount} ใช้งาน</span> · {suspendedCount} ระงับ</p></div></div><div className="member-mini-card"><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>ลงทะเบียนเดือนนี้</small><strong>{newThisMonth} <em>ราย</em></strong><p>ลงทะเบียนที่ POS (F6) · ดูยอดรวมได้ในรายงาน</p></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>สมาชิกทั้งหมด</h2><p>ค้นหาและกรองตามสถานะการใช้งานได้ทันที</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ เลขสมาชิก หรือพิมพ์เลขบางส่วน/ท้ายเลข" /></div><div className="filter-pills">{["ทั้งหมด", "ใช้งาน", "ระงับ"].map((item) => <button className={statusFilter === item ? "active" : ""} key={item} onClick={() => setStatusFilter(item)}>{item}{item === "ใช้งาน" && <span>{activeCount}</span>}{item === "ระงับ" && <span>{suspendedCount}</span>}</button>)}</div></div></div><div className="table-filter-summary"><span><Search size={13} /> {query ? `ค้นหา “${query}”` : "สมาชิกทั้งหมด · กดแถวเพื่อดูรายละเอียด เติม/ถอนเงิน"}</span><span>แสดง {rows.length} จาก {allMembers.length} รายการ</span></div><div className="table-wrap">{allMembersQuery.isLoading ? <div className="table-loading"><UsersRound size={22} /><b>กำลังโหลดรายการสมาชิก</b><span>ดึงข้อมูลจากระบบ</span></div> : allMembersQuery.isError ? <div className="entity-state error" role="alert"><ShieldCheck size={22} /><b>โหลดรายการสมาชิกไม่สำเร็จ</b><span>{getErrorMessage(allMembersQuery.error)}</span></div> : rows.length === 0 ? <div className="entity-state"><UsersRound size={22} /><b>ไม่พบสมาชิกตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ · ลงทะเบียนใหม่ที่ POS (F6)</span></div> : <table className="entity-table rows-members" aria-label="รายการสมาชิก"><thead><tr><th>หมายเลขสมาชิก</th><th>ชื่อ-นามสกุล</th><th>สถานะ</th><th className="num">ยอดเงินคงเหลือ</th><th className="hide-sm">รายการล่าสุด</th><th aria-label="เปิดรายละเอียด" /></tr></thead><tbody>{rows.map((row) => { const statusMeta = MEMBER_STATUS_META[row.status]; return <tr className="clickable" key={row.memberNumber} onClick={() => setSelectedMember(row)} title={`ดูรายละเอียด ${row.firstName} ${row.lastName} — เติม/ถอนเงิน พิมพ์บัตรสมาชิก`}><td className="cell-mono">{row.memberNumber}</td><td><span className="cell-strong">{row.firstName} {row.lastName}</span><small className="cell-sub">{row.type}</small></td><td><StatusPill tone={statusMeta.tone}>{statusMeta.label}</StatusPill></td><td className="cell-num"><span className={row.balance < 0 ? "negative" : ""}>{money(row.balance)}</span></td><td className="hide-sm"><small className="cell-sub" style={{ marginTop: 0 }}>{formatLastActivity(row.lastTransactionAt)}</small></td><td><span className="row-chevron"><ArrowRight size={15} /></span></td></tr>; })}</tbody></table>}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section></>;
}

const TX_TYPE_LABEL: Record<"purchase" | "deposit" | "withdrawal" | "limit_request", string> = { purchase: "ใช้จ่าย", deposit: "เติมเงิน", withdrawal: "ถอนเงิน", limit_request: "ขอลดวงเงิน" };
const TX_TYPE_TONE: Record<"purchase" | "deposit" | "withdrawal" | "limit_request", "blue" | "green" | "amber" | "purple"> = { purchase: "blue", deposit: "green", withdrawal: "amber", limit_request: "purple" };

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

function Reports({ focusBill, onFocusBillConsumed, role, userName }: { focusBill: string | null; onFocusBillConsumed: () => void; role: Role; userName: string }) {
  const utils = trpc.useUtils();
  const logsQuery = trpc.logs.list.useQuery({ limit: 1000 });
  const [period, setPeriod] = useState("รายวัน");
  // ROUND 28 — ช่วงเวลาแบบกำหนดเองที่ใช้งานได้จริง (กรองยอดขายตามวันที่)
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  // ROUND 30 — สรุปยอดขายแยกตามชนิดสินค้า / พนักงานขาย + ประวัติธุรกรรมสมาชิก
  const [salesView, setSalesView] = useState<"timeline" | "category" | "product" | "cashier">("timeline");
  const [billMember, setBillMember] = useState<MemberLite | null>(null);
  const [txMember, setTxMember] = useState<MemberLite | null>(null);
  const [txType, setTxType] = useState<"all" | "purchase" | "deposit" | "withdrawal" | "limit_request">("all");
  const [txFrom, setTxFrom] = useState("");
  const [txTo, setTxTo] = useState("");
  // ROUND 34 (req 23.2) — การพิจารณาคำขอลดวงเงิน: ผู้บริหารกดอนุมัติ/ปฏิเสธที่แถวรอพิจารณา
  const [limitDecision, setLimitDecision] = useState<{ row: MemberTransactionRow; decision: "approve" | "reject" } | null>(null);
  const [limitError, setLimitError] = useState("");
  const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const effectiveFrom = rangeFrom || isoDay(new Date(Date.now() - 29 * 86_400_000));
  const effectiveTo = rangeTo || isoDay(new Date());
  // ช่วงเวลาที่กำหนดเองส่งถึงเซิร์ฟเวอร์จริง — ไม่จำกัดแค่ 30 วันล่าสุดอีกต่อไป
  const dailyQuery = trpc.reports.daily.useQuery(period === "กำหนดช่วงเวลา" && rangeFrom && rangeTo ? { from: rangeFrom, to: rangeTo } : { days: 30 }, { placeholderData: (previous) => previous });
  // ROUND 27 — รายงานเป็น tab workspace: สรุปยอดขาย / ประวัติบิล / การส่งออก
  const [reportTab, setReportTab] = useState<"sales" | "bills" | "transactions" | "export">("sales");
  // Round 32-21 — แท็บย่อยในส่งออกข้อมูล: ไม่ต้องเลื่อนลงไปให้หัวข้อท้ายหลุดจอ
  const [exportTopic, setExportTopic] = useState<"sales" | "bills" | "transactions">("sales");
  const membersQuery = trpc.member.list.useQuery();
  const members = membersQuery.data ?? [];
  // Round 32-23 — การ์ดสมาชิก (สมาชิกใหม่/เปิดใช้งาน + ยอดเงินคงเหลือ) แทนการ์ดเติม/ถอน
  // ที่ย้ายไปอยู่ในแท็บประวัติธุรกรรมสมาชิกแล้ว
  const memberActiveCount = members.filter((member) => member.status === "active").length;
  const memberNewThisMonth = members.filter((member) => isSameMonth(parseStoreDate(member.createdAt), new Date())).length;
  const memberWalletTotal = members.reduce((sum, member) => sum + member.balance, 0);
  const categoryQuery = trpc.reports.byCategory.useQuery({ from: effectiveFrom, to: effectiveTo }, { enabled: reportTab === "sales" && salesView === "category", placeholderData: (previous) => previous });
  const cashierQuery = trpc.reports.byCashier.useQuery({ from: effectiveFrom, to: effectiveTo }, { enabled: reportTab === "sales" && salesView === "cashier", placeholderData: (previous) => previous });
  const productQuery = trpc.reports.byProduct.useQuery({ from: effectiveFrom, to: effectiveTo }, { enabled: reportTab === "sales" && salesView === "product", placeholderData: (previous) => previous });
  const txQuery = trpc.reports.memberTransactions.useQuery({ memberNumber: txMember?.memberNumber, type: txType === "all" ? undefined : txType, from: txFrom || undefined, to: txTo || undefined, limit: 300 });
  const txRows = txQuery.data ?? [];
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
  // ROUND 28 — ช่วงเวลาที่กำหนดเอง: กรองข้อมูลรายวันตามวันเริ่ม/สิ้นสุดก่อนสรุป
  const rangeDailyRows = useMemo(() => {
    if (period !== "กำหนดช่วงเวลา" || !rangeFrom || !rangeTo) return dailyRows;
    return dailyRows.filter((row) => row.date >= rangeFrom && row.date <= rangeTo);
  }, [period, rangeFrom, rangeTo, dailyRows]);
  const reportRows = useMemo(() => {
    const sum = (list: typeof dailyRows) => list.reduce((acc, row) => ({ orders: acc.orders + row.orders, items: acc.items + row.items, revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, profit: acc.profit + row.profit }), { orders: 0, items: 0, revenue: 0, cogs: 0, profit: 0 });
    if (rangeDailyRows.length === 0) return [] as { label: string; orders: number; items: number; revenue: number; cogs: number; profit: number }[];
    if (period === "รายเดือน") {
      const totals = sum(rangeDailyRows);
      return [{ label: formatThaiMonthYear(rangeDailyRows[rangeDailyRows.length - 1].date), ...totals }];
    }
    if (period === "รายสัปดาห์") {
      const weeks: { label: string; orders: number; items: number; revenue: number; cogs: number; profit: number }[] = [];
      for (let start = 0; start < rangeDailyRows.length; start += 7) {
        const chunk = rangeDailyRows.slice(start, start + 7);
        weeks.push({ label: `${formatShortDay(chunk[0].date)}–${formatShortDay(chunk[chunk.length - 1].date)}`, ...sum(chunk) });
      }
      return weeks;
    }
    const shown = period === "รายวัน" ? rangeDailyRows.slice(-7) : rangeDailyRows;
    return shown.map((row) => ({ label: formatShortDay(row.date), orders: row.orders, items: row.items, revenue: row.revenue, cogs: row.cogs, profit: row.profit }));
  }, [rangeDailyRows, period]);
  const totals = reportRows.reduce((acc, row) => ({ orders: acc.orders + row.orders, items: acc.items + row.items, revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, profit: acc.profit + row.profit }), { orders: 0, items: 0, revenue: 0, cogs: 0, profit: 0 });
  const marginPercent = totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : "0.0";
  const maxRevenue = Math.max(...reportRows.map((row) => row.revenue), 1);
  // ROUND 30 — ตัวเลขสำหรับมุมมองแยกตามชนิดสินค้า / พนักงานขาย และประวัติธุรกรรม
  const categoryRows = categoryQuery.data ?? [];
  const categoryTotal = categoryRows.reduce((acc, row) => ({ orders: acc.orders + row.orders, qty: acc.qty + row.qty, revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, profit: acc.profit + row.profit }), { orders: 0, qty: 0, revenue: 0, cogs: 0, profit: 0 });
  const productRows = productQuery.data ?? [];
  const productTotal = productRows.reduce((acc, row) => ({ bills: acc.bills + row.bills, qty: acc.qty + row.qty, revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, profit: acc.profit + row.profit }), { bills: 0, qty: 0, revenue: 0, cogs: 0, profit: 0 });
  const cashierRows = cashierQuery.data ?? [];
  const cashierTotal = cashierRows.reduce((acc, row) => ({ orders: acc.orders + row.orders, items: acc.items + row.items, memberBills: acc.memberBills + row.memberBills, discount: acc.discount + row.discount, total: acc.total + row.total }), { orders: 0, items: 0, memberBills: 0, discount: 0, total: 0 });
  const txTotals = {
    spend: txRows.filter((row) => row.type === "purchase").reduce((sum, row) => sum + row.amount, 0),
    spendCount: txRows.filter((row) => row.type === "purchase").length,
    deposit: txRows.filter((row) => row.type === "deposit").reduce((sum, row) => sum + row.amount, 0),
    depositCount: txRows.filter((row) => row.type === "deposit").length,
    withdraw: txRows.filter((row) => row.type === "withdrawal").reduce((sum, row) => sum + row.amount, 0),
    withdrawCount: txRows.filter((row) => row.type === "withdrawal").length,
    // ROUND 34 — แถวคำขอลดวงเงินตามตัวกรองปัจจุบัน
    limitCount: txRows.filter((row) => row.kind === "limit").length,
  };
  const dailySalesRows = [
    ["วันที่ / ช่วงเวลา", "จำนวนบิล", "รายการที่ขาย", "ยอดขาย", "ต้นทุน", "กำไร"],
    ...reportRows.map((row) => [row.label, String(row.orders), String(row.items), row.revenue.toFixed(2), row.cogs.toFixed(2), row.profit.toFixed(2)]),
    ["รวม", String(totals.orders), String(totals.items), totals.revenue.toFixed(2), totals.cogs.toFixed(2), totals.profit.toFixed(2)],
  ];
  const downloadDailySalesCsv = () => {
    const csv = "\ufeff" + dailySalesRows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "daily-sales-summary.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice("ดาวน์โหลดรายงานยอดขาย CSV แล้ว");
  };
  // Round 31-10 — PDF คือ "เอกสารรายงาน A4" ที่สร้างจากข้อมูลจริงตามมุมมองที่เลือก
  // (ไม่ใช่การจับภาพหน้าแอปอีกต่อไป)
  const dailySalesDocConfig = (): ReportDocConfig => {
    if (salesView === "timeline") {
      return {
        fileName: "daily-sales-summary.pdf", title: "รายงานสรุปยอดขายตามช่วงเวลา", periodLabel: `ช่วงข้อมูล ${rangeLabel} · โหมด${period}`,
        meta: [["จำนวนบิล", `${totals.orders.toLocaleString("th-TH")} บิล`], ["ยอดขายรวม", money(totals.revenue)], ["กำไรขั้นต้น", `${money(totals.profit)} (${marginPercent}%)`]],
        columns: ["วันที่ / ช่วงเวลา", "บิล", "รายการที่ขาย", "ยอดขาย (บาท)", "ต้นทุน (บาท)", "กำไร (บาท)"], numericCols: [1, 2, 3, 4, 5],
        rows: reportRows.map((row) => [row.label, String(row.orders), String(row.items), row.revenue.toFixed(2), row.cogs.toFixed(2), row.profit.toFixed(2)]),
        totalsRow: ["รวมทั้งช่วง", String(totals.orders), String(totals.items), totals.revenue.toFixed(2), totals.cogs.toFixed(2), totals.profit.toFixed(2)],
        brandName: "ร้านค้าสวัสดิการ", footnote: "ตัวเลขจากระบบขายหน้าร้าน · รายงานสร้างตามช่วงเวลาที่เลือกไว้",
      };
    }
    if (salesView === "product" || salesView === "category") {
      const rows = salesView === "product"
        ? productRows.map((row) => [`${row.name}${row.sku ? ` (${row.sku})` : ""}`, String(row.bills), String(row.qty), row.revenue.toFixed(2), row.cogs.toFixed(2), row.profit.toFixed(2)])
        : categoryRows.map((row) => [row.category, String(row.orders), String(row.qty), row.revenue.toFixed(2), row.cogs.toFixed(2), row.profit.toFixed(2)]);
      const totalsRow = salesView === "product"
        ? ["รวมทุกสินค้า", String(productTotal.bills), String(productTotal.qty), productTotal.revenue.toFixed(2), productTotal.cogs.toFixed(2), productTotal.profit.toFixed(2)]
        : ["รวมทุกชนิดสินค้า", String(categoryTotal.orders), String(categoryTotal.qty), categoryTotal.revenue.toFixed(2), categoryTotal.cogs.toFixed(2), categoryTotal.profit.toFixed(2)];
      return {
        fileName: "daily-sales-summary.pdf", title: salesView === "product" ? "รายงานสรุปยอดขายแยกตามสินค้า" : "รายงานสรุปยอดขายแยกตามชนิดสินค้า", periodLabel: `ช่วงข้อมูล ${rangeLabel}`,
        columns: [salesView === "product" ? "สินค้า (รหัส)" : "ชนิดสินค้า", "บิล", "ชิ้น", "ยอดขาย (บาท)", "ต้นทุน (บาท)", "กำไร (บาท)"], numericCols: [1, 2, 3, 4, 5],
        rows, totalsRow, brandName: "ร้านค้าสวัสดิการ", footnote: "เรียงตามยอดขายสูงสุดก่อน · ตัวเลขจากระบบขายหน้าร้าน",
      };
    }
    return {
      fileName: "daily-sales-summary.pdf", title: "รายงานสรุปยอดขายแยกตามพนักงานขาย", periodLabel: `ช่วงข้อมูล ${rangeLabel}`,
      columns: ["พนักงานขาย (ผู้ทำรายการ)", "บิล", "ชิ้น", "บิลสมาชิก", "ส่วนลดรวม (บาท)", "ยอดขายรวม (บาท)"], numericCols: [1, 2, 3, 4, 5],
      rows: cashierRows.map((row) => [row.cashier, String(row.orders), String(row.items), String(row.memberBills), row.discount.toFixed(2), row.total.toFixed(2)]),
      totalsRow: ["รวมทุกพนักงาน", String(cashierTotal.orders), String(cashierTotal.items), String(cashierTotal.memberBills), cashierTotal.discount.toFixed(2), cashierTotal.total.toFixed(2)],
      brandName: "ร้านค้าสวัสดิการ", footnote: "สรุปจากบิลขายจริง · แยกตามผู้ทำรายการที่หน้าร้าน",
    };
  };
  // Round 32-25 — PDF และ "พิมพ์" ใช้ข้อมูลชุดเดียวกัน (เอกสาร A4 เดียวกัน)
  const downloadDailySalesPdf = async () => {
    if (reportTab !== "sales") { setReportTab("sales"); await new Promise((resolve) => setTimeout(resolve, 150)); }
    if (reportRows.length === 0 && (salesView === "product" ? productRows.length : salesView === "category" ? categoryRows.length : cashierRows.length) === 0) { setNotice("ยังไม่มีข้อมูลยอดขายในช่วงนี้"); return; }
    await downloadReportPdf(dailySalesDocConfig());
    setNotice("ดาวน์โหลดรายงานยอดขาย PDF แล้ว");
  };
  const printDailySalesReport = async () => {
    if (reportTab !== "sales") { setReportTab("sales"); await new Promise((resolve) => setTimeout(resolve, 150)); }
    if (reportRows.length === 0 && (salesView === "product" ? productRows.length : salesView === "category" ? categoryRows.length : cashierRows.length) === 0) { setNotice("ยังไม่มีข้อมูลยอดขายในช่วงนี้"); return; }
    printReportDoc(dailySalesDocConfig());
    setNotice("สั่งพิมพ์รายงานยอดขายแล้ว — เอกสาร A4 ผ่านเครื่องพิมพ์เริ่มต้น");
  };
  const downloadDailySalesXlsx = () => {
    if (reportRows.length === 0) { setNotice("ยังไม่มีข้อมูลยอดขายในช่วงนี้"); return; }
    const sheet = XLSX.utils.aoa_to_sheet(dailySalesRows.map((row) => row.map((cell) => (/^-?[0-9,]+(\.[0-9]+)?$/.test(cell) ? Number(cell) : cell))));
    sheet["!cols"] = [{ wch: 26 }, { wch: 10 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 13 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "สรุปยอดขาย");
    XLSX.writeFile(book, "daily-sales-summary.xlsx");
    setNotice("ดาวน์โหลดรายงานยอดขาย Excel แล้ว");
  };
  const billsExportRows = () => [
    ["เลขที่บิล", "วันที่ · เวลา", "ลูกค้า", "เลขสมาชิก", "จำนวนรายการ", "ชำระโดย", "ยอดรวม (บาท)"],
    ...salesHistory.map((entry) => [entry.orderNumber, formatLogDateTime(entry.createdAt), entry.memberName ? `สมาชิก ${entry.memberName}` : "บุคคลทั่วไป", entry.memberNumber ?? "—", String(entry.items.length), entry.paymentMethod, entry.total.toFixed(2)]),
  ];
  const billExportBase = billMember ? `bills-${billMember.memberNumber}` : "bills-history";
  const downloadBillsCsv = () => {
    if (salesHistory.length === 0) { setNotice("ยังไม่มีบิลที่จะส่งออก"); return; }
    const csv = "\ufeff" + billsExportRows().map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `${billExportBase}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice(`ดาวน์โหลดประวัติบิล CSV แล้ว · ${salesHistory.length} บิล${billMember ? ` · สมาชิก ${billMember.memberNumber}` : ""}`);
  };
  const downloadBillsXlsx = () => {
    if (salesHistory.length === 0) { setNotice("ยังไม่มีบิลที่จะส่งออก"); return; }
    const sheet = XLSX.utils.aoa_to_sheet(billsExportRows().map((row) => row.map((cell, index) => (index === 6 && /^-?[0-9,]+(\.[0-9]+)?$/.test(cell) ? Number(cell) : cell))));
    sheet["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "ประวัติบิล");
    XLSX.writeFile(book, `${billExportBase}.xlsx`);
    setNotice(`ดาวน์โหลดประวัติบิล Excel แล้ว · ${salesHistory.length} บิล${billMember ? ` · สมาชิก ${billMember.memberNumber}` : ""}`);
  };
  const downloadBillsPdf = async () => {
    if (salesHistory.length === 0) { setNotice("ยังไม่มีบิลที่จะส่งออก"); return; }
    const total = salesHistory.reduce((sum, entry) => sum + entry.total, 0);
    await downloadReportPdf({
      fileName: `${billExportBase}.pdf`, title: "รายงานประวัติบิลขาย",
      periodLabel: billMember ? `แยกรายสมาชิก ${billMember.memberNumber} · สมาชิก${billMember.firstName} ${billMember.lastName}` : `บิลล่าสุดที่โหลดไว้ ${salesHistory.length} บิล`,
      meta: [["จำนวนบิล", `${salesHistory.length} บิล`], ["ยอดรวมทั้งหมด", money(total)]],
      columns: ["เลขที่บิล", "วันที่ · เวลา", "ลูกค้า", "เลขสมาชิก", "รายการ", "ชำระโดย", "ยอดรวม (บาท)"], numericCols: [4, 6],
      rows: salesHistory.map((entry) => [entry.orderNumber, formatLogDateTime(entry.createdAt), entry.memberName ? `สมาชิก ${entry.memberName}` : "บุคคลทั่วไป", entry.memberNumber ?? "—", String(entry.items.length), entry.paymentMethod, entry.total.toFixed(2)]),
      totalsRow: ["รวม", "—", "—", "—", String(salesHistory.reduce((sum, entry) => sum + entry.items.length, 0)), "—", total.toFixed(2)],
      brandName: "ร้านค้าสวัสดิการ", footnote: "กดแถวบนหน้าจอเพื่อเปิดใบเสร็จฉบับเต็มได้ · รายงานนี้สร้างจากบิลที่โหลดไว้ตามตัวกรอง",
    });
    setNotice(`ดาวน์โหลดประวัติบิล PDF แล้ว · ${salesHistory.length} บิล${billMember ? ` · สมาชิก ${billMember.memberNumber}` : ""}`);
  };
  const printBillsReport = async () => {
    if (salesHistory.length === 0) { setNotice("ยังไม่มีบิลที่จะพิมพ์"); return; }
    const total = salesHistory.reduce((sum, entry) => sum + entry.total, 0);
    printReportDoc({
      fileName: `${billExportBase}.pdf`, title: "รายงานประวัติบิลขาย",
      periodLabel: billMember ? `แยกรายสมาชิก ${billMember.memberNumber} · สมาชิก${billMember.firstName} ${billMember.lastName}` : `บิลล่าสุดที่โหลดไว้ ${salesHistory.length} บิล`,
      meta: [["จำนวนบิล", `${salesHistory.length} บิล`], ["ยอดรวมทั้งหมด", money(total)]],
      columns: ["เลขที่บิล", "วันที่ · เวลา", "ลูกค้า", "เลขสมาชิก", "รายการ", "ชำระโดย", "ยอดรวม (บาท)"], numericCols: [4, 6],
      rows: salesHistory.map((entry) => [entry.orderNumber, formatLogDateTime(entry.createdAt), entry.memberName ? `สมาชิก ${entry.memberName}` : "บุคคลทั่วไป", entry.memberNumber ?? "—", String(entry.items.length), entry.paymentMethod, entry.total.toFixed(2)]),
      totalsRow: ["รวม", "—", "—", "—", String(salesHistory.reduce((sum, entry) => sum + entry.items.length, 0)), "—", total.toFixed(2)],
      brandName: "ร้านค้าสวัสดิการ", footnote: "กดแถวบนหน้าจอเพื่อเปิดใบเสร็จฉบับเต็มได้ · รายงานนี้สร้างจากบิลที่โหลดไว้ตามตัวกรอง",
    });
    setNotice(`สั่งพิมพ์ประวัติบิลแล้ว · ${salesHistory.length} บิล`);
  };
  const txExportRows = () => [
    ["วันที่ · เวลา", "เลขสมาชิก", "ชื่อสมาชิก", "ประเภท", "รายละเอียด", "ยอด (บาท)", "คงเหลือหลังรายการ (บาท)", "เจ้าหน้าที่ผู้ทำรายการ"],
    ...txRows.map((row) => [formatLogDateTime(row.createdAt), row.memberNumber, row.memberName ?? "—", TX_TYPE_LABEL[row.type], row.detail, row.amount.toFixed(2), row.balanceAfter !== null ? row.balanceAfter.toFixed(2) : "—", row.actor ?? "ไม่ระบุ"]),
  ];
  const downloadTxCsv = () => {
    if (txRows.length === 0) { setNotice("ยังไม่มีธุรกรรมที่จะส่งออกตามตัวกรองนี้"); return; }
    const csv = "\ufeff" + txExportRows().map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = txMember ? `member-transactions-${txMember.memberNumber}.csv` : "member-transactions.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice(`ดาวน์โหลดประวัติธุรกรรม CSV แล้ว · ${txRows.length} รายการ${txMember ? ` · สมาชิก ${txMember.memberNumber}` : ""}`);
  };
  const downloadTxXlsx = () => {
    if (txRows.length === 0) { setNotice("ยังไม่มีธุรกรรมที่จะส่งออกตามตัวกรองนี้"); return; }
    const sheet = XLSX.utils.aoa_to_sheet(txExportRows().map((row) => row.map((cell, index) => ((index === 5 || index === 6) && /^-?[0-9,]+(\.[0-9]+)?$/.test(cell) ? Number(cell) : cell))));
    sheet["!cols"] = [{ wch: 19 }, { wch: 13 }, { wch: 22 }, { wch: 9 }, { wch: 38 }, { wch: 12 }, { wch: 17 }, { wch: 20 }];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "ประวัติธุรกรรม");
    XLSX.writeFile(book, txMember ? `member-transactions-${txMember.memberNumber}.xlsx` : "member-transactions.xlsx");
    setNotice(`ดาวน์โหลดประวัติธุรกรรม Excel แล้ว · ${txRows.length} รายการ${txMember ? ` · สมาชิก ${txMember.memberNumber}` : ""}`);
  };
  const downloadTxPdf = async () => {
    if (txRows.length === 0) { setNotice("ยังไม่มีธุรกรรมที่จะส่งออกตามตัวกรองนี้"); return; }
    await downloadReportPdf({
      fileName: txMember ? `member-transactions-${txMember.memberNumber}.pdf` : "member-transactions.pdf", title: "รายงานประวัติธุรกรรมสมาชิก",
      periodLabel: txMember ? `สมาชิก ${txMember.memberNumber} · สมาชิก${txMember.firstName} ${txMember.lastName}` : "ทุกสมาชิก · แสดง 300 รายการล่าสุด",
      meta: [["ชนิดธุรกรรม", txType === "all" ? "ทั้งหมด" : TX_TYPE_LABEL[txType]], ["ช่วงวันที่", txFrom || txTo ? `${txFrom || "ต้นช่วง"} → ${txTo || "ปัจจุบัน"}` : "ทั้งหมด"], ["จำนวนรายการ", `${txRows.length} รายการ`]],
      columns: ["วันที่ · เวลา", "เลขสมาชิก", "ชื่อสมาชิก", "ประเภท", "รายละเอียด", "ยอด (บาท)", "คงเหลือหลังรายการ (บาท)", "เจ้าหน้าที่ผู้ทำรายการ"], numericCols: [5, 6],
      rows: txRows.map((row) => [formatLogDateTime(row.createdAt), row.memberNumber, row.memberName ?? "—", TX_TYPE_LABEL[row.type], row.detail, row.amount.toFixed(2), row.balanceAfter !== null ? row.balanceAfter.toFixed(2) : "—", row.actor ?? "ไม่ระบุ"]),
      brandName: "ร้านค้าสวัสดิการ", footnote: "ข้อมูลจากบัญชีสมาชิกโดยตรง · ใช้จ่าย / เติมเงิน / ถอนเงิน พร้อมผู้ทำรายการทุกครั้ง",
    });
    setNotice(`ดาวน์โหลดประวัติธุรกรรม PDF แล้ว · ${txRows.length} รายการ${txMember ? ` · สมาชิก ${txMember.memberNumber}` : ""}`);
  };
  const printTxReport = () => {
    if (txRows.length === 0) { setNotice("ยังไม่มีธุรกรรมที่จะพิมพ์ตามตัวกรองนี้"); return; }
    printReportDoc({
      fileName: txMember ? `member-transactions-${txMember.memberNumber}.pdf` : "member-transactions.pdf", title: "รายงานประวัติธุรกรรมสมาชิก",
      periodLabel: txMember ? `สมาชิก ${txMember.memberNumber} · สมาชิก${txMember.firstName} ${txMember.lastName}` : "ทุกสมาชิก · แสดง 300 รายการล่าสุด",
      meta: [["ชนิดธุรกรรม", txType === "all" ? "ทั้งหมด" : TX_TYPE_LABEL[txType]], ["ช่วงวันที่", txFrom || txTo ? `${txFrom || "ต้นช่วง"} → ${txTo || "ปัจจุบัน"}` : "ทั้งหมด"], ["จำนวนรายการ", `${txRows.length} รายการ`]],
      columns: ["วันที่ · เวลา", "เลขสมาชิก", "ชื่อสมาชิก", "ประเภท", "รายละเอียด", "ยอด (บาท)", "คงเหลือหลังรายการ (บาท)", "เจ้าหน้าที่ผู้ทำรายการ"], numericCols: [5, 6],
      rows: txRows.map((row) => [formatLogDateTime(row.createdAt), row.memberNumber, row.memberName ?? "—", TX_TYPE_LABEL[row.type], row.detail, row.amount.toFixed(2), row.balanceAfter !== null ? row.balanceAfter.toFixed(2) : "—", row.actor ?? "ไม่ระบุ"]),
      brandName: "ร้านค้าสวัสดิการ", footnote: "ข้อมูลจากบัญชีสมาชิกโดยตรง · ใช้จ่าย / เติมเงิน / ถอนเงิน พร้อมผู้ทำรายการทุกครั้ง",
    });
    setNotice(`สั่งพิมพ์ประวัติธุรกรรมแล้ว · ${txRows.length} รายการ`);
  };
  const rangeLabel = dailyRows.length > 0 ? `${formatThaiDate(dailyRows[0].date)} – ${formatThaiDate(dailyRows[dailyRows.length - 1].date)}` : formatThaiDate(new Date());
  return <>
  <SectionHeader eyebrow="สรุปผลและวิเคราะห์ข้อมูล" title="รายงาน" description="สลับมุมมองทีละแท็บ — แต่ละแท็บได้พื้นที่เต็มจอ เห็นข้อมูลครบทั้งชุด ไม่ต้องอัดหลายตารางไว้ในหน้าเดียว" action={<button className="outline-button" onClick={() => { setReportTab("sales"); if (!rangeFrom && dailyRows.length > 0) { setRangeFrom(dailyRows[0].date); setRangeTo(dailyRows[dailyRows.length - 1].date); } setPeriod("กำหนดช่วงเวลา"); }}><CalendarDays size={16} /> {formatThaiDate(new Date())} <ChevronDown size={15} /></button>} /><div className="report-cards report-cards-compact"><div className="report-card"><span>ยอดขายสินค้า</span><strong>{dailyQuery.isLoading ? "…" : money(totals.revenue)}</strong><small>{totals.orders.toLocaleString("th-TH")} บิล · ช่วง{period}</small></div><div className="report-card"><span>สมาชิกใหม่ · การเปิดใช้งาน</span><strong>{membersQuery.isLoading ? "…" : memberNewThisMonth} <em className="card-unit">ราย</em></strong><small>เปิดใช้งาน {memberActiveCount} จาก {members.length} รายการ</small></div><div className="report-card"><span>ยอดเงินคงเหลือสมาชิก</span><strong>{membersQuery.isLoading ? "…" : money(memberWalletTotal)}</strong><small>บัญชีสมาชิกทั้งหมด {members.length} บัญชี</small></div><div className="report-card"><span>กำไรขั้นต้นโดยประมาณ</span><strong>{dailyQuery.isLoading ? "…" : money(totals.profit)}</strong><small className="green-text">คิดเป็น {marginPercent}% ของยอดขาย</small></div></div><div className="dash-workbench report-workbench"><div className="dash-tabbar"><button type="button" className={`dash-tab${reportTab === "sales" ? " active" : ""}`} onClick={() => setReportTab("sales")}><FileBarChart size={15} /> สรุปยอดขาย</button><button type="button" className={`dash-tab${reportTab === "bills" ? " active" : ""}`} onClick={() => setReportTab("bills")}><ReceiptText size={15} /> ประวัติบิล<i className="tab-badge neutral">{salesHistory.length}</i></button><button type="button" className={`dash-tab${reportTab === "transactions" ? " active" : ""}`} onClick={() => setReportTab("transactions")}><Activity size={15} /> ประวัติธุรกรรม{txRows.length > 0 && <i className="tab-badge neutral">{txRows.length}</i>}</button><button type="button" className={`dash-tab${reportTab === "export" ? " active" : ""}`} onClick={() => setReportTab("export")}><Download size={15} /> การส่งออกข้อมูล</button></div><div className="dash-tab-body">{reportTab === "sales" && <section className="panel" id="daily-sales-report"><div className="panel-heading"><div><h2>สรุปยอดขาย</h2><p>ช่วงข้อมูล {rangeLabel} · เลือกมุมมองรายช่วงเวลา หรือแยกตามสินค้า / ชนิดสินค้า / พนักงานขาย</p></div>{salesView === "timeline" && <div className="report-export-actions"><button className="outline-button compact" onClick={downloadDailySalesCsv}><Download size={15} /> CSV</button><button className="outline-button compact" onClick={downloadDailySalesXlsx}><FileBarChart size={15} /> Excel</button><button className="outline-button compact" onClick={downloadDailySalesPdf}><FileBarChart size={15} /> PDF</button></div>}</div><div className="report-tabs report-view-pills" role="tablist" aria-label="มุมมองรายงานยอดขาย"><button type="button" role="tab" aria-selected={salesView === "timeline"} className={salesView === "timeline" ? "active" : ""} onClick={() => setSalesView("timeline")}>ภาพรวมตามช่วงเวลา</button><button type="button" role="tab" aria-selected={salesView === "product"} className={salesView === "product" ? "active" : ""} onClick={() => setSalesView("product")}>แยกตามสินค้า</button><button type="button" role="tab" aria-selected={salesView === "category"} className={salesView === "category" ? "active" : ""} onClick={() => setSalesView("category")}>แยกตามชนิดสินค้า</button><button type="button" role="tab" aria-selected={salesView === "cashier"} className={salesView === "cashier" ? "active" : ""} onClick={() => setSalesView("cashier")}>แยกตามพนักงานขาย</button></div>{salesView === "timeline" ? <><div className="report-tabs report-period-pills">{["รายวัน", "รายสัปดาห์", "รายเดือน", "กำหนดช่วงเวลา"].map((item) => <button className={period === item ? "active" : ""} key={item} onClick={() => { if (item === "กำหนดช่วงเวลา" && !rangeFrom && dailyRows.length > 0) { setRangeFrom(dailyRows[0].date); setRangeTo(dailyRows[dailyRows.length - 1].date); } setPeriod(item); }}>{item}</button>)}</div>{period === "กำหนดช่วงเวลา" && <div className="range-picker" role="group" aria-label="กำหนดช่วงวันที่"><span>ช่วงวันที่</span><ThaiDatePicker value={rangeFrom} onChange={setRangeFrom} max={rangeTo || undefined} ariaLabel="วันเริ่มต้น" /><span className="range-sep" aria-hidden="true">→</span><ThaiDatePicker value={rangeTo} onChange={setRangeTo} min={rangeFrom || undefined} ariaLabel="วันสิ้นสุด" /><span className="range-hint">{rangeFrom && rangeTo ? `${rangeDailyRows.length} วันในช่วงที่เลือก` : "เลือกวันเริ่มต้นและวันสิ้นสุดเพื่อดูยอดขายช่วงนั้น"}</span></div>}</> : null}{salesView !== "timeline" && <div className="range-picker" role="group" aria-label="กำหนดช่วงเวลาของรายงาน"><span>ช่วงเวลา</span><ThaiDatePicker value={rangeFrom} onChange={setRangeFrom} max={rangeTo || undefined} ariaLabel="วันเริ่มต้น" /><span className="range-sep" aria-hidden="true">→</span><ThaiDatePicker value={rangeTo} onChange={setRangeTo} min={rangeFrom || undefined} ariaLabel="วันสิ้นสุด" /><span className="range-hint">{rangeFrom && rangeTo ? `${Math.round((Date.parse(`${rangeTo}T00:00:00`) - Date.parse(`${rangeFrom}T00:00:00`)) / 86_400_000) + 1} วันในช่วงที่เลือก` : "ยังไม่ได้เลือก — แสดงยอดขาย 30 วันล่าสุด"}</span>{(rangeFrom || rangeTo) && <button type="button" className="mini-button" onClick={() => { setRangeFrom(""); setRangeTo(""); }}>ล้างช่วงเวลา</button>}</div>}{salesView === "timeline" && <div className="category-report">{dailyQuery.isLoading ? <div className="table-loading"><FileBarChart size={22} /><b>กำลังโหลดรายงานยอดขาย</b><span>ดึงข้อมูล 30 วันล่าสุดจากระบบ</span></div> : dailyQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(dailyQuery.error)}</span></div> : reportRows.length === 0 ? <div className="table-loading"><FileBarChart size={22} /><b>{period === "กำหนดช่วงเวลา" ? "ไม่มีข้อมูลในช่วงที่เลือก" : "ยังไม่มีข้อมูลการขาย"}</b><span>{period === "กำหนดช่วงเวลา" ? "ปรับวันเริ่มต้น/สิ้นสุดให้ครอบคลุมวันที่มีการขาย" : "เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน"}</span></div> : <table className="report-sales-table" aria-label="สรุปยอดขายรายช่วง"><thead><tr><th>วันที่ / ช่วงเวลา</th><th className="num">บิล</th><th className="num">ชิ้น</th><th className="num">ยอดขาย</th><th className="num">ต้นทุน</th><th className="num">กำไร</th><th className="num">กำไร/ยอดขาย</th></tr></thead><tbody>{reportRows.map((row, index) => <tr key={row.label}><td><span className="row-label">{row.label}</span><span className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`} aria-hidden="true"><i style={{ width: `${Math.round((row.revenue / maxRevenue) * 100)}%` }} /></span></td><td className="num">{row.orders.toLocaleString("th-TH")}</td><td className="num">{row.items.toLocaleString("th-TH")}</td><td className="num"><strong>{money(row.revenue)}</strong></td><td className="num">{money(row.cogs)}</td><td className="num"><span className={row.profit >= 0 ? "profit-pos" : "profit-neg"}>{money(row.profit)}</span></td><td className="num">{row.revenue > 0 ? `${((row.profit / row.revenue) * 100).toFixed(1)}%` : "—"}</td></tr>)}</tbody><tfoot><tr><td>รวมทั้งช่วง · {reportRows.length} แถว</td><td className="num">{totals.orders.toLocaleString("th-TH")}</td><td className="num">{totals.items.toLocaleString("th-TH")}</td><td className="num">{money(totals.revenue)}</td><td className="num">{money(totals.cogs)}</td><td className="num">{money(totals.profit)}</td><td className="num">{marginPercent}%</td></tr></tfoot></table>}</div>}{salesView === "category" && <div className="category-report report-breakdown">{categoryQuery.isLoading ? <div className="table-loading"><ShoppingBag size={22} /><b>กำลังรวบรวมยอดขายตามชนิดสินค้า</b><span>ช่วง {effectiveFrom} → {effectiveTo}</span></div> : categoryQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(categoryQuery.error)}</span></div> : categoryRows.length === 0 ? <div className="table-loading"><ShoppingBag size={22} /><b>ยังไม่มีข้อมูลการขายในช่วงนี้</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน</span></div> : <table className="report-sales-table report-breakdown-table" aria-label="สรุปยอดขายแยกตามชนิดสินค้า"><thead><tr><th>ชนิดสินค้า</th><th className="num">บิล</th><th className="num">ชิ้น</th><th className="num">ยอดขาย</th><th className="num">ต้นทุน</th><th className="num">กำไร</th><th className="num">สัดส่วนยอดขาย</th></tr></thead><tbody>{categoryRows.map((row, index) => { const share = categoryTotal.revenue > 0 ? (row.revenue / categoryTotal.revenue) * 100 : 0; return <tr key={row.category}><td><span className="row-label">{row.category}</span><span className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`} aria-hidden="true"><i style={{ width: `${Math.round(share)}%` }} /></span></td><td className="num">{row.orders.toLocaleString("th-TH")}</td><td className="num">{row.qty.toLocaleString("th-TH")}</td><td className="num"><strong>{money(row.revenue)}</strong></td><td className="num">{money(row.cogs)}</td><td className="num"><span className={row.profit >= 0 ? "profit-pos" : "profit-neg"}>{money(row.profit)}</span></td><td className="num">{categoryTotal.revenue > 0 ? `${share.toFixed(1)}%` : "—"}</td></tr>; })}</tbody><tfoot><tr><td>รวมทุกชนิดสินค้า · {categoryRows.length} ชนิด</td><td className="num">{categoryTotal.orders.toLocaleString("th-TH")}</td><td className="num">{categoryTotal.qty.toLocaleString("th-TH")}</td><td className="num">{money(categoryTotal.revenue)}</td><td className="num">{money(categoryTotal.cogs)}</td><td className="num">{money(categoryTotal.profit)}</td><td className="num">{categoryTotal.revenue > 0 ? `${((categoryTotal.profit / categoryTotal.revenue) * 100).toFixed(1)}%` : "—"}</td></tr></tfoot></table>}</div>}{salesView === "product" && <div className="category-report report-breakdown">{productQuery.isLoading ? <div className="table-loading"><ShoppingBag size={22} /><b>กำลังรวบรวมยอดขายแยกตามสินค้ารายชิ้น</b><span>ช่วง {effectiveFrom} → {effectiveTo}</span></div> : productQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(productQuery.error)}</span></div> : productRows.length === 0 ? <div className="table-loading"><ShoppingBag size={22} /><b>ยังไม่มีข้อมูลการขายในช่วงนี้</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงานรายสินค้า</span></div> : <table className="report-sales-table report-breakdown-table" aria-label="สรุปยอดขายแยกตามสินค้า"><thead><tr><th>สินค้า</th><th className="num">บิล</th><th className="num">ชิ้น</th><th className="num">ยอดขาย</th><th className="num">ต้นทุน</th><th className="num">กำไร</th><th className="num">สัดส่วนยอดขาย</th></tr></thead><tbody>{productRows.map((row, index) => { const share = productTotal.revenue > 0 ? (row.revenue / productTotal.revenue) * 100 : 0; return <tr key={row.productId ?? `special-${index}`}><td><span className="row-label">{row.name}</span><small className="cell-sub cell-mono">{row.sku ?? row.barcode ?? "รายการพิเศษ · ไม่มีรหัส"}</small><span className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`} aria-hidden="true"><i style={{ width: `${Math.round(share)}%` }} /></span></td><td className="num">{row.bills.toLocaleString("th-TH")}</td><td className="num">{row.qty.toLocaleString("th-TH")}</td><td className="num"><strong>{money(row.revenue)}</strong></td><td className="num">{money(row.cogs)}</td><td className="num"><span className={row.profit >= 0 ? "profit-pos" : "profit-neg"}>{money(row.profit)}</span></td><td className="num">{productTotal.revenue > 0 ? `${share.toFixed(1)}%` : "—"}</td></tr>; })}</tbody><tfoot><tr><td>รวมทุกสินค้า · {productRows.length} รายการ</td><td className="num">{productTotal.bills.toLocaleString("th-TH")}</td><td className="num">{productTotal.qty.toLocaleString("th-TH")}</td><td className="num">{money(productTotal.revenue)}</td><td className="num">{money(productTotal.cogs)}</td><td className="num">{money(productTotal.profit)}</td><td className="num">{productTotal.revenue > 0 ? `${((productTotal.profit / productTotal.revenue) * 100).toFixed(1)}%` : "—"}</td></tr></tfoot></table>}</div>}{salesView === "cashier" && <div className="category-report report-breakdown">{cashierQuery.isLoading ? <div className="table-loading"><UsersRound size={22} /><b>กำลังรวบรวมยอดขายตามพนักงานขาย</b><span>ช่วง {effectiveFrom} → {effectiveTo}</span></div> : cashierQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(cashierQuery.error)}</span></div> : cashierRows.length === 0 ? <div className="table-loading"><UsersRound size={22} /><b>ยังไม่มีข้อมูลการขายในช่วงนี้</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน</span></div> : <table className="report-sales-table report-breakdown-table" aria-label="สรุปยอดขายแยกตามพนักงานขาย"><thead><tr><th>พนักงานขาย (ผู้ทำรายการ)</th><th className="num">บิล</th><th className="num">ชิ้น</th><th className="num">บิลสมาชิก</th><th className="num">ส่วนลดรวม</th><th className="num">ยอดขายรวม</th><th className="num">สัดส่วนยอดขาย</th></tr></thead><tbody>{cashierRows.map((row, index) => { const share = cashierTotal.total > 0 ? (row.total / cashierTotal.total) * 100 : 0; return <tr key={row.cashier}><td><span className="row-label">{row.cashier}</span><span className={`sales-bar ${["", "blue", "amber", "purple"][index % 4]}`} aria-hidden="true"><i style={{ width: `${Math.round(share)}%` }} /></span></td><td className="num">{row.orders.toLocaleString("th-TH")}</td><td className="num">{row.items.toLocaleString("th-TH")}</td><td className="num">{row.memberBills.toLocaleString("th-TH")}</td><td className="num">{money(row.discount)}</td><td className="num"><strong>{money(row.total)}</strong></td><td className="num">{cashierTotal.total > 0 ? `${share.toFixed(1)}%` : "—"}</td></tr>; })}</tbody><tfoot><tr><td>รวมทุกพนักงาน · {cashierRows.length} คน</td><td className="num">{cashierTotal.orders.toLocaleString("th-TH")}</td><td className="num">{cashierTotal.items.toLocaleString("th-TH")}</td><td className="num">{cashierTotal.memberBills.toLocaleString("th-TH")}</td><td className="num">{money(cashierTotal.discount)}</td><td className="num">{money(cashierTotal.total)}</td><td className="num">{cashierTotal.total > 0 ? "100%" : "—"}</td></tr></tfoot></table>}</div>}</section>}{reportTab === "bills" && <section className="panel table-panel" id="bills-history-report"><div className="table-toolbar"><div><h2>ประวัติบิล</h2><p>กดแถวเพื่อเปิดใบเสร็จย้อนหลังได้ทันที · แสดง 50 บิลล่าสุด · รวม {salesHistory.length} บิล</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={billSearch} onChange={(event) => setBillSearch(event.target.value)} placeholder="ค้นหาเลขที่บิล หรือเลขสมาชิก (คีย์/สแกนได้)" /></div><button className="outline-button compact" onClick={downloadBillsCsv}><Download size={15} /> CSV</button><button className="outline-button compact" onClick={downloadBillsXlsx}><FileBarChart size={15} /> Excel</button><button className="outline-button compact" onClick={downloadBillsPdf}><FileBarChart size={15} /> PDF</button></div></div><div className="bill-member-filter"><MemberScanPicker members={members} selectedNumber={billMember?.memberNumber ?? null} onSelect={(member) => setBillMember(member)} placeholder="กรองตามสมาชิก — คีย์เลขสมาชิก หรือยิงบาร์โค้ด" inputId="bill-member-filter-input" /></div><div className="table-filter-summary"><span><Search size={13} /> {billMember ? <>สมาชิก <b>{billMember.memberNumber} · สมาชิก{billMember.firstName} {billMember.lastName}</b> — แยกรายบิลของสมาชิกรายนี้</> : billSearch ? `ค้นหา “${billSearch}”` : "บิลล่าสุดจากระบบ"}</span><span>แสดง <b>{Math.min(billsVisible, salesHistory.length)}</b> จาก <b>{salesHistory.length}</b> บิล{billMember && ` · ยอดรวม ${money(salesHistory.slice(0, billsVisible).reduce((sum, entry) => sum + entry.total, 0))}`}</span></div><div className="table-wrap">{salesHistoryQuery.isLoading ? <div className="table-loading"><ReceiptText size={22} /><b>กำลังโหลดประวัติบิล</b><span>ดึง 50 บิลล่าสุดจากระบบ</span></div> : salesHistoryQuery.isError ? <div className="entity-state error" role="alert"><ShieldCheck size={22} /><b>โหลดประวัติบิลไม่สำเร็จ</b><span>{getErrorMessage(salesHistoryQuery.error)}</span></div> : salesHistory.length === 0 ? <div className="entity-state"><ReceiptText size={22} /><b>ไม่พบบิลตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหา</span></div> : <table className="bill-history-table" aria-label="ประวัติบิล"><thead><tr><th>เลขที่บิล</th><th>วันที่ · เวลา</th><th>ลูกค้า</th><th>รายการ</th><th>ชำระโดย</th><th className="hide-sm">พนักงานขาย</th><th className="num">ยอดรวม</th><th aria-label="เปิดใบเสร็จ" /></tr></thead><tbody>{salesHistory.slice(0, billsVisible).map((entry) => { const paymentTone = PAYMENT_PILL_TONE[entry.paymentMethod] ?? "amber"; return <tr className="clickable" key={entry.orderNumber} onClick={() => setViewedReceipt(entry)} title={`ดูใบเสร็จ ${entry.orderNumber}`}><td><b className="bill-number">{entry.orderNumber}</b></td><td><small className="cell-mono">{formatLogDateTime(entry.createdAt)}</small></td><td><b>{entry.memberName ? `สมาชิก ${entry.memberName}` : "บุคคลทั่วไป"}</b>{entry.memberNumber && <small className="cell-mono">{entry.memberNumber}</small>}</td><td><span className="bill-items-cell">{entry.items[0]?.name ?? "—"}{entry.items.length > 1 ? ` +${entry.items.length - 1} รายการ` : ""}</span></td><td><StatusPill tone={paymentTone}>{entry.paymentMethod}</StatusPill></td><td className="hide-sm"><small className="bill-cashier-cell">{entry.cashier ?? "—"}</small></td><td className="num"><strong className="bill-total-cell">{money(entry.total)}</strong></td><td><button type="button" className="row-open" onClick={() => setViewedReceipt(entry)} title={`ดูใบเสร็จ ${entry.orderNumber}`}>ใบเสร็จ <ArrowRight size={13} /></button></td></tr>; })}</tbody></table>}</div>{!salesHistoryQuery.isLoading && !salesHistoryQuery.isError && (billsVisible < salesHistory.length ? <button type="button" className="table-show-more" onClick={() => setBillsVisible((current) => current + 15)}><ChevronDown size={15} /> แสดงบิลเพิ่มอีก <b>{salesHistory.length - billsVisible}</b> บิล</button> : salesHistory.length > 15 && <div className="table-show-more done">แสดงทั้งหมด {salesHistory.length} บิลแล้ว</div>)}</section>}{reportTab === "transactions" && <section className="panel table-panel" id="tx-report"><div className="table-toolbar"><div><h2>ประวัติธุรกรรมสมาชิก</h2><p>ใช้จ่าย · เติมเงิน · ถอนเงิน พร้อมเจ้าหน้าที่ทำรายการทุกรายการ · กรองตามสมาชิก ประเภท และช่วงเวลาได้</p></div><div className="toolbar-actions"><button className="outline-button compact" onClick={downloadTxCsv}><Download size={15} /> CSV</button><button className="outline-button compact" onClick={downloadTxXlsx}><FileBarChart size={15} /> Excel</button><button className="outline-button compact" onClick={downloadTxPdf}><FileBarChart size={15} /> PDF</button></div></div><div className="tx-filter-bar"><MemberScanPicker members={members} selectedNumber={txMember?.memberNumber ?? null} onSelect={(member) => setTxMember(member)} placeholder="กรองตามสมาชิก — คีย์เลขสมาชิก หรือยิงบาร์โค้ด" inputId="tx-member-filter-input" /><div className="tx-type-pills" role="group" aria-label="กรองตามประเภทธุรกรรม">{[["all", "ทั้งหมด"], ["purchase", "ใช้จ่าย"], ["deposit", "เติมเงิน"], ["withdrawal", "ถอนเงิน"], ["limit_request", "ขอลดวงเงิน"]].map(([value, label]) => <button type="button" key={value} className={txType === value ? "active" : ""} onClick={() => setTxType(value as typeof txType)}>{label}</button>)}</div><div className="tx-date-range" role="group" aria-label="ช่วงวันที่ของธุรกรรม"><ThaiDatePicker value={txFrom} onChange={setTxFrom} max={txTo || undefined} ariaLabel="วันเริ่มต้นของธุรกรรม" /><span aria-hidden="true">→</span><ThaiDatePicker value={txTo} onChange={setTxTo} min={txFrom || undefined} ariaLabel="วันสิ้นสุดของธุรกรรม" /></div></div><div className="tx-log-strip" role="note"><WalletCards size={14} /><span>การเงินสมาชิกทั้งระบบ (จาก Log): <b className="green-text">เติมเงิน {walletTotals.depositCount} รายการ · {money(walletTotals.deposit)}</b> · <b className="amber-text">ถอนเงิน {walletTotals.withdrawCount} รายการ · {money(walletTotals.withdraw)}</b></span></div><div className="tx-summary-cards"><div><small>ใช้จ่ายรวม</small><strong className="red-text">−{money(Math.abs(txTotals.spend))}</strong><span>{txTotals.spendCount} รายการ</span></div><div><small>เติมเงินรวม</small><strong className="green-text">+{money(txTotals.deposit)}</strong><span>{txTotals.depositCount} รายการ</span></div><div><small>ถอนเงินรวม</small><strong className="amber-text">−{money(Math.abs(txTotals.withdraw))}</strong><span>{txTotals.withdrawCount} รายการ</span></div><div><small>ขอลดวงเงิน</small><strong className="purple-text">{txTotals.limitCount}</strong><span>{limitRequestsQuery.isLoading ? "…" : `รอพิจารณา ${pendingLimitCount} รายการ`}</span></div></div><div className="table-wrap">{txQuery.isLoading ? <div className="table-loading"><Activity size={22} /><b>กำลังโหลดประวัติธุรกรรม</b><span>ดึงข้อมูลจากบัญชีสมาชิกทุกรายการ</span></div> : txQuery.isError ? <div className="entity-state error" role="alert"><Activity size={22} /><b>โหลดประวัติธุรกรรมไม่สำเร็จ</b><span>{getErrorMessage(txQuery.error)}</span></div> : txRows.length === 0 ? <div className="table-loading"><Activity size={22} /><b>ไม่พบธุรกรรมตามเงื่อนไขที่เลือก</b><span>ลองเปลี่ยนตัวกรอง หรือขยายช่วงวันที่</span></div> : <table className="entity-table tx-table" aria-label="ประวัติธุรกรรมสมาชิก"><thead><tr><th>วันที่ · เวลา</th><th>สมาชิก</th><th>ประเภท</th><th className="hide-sm">รายละเอียด</th><th className="num">ยอดเคลือน</th><th className="num hide-sm">คงเหลือหลังรายการ</th><th className="hide-sm">เจ้าหน้าที่ทำรายการ</th>{isAdminRole(role) && <th>พิจารณา</th>}</tr></thead><tbody>{txRows.map((row) => { const isLimit = row.kind === "limit"; const limitStatus = LIMIT_STATUS_META[row.status ?? "pending"]; return <tr key={row.id} className={isLimit ? "tx-limit" : `tx-${row.type}`}><td><small className="cell-mono" style={{ marginTop: 0 }}>{formatLogDateTime(row.createdAt)}</small></td><td><span className="cell-strong">{row.memberName ?? "—"}</span><small className="cell-sub">{row.memberNumber}</small></td><td>{isLimit ? <span className="tx-type-cell"><StatusPill tone={TX_TYPE_TONE[row.type]}>{TX_TYPE_LABEL[row.type]}</StatusPill><StatusPill tone={limitStatus.tone}>{limitStatus.label}</StatusPill></span> : <StatusPill tone={TX_TYPE_TONE[row.type]}>{TX_TYPE_LABEL[row.type]}</StatusPill>}</td><td className="hide-sm"><span className="tx-detail">{row.detail}</span></td><td className="num">{isLimit ? <span className="tx-limit-amount">{money(row.amount)}<small>วงเงินใหม่ที่ขอ</small></span> : <span className={row.amount >= 0 ? "profit-pos" : "profit-neg"}>{row.amount >= 0 ? "+" : "−"}{money(Math.abs(row.amount))}</span>}</td><td className="num hide-sm">{row.balanceAfter !== null ? money(row.balanceAfter) : "—"}</td><td className="hide-sm"><small className="cell-sub" style={{ marginTop: 0 }}>{row.actor ?? "ไม่ระบุ"}</small></td>{isAdminRole(role) && <td>{isLimit && row.status === "pending" ? <span className="limit-act-row"><button type="button" className="limit-act limit-act-approve" disabled={decideLimitMutation.isPending} onClick={() => { setLimitError(""); setLimitDecision({ row, decision: "approve" }); }}><Check size={12} /> อนุมัติ</button><button type="button" className="limit-act limit-act-reject" disabled={decideLimitMutation.isPending} onClick={() => { setLimitError(""); setLimitDecision({ row, decision: "reject" }); }}><X size={12} /> ปฏิเสธ</button></span> : <small className="cell-sub" style={{ marginTop: 0 }}>—</small>}</td>}</tr>; })}</tbody></table>}</div><div className="session-table-note"><span>{txMember ? `สมาชิก ${txMember.memberNumber} · แสดง 300 รายการล่าสุด` : `แสดง 300 รายการล่าสุดของทุกสมาชิก`}{txFrom || txTo ? ` · ช่วง ${txFrom || "ต้นช่วง"}` : ""}{txTo ? ` → ${txTo}` : ""}</span><span>ข้อมูลจากบัญชีสมาชิกโดยตรง</span></div></section>}{reportTab === "export" && <section className="panel export-panel"><div className="panel-heading"><div><h2>การส่งออกข้อมูล</h2><p>เลือกหัวข้อเป็นแท็บ — ทุกหัวข้อครบ 4 คำสั่ง: PDF พร้อมพิมพ์ · พิมพ์ทันที · Excel · CSV</p></div><FileBarChart size={19} className="muted-icon" /></div><div className="export-topic-tabs" role="tablist" aria-label="เลือกหัวข้อที่จะส่งออก"><button type="button" role="tab" aria-selected={exportTopic === "sales"} className={exportTopic === "sales" ? "active" : ""} onClick={() => setExportTopic("sales")}><FileBarChart size={15} /> ยอดขาย<small>{reportRows.length + (salesView === "product" ? productRows.length : salesView === "category" ? categoryRows.length : salesView === "cashier" ? cashierRows.length : 0)} แถว</small></button><button type="button" role="tab" aria-selected={exportTopic === "bills"} className={exportTopic === "bills" ? "active" : ""} onClick={() => setExportTopic("bills")}><ReceiptText size={15} /> ประวัติบิล<small>{salesHistory.length} บิล</small></button><button type="button" role="tab" aria-selected={exportTopic === "transactions"} className={exportTopic === "transactions" ? "active" : ""} onClick={() => setExportTopic("transactions")}><Activity size={15} /> ธุรกรรมสมาชิก<small>{txRows.length} รายการ</small></button></div><div className="export-topic-body">{exportTopic === "sales" && <div className="export-group"><div className="export-group-head"><h3>รายงานยอดขาย</h3><small>ตามมุมมองและช่วงเวลาที่เลือกไว้ · ช่วง{rangeLabel} · มุมมอง{salesView === "timeline" ? "ภาพรวมตามช่วงเวลา" : salesView === "product" ? "แยกตามสินค้า" : salesView === "category" ? "แยกตามชนิดสินค้า" : "แยกตามพนักงานขาย"}</small></div><div className="export-row export-row-4"><button onClick={downloadDailySalesPdf}><span className="file-icon pdf">PDF</span><span><b>ดาวน์โหลด PDF</b><small>เอกสารรายงาน A4 พร้อมแถวรวม</small></span><Download size={16} /></button><button onClick={printDailySalesReport}><span className="file-icon print"><Printer size={14} /></span><span><b>สั่งพิมพ์เลย</b><small>เอกสารเดียวกัน ส่งเครื่องพิมพ์เริ่มต้น</small></span><Printer size={16} /></button><button onClick={downloadDailySalesXlsx}><span className="file-icon xls">XLS</span><span><b>Excel</b><small>หัวคอลัมน์ไทย คำนวณต่อได้</small></span><Download size={16} /></button><button onClick={downloadDailySalesCsv}><span className="file-icon csv">CSV</span><span><b>CSV</b><small>UTF-8 BOM นำเข้าระบบอื่นได้</small></span><Download size={16} /></button></div></div>}{exportTopic === "bills" && <div className="export-group"><div className="export-group-head"><h3>ประวัติบิล</h3><small>{billMember ? `สมาชิก ${billMember.memberNumber} · ` : billSearch.trim() ? `ตามคำค้น “${billSearch.trim()}” · ` : ""}{salesHistory.length} บิลที่โหลดไว้{billMember ? " · เพิ่มเป็น 200 บิลสำหรับสมาชิกรายนี้" : " · แสดงสูงสุด 50 บิลล่าสุด"}</small></div><div className="export-row export-row-4"><button onClick={downloadBillsPdf}><span className="file-icon pdf">PDF</span><span><b>ดาวน์โหลด PDF</b><small>เอกสาร A4 รายบิล พร้อมยอดรวมท้ายตาราง</small></span><Download size={16} /></button><button onClick={printBillsReport}><span className="file-icon print"><Printer size={14} /></span><span><b>สั่งพิมพ์เลย</b><small>เอกสารเดียวกัน ส่งเครื่องพิมพ์เริ่มต้น</small></span><Printer size={16} /></button><button onClick={downloadBillsXlsx}><span className="file-icon xls">XLS</span><span><b>Excel</b><small>รายบิล พร้อมวิธีชำระและยอดรวม</small></span><Download size={16} /></button><button onClick={downloadBillsCsv}><span className="file-icon csv">CSV</span><span><b>CSV</b><small>UTF-8 BOM นำเข้าระบบอื่นได้</small></span><Download size={16} /></button></div></div>}{exportTopic === "transactions" && <div className="export-group"><div className="export-group-head"><h3>ประวัติธุรกรรมสมาชิก</h3><small>ตามตัวกรองในแท็บประวัติธุรกรรม · {txRows.length} รายการ{txMember ? ` · สมาชิก ${txMember.memberNumber}` : ""}</small></div><div className="export-row export-row-4"><button onClick={downloadTxPdf}><span className="file-icon pdf">PDF</span><span><b>ดาวน์โหลด PDF</b><small>เอกสาร A4 ตามตัวกรอง พร้อมผู้ทำรายการ</small></span><Download size={16} /></button><button onClick={printTxReport}><span className="file-icon print"><Printer size={14} /></span><span><b>สั่งพิมพ์เลย</b><small>เอกสารเดียวกัน ส่งเครื่องพิมพ์เริ่มต้น</small></span><Printer size={16} /></button><button onClick={downloadTxXlsx}><span className="file-icon xls">XLS</span><span><b>Excel</b><small>หัวคอลัมน์ไทย คำนวณต่อได้</small></span><Download size={16} /></button><button onClick={downloadTxCsv}><span className="file-icon csv">CSV</span><span><b>CSV</b><small>UTF-8 BOM นำเข้าระบบอื่นได้</small></span><Download size={16} /></button></div></div>}<div className="settings-inline-note"><ShieldCheck size={16} /><span>ไฟล์ PDF และการสั่งพิมพ์เป็นเอกสารรายงาน A4 ที่สร้างใหม่จากข้อมูลที่เลือกไว้ (ไม่ใช่ภาพหน้าจอ) · Excel และ CSV สร้างจากข้อมูลตรงจากระบบ</span></div></div></section>}</div></div>{limitDecision && <div className="modal-backdrop" onClick={() => setLimitDecision(null)}><div className="confirm-modal limit-decide-modal" role="dialog" aria-modal="true" aria-label="ยืนยันการพิจารณาคำขอลดวงเงิน" onClick={(event) => event.stopPropagation()}><div className="confirm-icon"><TrendingDown size={21} /></div><div className="modal-heading"><div><h2>{limitDecision.decision === "approve" ? "ยืนยันการอนุมัติคำขอลดวงเงิน?" : "ยืนยันการปฏิเสธคำขอลดวงเงิน?"}</h2><p>ผู้พิจารณา: {userName || "ผู้ใช้ระบบ"} · ผู้บริหาร</p></div><button className="icon-button" onClick={() => setLimitDecision(null)} aria-label="ปิดหน้าต่าง"><X size={17} /></button></div><div className="wallet-confirm-rows"><div><span>สมาชิก</span><b>{limitDecision.row.memberName ?? "—"} · {limitDecision.row.memberNumber}</b></div><div><span>วงเงินปัจจุบัน</span><b>{limitDecision.row.currentLimit != null ? money(limitDecision.row.currentLimit) : "ไม่จำกัด"}</b></div><div><span>วงเงินใหม่ที่ขอ</span><b className="purple-text">{money(limitDecision.row.amount)}</b></div>{limitDecision.row.reason && <div><span>เหตุผล</span><b>{limitDecision.row.reason}</b></div>}<div><span>ผู้ยื่นคำขอ</span><b>{limitDecision.row.actor ?? "ไม่ระบุ"}</b></div></div><div className="limit-decide-note"><ShieldCheck size={15} /> {limitDecision.decision === "approve" ? `อนุมัติแล้ว วงเงินซื้อสินค้าต่อวันของสมาชิกจะถูกตั้งเป็น ${money(limitDecision.row.amount)} ทันที และบันทึกลง Log` : `ปฏิเสธแล้ว วงเงินของสมาชิกคงเดิม (${limitDecision.row.currentLimit != null ? money(limitDecision.row.currentLimit) : "ไม่จำกัด"}) · สมาชิกยื่นคำขอใหม่ได้`}</div>{limitError && <div className="notice-bar error"><ShieldCheck size={16} /> {limitError}<button onClick={() => setLimitError("")}><X size={14} /></button></div>}<div className="confirm-actions"><button className="outline-button" onClick={() => setLimitDecision(null)}>ยกเลิก</button><button className={limitDecision.decision === "approve" ? "primary-button" : "danger-button"} disabled={decideLimitMutation.isPending} onClick={confirmLimitDecision}><Check size={16} /> {decideLimitMutation.isPending ? "กำลังบันทึก…" : limitDecision.decision === "approve" ? "ยืนยันอนุมัติ" : "ยืนยันปฏิเสธ"}</button></div></div></div>}{viewedReceipt && <ReceiptModal receipt={viewedReceipt} onClose={() => setViewedReceipt(null)} mode="reprint" />}{notice && <div className="notice-bar floating-notice"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</>;
}

type SettingsTab = "brand" | "receipt" | "member" | "payment" | "cutoff" | "import" | "backup" | "network" | "display" | "alert" | "roles" | "log";

// ROUND 40 (ข้อ 32) — นำเข้าข้อมูลจาก Excel/CSV: ชนิด + ชีตที่อ่านได้ + ผลลัพธ์
type ImportKindId = "members" | "products";
type ImportSheetLite = { name: string; headerRowIndex: number; headers: string[]; sampleRows: string[][]; totalRows: number; suggestedMapping: Record<string, number> };
type ImportResultLite = { total: number; inserted: number; updated: number; skipped: number; errors: { row: number; message: string }[]; safetyBackupFile: string; fileName: string };

/** คำอธิบาย field นำเข้าสมาชิก — ลำดับตามที่แสดงบนหน้าจอ */
const MEMBER_IMPORT_FIELDS: { key: string; label: string; required?: boolean; hint?: string }[] = [
  { key: "firstName", label: "ชื่อ", required: true },
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

function Settings({ setView }: { setView: (view: View) => void }) {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const membersQuery = trpc.member.list.useQuery();
  const logsStatsQuery = trpc.logs.list.useQuery({ limit: 200 });
  const [tab, setTab] = useState<SettingsTab>("brand");
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
  const lanInfoQuery = trpc.system.lanInfo.useQuery(undefined, { enabled: tab === "network" });
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
  const backupQuery = trpc.backup.list.useQuery(undefined, { enabled: tab === "backup" });
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
  const nextNumber = formatMemberNumber(numberMode, nextMemberSequence(membersQuery.data ?? [], numberMode));
  // Round 17 — dirty-state tracking: compare the working form against the
  // server settings field by field so the sticky save bar can tell the
  // user exactly what has changed and is still unsaved (the old UI only
  // had a far-away save button in the header, which read as "settings
  // don't work" when toggles were flipped and never saved).
  const serverSettings = settingsQuery.data ?? null;
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
  const tabs: { id: SettingsTab; label: string; icon: typeof Bell }[] = [
    { id: "brand", label: "แบรนด์และธีม", icon: Palette },
    { id: "receipt", label: "ใบเสร็จและการขาย", icon: ReceiptText },
    { id: "member", label: "สมาชิกและเลขสมาชิก", icon: CreditCard },
    { id: "payment", label: "รูปแบบการชำระเงิน", icon: WalletCards },
    { id: "cutoff", label: "รอบตัดยอด", icon: CalendarClock },
    { id: "import", label: "นำเข้าข้อมูล", icon: FileSpreadsheet },
    { id: "backup", label: "สำรองข้อมูล", icon: DatabaseBackup },
    { id: "network", label: "การเชื่อมต่อ", icon: Network },
    { id: "display", label: "การแสดงผล", icon: Monitor },
    { id: "alert", label: "การแจ้งเตือน", icon: Bell },
    { id: "roles", label: "สิทธิ์และบทบาท", icon: ShieldCheck },
    { id: "log", label: "การบันทึก Log", icon: Activity },
  ];
  const logs = logsStatsQuery.data ?? [];
  const lastLog = logs[0];
  // Round 31-7 — ทดสอบเครื่องพิมพ์: สร้างสลิปตัวอย่าง แล้วส่งไปเครื่องพิมพ์เริ่มต้นของ OS
  const [printerTestOpen, setPrinterTestOpen] = useState(false);
  const testPrintReceipt = () => {
    setPrinterTestOpen(true);
    window.setTimeout(() => { window.print(); setPrinterTestOpen(false); }, 150);
  };
  // Round 31 — รอบตัดยอด: live view of the CURRENT business period so the admin
  // sees what the cut-off setting actually does before saving it.
  const periodQuery = trpc.reports.businessPeriod.useQuery(undefined, { refetchInterval: 60_000 });
  const period = periodQuery.data;
  return <><SectionHeader eyebrow="ระบบและการกำหนดค่า" title="ตั้งค่า" description="จัดการข้อมูลร้านค้า ใบเสร็จ การชำระเงิน การแจ้งเตือน และการแสดงผลของระบบ" action={<button className="primary-button" disabled={!form || saveMutation.isPending} onClick={saveSettings}><Check size={16} /> {saveMutation.isPending ? "กำลังบันทึก…" : dirtyCount > 0 ? `บันทึกการตั้งค่า · ${dirtyCount} รายการ` : "บันทึกการตั้งค่า"}</button>} /><div className="settings-layout"><div className="settings-nav" role="tablist" aria-label="หมวดการตั้งค่า">{tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={17} /> {label}</button>)}</div><div className="settings-content">{tab === "brand" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>ชื่อร้านและโลโก้</h2><p>ชื่อและโลโก้จะแสดงบนหน้าจอ แถบเมนู หน้าเข้าสู่ระบบ และหัวใบเสร็จ</p></div><Palette size={20} className="muted-icon" /></div><div className="form-grid"><label className="wide">ชื่อแอป / ร้านค้า<input value={form?.appName ?? ""} onChange={(event) => updateForm({ appName: event.target.value })} placeholder="เช่น ร้านค้าสวัสดิการ" disabled={!form} maxLength={80} /></label><label className="wide">โลโก้ร้านค้า<div className="logo-uploader">{form?.appLogo ? <img className="logo-preview" src={form.appLogo} alt="โลโก้ปัจจุบัน" /> : <span className="logo-empty"><ImageIcon size={20} /></span>}<div className="logo-actions"><div className="logo-button-row"><button type="button" className="outline-button compact" disabled={!form} onClick={() => logoInputRef.current?.click()}><ImagePlus size={15} /> {form?.appLogo ? "เปลี่ยนรูป" : "เลือกรูปโลโก้"}</button>{form?.appLogo && <button type="button" className="danger-outline-button compact" disabled={!form} onClick={() => updateForm({ appLogo: "" })}><Trash2 size={15} /> ลบโลโก้</button>}</div><small>รองรับ PNG JPG WEBP SVG · ระบบย่อเป็น 256px อัตโนมัติ · ไม่ใส่ก็ได้ จะใช้อักษรย่อแทน</small></div><input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={onLogoPick} /></div></label></div><div className="brand-live-preview" aria-label="ตัวอย่างหน้าจอ"><span className="eyebrow">ตัวอย่างการแสดงผล</span><div className="brand-preview-card">{(form?.appLogo ?? "") ? <img src={form?.appLogo ?? ""} alt="" /> : <div className="brand-mark"><span>{brandInitial(form?.appName || "ร้านค้าสวัสดิการ")}</span></div>}<div><b>{(form?.appName ?? "").trim() || "ร้านค้าสวัสดิการ"}</b><small>Welfare Store</small></div></div></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>สีธีมของแอป</h2><p>สีหลักของระบบ — ปุ่ม แถบเมนู จุดเน้นทั้งแอป · เห็นพรีวิวทันที กดบันทึกเพื่อใช้กับทุกเครื่อง</p></div><Palette size={20} className="muted-icon" /></div><div className="theme-swatches">{THEME_PRESETS.map((preset) => <button type="button" key={preset.id} className={`theme-swatch${(form?.appTheme ?? "") === preset.id ? " active" : ""}`} onClick={() => chooseTheme(preset.id)}><span className="swatch-dot" style={{ background: preset.base }} /><b>{preset.label}</b><small>{preset.base.toUpperCase()}</small></button>)}</div><div className="theme-custom-row"><span>สีกำหนดเอง</span><input type="color" value={customThemeHex} onChange={(event) => chooseTheme(event.target.value)} aria-label="เลือกสีธีมกำหนดเอง" /><code>{customThemeHex.toUpperCase()}</code><small>เลือกจากพาเลตต์ด้านบน หรือกำหนดโค้ดสีเอง</small></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>สไตล์หน้าตาแอป (Design Style)</h2><p>บุคลิกการออกแบบทั้งระบบ — ฟอนต์ ความมนของปุ่ม พื้นหลัง · เลือกแล้วเห็นทันทีบนหน้าจอนี้ กดบันทึกเพื่อใช้กับทุกเครื่อง</p></div><Sparkles size={20} className="muted-icon" /></div><div className="ui-style-grid">{UI_STYLE_PRESETS.map((style) => <button type="button" key={style.id} className={`ui-style-card${(form?.appStyle ?? "shop") === style.id ? " active" : ""}`} onClick={() => chooseStyle(style.id)} disabled={!form} aria-pressed={(form?.appStyle ?? "shop") === style.id}><span className="ui-style-preview" data-preview={style.id} aria-hidden="true"><i className="pv-side" /><span className="pv-body"><b className="pv-title" /><b className="pv-chip" /><b className="pv-btn" /></span></span><b>{style.label}</b><small>{style.detail}</small><small className="style-font-hint">ฟอนต์: {style.fontFamily}</small></button>)}</div><div className="settings-inline-note style-note-row"><Sparkles size={16} /><span>สไตล์จะพาสีเน้นของแพลตฟอร์มนั้นมาด้วย (เช่น Apple = น้ำเงิน) — ปรับสีเน้นแยกได้ที่พาเลตต์ด้านบน · กลับ “ร้านค้า” = คืนเขียวมรกตมาตรฐาน</span></div></section></>}{tab === "receipt" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>ข้อมูลร้านค้า</h2><p>ข้อมูลจะแสดงบนหัวใบเสร็จและรายงาน</p></div><ShoppingBag size={20} className="muted-icon" /></div><div className="form-grid"><label>ชื่อร้านค้า<input value={form?.storeName ?? ""} onChange={(event) => updateForm({ storeName: event.target.value })} placeholder="ชื่อร้านค้า" disabled={!form} /></label><label>รหัสร้านค้า<input value={form?.storeCode ?? ""} onChange={(event) => updateForm({ storeCode: event.target.value })} placeholder="รหัสร้านค้า" disabled={!form} /></label><label className="wide">ที่อยู่<input value={form?.storeAddress ?? ""} onChange={(event) => updateForm({ storeAddress: event.target.value })} placeholder="ที่อยู่" disabled={!form} /></label></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ใบเสร็จรับเงิน</h2><p>กำหนดรายละเอียดที่ต้องการแสดงบนใบเสร็จ</p></div><ReceiptText size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน</b><small>ชำระเงินสำเร็จแล้วส่งสั่งพิมพ์ทันที ที่เครื่องพิมพ์เริ่มต้นของเครื่องนี้ — ไม่ต้องเลือกเครื่องพิมพ์ใหม่ทุกครั้ง</small></div><button className={`toggle ${form?.autoPrintReceipt ? "on" : ""}`} onClick={() => updateForm({ autoPrintReceipt: !form?.autoPrintReceipt })} disabled={!form} aria-label="พิมพ์ใบเสร็จอัตโนมัติ"><span /></button></div><div className="toggle-row"><div><b>แสดงยอดคงเหลือสมาชิกบนใบเสร็จ</b><small>แสดงยอดคงเหลือล่าสุดของสมาชิก บนทุกใบเสร็จที่ระบุสมาชิก (ทุกวิธีชำระ) พร้อมชื่อผู้ทำรายการเสมอ</small></div><button className={`toggle ${form?.showBalanceOnReceipt ? "on" : ""}`} onClick={() => updateForm({ showBalanceOnReceipt: !form?.showBalanceOnReceipt })} disabled={!form} aria-label="แสดงยอดคงเหลือบนใบเสร็จ"><span /></button></div></section><section className="panel settings-card printer-card"><div className="settings-heading"><div><h2>เครื่องพิมพ์หน้าร้าน</h2><p>ระบบส่งงานพิมพ์ทันทีที่กดยืนยัน — ที่เครื่องพิมพ์เริ่มต้นของเครื่องนี้โดยตรง</p></div><Printer size={20} className="muted-icon" /></div><div className="printer-flow-steps"><div className="printer-step"><b>1</b><div><b>ตั้งเครื่องพิมพ์เริ่มต้นที่เครื่องคอมพิวเตอร์</b><small>Windows: การตั้งค่า → อุปกรณ์ → เครื่องพิมพ์และสแกนเนอร์ → กด “ตั้งเป็นค่าเริ่มต้น” · macOS: การตั้งค่าระบบ → เครื่องพิมพ์และสแกนเนอร์ → เครื่องพิมพ์เริ่มต้น · ตั้งครั้งเดียว ทุกใบเสร็จ/สลิป/บัตรจะวิ่งไปเครื่องนี้</small></div></div><div className="printer-step"><b>2</b><div><b>เปิด “พิมพ์ใบเสร็จอัตโนมัติ” (ด้านบน)</b><small>เมื่อกดยืนยันชำระเงินสำเร็จ ระบบเปิดสั่งพิมพ์ให้ทันที — หน้าต่างพิมพ์จะเลือกเครื่องพิมพ์เริ่มต้นไว้ให้แล้ว กดสั่งพิมพ์ได้เลยไม่ต้องเลือกใหม่</small></div></div><div className="printer-step"><b>3</b><div><b>อยากให้พิมพ์เงียบ ๆ ไม่ต้องกด</b><small>เปิด Chrome ด้วยคำสั่ง --kiosk-printing (เมนู Start → Chrome → Properties → เพิ่มท้าย Target) — สลิปจะออกจากเครื่องพิมพ์ทันทีที่ยืนยัน ไม่มีหน้าต่าง · ตั้งครั้งเดียวโดยผู้ดูแลระบบ</small></div></div></div><div className="paper-width-block"><div className="paper-width-head"><b>ขนาดกระดาษสลิปของเครื่องพิมพ์</b><small>เลือกตามความกว้างกระดาษจริงในเครื่องพิมพ์หน้าร้าน — ใบเสร็จ สลิปเติม/ถอนเงิน และสลิปทดสอบจะจัดหน้าตามขนาดนี้เวลาพิมพ์ (หน้าจอยังเหมือนเดิม) · เลือกแล้วลอง “พิมพ์ทดสอบ” ได้เลยก่อนบันทึก</small></div><div className="number-mode-grid paper-width-grid">{PAPER_WIDTHS.map((option) => <button className={paperWidth === option.id ? "selected" : ""} key={option.id} onClick={() => updateForm({ receiptPaperWidth: option.id })} disabled={!form} aria-pressed={paperWidth === option.id} title={`พิมพ์สลิปกว้าง ${option.label}`}><span className="number-radio">{paperWidth === option.id && <i />}</span><span><b>{option.label}</b><small>{option.detail}</small></span></button>)}</div></div><div className="printer-test-row"><div><b>ทดสอบการพิมพ์</b><small>พิมพ์สลิปตัวอย่างส่งไปเครื่องพิมพ์เริ่มต้น เช็คกระดาษ/หมึก/ความชัดก่อนเปิดร้าน</small></div><button type="button" className="outline-button" onClick={testPrintReceipt}><Printer size={16} /> พิมพ์ทดสอบ</button></div><div className="printer-tips"><span className="eyebrow">ขนาดกระดาษที่ระบบออกแบบไว้</span><div className="printer-tip-pills"><span>ใบเสร็จ / สลิปเติม–ถอน / สรุปรอบตัดยอด · เลือกได้ด้านบน (58–80 มม.)</span><span>บัตรสมาชิก · 85.6 × 54 มม. (CR80)</span><span>รายงาน PDF · A4</span></div></div>{printerTestOpen && <div className="receipt-paper printer-test-slip" id="printer-test-slip"><div className="receipt-brand"><div className="brand-mark small"><span>ส</span></div><div><b>{form?.storeName || "ร้านค้าสวัสดิการ"}</b><small>ทดสอบการพิมพ์</small></div></div><div className="receipt-divider" /><div className="receipt-meta"><span>สลิปทดสอบเครื่องพิมพ์</span><b>{formatThaiDate(new Date())}</b></div><div className="receipt-line"><span>ตัวอักษรไทย</span><b>กขคง ๑๒๓</b></div><div className="receipt-line"><span>ตัวเลข</span><b>฿1,234.56</b></div><div className="receipt-total"><span>ถ้าอ่านชัดทุกบรรทัด</span><b>เครื่องพิมพ์พร้อม</b></div><div className="receipt-thanks">สลิปนี้พิมพ์จากเครื่องพิมพ์เริ่มต้นของเครื่อง<br /><small>ปรับกระดาษหรือหัวพิมพ์ถ้าตัวอักษรจาง</small></div></div>}</section><section className="panel settings-card windows-card"><div className="settings-heading"><div><h2>ติดตั้งบน Windows 11</h2><p>ร้านใช้ Windows — ติดตั้งระบบที่เครื่องหน้าร้านให้เหมือนโปรแกรมปกติ + แผนแอปเดสก์ท็อป (Tauri)</p></div><Monitor size={20} className="muted-icon" /></div><div className="printer-flow-steps"><div className="printer-step"><b>1</b><div><b>ติดตั้งเป็นแอปบนเดสก์ท็อป (ใช้ได้วันนี้)</b><small>เปิดระบบด้วย Chrome หรือ Edge → เมนู ⋮ มุมขวาบน → “ติดตั้งแอป” (หรือ “สร้างทางลัด” บน Edge) → ติดตั้ง — ไอคอนขึ้นบนเดสก์ท็อปและ Start เหมือนโปรแกรมทั่วไป เปิดเต็มจอ ไม่มีแถบที่อยู่ ปิดเปิดเร็ว · ทำทีละเครื่องของจุดขาย</small></div></div><div className="printer-step"><b>2</b><div><b>เสียบเครื่องพิมพ์สลิปแล้วทดสอบ</b><small>ติดตั้งไดรเวอร์ตามแผ่น/ลิงก์ที่มาพร้อมเครื่องพิมพ์ → ตั้งเป็นเครื่องพิมพ์เริ่มต้น (ขั้นตอน 1 ด้านบน) → เลือกขนาดกระดาษด้านบนให้ตรงกับกระดาษจริง → กด “พิมพ์ทดสอบ” เพื่อเช็คว่าตัวอักษรไทยชัดทุกบรรทัด</small></div></div><div className="printer-step"><b>3</b><div><b>ต่อยอดเป็นโปรแกรม .exe แท้ (แผน Tauri)</b><small>ขั้นถัดไปเราจะแพ็กระบบเป็นไฟล์ติดตั้ง Windows ไฟล์เดียว (~10-20MB ใช้ WebView2 ที่มีใน Win 11 แล้ว) — ติดตั้งง่ายและสั่งพิมพ์สลิปแบบเงียบ (ESC/POS) ได้เลย ไม่ต้องผ่านหน้าต่างพิมพ์ของเบราว์เซอร์ บิลออกเร็วขึ้น</small></div></div></div><div className="initial-balance-note"><ShieldCheck size={15} /><span>ทั้ง 3 ขั้นใช้ข้อมูลชุดเดิมทั้งหมด — ไม่ต้องย้ายข้อมูลหรือตั้งค่าใหม่แม้แต่รายการเดียว</span></div></section></>}{tab === "member" && <div className="settings-single"><section className="panel settings-card"><div className="settings-heading"><div><h2>การกำหนดหมายเลขสมาชิก</h2><p>เลือกวิธีสร้างหมายเลขสำหรับสมาชิกใหม่ที่จะลงทะเบียน</p></div><CreditCard size={20} className="muted-icon" /></div><div className="number-mode-grid">{[["running", "รันเลขต่อเนื่อง", "M-000001, M-000002, ..."], ["year", "ขึ้นต้นด้วยปี", "69-00001, 69-00002, ..."], ["manual", "กำหนดเอง", "เจ้าหน้าที่กรอกหมายเลขเอง"]].map(([value, title, detail]) => <button className={numberMode === value ? "selected" : ""} key={value} onClick={() => updateForm({ memberNumberMode: value as SettingsForm["memberNumberMode"] })} disabled={!form}><span className="number-radio">{numberMode === value && <i />}</span><span><b>{title}</b><small>{detail}</small></span></button>)}</div><div className="number-preview"><span>ตัวอย่างสมาชิกถัดไป</span><b>{nextNumber}</b></div></section></div>}{tab === "payment" && <div className="settings-single"><section className="panel settings-card"><div className="settings-heading"><div><h2>รูปแบบการชำระเงินที่รองรับ</h2><p>วิธีชำระเงินที่เจ้าหน้าที่สามารถใช้ได้ที่หน้าร้าน / POS</p></div><WalletCards size={20} className="muted-icon" /></div><div className="payment-method-list"><div className="payment-method-row"><span className="pay-icon cash"><WalletCards size={19} /></span><div><b>เงินสด</b><small>รับเงินสดที่เคาน์เตอร์ · เหมาะกับบุคคลทั่วไปที่ไม่ได้เป็นสมาชิก</small></div><StatusPill tone="green">ใช้งานได้</StatusPill></div><div className="payment-method-row"><span className="pay-icon qr"><CreditCard size={19} /></span><div><b>QR / สแกน</b><small>ลูกค้าสแกนจ่ายผ่านแอปธนาคาร แล้วเจ้าหน้าที่กดยืนยันบิล</small></div><StatusPill tone="blue">ใช้งานได้</StatusPill></div><div className="payment-method-row"><span className="pay-icon member"><UsersRound size={19} /></span><div><b>หักบัญชีสมาชิก</b><small>หักยอดจากบัญชีสวัสดิการทันที · ต้องเลือกสมาชิกในบิลก่อนกดชำระ และสมาชิกต้องไม่ถูกระงับ</small></div><StatusPill tone="purple">ใช้งานได้</StatusPill></div></div><div className="settings-inline-note"><ShieldCheck size={16} /><span>การเติมเงินและถอนเงินสมาชิก ทำที่หน้าร้านผ่านทางลัด F2 / F3 · สมาชิกใช้จ่ายที่เคาน์เตอร์ด้วยหมายเลขสมาชิกเท่านั้น</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("pos")}><ArrowRight size={16} /> ไปที่หน้าร้าน / POS</button></div></section></div>}{tab === "cutoff" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>รอบตัดยอดประจำวัน</h2><p>กำหนดว่าสรุปยอดขายและธุรกรรมของ “หนึ่งวัน” จะถูกตัดเมื่อไร — ให้ระบบตัดให้เองตามเวลา หรือให้เจ้าหน้าที่กดตัดยอดเอง</p></div><CalendarClock size={20} className="muted-icon" /></div><div className="number-mode-grid">{[["auto", "ระบบตัดยอดให้อัตโนมัติ", `รอบวิ่งตามเวลาที่กำหนด เช่น ${(form?.dailyCutOffTime ?? "00:00")} ทุกวัน`], ["manual", "เจ้าหน้าที่ตัดยอดเอง", "กดปุ่ม “ตัดยอดรอบนี้” ที่หน้าภาพรวมเมื่อพร้อม"]].map(([value, title, detail]) => <button className={(form?.dailyCutOffMode ?? "auto") === value ? "selected" : ""} key={value} onClick={() => updateForm({ dailyCutOffMode: value as SettingsForm["dailyCutOffMode"] })} disabled={!form}><span className="number-radio">{(form?.dailyCutOffMode ?? "auto") === value && <i />}</span><span><b>{title}</b><small>{detail}</small></span></button>)}</div>{(form?.dailyCutOffMode ?? "auto") === "auto" && <div className="cutoff-time-row"><label>เวลาตัดยอดของรอบอัตโนมัติ<input type="time" value={form?.dailyCutOffTime ?? "00:00"} onChange={(event) => updateForm({ dailyCutOffTime: event.target.value })} disabled={!form} aria-label="เวลาตัดยอด (ชั่วโมง:นาที)" /></label><div className="cutoff-time-hint"><CalendarClock size={15} /><span>รอบการขาย 1 วัน จะเริ่ม–จบตามเวลานี้ เช่น 02:00 = รอบวิ่ง 02:00 ของวันนี้ ถึง 02:00 ของวันถัดไป · เหมาะกับร้านที่ปิดหลังเที่ยงคืน แล้วให้ยอดข้ามคืนไปรวมกับวันเดียวกัน</span></div></div>}</section><section className="panel settings-card"><div className="settings-heading"><div><h2>รอบปัจจุบัน (สดจากระบบ)</h2><p>ตามการตั้งค่าที่บันทึกไว้ในขณะนี้ — ไม่ใช่ค่าที่ยังแก้ไม่ได้บันทึก</p></div><Activity size={20} className="muted-icon" /></div>{periodQuery.isLoading ? <div className="cutoff-period-loading">กำลังโหลดข้อมูลรอบปัจจุบัน…</div> : period ? <div className="cutoff-period"><div className="cutoff-period-head"><StatusPill tone={period.mode === "auto" ? "blue" : "purple"}>{period.mode === "auto" ? `ระบบตัดอัตโนมัติ · ${period.cutOffTime} ทุกวัน` : "เจ้าหน้าที่ตัดยอดเอง"}</StatusPill><small>รอบเริ่ม {formatLogDateTime(period.periodStart)}{period.nextCutOffAt ? ` · รอบถัดไป ${formatLogDateTime(period.nextCutOffAt)}` : ""}</small></div><div className="cutoff-period-stats"><div><small>บิลในรอบ</small><strong>{period.totals.bills.toLocaleString("th-TH")}</strong></div><div><small>ชิ้นที่ขาย</small><strong>{period.totals.pieces.toLocaleString("th-TH")}</strong></div><div><small>ยอดขายรอบนี้</small><strong>{money(period.totals.revenue)}</strong></div><div><small>เงินสด / QR</small><strong>{money(period.totals.cashTotal)} / {money(period.totals.qrTotal)}</strong></div><div><small>หักบัญชีสมาชิก</small><strong>{money(period.totals.walletTotal)}</strong></div><div><small>เติม / ถอน</small><strong>{money(period.totals.deposits)} / {money(period.totals.withdrawals)}</strong></div></div>{period.lastClosure && <div className="cutoff-last"><CalendarDays size={15} /><div><b>ตัดยอดล่าสุด {formatLogDateTime(period.lastClosure.closedAt)}</b><small>โดย {period.lastClosure.closedBy ?? "—"} · รอบ {formatLogDateTime(period.lastClosure.periodStart)} → {formatLogDateTime(period.lastClosure.closedAt)} · {period.lastClosure.bills} บิล · {money(period.lastClosure.revenue)}</small></div></div>}<div className="settings-inline-note"><ShieldCheck size={16} /><span>ปุ่ม “ตัดยอดรอบนี้” อยู่ที่หน้าภาพรวม — ทั้งเจ้าหน้าที่และผู้บริหารกดได้ · ทุกครั้งที่ตัดยอด ระบบสร้างสรุปรอบใหม่และบันทึกลง Log ทันที</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("dashboard")}><ArrowRight size={16} /> ไปที่หน้าภาพรวมเพื่อตัดยอด</button></div></div> : <div className="cutoff-period-loading">ยังไม่มีข้อมูลรอบปัจจุบัน</div>}</section></>}{tab === "import" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>นำเข้าข้อมูลจากไฟล์ Excel / CSV</h2><p>ขึ้นข้อมูลจริงจากไฟล์ที่ร้านมีอยู่ — ระบบอ่านหัวตารางให้ จับคู่คอลัมน์ให้อัตโนมัติ และสำรองข้อมูลเป็นไฟล์ป้องกันก่อนนำเข้าทุกครั้ง</p></div><FileSpreadsheet size={20} className="muted-icon" /></div><div className="import-kind-grid">{[["members", "สมาชิกและยอดเงิน", "เลขสมาชิก · ชื่อ-นามสกุล · ยอดคงเหลือ · วงเงิน · สถานะ · เบอร์โทร", <UsersRound size={19} key="icon-m" />], ["products", "สินค้าและสต็อก", "บาร์โค้ด · ชื่อสินค้า · หมวด · หน่วย · ราคา · ต้นทุน · สต็อก · จุดสั่งซื้อ", <ShoppingBag size={19} key="icon-p" />]].map(([value, title, detail, icon]) => <button type="button" key={String(value)} className={`import-kind-card${importKind === value ? " selected" : ""}`} onClick={() => changeImportKind(value as ImportKindId)} aria-pressed={importKind === value}><span className="import-kind-icon">{icon}</span><span><b>{String(title)}</b><small>{String(detail)}</small></span></button>)}</div><div className="import-template-row"><div><b>ยังไม่มีไฟล์ หรือจะเริ่มจากต้นแบบ?</b><small>ดาวน์โหลดเทมเพลต .xlsx ที่หัวคอลัมน์ภาษาไทยตรงกับระบบ — กรอกเสร็จแล้วกลับมาอัปโหลดที่นี่ได้เลย</small></div><button type="button" className="outline-button" disabled={importTemplateMutation.isPending} onClick={() => importTemplateMutation.mutate({ kind: importKind })}><FileSpreadsheet size={16} /> {importTemplateMutation.isPending ? "กำลังสร้างไฟล์…" : "ดาวน์โหลดเทมเพลต .xlsx"}</button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>อัปโหลดไฟล์ข้อมูล</h2><p>รองรับ .xlsx .xls .csv · ขนาดไม่เกิน 5MB · ไฟล์จะถูกอ่านเพื่อพรีวิวก่อนเสมอ — ยังไม่แตะข้อมูลจริงจนกว่าจะกดยืนยัน</p></div><FileUp size={20} className="muted-icon" /></div>{!importFile ? <div className="import-dropzone" role="button" tabIndex={0} aria-label="เลือกหรือลากไฟล์ Excel มาวางเพื่ออัปโหลด" onClick={() => importInputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); importInputRef.current?.click(); } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); startImportFile(event.dataTransfer.files?.[0]); }}><FileSpreadsheet size={30} /><b>คลิกเลือกไฟล์ หรือลากไฟล์มาวางที่นี่</b><small>{importKind === "members" ? "ไฟล์รายชื่อสมาชิก เช่น รายชื่อสมาชิก.xlsx · สมาชิก.csv" : "ไฟล์รายการสินค้า เช่น สินค้าทั้งหมด.xlsx · คลังสินค้า.csv"}</small><span className="import-drop-hint">ระบบจะอ่านหัวตารางและจับคู่คอลัมน์ให้อัตโนมัติ</span></div> : <div className="import-file-info"><span className="import-file-icon"><FileSpreadsheet size={19} /></span><div><b>{importFile.name}</b><small>{currentSheet ? `อ่านแล้ว · ${currentSheet.totalRows.toLocaleString("th-TH")} แถว · ${(Math.max(1, Math.round((importFile.base64.length * 3) / 4 / 1024))).toLocaleString("th-TH")} KB` : importPreviewMutation.isPending ? "กำลังอ่านไฟล์…" : "อ่านไฟล์แล้ว"}</small></div><div className="import-file-actions"><button type="button" className="outline-button compact" onClick={() => importInputRef.current?.click()}><FileUp size={14} /> เปลี่ยนไฟล์</button><button type="button" className="danger-outline-button compact" onClick={resetImportFlow}><X size={14} /> ล้าง</button></div></div>}{importPreviewMutation.isPending && <div className="import-reading-row"><span className="mini-spinner" aria-hidden="true" /> กำลังอ่านไฟล์และจับคู่คอลัมน์…</div>}<input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => { startImportFile(event.target.files?.[0]); event.target.value = ""; }} /></section>{currentSheet && importFile && <section className="panel settings-card"><div className="settings-heading"><div><h2>ตรวจสอบการจับคู่คอลัมน์</h2><p>ระบบเดาให้แล้วจากชื่อหัวตาราง — ตรวจทานและปรับได้ก่อนนำเข้า · คอลัมน์หนึ่งใช้กับข้อมูลชนิดเดียว</p></div><Table2 size={20} className="muted-icon" /></div><div className="import-preview-controls">{(importSheets ?? []).length > 1 && <label>ชีต<select value={importSheetIndex} onChange={(event) => changeImportSheet(Number(event.target.value))}>{(importSheets ?? []).map((sheet, index) => <option key={sheet.name} value={index}>{sheet.name} ({sheet.totalRows.toLocaleString("th-TH")} แถว)</option>)}</select></label>}<label>แถวหัวตารางอยู่แถวที่<select value={importHeaderRow} onChange={(event) => changeImportHeaderRow(Number(event.target.value))}>{[0, 1, 2, 3, 4].map((row) => <option key={row} value={row}>{row + 1}</option>)}</select></label><span className="import-row-count"><b>{currentSheet.totalRows.toLocaleString("th-TH")}</b> แถวข้อมูล จะนำเข้า</span></div><div className="import-mapping-grid">{importFields.map((field) => <label key={field.key} className={field.required && (importMapping[field.key] ?? -1) < 0 ? "import-field missing" : "import-field"}><span>{field.label}{field.required ? " *" : ""}</span><select value={importMapping[field.key] ?? -1} onChange={(event) => setMappingField(field.key, Number(event.target.value))} aria-label={`คอลัมน์สำหรับ ${field.label}`}><option value={-1}>— ไม่นำเข้า —</option>{currentSheet.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>คอลัมน์ {importColumnLabel(index)} · {header}</option>)}</select>{field.hint && <small>{field.hint}</small>}</label>)}</div><div className="import-sample-block"><div className="import-sample-head"><Table2 size={15} /> ตัวอย่าง 8 แถวแรกจากไฟล์ <span>ตรวจว่าคอลัมน์ที่จับคู่มีข้อมูลถูกชนิด</span></div><div className="import-sample-table"><table><thead><tr>{currentSheet.headers.map((header, index) => <th key={`${header}-${index}`} className={(Object.values(importMapping).includes(index)) ? "mapped" : ""} title={header}>{importColumnLabel(index)}<span>{header}</span></th>)}</tr></thead><tbody>{currentSheet.sampleRows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell === "" ? <i className="import-blank">ว่าง</i> : cell}</td>)}</tr>)}</tbody></table></div></div><div className="import-duplicate-row"><div><b>รายการที่ซ้ำกับข้อมูลในระบบ</b><small>{importKind === "members" ? "ตรวจซ้ำจากเลขสมาชิก — ไม่กรอกเลขสมาชิก = สร้างเป็นสมาชิกใหม่เสมอ" : "ตรวจซ้ำจากบาร์โค้ด → รหัสสินค้า → ชื่อสินค้า"}</small></div><div className="import-duplicate-options" role="radiogroup" aria-label="วิธีจัดการรายการซ้ำ">{[["skip", "ข้ามรายการซ้ำ", "เห็นว่ามีแล้ว ไม่แตะข้อมูลเดิม (ปลอดภัยสุด)"], ["replace", "อัปเดตข้อมูลที่ซ้ำ", "เอาข้อมูลใหม่จากไฟล์ทับรายการเดิมในระบบ"]].map(([value, title, detail]) => <button type="button" key={value} role="radio" aria-checked={duplicateMode === value} className={duplicateMode === value ? "selected" : ""} onClick={() => setDuplicateMode(value as "skip" | "replace")}><span className="number-radio">{duplicateMode === value && <i />}</span><span><b>{title}</b><small>{detail}</small></span></button>)}</div></div><div className="import-run-row"><div><b>พร้อมนำเข้า {currentSheet.totalRows.toLocaleString("th-TH")} แถว</b><small>ระบบสำรองข้อมูลทั้งระบบเป็นไฟล์ป้องกันก่อนนำเข้าเสมอ — หาผลไม่ตามที่คิด กู้คืนกลับได้ที่แท็บสำรองข้อมูล</small></div><button type="button" className="primary-button" disabled={importExecuteMutation.isPending || (importMapping[importFields.find((f) => f.required)?.key ?? ""] ?? -1) < 0} onClick={() => setImportConfirm(true)}><Check size={16} /> {importExecuteMutation.isPending ? "กำลังนำเข้า…" : "นำเข้าข้อมูล"}</button></div></section>}{importResult && <section className="panel settings-card import-result-card"><div className="settings-heading"><div><h2>ผลการนำเข้า</h2><p>จากไฟล์ {importResult.fileName} · บันทึกลงระบบเรียบร้อยแล้ว</p></div><Check size={20} className="muted-icon" /></div><div className="import-result-stats"><div className="ok"><small>เพิ่มใหม่</small><strong>{importResult.inserted.toLocaleString("th-TH")}</strong></div><div className="ok"><small>อัปเดต</small><strong>{importResult.updated.toLocaleString("th-TH")}</strong></div><div><small>ข้าม</small><strong>{importResult.skipped.toLocaleString("th-TH")}</strong></div><div className={importResult.errors.length > 0 ? "bad" : ""}><small>ผิดพลาด</small><strong>{importResult.errors.length.toLocaleString("th-TH")}</strong></div></div>{importResult.errors.length > 0 && <div className="import-error-list"><div className="import-error-head">แถวที่นำเข้าไม่สำเร็จ (แสดงไม่เกิน 20 แถวแรก)</div>{importResult.errors.slice(0, 20).map((rowError) => <div className="import-error-row" key={rowError.row}><b>แถว {rowError.row}</b><span>{rowError.message}</span></div>)}{importResult.errors.length > 20 && <div className="import-error-row more">และอีก {importResult.errors.length - 20} แถว — แก้ไขในไฟล์แล้วนำเข้าเฉพาะแถวที่เหลืออีกครั้งได้</div>}</div>}<div className="settings-inline-note"><DatabaseBackup size={16} /><span>ไฟล์ป้องกันก่อนนำเข้า: <b>{importResult.safetyBackupFile}</b> — หากผลไม่ต้องการ ไปที่แท็บ “สำรองข้อมูล” แล้วกู้คืนไฟล์นี้ได้ทันที</span></div><div className="import-result-actions"><button type="button" className="outline-button" onClick={() => { resetImportFlow(); importInputRef.current?.click(); }}><FileUp size={16} /> นำเข้าไฟล์อื่นต่อ</button><button type="button" className="outline-button" onClick={() => setView(importKind === "members" ? "members" : "stock")}><ArrowRight size={16} /> ไปดู{importKind === "members" ? "ข้อมูลสมาชิก" : "สต็อกสินค้า"}</button></div></section>}</>}{tab === "backup" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>สำรองข้อมูลด้วยตนเอง (Manual)</h2><p>กดปุ่มเดียวจบ — ได้ไฟล์สำรองข้อมูลร้านทั้งหมดตรวจสอบความถูกต้องแล้ว</p></div><HardDriveDownload size={20} className="muted-icon" /></div><div className="backup-now-row"><div><b>สำรองข้อมูลร้านทั้งหมดเป็นไฟล์เดียว</b><small>สมาชิก · สต็อก · ธุรกรรม · บิล · ผู้ใช้ระบบ · การตั้งค่า — ตรวจสอบความถูกต้อง (integrity check) อัตโนมัติทุกไฟล์ ใช้เวลาไม่กี่วินาที</small></div><button className="primary-button" onClick={() => createBackupMutation.mutate()} disabled={createBackupMutation.isPending}><DatabaseBackup size={16} /> {createBackupMutation.isPending ? "กำลังสำรอง…" : "สำรองตอนนี้"}</button></div><div className="settings-inline-note"><ShieldCheck size={16} /><span>แนะนำกดสำรองก่อนปิดร้านทุกวัน และกด “ดาวน์โหลด” เก็บไฟล์ลง USB หรือคลาวด์เป็นชุดที่สอง — กันกรณีเครื่องพังทั้งเครื่อง ไฟล์ในเครื่องจะหายไปด้วย</span></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>สำรองข้อมูลอัตโนมัติ (Auto)</h2><p>ระบบสำรองให้เองตามรอบเวลา — ไม่ต้องจำ ไม่ต้องกด · ปรับแล้วกด “บันทึกการตั้งค่า” ด้านล่าง</p></div><CalendarClock size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>เปิดสำรองข้อมูลอัตโนมัติ</b><small>ตรวจทุก 10 นาที — ครบรอบเวลาที่กำหนดจะสำรองให้เอง พร้อมเก็บไว้เท่าจำนวนที่ตั้ง</small></div><button className={`toggle ${form?.backupAutoEnabled ? "on" : ""}`} onClick={() => updateForm({ backupAutoEnabled: !form?.backupAutoEnabled })} disabled={!form} aria-label="เปิดสำรองข้อมูลอัตโนมัติ"><span /></button></div>{form?.backupAutoEnabled && <div className="backup-interval-grid"><label>รอบเวลาสำรองอัตโนมัติ<select value={String(form?.backupIntervalHours ?? 24)} onChange={(event) => updateForm({ backupIntervalHours: Number(event.target.value) })} disabled={!form} aria-label="รอบเวลาสำรองอัตโนมัติ">{[[6, "ทุก 6 ชั่วโมง (วันละ 4 ครั้ง)"], [12, "ทุก 12 ชั่วโมง (วันละ 2 ครั้ง)"], [24, "ทุก 24 ชั่วโมง (วันละครั้ง — แนะนำ)"], [48, "ทุก 2 วัน"], [168, "ทุกสัปดาห์"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>เก็บไฟล์สำรองไว้ไม่เกิน<select value={String(form?.backupKeepCount ?? 14)} onChange={(event) => updateForm({ backupKeepCount: Number(event.target.value) })} disabled={!form} aria-label="จำนวนไฟล์สำรองที่เก็บ">{[[7, "7 ไฟล์ล่าสุด"], [14, "14 ไฟล์ล่าสุด (แนะนำ)"], [30, "30 ไฟล์ล่าสุด"], [60, "60 ไฟล์ล่าสุด"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>}<div className="settings-inline-note"><CalendarClock size={16} /><span>ไฟล์เก่ากว่าจำนวนที่ตั้ง จะถูกลบออกเองเพื่อไม่ให้ฮาร์ดดิสก์เต็ม — ไฟล์ที่ดาวน์โหลดเก็บไว้นอกเครื่องจะไม่ถูกลบ</span></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ไฟล์สำรองทั้งหมด</h2><p>ใหม่สุดขึ้นก่อน · ดาวน์โหลดเก็บนอกเครื่อง หรือกู้คืนกลับมาใช้เมื่อข้อมูลมีปัญหา</p></div><ArchiveRestore size={20} className="muted-icon" /></div>{backupQuery.isLoading ? <div className="cutoff-period-loading">กำลังโหลดรายการไฟล์สำรอง…</div> : backupQuery.isError ? <div className="inline-message error" role="alert"><ShieldCheck size={15} /> โหลดรายการไฟล์สำรองไม่สำเร็จ — {getErrorMessage(backupQuery.error)}</div> : (backupQuery.data?.backups ?? []).length === 0 ? <div className="backup-empty"><DatabaseBackup size={30} /><b>ยังไม่มีไฟล์สำรอง</b><small>กด “สำรองตอนนี้” ด้านบนเพื่อสร้างไฟล์แรก หรือเปิดสำรองอัตโนมัติให้ระบบจัดการให้</small></div> : <div className="backup-list">{(backupQuery.data?.backups ?? []).map((row) => <div className="backup-row" key={row.file}><span className="backup-icon"><DatabaseBackup size={16} /></span><div><b title={row.file}>{row.file}</b><small>{formatLogDateTime(row.createdAt)} · {formatFileSize(row.sizeBytes)}{row.integrity === "ok" ? " · ตรวจสอบความถูกต้องผ่าน" : ""}</small></div><div className="backup-actions"><button type="button" className="outline-button compact" disabled={downloadBackupMutation.isPending} onClick={() => downloadBackupMutation.mutate({ file: row.file })} title={`ดาวน์โหลด ${row.file} เก็บไว้นอกเครื่อง`}><Download size={14} /> ดาวน์โหลด</button><button type="button" className="danger-outline-button compact" disabled={restoreBackupMutation.isPending} onClick={() => setRestoreTarget(row.file)} title={`กู้คืนข้อมูลกลับไปเป็นช่วงเวลาของ ${row.file}`}><ArchiveRestore size={14} /> กู้คืน</button></div></div>)}</div>}<div className="settings-inline-note backup-restore-note"><ShieldCheck size={16} /><span>การกู้คืนจะ<b>แทนที่ข้อมูลทั้งระบบ</b>ด้วยไฟล์สำรองนั้น — ระบบสำรองข้อมูลปัจจุบันไว้เป็นไฟล์ป้องกันก่อนเสมอ และบันทึกลง Log เป็นสีแดง</span></div></section></>}{tab === "network" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>สถานะการเชื่อมต่อ</h2><p>ตรวจสอบว่าเครื่องนี้คุยกับเซิร์ฟเวอร์ของระบบได้ปกติ — เปิดหน้านี้ระบบวัดให้ทันที และวัดใหม่ได้ทุกเมื่อ</p></div><Wifi size={20} className="muted-icon" /></div><div className="net-stat-grid"><div className="net-stat"><small>ที่อยู่ที่เปิดอยู่ตอนนี้</small><b>{typeof window !== "undefined" ? window.location.origin : "—"}</b><span>เครื่องนี้เรียกใช้ระบบจาก URL นี้</span></div><div className="net-stat"><small>สัญญาณเครือข่ายของเครื่องนี้</small><b className={browserOnline ? "green-text" : "red-text"}>{browserOnline ? "ออนไลน์" : "ออฟไลน์"}</b><span>{browserOnline ? "เชื่อมต่อเครือข่ายอยู่ — ใช้งานได้ปกติ" : "เครื่องนี้ไม่มีสัญญาณเครือข่าย — เช็ค Wi-Fi หรือสายแลน"}</span></div><div className="net-stat"><small>ความหน่วงถึงเซิร์ฟเวอร์ (ping)</small><b>{latencyError ? "เชื่อมต่อไม่ได้" : latencyMs == null ? "กำลังวัด…" : `${latencyMs} มิลลิวินาที`}</b><span>{latencyAt ? `วัดล่าสุด ${latencyAt}` : "วัดอัตโนมัติตอนเปิดแท็บนี้"} · <button type="button" className="link-inline" onClick={measureLatency}><RefreshCw size={12} /> วัดใหม่</button></span></div></div>{lanInfoQuery.data && <div className="net-server-row"><Globe size={15} /><div><b>เซิร์ฟเวอร์: {lanInfoQuery.data.hostname}</b><small>{lanInfoQuery.data.platform} · เปิดให้บริการต่อเนื่องมาแล้ว {uptimeLabel(lanInfoQuery.data.uptimeSeconds)} · หน่วยความจำ {lanInfoQuery.data.totalMemoryMb.toLocaleString("th-TH")} MB</small></div></div>}</section><section className="panel settings-card"><div className="settings-heading"><div><h2>ใช้งานหลายจุดขายในร้าน (LAN)</h2><p>เครื่องอื่นในเครือข่ายเดียวกันเปิดระบบด้วย URL ด้านล่างนี้ได้เลย — ข้อมูลชุดเดียวกันทั้งร้าน ทุกเครื่องเห็นยอดแบบสด</p></div><Network size={20} className="muted-icon" /></div>{lanInfoQuery.isLoading ? <div className="table-loading"><Network size={22} /><b>กำลังอ่านไอพีของเครื่องเซิร์ฟเวอร์</b><span>ใช้เวลาไม่กี่วินาที</span></div> : (lanInfoQuery.data?.addresses.length ?? 0) === 0 ? <div className="settings-inline-note"><Wifi size={16} /><span>ไม่พบไอพี LAN บนเครื่องเซิร์ฟเวอร์ — เชื่อม Wi-Fi หรือสายแลนให้เครื่องเซิร์ฟเวอร์ก่อน แล้วกลับมาเปิดหน้านี้ใหม่ (หรือใช้ที่อยู่ในช่อง “ที่อยู่ที่เปิดอยู่ตอนนี้” ด้านบน)</span></div> : <div className="lan-url-list">{lanInfoQuery.data?.addresses.map((ip) => { const url = `http://${ip}:${lanInfoQuery.data?.port ?? 3000}`; return <div className="lan-url-row" key={ip}><span className="lan-url-ip">{ip}</span><code>{url}</code><button type="button" className="outline-button compact" onClick={() => copyLanUrl(url)}><Copy size={14} /> คัดลอก</button></div>; })}</div>}<div className="printer-flow-steps lan-steps"><div className="printer-step"><b>1</b><div><b>เชื่อมเครือข่ายเดียวกัน</b><small>เครื่องที่จะใช้ (จุดขายเพิ่ม / หลังบ้าน) ต้องอยู่ Wi-Fi หรือสายแลนเดียวกับเครื่องที่ติดตั้งระบบไว้</small></div></div><div className="printer-step"><b>2</b><div><b>เปิด URL ด้านบนด้วย Chrome หรือ Edge</b><small>พิมพ์ URL ในช่องที่อยู่ → เข้าสู่ระบบด้วยบัญชีของแต่ละคน · คลิกขวาที่แท็บ → “ปักหมุด” (Pin to taskbar) ให้เปิดได้เร็วทุกวัน</small></div></div><div className="printer-step"><b>3</b><div><b>เครื่องพิมพ์ของเครื่องไหน พิมพ์ที่เครื่องนั้น</b><small>ใบเสร็จถูกส่งไปเครื่องพิมพ์เริ่มต้นของ “เครื่องที่กดชำระเงิน” — ตั้งเครื่องพิมพ์สลิปของแต่ละจุดขายเป็นค่าเริ่มต้น (วิธีตั้งอยู่ที่แท็บใบเสร็จและการขาย)</small></div></div></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>LAN วันนี้ + คลาวด์ในอนาคต — ทำพร้อมกันได้</h2><p>สรุปแนวทางสำหรับร้าน: เริ่มใช้ใน LAN ก่อน แล้วต่อยอดขึ้นคลาวด์ทีละขั้น โดยไม่ต้องเริ่มใหม่</p></div><Cloud size={20} className="muted-icon" /></div><div className="dual-mode-note"><Check size={15} /><span>ระบบเก็บข้อมูลทั้งหมดไว้ที่เครื่องเซิร์ฟเวอร์ในร้าน (SQLite) — แม้อินเทอร์เน็ตหลุด การขายหน้าร้านก็ไม่สะดุด นี่คือหัวใจของโหมด “Offline-First” ที่จะต่อยอดขึ้นคลาวด์ได้</span></div><div className="printer-flow-steps"><div className="printer-step"><b>1</b><div><b>วันนี้ — ใช้ผ่าน LAN ในร้าน</b><small>ข้อมูลอยู่ในเครื่องร้าน 100% · สำรองข้อมูลอัตโนมัติทุกวันตามที่ตั้งไว้ (แท็บสำรองข้อมูล) · เร็ว ปลอดภัย ไม่ต้องพึ่งอินเทอร์เน็ต</small></div></div><div className="printer-step"><b>2</b><div><b>ขั้นถัดไป — ต่อคลาวด์เป็นตัวสำรองที่สอง</b><small>เปิดโหมดคลาวด์ควบคู่: หน้าร้านทำงานเหมือนเดิมทุกอย่าง แต่ระบบผลักสำเนาข้อมูลขึ้นคลาวด์ทันทีที่เน็ตกลับมา — สำรอง 2 ที่ ดูย้อนหลังได้จากที่ไหนก็ได้</small></div></div><div className="printer-step"><b>3</b><div><b>อนาคต — ผู้บริหารดูยอดจากนอกร้าน / หลายสาขา</b><small>เพิ่มระบบซิงก์: ขายที่ร้านเหมือนเดิม ยอดวิ่งขึ้นคลาวด์แบบใกล้ทันที · ผู้บริหารเปิดดูรายงานจากมือถือหรือบ้านได้ โดยหน้าร้านไม่ต้องเปลี่ยนวิธีทำงานแม้แต่ปุ่มเดียว</small></div></div></div><div className="initial-balance-note"><ShieldCheck size={15} /><span>แนวทางนี้ไม่ต้องเปลี่ยนเครื่องหรือทิ้งข้อมูลเดิม — เริ่มจาก LAN วันนี้ แล้วต่อยอดขึ้นคลาวด์ทีละขั้น ใช้ข้อมูลชุดเดียวกันตลอด</span></div></section></>}{tab === "display" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>ขนาดตัวอักษร</h2><p>ปรับขนาดตัวอักษรทั้งระบบให้อ่านง่ายขึ้น · มีผลทันที</p></div><Monitor size={20} className="muted-icon" /></div><div className="number-mode-grid">{FONT_SCALES.map((scale) => <button className={fontScale === scale.id ? "selected" : ""} key={scale.id} onClick={() => chooseFontScale(scale.id)}><span className="number-radio">{fontScale === scale.id && <i />}</span><span><b>{scale.label} · {Math.round(scale.zoom * 100)}%</b><small>{scale.detail}</small></span></button>)}</div><div className="font-scale-sample"><span>ตัวอย่างข้อความ</span><b>ร้านค้าสวัสดิการ · ยอดรวม ฿1,234.56</b><small>สมาชิก M-000001 · บิล RC-260918-010 · 18 ก.ย. 2569</small></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>การแสดงผลของอุปกรณ์</h2><p>การตั้งค่านี้เก็บในเครื่องที่ใช้อยู่ ไม่กระทบเครื่องอื่น</p></div><Monitor size={20} className="muted-icon" /></div><div className="settings-inline-note"><Monitor size={16} /><span>ขนาดตัวอักษรจะคงอยู่บนเครื่องนี้ทุกครั้งที่เปิดแอป · ไม่ต้องบันทึก · ไม่มีผลกับการพิมพ์ใบเสร็จและบัตรสมาชิก ซึ่งใช้ขนาดมาตรฐานของกระดาษเสมอ</span></div></section></>}{tab === "alert" && <div className="settings-single"><section className="panel settings-card"><div className="settings-heading"><div><h2>การแจ้งเตือน</h2><p>ช่วยให้เจ้าหน้าที่ติดตามรายการสำคัญได้ทันเวลา</p></div><Bell size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>แจ้งเตือนเมื่อสมาชิกมียอดคงเหลือต่ำ</b><small>แสดงในกระดิ่งแจ้งเตือนเมื่อยอดต่ำกว่า {money(form?.lowBalanceThreshold ?? 100)}</small></div><div className="toggle-row-controls"><label className="threshold-input" title="เกณฑ์ยอดคงเหลือต่ำ (บาท)"><span>฿</span><input type="number" min={0} step={1} inputMode="numeric" aria-label="เกณฑ์ยอดคงเหลือต่ำ (บาท)" placeholder="100" value={thresholdText} onChange={(event) => { const digits = event.target.value.replace(/[^0-9]/g, ""); setThresholdText(digits); updateForm({ lowBalanceThreshold: digits === "" ? 0 : Number(digits) }); }} disabled={!form} /></label><button className={`toggle ${form?.lowBalanceAlert ? "on" : ""}`} onClick={() => updateForm({ lowBalanceAlert: !form?.lowBalanceAlert })} disabled={!form} aria-label="แจ้งเตือนยอดคงเหลือต่ำ"><span /></button></div></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดสต็อก</b><small>แจ้งเตือนเมื่อจำนวนต่ำกว่าจุดสั่งซื้อ</small></div><button className={`toggle ${form?.lowStockAlert ? "on" : ""}`} onClick={() => updateForm({ lowStockAlert: !form?.lowStockAlert })} disabled={!form} aria-label="แจ้งเตือนสต็อกต่ำ"><span /></button></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดอายุ</b><small>แจ้งเตือนล่วงหน้า {form?.expiryAlertDays ?? 30} วัน</small></div><button className={`toggle ${form?.expiryAlert ? "on" : ""}`} onClick={() => updateForm({ expiryAlert: !form?.expiryAlert })} disabled={!form} aria-label="แจ้งเตือนใกล้หมดอายุ"><span /></button></div></section></div>}{tab === "roles" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>สิทธิ์และบทบาทผู้ใช้ระบบ</h2><p>สิทธิ์ตามที่ระบบบังคับใช้จริงในปัจจุบัน</p></div><ShieldCheck size={20} className="muted-icon" /></div><div className="role-matrix">{ROLE_MATRIX.map((entry) => <div className={`role-matrix-card ${entry.role}`} key={entry.role}><div className="role-matrix-head"><span className="role-avatar small"><Crown size={17} /></span><div><b>{entry.title}</b><small>{entry.caption}</small></div></div><ul>{entry.permits.map((permit) => <li key={permit}><Check size={14} /> {permit}</li>)}</ul></div>)}</div></section><section className="panel settings-card dev-warning-card"><div className="settings-heading"><div><h2>การเข้าใช้งานสำหรับผู้พัฒนา (Dev Access)</h2><p>ประตูพิเศษสำหรับบัญชีผู้พัฒนา (dev) เท่านั้น — ปิดไว้เป็นค่าเริ่มต้น</p></div><Terminal size={20} className="muted-icon" /></div><div className="dev-access-warning"><ShieldCheck size={16} /><span>บัญชีผู้พัฒนา (dev) สามารถเข้าถึง<b>ข้อมูลของร้านได้ทั้งหมด</b> เท่าผู้บริหารทุกอย่าง · ระบบปิดการเข้าใช้งานไว้โดยอัตโนมัติ และ<b>บันทึกทุกการเข้าสู่ระบบลงระบบ Log เป็นสีแดง</b>เสมอ</span></div><div className="toggle-row"><div><b>อนุญาตให้บัญชีผู้พัฒนาเข้าสู่ระบบ</b><small>เปิดเฉพาะช่วงที่ผู้พัฒนามาตรวจสอบ/ซ่อมแซมระบบ แล้วปิดกลับทันทีเมื่อเสร็จ</small></div><button className={`toggle ${form?.devAccess ? "on" : ""}`} onClick={toggleDevAccess} disabled={!form} aria-label="อนุญาตให้บัญชีผู้พัฒนาเข้าสู่ระบบ"><span /></button></div><div className={`dev-status-line${form?.devAccess ? " on" : ""}`}><i aria-hidden="true" />{form?.devAccess ? "เปิดอยู่ — บัญชีผู้พัฒนาเข้าสู่ระบบได้" : "ปิดอยู่ (แนะนำ) — บัญชีผู้พัฒนาไม่สามารถเข้าสู่ระบบได้"}</div><div className="dev-account-count">บัญชีผู้พัฒนาในระบบ <b>{devAccounts.length} บัญชี</b>{devAccounts.length > 0 && <span className="cell-sub"> · {devAccounts.map((user) => `@${user.username}`).join(", ")}</span>} · สร้าง/จัดการบัญชีผู้พัฒนาได้ที่หน้า <button type="button" className="link-button" onClick={() => setView("users")}>ผู้ใช้ระบบ</button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ข้อควรทราบ</h2><p>ความปลอดภัยของระบบ</p></div><LockKeyhole size={20} className="muted-icon" /></div><div className="settings-inline-note"><LockKeyhole size={16} /><span>บัญชีผู้ใช้ระบบถูกระงับชั่วคราวเมื่อกรอกรหัสผ่านผิด 5 ครั้ง และปลดล็อกอัตโนมัติใน 15 นาที · ผู้บริหารสามารถปลดล็อกก่อนกำหนดได้ที่หน้าผู้ใช้ระบบ</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("users")}><ArrowRight size={16} /> ไปที่หน้าผู้ใช้ระบบ</button></div></section></>}{tab === "log" && <div className="settings-single"><section className="panel settings-card"><div className="settings-heading"><div><h2>การบันทึก Log</h2><p>ระบบบันทึกทุกกิจกรรมสำคัญอัตโนมัติ พร้อมชื่อผู้ทำรายการและเวลา</p></div><Activity size={20} className="muted-icon" /></div><div className="log-settings-grid"><div className="log-settings-stat"><span>รายการล่าสุดในระบบ</span><strong>{logsStatsQuery.isLoading ? "…" : logs.length.toLocaleString("th-TH")}</strong><small>แสดงไม่เกิน 200 รายการล่าสุด</small></div><div className="log-settings-stat"><span>กิจกรรมล่าสุด</span><strong>{lastLog ? formatLogDateTime(lastLog.createdAt) : "—"}</strong><small>{lastLog ? `${lastLog.actor} · ${lastLog.action}` : "ยังไม่มีข้อมูล"}</small></div></div><div className="settings-inline-note"><Activity size={16} /><span>ตัวอย่างกิจกรรมที่บันทึก: ขายสินค้า · เติมเงิน · ถอนเงิน · รับสินค้าเข้า · นับสต็อก · แก้ไขสินค้า · ลงทะเบียนสมาชิก · จัดการผู้ใช้ระบบ · การตั้งค่า</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("logs")}><ArrowRight size={16} /> ไปที่ระบบ Log</button></div></section></div>}{dirtyCount > 0 && form && <div className="settings-save-bar" role="status" aria-live="polite"><span className="save-dot" aria-hidden="true" /><div className="save-bar-text"><b>มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</b><small>แก้ไขแล้ว: {dirtyKeys.slice(0, 3).join(" · ")}{dirtyCount > 3 ? ` และอีก ${dirtyCount - 3} รายการ` : ""}</small></div><div className="save-bar-actions"><button type="button" className="outline-button" disabled={saveMutation.isPending} onClick={discardChanges}>ย้อนการแก้ไข</button><button type="button" className="primary-button" disabled={saveMutation.isPending} onClick={saveSettings}><Check size={16} /> {saveMutation.isPending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}</button></div></div>}{saved && <div className="notice-bar"><Check size={16} /> บันทึกการตั้งค่าเรียบร้อยแล้ว<button onClick={() => setSaved(false)}><X size={14} /></button></div>}{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<ConfirmDialog open={devAccessConfirm} title="ยืนยันการเปิด Dev Access?" description="การเปิดสวิตช์นี้อนุญาตให้บัญชีผู้พัฒนา (dev) เข้าสู่ระบบและเข้าถึงข้อมูลของร้านได้ทั้งหมดเท่าผู้บริหาร · ทุกการเข้าสู่ระบบจะถูกบันทึกลงระบบ Log เป็นสีแดง · แนะนำให้เปิดเฉพาะช่วงที่จำเป็น แล้วปิดกลับเมื่อเสร็จ (ต้องกดบันทึกการตั้งค่าจึงมีผล)" confirmLabel="ยืนยันเปิด Dev Access" onCancel={() => setDevAccessConfirm(false)} onConfirm={() => { setDevAccessConfirm(false); updateForm({ devAccess: true }); }} /><ConfirmDialog open={importConfirm} title="ยืนยันการนำเข้าข้อมูล?" description={`จะนำเข้า ${currentSheet ? currentSheet.totalRows.toLocaleString("th-TH") : ""} แถว จากไฟล์ ${importFile?.name ?? ""} (${importKind === "members" ? "สมาชิก" : "สินค้า"} · ${duplicateMode === "skip" ? "ข้ามรายการซ้ำ" : "อัปเดตข้อมูลที่ซ้ำ"}) · ระบบจะสำรองข้อมูลทั้งระบบเป็นไฟล์ป้องกันก่อนนำเข้าเสมอ และบันทึกการนำเข้าลง Log`} confirmLabel="ยืนยันนำเข้าข้อมูล" onCancel={() => setImportConfirm(false)} onConfirm={runImport} /><ConfirmDialog open={restoreTarget !== null} title="ยืนยันการกู้คืนข้อมูลจากไฟล์สำรอง?" description={`ข้อมูลทั้งระบบจะกลับไปเป็นช่วงเวลาของไฟล์สำรองนี้ (${restoreTarget ?? ""}) — ทุกอย่างที่ทำหลังจากนั้นจะถูกแทนที่ · ระบบจะสำรองข้อมูลปัจจุบันไว้เป็นไฟล์ป้องกันก่อนเสมอ และบันทึกการกู้คืนลง Log เป็นสีแดง · หากไฟล์สำรองเก่ากว่าเซสชันที่ใช้อยู่ อาจต้องเข้าสู่ระบบใหม่หลังกู้คืน`} confirmLabel="ยืนยันกู้คืนข้อมูล" onCancel={() => setRestoreTarget(null)} onConfirm={() => { if (restoreTarget) restoreBackupMutation.mutate({ file: restoreTarget }); }} /></div></div></>;
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
    const csv = "\ufeff" + [["วันและเวลา", "ผู้ทำรายการ", "กิจกรรม", "รายละเอียด", "ระดับสิทธิ์"], ...filtered.map((log) => [formatLogDateTime(log.createdAt), log.actor, log.action, log.detail, log.actorRole ?? ""])].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "activity-logs.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice("ดาวน์โหลดรายการ Log แล้ว");
  };
  return <><SectionHeader eyebrow="ตรวจสอบย้อนหลังและความโปร่งใส" title="ระบบ Log" description="บันทึกทุกกิจกรรมสำคัญของผู้ใช้งานและธุรกรรมในระบบ" action={<button className="outline-button" onClick={downloadLogsCsv}><Download size={16} /> ส่งออก Log</button>} /><div className="log-summary"><div><Activity size={18} /><span>รายการวันนี้<strong>{todayCount}</strong></span></div><div><ShieldCheck size={18} /><span>ผู้ใช้งานในระบบ<strong>{actorCount}</strong></span></div><div><ReceiptText size={18} /><span>ธุรกรรมที่บันทึก<strong>100%</strong></span></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>กิจกรรมทั้งหมด</h2><p>ข้อมูลสำหรับตรวจสอบย้อนหลังของเจ้าหน้าที่และผู้บริหาร</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหากิจกรรม หรือผู้ใช้งาน" /></div><div className="date-range-filter"><div className="search-field" title="ตั้งแต่วันที่"><CalendarDays size={15} /><input type="date" value={dateFrom} max={dateTo || undefined} aria-label="กรองตั้งแต่วันที่" onChange={(event) => setDateFrom(event.target.value)} /></div><span className="date-range-sep">→</span><div className="search-field" title="ถึงวันที่"><CalendarDays size={15} /><input type="date" value={dateTo} min={dateFrom || undefined} aria-label="กรองถึงวันที่" onChange={(event) => setDateTo(event.target.value)} /></div>{(dateFrom || dateTo) && <button type="button" className="date-range-clear" aria-label="ล้างตัวกรองช่วงเวลา" title="ล้างตัวกรองช่วงเวลา" onClick={() => { setDateFrom(""); setDateTo(""); }}><X size={15} /></button>}</div></div></div><div className="table-filter-summary"><span><Search size={13} /> {query || dateFrom || dateTo ? <>กรองตามเงื่อนไข{(dateFrom || dateTo) ? ` · ${dateFrom || "เริ่มต้น"} ถึง ${dateTo || "ปัจจุบัน"}` : ""}</> : "กิจกรรมทั้งหมด"}</span><span>แสดง <b>{Math.min(visible, filtered.length)}</b> จาก <b>{filtered.length}</b> รายการ</span></div><div className="table-wrap">{logsQuery.isLoading ? <div className="table-loading"><Activity size={22} /><b>กำลังโหลดรายการ Log</b><span>ดึง 200 รายการล่าสุดจากระบบ</span></div> : logsQuery.isError ? <div className="entity-state error" role="alert"><ShieldCheck size={22} /><b>โหลดรายการ Log ไม่สำเร็จ</b><span>{getErrorMessage(logsQuery.error)}</span></div> : filtered.length === 0 ? <div className="entity-state"><Activity size={22} /><b>ไม่พบกิจกรรมตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือช่วงวันที่</span></div> : <table className="log-table" aria-label="รายการกิจกรรม"><thead><tr><th aria-label="ระดับกิจกรรม" /><th>วันที่ · เวลา</th><th>ผู้ทำรายการ</th><th>กิจกรรม</th><th>รายละเอียด</th></tr></thead><tbody>{filtered.slice(0, visible).map((log) => <tr key={log.id}><td className="log-tone-cell"><i className={`log-dot-mini tone-${log.tone ?? "green"}`} aria-hidden="true" /></td><td><small className="cell-mono">{formatLogDateTime(log.createdAt)}</small></td><td><b>{log.actor}</b>{log.actorRole && <small>{log.actorRole}</small>}</td><td><b>{log.action}</b></td><td><span className="log-detail-text" title={log.detail}>{log.detail}</span></td></tr>)}</tbody></table>}</div>{visible < filtered.length ? <button type="button" className="table-show-more" onClick={() => setVisible((current) => current + 30)}><ChevronDown size={15} /> แสดงรายการเพิ่มอีก <b>{filtered.length - visible}</b> รายการ</button> : filtered.length > 30 && <div className="table-show-more done">แสดงทั้งหมด {filtered.length} รายการแล้ว</div>}{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section></>;
}

function AppShell({ user, brand, onLogout }: { user: User; brand?: BrandSettings | null | undefined; onLogout: () => void }) {
  const [activeView, setActiveView] = useState<View>("dashboard");
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
        if (member) toast.warning("สมาชิกยอดคงเหลือต่ำ", { description: `${member.firstName} ${member.lastName} · ${member.memberNumber} · คงเหลือ ${money(member.balance)}`, duration: 5000 });
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
  const safeView = canAccessView(role, activeView) ? activeView : "dashboard";
  const pageTitle = navItems.find((item) => item.id === safeView)?.label ?? (safeView === "settings" ? "ตั้งค่า" : safeView === "logs" ? "ระบบ Log" : safeView === "users" ? "ผู้ใช้ระบบ" : "ภาพรวม");
  const logout = () => { if (!logoutMutation.isPending) logoutMutation.mutate(); };
  return <div className={safeView === "pos" ? "app-shell pos-terminal" : "app-shell"}>{safeView === "pos" && <aside className="pos-rail" aria-label="เมนูด่วนหน้าร้าน"><div className="rail-brand" title={appName}>{appLogo ? <img className="brand-logo" src={appLogo} alt={appName} /> : <span className="brand-mark">{brandInitial(appName)}</span>}<span className="rail-caption">POS</span></div><button type="button" className="rail-btn rail-scan" title="โฟกัสช่องสแกนบาร์โค้ด — พร้อมรับค่าเสมอ (F8)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "scan" }))}><ScanLine size={20} /><b>สแกน</b><kbd>F8</kbd></button><button type="button" className="rail-btn rail-customer" title="เลือกลูกค้า / สมาชิกสำหรับบิลนี้ (F1)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "member" }))}><UsersRound size={20} /><b>ลูกค้า</b><kbd>F1</kbd></button><button type="button" className={`rail-btn rail-deposit${posShortcut === "เติมเงิน" ? " active" : ""}`} title="เติมเงินเข้าบัญชีสมาชิก (F2)" onClick={() => setPosShortcut(posShortcut === "เติมเงิน" ? "" : "เติมเงิน")}><ArrowDownToLine size={20} /><b>เติมเงิน</b><kbd>F2</kbd></button><button type="button" className={`rail-btn rail-withdraw${posShortcut === "ถอนเงิน" ? " active" : ""}`} title="ถอนเงินจากบัญชีสมาชิก (F3)" onClick={() => setPosShortcut(posShortcut === "ถอนเงิน" ? "" : "ถอนเงิน")}><ArrowUpFromLine size={20} /><b>ถอนเงิน</b><kbd>F3</kbd></button><button type="button" className={`rail-btn rail-special${posShortcut === "สินค้าไม่ระบุตายตัว" ? " active" : ""}`} title="เพิ่มรายการพิเศษ — ของชั่ง ค่าบริการ (F4)" onClick={() => setPosShortcut(posShortcut === "สินค้าไม่ระบุตายตัว" ? "" : "สินค้าไม่ระบุตายตัว")}><Sparkles size={20} /><b>รายการพิเศษ</b><kbd>F4</kbd></button><button type="button" className="rail-btn rail-hold" title="พักบิลปัจจุบันไว้ แล้วเริ่มบิลใหม่ — เรียกคืนได้จากแถบใต้ช่องสแกน (F5)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "hold" }))}><Pause size={20} /><b>พักบิล</b><kbd>F5</kbd>{posHeldCount > 0 && <span className="rail-badge">{posHeldCount}</span>}</button><button type="button" className="rail-btn rail-register" title="ลงทะเบียนสมาชิกใหม่ + พิมพ์บัตร — ทำที่นี่ที่เดียว (F6)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "register" }))}><UserPlus size={20} /><b>สมาชิกใหม่</b><kbd>F6</kbd></button><button type="button" className="rail-btn rail-manage" title="จัดแผงลัดหน้าร้าน — เลือกสินค้าที่หยิบบ่อยขึ้นแผง (F7)" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "quickmanage" }))}><Star size={20} /><b>จัดแผง</b><kbd>F7</kbd></button><span className="rail-spacer" aria-hidden="true" /><button type="button" className="rail-btn rail-exit" title="เปิดเมนูหลัก — ภาพรวมระบบ" onClick={() => setActiveView("dashboard")}><LayoutDashboard size={20} /><b>เมนู</b></button></aside>}<aside className={`sidebar ${mobileNav ? "open" : ""}${safeView === "pos" ? " pos-context" : ""}`}><div className="brand">{appLogo ? <img className="brand-logo" src={appLogo} alt={appName} /> : <div className="brand-mark"><span>{brandInitial(appName)}</span></div>}<div><b>{appName}</b><small>Welfare Store</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={19} /></button></div><div className="role-card"><div className={`role-avatar ${role}`}>{profileAvatar}</div><div><b>{profileName}</b><span>{role === "admin" ? "ผู้บริหารระบบ" : role === "dev" ? "ผู้พัฒนาระบบ" : "เจ้าหน้าที่ร้านค้า"}{role === "dev" && <i className="dev-role-badge">DEV</i>}</span></div></div><div className="nav-group-label">เมนูหลัก</div><nav>{navItems.map(({ id, label, icon: Icon }) => <button className={safeView === id ? "active" : ""} key={id} onClick={() => { setActiveView(id); setMobileNav(false); }}><Icon size={20} /><b>{label}</b>{id === "stock" && lowStock.length > 0 && <i className="nav-badge">{lowStock.length}</i>}</button>)}</nav>{isAdminRole(role) ? <><div className="nav-group-label">สำหรับผู้บริหาร</div><nav className="secondary-nav"><button className={safeView === "settings" ? "active" : ""} onClick={() => { setActiveView("settings"); setMobileNav(false); }}><Settings2 size={20} /><b>ตั้งค่า</b></button><button className={safeView === "users" ? "active" : ""} onClick={() => { setActiveView("users"); setMobileNav(false); }}><UserCog size={20} /><b>ผู้ใช้ระบบ</b></button><button className={safeView === "logs" ? "active" : ""} onClick={() => { setActiveView("logs"); setMobileNav(false); }}><Activity size={20} /><b>ระบบ Log</b></button></nav></> : <div className="locked-nav"><LockKeyhole size={15} /><span>เมนูผู้บริหารถูกซ่อน</span></div>}<div className="sidebar-footer"><button type="button" className="sidebar-logout" onClick={logout} disabled={logoutMutation.isPending} title="ออกจากระบบ" aria-label="ออกจากระบบ"><LogOut size={16} /> ออกจากระบบ</button><div className="sidebar-version">v1.0.0 · ระบบร้านค้าสวัสดิการ</div><div className="sidebar-powered">⚡ Powered by <b>PNG TEAM</b></div></div></aside><main className="main-shell"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div className="breadcrumb"><span>{appName}</span><b>/</b><strong>{pageTitle}</strong></div><div className="topbar-actions"><div className="global-search" role="button" tabIndex={0} aria-label="เปิดค้นหาเมนู สมาชิก หรือสินค้า" onClick={() => setSearchOpen(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSearchOpen(true); } }}><Search size={17} /><span>ค้นหาเมนูหรือรายการ...</span><kbd>⌘ K</kbd></div><button type="button" className="top-icon" title="ออกจากระบบ" aria-label="ออกจากระบบ" onClick={logout} disabled={logoutMutation.isPending}><LogOut size={18} /></button><div className="notif-wrap" ref={notifRef}><button type="button" className="top-icon" title="การแจ้งเตือน" aria-label="การแจ้งเตือน" aria-haspopup="menu" aria-expanded={notifOpen} onClick={() => setNotifOpen((current) => !current)}><Bell size={18} />{notifCount > 0 && <i />}</button>{notifOpen && <div className="notif-dropdown" role="menu" aria-label="การแจ้งเตือน"><div className="notif-header"><b>การแจ้งเตือน</b>{notifCount > 0 && <span className="notif-count">{notifCount}</span>}</div>{notifCount === 0 ? <div className="notif-empty"><Bell size={22} /><b>ไม่มีการแจ้งเตือน</b><small>สต็อก · วันหมดอายุ · ยอดสมาชิกปกติดี</small></div> : <div className="notif-scroll">{lowStock.length > 0 && <div className="notif-section-label"><i className="notif-dot red" />สินค้าใกล้หมดสต็อก</div>}{lowStock.map((row) => <button type="button" className="notif-row" role="menuitem" key={`low-${row.id}`} onClick={() => { setNotifOpen(false); setActiveView("stock"); }}><div><b>{row.name}</b><small>เหลือ {row.stock} {row.unit} · ต่ำกว่าจุดสั่งซื้อ {row.reorderPoint}</small></div><i className="notif-dot red" /></button>)}{expiring.length > 0 && <div className="notif-section-label"><i className="notif-dot amber" />ใกล้หมดอายุ</div>}{expiring.map((row) => <button type="button" className="notif-row" role="menuitem" key={`exp-${row.id}`} onClick={() => { setNotifOpen(false); setActiveView("stock"); }}><div><b>{row.name}</b><small>{row.expiry ? `หมดอายุ ${formatThaiDate(row.expiry)}` : "ตรวจสอบวันหมดอายุ"}</small></div><i className="notif-dot amber" /></button>)}{memberNegative.length > 0 && <div className="notif-section-label"><i className="notif-dot red" />สมาชิกยอดคงเหลือติดลบ</div>}{memberNegative.map((member) => <button type="button" className="notif-row member-row" role="menuitem" key={`neg-${member.memberNumber}`} onClick={() => { setNotifOpen(false); setPendingMemberNumber(member.memberNumber); setActiveView("members"); }}><div><b>{member.firstName} {member.lastName}</b><small>ยอดติดลบ <b className="amount-negative">{money(member.balance)}</b></small></div><i className="notif-dot red" /></button>)}{memberLowPositive.length > 0 && <div className="notif-section-label"><i className="notif-dot amber" />สมาชิกยอดคงเหลือต่ำ</div>}{memberLowPositive.map((member) => <button type="button" className="notif-row member-row" role="menuitem" key={`lowbal-${member.memberNumber}`} onClick={() => { setNotifOpen(false); setPendingMemberNumber(member.memberNumber); setActiveView("members"); }}><div><b>{member.firstName} {member.lastName}</b><small>คงเหลือ <b className="amount-low">{money(member.balance)}</b> · ต่ำกว่า {money(lowBalanceThreshold)}</small></div><i className="notif-dot amber" /></button>)}{memberLowBalanceHidden > 0 && <div className="notif-more">+ {memberLowBalanceHidden} รายการเพิ่มเติม</div>}</div>}<button type="button" className="notif-footer" role="menuitem" onClick={() => { setNotifOpen(false); setActiveView("stock"); }}>ดูสต็อกทั้งหมด →</button></div>}</div><div className="profile-pill"><span className={`profile-avatar ${role}`}>{profileAvatar}</span><div><b>{profileName}</b><small>{role === "admin" ? "ผู้บริหาร" : role === "dev" ? "ผู้พัฒนา" : "เจ้าหน้าที่"}{role === "dev" && <i className="dev-role-badge">DEV</i>}</small></div></div></div></header><div className="page-content" key={safeView}>{safeView === "dashboard" && <Dashboard setView={setActiveView} role={role} userName={profileName} />}{safeView === "pos" && <Pos shortcut={posShortcut} setShortcut={setPosShortcut} role={role} userName={profileName} />}{safeView === "stock" && <Stock role={role} userName={profileName} />}{safeView === "members" && <Members role={role} userName={profileName} focusMemberNumber={pendingMemberNumber} onFocusMemberConsumed={() => setPendingMemberNumber(null)} />}{safeView === "reports" && <Reports focusBill={pendingBillNumber} onFocusBillConsumed={() => setPendingBillNumber(null)} role={role} userName={profileName} />}{safeView === "settings" && isAdminRole(role) && <Settings setView={setActiveView} />}{safeView === "users" && isAdminRole(role) && <Users selfUsername={user.openId} />}{safeView === "logs" && isAdminRole(role) && <Logs />}</div><footer className="app-footer"><span className="footer-brand">{appName}<small> · ระบบร้านค้าสวัสดิการ</small></span><span className="footer-powered">⚡ Powered by <b>PNG TEAM</b></span><span className="footer-help"><CircleHelp size={12} /> ศูนย์ช่วยเหลือ 02-XXX-XXXX</span></footer><GlobalSearch role={role} open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={(view) => { setActiveView(view); setSearchOpen(false); setMobileNav(false); }} onOpenMember={(memberNumber) => { setSearchOpen(false); setPendingMemberNumber(memberNumber); setActiveView("members"); }} onOpenBill={(orderNumber) => { setSearchOpen(false); setPendingBillNumber(orderNumber); setActiveView("reports"); }} /></main></div>;
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
