import type { ReactNode } from "react";
import { ExpiryDateInput } from "./ExpiryDateInput";

type Draft = { purchaseQty:string; freeQty:string; paidAmount:string; lot:string; expiry:string; sellingPrice:string };
type NewItem = {name:string;sku:string;category:string;unit:string;price:string;sizeNum:string;sizeUnit:string};
type Pricing = {previousCost:number|null;sellingPrice:number;remainingQty:number;highestRemainingCost:number|null;unknownRemainingQty:number};
export function ReceiveDraftRow({scan, value, onChange, product, newItem, onNewChange, categories, pricing, loading, pricingError, canChangePrice, busy, onNew, onAdd, onClear}: {
  scan:ReactNode;value:Draft;onChange:(field:keyof Draft,value:string)=>void;
  product?:{name:string;category:string;unit:string;price:number;sellMode?:string|null}|null;
  newItem?:NewItem;onNewChange:(field:keyof NewItem,value:string)=>void;categories:string[];
  pricing?:Pricing;loading:boolean;pricingError:boolean;canChangePrice:boolean;busy:boolean;
  onNew:()=>void;onAdd:()=>void;onClear:()=>void;
}) {
  const ready=Boolean(product || newItem);
  const total=Number(value.purchaseQty)+Number(value.freeQty);
  const cost=value.paidAmount.trim() && total>0 ? Number(value.paidAmount)/total : null;
  const price=newItem ? Number(newItem.price) : value.sellingPrice.trim() ? Number(value.sellingPrice) : pricing?.sellingPrice ?? product?.price ?? 0;
  const numberField=(field:"purchaseQty"|"freeQty"|"paidAmount",label:string,id:string,min:number,step:string)=><label>{label}<input id={id} aria-label={label} type="number" min={min} step={step} value={value[field]} disabled={busy||!ready} onChange={e=>onChange(field,e.target.value)} /></label>;
  return <>
    <tr className="receive-draft-row" onKeyDown={event=>{
      if(event.key!=="Enter" || event.defaultPrevented || event.nativeEvent.isComposing || !(event.target instanceof HTMLInputElement)) return;
      const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input:not(:disabled),select:not(:disabled),button[data-add-receipt]:not(:disabled)"));
      event.preventDefault();controls[controls.indexOf(event.target)+1]?.focus();
    }}>
      <td>{!newItem ? <>{scan}{product && <small>{product.category} · {product.unit}</small>}{!product && <button type="button" className="outline-button compact" disabled={busy} onClick={onNew}>เพิ่มสินค้าใหม่</button>}</> : <div className="receive-new-fields">
        <b>สินค้าใหม่</b>
        <label>บาร์โค้ด / รหัส<input aria-label="บาร์โค้ดสินค้าใหม่" value={newItem.sku} disabled={busy} onChange={e=>onNewChange("sku",e.target.value)} placeholder="เว้นว่างเพื่อออกรหัสอัตโนมัติ" /></label>
        <label>ชื่อสินค้า *<input id="receive-new-name" aria-label="ชื่อสินค้าใหม่" value={newItem.name} disabled={busy} onChange={e=>onNewChange("name",e.target.value)} /></label>
        <div className="receive-new-pair"><label>หมวดสินค้า<select aria-label="หมวดสินค้าใหม่" value={newItem.category} disabled={busy} onChange={e=>onNewChange("category",e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label>หน่วยขาย<input aria-label="หน่วยขายสินค้าใหม่" value={newItem.unit} disabled={busy} onChange={e=>onNewChange("unit",e.target.value)} /></label></div>
        <div className="receive-new-pair"><label>ขนาด<input type="number" min="0" value={newItem.sizeNum} disabled={busy} aria-label="ขนาดสินค้าใหม่" onChange={e=>onNewChange("sizeNum",e.target.value)} /></label><label>หน่วยขนาด<select value={newItem.sizeUnit} disabled={busy} aria-label="หน่วยขนาดสินค้าใหม่" onChange={e=>onNewChange("sizeUnit",e.target.value)}>{["มล.","ลิตร","กรัม","กก.","ชิ้น","แพ็ก","ถุง","ขวด","กล่อง"].map(u=><option key={u}>{u}</option>)}</select></label></div>
      </div>}</td>
      <td>{numberField("purchaseQty","จำนวนซื้อ *","receive-editor-qty",1,"1")}{numberField("freeQty","จำนวนแถม","receive-editor-free",0,"1")}</td>
      <td>{numberField("paidAmount","ยอดจ่ายทั้งหมด *","receive-editor-paid",0,"0.01")}<div className="receive-price-context"><small>ต้นทุนรอบก่อน / หน่วย</small><b>{newItem ? "—" : loading ? "กำลังโหลด…" : pricingError ? "โหลดข้อมูลไม่สำเร็จ" : pricing?.previousCost==null ? "—" : `฿${pricing.previousCost.toFixed(4)}`}</b><small>ต้นทุนรอบนี้ / หน่วย</small><b>{cost===null ? "—" : `฿${cost.toFixed(4)}`}</b></div></td>
      <td>{!newItem && <small>ปัจจุบัน {product ? `฿${(pricing?.sellingPrice??product.price).toFixed(2)}` : "—"}</small>}<label>{newItem ? "ราคาขาย *" : "ราคาขายหลังรับเข้า"}<input id="receive-editor-selling-price" aria-label={newItem ? "ราคาขายสินค้าใหม่" : "ราคาขายหลังรับเข้า"} type="number" min="0" step="0.01" value={newItem?.price??value.sellingPrice} disabled={busy||!ready||(!newItem&&(!canChangePrice||loading||pricingError))} placeholder="คงเดิม" onChange={e=>newItem ? onNewChange("price",e.target.value) : onChange("sellingPrice",e.target.value)} /></label>{product?.sellMode==="money" && <small>ปรับช่องราคาในข้อมูลสินค้า</small>}</td>
      <td><label>Lot<input id="receive-editor-lot" aria-label="Lot ที่กำลังกรอก" value={value.lot} disabled={busy||!ready} placeholder="อัตโนมัติ" onChange={e=>onChange("lot",e.target.value)} /></label><label>วันหมดอายุ<ExpiryDateInput id="receive-editor-expiry" value={value.expiry} disabled={busy||!ready} onChange={v=>onChange("expiry",v)} label="วันหมดอายุรายการที่กำลังกรอก" /></label></td>
      <td><div className="receive-draft-actions"><button data-add-receipt type="button" className="primary-button" disabled={busy||!ready||loading} onClick={onAdd}>เพิ่มลงรายการ</button>{ready && <button type="button" className="outline-button" disabled={busy} onClick={onClear}>ล้างแถว</button>}</div></td>
    </tr>
    {ready && ((pricing && value.sellingPrice.trim() && Number(value.sellingPrice)<pricing.sellingPrice) || (cost!==null && price<cost)) && <tr className="receive-draft-warning"><td colSpan={6}><p className="receive-price-warning" role="status">{pricing && value.sellingPrice.trim() && Number(value.sellingPrice)<pricing.sellingPrice ? `ลดราคาจาก ฿${pricing.sellingPrice.toFixed(2)} เป็น ฿${price.toFixed(2)} · คงเหลือ ${pricing.remainingQty} หน่วย${pricing.highestRemainingCost!==null ? ` · ต้นทุนสูงสุดที่มีข้อมูล ฿${pricing.highestRemainingCost.toFixed(4)}` : " · ยังไม่ทราบต้นทุนของเดิม"}${pricing.unknownRemainingQty ? ` · ไม่ทราบต้นทุน ${pricing.unknownRemainingQty} หน่วย` : ""} · ` : ""}{cost!==null && price<cost ? "ราคาขายต่ำกว่าต้นทุนรอบนี้ · " : ""}ตรวจสอบก่อนยืนยัน</p></td></tr>}
  </>;
}
