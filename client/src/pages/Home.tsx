import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  CreditCard,
  Crown,
  Download,
  FileBarChart,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  LockKeyhole,
  LogOut,
  IdCard,
  LayoutDashboard,
  Menu,
  Monitor,
  MoreHorizontal,
  Palette,
  Pause,
  Plus,
  ReceiptText,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Trash2,
  UserCog,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

import type { MemberLite, Role, View } from "./pageData";
import type { SaleHistoryEntry } from "../../../server/sqliteStore";
import type { User } from "../../../drizzle/schema";
import { canAccessView, formatMemberNumber, loadHeldBills, money, navItems } from "./pageData";
import { ConfirmDialog, SectionHeader, StatusPill } from "./PagePrimitives";
import { Dashboard } from "./Dashboard";
import { GlobalSearch } from "@/components/GlobalSearch";
import { LoginView } from "@/components/LoginView";
import { MemberCardModal } from "@/components/MemberCardModal";
import { StatementModal } from "@/components/StatementModal";
import { ReceiptModal } from "@/components/ReceiptModal";
import { Pos } from "./Pos";
import { Stock } from "./Stock";
import { Users } from "./Users";
import { trpc } from "@/lib/trpc";
import { applyFontScale, FONT_SCALES, readFontScale, type FontScaleId } from "../fontScale";
import { applyBrand, applyCachedBrand, applyThemeColor, brandInitial, resolveThemeColor, THEME_PRESETS, type BrandSettings } from "../theme";
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

const emptyNewMember = { firstName: "", lastName: "", idCard: "", phone: "", type: "สมาชิก", memberNumber: "", initialBalance: "" };

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
  autoPrintReceipt: boolean;
  showBalanceOnReceipt: boolean;
  lowBalanceAlert: boolean;
  lowBalanceThreshold: number;
  lowStockAlert: boolean;
  expiryAlert: boolean;
  expiryAlertDays: number;
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
  ["autoPrintReceipt", "พิมพ์ใบเสร็จอัตโนมัติ"],
  ["showBalanceOnReceipt", "แสดงยอดคงเหลือบนใบเสร็จ"],
  ["lowBalanceAlert", "แจ้งเตือนยอดคงเหลือต่ำ"],
  ["lowBalanceThreshold", "เกณฑ์ยอดคงเหลือต่ำ"],
  ["lowStockAlert", "แจ้งเตือนสต็อกต่ำ"],
  ["expiryAlert", "แจ้งเตือนใกล้หมดอายุ"],
  ["expiryAlertDays", "จำนวนวันแจ้งเตือนล่วงหน้า"],
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
  const [editForm, setEditForm] = useState<{ firstName: string; lastName: string; type: string; phone: string; idCard: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
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
    setEditForm({ firstName: detail?.firstName ?? profile.firstName, lastName: detail?.lastName ?? profile.lastName, type: detail?.type ?? profile.type, phone: detail?.phone ?? "", idCard: detail?.idCard ?? "" });
    setError("");
    setEditOpen(true);
  };
  const submitEdit = () => {
    if (!editForm) return;
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) { setError("กรุณาระบุชื่อและนามสกุลสมาชิก"); return; }
    setError("");
    updateMutation.mutate({
      memberNumber: member.memberNumber,
      firstName: editForm.firstName.trim(),
      lastName: editForm.lastName.trim(),
      idCard: editForm.idCard.trim() || null,
      phone: editForm.phone.trim() || null,
      type: editForm.type,
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
    walletMutation.mutate({ memberNumber: member.memberNumber, type: walletOpen, amount, note: walletNote.trim() || undefined, actor, actorRole });
  };
  return <><SectionHeader eyebrow="สมาชิกและบัญชี / รายละเอียด" title={`รายละเอียด ${displayName}`} description="ตรวจสอบประวัติการซื้อสินค้า เติมเงิน และถอนเงินของสมาชิกแต่ละราย" action={<button className="outline-button" onClick={onBack}><ArrowDownToLine size={16} style={{ transform: "rotate(90deg)" }} /> กลับไปรายการสมาชิก</button>} /><div className="member-detail-head"><div className="member-detail-profile"><span className="member-detail-avatar">{profile.firstName.slice(0, 1)}</span><div><span className="eyebrow">{profile.type} · {profile.memberNumber}</span><h2>{displayName}</h2><p>สถานะ <StatusPill tone={statusMeta.tone}>{statusMeta.label}</StatusPill></p></div></div><div className="member-detail-actions"><button className="primary-button" disabled={profile.status !== "active"} onClick={() => { setWalletOpen("deposit"); setError(""); }}><ArrowDownToLine size={15} /> เติมเงิน</button><button className="outline-button" disabled={profile.status !== "active"} onClick={() => { setWalletOpen("withdrawal"); setError(""); }}><ArrowUpFromLine size={15} /> ถอนเงิน</button>{profile.status === "active" ? <button className="danger-outline-button" onClick={() => setConfirmStatus(true)}><LockKeyhole size={15} /> ระงับการใช้งาน</button> : <button className="outline-button" onClick={() => setConfirmStatus(true)}><Check size={15} /> คืนสถานะ</button>}<button className="outline-button" onClick={openEdit}><Settings2 size={15} /> แก้ไขข้อมูลสมาชิก</button><button className="outline-button" disabled={detailQuery.isLoading} onClick={() => setStatementOpen(true)}><FileText size={15} /> ส่งออกรายงานธุรกรรม</button><button className="outline-button" onClick={() => setCardOpen(true)}><IdCard size={15} /> พิมพ์บัตรสมาชิก</button>{role === "admin" && <button className="danger-outline-button" onClick={() => { setConfirmDelete(true); setError(""); }}><Trash2 size={15} /> ลบสมาชิก</button>}</div></div>{error && !walletOpen && !editOpen && <div className="notice-bar error" style={{ marginBottom: 14 }}><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="member-detail-stats"><div><span className="stat-icon green"><WalletCards size={18} /></span><div><small>ยอดเงินคงเหลือ</small><strong>{money(profile.balance)}</strong></div></div><div><span className="stat-icon blue"><ShoppingCart size={18} /></span><div><small>ยอดซื้อเดือนนี้</small><strong>{money(monthPurchase)}</strong></div></div><div><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>เติมเงินสะสม</small><strong>{money(totalDeposited)}</strong></div></div><div><span className="stat-icon amber"><CalendarDays size={18} /></span><div><small>รายการล่าสุด</small><strong>{lastActivity}</strong></div></div></div>{statsQuery.isLoading ? <div className="member-detail-stats member-purchase-stats" aria-busy="true">{Array.from({ length: 4 }, (_, index) => <div key={`stat-skeleton-${index}`}><span className="skeleton-avatar" /><div className="member-stat-skeleton"><span className="skeleton-cell-n" /><span className="skeleton-cell-w" /></div></div>)}</div> : statsQuery.data ? <div className="member-detail-stats member-purchase-stats"><div><span className="stat-icon blue"><ReceiptText size={18} /></span><div><small>ยอดซื้อสะสม</small><strong>{money(statsQuery.data.totalSpent)}</strong></div></div><div><span className="stat-icon green"><ShoppingBag size={18} /></span><div><small>จำนวนบิล</small><strong>{statsQuery.data.billCount} บิล</strong></div></div><div><span className="stat-icon purple"><CalendarDays size={18} /></span><div><small>ซื้อครั้งล่าสุด</small><strong>{statsQuery.data.lastPurchaseAt ? formatHistoryDate(statsQuery.data.lastPurchaseAt) : "ยังไม่เคยซื้อ"}</strong></div></div><div><span className="stat-icon amber"><Star size={18} /></span><div className="member-top-products"><small>สินค้าที่ซื้อบ่อย</small>{statsQuery.data.topProducts.length === 0 ? <span className="top-products-empty">ยังไม่มีประวัติการซื้อสินค้า</span> : <div className="top-products-list">{statsQuery.data.topProducts.map((product) => <span className="top-product-chip" key={product.name}>{product.name} <b>×{product.qty}</b></span>)}</div>}</div></div></div> : null}<section className="panel table-panel member-history-panel"><div className="table-toolbar"><div><h2>ประวัติการทำรายการ</h2><p>ข้อมูลย้อนหลังของ {displayName} · รวม {transactions.length} รายการ</p></div><div className="filter-pills history-tabs">{["ทั้งหมด", "ซื้อสินค้า", "เติมเงิน", "ถอนเงิน"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item as typeof tab)}>{item}</button>)}</div></div><div className="member-history-list">{detailQuery.isLoading ? <div className="table-loading"><ReceiptText size={22} /><b>กำลังโหลดประวัติการทำรายการ</b><span>ดึงข้อมูลธุรกรรมของสมาชิกจากระบบ</span></div> : filtered.length === 0 ? <div className="table-loading"><ReceiptText size={22} /><b>ไม่พบรายการตามเงื่อนไข</b><span>ลองเปลี่ยนแท็บหรือทำรายการผ่าน POS</span></div> : filtered.map((transaction) => { const meta = WALLET_TX_META[transaction.type] ?? { label: transaction.type, tone: "blue" }; return <div className="history-row" key={transaction.id}><span className={`history-icon ${meta.tone}`}>{transaction.type === "purchase" ? <ShoppingCart size={16} /> : transaction.type === "deposit" ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</span><div className="history-main"><div><b>{meta.label}</b><span>{`TX-${String(transaction.id).padStart(3, "0")}`}</span></div><small>{transaction.detail}</small><time>{formatHistoryDate(transaction.createdAt)}</time></div><strong className={transaction.amount > 0 ? "positive" : "negative"}>{transaction.amount > 0 ? "+ " : "- "}{money(Math.abs(transaction.amount))}</strong></div>; })}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section>{walletOpen && <div className="modal-backdrop" onClick={() => setWalletOpen(null)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">WALLET TRANSACTION</span><h2>{walletOpen === "deposit" ? "เติมเงินเข้าบัญชีสมาชิก" : "ถอนเงินจากบัญชีสมาชิก"}</h2><p>{displayName} · {profile.memberNumber} · ยอดคงเหลือ {money(profile.balance)}</p></div><button className="icon-button" onClick={() => setWalletOpen(null)}><X size={17} /></button></div><div className="member-number-preview"><span><WalletCards size={16} /> ยอดคงเหลือหลังรายการ</span><b className={balanceAfterWallet < 0 ? "red-text" : ""}>{money(balanceAfterWallet)}</b></div>{balanceAfterWallet < 0 && <div className="notice-bar error"><ShieldCheck size={16} /> ยอดเงินคงเหลือไม่พอสำหรับถอนจำนวนนี้<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="form-grid compact-form"><label>จำนวนเงิน (฿) *<input autoFocus type="number" min="0" step="0.01" value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} placeholder="0.00" /></label><label className="wide">หมายเหตุ<input value={walletNote} onChange={(event) => setWalletNote(event.target.value)} placeholder={walletOpen === "deposit" ? "เช่น เติมเงินสดที่เคาน์เตอร์" : "เช่น ถอนเพื่อใช้จ่ายส่วนตัว"} /></label></div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setWalletOpen(null)}>ยกเลิก</button><button className="primary-button" disabled={walletMutation.isPending || !(Number(walletAmount) > 0) || balanceAfterWallet < 0} onClick={submitWallet}><Check size={16} /> {walletMutation.isPending ? "กำลังบันทึก…" : walletOpen === "deposit" ? "บันทึกการเติมเงิน" : "บันทึกการถอนเงิน"}</button></div></div></div>}<ConfirmDialog open={confirmStatus} title={profile.status === "active" ? "ยืนยันการระงับสมาชิก?" : "ยืนยันการคืนสถานะสมาชิก?"} description={profile.status === "active" ? `สมาชิก ${displayName} จะไม่สามารถใช้ยอดคงเหลือซื้อสินค้าได้จนกว่าจะเปิดใช้งานอีกครั้ง` : `สมาชิก ${displayName} จะสามารถใช้ยอดคงเหลือซื้อสินค้าและรับการเติมเงินได้อีกครั้ง`} confirmLabel={profile.status === "active" ? "ยืนยันระงับการใช้งาน" : "ยืนยันคืนสถานะการใช้งาน"} onCancel={() => setConfirmStatus(false)} onConfirm={() => { setConfirmStatus(false); statusMutation.mutate({ memberNumber: member.memberNumber, suspended: profile.status === "active", actor, actorRole }); }} />{editOpen && editForm && <div className="modal-backdrop" onClick={() => setEditOpen(false)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">EDIT MEMBER</span><h2>แก้ไขข้อมูลสมาชิก</h2><p>{displayName} · {profile.memberNumber}</p></div><button className="icon-button" onClick={() => setEditOpen(false)}><X size={17} /></button></div><div className="form-grid compact-form"><label>ชื่อ *<input autoFocus value={editForm.firstName} onChange={(event) => setEditForm({ ...editForm, firstName: event.target.value })} placeholder="ชื่อ" /></label><label>นามสกุล *<input value={editForm.lastName} onChange={(event) => setEditForm({ ...editForm, lastName: event.target.value })} placeholder="นามสกุล" /></label><label>ประเภทสมาชิก<select value={editForm.type} onChange={(event) => setEditForm({ ...editForm, type: event.target.value })}><option>สมาชิก</option><option>เจ้าหน้าที่</option></select></label><label>เบอร์โทรศัพท์<input value={editForm.phone} onChange={(event) => setEditForm({ ...editForm, phone: event.target.value })} placeholder="เช่น 08x-xxx-xxxx" /></label><label className="wide">เลขที่บัตรประชาชน<input value={editForm.idCard} onChange={(event) => setEditForm({ ...editForm, idCard: event.target.value })} placeholder="-" /></label></div><div className="initial-balance-note"><ShieldCheck size={15} /> การแก้ไขจะบันทึกลงระบบทันทีและบันทึกลง Log</div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setEditOpen(false)}>ยกเลิก</button><button className="primary-button" disabled={updateMutation.isPending || !editForm.firstName.trim() || !editForm.lastName.trim()} onClick={submitEdit}><Check size={16} /> {updateMutation.isPending ? "กำลังบันทึก…" : "บันทึกการแก้ไข"}</button></div></div></div>}<ConfirmDialog open={confirmDelete} title="ยืนยันการลบสมาชิก?" description={`ลบ ${displayName} (${member.memberNumber}) ออกจากระบบถาวร · ลบได้เฉพาะบัญชีที่ยอดเงินเป็น 0 และไม่มีประวัติธุรกรรม หากมีประวัติการใช้งาน แนะนำใช้การระงับการใช้งานแทน`} confirmLabel="ยืนยันลบสมาชิก" onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); deleteMutation.mutate({ memberNumber: member.memberNumber, actor, actorRole }); }} />{cardOpen && <MemberCardModal member={detailQuery.data?.member ?? { ...member, createdAt: new Date().toISOString() }} onClose={() => setCardOpen(false)} />}{statementOpen && <StatementModal member={detailQuery.data?.member ?? { ...member, createdAt: new Date().toISOString() }} transactions={transactions} onClose={() => setStatementOpen(false)} />}</>;
}

