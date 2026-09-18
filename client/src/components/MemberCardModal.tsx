import { useState } from "react";
import html2canvas from "html2canvas";
import { CreditCard, Download, Printer, X } from "lucide-react";
import { money } from "../pages/pageData";

/** Fields the wallet card actually renders (subset of the member record). */
export type MemberCardData = {
  memberNumber: string;
  firstName: string;
  lastName: string;
  type: string;
  balance: number;
  status: "active" | "suspended";
  createdAt: string;
};

/** "2026-09-18 14:42:33" → "18 ก.ย. 2569" */
function formatCardDate(value: string) {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Member wallet card — printed by the store and handed to the member.
 * The card is the member's only touchpoint with the system: they show it
 * (or read the number) at the counter to spend from their welfare balance.
 * Members never log into the app — this modal exists purely for the store
 * staff to produce that physical card.
 */
export function MemberCardModal({ member, onClose }: { member: MemberCardData; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const displayName = `${member.firstName} ${member.lastName}`.trim();
  const downloadCard = async () => {
    const element = document.getElementById("member-card");
    if (!element) return;
    setBusy(true);
    try {
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.download = `card-${member.memberNumber}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally { setBusy(false); }
  };
  // Print while the modal stays mounted — the @media print rules keyed on
  // body:has(#member-card) isolate the card onto a clean cut-ready page.
  const printCard = () => window.print();
  return <div className="modal-backdrop" onClick={onClose}><div className="member-card-modal" onClick={(event) => event.stopPropagation()}>
    <div className="modal-heading">
      <div>
        <span className="eyebrow">MEMBER WALLET CARD</span>
        <h2>บัตรสมาชิก</h2>
        <p>{displayName} · บัตรสำหรับใช้จ่ายที่เคาน์เตอร์ร้านค้าเท่านั้น</p>
      </div>
      <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={17} /></button>
    </div>
    <div className="member-card-stage">
      <div className="member-card" id="member-card">
        <div className="member-card-top">
          <div className="member-card-brand"><span>ส</span><div><b>ร้านค้าสวัสดิการ</b><small>Welfare Store</small></div></div>
          <span className="member-card-type">{member.type}</span>
        </div>
        <div className="member-card-body">
          <div className="member-card-name">{displayName}</div>
          <div className="member-card-number">{member.memberNumber}</div>
          <div className="member-card-meta">
            <span>สมาชิกตั้งแต่ {formatCardDate(member.createdAt)}</span>
            <span className={member.status === "active" ? "ok" : "suspended"}>{member.status === "active" ? "ใช้จ่ายได้ปกติ" : "ระงับการใช้จ่าย"}</span>
          </div>
        </div>
        <div className="member-card-foot">
          <small>แสดงบัตรนี้ หรือแจ้งหมายเลขสมาชิก ที่เคาน์เตอร์เพื่อใช้ยอดเงินสวัสดิการ</small>
          <small>ยอดคงเหลือ <b>{money(member.balance)}</b> ณ วันออกบัตร</small>
        </div>
      </div>
    </div>
    <div className="member-card-note"><CreditCard size={15} /> สมาชิกไม่มีบัญชีเข้าสู่ระบบแอป — บัตรใบนี้ใช้ระบุตัวตนที่เคาน์เตอร์เพื่อหักยอดใช้จ่ายจากบัญชีสมาชิกเท่านั้น</div>
    <div className="modal-actions">
      <button className="outline-button" disabled={busy} onClick={downloadCard}><Download size={16} /> {busy ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปบัตร"}</button>
      <button className="primary-button" onClick={printCard}><Printer size={16} /> พิมพ์บัตรสมาชิก</button>
    </div>
  </div></div>;
}
