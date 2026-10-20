import { ExpiryDateInput } from "./ExpiryDateInput";

type Entry = { lot:string;expiry:string;purchaseQty:string;freeQty:string;paidAmount:string;sellingPrice:string;previousCost?:number|null;expectedSellingPrice?:number };
export function ReceiveEntryRow({entry,index,name,code,unit,sellingPrice,canChangePrice=false,busy,onUpdate,onRemove}:{
  entry:Entry;index:number;name:string;code?:string|null;unit?:string;sellingPrice:number;canChangePrice?:boolean;
  busy:boolean;onUpdate:(field:keyof Entry,value:string)=>void;onRemove:()=>void;
}) {
  const row=index+1;
  const total=Number(entry.purchaseQty)+Number(entry.freeQty);
  const field=(key:"purchaseQty"|"freeQty"|"paidAmount",label:string,min:number,step:string)=><label>{label}<input aria-label={`${label}รายการ ${row}`} type="number" min={min} step={step} value={entry[key]} disabled={busy} onChange={e=>onUpdate(key,e.target.value)} /></label>;
  return <tr className="receive-main-row">
    <td><b>{name}</b>{code && <small>{code}</small>}{unit && <small>หน่วยขาย {unit}</small>}</td>
    <td>{field("purchaseQty","จำนวนซื้อ",1,"1")}{field("freeQty","จำนวนแถม",0,"1")}</td>
    <td>{field("paidAmount","ยอดจ่าย",0,"0.01")}<small>ก่อน {entry.previousCost==null ? "—" : `฿${entry.previousCost.toFixed(4)}`}</small><small>รอบนี้ {entry.paidAmount.trim() && total>0 ? `฿${(Number(entry.paidAmount)/total).toFixed(4)}` : "—"}</small></td>
    <td>{canChangePrice ? <label>ราคาขาย<input aria-label={`ราคาขายรายการ ${row}`} type="number" min="0" step="0.01" value={entry.sellingPrice} placeholder={sellingPrice.toFixed(2)} disabled={busy} onChange={e=>onUpdate("sellingPrice",e.target.value)} /></label> : `฿${sellingPrice.toFixed(2)}`}{entry.sellingPrice.trim() && <small className="receive-price-changed">{entry.expectedSellingPrice!==undefined && Number(entry.sellingPrice)<entry.expectedSellingPrice ? `ลดราคาจาก ฿${entry.expectedSellingPrice.toFixed(2)}` : "ราคาใหม่"}</small>}</td>
    <td><label>Lot<input aria-label={`Lot รายการ ${row}`} value={entry.lot} disabled={busy} placeholder="อัตโนมัติ" onChange={e=>onUpdate("lot",e.target.value)} /></label><label>วันหมดอายุ<ExpiryDateInput value={entry.expiry} disabled={busy} onChange={v=>onUpdate("expiry",v)} label={`วันหมดอายุรายการ ${row}`} /></label></td>
    <td><button type="button" className="outline-button" disabled={busy} aria-label={`นำรายการ ${row} ออก`} onClick={onRemove}>ลบแถว</button></td>
  </tr>;
}
