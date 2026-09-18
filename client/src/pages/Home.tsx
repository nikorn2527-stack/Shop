import { useEffect, useMemo, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  Activity,
  ArrowDownToLine,
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
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

import type { MemberLite, Role, View } from "./pageData";
import { canAccessView, formatMemberNumber, money, navItems } from "./pageData";
import { ConfirmDialog, SectionHeader, StatusPill } from "./PagePrimitives";
import { Dashboard } from "./Dashboard";
import { Pos } from "./Pos";
import { Stock } from "./Stock";
import { trpc } from "@/lib/trpc";
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

type SettingsForm = {
  memberNumberMode: "running" | "year" | "manual";
  storeName: string;
  storeCode: string;
  storeAddress: string;
  autoPrintReceipt: boolean;
  showBalanceOnReceipt: boolean;
  lowBalanceAlert: boolean;
  lowBalanceThreshold: number;
  lowStockAlert: boolean;
  expiryAlert: boolean;
  expiryAlertDays: number;
};

function MemberDetail({ member, onBack, role }: { member: MemberLite; onBack: () => void; role: Role }) {
  const utils = trpc.useUtils();
  const detailQuery = trpc.member.detail.useQuery({ memberNumber: member.memberNumber });
  const [tab, setTab] = useState<"ทั้งหมด" | "ซื้อสินค้า" | "เติมเงิน" | "ถอนเงิน">("ทั้งหมด");
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [walletOpen, setWalletOpen] = useState<"deposit" | "withdrawal" | null>(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const actor = role === "admin" ? "วรพจน์ ด." : "กัญญาณัฐ พ.";
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
  const submitWallet = () => {
    if (!walletOpen) return;
    const amount = Number(walletAmount);
    if (!(amount > 0)) { setError("กรุณาระบุจำนวนเงินมากกว่า 0"); return; }
    if (walletOpen === "withdrawal" && amount > profile.balance) { setError(`ยอดเงินคงเหลือไม่พอ · ถอน ${money(amount)} คงเหลือ ${money(profile.balance)}`); return; }
    setError("");
    walletMutation.mutate({ memberNumber: member.memberNumber, type: walletOpen, amount, note: walletNote.trim() || undefined, actor, actorRole });
  };
  return <><SectionHeader eyebrow="สมาชิกและบัญชี / รายละเอียด" title={`รายละเอียด ${displayName}`} description="ตรวจสอบประวัติการซื้อสินค้า เติมเงิน และถอนเงินของสมาชิกแต่ละราย" action={<button className="outline-button" onClick={onBack}><ArrowDownToLine size={16} style={{ transform: "rotate(90deg)" }} /> กลับไปรายการสมาชิก</button>} /><div className="member-detail-head"><div className="member-detail-profile"><span className="member-detail-avatar">{profile.firstName.slice(0, 1)}</span><div><span className="eyebrow">{profile.type} · {profile.memberNumber}</span><h2>{displayName}</h2><p>สถานะ <StatusPill tone={statusMeta.tone}>{statusMeta.label}</StatusPill></p></div></div><div className="member-detail-actions"><button className="primary-button" disabled={profile.status !== "active"} onClick={() => { setWalletOpen("deposit"); setError(""); }}><ArrowDownToLine size={15} /> เติมเงิน</button><button className="outline-button" disabled={profile.status !== "active"} onClick={() => { setWalletOpen("withdrawal"); setError(""); }}><ArrowUpFromLine size={15} /> ถอนเงิน</button>{profile.status === "active" ? <button className="danger-outline-button" onClick={() => setConfirmStatus(true)}><LockKeyhole size={15} /> ระงับการใช้งาน</button> : <button className="outline-button" onClick={() => setConfirmStatus(true)}><Check size={15} /> คืนสถานะ</button>}<button className="outline-button" onClick={() => setNotice("ยังไม่รองรับการแก้ไขข้อมูลสมาชิกในเวอร์ชันนี้ · ติดต่อผู้ดูแลระบบเพื่อแก้ไขข้อมูล")}><Settings2 size={15} /> แก้ไขข้อมูล</button></div></div><div className="member-detail-stats"><div><span className="stat-icon green"><WalletCards size={18} /></span><div><small>ยอดเงินคงเหลือ</small><strong>{money(profile.balance)}</strong></div></div><div><span className="stat-icon blue"><ShoppingCart size={18} /></span><div><small>ยอดซื้อเดือนนี้</small><strong>{money(monthPurchase)}</strong></div></div><div><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>เติมเงินสะสม</small><strong>{money(totalDeposited)}</strong></div></div><div><span className="stat-icon amber"><CalendarDays size={18} /></span><div><small>รายการล่าสุด</small><strong>{lastActivity}</strong></div></div></div><section className="panel table-panel member-history-panel"><div className="table-toolbar"><div><h2>ประวัติการทำรายการ</h2><p>ข้อมูลย้อนหลังของ {displayName} · รวม {transactions.length} รายการ</p></div><div className="filter-pills history-tabs">{["ทั้งหมด", "ซื้อสินค้า", "เติมเงิน", "ถอนเงิน"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item as typeof tab)}>{item}</button>)}</div></div><div className="member-history-list">{detailQuery.isLoading ? <div className="table-loading"><ReceiptText size={22} /><b>กำลังโหลดประวัติการทำรายการ</b><span>ดึงข้อมูลธุรกรรมของสมาชิกจากระบบ</span></div> : filtered.length === 0 ? <div className="table-loading"><ReceiptText size={22} /><b>ไม่พบรายการตามเงื่อนไข</b><span>ลองเปลี่ยนแท็บหรือทำรายการผ่าน POS</span></div> : filtered.map((transaction) => { const meta = WALLET_TX_META[transaction.type] ?? { label: transaction.type, tone: "blue" }; return <div className="history-row" key={transaction.id}><span className={`history-icon ${meta.tone}`}>{transaction.type === "purchase" ? <ShoppingCart size={16} /> : transaction.type === "deposit" ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</span><div className="history-main"><div><b>{meta.label}</b><span>{`TX-${String(transaction.id).padStart(3, "0")}`}</span></div><small>{transaction.detail}</small><time>{formatHistoryDate(transaction.createdAt)}</time></div><strong className={transaction.amount > 0 ? "positive" : "negative"}>{transaction.amount > 0 ? "+ " : "- "}{money(Math.abs(transaction.amount))}</strong></div>; })}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}{error && !walletOpen && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}</section>{walletOpen && <div className="modal-backdrop" onClick={() => setWalletOpen(null)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">WALLET TRANSACTION</span><h2>{walletOpen === "deposit" ? "เติมเงินเข้าบัญชีสมาชิก" : "ถอนเงินจากบัญชีสมาชิก"}</h2><p>{displayName} · {profile.memberNumber} · ยอดคงเหลือ {money(profile.balance)}</p></div><button className="icon-button" onClick={() => setWalletOpen(null)}><X size={17} /></button></div><div className="member-number-preview"><span><WalletCards size={16} /> ยอดคงเหลือหลังรายการ</span><b className={balanceAfterWallet < 0 ? "red-text" : ""}>{money(balanceAfterWallet)}</b></div>{balanceAfterWallet < 0 && <div className="notice-bar error"><ShieldCheck size={16} /> ยอดเงินคงเหลือไม่พอสำหรับถอนจำนวนนี้<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="form-grid compact-form"><label>จำนวนเงิน (฿) *<input autoFocus type="number" min="0" step="0.01" value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} placeholder="0.00" /></label><label className="wide">หมายเหตุ<input value={walletNote} onChange={(event) => setWalletNote(event.target.value)} placeholder={walletOpen === "deposit" ? "เช่น เติมเงินสดที่เคาน์เตอร์" : "เช่น ถอนเพื่อใช้จ่ายส่วนตัว"} /></label></div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setWalletOpen(null)}>ยกเลิก</button><button className="primary-button" disabled={walletMutation.isPending || !(Number(walletAmount) > 0) || balanceAfterWallet < 0} onClick={submitWallet}><Check size={16} /> {walletMutation.isPending ? "กำลังบันทึก…" : walletOpen === "deposit" ? "บันทึกการเติมเงิน" : "บันทึกการถอนเงิน"}</button></div></div></div>}<ConfirmDialog open={confirmStatus} title={profile.status === "active" ? "ยืนยันการระงับสมาชิก?" : "ยืนยันการคืนสถานะสมาชิก?"} description={profile.status === "active" ? `สมาชิก ${displayName} จะไม่สามารถใช้ยอดคงเหลือซื้อสินค้าได้จนกว่าจะเปิดใช้งานอีกครั้ง` : `สมาชิก ${displayName} จะสามารถใช้ยอดคงเหลือซื้อสินค้าและรับการเติมเงินได้อีกครั้ง`} confirmLabel={profile.status === "active" ? "ยืนยันระงับการใช้งาน" : "ยืนยันคืนสถานะการใช้งาน"} onCancel={() => setConfirmStatus(false)} onConfirm={() => { setConfirmStatus(false); statusMutation.mutate({ memberNumber: member.memberNumber, suspended: profile.status === "active", actor, actorRole }); }} /></>;
}

function Members({ role }: { role: Role }) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ทั้งหมด");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberLite | null>(null);
  const [newMember, setNewMember] = useState(emptyNewMember);
  const actor = role === "admin" ? "วรพจน์ ด." : "กัญญาณัฐ พ.";
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
  if (selectedMember) return <MemberDetail member={selectedMember} onBack={() => setSelectedMember(null)} role={role} />;
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
  return <><SectionHeader eyebrow="สมาชิกและบัญชีสวัสดิการ" title="จัดการสมาชิก" description="ลงทะเบียนสมาชิก ระบุเงินเริ่มต้น (ถ้ามี) ระงับการใช้งาน และดูประวัติรายบุคคล" action={<button className="primary-button" onClick={() => { setRegisterOpen(true); setError(""); }}><Plus size={16} /> ลงทะเบียนสมาชิก</button>} /><div className="member-top-grid"><div className="member-balance-card"><div><span className="eyebrow">ยอดเงินในบัญชีสมาชิกทั้งหมด</span><strong>{money(walletTotal)}</strong><small>สมาชิกใช้งาน {activeCount} ราย · ระงับ {suspendedCount} ราย</small></div><div className="balance-orb"><WalletCards size={26} /></div></div><div className="member-mini-card"><span className="stat-icon green"><UsersRound size={18} /></span><div><small>สมาชิกทั้งหมด</small><strong>{allMembers.length.toLocaleString("th-TH")} <em>ราย</em></strong><p><span className="green-text">{activeCount} ใช้งาน</span> · {suspendedCount} ระงับ</p></div></div><div className="member-mini-card"><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>ลงทะเบียนเดือนนี้</small><strong>{newThisMonth} <em>ราย</em></strong><p>ข้อมูลสมาชิกใหม่ · ไม่รวมการเติมเงิน</p></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>สมาชิกทั้งหมด</h2><p>ค้นหาและกรองตามสถานะการใช้งานได้ทันที</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ หรือเลขสมาชิก" /></div><div className="filter-pills">{["ทั้งหมด", "ใช้งาน", "ระงับ"].map((item) => <button className={statusFilter === item ? "active" : ""} key={item} onClick={() => setStatusFilter(item)}>{item}{item === "ใช้งาน" && <span>{activeCount}</span>}{item === "ระงับ" && <span>{suspendedCount}</span>}</button>)}</div></div></div><div className="table-filter-summary"><span><Search size={13} /> {query ? `ค้นหา “${query}”` : "สมาชิกทั้งหมด"}</span><span>แสดง {rows.length} จาก {allMembers.length} รายการ</span></div><div className="table-wrap"><table><thead><tr><th>สมาชิก</th><th>ประเภท</th><th>ยอดเงินคงเหลือ</th><th>รายการล่าสุด</th><th>สถานะการใช้งาน</th><th /></tr></thead><tbody>{allMembersQuery.isLoading ? <tr className="table-state-row"><td colSpan={6}><div className="table-loading"><UsersRound size={22} /><b>กำลังโหลดรายการสมาชิกจากระบบ</b><span>ดึงข้อมูลบัญชีสวัสดิการทั้งหมด</span></div></td></tr> : allMembersQuery.isError ? <tr className="table-state-row"><td colSpan={6}><div className="table-loading"><ShieldCheck size={22} /><b>โหลดรายการสมาชิกไม่สำเร็จ</b><span>{getErrorMessage(allMembersQuery.error)}</span></div></td></tr> : rows.length === 0 ? <tr className="table-state-row"><td colSpan={6}><div className="table-loading"><UsersRound size={22} /><b>ไม่พบสมาชิกตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ</span></div></td></tr> : rows.map((row) => { const statusMeta = MEMBER_STATUS_META[row.status]; return <tr key={row.memberNumber}><td><div className="member-cell"><span className="member-table-avatar">{row.firstName.slice(0, 1)}</span><div><b>{row.firstName} {row.lastName}</b><small>{row.memberNumber}</small></div></div></td><td>{row.type}</td><td><b>{money(row.balance)}</b></td><td>{formatLastActivity(row.lastTransactionAt)}</td><td><StatusPill tone={statusMeta.tone}>{statusMeta.label}</StatusPill></td><td><button className="row-action" onClick={() => setSelectedMember(row)}>ดูรายละเอียด <span>→</span></button></td></tr>; })}</tbody></table></div>{rows.length === 0 && !allMembersQuery.isLoading && <div className="empty-filter"><UsersRound size={22} /><b>ไม่พบสมาชิกตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ</span></div>}{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section>{registerOpen && <div className="modal-backdrop" onClick={() => setRegisterOpen(false)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">MEMBER REGISTRATION</span><h2>ลงทะเบียนสมาชิก</h2><p>กรอกข้อมูลสมาชิกและเลือกเติมเงินครั้งแรกหรือไม่ก็ได้</p></div><button className="icon-button" onClick={() => setRegisterOpen(false)}><X size={17} /></button></div><div className="member-number-preview"><span><CreditCard size={16} /> {numberMode === "manual" ? "โหมดกำหนดหมายเลขสมาชิกด้วยตนเอง" : `หมายเลขสมาชิกจะกำหนดอัตโนมัติ (${numberMode === "year" ? "ขึ้นต้นด้วยปี" : "รันเลขต่อเนื่อง"})`}</span><b>{nextNumber}</b></div><div className="form-grid compact-form"><label>ชื่อ *<input autoFocus value={newMember.firstName} onChange={(event) => setNewMember({ ...newMember, firstName: event.target.value })} placeholder="ชื่อ" /></label><label>นามสกุล *<input value={newMember.lastName} onChange={(event) => setNewMember({ ...newMember, lastName: event.target.value })} placeholder="นามสกุล" /></label><label>ประเภทสมาชิก<select value={newMember.type} onChange={(event) => setNewMember({ ...newMember, type: event.target.value })}><option>สมาชิก</option><option>เจ้าหน้าที่</option></select></label><label>เบอร์โทรศัพท์<input value={newMember.phone} onChange={(event) => setNewMember({ ...newMember, phone: event.target.value })} placeholder="เช่น 08x-xxx-xxxx" /></label><label className="wide">เลขที่บัตรประชาชน<input value={newMember.idCard} onChange={(event) => setNewMember({ ...newMember, idCard: event.target.value })} placeholder="-" /></label>{numberMode === "manual" && <label className="wide">หมายเลขสมาชิก *<input value={newMember.memberNumber} onChange={(event) => setNewMember({ ...newMember, memberNumber: event.target.value })} placeholder="กำหนดหมายเลขเอง เช่น VIP-001" /></label>}<label className="wide">เงินเริ่มต้น (ถ้ามี)<input type="number" min="0" value={newMember.initialBalance} onChange={(event) => setNewMember({ ...newMember, initialBalance: event.target.value })} placeholder="เว้นว่างได้ หากยังไม่เติมเงิน" /></label></div><div className="initial-balance-note"><ShieldCheck size={15} /> เงินจำนวนนี้เป็นยอดเริ่มต้นตอนลงทะเบียน ไม่ใช่เมนูเติมเงินภายหลัง</div>{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}<div className="modal-actions"><button className="outline-button" onClick={() => setRegisterOpen(false)}>ยกเลิก</button><button className="primary-button" disabled={registerMutation.isPending} onClick={submitRegister}><Check size={16} /> {registerMutation.isPending ? "กำลังบันทึก…" : "บันทึกสมาชิก"}</button></div></div></div>}</>;
}

