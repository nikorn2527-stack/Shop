import { useMemo, useState } from "react";
import { Printer, X } from "@/lib/icons";
import { code128DataUrl } from "@/barcode";
import { trpc } from "@/lib/trpc";
import { getThermalPrintProfile, type ThermalPaperWidthId } from "@/lib/thermalPrint";
import { printElementDocument } from "@/lib/printHelper";
import { WorkflowDialog } from "./WorkflowDialog";
import type { MemberCardData } from "./MemberCardModal";

const NO_MEMBERS: MemberCardData[] = [];
const NO_CARDS: string[] = [];

/** Print identification only. No card assignment or wallet mutation takes place here. */
export function MemberBarcodePrintModal({ members = NO_MEMBERS, cards = NO_CARDS, onClose }: { members?: MemberCardData[]; cards?: string[]; onClose: () => void }) {
  const settings = trpc.settings.get.useQuery(undefined);
  const [width, setWidth] = useState<ThermalPaperWidthId>(() => String(getThermalPrintProfile().paperWidthMm) as ThermalPaperWidthId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const profile = getThermalPrintProfile(width);
  const title = cards.length ? "พิมพ์บาร์โค้ดบัตร" : "พิมพ์บาร์โค้ดสมาชิก";
  const labels = useMemo(() => [...members.map(member => ({ code: member.cardNumber || member.memberNumber, name: [member.prename, member.firstName, member.lastName].filter(Boolean).join(" "), kind: member.cardNumber ? "เลขบัตร" : "เลขสมาชิก" })), ...cards.map(code => ({ code, name: "", kind: "เลขบัตร" }))].map(label => {
    const code = label.code;
    // Code128-B accepts printable ASCII only. Never silently print a substituted identifier.
    const supported = /^[\x20-\x7E]+$/.test(code);
    // Start + checksum + stop = 35 modules; retain 10-module quiet zones on both sides.
    // At least two printer dots per module on a 203 dpi thermal printer.
    const widthMm = (55 + 11 * code.length) * 25.4 / 203 * 2;
    return { ...label, widthMm, image: supported ? code128DataUrl(code, { moduleWidth: 2, padding: 20, height: 96, showLabel: false }) : "" };
  }), [members, cards]);
  const invalid = labels.find(label => !label.image || label.widthMm > profile.printableWidthMm - 4);
  const print = async () => {
    if (busy || invalid || !labels.length) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await printElementDocument("member-barcode-slip", Number(width));
      setMessage(result.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "พิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally { setBusy(false); }
  };
  return <WorkflowDialog title={title} onClose={onClose} busy={busy} className="form-modal member-barcode-modal">
    <header className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="ปิด" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    <div className="member-barcode-controls">
      <p>พิมพ์สลิปเพื่อนำไปแปะแทนบัตรพลาสติก · บัตรต้องจ่ายให้สมาชิกและเปิดใช้งานก่อนทำธุรกรรม</p>
      <label>ขนาดกระดาษ <select value={width} disabled={busy} onChange={event => { setWidth(event.target.value as ThermalPaperWidthId); setError(""); setMessage(""); }}>
        <option value="58">58 มม.</option><option value="72">72 มม.</option><option value="80">80 มม.</option>
      </select></label>
      <small>{labels.length} ใบ · ใช้เครื่องพิมพ์ใบเสร็จที่ตั้งไว้บนเครื่องนี้</small>
    </div>
    {invalid && <div className="notice-bar error" role="alert">{!invalid.image ? `${invalid.kind} ${invalid.code} ไม่รองรับบาร์โค้ด Code128` : `${invalid.kind} ${invalid.code} ยาวเกินพื้นที่พิมพ์ กรุณาเลือกกระดาษกว้างขึ้น`}</div>}
    <div className="member-barcode-preview">
      <div id="member-barcode-slip" className="member-barcode-slip" style={{ width: `${profile.printableWidthMm}mm` }}>
        {labels.map(({ code, name, kind, image, widthMm }) => <section className="member-barcode-label" key={code}>
          <b>{settings.data?.appName?.trim() || "ร้านค้าสวัสดิการ"}</b>
          {name && <div>{name}</div>}
          {image && <img src={image} style={{ width: `${widthMm}mm` }} alt={`บาร์โค้ด${kind} ${code}`} />}
          <strong>{kind} {code}</strong>
        </section>)}
      </div>
    </div>
    {error && <div className="notice-bar error" role="alert">{error}</div>}
    {message && <div className="notice-bar" role="status">{message}</div>}
    <footer className="modal-actions modal-footer"><button className="outline-button" disabled={busy} onClick={onClose}>ปิด</button><button className="primary-button" disabled={busy || !!invalid || !labels.length} onClick={() => void print()}><Printer size={16} /> {busy ? "กำลังเตรียมพิมพ์…" : "พิมพ์บาร์โค้ด"}</button></footer>
  </WorkflowDialog>;
}