function Members({ role, userName, focusMemberNumber, onFocusMemberConsumed }: { role: Role; userName: string; focusMemberNumber: string | null; onFocusMemberConsumed: () => void }) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ทั้งหมด");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberLite | null>(null);
  const [newMember, setNewMember] = useState(emptyNewMember);
  const actor = userName || "ผู้ใช้ระบบ";
  const actorRole = role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่";
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);
  const allMembersQuery = trpc.member.list.useQuery();
  const statusParam = statusFilter === "ใช้งาน" ? "active" : statusFilter === "ระงับ" ? "suspended" : undefined;
  const hasFilter = Boolean(debouncedSearch) || statusParam !== undefined;
  const filteredQuery = trpc.member.list.useQuery(hasFilter ? { search: debouncedSearch || undefined, status: statusParam } : undefined, { placeholderData: (previous) => previous });
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const allMembers = allMembersQuery.data ?? [];
  useEffect(() => {
    if (!focusMemberNumber || allMembersQuery.isLoading || !allMembersQuery.isSuccess) return;
    const match = allMembers.find((row) => row.memberNumber === focusMemberNumber);
    if (match) setSelectedMember(match);
    onFocusMemberConsumed();
  }, [focusMemberNumber, allMembersQuery.isLoading, allMembersQuery.isSuccess, allMembers, onFocusMemberConsumed]);
  const rows = hasFilter ? (filteredQuery.data ?? []) : allMembers;
  const walletTotal = allMembers.reduce((sum, member) => sum + member.balance, 0);
  const activeCount = allMembers.filter((member) => member.status === "active").length;
  const suspendedCount = allMembers.length - activeCount;
  const newThisMonth = allMembers.filter((member) => isSameMonth(parseStoreDate(member.createdAt), new Date())).length;
  const numberMode = settingsQuery.data?.memberNumberMode ?? "running";
  const nextNumber = formatMemberNumber(numberMode, nextMemberSequence(allMembers, numberMode));
  const registerMutation = trpc.member.register.useMutation({
    onSuccess: (result) => {
      setRegisterOpen(false);
      setNewMember(emptyNewMember);
      setError("");
      setNotice(`ลงทะเบียนสมาชิก ${result.member.firstName} ${result.member.lastName} แล้ว · หมายเลข ${result.member.memberNumber}${result.member.balance > 0 ? ` · เงินเริ่มต้น ${money(result.member.balance)}` : " · ยังไม่เติมเงิน"}`);
      void utils.member.list.invalidate();
    },
    onError: (mutationError) => setError(getErrorMessage(mutationError)),
  });
  if (selectedMember) return <MemberDetail member={selectedMember} onBack={() => setSelectedMember(null)} role={role} userName={userName} onDeleted={(message) => { setSelectedMember(null); setNotice(message); }} />;
  const submitRegister = () => {
    if (!newMember.firstName.trim() || !newMember.lastName.trim()) { setError("กรุณาระบุชื่อและนามสกุลสมาชิก"); return; }
    if (numberMode === "manual" && !newMember.memberNumber.trim()) { setError("โหมดกำหนดหมายเลขเอง: กรุณาระบุหมายเลขสมาชิก"); return; }
    const initialBalance = newMember.initialBalance.trim() === "" ? undefined : Number(newMember.initialBalance);
    if (initialBalance !== undefined && !(initialBalance > 0)) { setError("เงินเริ่มต้นต้องมากกว่า 0"); return; }
    setError("");
    registerMutation.mutate({
      firstName: newMember.firstName.trim(),
      lastName: newMember.lastName.trim(),
      citizenId: newMember.idCard.trim() || undefined,
      phone: newMember.phone.trim() || undefined,
      type: newMember.type,
      memberNumber: numberMode === "manual" ? newMember.memberNumber.trim() : undefined,
      initialDeposit: initialBalance,
      actor,
      actorRole,
    });
  };
  return <><SectionHeader eyebrow="สมาชิกและบัญชีสวัสดิการ" title="จัดการสมาชิก" description="ลงทะเบียนสมาชิก ระบุเงินเริ่มต้น (ถ้ามี) ระงับการใช้งาน และดูประวัติรายบุคคล — สมาชิกใช้จ่ายที่เคาน์เตอร์ด้วยหมายเลขสมาชิก" action={<button className="primary-button" onClick={() => { setRegisterOpen(true); setError(""); }}><Plus size={16} /> ลงทะเบียนสมาชิก</button>} /><div className="member-scope-note" role="note"><span className="member-scope-icon"><IdCard size={16} /></span><div><b>ระบบสมาชิกแยกจากผู้ใช้ระบบ</b><small>บัญชีสมาชิกสวัสดิการใช้เพื่อใช้จ่ายที่เคาน์เตอร์เท่านั้น — สมาชิกไม่มีบัญชีเข้าสู่ระบบแอปนี้ · แอปนี้สำหรับเจ้าหน้าที่และผู้บริหารร้านค้า (จัดการบัญชีเข้าสู่ระบบที่เมนูผู้ใช้ระบบ)</small></div></div><div className="member-top-grid"><div className="member-balance-card"><div><span className="eyebrow">ยอดเงินในบัญชีสมาชิกทั้งหมด</span><strong>{money(walletTotal)}</strong><small>สมาชิกใช้งาน {activeCount} ราย · ระงับ {suspendedCount} ราย</small></div><div className="balance-orb"><WalletCards size={26} /></div></div><div className="member-mini-card"><span className="stat-icon green"><UsersRound size={18} /></span><div><small>สมาชิกทั้งหมด</small><strong>{allMembers.length.toLocaleString("th-TH")} <em>ราย</em></strong><p><span className="green-text">{activeCount} ใช้งาน</span> · {suspendedCount} ระงับ</p></div></div><div className="member-mini-card"><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>ลงทะเบียนเดือนนี้</small><strong>{newThisMonth} <em>ราย</em></strong><p>ข้อมูลสมาชิกใหม่ · ไม่รวมการเติมเงิน</p></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>สมาชิกทั้งหมด</h2><p>ค้นหาและกรองตามสถานะการใช้งานได้ทันที</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ หรือเลขสมาชิก" /></div><div className="filter-pills">{["ทั้งหมด", "ใช้งาน", "ระงับ"].map((item) => <button className={statusFilter === item ? "active" : ""} key={item} onClick={() => setStatusFilter(item)}>{item}{item === "ใช้งาน" && <span>{activeCount}</span>}{item === "ระงับ" && <span>{suspendedCount}</span>}</button>)}</div></div></div><div className="table-filter-summary"><span><Search size={13} /> {query ? `ค้นหา “${query}”` : "สมาชิกทั้งหมด"}</span><span>แสดง {rows.length} จาก {allMembers.length} รายการ</span></div><div className="table-wrap card-scroll"><div className="entity-grid member-card-grid" role="list" aria-label="รายการสมาชิก">{allMembersQuery.isLoading ? Array.from({ length: 8 }, (_, index) => <div className="entity-card member-card skeleton-card" key={`member-skeleton-${index}`} aria-hidden="true"><div className="member-card-head"><span className="skeleton-avatar" /><span className="skeleton-cell-w" /></div><div className="member-card-body"><span className="skeleton-cell-n" /><span className="skeleton-cell-n" /></div></div>) : allMembersQuery.isError ? <div className="entity-state error" role="alert"><ShieldCheck size={22} /><b>โหลดรายการสมาชิกไม่สำเร็จ</b><span>{getErrorMessage(allMembersQuery.error)}</span></div> : rows.length === 0 ? <div className="entity-state"><UsersRound size={22} /><b>ไม่พบสมาชิกตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ</span></div> : rows.map((row) => { const statusMeta = MEMBER_STATUS_META[row.status]; return <button type="button" role="listitem" className={`entity-card member-card${row.status === "suspended" ? " suspended" : ""}`} key={row.memberNumber} onClick={() => setSelectedMember(row)} title={`ดูรายละเอียด ${row.firstName} ${row.lastName}`}><div className="member-card-head"><span className="member-card-avatar">{row.firstName.slice(0, 1)}</span><div className="member-card-id"><b>{row.firstName} {row.lastName}</b><small>{row.memberNumber} · {row.type}</small></div><StatusPill tone={statusMeta.tone}>{statusMeta.label}</StatusPill></div><div className="member-card-body"><div className="member-card-balance"><small>ยอดเงินคงเหลือ</small><strong className={row.balance < 0 ? "negative" : ""}>{money(row.balance)}</strong></div><div className="member-card-activity"><small>รายการล่าสุด</small><span>{formatLastActivity(row.lastTransactionAt)}</span></div></div><div className="member-card-foot"><span>ดูรายละเอียด · เติม/ถอนเงิน</span><ArrowRight size={14} /></div></button>; })}</div></div>{rows.length === 0 && !allMembersQuery.isLoading && <div className="empty-filter"><UsersRound size={22} /><b>ไม่พบสมาชิกตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ</span></div>}{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section>{registerOpen && <div className="modal-backdrop" onClick={() => setRegisterOpen(false)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">MEMBER REGISTRATION</span><h2>ลงทะเบียนสมาชิก</h2><p>กรอกข้อมูลสมาชิกและเลือกเติมเงินครั้งแรกหรือไม่ก็ได้</p></div><button className="icon-button" onClick={() => setRegisterOpen(false)}><X size={17} /></button></div><div className="member-number-preview"><span><CreditCard size={16} /> {numberMode === "manual" ? "โหมดกำหนดหมายเลขสมาชิกด้วยตนเอง" : `หมายเลขสมาชิกจะกำหนดอัตโนมัติ (${numberMode === "year" ? "ขึ้นต้นด้วยปี" : "รันเลขต่อเนื่อง"})`}</span><b>{nextNumber}</b></div><div className="form-grid compact-form"><label>ชื่อ *<input autoFocus value={newMember.firstName} onChange={(event) => setNewMember({ ...newMember, firstName: event.target.value })} placeholder="ชื่อ" /></label><label>นามสกุล *<input value={newMember.lastName} onChange={(event) => setNewMember({ ...newMember, lastName: event.target.value })} placeholder="นามสกุล" /></label><label>ประเภทสมาชิก<select value={newMember.type} onChange={(event) => setNewMember({ ...newMember, type: event.target.value })}><option>สมาชิก</option><option>เจ้าหน้าที่</option></select></label><label>เบอร์โทรศัพท์<input value={newMember.phone} onChange={(event) => setNewMember({ ...newMember, phone: event.target.value })} placeholder="เช่น 08x-xxx-xxxx" /></label><label className="wide">เลขที่บัตรประชาชน<input value={newMember.idCard} onChange={(event) => setNewMember({ ...newMember, idCard: event.target.value })} placeholder="-" /></label>{numberMode === "manual" && <label className="wide">หมายเลขสมาชิก *<input value={newMember.memberNumber} onChange={(event) => setNewMember({ ...newMember, memberNumber: event.target.value })} placeholder="กำหนดหมายเลขเอง เช่น VIP-001" /></label>}<label className="wide">เงินเริ่มต้น (ถ้ามี)<input type="number" min="0" value={newMember.initialBalance} onChange={(event) => setNewMember({ ...newMember, initialBalance: event.target.value })} placeholder="เว้นว่างได้ หากยังไม่เติมเงิน" /></label></div><div className="initial-balance-note"><ShieldCheck size={15} /> เงินจำนวนนี้เป็นยอดเริ่มต้นตอนลงทะเบียน ไม่ใช่เมนูเติมเงินภายหลัง</div><div className="initial-balance-note scope"><IdCard size={15} /> สมาชิกไม่มีบัญชีเข้าสู่ระบบแอป — ใช้หมายเลขสมาชิกนี้ระบุตัวตนที่เคาน์เตอร์เพื่อใช้จ่าย (พิมพ์บัตรสมาชิกได้จากหน้ารายละเอียดของสมาชิกแต่ละราย)</div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setRegisterOpen(false)}>ยกเลิก</button><button className="primary-button" disabled={registerMutation.isPending} onClick={submitRegister}><Check size={16} /> {registerMutation.isPending ? "กำลังบันทึก…" : "บันทึกสมาชิก"}</button></div></div></div>}</>;
}

