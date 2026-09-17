import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Bell,
  Camera,
  Crown,
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  CreditCard,
  Download,
  FileBarChart,
  FileImage,
  LayoutDashboard,
  Menu,
  Minus,
  LockKeyhole,
  MoreHorizontal,
  PackagePlus,
  PackageSearch,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  RotateCcw,
  Search,
  ScanLine,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserCircle2,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";

import type { Role, View } from "./pageData";
import { canAccessView, formatMemberNumber, logs, memberRows, memberTransactions, money, navItems } from "./pageData";
import { ConfirmDialog, SectionHeader, StatusPill } from "./PagePrimitives";
import { Dashboard } from "./Dashboard";
import { Pos } from "./Pos";
import { Stock } from "./Stock";

export { addScannedItem, calculateCartSubtotal, canAccessView, formatMemberNumber, isStockAlert } from "./pageData";

function MemberDetail({ member, onBack }: { member: (typeof memberRows)[number]; onBack: () => void }) {
  const [tab, setTab] = useState<"ทั้งหมด" | "ซื้อสินค้า" | "เติมเงิน" | "ถอนเงิน">("ทั้งหมด");
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [notice, setNotice] = useState("");
  const transactions = memberTransactions[member.id] ?? memberTransactions["M-000218"];
  const filtered = transactions.filter((transaction) => tab === "ทั้งหมด" || transaction.type === tab);
  return <><SectionHeader eyebrow="สมาชิกและบัญชี / รายละเอียด" title={`รายละเอียด ${member.name}`} description="ตรวจสอบประวัติการซื้อสินค้า เติมเงิน และถอนเงินของสมาชิกแต่ละราย" action={<button className="outline-button" onClick={onBack}><ArrowDownToLine size={16} style={{ transform: "rotate(90deg)" }} /> กลับไปรายการสมาชิก</button>} /><div className="member-detail-head"><div className="member-detail-profile"><span className="member-detail-avatar">{member.name.slice(3, 4)}</span><div><span className="eyebrow">{member.type} · {member.id}</span><h2>{member.name}</h2><p>สถานะ <StatusPill tone={member.tone}>{member.status === "ใช้งาน" ? "ใช้งานอยู่" : "ระงับการใช้งาน"}</StatusPill></p></div></div><div className="member-detail-actions">{member.status === "ใช้งาน" && <button className="danger-outline-button" onClick={() => setConfirmSuspend(true)}><LockKeyhole size={15} /> ระงับการใช้งาน</button>}<button className="outline-button" onClick={() => setNotice("เปิดแบบฟอร์มแก้ไขข้อมูลสมาชิกแล้ว")}><Settings2 size={15} /> แก้ไขข้อมูล</button></div></div><div className="member-detail-stats"><div><span className="stat-icon green"><WalletCards size={18} /></span><div><small>ยอดเงินคงเหลือ</small><strong>{member.balance}</strong></div></div><div><span className="stat-icon blue"><ShoppingCart size={18} /></span><div><small>ยอดซื้อเดือนนี้</small><strong>฿1,842.00</strong></div></div><div><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>เติมเงินสะสม</small><strong>฿4,500.00</strong></div></div><div><span className="stat-icon amber"><CalendarDays size={18} /></span><div><small>รายการล่าสุด</small><strong>{member.last}</strong></div></div></div><section className="panel table-panel member-history-panel"><div className="table-toolbar"><div><h2>ประวัติการทำรายการ</h2><p>ข้อมูลย้อนหลังของ {member.name} · รวม {transactions.length} รายการ</p></div><div className="filter-pills history-tabs">{["ทั้งหมด", "ซื้อสินค้า", "เติมเงิน", "ถอนเงิน"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item as typeof tab)}>{item}</button>)}</div></div><div className="member-history-list">{filtered.map((transaction) => <div className="history-row" key={transaction.id}><span className={`history-icon ${transaction.tone}`}>{transaction.type === "ซื้อสินค้า" ? <ShoppingCart size={16} /> : transaction.type === "เติมเงิน" ? <ArrowDownToLine size={16} /> : <ArrowUpFromLine size={16} />}</span><div className="history-main"><div><b>{transaction.type}</b><span>{transaction.id}</span></div><small>{transaction.detail}</small><time>{transaction.date}</time></div><strong className={transaction.type === "เติมเงิน" ? "positive" : "negative"}>{transaction.amount}</strong></div>)}</div>{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section><ConfirmDialog open={confirmSuspend} title="ยืนยันการระงับสมาชิก?" description={`สมาชิก ${member.name} จะไม่สามารถใช้ยอดคงเหลือซื้อสินค้าได้จนกว่าจะเปิดใช้งานอีกครั้ง`} confirmLabel="ยืนยันระงับการใช้งาน" onCancel={() => setConfirmSuspend(false)} onConfirm={() => { setConfirmSuspend(false); setNotice(`ระงับการใช้งาน ${member.name} แล้ว`); }} /></>;
}