function Reports() {
  const dailyQuery = trpc.reports.daily.useQuery({ days: 30 });
  const logsQuery = trpc.logs.list.useQuery({ limit: 1000 });
  const [period, setPeriod] = useState("รายวัน");
  const [notice, setNotice] = useState("");
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
    const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, canvas.width, canvas.height);
    pdf.save("daily-sales-summary.pdf");
    setNotice("ดาวน์โหลดรายงานยอดขาย PDF แล้ว");
  };
  const rangeLabel = dailyRows.length > 0 ? `${formatThaiDate(dailyRows[0].date)} – ${formatThaiDate(dailyRows[dailyRows.length - 1].date)}` : formatThaiDate(new Date());
  return <><SectionHeader eyebrow="สรุปผลและวิเคราะห์ข้อมูล" title="รายงาน" description="เลือกช่วงเวลา รายบุคคล หรือหมวดรายงานเพื่อดูและส่งออกข้อมูล" action={<button className="outline-button" onClick={() => setNotice("เปิดตัวเลือกช่วงวันที่แล้ว")}><CalendarDays size={16} /> {formatThaiDate(new Date())} <ChevronDown size={15} /></button>} /><div className="report-tabs">{["รายวัน", "รายสัปดาห์", "รายเดือน", "กำหนดช่วงเวลา"].map((item) => <button className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)}>{item}</button>)}</div><div className="report-cards"><div className="report-card"><span>ยอดขายสินค้า</span><strong>{dailyQuery.isLoading ? "…" : money(totals.revenue)}</strong><small>{totals.orders.toLocaleString("th-TH")} บิล · ช่วง{period}</small><div className="sparkline teal-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>เติมเงินสมาชิก</span><strong>{logsQuery.isLoading ? "…" : money(walletTotals.deposit)}</strong><small>{walletTotals.depositCount} รายการ · จากระบบ Log</small><div className="sparkline purple-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>ถอนเงินสมาชิก</span><strong>{logsQuery.isLoading ? "…" : money(walletTotals.withdraw)}</strong><small>{walletTotals.withdrawCount} รายการ · จากระบบ Log</small><div className="sparkline amber-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>กำไรขั้นต้นโดยประมาณ</span><strong>{dailyQuery.isLoading ? "…" : money(totals.profit)}</strong><small className="green-text">คิดเป็น {marginPercent}% ของยอดขาย</small><div className="sparkline green-spark"><i /><i /><i /><i /><i /><i /><i /></div></div></div><div className="dashboard-grid report-lower" id="daily-sales-report"><section className="panel"><div className="panel-heading"><div><h2>สรุปยอดขายรายวัน</h2><p>{period} · {rangeLabel}</p></div><div className="report-export-actions"><button className="outline-button compact" onClick={downloadDailySalesCsv}><Download size={15} /> CSV</button><button className="outline-button compact" onClick={downloadDailySalesPdf}><FileBarChart size={15} /> PDF</button></div></div><div className="category-report">{dailyQuery.isLoading ? <div className="table-loading"><FileBarChart size={22} /><b>กำลังโหลดรายงานยอดขาย</b><span>ดึงข้อมูล 30 วันล่าสุดจากระบบ</span></div> : dailyQuery.isError ? <div className="table-loading"><FileBarChart size={22} /><b>โหลดรายงานไม่สำเร็จ</b><span>{getErrorMessage(dailyQuery.error)}</span></div> : reportRows.length === 0 ? <div className="table-loading"><FileBarChart size={22} /><b>ยังไม่มีข้อมูลการขาย</b><span>เริ่มขายสินค้าผ่าน POS เพื่อดูรายงาน</span></div> : reportRows.map((row, index) => <div className="category-row" key={row.label}><div><b>{row.label}</b><span>{row.orders} บิล · {row.items} ชิ้น · กำไร {money(row.profit)}</span></div><div className={`progress ${["", "blue", "purple", "amber"][index % 4]}`}><i style={{ width: `${Math.round((row.revenue / maxRevenue) * 100)}%` }} /></div><strong>{money(row.revenue)}</strong></div>)}</div></section><section className="panel"><div className="panel-heading"><div><h2>การส่งออกข้อมูล</h2><p>ไฟล์พร้อมดาวน์โหลดตามสิทธิ์ของคุณ</p></div><FileBarChart size={19} className="muted-icon" /></div><div className="export-list"><button onClick={downloadDailySalesCsv}><span className="file-icon csv">CSV</span><span><b>รายงานยอดขาย.csv</b><small>สรุปยอดขายรายวัน · 30 วันล่าสุด</small></span><Download size={16} /></button><button onClick={downloadDailySalesPdf}><span className="file-icon pdf">PDF</span><span><b>รายงานยอดขาย.pdf</b><small>สรุปยอดขายรายวัน · 30 วันล่าสุด</small></span><Download size={16} /></button><button onClick={() => setNotice("ส่งออกรายงานเป็น CSV แล้ว")}><span className="file-icon csv">CSV</span><span><b>ประวัติธุรกรรม.csv</b><small>ข้อมูลรายการทั้งหมด · วันนี้</small></span><Download size={16} /></button></div></section></div>{notice && <div className="notice-bar floating-notice"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</>;
}