function Reports({ focusBill, onFocusBillConsumed }: { focusBill: string | null; onFocusBillConsumed: () => void }) {
  const dailyQuery = trpc.reports.daily.useQuery({ days: 30 });
  const logsQuery = trpc.logs.list.useQuery({ limit: 1000 });
  const [period, setPeriod] = useState("รายวัน");
  const [notice, setNotice] = useState("");
  const [billSearch, setBillSearch] = useState("");
  const [debouncedBillSearch, setDebouncedBillSearch] = useState("");
  // Render caps (round 15): daily-sales rows + bills history start collapsed.
  const [dailyVisible, setDailyVisible] = useState(14);
  const [billsVisible, setBillsVisible] = useState(15);
  const [viewedReceipt, setViewedReceipt] = useState<SaleHistoryEntry | null>(null);
  const salesHistoryQuery = trpc.sales.list.useQuery(debouncedBillSearch ? { search: debouncedBillSearch } : undefined, { placeholderData: (previous) => previous });
  const salesHistory = salesHistoryQuery.data ?? [];
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBillSearch(billSearch.trim()), 350);
    return () => clearTimeout(timer);
  }, [billSearch]);
  // A new search / period returns both capped lists to their first page.
  useEffect(() => { setBillsVisible(15); }, [debouncedBillSearch]);
  useEffect(() => { setDailyVisible(14); }, [period]);
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
  const reportRows = useMemo(() => {
    const sum = (list: typeof dailyRows) => list.reduce((acc, row) => ({ orders: acc.orders + row.orders, items: acc.items + row.items, revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, profit: acc.profit + row.profit }), { orders: 0, items: 0, revenue: 0, cogs: 0, profit: 0 });
    if (dailyRows.length === 0) return [] as { label: string; orders: number; items: number; revenue: number; cogs: number; profit: number }[];
    if (period === "รายเดือน") {
      const totals = sum(dailyRows);
      return [{ label: formatThaiMonthYear(dailyRows[dailyRows.length - 1].date), ...totals }];
    }
    if (period === "รายสัปดาห์") {
      const weeks: { label: string; orders: number; items: number; revenue: number; cogs: number; profit: number }[] = [];
      for (let start = 0; start < dailyRows.length; start += 7) {
        const chunk = dailyRows.slice(start, start + 7);
        weeks.push({ label: `${formatShortDay(chunk[0].date)}–${formatShortDay(chunk[chunk.length - 1].date)}`, ...sum(chunk) });
      }
      return weeks;
    }
    const shown = period === "รายวัน" ? dailyRows.slice(-7) : dailyRows;
    return shown.map((row) => ({ label: formatShortDay(row.date), orders: row.orders, items: row.items, revenue: row.revenue, cogs: row.cogs, profit: row.profit }));
  }, [dailyRows, period]);
  const totals = reportRows.reduce((acc, row) => ({ orders: acc.orders + row.orders, items: acc.items + row.items, revenue: acc.revenue + row.revenue, cogs: acc.cogs + row.cogs, profit: acc.profit + row.profit }), { orders: 0, items: 0, revenue: 0, cogs: 0, profit: 0 });
  const marginPercent = totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : "0.0";
  const maxRevenue = Math.max(...reportRows.map((row) => row.revenue), 1);
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
  const downloadDailySalesPdf = async () => {
    const element = document.getElementById("daily-sales-report");
    if (!element) return;
    const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff", ignoreElements: (node) => node.classList.contains("table-show-more") });
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
    pdf.save("daily-sales-summary.pdf");
    setNotice("ดาวน์โหลดรายงานยอดขาย PDF แล้ว");
  };
  const rangeLabel = dailyRows.length > 0 ? `${formatThaiDate(dailyRows[0].date)} – ${formatThaiDate(dailyRows[dailyRows.length - 1].date)}` : formatThaiDate(new Date());
  return <><SectionHeader eyebrow="สรุปผลและวิเคราะห์ข้อมูล" title="รายงาน" description="เลือกช่วงเวลา รายบุคคล หรือหมวดรายงานเพื่อดูและส่งออกข้อมูล" action={<button className="outline-button" onClick={() => setNotice("เปิดตัวเลือกช่วงวันที่แล้ว")}><CalendarDays size={16} /> {formatThaiDate(new Date())} <ChevronDown size={15} /></button>} /><div className="report-tabs">{["รายวัน", "รายสัปดาห์", "รายเดือน", "กำหนดช่วงเวลา"].map((item) => <button className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)}>{item}</button>)}</div><div className="report-cards"><div className="report-card"><span>ยอดขายสินค้า</span><strong>{dailyQuery.isLoading ? "…" : money(totals.revenue)}</strong><small>{totals.orders.toLocaleString("th-TH")} บิล · ช่วง{period}</small><div className="sparkline teal-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>เติมเงินสมาชิก</span><strong>{logsQuery.isLoading ? "…" : money(walletTotals.deposit)}</strong><small>{walletTotals.depositCount} รายการ · จากระบบ Log</small><div className="sparkline purple-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>ถอนเงินสมาชิก</span><strong>{logsQuery.isLoading ? "…" : money(walletTotals.withdraw)}</strong><small>{walletTotals.withdrawCount} รายการ · จากระบบ Log</small><div className="sparkline amber-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>กำไรขั้นต้นโดยประมาณ</span><strong>{dailyQuery.isLoading ? "…" : money(totals.profit)}</strong><small className="green-text">คิดเป็น {marginPercent}% ของยอดขาย</small><div className="sparkline green-spark"><i /><i /><i /><i /><i /><i /><i /></div></div></div><div className="dashboard-grid report-lower" id="daily-sales-report"><section className="panel"><div className="panel-heading"><div><h2>สรุปยอดขายรายวัน</h2><p>{period} · {rangeLabel}</p></div><div className="report-export-actions"><button className="outline-button compact" onClick={downloadDailySalesCsv}><Download size={15} /> CSV</button><button className="outline-button compact" onClick={downloadDailySalesPdf}><FileBarChart size={15} /> PDF</button></div></div><div className="category-report">{dailyQuery.isLoading ? <div className="table-loading"><FileBarChart size={22} /><b>กำลังโหลดรายงานยอดขาย</b><span>ดึงข้อมูล 30 วันล่าสุดจากระบบ</span></div> : dailyQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(dailyQuery.error)}</span></div> : reportRows.length === 0 ? <div className="table-loading"><FileBarChart size={22} /><b>ยังไม่มีข้อมูลการขาย</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน</span></div> : reportRows.slice(0, dailyVisible).map((row, index) => <div className="category-row" key={row.label}><div><b>{row.label}</b><span>{row.orders} บิล · {row.items} ชิ้น · กำไร {money(row.profit)}</span></div><div className={`progress ${["", "blue", "purple", "amber"][index % 4]}`}><i style={{ width: `${Math.round((row.revenue / maxRevenue) * 100)}%` }} /></div><strong>{money(row.revenue)}</strong></div>)}</div>{reportRows.length > 14 && (dailyVisible < reportRows.length ? <button type="button" className="table-show-more" onClick={() => setDailyVisible((current) => current + 14)}><ChevronDown size={15} /> แสดงยอดขายรายวันเพิ่มอีก <b>{reportRows.length - dailyVisible}</b> รายการ</button> : <div className="table-show-more done">แสดงทั้งหมด {reportRows.length} รายการแล้ว</div>)}</section><section className="panel"><div className="panel-heading"><div><h2>การส่งออกข้อมูล</h2><p>ไฟล์พร้อมดาวน์โหลดตามสิทธิ์ของคุณ</p></div><FileBarChart size={19} className="muted-icon" /></div><div className="export-list"><button onClick={downloadDailySalesCsv}><span className="file-icon csv">CSV</span><span><b>รายงานยอดขาย.csv</b><small>สรุปยอดขายรายวัน · 30 วันล่าสุด</small></span><Download size={16} /></button><button onClick={downloadDailySalesPdf}><span className="file-icon pdf">PDF</span><span><b>รายงานยอดขาย.pdf</b><small>สรุปยอดขายรายวัน · 30 วันล่าสุด</small></span><Download size={16} /></button><button onClick={() => setNotice("ส่งออกรายงานเป็น CSV แล้ว")}><span className="file-icon csv">CSV</span><span><b>ประวัติธุรกรรม.csv</b><small>ข้อมูลรายการทั้งหมด · วันนี้</small></span><Download size={16} /></button></div></section></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>ประวัติบิล</h2><p>ค้นหาและพิมพ์ใบเสร็จย้อนหลังได้ทันที · แสดง 50 บิลล่าสุด · รวม {salesHistory.length} บิล</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={billSearch} onChange={(event) => setBillSearch(event.target.value)} placeholder="ค้นหาเลขที่บิล หรือเลขสมาชิก" /></div></div></div><div className="table-filter-summary"><span><Search size={13} /> {billSearch ? `ค้นหา “${billSearch}”` : "บิลล่าสุดจากระบบ"}</span><span>แสดง <b>{Math.min(billsVisible, salesHistory.length)}</b> จาก <b>{salesHistory.length}</b> บิล</span></div><div className="table-wrap card-scroll"><div className="entity-grid bill-card-grid" role="list" aria-label="ประวัติบิล">{salesHistoryQuery.isLoading ? Array.from({ length: 6 }, (_, index) => <div className="entity-card bill-card skeleton-card" key={`bill-skeleton-${index}`} aria-hidden="true"><div className="bill-card-head"><span className="skeleton-cell-w" /><span className="skeleton-cell-n" /></div><div className="bill-card-body"><span className="skeleton-cell-w" /><span className="skeleton-cell-n" /></div></div>) : salesHistoryQuery.isError ? <div className="entity-state error" role="alert"><ShieldCheck size={22} /><b>โหลดประวัติบิลไม่สำเร็จ</b><span>{getErrorMessage(salesHistoryQuery.error)}</span></div> : salesHistory.length === 0 ? <div className="entity-state"><ReceiptText size={22} /><b>ไม่พบบิลตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหา</span></div> : salesHistory.slice(0, billsVisible).map((entry) => { const paymentTone = PAYMENT_PILL_TONE[entry.paymentMethod] ?? "amber"; return <button type="button" role="listitem" className="entity-card bill-card" key={entry.orderNumber} onClick={() => setViewedReceipt(entry)} title={`ดูใบเสร็จ ${entry.orderNumber}`}><div className="bill-card-head"><b className="bill-number">{entry.orderNumber}</b><StatusPill tone={paymentTone}>{entry.paymentMethod}</StatusPill></div><div className="bill-card-body"><div className="bill-card-buyer"><b>{entry.memberName ? `สมาชิก${entry.memberName}` : "บุคคลทั่วไป"}</b>{entry.memberNumber && <small>{entry.memberNumber}</small>}</div><div className="bill-card-items"><span>{entry.items[0]?.name ?? "—"}{entry.items.length > 1 ? ` +${entry.items.length - 1} รายการ` : ""}</span></div><small className="bill-card-time">{formatLogDateTime(entry.createdAt)}</small></div><div className="bill-card-foot"><strong>{money(entry.total)}</strong><span className="bill-card-open">ดูใบเสร็จ <ArrowRight size={14} /></span></div></button>; })}</div></div>{!salesHistoryQuery.isLoading && !salesHistoryQuery.isError && (billsVisible < salesHistory.length ? <button type="button" className="table-show-more" onClick={() => setBillsVisible((current) => current + 15)}><ChevronDown size={15} /> แสดงบิลเพิ่มอีก <b>{salesHistory.length - billsVisible}</b> บิล</button> : salesHistory.length > 15 && <div className="table-show-more done">แสดงทั้งหมด {salesHistory.length} บิลแล้ว</div>)}</section>{viewedReceipt && <ReceiptModal receipt={viewedReceipt} onClose={() => setViewedReceipt(null)} mode="reprint" />}{notice && <div className="notice-bar floating-notice"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</>;
}

