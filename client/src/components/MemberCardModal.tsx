import { useEffect, useMemo, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { Barcode, CreditCard, FileImage, LayoutGrid, Printer, QrCode as QrIcon, ScanLine, ShieldAlert, UserCheck, X } from "@/lib/icons";
import { money } from "../pages/pageData";
import { code128DataUrl } from "../barcode";
import { MemberAvatar } from "./MemberAvatar";
import { trpc } from "@/lib/trpc";
import { brandInitial } from "@/theme";
import { printViaHelper, getPrinterName } from "@/lib/printHelper";
import { BUILT_IN_PROFILES, loadCardSheetProfile, saveCardSheetProfile, slotPositions, slotsPerSheet, type CardSheetProfile } from "@shared/cardSheet";

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

/** FIX-4 issue 4 — Hook that resolves the brand (name+logo) from settings. */
function useBrand() {
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const brandName = (settingsQuery.data?.appName ?? "").trim() || "ร้านค้าสวัสดิการ";
  const brandLogo = settingsQuery.data?.appLogo ?? "";
  return { brandName, brandLogo };
}

/** FIX-4 issue 4 — QR code data-URL for a given payload (member number). */
function useQrDataUrl(payload: string) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(payload, { margin: 0, width: 240, errorCorrectionLevel: "M" })
      .then((dataUrl) => { if (alive) setUrl(dataUrl); })
      .catch(() => { if (alive) setUrl(""); });
    return () => { alive = false; };
  }, [payload]);
  return url;
}

/**
 * FIX-4 issue 4 — Card art (the printable .member-card element) shared by
 * the single-card modal and the batch modal. Caller can pass `id` so the
 * print CSS (body:has(#member-card)) finds the right element to print.
 *
 * Single-card flow: id="member-card" (kept for back-compat with PrintPreviewModal).
 * Batch flow: id="member-card-batch" wraps the grid; each card has no id.
 */
