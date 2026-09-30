import { useEffect, useState } from "react";
import html2canvas from "html2canvas";
import QRCode from "qrcode";
import { Barcode, CreditCard, Download, Printer, QrCode as QrIcon, ScanLine, ShieldAlert, UserCheck, X } from "@/lib/icons";
import { money } from "../pages/pageData";
import { code128DataUrl } from "../barcode";
import { MemberAvatar } from "./MemberAvatar";
import { trpc } from "@/lib/trpc";
import { brandInitial } from "@/theme";
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
          <MemberAvatar member={member} size={104} rounded={false} />
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
      <div className="member-card-foot">
        <small>ยื่นบัตรนี้ให้สแกน หรือแจ้งหมายเลขสมาชิก ที่เคาน์เตอร์เพื่อใช้ยอดเงินสวัสดิการ</small>
        <small>ยอดคงเหลือ <b>{money(member.balance)}</b>{footnoteAtScan ? " ณ ตอนสแกนบัตร" : " ณ วันออกบัตร"}</small>
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
  const [busy, setBusy] = useState(false);
  const { brandName, brandLogo } = useBrand();
  const qrDataUrl = useQrDataUrl(member.memberNumber);
  const displayName = [member.prename?.trim() || "", member.firstName, member.lastName].filter(Boolean).join(" ");
  const suspended = member.status === "suspended";

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
  // FIX-4 issue 4 — printPreviewOpen ค้างเปิดได้ ปุ่ม "พิมพ์อีกครั้ง" ใช้ setPrintPreviewOpen(true)
  // ซ้ำได้เลย (ปิดพรีวิวเก่าแล้วเปิดใหม่ในคลิกเดียว)
  // FIX-8 (user) — ปิด preview ได้ที่ตั้งค่า → ใบเสร็จและเครื่องพิมพ์ (ลดขั้นตอน กดแล้วพิมพ์เลย)
  const settingsQuery = trpc.settings.get.useQuery(undefined);
  const printPreviewBefore = settingsQuery.data?.printPreviewBefore !== false;
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const printCardDirect = () => {
    if (printPreviewBefore) {
      setPrintPreviewOpen(true);
    } else {
      window.print();
    }
  };
  const printCard = () => printCardDirect();
  // FIX-8 — Enter = สั่งพิมพ์ทันที (shortcut เมื่อ modal เปิด และไม่ใช่ confirmForBill mode)
  useEffect(() => {
    if (confirmForBill) return; // โหมดยืนยันสมาชิกไม่ผูก Enter (กันกดผิด)
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      event.preventDefault();
      printCardDirect();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmForBill, printPreviewBefore]);
  const reprintCard = () => {
    setPrintPreviewOpen(false);
    // next tick so the old PrintPreviewModal unmounts before the new one mounts
    setTimeout(() => setPrintPreviewOpen(true), 0);
  };
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
      <MemberCardArt member={member} brandName={brandName} brandLogo={brandLogo} qrDataUrl={qrDataUrl} id="member-card" footnoteAtScan={confirmForBill} />
    </div>
    <div className="member-card-note"><CreditCard size={15} /> {confirmForBill ? "ทุกครั้งที่ยิงบัตรสมาชิก ระบบจะเด้งข้อมูลบัตรขึ้นมาให้ตรวจสอบเสมอ — ยืนยันเฉพาะเมื่อข้อมูลตรงกับลูกค้าที่ยื่นบัตรเท่านั้น" : "สมาชิกไม่มีบัญชีเข้าสู่ระบบแอป — บัตรใบนี้ใช้ระบุตัวตนที่เคาน์เตอร์ · ทุกครั้งที่สแกนบัตร พนักงานจะเห็นข้อมูลสมาชิกเพื่อยืนยันก่อนหักยอดเสมอ"}</div>
    <div className="modal-actions">
      {confirmForBill ? <>
        <button className="outline-button" onClick={onClose}><X size={16} /> ไม่ใช่สมาชิกนี้</button>
        <button className="primary-button" disabled={busy} onClick={() => onConfirm?.()}><UserCheck size={16} /> {confirmLabel}</button>
      </> : <>
        <button className="outline-button" disabled={busy} onClick={downloadCard}><Download size={16} /> {busy ? "กำลังสร้างรูป..." : "ดาวน์โหลดรูปบัตร"}</button>
        <button className="outline-button" onClick={reprintCard} title="เปิดหน้าต่างพรีวิวอีกครั้ง — ใช้เมื่อพิมพ์ครั้งแรกไม่สำเร็จ หรือต้องพิมพ์ซ้ำ"><Printer size={16} /> พิมพ์อีกครั้ง</button>
        <button className="primary-button" onClick={printCard} title={printPreviewBefore ? "พรีวิวก่อนพิมพ์ (ปิดได้ที่ ตั้งค่า → ใบเสร็จและเครื่องพิมพ์)" : "พิมพ์ทันที — เลือกเครื่องพิมพ์ใน dialog ของ browser"}><Printer size={16} /> พิมพ์บัตรสมาชิก{!printPreviewBefore && <kbd className="enter-hint">Enter</kbd>}</button>
      </>}
    </div>
    {printPreviewOpen && <PrintPreviewModal targetId="member-card" title="พรีวิวก่อนพิมพ์บัตรสมาชิก" subtitle={`${displayName} · ${member.memberNumber}`} paper="card" chips={[`ยอดคงเหลือ ${money(member.balance)}`, member.status === "active" ? "สถานะใช้จ่ายได้" : "ระงับการใช้จ่าย"]} onClose={() => setPrintPreviewOpen(false)} />}
  </div></div>;
}

