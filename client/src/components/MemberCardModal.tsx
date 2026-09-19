import { useEffect, useState } from "react";
import html2canvas from "html2canvas";
import QRCode from "qrcode";
import { Barcode, CreditCard, Download, Printer, QrCode as QrIcon, X } from "lucide-react";
import { money } from "../pages/pageData";
import { code128DataUrl } from "../barcode";
import { MemberAvatar } from "./MemberAvatar";

/** Fields the wallet card actually renders (subset of the member record). */
export type MemberCardData = {
  memberNumber: string;
  firstName: string;
  lastName: string;
  type: string;
  balance: number;
  status: "active" | "suspended";
  createdAt: string;
  photoUrl?: string | null;
  gender?: string | null;
};

/** "2026-09-18 14:42:33" → "18 ก.ย. 2569" */
function formatCardDate(value: string) {
  const date = new Date(value.includes("T") ? value : value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Member wallet card — printed by the store and handed to the member.
 * Round 31: the card now carries BOTH machine codes the counter can read —
 * a Code128 barcode (บาร์โค้ด) and a QR — of the member number, plus the
 * member photo (gender-based placeholder when no photo exists).
 * The cashier scans either code, the POS shows the member profile to confirm
 * before any deduction — the card and the flow now protect each other.
 */
export function MemberCardModal({ member, onClose }: { member: MemberCardData; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const barcodeDataUrl = code128DataUrl(member.memberNumber, { height: 54, moduleWidth: 2, padding: 10 });
  const displayName = `${member.firstName} ${member.lastName}`.trim();

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(member.memberNumber, { margin: 0, width: 240, errorCorrectionLevel: "M" })
      .then((url) => { if (alive) setQrDataUrl(url); })
      .catch(() => { if (alive) setQrDataUrl(""); });
    return () => { alive = false; };
  }, [member.memberNumber]);

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
        <p>{displayName} · บัตรใช้ยืนยันตัวตนที่เคาน์เตอร์ — มีทั้งบาร์โค้ดและคิวอาร์โค้ดในใบเดียว</p>
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
          <div className="member-card-photo">
            <MemberAvatar member={member} size={82} />
          </div>
          <div className="member-card-identity">
            <div className="member-card-name">{displayName}</div>
            <div className="member-card-number">{member.memberNumber}</div>
            <div className="member-card-meta">
              <span>สมาชิกตั้งแต่ {formatCardDate(member.createdAt)}</span>
              <span className={member.status === "active" ? "ok" : "suspended"}>{member.status === "active" ? "ใช้จ่ายได้ปกติ" : "ระงับการใช้จ่าย"}</span>
            </div>
          </div>
        </div>
        <div className="member-card-codes">
          <div className="member-card-barcode">
            {barcodeDataUrl ? <img src={barcodeDataUrl} alt={`บาร์โค้ดเลขสมาชิก ${member.memberNumber}`} /> : <span className="member-card-code-fallback">—</span>}
            <small><Barcode size={12} /> บาร์โค้ด</small>
          </div>
          <div className="member-card-qr">
            {qrDataUrl ? <img src={qrDataUrl} alt={`คิวอาร์โค้ดเลขสมาชิก ${member.memberNumber}`} /> : <span className="member-card-code-fallback"><QrIcon size={40} /></span>}
            <small><QrIcon size={12} /> คิวอาร์โค้ด</small>
          </div>
        </div>
        <div className="member-card-foot">
          <small>ยื่นบัตรนี้ให้สแกน หรือแจ้งหมายเลขสมาชิก ที่เคาน์เตอร์เพื่อใช้ยอดเงินสวัสดิการ</small>
          <small>ยอดคงเหลือ <b>{money(member.balance)}</b> ณ วันออกบัตร</small>
        </div>
      </div>
    </div>
    <div className="member-card-note"><CreditCard size={15} /> สมาชิกไม่มีบัญชีเข้าสู่ระบบแอป — บัตรใบนี้ใช้ระบุตัวตนที่เคาน์เตอร์ · ทุกครั้งที่สแกนบัตร พนักงานจะเห็นข้อมูลสมาชิกเพื่อยืนยันก่อนหักยอดเสมอ</div>
    <div className="modal-actions">
      <button className="outline-button" disabled={busy} onClick={downloadCard}><Download size={16} /> {busy ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปบัตร"}</button>
      <button className="primary-button" onClick={printCard}><Printer size={16} /> พิมพ์บัตรสมาชิก</button>
    </div>
  </div></div>;
}