function Members() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ทั้งหมด");
  const [notice, setNotice] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<(typeof memberRows)[number] | null>(null);
  const [newMember, setNewMember] = useState({ firstName: "", lastName: "", idCard: "", initialBalance: "" });
  const filtered = memberRows.filter((row) => `${row.name} ${row.id}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "ทั้งหมด" || row.status === statusFilter));
  if (selectedMember) return <MemberDetail member={selectedMember} onBack={() => setSelectedMember(null)} />;
  const registerMember = () => { if (!newMember.firstName.trim() || !newMember.lastName.trim()) { setNotice("กรุณาระบุชื่อและนามสกุลสมาชิก"); return; } setRegisterOpen(false); setNotice(`ลงทะเบียนสมาชิก ${newMember.firstName} ${newMember.lastName} แล้ว${newMember.initialBalance ? ` · เงินเริ่มต้น ${money(Number(newMember.initialBalance))}` : " · ยังไม่เติมเงิน"}`); setNewMember({ firstName: "", lastName: "", idCard: "", initialBalance: "" }); };
  return <><SectionHeader eyebrow="สมาชิกและบัญชีสวัสดิการ" title="จัดการสมาชิก" description="ลงทะเบียนสมาชิก ระบุเงินเริ่มต้น (ถ้ามี) ระงับการใช้งาน และดูประวัติรายบุคคล" action={<button className="primary-button" onClick={() => setRegisterOpen(true)}><Plus size={16} /> ลงทะเบียนสมาชิก</button>} /><div className="member-top-grid"><div className="member-balance-card"><div><span className="eyebrow">ยอดเงินในบัญชีสมาชิกทั้งหมด</span><strong>฿86,250.00</strong><small>เพิ่มขึ้น 4.2% จากสัปดาห์ก่อน</small></div><div className="balance-orb"><WalletCards size={26} /></div></div><div className="member-mini-card"><span className="stat-icon green"><UsersRound size={18} /></span><div><small>สมาชิกทั้งหมด</small><strong>1,324 <em>ราย</em></strong><p><span className="green-text">1,248 ใช้งาน</span> · 76 ระงับ</p></div></div><div className="member-mini-card"><span className="stat-icon purple"><ArrowDownToLine size={18} /></span><div><small>ลงทะเบียนเดือนนี้</small><strong>86 <em>ราย</em></strong><p>ข้อมูลสมาชิกใหม่ · ไม่รวมการเติมเงิน</p></div></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>สมาชิกทั้งหมด</h2><p>ค้นหาและกรองตามสถานะการใช้งานได้ทันที</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อ หรือเลขสมาชิก" /></div><div className="filter-pills">{["ทั้งหมด", "ใช้งาน", "ระงับ"].map((item) => <button className={statusFilter === item ? "active" : ""} key={item} onClick={() => setStatusFilter(item)}>{item}{item !== "ทั้งหมด" && <span>{memberRows.filter((row) => row.status === item).length}</span>}</button>)}</div></div></div><div className="table-filter-summary"><span><Search size={13} /> {query ? `ค้นหา “${query}”` : "สมาชิกทั้งหมด"}</span><span>แสดง {filtered.length} จาก {memberRows.length} รายการ</span></div><div className="table-wrap"><table><thead><tr><th>สมาชิก</th><th>ประเภท</th><th>ยอดเงินคงเหลือ</th><th>รายการล่าสุด</th><th>สถานะการใช้งาน</th><th /></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><div className="member-cell"><span className="member-table-avatar">{row.name.slice(3, 4)}</span><div><b>{row.name}</b><small>{row.id}</small></div></div></td><td>{row.type}</td><td><b>{row.balance}</b></td><td>{row.last}</td><td><StatusPill tone={row.tone}>{row.status === "ใช้งาน" ? "ใช้งานอยู่" : "ระงับการใช้งาน"}</StatusPill></td><td><button className="row-action" onClick={() => setSelectedMember(row)}>ดูรายละเอียด <span>→</span></button></td></tr>)}</tbody></table></div>{filtered.length === 0 && <div className="empty-filter"><UsersRound size={22} /><b>ไม่พบสมาชิกตามเงื่อนไข</b><span>ลองเปลี่ยนคำค้นหาหรือสถานะ</span></div>}{notice && <div className="notice-bar"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</section>{registerOpen && <div className="modal-backdrop" onClick={() => setRegisterOpen(false)}><div className="form-modal" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">MEMBER REGISTRATION</span><h2>ลงทะเบียนสมาชิก</h2><p>กรอกข้อมูลสมาชิกและเลือกเติมเงินครั้งแรกหรือไม่ก็ได้</p></div><button className="icon-button" onClick={() => setRegisterOpen(false)}><X size={17} /></button></div><div className="member-number-preview"><span><CreditCard size={16} /> หมายเลขสมาชิกจะกำหนดอัตโนมัติ</span><b>{formatMemberNumber("running", 1325)}</b></div><div className="form-grid compact-form"><label>ชื่อ *<input autoFocus value={newMember.firstName} onChange={(event) => setNewMember({ ...newMember, firstName: event.target.value })} placeholder="ชื่อ" /></label><label>นามสกุล *<input value={newMember.lastName} onChange={(event) => setNewMember({ ...newMember, lastName: event.target.value })} placeholder="นามสกุล" /></label><label className="wide">เลขที่บัตรประชาชน<input value={newMember.idCard} onChange={(event) => setNewMember({ ...newMember, idCard: event.target.value })} placeholder="-" /></label><label className="wide">เงินเริ่มต้น (ถ้ามี)<input type="number" min="0" value={newMember.initialBalance} onChange={(event) => setNewMember({ ...newMember, initialBalance: event.target.value })} placeholder="เว้นว่างได้ หากยังไม่เติมเงิน" /></label></div><div className="initial-balance-note"><ShieldCheck size={15} /> เงินจำนวนนี้เป็นยอดเริ่มต้นตอนลงทะเบียน ไม่ใช่เมนูเติมเงินภายหลัง</div><div className="modal-actions"><button className="outline-button" onClick={() => setRegisterOpen(false)}>ยกเลิก</button><button className="primary-button" onClick={registerMember}><Check size={16} /> บันทึกสมาชิก</button></div></div></div>}</>;
}

function Reports() {
  const dailySalesRows = [
    ["หมวดสินค้า", "จำนวนบิล", "ยอดขาย"],
    ["อาหาร", "42", "8620.00"],
    ["เครื่องดื่ม", "86", "5480.00"],
    ["ของใช้", "38", "3240.00"],
    ["สินค้าอื่น ๆ", "12", "1120.00"],
    ["รวม", "178", "18460.00"],
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
  const [period, setPeriod] = useState("รายวัน");
  const [notice, setNotice] = useState("");
  return <><SectionHeader eyebrow="สรุปผลและวิเคราะห์ข้อมูล" title="รายงาน" description="เลือกช่วงเวลา รายบุคคล หรือหมวดรายงานเพื่อดูและส่งออกข้อมูล" action={<button className="outline-button" onClick={() => setNotice("เปิดตัวเลือกช่วงวันที่แล้ว")}><CalendarDays size={16} /> 17 ก.ย. 2569 <ChevronDown size={15} /></button>} /><div className="report-tabs">{["รายวัน", "รายสัปดาห์", "รายเดือน", "กำหนดช่วงเวลา"].map((item) => <button className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)}>{item}</button>)}</div><div className="report-cards"><div className="report-card"><span>ยอดขายสินค้า</span><strong>฿18,460.00</strong><small className="green-text">↑ 12.8% จากช่วงก่อน</small><div className="sparkline teal-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>เติมเงินสมาชิก</span><strong>฿12,500.00</strong><small className="green-text">↑ 8.4% จากช่วงก่อน</small><div className="sparkline purple-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>ถอนเงินสมาชิก</span><strong>฿2,300.00</strong><small>31 รายการวันนี้</small><div className="sparkline amber-spark"><i /><i /><i /><i /><i /><i /><i /></div></div><div className="report-card"><span>กำไรขั้นต้นโดยประมาณ</span><strong>฿4,682.00</strong><small className="green-text">คิดเป็น 25.4%</small><div className="sparkline green-spark"><i /><i /><i /><i /><i /><i /><i /></div></div></div><div className="dashboard-grid report-lower" id="daily-sales-report"><section className="panel"><div className="panel-heading"><div><h2>สรุปยอดขายตามหมวด</h2><p>{period} · 17 กันยายน 2569</p></div><div className="report-export-actions"><button className="outline-button compact" onClick={downloadDailySalesCsv}><Download size={15} /> CSV</button><button className="outline-button compact" onClick={downloadDailySalesPdf}><FileBarChart size={15} /> PDF</button></div></div><div className="category-report"><div className="category-row"><div><b>อาหาร</b><span>42 บิล</span></div><div className="progress"><i style={{ width: "78%" }} /></div><strong>฿8,620.00</strong></div><div className="category-row"><div><b>เครื่องดื่ม</b><span>86 บิล</span></div><div className="progress blue"><i style={{ width: "64%" }} /></div><strong>฿5,480.00</strong></div><div className="category-row"><div><b>ของใช้</b><span>38 บิล</span></div><div className="progress purple"><i style={{ width: "41%" }} /></div><strong>฿3,240.00</strong></div><div className="category-row"><div><b>สินค้าอื่น ๆ</b><span>12 บิล</span></div><div className="progress amber"><i style={{ width: "22%" }} /></div><strong>฿1,120.00</strong></div></div></section><section className="panel"><div className="panel-heading"><div><h2>การส่งออกข้อมูล</h2><p>ไฟล์พร้อมดาวน์โหลดตามสิทธิ์ของคุณ</p></div><FileBarChart size={19} className="muted-icon" /></div><div className="export-list"><button onClick={downloadDailySalesCsv}><span className="file-icon csv">CSV</span><span><b>รายงานยอดขาย.csv</b><small>สรุปยอดขายตามหมวด · วันนี้</small></span><Download size={16} /></button><button onClick={downloadDailySalesPdf}><span className="file-icon pdf">PDF</span><span><b>รายงานยอดขาย.pdf</b><small>สรุปยอดขายตามหมวด · วันนี้</small></span><Download size={16} /></button><button onClick={() => setNotice("ส่งออกรายงานเป็น CSV แล้ว")}><span className="file-icon csv">CSV</span><span><b>ประวัติธุรกรรม.csv</b><small>ข้อมูลรายการทั้งหมด · วันนี้</small></span><Download size={16} /></button></div></section></div>{notice && <div className="notice-bar floating-notice"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}</>;
}

function Settings() {
  const [saved, setSaved] = useState(false);
  const [receipt, setReceipt] = useState(true);
  const [memberAlert, setMemberAlert] = useState(true);
  const [numberMode, setNumberMode] = useState("running");
  return <><SectionHeader eyebrow="ระบบและการกำหนดค่า" title="ตั้งค่า" description="จัดการข้อมูลร้านค้า ใบเสร็จ การแจ้งเตือน และรูปแบบเลขสมาชิก" action={<button className="primary-button" onClick={() => setSaved(true)}><Check size={16} /> บันทึกการตั้งค่า</button>} /><div className="settings-layout"><div className="settings-nav"><button className="active"><ReceiptText size={17} /> ใบเสร็จและการขาย</button><button><CreditCard size={17} /> สมาชิกและเลขสมาชิก</button><button><WalletCards size={17} /> รูปแบบการชำระเงิน</button><button><Bell size={17} /> การแจ้งเตือน</button><button><ShieldCheck size={17} /> สิทธิ์และบทบาท</button><button><Activity size={17} /> การบันทึก Log</button></div><div className="settings-content"><section className="panel settings-card"><div className="settings-heading"><div><h2>ข้อมูลร้านค้า</h2><p>ข้อมูลจะแสดงบนหัวใบเสร็จและรายงาน</p></div><ShoppingBag size={20} className="muted-icon" /></div><div className="form-grid"><label>ชื่อร้านค้า<input defaultValue="ร้านค้าสวัสดิการโรงพยาบาลผู้ป่วยจิตเวช" /></label><label>รหัสร้านค้า<input defaultValue="WEL-PSY-001" /></label><label className="wide">ที่อยู่<input defaultValue="โรงพยาบาลผู้ป่วยจิตเวช · ฝ่ายสวัสดิการ" /></label></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>การกำหนดหมายเลขสมาชิก</h2><p>เลือกวิธีสร้างหมายเลขสำหรับสมาชิกใหม่ที่จะลงทะเบียน</p></div><CreditCard size={20} className="muted-icon" /></div><div className="number-mode-grid">{[["running", "รันเลขต่อเนื่อง", "M-000001, M-000002, ..."], ["year", "ขึ้นต้นด้วยปี", "69-00001, 69-00002, ..."], ["manual", "กำหนดเอง", "เจ้าหน้าที่กรอกหมายเลขเอง"]].map(([value, title, detail]) => <button className={numberMode === value ? "selected" : ""} key={value} onClick={() => setNumberMode(value)}><span className="number-radio">{numberMode === value && <i />}</span><span><b>{title}</b><small>{detail}</small></span></button>)}</div><div className="number-preview"><span>ตัวอย่างสมาชิกถัดไป</span><b>{formatMemberNumber(numberMode as "running" | "year" | "manual", 1325)}</b></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>ใบเสร็จรับเงิน</h2><p>กำหนดรายละเอียดที่ต้องการแสดงบนใบเสร็จ</p></div><ReceiptText size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>พิมพ์ใบเสร็จอัตโนมัติหลังชำระเงิน</b><small>ใช้กับเครื่องพิมพ์ใบเสร็จที่เชื่อมต่ออยู่</small></div><button className={`toggle ${receipt ? "on" : ""}`} onClick={() => setReceipt(!receipt)}><span /></button></div><div className="toggle-row"><div><b>แสดงยอดคงเหลือสมาชิกบนใบเสร็จ</b><small>แสดงยอดก่อนและหลังรายการ</small></div><button className="toggle on"><span /></button></div></section><section className="panel settings-card"><div className="settings-heading"><div><h2>การแจ้งเตือน</h2><p>ช่วยให้เจ้าหน้าที่ติดตามรายการสำคัญได้ทันเวลา</p></div><Bell size={20} className="muted-icon" /></div><div className="toggle-row"><div><b>แจ้งเตือนเมื่อสมาชิกมียอดคงเหลือต่ำ</b><small>แจ้งเตือนเมื่อยอดต่ำกว่า ฿100.00</small></div><button className={`toggle ${memberAlert ? "on" : ""}`} onClick={() => setMemberAlert(!memberAlert)}><span /></button></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดสต็อก</b><small>แจ้งเตือนเมื่อจำนวนต่ำกว่าจุดสั่งซื้อ</small></div><button className="toggle on"><span /></button></div><div className="toggle-row"><div><b>แจ้งเตือนสินค้าใกล้หมดอายุ</b><small>แจ้งเตือนล่วงหน้า 30 วัน</small></div><button className="toggle on"><span /></button></div></section>{saved && <div className="notice-bar"><Check size={16} /> บันทึกการตั้งค่าเรียบร้อยแล้ว<button onClick={() => setSaved(false)}><X size={14} /></button></div>}</div></div></>;
}

function Logs() {
  return <><SectionHeader eyebrow="ตรวจสอบย้อนหลังและความโปร่งใส" title="ระบบ Log" description="บันทึกทุกกิจกรรมสำคัญของผู้ใช้งานและธุรกรรมในระบบ" action={<button className="outline-button"><Download size={16} /> ส่งออก Log</button>} /><div className="log-summary"><div><Activity size={18} /><span>รายการวันนี้<strong>386</strong></span></div><div><ShieldCheck size={18} /><span>ผู้ใช้งานในระบบ<strong>12</strong></span></div><div><ReceiptText size={18} /><span>ธุรกรรมที่บันทึก<strong>100%</strong></span></div></div><section className="panel table-panel"><div className="table-toolbar"><div><h2>กิจกรรมทั้งหมด</h2><p>ข้อมูลสำหรับตรวจสอบย้อนหลังของเจ้าหน้าที่และผู้บริหาร</p></div><div className="toolbar-actions"><div className="search-field"><Search size={16} /><input placeholder="ค้นหากิจกรรม หรือผู้ใช้งาน" /></div><button className="outline-button"><CalendarDays size={16} /> ช่วงเวลา</button></div></div><div className="table-wrap"><table><thead><tr><th>วันและเวลา</th><th>ผู้ทำรายการ</th><th>กิจกรรม</th><th>รายละเอียด</th><th>ระดับสิทธิ์</th><th /></tr></thead><tbody>{logs.concat(logs).map((log, index) => <tr key={`${log.time}-${index}`}><td>{log.time}</td><td><b>{log.actor}</b></td><td><StatusPill tone={log.tone}>{log.action}</StatusPill></td><td>{log.detail}</td><td>{log.role}</td><td><button className="table-more"><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table></div></section></>;
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
  return <div className="app-shell"><aside className={`sidebar ${mobileNav ? "open" : ""}`}><div className="brand"><div className="brand-mark"><span>ส</span></div><div><b>สวัสดิการ รพจ.</b><small>Hospital Welfare Store</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X size={19} /></button></div><div className="role-card"><div className={`role-avatar ${role}`}>{role === "admin" ? "ว" : "ก"}</div><div><b>{profileName}</b><span>{role === "admin" ? "ผู้บริหารระบบ" : "เจ้าหน้าที่ร้านค้า"}</span></div><ChevronDown size={15} className="muted-icon" /></div><RoleSwitcher role={role} onChange={switchRole} /><nav>{navItems.map(({ id, label, caption, icon: Icon }) => <button className={safeView === id ? "active" : ""} key={id} onClick={() => { setActiveView(id); setMobileNav(false); }}><Icon size={19} /><span><b>{label}</b><small>{caption}</small></span>{id === "stock" && <i className="nav-badge">9</i>}</button>)}</nav><div className="nav-separator" /><nav className="secondary-nav">{role === "admin" ? <><button className={safeView === "settings" ? "active" : ""} onClick={() => { setActiveView("settings"); setMobileNav(false); }}><Settings2 size={19} /><span><b>ตั้งค่า</b><small>ระบบและใบเสร็จ</small></span></button><button className={safeView === "logs" ? "active" : ""} onClick={() => { setActiveView("logs"); setMobileNav(false); }}><Activity size={19} /><span><b>ระบบ Log</b><small>ประวัติการใช้งาน</small></span></button></> : <div className="locked-nav"><LockKeyhole size={15} /><span>เมนูผู้บริหารถูกซ่อน</span></div>}</nav><div className="sidebar-footer"><div className="secure-badge"><ShieldCheck size={17} /><span><b>ระบบปลอดภัย</b><small>ข้อมูลถูกเข้ารหัสและสำรอง</small></span></div><div className="sidebar-version">v1.0.0 · ฝ่ายสวัสดิการ</div></div></aside><main className="main-shell"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={21} /></button><div className="breadcrumb"><span>ร้านค้าสวัสดิการ</span><b>/</b><strong>{pageTitle}</strong></div><div className="topbar-actions"><div className="global-search"><Search size={17} /><span>ค้นหาเมนูหรือรายการ...</span><kbd>⌘ K</kbd></div><RoleSwitcher role={role} onChange={switchRole} /><button className="top-icon"><Bell size={18} /><i /></button><div className="profile-pill"><span className={`profile-avatar ${role}`}>{role === "admin" ? "ว" : "ก"}</span><div><b>{profileName}</b><small>{role === "admin" ? "ผู้บริหาร" : "เจ้าหน้าที่"}</small></div><ChevronDown size={15} className="muted-icon" /></div></div></header><div className="page-content">{safeView === "dashboard" && <Dashboard setView={setActiveView} setPosShortcut={setPosShortcut} role={role} />}{safeView === "pos" && <Pos shortcut={posShortcut} setShortcut={setPosShortcut} role={role} />}{safeView === "stock" && <Stock role={role} />}{safeView === "members" && <Members />}{safeView === "reports" && <Reports />}{safeView === "settings" && role === "admin" && <Settings />}{safeView === "logs" && role === "admin" && <Logs />}</div><footer className="app-footer"><span>ร้านค้าสวัสดิการโรงพยาบาลผู้ป่วยจิตเวช</span><span>ศูนย์ช่วยเหลือ <CircleHelp size={14} /> · 02-XXX-XXXX</span><span className="powered-by">Power by PNG TEAM</span></footer></main></div>;
}
