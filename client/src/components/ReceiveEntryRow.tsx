import { useState } from "react";
import { ExpiryDateInput } from "./ExpiryDateInput";
import { normalizeExpiryDate } from "@shared/expiryDate";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";

type Entry = { lot: string; expiry: string; purchaseQty: string; freeQty: string; paidAmount: string; sellingPrice: string; previousCost?: number | null };
export function ReceiveEntryRow({ entry, index, name, code, unit, sellingPrice, canChangePrice = false, busy, onUpdate, onRemove }: {
  entry: Entry; index: number; name: string; code?: string | null; unit?: string; sellingPrice: number; canChangePrice?: boolean;
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
    if (draft.sellingPrice.trim() && (!Number.isFinite(Number(draft.sellingPrice)) || Number(draft.sellingPrice)<0)) {setError("ราคาขายต้องเป็นตัวเลข 0 ขึ้นไป");return;}
    const expiry = normalizeExpiryDate(draft.expiry);
    if (expiry === null) { setError("วันหมดอายุไม่ถูกต้อง กรุณาระบุวัน/เดือน/ปี"); return; }
    for (const field of ["purchaseQty","freeQty","paidAmount","lot","expiry","sellingPrice"] as const) onUpdate(field, field === "expiry" ? expiry : draft[field]);
    setDraft(null); setError("");
  };
  return <>
    <tr className="receive-main-row">
      <td><b title={name}>{name}</b>{code && <small> · {code}</small>}</td>
      <td><span>ซื้อ {entry.purchaseQty} {unit || "หน่วย"}</span><small>แถม {entry.freeQty || "0"}</small></td>
      <td><b>฿{Number(entry.paidAmount).toFixed(2)}</b><small>ก่อน {entry.previousCost == null ? "—" : `฿${entry.previousCost.toFixed(4)}`}</small><small>รอบนี้ ฿{total > 0 ? (Number(entry.paidAmount)/total).toFixed(4) : "0.0000"}</small></td>
      <td>฿{sellingPrice.toFixed(2)}{entry.sellingPrice.trim() && <small className="receive-price-changed">ราคาใหม่</small>}</td>
      <td><span>{entry.lot || "อัตโนมัติ"}</span><small>หมดอายุ {entry.expiry || "ไม่ระบุ"}</small></td>
      <td><div className="receive-row-actions"><button type="button" className="outline-button" disabled={busy} aria-label={`แก้ไขรายการ ${row}`} onClick={() => { setDraft({ ...entry }); setError(""); }}>แก้ไข</button><button type="button" className="icon-button" disabled={busy} aria-label={`นำรายการ ${row} ออก`} onClick={onRemove}>×</button></div></td>
    </tr>
    <Dialog open={draft !== null} onOpenChange={open => { if (!open && !busy) { setDraft(null); setError(""); } }}>
      {draft && <DialogContent className="receive-entry-edit-modal" showCloseButton={!busy} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>แก้ไขรายการรับเข้า</DialogTitle>
      <DialogDescription>{name} · แก้จำนวนและต้นทุนของรายการรับเข้ารอบนี้ ไม่ใช่ข้อมูลหลักสินค้า</DialogDescription>
      <div className="receive-row-edit-form">
        <label>จำนวนซื้อ *<input autoFocus type="number" min="1" step="1" aria-label={`จำนวนซื้อรายการ ${row}`} value={draft.purchaseQty} disabled={busy} onFocus={e => e.currentTarget.select()} onChange={e => update("purchaseQty", e.target.value)} /></label>
        <label>จำนวนแถม<input type="number" min="0" step="1" aria-label={`จำนวนแถมรายการ ${row}`} value={draft.freeQty} disabled={busy} onFocus={e => e.currentTarget.select()} onChange={e => update("freeQty", e.target.value)} /></label>
        <label>ยอดจ่ายทั้งหมด *<input type="number" min="0" step="0.01" aria-label={`ยอดจ่ายรายการ ${row}`} value={draft.paidAmount} disabled={busy} onFocus={e => e.currentTarget.select()} onChange={e => update("paidAmount", e.target.value)} /></label>
        {canChangePrice && <label>ราคาขายหลังรับเข้า<input type="number" min="0" step="0.01" value={draft.sellingPrice} disabled={busy} placeholder={`คงเดิม ${sellingPrice.toFixed(2)}`} onChange={e=>update("sellingPrice",e.target.value)} /><small>ใช้กับสินค้าคงเหลือทั้งหมดหลังยืนยัน</small></label>}
        <label>Lot<input aria-label={`Lot รายการ ${row}`} value={draft.lot} disabled={busy} onChange={e => update("lot", e.target.value)} /></label>
        <label>วันหมดอายุ<ExpiryDateInput value={draft.expiry} disabled={busy} onChange={value => update("expiry", value)} label={`วันหมดอายุรายการ ${row}`} /></label>
        <div className="receive-editor-actions"><button type="button" className="primary-button" disabled={busy} aria-label={`บันทึกแก้ไขรายการ ${row}`} onClick={save}>บันทึกแก้ไข</button><button type="button" className="outline-button" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>ยกเลิกแก้ไข</button></div>
      </div>{error && <p role="alert">{error}</p>}
      </DialogContent>}
    </Dialog>
  </>;
}