import { ExpiryDateInput } from "./ExpiryDateInput";
type Draft = { purchaseQty: string; freeQty: string; paidAmount: string; lot: string; expiry: string };
export function ReceiveItemEditor({ value, name, busy, onChange, onAdd, onClear }: {
  value: Draft; name: string; busy: boolean;
  onChange: (field: keyof Draft, value: string) => void; onAdd: () => void;
  onClear: () => void;
}) {
  const next = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const controls = Array.from(event.currentTarget.closest(".receive-item-editor")!.querySelectorAll<HTMLElement>("input, .thai-date-field, button[data-add-receipt]"));
    controls[controls.indexOf(event.currentTarget) + 1]?.focus();
  };
  return <section className="receive-item-editor">
    <h3>{name || "เลือกสินค้าเพื่อรับเข้า"}</h3>
    <label>จำนวนซื้อ *<input id="receive-editor-qty" type="number" min="1" step="1" value={value.purchaseQty} disabled={busy || !name} onChange={e => onChange("purchaseQty", e.target.value)} onKeyDown={next} /></label>
    <label>จำนวนแถม<input id="receive-editor-free" type="number" min="0" step="1" value={value.freeQty} disabled={busy || !name} onFocus={e => e.currentTarget.select()} onChange={e => onChange("freeQty", e.target.value)} onKeyDown={next} /></label>
    <label>ยอดจ่ายทั้งหมด (บาท) *<input id="receive-editor-paid" type="number" min="0" step="0.01" value={value.paidAmount} disabled={busy || !name} onChange={e => onChange("paidAmount", e.target.value)} onKeyDown={next} /></label>
    <label>Lot<input id="receive-editor-lot" value={value.lot} disabled={busy || !name} placeholder="เว้นว่างเพื่อสร้างอัตโนมัติ" onChange={e => onChange("lot", e.target.value)} onKeyDown={next} /></label>
    <label>วันหมดอายุ (พ.ศ. หรือ ค.ศ.)<ExpiryDateInput id="receive-editor-expiry" value={value.expiry} disabled={busy || !name} onChange={date => onChange("expiry", date)} label="วันหมดอายุรายการที่กำลังกรอก" onNext={() => document.querySelector<HTMLButtonElement>("[data-add-receipt]")?.focus()} /></label>
    <div className="receive-editor-actions"><button type="button" data-add-receipt className="primary-button" disabled={busy || !name} onClick={onAdd}>เพิ่มลงรายการ</button>
    {name && <button type="button" className="outline-button" disabled={busy} onClick={onClear}>ล้างรายการที่กำลังกรอก</button>}</div>
  </section>;
}