export function MemberCardArt({
  member,
  brandName,
  brandLogo,
  qrDataUrl,
  id,
  footnoteAtScan = false,
}: {
  member: MemberCardData;
  brandName: string;
  brandLogo: string;
  qrDataUrl: string;
  /** id for the printed element — defaults to "member-card" for single-card print. */
  id?: string;
  /** true = "ณ ตอนสแกนบัตร" (used in confirmForBill mode). */
  footnoteAtScan?: boolean;
}) {
  const barcodeDataUrl = code128DataUrl(member.memberNumber, { height: 54, moduleWidth: 2, padding: 10 });
  const displayName = [member.prename?.trim() || "", member.firstName, member.lastName].filter(Boolean).join(" ");
  // Round 43 (บั๊กชื่อถูกตัด) — ชื่อยาวย่อฟอนต์เป็นขั้น และรับ 2 บรรทัดได้ใน CSS
  const nameLength = displayName.length;
  const nameFit = nameLength > 36 ? " fit-xs" : nameLength > 26 ? " fit-sm" : "";
  return (
    <div className="member-card" id={id}>
      <div className="member-card-top">
        <div className="member-card-brand">{brandLogo ? <img className="brand-logo member-card-logo" src={brandLogo} alt={brandName} /> : <span>{brandInitial(brandName)}</span>}<div><b>{brandName}</b><small>Welfare Store</small></div></div>
        <span className="member-card-type">{member.type}</span>
      </div>
      <div className="member-card-body">
        <div className="member-card-photo">
          <MemberAvatar member={member} size={60} rounded={false} />
        </div>
        <div className="member-card-identity">
          <div className={`member-card-name${nameFit}`}>{displayName}</div>
          <div className="member-card-number">{member.memberNumber}</div>{member.cardNumber ? <div className="member-card-patient">{`บัตร ${member.cardNumber}${member.patientCode ? ` · HN ${member.patientCode}` : ""}`}</div> : null}
          <div className="member-card-meta">
            {member.createdAt ? <span>สมัครเมื่อ {formatCardDate(member.createdAt)}</span> : <span className="now">พร้อมใช้จ่ายที่เคาน์เตอร์</span>}
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
      {/* P0-UX-02 (owner rule) — ห้ามพิมพ์ยอดคงเหลือติดบัตรถาวร เพราะยอดเปลี่ยนทุกครั้งที่ซื้อ/เติม/ถอน
          และทำให้สมาชิกเข้าใจผิด ยอดคงเหลือแสดงเฉพาะในหน้าจอ POS/บัตร modal ไม่พิมพ์บนบัตร */}
      <div className="member-card-foot">
        <small>ยื่นบัตรนี้ให้สแกน หรือแจ้งหมายเลขสมาชิก ที่เคาน์เตอร์เพื่อใช้ยอดเงินสวัสดิการ</small>
      </div>
    </div>
  );
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
 *
 * FIX-4 issue 4 — added "พิมพ์อีกครั้ง" so the user can re-print without
 * re-opening the modal. Card art is shared with MemberCardBatchModal via
 * MemberCardArt.
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
  const [busy, setBusy] = useState<"" | "pdf" | "png">("");
  const { brandName, brandLogo } = useBrand();
  const qrDataUrl = useQrDataUrl(member.memberNumber);
  const displayName = [member.prename?.trim() || "", member.firstName, member.lastName].filter(Boolean).join(" ");
  const suspended = member.status === "suspended";

  // P0-UX-02 — จับภาพบัตรเป็น canvas (ใช้ร่วมกัน PDF + PNG) เพื่อไม่ต้อง html2canvas ซ้อหลายรอบ
  // scale 4: 360×220 → 1440×880px (≈406 DPI เกินมาตรฐานร้านพิมพ์ 300 DPI / 1063×650px ตาม owner spec)
  // พื้นหลังขาวสะอาด (ไม่มี #f9fbfa tint ของ UI ติดไป) + useCORS รอรูปสมาชิก/โลโก้
  const captureCardCanvas = async (): Promise<HTMLCanvasElement | null> => {
    const element = document.getElementById("member-card-capture");
    if (!element) return null;
    if (document.fonts?.ready) await document.fonts.ready;
    return html2canvas(element, {
      scale: 4,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });
  };
  // P0-UX-02 owner spec output #1 — PDF 90×55มม. print-ready (ส่งร้านพิมพ์)
  // PNG lossless (ตัด artifacts ของ JPEG บนตัวอักษร/บาร์โค้ด/QR)
  const downloadCardPdf = async () => {
    setBusy("pdf");
    try {
      const canvas = await captureCardCanvas();
      if (!canvas) return;
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [90, 55] });
      pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 90, 55);
      pdf.save(`card-${member.memberNumber}.pdf`);
    } finally { setBusy(""); }
  };
  // P0-UX-02 owner spec output #2 — PNG ความละเอียดสูง (ส่งไลน์/ตรวจภาพ/พิมพ์ด่วน)
  // ไม่หุ้มใน PDF — เป็นไฟล์ภาพตรงๆ 1440×880px (เกินมาตรฐาน 1063×650 @ 300 DPI)
  const downloadCardPng = async () => {
    setBusy("png");
    try {
      const canvas = await captureCardCanvas();
      if (!canvas) return;
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `card-${member.memberNumber}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally { setBusy(""); }
  };
  const printCard = async () => {
    // Task A3 — สั่งพิมพ์ผ่าน Helper ไปยัง card printer ที่เลือกใน Settings (localStorage)
    const printerName = getPrinterName("card");
    const cardHtml = document.getElementById("member-card")?.outerHTML ?? "";
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { size: 90mm 55mm; margin: 0; }
body { margin: 0; }
${document.querySelector('style')?.textContent ?? ""}
</style></head><body>${cardHtml}</body></html>`;
    await printViaHelper(printerName, fullHtml);
  };
  useEffect(() => {
    if (confirmForBill) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      event.preventDefault();
      window.print();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [confirmForBill]);
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
        <b className="verify-balance-chip">{money(member.balance)}<small>ยอดคงเหลือ ณ ตอนสแกน</small></b>
      </div>
    )}
    <div className="member-card-stage">
      <MemberCardArt member={member} brandName={brandName} brandLogo={brandLogo} qrDataUrl={qrDataUrl} id="member-card" footnoteAtScan={confirmForBill} />
    </div>
    {/* P0-UX-02 (owner rule) — ยอดคงเหลือไม่พิมพ์บนบัตร แต่พนักงานยังเห็นใน modal
        เพื่อยืนยันกับลูกค้าก่อนออกบัตร (โหมดยืนยันแสดงใน verify-strip แทน) */}
    {!confirmForBill && (
      <div className={`member-card-balance-bar${suspended ? " suspended" : ""}`}>
        <span className="balance-label">ยอดคงเหลือ ณ วันออกบัตร</span>
        <b className="balance-amount">{money(member.balance)}</b>
        <span className={`balance-status ${member.status === "active" ? "ok" : "suspended"}`}>{member.status === "active" ? "ใช้จ่ายได้ปกติ" : "ระงับการใช้จ่าย"}</span>
      </div>
    )}
    {/* P0-3 — hidden capture host สำหรับสร้าง PDF (ใช้ html2canvas จับภาพ 90×55 มม.) */}
    {!confirmForBill && (
      <div className="member-card-capture-host" aria-hidden="true">
        <MemberCardArt member={member} brandName={brandName} brandLogo={brandLogo} qrDataUrl={qrDataUrl} id="member-card-capture" footnoteAtScan={confirmForBill} />
      </div>
    )}
    <div className="member-card-note"><CreditCard size={15} /> {confirmForBill ? "ทุกครั้งที่ยิงบัตรสมาชิก ระบบจะเด้งข้อมูลบัตรขึ้นมาให้ตรวจสอบเสมอ — ยืนยันเฉพาะเมื่อข้อมูลตรงกับลูกค้าที่ยื่นบัตรเท่านั้น" : "สมาชิกไม่มีบัญชีเข้าสู่ระบบแอป — บัตรใบนี้ใช้ระบุตัวตนที่เคาน์เตอร์ · ทุกครั้งที่สแกนบัตร พนักงานจะเห็นข้อมูลสมาชิกเพื่อยืนยันก่อนหักยอดเสมอ"}</div>
    <div className="modal-actions">
      {confirmForBill ? <>
        <button className="outline-button" onClick={onClose}><X size={16} /> ไม่ใช่สมาชิกนี้</button>
        <button className="primary-button" disabled={busy !== ""} onClick={() => onConfirm?.()}><UserCheck size={16} /> {confirmLabel}</button>
      </> : <>
        <button className="outline-button amber" disabled={busy !== ""} onClick={downloadCardPdf} title="ดาวน์โหลดบัตรสมาชิกเป็นไฟล์ PDF 90×55 มม. (ส่งร้านพิมพ์)"><Printer size={16} /> {busy === "pdf" ? "กำลังสร้าง PDF..." : "ดาวน์โหลด PDF"}</button>
        <button className="outline-button" disabled={busy !== ""} onClick={downloadCardPng} title="ดาวน์โหลดบัตรเป็น PNG ความละเอียดสูง 1440×880px (ส่งไลน์/ตรวจภาพ/พิมพ์ด่วน)"><FileImage size={16} /> {busy === "png" ? "กำลังสร้าง PNG..." : "ดาวน์โหลด PNG"}</button>
        <button className="primary-button" disabled={busy !== ""} onClick={printCard} title="พิมพ์บัตรสมาชิก (มาตรฐานนามบัตรไทย 90×55 มม.) ผ่านเครื่องพิมพ์"><Printer size={16} /> พิมพ์บัตรสมาชิก</button>
      </>}
    </div>
  </div></div>;
}