/**
 * FIX-4 issue 4 — Batch print modal: shows multiple member cards in a grid
 * and prints them all at CR80 size (85.6 × 54 mm) on one print job.
 *
 * Each card is wrapped in `.member-card-batch-item` so the @media print rule
 * can apply page-break-after. The wrapper element has id="member-card-batch"
 * so the print CSS (body:has(#member-card-batch)) hides everything else.
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
  // One QR per member number — pre-resolve so all cards render synchronously.
  // (We can't call hooks in a loop, so we use the data-URL promise directly.)
  const [qrMap, setQrMap] = useState<Map<string, string>>(qrByMember);
  useEffect(() => {
    let alive = true;
    const uniqueNumbers = Array.from(new Set(members.map((m) => m.memberNumber)));
    Promise.all(uniqueNumbers.map((num) => QRCode.toDataURL(num, { margin: 0, width: 240, errorCorrectionLevel: "M" }).then((url) => [num, url] as const)))
      .then((entries) => { if (alive) setQrMap(new Map(entries)); })
      .catch(() => { if (alive) setQrMap(new Map()); });
    return () => { alive = false; };
  }, [members]);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const printBatch = () => setPrintPreviewOpen(true);
  const reprintBatch = () => {
    setPrintPreviewOpen(false);
    setTimeout(() => setPrintPreviewOpen(true), 0);
  };
  return <div className="modal-backdrop" onClick={onClose}><div className="member-card-modal member-card-batch-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="พิมพ์บัตรสมาชิกหลายคนพร้อมกัน">
    <div className="modal-heading">
      <div>
        <span className="eyebrow">MEMBER CARD · BATCH PRINT</span>
        <h2>พิมพ์บัตรสมาชิก {members.length} ใบ</h2>
        <p>รูปแบบบัตรขนาดมาตรฐานนามบัตรประชาชน (CR80 · 85.6 × 54 มม.) — พิมพ์ทุกใบในการสั่งพิมพ์ครั้งเดียว</p>
      </div>
      <button className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><X size={17} /></button>
    </div>
    <div className="member-card-batch-grid" id="member-card-batch">
      {members.map((member) => (
        <div className="member-card-batch-item" key={member.memberNumber}>
          <MemberCardArt member={member} brandName={brandName} brandLogo={brandLogo} qrDataUrl={qrMap.get(member.memberNumber) ?? ""} />
        </div>
      ))}
    </div>
    <div className="member-card-note"><CreditCard size={15} /> พรีวิวก่อนพิมพ์ทุกใบ — ตรวจชื่อ-รูป-เลขสมาชิกให้ถูกต้องก่อนสั่งพิมพ์จริง · ถ้าพิมพ์ไม่สำเร็จกด "พิมพ์อีกครั้ง" ได้ทันที</div>
    <div className="modal-actions">
      <button className="outline-button" onClick={onClose}>ปิด</button>
      <button className="outline-button" onClick={reprintBatch} title="เปิดหน้าต่างพรีวิวอีกครั้ง"><Printer size={16} /> พิมพ์อีกครั้ง</button>
      <button className="primary-button" onClick={printBatch}><Printer size={16} /> พิมพ์บัตร {members.length} ใบ</button>
    </div>
    {printPreviewOpen && <PrintPreviewModal targetId="member-card-batch" title={`พรีวิวก่อนพิมพ์บัตรสมาชิก ${members.length} ใบ`} subtitle="ขนาด CR80 · 85.6 × 54 มม. ต่อใบ" paper="card" chips={[`${members.length} ใบ`, "CR80 · 85.6 × 54 มม."]} onClose={() => setPrintPreviewOpen(false)} />}
  </div></div>;
}