function Settings() {
  const utils = trpc.useUtils();
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const membersQuery = trpc.member.list.useQuery();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (settingsQuery.data && !hydrated) {
      setForm(settingsQuery.data);
      setHydrated(true);
    }
  }, [settingsQuery.data, hydrated]);
  const numberMode = form?.memberNumberMode ?? "running";
  const nextNumber = formatMemberNumber(numberMode, nextMemberSequence(membersQuery.data ?? [], numberMode));
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
  return <><SectionHeader eyebrow="ระบบและการกำหนดค่า" title="ตั้งค่า" description="จัดการข้อมูลร้านค้า ใบเสร็จ การแจ้งเตือน และรูปแบบเลขสมาชิก" action={<button className="primary-button" disabled={!form || saveMutation.isPending} onClick={saveSettings}><Check size={16} /> {saveMutation.isPending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}</button>} /><div className="settings-layout"><div className="settings-nav"><button className="active"><ReceiptText size={17} /> ใบเสร็จและการขาย</button><button><CreditCard size={17} /> สมาชิกและเลขสมาชิก</button><button><WalletCards size={17} /> รูปแบบการชำระเงิน</button><button><Bell size={17} /> การแจ้งเตือน</button><button><ShieldCheck size={17} /> สิทธิ์และบทบาท</button><button><Activity size={17} /> การบันทึก Log</button></div><div className="settings-content"><section className="panel settings-card"><div className="settings-heading"><div><h2>ข้อมูลร้านค้า</h2><p>ข้อมูลจะแสดงบนหัวใบเสร็จและรายงาน</p></div><ShoppingBag size={20} className="muted-icon" /></div><div className="form-grid"><label>ชื่อร้านค้า<input value={form?.storeName ?? ""} onChange={(event) => updateForm({ storeName: event.target.value })} placeholder="ชื่อร้านค้า" disabled={!form} /></label><label>รหัสร้านค้า<input value={form?.storeCode ?? ""} onChange={(event) => updateForm({ storeCode: event.target.value })} placeholder="รหัสร้านค้า" disabled={!form} /></label><label className="wide">ที่อยู่<input value={form?.storeAddress ?? ""} onChange={(event) => updateForm({ storeAddress: event.target.value })} placeholder="ที่อยู่" disabled={!form} /></label></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>การกำหนดหมายเลขสมาชิก</h2><p>เลือกวิธีสร้างหมายเลขสำหรับสมาชิกใหม่ที่จะลงทะเบียน</p></div><CreditCard size={20} className="muted-icon" /></div><div className="number-mode-grid">{[["running", "รันเลขต่อเนื่อง", "M-000001, M-000002, ..."], ["year", "ขึ้นต้นด้วยปี", "69-00001, 69-00002, ..."], ["manual", "กำหนดเอง", "เจ้าหน้าที่กรอกหมายเลขเอง"]].map(([value, title, detail]) => <button className={numberMode === value ? "selected" : ""} key={value} onClick={() => updateForm({ memberNumberMode: value as SettingsForm["memberNumberMode"] })} disabled={!form}><span className="number-radio">{numberMode === value && <i />}</span><span><b>{title}</b><small>{detail}</small></span></button>)}</div><div className="number-preview"><span>ตัวอย่างสมาชิกถัดไป</span><b>{nextNumber}</b></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ใบเสร็จรับเงิน</h2><p>กำหนดรายละเอียดที่ต้องการแสดงบนใบเสร็จ</p></div><ReceiptText size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน</b><small>ใช้กับเครื่องพิมพ์ใบเสร็จที่เชื่อมต่ออยู่</small></div><button className={`toggle ${form?.autoPrintReceipt ? "on" : ""}`} onClick={() => updateForm({ autoPrintReceipt: !form?.autoPrintReceipt })} disabled={!form}><span /></button></div><div className="toggle-row"><div><b>แสดงยอดคงเหลือสมาชิกบนใบเสร็จ</b><small>แสดงยอดก่อนและหลังรายการ</small></div><button className={`toggle ${form?.showBalanceOnReceipt ? "on" : ""}`} onClick={() => updateForm({ showBalanceOnReceipt: !form?.showBalanceOnReceipt })} disabled={!form}><span /></button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>การแจ้งเตือน</h2><p>ช่วยให้เจ้าหน้าที่ติดตามรายการสำคัญได้ทันเวลา</p></div><Bell size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>แจ้งเตือนเมื่อสมาชิกมียอดคงเหลือต่ำ</b><small>แจ้งเตือนเมื่อยอดต่ำกว่า {money(form?.lowBalanceThreshold ?? 100)}</small></div><button className={`toggle ${form?.lowBalanceAlert ? "on" : ""}`} onClick={() => updateForm({ lowBalanceAlert: !form?.lowBalanceAlert })} disabled={!form}><span /></button></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดสต็อก</b><small>แจ้งเตือนเมื่อจำนวนต่ำกว่าจุดสั่งซื้อ</small></div><button className={`toggle ${form?.lowStockAlert ? "on" : ""}`} onClick={() => updateForm({ lowStockAlert: !form?.lowStockAlert })} disabled={!form}><span /></button></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดอายุ</b><small>แจ้งเตือนล่วงหน้า {form?.expiryAlertDays ?? 30} วัน</small></div><button className={`toggle ${form?.expiryAlert ? "on" : ""}`} onClick={() => updateForm({ expiryAlert: !form?.expiryAlert })} disabled={!form}><span /></button></div></section>{saved && <div className="notice-bar"><Check size={16} /> บันทึกการตั้งค่าเรียบร้อยแล้ว<button onClick={() => setSaved(false)}><X size={14} /></button></div>}{error && <div className="notice-bar error"><ShieldCheck size={16} /> {error}<button onClick={() => setError("")}><X size={14} /></button></div>}</div></div></>;
}