/**
 * FIX-4 issue 4 + P0-UX-02 part 2 — Batch print modal: พิมพ์บัตรสมาชิกหลายใบ
 * 2 โหมด:
 *  1. บัตรเดี่ยวต่อหน้า (เดิม) — 90×55มม. ต่อหน้า ใช้ window.print() + @media print
 *  2. หลายบัตรต่อแผ่น A4 (ใหม่) — เลือก profile (8/10-up หรือ custom) + X/Y calibration
 *     + "พิมพ์แผ่นทดสอบ" (กล่องโครงร่าง เพื่อตรวจแนวก่อนใช้กระดาษจริง)
 * แต่ละ profile เก็บใน localStorage เพราะ calibration ขึ้นกับเครื่องพิมพ์แต่ละเครื่อง
 */
export function MemberCardBatchModal({
  members,
  onClose,
}: {
  members: MemberCardData[];
  onClose: () => void;
}) {
  const { brandName, brandLogo } = useBrand();
  const qrByMember = new Map<string, string>();
  const [qrMap, setQrMap] = useState<Map<string, string>>(qrByMember);
  useEffect(() => {
    let alive = true;
    const uniqueNumbers = Array.from(new Set(members.map((m) => m.memberNumber)));
    Promise.all(uniqueNumbers.map((num) => QRCode.toDataURL(num, { margin: 0, width: 240, errorCorrectionLevel: "M" }).then((url) => [num, url] as const)))
      .then((entries) => { if (alive) setQrMap(new Map(entries)); })
      .catch(() => { if (alive) setQrMap(new Map()); });
    return () => { alive = false; };
  }, [members]);

  // P0-UX-02 part 2 — A4 sheet mode
  const [sheetMode, setSheetMode] = useState(false);
  const [profile, setProfile] = useState<CardSheetProfile>(() => loadCardSheetProfile());
  const [testPrint, setTestPrint] = useState(false);
  const positions = useMemo(() => slotPositions(profile), [profile]);
  const capacity = slotsPerSheet(profile);
  const sheetCount = Math.max(1, Math.ceil(members.length / capacity));
  const updateProfile = (patch: Partial<CardSheetProfile>) => {
    setProfile((prev) => { const next = { ...prev, ...patch }; saveCardSheetProfile(next); return next; });
  };
  const pickProfileId = (id: string) => {
    const found = BUILT_IN_PROFILES.find((p) => p.id === id);
    if (found) { const next = { ...found, offsetXMm: profile.offsetXMm, offsetYMm: profile.offsetYMm }; saveCardSheetProfile(next); setProfile(next); }
  };
  // แบ่งสมาชิกเป็นกลุ่มตาม capacity แต่ละแผ่น
  const sheets = useMemo(() => {
    const out: MemberCardData[][] = [];
    for (let i = 0; i < members.length; i += capacity) out.push(members.slice(i, i + capacity));
    return out.length === 0 ? [[]] : out;
  }, [members, capacity]);

  return <div className="modal-backdrop" onClick={onClose}><div className="member-card-modal member-card-batch-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="พิมพ์บัตรสมาชิกหลายคนพร้อมกัน">
    <div className="modal-heading">
      <div>
        <span className="eyebrow">MEMBER CARD · BATCH PRINT</span>
        <h2>พิมพ์บัตรสมาชิก {members.length} ใบ</h2>
        <p>รูปแบบบัตรขนาดมาตรฐานนามบัตรไทย (90 × 55 มม.) — พิมพ์ทุกใบในการสั่งพิมพ์ครั้งเดียว</p>
      </div>
      <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={17} /></button>
    </div>

    {/* P0-UX-02 part 2 — สลับโหมดพิมพ์ */}
    <div className="batch-mode-tabs" role="tablist" aria-label="เลือกโหมดพิมพ์">
      <button type="button" role="tab" aria-selected={!sheetMode} className={`batch-mode-tab${!sheetMode ? " active" : ""}`} onClick={() => setSheetMode(false)}><Printer size={14} /> บัตรเดี่ยวต่อหน้า</button>
      <button type="button" role="tab" aria-selected={sheetMode} className={`batch-mode-tab${sheetMode ? " active" : ""}`} onClick={() => setSheetMode(true)}><LayoutGrid size={14} /> หลายบัตรต่อแผ่น A4</button>
    </div>

    {sheetMode ? (
      <>
        {/* A4 sheet profile editor */}
        <div className="sheet-profile-editor">
          <label className="sheet-field">
            <span>โปรไฟล์แผ่น</span>
            <select value={profile.id === "custom" ? "custom" : profile.id} onChange={(e) => pickProfileId(e.target.value)}>
              {BUILT_IN_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="sheet-field-row">
            <label className="sheet-field"><span>คอลัมน์</span><input type="number" min="1" max="6" value={profile.cols} disabled={profile.id !== "custom"} onChange={(e) => updateProfile({ cols: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label className="sheet-field"><span>แถว</span><input type="number" min="1" max="8" value={profile.rows} disabled={profile.id !== "custom"} onChange={(e) => updateProfile({ rows: Math.max(1, Number(e.target.value) || 1) })} /></label>
            <label className="sheet-field"><span>ขอบซ้าย มม.</span><input type="number" step="0.5" value={profile.marginLeftMm} onChange={(e) => updateProfile({ marginLeftMm: Number(e.target.value) || 0 })} /></label>
            <label className="sheet-field"><span>ขอบบน มม.</span><input type="number" step="0.5" value={profile.marginTopMm} onChange={(e) => updateProfile({ marginTopMm: Number(e.target.value) || 0 })} /></label>
            <label className="sheet-field"><span>ช่องว่าง X มม.</span><input type="number" step="0.5" value={profile.gapXMm} onChange={(e) => updateProfile({ gapXMm: Number(e.target.value) || 0 })} /></label>
            <label className="sheet-field"><span>ช่องว่าง Y มม.</span><input type="number" step="0.5" value={profile.gapYMm} onChange={(e) => updateProfile({ gapYMm: Number(e.target.value) || 0 })} /></label>
          </div>
          <div className="sheet-calib-row">
            <span className="calib-label">ปรับแนว (calibration)</span>
            <label className="sheet-field"><span>Offset X มม.</span><input type="number" step="0.1" value={profile.offsetXMm} onChange={(e) => updateProfile({ offsetXMm: Number(e.target.value) || 0 })} /></label>
            <label className="sheet-field"><span>Offset Y มม.</span><input type="number" step="0.1" value={profile.offsetYMm} onChange={(e) => updateProfile({ offsetYMm: Number(e.target.value) || 0 })} /></label>
          </div>
          <p className="sheet-capacity">ความจุ {capacity} ใบ/แผ่น · {members.length} ใบ → {sheetCount} แผ่น{sheetCount > 1 ? ` (แผ่นละ ${capacity})` : ""}</p>
        </div>

        <div className="member-card-note"><LayoutGrid size={15} /> พรีวิวการจัดวางบน A4 — ปรับ offset X/Y จนตรงกับกระดาพจริง · กด "พิมพ์แผ่นทดสอบ" ก่อนใช้กระดาษจริง เพื่อตรวจแนวตำแหน่งทุกช่อง</div>

        {/* On-screen sheet preview (scaled) */}
        <div className="sheet-preview-wrap">
          <div className="sheet-preview-scaler">
            <div className="card-sheet-a4 preview" style={{ "--cw": `${profile.cardWmm}mm`, "--ch": `${profile.cardHmm}mm` } as React.CSSProperties}>
              {positions.map((pos, i) => {
                const member = sheets[0]?.[i];
                return <div key={i} className="card-slot" style={{ left: `${pos.left}mm`, top: `${pos.top}mm`, width: `${profile.cardWmm}mm`, height: `${profile.cardHmm}mm` }}>
                  {member ? <MemberCardArt member={member} brandName={brandName} brandLogo={brandLogo} qrDataUrl={qrMap.get(member.memberNumber) ?? ""} /> : <span className="slot-empty">ว่าง {i + 1}</span>}
                </div>;
              })}
            </div>
          </div>
        </div>
      </>
    ) : (
      <div className="member-card-batch-grid" id="member-card-batch">
        {members.map((member) => (
          <div className="member-card-batch-item" key={member.memberNumber}>
            <MemberCardArt member={member} brandName={brandName} brandLogo={brandLogo} qrDataUrl={qrMap.get(member.memberNumber) ?? ""} />
          </div>
        ))}
      </div>
    )}
    <div className="modal-actions">
      <button className="outline-button" onClick={onClose}>ปิด</button>
      {sheetMode && <button className="outline-button amber" onClick={() => { setTestPrint(true); window.setTimeout(() => { window.print(); }, 60); }} title="พิมพ์โครงร่างกล่อง (ไม่มีบัตร) เพื่อตรวจแนวบนกระดาพจริง — วางทาบกับสติกเกอร์/กระดาษปรุแล้วดูว่าตรงทุกช่องไหม"><Printer size={16} /> พิมพ์แผ่นทดสอบ</button>}
      <button className="primary-button" onClick={() => { setTestPrint(false); window.setTimeout(() => { window.print(); }, 60); }}><Printer size={16} /> {sheetMode ? `พิมพ์ลง A4 (${sheetCount} แผ่น)` : `พิมพ์บัตร ${members.length} ใบ`}</button>
    </div>

    {/* P0-UX-02 part 2 — hidden A4 sheet print host (เห็นเฉพาะตอน @media print) */}
    {sheetMode && (
      <div className="card-sheet-print-host" aria-hidden="true">
        {sheets.map((sheetMembers, sheetIdx) => (
          <div key={sheetIdx} className="card-sheet-a4" style={{ "--cw": `${profile.cardWmm}mm`, "--ch": `${profile.cardHmm}mm` } as React.CSSProperties}>
            {positions.map((pos, i) => {
              const member = sheetMembers[i];
              return <div key={i} className="card-slot" style={{ left: `${pos.left}mm`, top: `${pos.top}mm`, width: `${profile.cardWmm}mm`, height: `${profile.cardHmm}mm` }}>
                {testPrint ? <span className="slot-test-box">ตำแหน่ง {i + 1}{member ? ` · ${member.memberNumber}` : ""}</span>
                  : member ? <MemberCardArt member={member} brandName={brandName} brandLogo={brandLogo} qrDataUrl={qrMap.get(member.memberNumber) ?? ""} />
                  : <span className="slot-empty">ว่าง {i + 1}</span>}
              </div>;
            })}
          </div>
        ))}
      </div>
    )}
  </div></div>;
}
