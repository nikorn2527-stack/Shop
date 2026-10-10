import { useState } from "react";
import { ExpiryDateInput } from "./ExpiryDateInput";
import { normalizeExpiryDate } from "@shared/expiryDate";

type Entry = { lot: string; expiry: string; purchaseQty: string; freeQty: string; paidAmount: string };
export function ReceiveEntryRow({ entry, index, name, code, unit, busy, onUpdate, onRemove }: {
  entry: Entry; index: number; name: string; code?: string | null; unit?: string;
  busy: boolean; onUpdate: (field: keyof Entry, value: string) => void; onRemove: () => void;
}) {
  const [draft, setDraft] = useState<Entry | null>(null);
  const [error, setError] = useState("");
  const row = index + 1;
  const total = Number(entry.purchaseQty) + Number(entry.freeQty);
  const update = (field: keyof Entry, value: string) => setDraft(current => current && ({ ...current, [field]: value }));
  const save = () => {
    if (!draft || busy) return;
    if (!Number.isInteger(Number(draft.purchaseQty)) || Number(draft.purchaseQty) <= 0 || !Number.isInteger(Number(draft.freeQty)) || Number(draft.freeQty) < 0 || !draft.paidAmount.trim() || !Number.isFinite(Number(draft.paidAmount)) || Number(draft.paidAmount) < 0) {
      setError("กรุณาตรวจจำนวนและยอดจ่ายก่อนบันทึกการแก้ไข"); return;
    }
    const expiry = normalizeExpiryDate(draft.expiry);
    if (expiry === null) { setError("วันหมดอายุไม่ถูกต้อง กรุณาระบุวัน/เดือน/ปี"); return; }
    for (const field of Object.keys(draft) as (keyof Entry)[]) onUpdate(field, field === "expiry" ? expiry : draft[field]);
    setDraft(null); setError("");
  };
  return <>
    <tr className="receive-main-row">
      <td><b>{name}</b><small>{code}</small></td>
      <td>{entry.purchaseQty}<small>{unit || "หน่วย"}{Number(entry.freeQty) > 0 ? ` · รับรวม ${total}` : ""}</small></td>
      <td>฿{Number(entry.paidAmount).toFixed(2)}<small>ต้นทุน {total > 0 ? (Number(entry.paidAmount) / total).toFixed(2) : "0.00"} / {unit || "หน่วย"}</small></td>
      <td>{entry.freeQty || "0"}</td><td>{entry.lot || "อัตโนมัติ"}</td><td>{entry.expiry || "ไม่ระบุ"}</td>
      <td><div className="receive-row-actions"><button type="button" className="outline-button" disabled={busy} aria-label={`แก้ไขรายการ ${row}`} onClick={() => { setDraft({ ...entry }); setError(""); }}>แก้ไข</button><button type="button" className="icon-button" disabled={busy} aria-label={`นำรายการ ${row} ออก`} onClick={onRemove}>×</button></div></td>
    </tr>
    {draft && <tr className="receive-edit-row"><td colSpan={7}>
      <div className="receive-row-edit-form">
        <label>จำนวนซื้อ *<input autoFocus type="number" min="1" step="1" aria-label={`จำนวนซื้อรายการ ${row}`} value={draft.purchaseQty} disabled={busy} onFocus={e => e.currentTarget.select()} onChange={e => update("purchaseQty", e.target.value)} /></label>
        <label>ยอดจ่ายทั้งหมด *<input type="number" min="0" step="0.01" aria-label={`ยอดจ่ายรายการ ${row}`} value={draft.paidAmount} disabled={busy} onFocus={e => e.currentTarget.select()} onChange={e => update("paidAmount", e.target.value)} /></label>
        <label>จำนวนแถม<input type="number" min="0" step="1" aria-label={`จำนวนแถมรายการ ${row}`} value={draft.freeQty} disabled={busy} onFocus={e => e.currentTarget.select()} onChange={e => update("freeQty", e.target.value)} /></label>
        <label>Lot<input aria-label={`Lot รายการ ${row}`} value={draft.lot} disabled={busy} onChange={e => update("lot", e.target.value)} /></label>
        <label>วันหมดอายุ<ExpiryDateInput value={draft.expiry} disabled={busy} onChange={value => update("expiry", value)} label={`วันหมดอายุรายการ ${row}`} /></label>
        <div className="receive-editor-actions"><button type="button" className="primary-button" disabled={busy} aria-label={`บันทึกแก้ไขรายการ ${row}`} onClick={save}>บันทึกแก้ไข</button><button type="button" className="outline-button" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>ยกเลิกแก้ไข</button></div>
      </div>{error && <p role="alert">{error}</p>}
    </td></tr>}
  </>;
}