"use client"
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import html2canvas from "html2canvas";
import QRCode from "qrcode";
import { Barcode, CreditCard, Download, Printer, QrCode as QrIcon, ScanLine, ShieldAlert, UserCheck, X } from "lucide-react";
import { money } from "@/lib/pageData";
import { code128DataUrl } from "@/lib/barcode";
import { MemberAvatar } from "./MemberAvatar";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client";
import { brandInitial } from "@/lib/theme";
import { PrintPreviewModal } from "./PrintPreviewModal";

/** Fields the wallet card actually renders (subset of the member record). */
export type MemberCardData = {
  memberNumber: string;
  /** คำนำหน้าชื่อ (นาย/นาง/นางสาว/…) — null = ไม่มี */
  prename?: string | null;
  firstName: string;
  lastName: string;
  type: string;
  balance: number;
  status: "active" | "suspended";
  /** ในโหมดยืนยัน (สแกนบัตรที่ POS) อาจมีแค่ข้อมูลจาก member.list ที่ไม่มีวันสมัคร */
  createdAt?: string | null;
  photoUrl?: string | null;
  gender?: string | null;
  /** ROUND 34 — วงเงินซื้อต่อวัน (ชำระหักบัญชี) แสดงเฉพาะโหมดยืนยัน */
  creditLimit?: number | null;
  /** ROUND 65 — รหัสบัตรเงินสด / รหัสผู้ป่วย (HN) — แสดงบนบัตรเมื่อมีข้อมูล */
  cardNumber?: string | null;
  patientCode?: string | null;
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
 *
 * Round 37 (req 36) — โหมดยืนยัน (confirmForBill): ยิงบัตรสมาชิกที่ช่องสแกน POS
 * แล้วโมดูลบัตรนี้เด้งขึ้นมาทันที ให้พนักงานเทียบ ชื่อ-รูป-เลขสมาชิก-ยอดคงเหลือ
 * กับบัตรจริงก่อนกดยืนยันเข้าบิล — ปุ่มพิมพ์/ดาวน์โหลดถูกแทนด้วยปุ่มยืนยัน
 */
export function MemberCardModal({
  member,
  onClose,
  confirmForBill = false,
  onConfirm,
  confirmLabel = "ยืนยันใช้กับบิลนี้",
  confirmHint,
}: {
  member: MemberCardData;
  onClose: () => void;
  /** true = โหมดยืนยันตอนสแกนบัตร (ปุ่มยืนยันแทนปุ่มพิมพ์) */
  confirmForBill?: boolean;
  onConfirm?: () => void;
  /** ข้อความปุ่มยืนยัน (ปรับตามบริบท เช่น เติม/ถอนเงิน) */
  confirmLabel?: string;
  /** ข้อความบอกเหตุผลที่บัตรเด้ง (default อธิบายการสแกน) */
  confirmHint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  // Round 43 — แบรนด์ตามที่ผู้บริหารตั้งใน ตั้งค่า → ชื่อร้านและโลโก้ (เหมือนใบเสร็จ)
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const brandName = (settingsQuery.data?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const brandLogo = settingsQuery.data?.appLogo ?? "";
  const barcodeDataUrl = code128DataUrl(member.memberNumber, { height: 54, moduleWidth: 2, padding: 10 });
  const displayName = [member.prename?.trim() || "", member.firstName, member.lastName].filter(Boolean).join(" ");
  const suspended = member.status === "suspended";
  // Round 43 (บั๊กชื่อถูกตัด) — ชื่อยาวย่อฟอนต์เป็นขั้น และรับ 2 บรรทัดได้ใน CSS
  const nameLength = displayName.length;
  const nameFit = nameLength > 36 ? " fit-xs" : nameLength > 26 ? " fit-sm" : "";

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
      // Round 43 — รอฟอนต์ (Sarabun) พร้อมก่อนเสมอ กัน html2canvas วาดข้อความไทยตกหล่น
      if (document.fonts?.ready) await document.fonts.ready;
      const canvas = await html2canvas(element, { scale: 2, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.download = `card-${member.memberNumber}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } finally { setBusy(false); }
  };
  // ROUND 51 — พิมพ์บัตรผ่านพรีวิวก่อน (เหมือนจุดพิมพ์อื่น) ตรวจบัตรให้ถูกคนก่อนสั่งพิมพ์จริง
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const printCard = () => setPrintPreviewOpen(true);
  return <div className="modal-backdrop" onClick={onClose}><div className={`member-card-modal${confirmForBill ? " confirm-mode" : ""}`} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={confirmForBill ? "ยืนยันข้อมูลสมาชิกก่อนทำรายการ" : "บัตรสมาชิก"}>
    <div className="modal-heading">
      <div>
        <span className="eyebrow">{confirmForBill ? "MEMBER VERIFICATION · SCAN" : "MEMBER WALLET CARD"}</span>
        <h2>{confirmForBill ? "ยืนยันข้อมูลสมาชิก" : "บัตรสมาชิก"}</h2>
        <p>{confirmForBill
          ? `สแกนบัตรของ ${displayName} แล้ว — เทียบชื่อ รูป เลขสมาชิก และยอดคงเหลือบนบัตรกับหน้าจอนี้ ก่อนนำไปใช้ทำรายการ`
          : `${displayName} · บัตรใช้ยืนยันตัวตนที่เคาน์เตอร์ — มีทั้งบาร์โค้ดและคิวอาร์โค้ดในใบเดียว`}</p>
      </div>
      <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={17} /></button>
    </div>
    {confirmForBill && (
      <div className={`member-verify-strip${suspended ? " suspended" : ""}`}>
        {suspended ? <ShieldAlert size={15} /> : <ScanLine size={15} />}
        <span>{confirmHint ?? (suspended
          ? "บัตรใบนี้ถูกระงับการใช้จ่าย — ตรวจสอบกับสมาชิกและผู้บริหารก่อน หากยืนยันจะยังชำระด้วยเงินสด/QR ได้แต่หักบัญชีไม่ได้"
          : "ตรวจสอบว่าเป็นสมาชิกที่ถูกต้องแล้วกดยืนยัน — ยอดในบัญชียังไม่ถูกหักจนกว่าจะกดชำระเงินท้ายบิล")}{member.creditLimit != null ? <> · วงเงินซื้อ/วัน {money(member.creditLimit)}</> : null}</span>
      </div>
    )}
    <div className="member-card-stage">
      <div className="member-card" id="member-card">
        <div className="member-card-top">
          <div className="member-card-brand">{brandLogo ? <img className="brand-logo member-card-logo" src={brandLogo} alt={brandName} /> : <span>{brandInitial(brandName)}</span>}<div><b>{brandName}</b><small>Welfare Store</small></div></div>
          <span className="member-card-type">{member.type}</span>
        </div>
        <div className="member-card-body">
          <div className="member-card-photo">
            <MemberAvatar member={member} size={82} />
          </div>
          <div className="member-card-identity">
            <div className={`member-card-name${nameFit}`}>{displayName}</div>
            <div className="member-card-number">{member.memberNumber}</div>{member.cardNumber ? <div className="member-card-patient">{`บัตร ${member.cardNumber}${member.patientCode ? ` · HN ${member.patientCode}` : ""}`}</div> : null}
            <div className="member-card-meta">
              {member.createdAt ? <span>สมาชิกตั้งแต่ {formatCardDate(member.createdAt)}</span> : <span className="now">พร้อมใช้จ่ายที่เคาน์เตอร์</span>}
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
          <small>ยอดคงเหลือ <b>{money(member.balance)}</b>{confirmForBill ? " ณ ตอนสแกนบัตร" : " ณ วันออกบัตร"}</small>
        </div>
      </div>
    </div>
    <div className="member-card-note"><CreditCard size={15} /> {confirmForBill ? "ทุกครั้งที่ยิงบัตรสมาชิก ระบบจะเด้งข้อมูลบัตรขึ้นมาให้ตรวจสอบเสมอ — ยืนยันเฉพาะเมื่อข้อมูลตรงกับลูกค้าที่ยื่นบัตรเท่านั้น" : "สมาชิกไม่มีบัญชีเข้าสู่ระบบแอป — บัตรใบนี้ใช้ระบุตัวตนที่เคาน์เตอร์ · ทุกครั้งที่สแกนบัตร พนักงานจะเห็นข้อมูลสมาชิกเพื่อยืนยันก่อนหักยอดเสมอ"}</div>
    <div className="modal-actions">
      {confirmForBill ? <>
        <button className="outline-button" onClick={onClose}><X size={16} /> ไม่ใช่สมาชิกนี้</button>
        <button className="primary-button" disabled={busy} onClick={() => onConfirm?.()}><UserCheck size={16} /> {confirmLabel}</button>
      </> : <>
        <button className="outline-button" disabled={busy} onClick={downloadCard}><Download size={16} /> {busy ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปบัตร"}</button>
        <button className="primary-button" onClick={printCard}><Printer size={16} /> พิมพ์บัตรสมาชิก</button>
      </>}
    </div>
    {printPreviewOpen && <PrintPreviewModal targetId="member-card" title="พรีวิวก่อนพิมพ์บัตรสมาชิก" subtitle={`${displayName} · ${member.memberNumber}`} paper="card" chips={[`ยอดคงเหลือ ${money(member.balance)}`, member.status === "active" ? "สถานะใช้จ่ายได้" : "ระงับการใช้จ่าย"]} onClose={() => setPrintPreviewOpen(false)} />}
  </div></div>;
}
