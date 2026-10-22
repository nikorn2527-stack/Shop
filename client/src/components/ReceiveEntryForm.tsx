import { receiptPriceInsight } from "@/lib/receiptPriceInsight";
import type { ReactNode } from "react";
import { ExpiryDateInput } from "./ExpiryDateInput";

type Draft = { purchaseQty:string; freeQty:string; paidAmount:string; lot:string; expiry:string; sellingPrice:string };
type NewItem = {name:string;sku:string;category:string;unit:string;price:string;sizeNum:string;sizeUnit:string};
type Pricing = {previousCost:number|null;sellingPrice:number;remainingQty:number;highestRemainingCost:number|null;unknownRemainingQty:number};
export function ReceiveEntryForm({artwork, scan, value, onChange, product, newItem, onNewChange, categories, pricing, loading, pricingError, canChangePrice, busy, newDraftActive, canCreate, onBarcodeCommit, onAdd, onClear, onCancel}: {
  artwork?:ReactNode;scan:ReactNode;value:Draft;onChange:(field:keyof Draft,value:string)=>void;
  product?:{name:string;category:string;unit:string;price:number;sellMode?:string|null;barcode?:string|null;sku?:string;size?:string|null;stock?:number}|null;
  newItem?:NewItem;onNewChange:(field:keyof NewItem,value:string)=>void;categories:string[];
  pricing?:Pricing;loading:boolean;pricingError:boolean;canChangePrice:boolean;busy:boolean;
  newDraftActive:boolean;canCreate:boolean;onBarcodeCommit:(code:string)=>void;onAdd:()=>void;onClear:()=>void;onCancel:()=>void;
}) {
  const ready=Boolean(product || canCreate);
  const details=newItem ?? {name:product?.name??"",sku:product?.barcode||product?.sku||"",category:product?.category??"",unit:product?.unit??"",price:"",sizeNum:"",sizeUnit:"มล."};
  const locked=busy || Boolean(product) || !canCreate;
  const {cost}=receiptPriceInsight({...value,sellingPrice:newItem?.price??value.sellingPrice});
  const price=newItem ? Number(newItem.price) : value.sellingPrice.trim() ? Number(value.sellingPrice) : pricing?.sellingPrice ?? product?.price ?? 0;
  const numberField=(field:"purchaseQty"|"freeQty"|"paidAmount",label:string,id:string,min:number,step:string)=><label>{label}<input id={id} aria-label={label} type="number" min={min} step={step} value={value[field]} disabled={busy||!ready} onChange={e=>onChange(field,e.target.value)} /></label>;
  return <section className="receive-entry-form" data-field-feedback={!product&&!newDraftActive ? "off" : undefined} onKeyDown={event=>{
    if(event.key!=="Enter" || event.defaultPrevented || event.nativeEvent.isComposing || !(event.target instanceof HTMLInputElement)) return;
    const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled):not([readonly]),select:not(:disabled),button[data-add-receipt]:not(:disabled)"));
    event.preventDefault();controls[controls.indexOf(event.target)+1]?.focus();
  }}>
    <div className="receive-form-body">
    <div className="receive-form-section">
      <div className="receive-section-title"><h3>ข้อมูลสินค้า</h3>{product ? <span className="receive-existing-badge">สินค้าเดิม · คงเหลือ {product.stock} {product.unit}</span> : newDraftActive && <span className="receive-new-badge">สินค้าใหม่</span>}</div>
      {scan}
      {artwork}
      <div className="receive-new-fields">
        <label>บาร์โค้ด / รหัส<input aria-label="บาร์โค้ดสินค้า" value={details.sku} readOnly={Boolean(product)} disabled={busy||!canCreate&&!product} onChange={e=>onNewChange("sku",e.target.value)} onBlur={()=>{if(!product && details.sku.trim())onBarcodeCommit(details.sku.trim());}} placeholder="เว้นว่างเพื่อออกรหัสอัตโนมัติ" /></label>
        <label>ชื่อสินค้า *<input id="receive-new-name" aria-label="ชื่อสินค้า" value={details.name} readOnly={Boolean(product)} disabled={busy||!canCreate&&!product} onChange={e=>onNewChange("name",e.target.value)} placeholder="ชื่อสินค้า" /></label>
        <div className="receive-form-pair"><label>หมวดสินค้า<select aria-label="หมวดสินค้า" value={details.category} disabled={locked} onChange={e=>onNewChange("category",e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>หน่วยขาย<input aria-label="หน่วยขายสินค้า" value={details.unit} readOnly={Boolean(product)} disabled={busy||!canCreate&&!product} onChange={e=>onNewChange("unit",e.target.value)} /></label></div>
        <details className="receive-size-details"><summary>ขนาด / ปริมาณสินค้า{product?.size ? ` · ${product.size}` : ""}</summary>{!product && <div className="receive-form-pair"><label>ขนาด<input type="number" min="0" value={details.sizeNum} disabled={locked} aria-label="ขนาดสินค้าใหม่" onChange={e=>onNewChange("sizeNum",e.target.value)} /></label><label>หน่วยขนาด<select value={details.sizeUnit} disabled={locked} aria-label="หน่วยขนาดสินค้าใหม่" onChange={e=>onNewChange("sizeUnit",e.target.value)}>{["มล.","ลิตร","กรัม","กก.","ชิ้น","แพ็ก","ถุง","ขวด","กล่อง"].map(u=><option key={u}>{u}</option>)}</select></label></div>}</details>
      </div>
    </div>
    <div className="receive-form-section">
      <h3>จำนวนและราคา</h3>
      <div className="receive-form-pair">{numberField("purchaseQty","จำนวนซื้อ *","receive-editor-qty",1,"1")}{numberField("freeQty","จำนวนแถม","receive-editor-free",0,"1")}
      {numberField("paidAmount","ยอดจ่ายทั้งหมด *","receive-editor-paid",0,"0.01")}
      <label>{newItem ? "ราคาขาย *" : "ราคาขายหลังรับเข้า"}<input id="receive-editor-selling-price" aria-label={newItem ? "ราคาขายสินค้าใหม่" : "ราคาขายหลังรับเข้า"} type="number" min="0" step="0.01" value={newItem?.price??value.sellingPrice} disabled={busy||!ready||(!newItem&&(!canChangePrice||loading||pricingError))} placeholder={product ? `คงเดิม ${(pricing?.sellingPrice??product.price).toFixed(2)}` : "0.00"} onChange={e=>newItem ? onNewChange("price",e.target.value) : onChange("sellingPrice",e.target.value)} /></label></div>
      {ready && ((pricing && value.sellingPrice.trim() && Number(value.sellingPrice)<pricing.sellingPrice) || (cost!==null && price<cost)) && <p className="receive-price-warning" role="status">{pricing && value.sellingPrice.trim() && Number(value.sellingPrice)<pricing.sellingPrice ? `ลดราคาจาก ฿${pricing.sellingPrice.toFixed(2)} เป็น ฿${price.toFixed(2)} · คงเหลือ ${pricing.remainingQty} หน่วย${pricing.highestRemainingCost!==null ? ` · ต้นทุนสูงสุดที่มีข้อมูล ฿${pricing.highestRemainingCost.toFixed(4)}` : " · ยังไม่ทราบต้นทุนของเดิม"}${pricing.unknownRemainingQty ? ` · ไม่ทราบต้นทุน ${pricing.unknownRemainingQty} หน่วย` : ""} · ` : ""}{cost!==null && price<cost ? "ราคาขายต่ำกว่าต้นทุนรอบนี้ · " : ""}ตรวจสอบก่อนยืนยัน</p>}
    </div>
    <div className="receive-form-section"><h3>ล็อตสินค้า</h3><div className="receive-form-pair"><label>Lot<input id="receive-editor-lot" aria-label="Lot ที่กำลังกรอก" value={value.lot} disabled={busy||!ready} placeholder="อัตโนมัติ" onChange={e=>onChange("lot",e.target.value)} /></label><label>วันหมดอายุ<ExpiryDateInput id="receive-editor-expiry" value={value.expiry} disabled={busy||!ready} onChange={v=>onChange("expiry",v)} label="วันหมดอายุรายการที่กำลังกรอก" /></label></div></div>
    </div>
    <div className="receive-draft-actions"><button data-add-receipt type="button" className="primary-button" disabled={busy||!ready||loading} onClick={onAdd}>เพิ่มลงรายการ</button><div className="receive-secondary-actions">{(product||newDraftActive) && <button type="button" className="outline-button" disabled={busy} onClick={onClear}>ล้างข้อมูล</button>}<button type="button" className="outline-button receive-cancel" disabled={busy} onClick={onCancel}>ยกเลิก</button></div></div>
  </section>;
}
