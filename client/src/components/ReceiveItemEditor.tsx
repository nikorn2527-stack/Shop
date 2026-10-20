import { ExpiryDateInput } from "./ExpiryDateInput";
type Draft = { purchaseQty: string; freeQty: string; paidAmount: string; lot: string; expiry: string; sellingPrice?: string };
export function ReceiveItemEditor({ value, name, busy, onChange, onAdd, onClear, showActions = true, pricing, pricingLoading = false, pricingError = false, canChangePrice = false }: {
  value: Draft; name: string; busy: boolean;
  onChange: (field: keyof Draft, value: string) => void; onAdd: () => void;
  onClear: () => void; showActions?: boolean;
  pricing?: {previousCost:number|null;sellingPrice:number;previousLot:string|null;highestRemainingCost:number|null;remainingQty:number;unknownRemainingQty:number};
  pricingLoading?: boolean; pricingError?: boolean; canChangePrice?: boolean;
}) {
  const next = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const controls = Array.from(event.currentTarget.closest(".receive-item-editor")!.querySelectorAll<HTMLElement>("input, .thai-date-field, button[data-add-receipt]"));
    controls[controls.indexOf(event.currentTarget) + 1]?.focus();
  };
  return <section className="receive-item-editor">
    <h3>{name || "เลือกสินค้าเพื่อรับเข้า"}</h3>
    {showActions && name && <div className="receive-price-context">
      <div><small>ต้นทุนรับเข้ารอบก่อน / หน่วย</small><b>{pricingLoading ? "กำลังโหลด…" : pricingError ? "โหลดข้อมูลไม่สำเร็จ" : pricing?.previousCost == null ? "ยังไม่มีต้นทุนรับเข้าที่บันทึกไว้" : `฿${pricing.previousCost.toFixed(4)}`}</b>{pricing?.previousLot && <small>{pricing.previousLot}</small>}</div>
      <div><small>ราคาขายปัจจุบัน / หน่วย</small><b>{pricing ? `฿${pricing.sellingPrice.toFixed(2)}` : "—"}</b></div>
      <div><small>ต้นทุนรอบนี้ / หน่วย (รวมแถม)</small><b>{value.paidAmount.trim() && Number(value.purchaseQty)+Number(value.freeQty)>0 ? `฿${(Number(value.paidAmount)/(Number(value.purchaseQty)+Number(value.freeQty))).toFixed(4)}` : "—"}</b></div>
    </div>}
    <label>จำนวนซื้อ *<input id="receive-editor-qty" type="number" min="1" step="1" value={value.purchaseQty} disabled={busy || !name} onChange={e => onChange("purchaseQty", e.target.value)} onKeyDown={next} /></label>
    <label>จำนวนแถม<input id="receive-editor-free" type="number" min="0" step="1" value={value.freeQty} disabled={busy || !name} onFocus={e => e.currentTarget.select()} onChange={e => onChange("freeQty", e.target.value)} onKeyDown={next} /></label>
    <label>ยอดจ่ายทั้งหมด (บาท) *<input id="receive-editor-paid" type="number" min="0" step="0.01" value={value.paidAmount} disabled={busy || !name} onChange={e => onChange("paidAmount", e.target.value)} onKeyDown={next} /></label>
    <label>Lot<input id="receive-editor-lot" value={value.lot} disabled={busy || !name} placeholder="เว้นว่างเพื่อสร้างอัตโนมัติ" onChange={e => onChange("lot", e.target.value)} onKeyDown={next} /></label>
    <label>วันหมดอายุ (พ.ศ. หรือ ค.ศ.)<ExpiryDateInput id="receive-editor-expiry" value={value.expiry} disabled={busy || !name} onChange={date => onChange("expiry", date)} label="วันหมดอายุรายการที่กำลังกรอก" onNext={() => document.querySelector<HTMLButtonElement>("[data-add-receipt]")?.focus()} /></label>
    {showActions && name && <label>ราคาขายหลังรับเข้า<input id="receive-editor-selling-price" type="number" min="0" step="0.01" value={value.sellingPrice ?? ""} disabled={busy || !canChangePrice || pricingLoading || pricingError} placeholder={pricing ? `คงเดิม ${pricing.sellingPrice.toFixed(2)}` : "คงราคาขายเดิม"} onChange={e=>onChange("sellingPrice",e.target.value)} /><small>{canChangePrice ? "เว้นว่างเพื่อคงราคาเดิม · ใช้กับสินค้าคงเหลือทั้งหมดหลังยืนยัน" : "ผู้บริหารปรับราคาขายได้ในสินค้าขายตามหน่วย"}</small></label>}
    {showActions && pricing && value.sellingPrice?.trim() && Number(value.sellingPrice)<pricing.sellingPrice && <p className="receive-price-warning" role="status">ลดราคาจาก ฿{pricing.sellingPrice.toFixed(2)} เป็น ฿{Number(value.sellingPrice).toFixed(2)} · ของเดิมคงเหลือ {pricing.remainingQty} หน่วย{pricing.highestRemainingCost !== null ? ` · ต้นทุนสูงสุดที่มีข้อมูล ฿${pricing.highestRemainingCost.toFixed(4)}/หน่วย` : " · ยังไม่มีต้นทุนล็อตคงเหลือที่ยืนยันได้"}{pricing.unknownRemainingQty>0 ? ` · ของคงเหลือไม่ทราบต้นทุน ${pricing.unknownRemainingQty} หน่วย` : ""} · ตรวจสอบกำไรก่อนยืนยัน</p>}
    {showActions && pricing && value.paidAmount.trim() && Number(value.purchaseQty)+Number(value.freeQty)>0 && (value.sellingPrice?.trim() ? Number(value.sellingPrice) : pricing.sellingPrice)<Number(value.paidAmount)/(Number(value.purchaseQty)+Number(value.freeQty)) && <p className="receive-price-warning" role="status">ราคาขายหลังรับเข้าต่ำกว่าต้นทุนรอบนี้ กรุณาตรวจราคาก่อนเพิ่มรายการ</p>}
    {showActions && <div className="receive-editor-actions"><button type="button" data-add-receipt className="primary-button" disabled={busy || !name || pricingLoading} onClick={onAdd}>เพิ่มลงรายการ</button>
    {name && <button type="button" className="outline-button" disabled={busy} onClick={onClear}>ล้างรายการที่กำลังกรอก</button>}</div>}
  </section>;
}