type SettingsTab = "brand" | "receipt" | "member" | "payment" | "display" | "alert" | "roles" | "log";

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
  const saveSettings = () => {
    if (!form) return;
    setSaved(false);
    saveMutation.mutate(form);
  };
  const chooseFontScale = (id: FontScaleId) => {
    setFontScale(id);
    applyFontScale(id);
  };
  // ROUND 25 — แบรนด์และธีม: พรีวิวสี/ชื่อ/โลโก้สดก่อนบันทึก
  const logoInputRef = useRef<HTMLInputElement>(null);
  const chooseTheme = (theme: string) => {
    updateForm({ appTheme: theme });
    applyThemeColor(theme); // พรีวิวทันที — ทุกเครื่องใช้จริงหลังกดบันทึก
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
    { id: "display", label: "การแสดงผล", icon: Monitor },
    { id: "alert", label: "การแจ้งเตือน", icon: Bell },
    { id: "roles", label: "สิทธิ์และบทบาท", icon: ShieldCheck },
    { id: "log", label: "การบันทึก Log", icon: Activity },
  ];
  const logs = logsStatsQuery.data ?? [];
  const lastLog = logs[0];
  return <><SectionHeader eyebrow="ระบบและการกำหนดค่า" title="ตั้งค่า" description="จัดการข้อมูลร้านค้า ใบเสร็จ การชำระเงิน การแจ้งเตือน และการแสดงผลของระบบ" action={<button className="primary-button" disabled={!form || saveMutation.isPending} onClick={saveSettings}><Check size={16} /> {saveMutation.isPending ? "กำลังบันทึก…" : dirtyCount > 0 ? `บันทึกการตั้งค่า · ${dirtyCount} รายการ` : "บันทึกการตั้งค่า"}</button>} /><div className="settings-layout"><div className="settings-nav" role="tablist" aria-label="หมวดการตั้งค่า">{tabs.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={17} /> {label}</button>)}</div><div className="settings-content">{tab === "brand" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>ชื่อร้านและโลโก้</h2><p>ชื่อและโลโก้จะแสดงบนหน้าจอ แถบเมนู หน้าเข้าสู่ระบบ และหัวใบเสร็จ</p></div><Palette size={20} className="muted-icon" /></div><div className="form-grid"><label className="wide">ชื่อแอป / ร้านค้า<input value={form?.appName ?? ""} onChange={(event) => updateForm({ appName: event.target.value })} placeholder="เช่น ร้านค้าสวัสดิการ" disabled={!form} maxLength={80} /></label><label className="wide">โลโก้ร้านค้า<div className="logo-uploader">{form?.appLogo ? <img className="logo-preview" src={form.appLogo} alt="โลโก้ปัจจุบัน" /> : <span className="logo-empty"><ImageIcon size={20} /></span>}<div className="logo-actions"><div className="logo-button-row"><button type="button" className="outline-button compact" disabled={!form} onClick={() => logoInputRef.current?.click()}><ImagePlus size={15} /> {form?.appLogo ? "เปลี่ยนรูป" : "เลือกรูปโลโก้"}</button>{form?.appLogo && <button type="button" className="danger-outline-button compact" disabled={!form} onClick={() => updateForm({ appLogo: "" })}><Trash2 size={15} /> ลบโลโก้</button>}</div><small>รองรับ PNG JPG WEBP SVG · ระบบย่อเป็น 256px อัตโนมัติ · ไม่ใส่ก็ได้ จะใช้อักษรย่อแทน</small></div><input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={onLogoPick} /></div></label></div><div className="brand-live-preview" aria-label="ตัวอย่างหน้าจอ"><span className="eyebrow">ตัวอย่างการแสดงผล</span><div className="brand-preview-card">{(form?.appLogo ?? "") ? <img src={form?.appLogo ?? ""} alt="" /> : <div className="brand-mark"><span>{brandInitial(form?.appName || "ร้านค้าสวัสดิการ")}</span></div>}<div><b>{(form?.appName ?? "").trim() || "ร้านค้าสวัสดิการ"}</b><small>Welfare Store</small></div></div></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>สีธีมของแอป</h2><p>สีหลักของระบบ — ปุ่ม แถบเมนู จุดเน้นทั้งแอป · เห็นพรีวิวทันที กดบันทึกเพื่อใช้กับทุกเครื่อง</p></div><Palette size={20} className="muted-icon" /></div><div className="theme-swatches">{THEME_PRESETS.map((preset) => <button type="button" key={preset.id} className={`theme-swatch${(form?.appTheme ?? "") === preset.id ? " active" : ""}`} onClick={() => chooseTheme(preset.id)}><span className="swatch-dot" style={{ background: preset.base }} /><b>{preset.label}</b><small>{preset.base.toUpperCase()}</small></button>)}</div><div className="theme-custom-row"><span>สีกำหนดเอง</span><input type="color" value={customThemeHex} onChange={(event) => chooseTheme(event.target.value)} aria-label="เลือกสีธีมกำหนดเอง" /><code>{customThemeHex.toUpperCase()}</code><small>เลือกจากพาเลตต์ด้านบน หรือกำหนดโค้ดสีเอง</small></div></section></>}{tab === "receipt" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>ข้อมูลร้านค้า</h2><p>ข้อมูลจะแสดงบนหัวใบเสร็จและรายงาน</p></div><ShoppingBag size={20} className="muted-icon" /></div><div className="form-grid"><label>ชื่อร้านค้า<input value={form?.storeName ?? ""} onChange={(event) => updateForm({ storeName: event.target.value })} placeholder="ชื่อร้านค้า" disabled={!form} /></label><label>รหัสร้านค้า<input value={form?.storeCode ?? ""} onChange={(event) => updateForm({ storeCode: event.target.value })} placeholder="รหัสร้านค้า" disabled={!form} /></label><label className="wide">ที่อยู่<input value={form?.storeAddress ?? ""} onChange={(event) => updateForm({ storeAddress: event.target.value })} placeholder="ที่อยู่" disabled={!form} /></label></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ใบเสร็จรับเงิน</h2><p>กำหนดรายละเอียดที่ต้องการแสดงบนใบเสร็จ</p></div><ReceiptText size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน</b><small>เปิดหน้าต่างพิมพ์ทันทีที่ชำระเงินสำเร็จที่ POS</small></div><button className={`toggle ${form?.autoPrintReceipt ? "on" : ""}`} onClick={() => updateForm({ autoPrintReceipt: !form?.autoPrintReceipt })} disabled={!form} aria-label="พิมพ์ใบเสร็จอัตโนมัติ"><span /></button></div><div className="toggle-row"><div><b>แสดงยอดคงเหลือสมาชิกบนใบเสร็จ</b><small>แสดงยอดคงเหลือหลังรายการ ในบิลที่ชำระแบบหักบัญชีสมาชิก</small></div><button className={`toggle ${form?.showBalanceOnReceipt ? "on" : ""}`} onClick={() => updateForm({ showBalanceOnReceipt: !form?.showBalanceOnReceipt })} disabled={!form} aria-label="แสดงยอดคงเหลือบนใบเสร็จ"><span /></button></div></section></>}{tab === "member" && <section className="panel settings-card"><div className="settings-heading"><div><h2>การกำหนดหมายเลขสมาชิก</h2><p>เลือกวิธีสร้างหมายเลขสำหรับสมาชิกใหม่ที่จะลงทะเบียน</p></div><CreditCard size={20} className="muted-icon" /></div><div className="number-mode-grid">{[["running", "รันเลขต่อเนื่อง", "M-000001, M-000002, ..."], ["year", "ขึ้นต้นด้วยปี", "69-00001, 69-00002, ..."], ["manual", "กำหนดเอง", "เจ้าหน้าที่กรอกหมายเลขเอง"]].map(([value, title, detail]) => <button className={numberMode === value ? "selected" : ""} key={value} onClick={() => updateForm({ memberNumberMode: value as SettingsForm["memberNumberMode"] })} disabled={!form}><span className="number-radio">{numberMode === value && <i />}</span><span><b>{title}</b><small>{detail}</small></span></button>)}</div><div className="number-preview"><span>ตัวอย่างสมาชิกถัดไป</span><b>{nextNumber}</b></div></section>}{tab === "payment" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>รูปแบบการชำระเงินที่รองรับ</h2><p>วิธีชำระเงินที่เจ้าหน้าที่สามารถใช้ได้ที่หน้าร้าน / POS</p></div><WalletCards size={20} className="muted-icon" /></div><div className="payment-method-list"><div className="payment-method-row"><span className="pay-icon cash"><WalletCards size={19} /></span><div><b>เงินสด</b><small>รับเงินสดที่เคาน์เตอร์ · เหมาะกับบุคคลทั่วไปที่ไม่ได้เป็นสมาชิก</small></div><StatusPill tone="green">ใช้งานได้</StatusPill></div><div className="payment-method-row"><span className="pay-icon qr"><CreditCard size={19} /></span><div><b>QR / สแกน</b><small>ลูกค้าสแกนจ่ายผ่านแอปธนาคาร แล้วเจ้าหน้าที่กดยืนยันบิล</small></div><StatusPill tone="blue">ใช้งานได้</StatusPill></div><div className="payment-method-row"><span className="pay-icon member"><UsersRound size={19} /></span><div><b>หักบัญชีสมาชิก</b><small>หักยอดจากบัญชีสวัสดิการทันที · ต้องเลือกสมาชิกในบิลก่อนกดชำระ และสมาชิกต้องไม่ถูกระงับ</small></div><StatusPill tone="purple">ใช้งานได้</StatusPill></div></div><div className="settings-inline-note"><ShieldCheck size={16} /><span>การเติมเงินและถอนเงินสมาชิก ทำที่หน้าร้านผ่านทางลัด F2 / F3 · สมาชิกใช้จ่ายที่เคาน์เตอร์ด้วยหมายเลขสมาชิกเท่านั้น</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("pos")}><ArrowRight size={16} /> ไปที่หน้าร้าน / POS</button></div></section></>}{tab === "display" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>ขนาดตัวอักษร</h2><p>ปรับขนาดตัวอักษรทั้งระบบให้อ่านง่ายขึ้น · มีผลทันที</p></div><Monitor size={20} className="muted-icon" /></div><div className="number-mode-grid">{FONT_SCALES.map((scale) => <button className={fontScale === scale.id ? "selected" : ""} key={scale.id} onClick={() => chooseFontScale(scale.id)}><span className="number-radio">{fontScale === scale.id && <i />}</span><span><b>{scale.label} · {Math.round(scale.zoom * 100)}%</b><small>{scale.detail}</small></span></button>)}</div><div className="font-scale-sample"><span>ตัวอย่างข้อความ</span><b>ร้านค้าสวัสดิการ · ยอดรวม ฿1,234.56</b><small>สมาชิก M-000001 · บิล RC-260918-010 · 18 ก.ย. 2569</small></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>การแสดงผลของอุปกรณ์</h2><p>การตั้งค่านี้เก็บในเครื่องที่ใช้อยู่ ไม่กระทบเครื่องอื่น</p></div><Monitor size={20} className="muted-icon" /></div><div className="settings-inline-note"><Monitor size={16} /><span>ขนาดตัวอักษรจะคงอยู่บนเครื่องนี้ทุกครั้งที่เปิดแอป · ไม่ต้องบันทึก · ไม่มีผลกับการพิมพ์ใบเสร็จและบัตรสมาชิก ซึ่งใช้ขนาดมาตรฐานของกระดาษเสมอ</span></div></section></>}{tab === "alert" && <section className="panel settings-card"><div className="settings-heading"><div><h2>การแจ้งเตือน</h2><p>ช่วยให้เจ้าหน้าที่ติดตามรายการสำคัญได้ทันเวลา</p></div><Bell size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>แจ้งเตือนเมื่อสมาชิกมียอดคงเหลือต่ำ</b><small>แสดงในกระดิ่งแจ้งเตือนเมื่อยอดต่ำกว่า {money(form?.lowBalanceThreshold ?? 100)}</small></div><div className="toggle-row-controls"><label className="threshold-input" title="เกณฑ์ยอดคงเหลือต่ำ (บาท)"><span>฿</span><input type="number" min={0} step={1} inputMode="numeric" aria-label="เกณฑ์ยอดคงเหลือต่ำ (บาท)" placeholder="100" value={thresholdText} onChange={(event) => { const digits = event.target.value.replace(/[^0-9]/g, ""); setThresholdText(digits); updateForm({ lowBalanceThreshold: digits === "" ? 0 : Number(digits) }); }} disabled={!form} /></label><button className={`toggle ${form?.lowBalanceAlert ? "on" : ""}`} onClick={() => updateForm({ lowBalanceAlert: !form?.lowBalanceAlert })} disabled={!form} aria-label="แจ้งเตือนยอดคงเหลือต่ำ"><span /></button></div></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดสต็อก</b><small>แจ้งเตือนเมื่อจำนวนต่ำกว่าจุดสั่งซื้อ</small></div><button className={`toggle ${form?.lowStockAlert ? "on" : ""}`} onClick={() => updateForm({ lowStockAlert: !form?.lowStockAlert })} disabled={!form} aria-label="แจ้งเตือนสต็อกต่ำ"><span /></button></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดอายุ</b><small>แจ้งเตือนล่วงหน้า {form?.expiryAlertDays ?? 30} วัน</small></div><button className={`toggle ${form?.expiryAlert ? "on" : ""}`} onClick={() => updateForm({ expiryAlert: !form?.expiryAlert })} disabled={!form} aria-label="แจ้งเตือนใกล้หมดอายุ"><span /></button></div></section>}{tab === "roles" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>สิทธิ์และบทบาทผู้ใช้ระบบ</h2><p>สิทธิ์ตามที่ระบบบังคับใช้จริงในปัจจุบัน</p></div><ShieldCheck size={20} className="muted-icon" /></div><div className="role-matrix">{ROLE_MATRIX.map((entry) => <div className={`role-matrix-card ${entry.role}`} key={entry.role}><div className="role-matrix-head"><span className="role-avatar small"><Crown size={17} /></span><div><b>{entry.title}</b><small>{entry.caption}</small></div></div><ul>{entry.permits.map((permit) => <li key={permit}><Check size={14} /> {permit}</li>)}</ul></div>)}</div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ข้อควรทราบ</h2><p>ความปลอดภัยของระบบ</p></div><LockKeyhole size={20} className="muted-icon" /></div><div className="settings-inline-note"><LockKeyhole size={16} /><span>บัญชีผู้ใช้ระบบถูกระงับชั่วคราวเมื่อกรอกรหัสผ่านผิด 5 ครั้ง และปลดล็อกอัตโนมัติใน 15 นาที · ผู้บริหารสามารถปลดล็อกก่อนกำหนดได้ที่หน้าผู้ใช้ระบบ</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("users")}><ArrowRight size={16} /> ไปที่หน้าผู้ใช้ระบบ</button></div></section></>}{tab === "log" && <><section className="panel settings-card"><div className="settings-heading"><div><h2>การบันทึก Log</h2><p>ระบบบันทึกทุกกิจกรรมสำคัญอัตโนมัติ พร้อมชื่อผู้ทำรายการและเวลา</p></div><Activity size={20} className="muted-icon" /></div><div className="log-settings-grid"><div className="log-settings-stat"><span>รายการล่าสุดในระบบ</span><strong>{logsStatsQuery.isLoading ? "…" : logs.length.toLocaleString("th-TH")}</strong><small>แสดงไม่เกิน 200 รายการล่าสุด</small></div><div className="log-settings-stat"><span>กิจกรรมล่าสุด</span><strong>{lastLog ? formatLogDateTime(lastLog.createdAt) : "—"}</strong><small>{lastLog ? `${lastLog.actor} · ${lastLog.action}` : "ยังไม่มีข้อมูล"}</small></div></div><div className="settings-inline-note"><Activity size={16} /><span>ตัวอย่างกิจกรรมที่บันทึก: ขายสินค้า · เติมเงิน · ถอนเงิน · รับสินค้าเข้า · นับสต็อก · แก้ไขสินค้า · ลงทะเบียนสมาชิก · จัดการผู้ใช้ระบบ · การตั้งค่า</span></div><div className="settings-jump"><button className="outline-button" onClick={() => setView("logs")}><ArrowRight size={16} /> ไปที่ระบบ Log</button></div></section></>}{dirtyCount > 0 && form && <div className="settings-save-bar" role="status" aria-live="polite"><span className="save-dot" aria-hidden="true" /><div className="save-bar-text"><b>มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก</b><small>แก้ไขแล้ว: {dirtyKeys.slice(0, 3).join(" · ")}{dirtyCount > 3 ? ` และอีก ${dirtyCount - 3} รายการ` : ""}</small></div><div className="save-bar-actions"><button type="button" className="outline-button" disabled={saveMutation.isPending} onClick={discardChanges}>ย้อนการแก้ไข</button><button type="button" className="primary-button" disabled={saveMutation.isPending} onClick={saveSettings}><Check size={16} /> {saveMutation.isPending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}</button></div></div>}{saved && <div className="notice-bar"><Check size={16} /> บันทึกการตั้งค่าเรียบร้อยแล้ว<button onClick={() => setSaved(false)}><X size={14} /></button></div>}{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}</div></div></>;
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
  return <><SectionHeader eyebrow="ตรวจสอบย้อนหลังและความโปร่งใส" title="ระบบ Log" description="บันทึกทุกกิจกรรมสำคัญของผู้ใช้งานและธุรกรรมในระบบ" action={<button className="outline-button" onClick={downloadLogsCsv}><Download size={16} /> ส่งออก Log</button>} /><div className="log-summary"><div><Activity size={18} /><span>รายการวันนี้<strong>{todayCount}</strong></span></div><div><ShieldCheck size={18} /><span>ผู้ใช้งานในระบบ<strong>{actorCount}</strong></span></div><div><ReceiptText size={18} /><span>ธุรกรรมที่บันทึก<strong>100%</strong></span></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>กิจกรรมทั้งหมด</h2><p>ข้อมูลสำหรับตรวจสอบย้อนหลังของเจ้าหน้าที่และผู้บริหาร</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหากิจกรรม หรือผู้ใช้งาน" /></div><div className="date-range-filter"><div className="search-field" title="ตั้งแต่วันที่"><CalendarDays size={15} /><input type="date" value={dateFrom} max={dateTo || undefined} aria-label="กรองตั้งแต่วันที่" onChange={(event) => setDateFrom(event.target.value)} /></div><span className="date-range-sep">→</span><div className="search-field" title="ถึงวันที่"><CalendarDays size={15} /><input type="date" value={dateTo} min={dateFrom || undefined} aria-label="กรองถึงวันที่" onChange={(event) => setDateTo(event.target.value)} /></div>{(dateFrom || dateTo) && <button type="button" className="date-range-clear" aria-label="ล้างตัวกรองช่วงเวลา" title="ล้างตัวกรองช่วงเวลา" onClick={() => { setDateFrom(""); setDateTo(""); }}><X size={15} /></button>}</div></div></div><div className="table-filter-summary"><span><Search size={13} /> {query || dateFrom || dateTo ? <>กรองตามเงื่อนไข{(dateFrom || dateTo) ? ` · ${dateFrom || "เริ่มต้น"} ถึง ${dateTo || "ปัจจุบัน"}` : ""}</> : "กิจกรรมทั้งหมด"}</span><span>แสดง <b>{Math.min(visible, filtered.length)}</b> จาก <b>{filtered.length}</b> รายการ</span></div><div className="table-wrap card-scroll"><div className="log-timeline" role="list" aria-label="รายการกิจกรรม">{logsQuery.isLoading ? Array.from({ length: 8 }, (_, index) => <div className="log-timeline-item skeleton-card" key={`log-skeleton-${index}`} aria-hidden="true"><span className="skeleton-avatar" /><div className="skeleton-stack"><span className="skeleton-cell-w" /><span className="skeleton-cell-n" /></div></div>) : logsQuery.isError ? <div className="entity-state error" role="alert"><ShieldCheck size={22} /><b>โหลดรายการ Log ไม่สำเร็จ</b><span>{getErrorMessage(logsQuery.error)}</span></div> : filtered.length === 0 ? <div className="entity-state"><Activity size={22} /><b>ไม่พบกิจกรรมตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือช่วงวันที่</span></div> : filtered.slice(0, visible).map((log) => <div className={`log-timeline-item tone-${log.tone ?? "green"}`} role="listitem" key={log.id}><span className="log-dot" aria-hidden="true" /><div className="log-content"><div className="log-head"><b>{log.action}</b><span className="log-time">{formatLogDateTime(log.createdAt)}</span></div><div className="log-detail"><span className="log-actor">{log.actor}</span>{log.actorRole && <small className="log-role">{log.actorRole}</small>}</div><p className="log-note">{log.detail}</p></div></div>)}</div></div>{visible < filtered.length ? <button type="button" className="table-show-more" onClick={() => setVisible((current) => current + 30)}><ChevronDown size={15} /> แสดงรายการเพิ่มอีก <b>{filtered.length - visible}</b> รายการ</button> : filtered.length > 30 && <div className="table-show-more done">แสดงทั้งหมด {filtered.length} รายการแล้ว</div>}{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section></>;
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
  const role: Role = user.role === "admin" ? "admin" : "staff";
  const profileName = user.name ?? "ผู้ใช้ระบบ";
  const profileAvatar = profileName.slice(0, 1);
  // ROUND 25 — แบรนด์ที่ผู้บริหารตั้งเอง (ตั้งค่า → แบรนด์และธีม)
  const appName = (brand?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const appLogo = brand?.appLogo ?? "";
  const safeView = canAccessView(role, activeView) ? activeView : "dashboard";
  const pageTitle = navItems.find((item) => item.id === safeView)?.label ?? (safeView === "settings" ? "ตั้งค่า" : safeView === "logs" ? "ระบบ Log" : safeView === "users" ? "ผู้ใช้ระบบ" : "ภาพรวม");
  const logout = () => { if (!logoutMutation.isPending) logoutMutation.mutate(); };
  return <div className={safeView === "pos" ? "app-shell pos-terminal" : "app-shell"}>{safeView === "pos" && <aside className="pos-rail" aria-label="เมนูด่วนหน้าร้าน"><div className="rail-brand" title={appName}>{appLogo ? <img className="brand-logo" src={appLogo} alt={appName} /> : <span className="brand-mark">{brandInitial(appName)}</span>}<span className="rail-caption">POS</span></div><button type="button" className="rail-btn" title="โฟกัสช่องสแกนบาร์โค้ด — พร้อมรับค่าเสมอ" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "scan" }))}><ScanLine size={20} /><b>สแกน</b></button><button type="button" className="rail-btn" title="เลือกลูกค้า / สมาชิกสำหรับบิลนี้" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "member" }))}><UsersRound size={20} /><b>ลูกค้า</b></button><button type="button" className={`rail-btn${posShortcut === "เติมเงิน" ? " active" : ""}`} title="เติมเงินเข้าบัญชีสมาชิก (F2)" onClick={() => setPosShortcut(posShortcut === "เติมเงิน" ? "" : "เติมเงิน")}><ArrowDownToLine size={20} /><b>เติมเงิน</b><kbd>F2</kbd></button><button type="button" className={`rail-btn${posShortcut === "ถอนเงิน" ? " active" : ""}`} title="ถอนเงินจากบัญชีสมาชิก (F3)" onClick={() => setPosShortcut(posShortcut === "ถอนเงิน" ? "" : "ถอนเงิน")}><ArrowUpFromLine size={20} /><b>ถอนเงิน</b><kbd>F3</kbd></button><button type="button" className={`rail-btn${posShortcut === "สินค้าไม่ระบุตายตัว" ? " active" : ""}`} title="เพิ่มรายการพิเศษ — ของชั่ง ค่าบริการ (F4)" onClick={() => setPosShortcut(posShortcut === "สินค้าไม่ระบุตายตัว" ? "" : "สินค้าไม่ระบุตายตัว")}><Sparkles size={20} /><b>รายการพิเศษ</b><kbd>F4</kbd></button><button type="button" className="rail-btn" title="พักบิลปัจจุบันไว้ แล้วเริ่มบิลใหม่ — เรียกคืนได้จากแถบใต้ช่องสแกน" onClick={() => window.dispatchEvent(new CustomEvent("pos-rail", { detail: "hold" }))}><Pause size={20} /><b>พักบิล</b>{posHeldCount > 0 && <span className="rail-badge">{posHeldCount}</span>}</button><span className="rail-spacer" aria-hidden="true" /><button type="button" className="rail-btn rail-exit" title="เปิดเมนูหลัก — ภาพรวมระบบ" onClick={() => setActiveView("dashboard")}><LayoutDashboard size={20} /><b>เมนู</b></button></aside>}<aside className={`sidebar ${mobileNav ? "open" : ""}${safeView === "pos" ? " pos-context" : ""}`}><div className="brand">{appLogo ? <img className="brand-logo" src={appLogo} alt={appName} /> : <div className="brand-mark"><span>{brandInitial(appName)}</span></div>}<div><b>{appName}</b><small>Welfare Store</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={19} /></button></div><div className="role-card"><div className={`role-avatar ${role}`}>{profileAvatar}</div><div><b>{profileName}</b><span>{role === "admin" ? "ผู้บริหารระบบ" : "เจ้าหน้าที่ร้านค้า"}</span></div></div><div className="nav-group-label">เมนูหลัก</div><nav>{navItems.map(({ id, label, icon: Icon }) => <button className={safeView === id ? "active" : ""} key={id} onClick={() => { setActiveView(id); setMobileNav(false); }}><Icon size={20} /><b>{label}</b>{id === "stock" && lowStock.length > 0 && <i className="nav-badge">{lowStock.length}</i>}</button>)}</nav>{role === "admin" ? <><div className="nav-group-label">สำหรับผู้บริหาร</div><nav className="secondary-nav"><button className={safeView === "settings" ? "active" : ""} onClick={() => { setActiveView("settings"); setMobileNav(false); }}><Settings2 size={20} /><b>ตั้งค่า</b></button><button className={safeView === "users" ? "active" : ""} onClick={() => { setActiveView("users"); setMobileNav(false); }}><UserCog size={20} /><b>ผู้ใช้ระบบ</b></button><button className={safeView === "logs" ? "active" : ""} onClick={() => { setActiveView("logs"); setMobileNav(false); }}><Activity size={20} /><b>ระบบ Log</b></button></nav></> : <div className="locked-nav"><LockKeyhole size={15} /><span>เมนูผู้บริหารถูกซ่อน</span></div>}<div className="sidebar-footer"><div className="sidebar-version">v1.0.0 · ระบบร้านค้าสวัสดิการ</div></div></aside><main className="main-shell"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div className="breadcrumb"><span>{appName}</span><b>/</b><strong>{pageTitle}</strong></div><div className="topbar-actions"><div className="global-search" role="button" tabIndex={0} aria-label="เปิดค้นหาเมนู สมาชิก หรือสินค้า" onClick={() => setSearchOpen(true)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSearchOpen(true); } }}><Search size={17} /><span>ค้นหาเมนูหรือรายการ...</span><kbd>⌘ K</kbd></div><button type="button" className="top-icon" title="ออกจากระบบ" aria-label="ออกจากระบบ" onClick={logout} disabled={logoutMutation.isPending}><LogOut size={18} /></button><div className="notif-wrap" ref={notifRef}><button type="button" className="top-icon" title="การแจ้งเตือน" aria-label="การแจ้งเตือน" aria-haspopup="menu" aria-expanded={notifOpen} onClick={() => setNotifOpen((current) => !current)}><Bell size={18} />{notifCount > 0 && <i />}</button>{notifOpen && <div className="notif-dropdown" role="menu" aria-label="การแจ้งเตือน"><div className="notif-header"><b>การแจ้งเตือน</b>{notifCount > 0 && <span className="notif-count">{notifCount}</span>}</div>{notifCount === 0 ? <div className="notif-empty"><Bell size={22} /><b>ไม่มีการแจ้งเตือน</b><small>สต็อก · วันหมดอายุ · ยอดสมาชิกปกติดี</small></div> : <div className="notif-scroll">{lowStock.length > 0 && <div className="notif-section-label"><i className="notif-dot red" />สินค้าใกล้หมดสต็อก</div>}{lowStock.map((row) => <button type="button" className="notif-row" role="menuitem" key={`low-${row.id}`} onClick={() => { setNotifOpen(false); setActiveView("stock"); }}><div><b>{row.name}</b><small>เหลือ {row.stock} {row.unit} · ต่ำกว่าจุดสั่งซื้อ {row.reorderPoint}</small></div><i className="notif-dot red" /></button>)}{expiring.length > 0 && <div className="notif-section-label"><i className="notif-dot amber" />ใกล้หมดอายุ</div>}{expiring.map((row) => <button type="button" className="notif-row" role="menuitem" key={`exp-${row.id}`} onClick={() => { setNotifOpen(false); setActiveView("stock"); }}><div><b>{row.name}</b><small>{row.expiry ? `หมดอายุ ${formatThaiDate(row.expiry)}` : "ตรวจสอบวันหมดอายุ"}</small></div><i className="notif-dot amber" /></button>)}{memberNegative.length > 0 && <div className="notif-section-label"><i className="notif-dot red" />สมาชิกยอดคงเหลือติดลบ</div>}{memberNegative.map((member) => <button type="button" className="notif-row member-row" role="menuitem" key={`neg-${member.memberNumber}`} onClick={() => { setNotifOpen(false); setPendingMemberNumber(member.memberNumber); setActiveView("members"); }}><div><b>{member.firstName} {member.lastName}</b><small>ยอดติดลบ <b className="amount-negative">{money(member.balance)}</b></small></div><i className="notif-dot red" /></button>)}{memberLowPositive.length > 0 && <div className="notif-section-label"><i className="notif-dot amber" />สมาชิกยอดคงเหลือต่ำ</div>}{memberLowPositive.map((member) => <button type="button" className="notif-row member-row" role="menuitem" key={`lowbal-${member.memberNumber}`} onClick={() => { setNotifOpen(false); setPendingMemberNumber(member.memberNumber); setActiveView("members"); }}><div><b>{member.firstName} {member.lastName}</b><small>คงเหลือ <b className="amount-low">{money(member.balance)}</b> · ต่ำกว่า {money(lowBalanceThreshold)}</small></div><i className="notif-dot amber" /></button>)}{memberLowBalanceHidden > 0 && <div className="notif-more">+ {memberLowBalanceHidden} รายการเพิ่มเติม</div>}</div>}<button type="button" className="notif-footer" role="menuitem" onClick={() => { setNotifOpen(false); setActiveView("stock"); }}>ดูสต็อกทั้งหมด →</button></div>}</div><div className="profile-pill"><span className={`profile-avatar ${role}`}>{profileAvatar}</span><div><b>{profileName}</b><small>{role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่"}</small></div></div></div></header><div className="page-content" key={safeView}>{safeView === "dashboard" && <Dashboard setView={setActiveView} setPosShortcut={setPosShortcut} role={role} userName={profileName} />}{safeView === "pos" && <Pos shortcut={posShortcut} setShortcut={setPosShortcut} role={role} userName={profileName} />}{safeView === "stock" && <Stock role={role} userName={profileName} />}{safeView === "members" && <Members role={role} userName={profileName} focusMemberNumber={pendingMemberNumber} onFocusMemberConsumed={() => setPendingMemberNumber(null)} />}{safeView === "reports" && <Reports focusBill={pendingBillNumber} onFocusBillConsumed={() => setPendingBillNumber(null)} />}{safeView === "settings" && role === "admin" && <Settings setView={setActiveView} />}{safeView === "users" && role === "admin" && <Users selfUsername={user.openId} />}{safeView === "logs" && role === "admin" && <Logs />}</div><footer className="app-footer"><span>{appName}</span><span>ศูนย์ช่วยเหลือ <CircleHelp size={14} /> · 02-XXX-XXXX</span><button type="button" className="footer-logout" onClick={logout} disabled={logoutMutation.isPending} title="ออกจากระบบ" aria-label="ออกจากระบบ"><LogOut size={13} /> ออกจากระบบ</button></footer><GlobalSearch role={role} open={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={(view) => { setActiveView(view); setSearchOpen(false); setMobileNav(false); }} onOpenMember={(memberNumber) => { setSearchOpen(false); setPendingMemberNumber(memberNumber); setActiveView("members"); }} onOpenBill={(orderNumber) => { setSearchOpen(false); setPendingBillNumber(orderNumber); setActiveView("reports"); }} /></main></div>;
}

/** Auth gate: session check (auth.me) → splash → login view → app shell. */
export default function Home() {
  const authQuery = trpc.auth.me.useQuery();
  // ROUND 25 — แบรนด์ (ชื่อ/โลโก้/สี) โหลดจาก settings สาธารณะ ใช้ทั้งก่อน/หลัง login
  const brandQuery = trpc.settings.get.useQuery(undefined);
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
    return <LoginView brand={brandQuery.data} onAuthed={() => void authQuery.refetch()} />;
  }
  return <AppShell user={user} brand={brandQuery.data} onLogout={() => void authQuery.refetch()} />;
}