function Logs() {
  const logsQuery = trpc.logs.list.useQuery({ limit: 200 });
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const logs = logsQuery.data ?? [];
  const filtered = logs.filter((log) => !query.trim() || `${log.action} ${log.actor} ${log.detail} ${log.actorRole ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
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
  return <><SectionHeader eyebrow="ตรวจสอบย้อนหลังและความโปร่งใส" title="ระบบ Log" description="บันทึกทุกกิจกรรมสำคัญของผู้ใช้งานและธุรกรรมในระบบ" action={<button className="outline-button" onClick={downloadLogsCsv}><Download size={16} /> ส่งออก Log</button>} /><div className="log-summary"><div><Activity size={18} /><span>รายการวันนี้<strong>{todayCount}</strong></span></div><div><ShieldCheck size={18} /><span>ผู้ใช้งานในระบบ<strong>{actorCount}</strong></span></div><div><ReceiptText size={18} /><span>ธุรกรรมที่บันทึก<strong>100%</strong></span></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>กิจกรรมทั้งหมด</h2><p>ข้อมูลสำหรับตรวจสอบย้อนหลังของเจ้าหน้าที่และผู้บริหาร</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหากิจกรรม หรือผู้ใช้งาน" /></div><button className="outline-button"><CalendarDays size={16} /> ช่วงเวลา</button></div></div><div className="table-wrap"><table><thead><tr><th>วันและเวลา</th><th>ผู้ทำรายการ</th><th>กิจกรรม</th><th>รายละเอียด</th><th>ระดับสิทธิ์</th><th /></tr></thead><tbody>{logsQuery.isLoading ? <tr className="table-state-row"><td colSpan={6}><div className="table-loading"><Activity size={22} /><b>กำลังโหลดรายการ Log จากระบบ</b><span>ดึงข้อมูล 200 รายการล่าสุด</span></div></td></tr> : logsQuery.isError ? <tr className="table-state-row"><td colSpan={6}><div className="table-loading"><ShieldCheck size={22} /><b>โหลดรายการ Log ไม่สำเร็จ</b><span>{getErrorMessage(logsQuery.error)}</span></div></td></tr> : filtered.length === 0 ? <tr className="table-state-row"><td colSpan={6}><div className="table-loading"><Activity size={22} /><b>ไม่พบกิจกรรมตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหา</span></div></td></tr> : filtered.map((log) => <tr key={log.id}><td>{formatLogDateTime(log.createdAt)}</td><td><b>{log.actor}</b></td><td><StatusPill tone={log.tone}>{log.action}</StatusPill></td><td>{log.detail}</td><td>{log.actorRole ?? "—"}</td><td><button className="table-more"><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section></>;
}

function RoleSwitcher({ role, onChange }: { role: Role; onChange: (role: Role) => void }) {
  return <div className="role-switcher" aria-label="สลับสิทธิ์การใช้งาน"><span className="role-switch-label"><ShieldCheck size={13} /> สิทธิ์</span><button className={role === "staff" ? "active" : ""} onClick={() => onChange("staff")}>เจ้าหน้าที่</button><button className={role === "admin" ? "active admin" : ""} onClick={() => onChange("admin")}><Crown size={12} /> ผู้บริหาร</button></div>;
}

export default function Home() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [posShortcut, setPosShortcut] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const safeView = canAccessView(role, activeView) ? activeView : "dashboard";
  const pageTitle = navItems.find((item) => item.id === safeView)?.label ?? (safeView === "settings" ? "ตั้งค่า" : safeView === "logs" ? "ระบบ Log" : "ภาพรวม");
  const profileName = role === "admin" ? "วรพจน์ ด." : "กัญญาณัฐ พ.";
  const switchRole = (nextRole: Role) => { setRole(nextRole); if (nextRole === "staff" && (activeView === "settings" || activeView === "logs")) setActiveView("dashboard"); };
  return <div className="app-shell"><aside className={`sidebar ${mobileNav ? "open" : ""}`}><div className="brand"><div className="brand-mark"><span>ส</span></div><div><b>สวัสดิการ รพจ.</b><small>Hospital Welfare Store</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={19} /></button></div><div className="role-card"><div className={`role-avatar ${role}`}>{role === "admin" ? "ว" : "ก"}</div><div><b>{profileName}</b><span>{role === "admin" ? "ผู้บริหารระบบ" : "เจ้าหน้าที่ร้านค้า"}</span></div><ChevronDown size={15} className="muted-icon" /></div><RoleSwitcher role={role} onChange={switchRole} /><nav>{navItems.map(({ id, label, caption, icon: Icon }) => <button className={safeView === id ? "active" : ""} key={id} onClick={() => { setActiveView(id); setMobileNav(false); }}><Icon size={19} /><span><b>{label}</b><small>{caption}</small></span>{id === "stock" && <i className="nav-badge">9</i>}</button>)}</nav><div className="nav-separator" /><nav className="secondary-nav">{role === "admin" ? <><button className={safeView === "settings" ? "active" : ""} onClick={() => { setActiveView("settings"); setMobileNav(false); }}><Settings2 size={19} /><span><b>ตั้งค่า</b><small>ระบบและใบเสร็จ</small></span></button><button className={safeView === "logs" ? "active" : ""} onClick={() => { setActiveView("logs"); setMobileNav(false); }}><Activity size={19} /><span><b>ระบบ Log</b><small>ประวัติการใช้งาน</small></span></button></> : <div className="locked-nav"><LockKeyhole size={15} /><span>เมนูผู้บริหารถูกซ่อน</span></div>}</nav><div className="sidebar-footer"><div className="secure-badge"><ShieldCheck size={17} /><span><b>ระบบปลอดภัย</b><small>ข้อมูลถูกเข้ารหัสและสำรอง</small></span></div><div className="sidebar-version">v1.0.0 · ฝ่ายสวัสดิการ</div></div></aside><main className="main-shell"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div className="breadcrumb"><span>ร้านค้าสวัสดิการ</span><b>/</b><strong>{pageTitle}</strong></div><div className="topbar-actions"><div className="global-search"><Search size={17} /><span>ค้นหาเมนูหรือรายการ...</span><kbd>⌘ K</kbd></div><RoleSwitcher role={role} onChange={switchRole} /><button className="top-icon"><Bell size={18} /><i /></button><div className="profile-pill"><span className={`profile-avatar ${role}`}>{role === "admin" ? "ว" : "ก"}</span><div><b>{profileName}</b><small>{role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่"}</small></div><ChevronDown size={15} className="muted-icon" /></div></div></header><div className="page-content">{safeView === "dashboard" && <Dashboard setView={setActiveView} setPosShortcut={setPosShortcut} role={role} />}{safeView === "pos" && <Pos shortcut={posShortcut} setShortcut={setPosShortcut} role={role} />}{safeView === "stock" && <Stock role={role} />}{safeView === "members" && <Members role={role} />}{safeView === "reports" && <Reports />}{safeView === "settings" && role === "admin" && <Settings />}{safeView === "logs" && role === "admin" && <Logs />}</div><footer className="app-footer"><span>ร้านค้าสวัสดิการโรงพยาบาลผู้ป่วยจิตเวช</span><span>ศูนย์ช่วยเหลือ <CircleHelp size={14} /> · 02-XXX-XXXX</span><span className="powered-by">Power by PNG TEAM</span></footer></main></div>;
}
