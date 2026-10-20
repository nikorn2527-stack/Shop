import { useState } from "react";
import { ExpiryDateInput } from "./ExpiryDateInput";

type Entry = {lot:string;expiry:string;purchaseQty:string;freeQty:string;paidAmount:string;sellingPrice:string;previousCost?:number|null;expectedSellingPrice?:number};
export function ReceiveEntryRow({entry,index,name,code,unit,sellingPrice,canChangePrice=false,busy,onUpdate,onRemove}:{
  entry:Entry;index:number;name:string;code?:string|null;unit?:string;sellingPrice:number;canChangePrice?:boolean;
  busy:boolean;onUpdate:(field:keyof Entry,value:string)=>void;onRemove:()=>void;
}) {
  const [editing,setEditing]=useState(false);
  const row=index+1;
  const total=Number(entry.purchaseQty)+Number(entry.freeQty);
  const field=(key:"purchaseQty"|"freeQty"|"paidAmount",label:string,min:number,step:string)=><label>{label}<input aria-label={`${label}รายการ ${row}`} type="number" min={min} step={step} value={entry[key]} disabled={busy} onChange={e=>onUpdate(key,e.target.value)} /></label>;
  const unitCost=entry.paidAmount.trim() && total>0 ? `฿${(Number(entry.paidAmount)/total).toFixed(4)}` : "—";
  return <tr className={`receive-main-row${editing ? " receive-row-editing" : ""}`}>
    <td><b>{name}</b>{code && <small>{code}</small>}</td>
    <td>{editing ? <>{field("purchaseQty","จำนวนซื้อ",1,"1")}{field("freeQty","จำนวนแถม",0,"1")}</> : <><span>{entry.purchaseQty} {unit||"หน่วย"}</span><small>แถม {entry.freeQty||"0"}</small></>}</td>
    <td>{editing ? field("paidAmount","ยอดจ่าย",0,"0.01") : <b>฿{Number(entry.paidAmount||0).toFixed(2)}</b>}<small>ก่อน {entry.previousCost==null ? "—" : `฿${entry.previousCost.toFixed(4)}`}</small><small>รอบนี้ {unitCost}</small></td>
    <td>{editing && canChangePrice ? <label>ราคาขาย<input aria-label={`ราคาขายรายการ ${row}`} type="number" min="0" step="0.01" value={entry.sellingPrice} placeholder={sellingPrice.toFixed(2)} disabled={busy} onChange={e=>onUpdate("sellingPrice",e.target.value)} /></label> : `฿${sellingPrice.toFixed(2)}`}{entry.sellingPrice.trim() && <small className="receive-price-changed">{entry.expectedSellingPrice!==undefined && Number(entry.sellingPrice)<entry.expectedSellingPrice ? `ลดจาก ฿${entry.expectedSellingPrice.toFixed(2)}` : "ราคาใหม่"}</small>}</td>
    <td>{editing ? <><label>Lot<input aria-label={`Lot รายการ ${row}`} value={entry.lot} disabled={busy} placeholder="อัตโนมัติ" onChange={e=>onUpdate("lot",e.target.value)} /></label><label>วันหมดอายุ<ExpiryDateInput value={entry.expiry} disabled={busy} onChange={v=>onUpdate("expiry",v)} label={`วันหมดอายุรายการ ${row}`} /></label></> : <><span>{entry.lot||"อัตโนมัติ"}</span><small>หมดอายุ {entry.expiry||"ไม่ระบุ"}</small></>}</td>
    <td><div className="receive-row-actions"><button type="button" className="outline-button" disabled={busy} aria-label={`แก้ไขรายการ ${row}`} aria-pressed={editing} onClick={()=>setEditing(current=>!current)}>{editing ? "เสร็จ" : "แก้ไข"}</button><button type="button" className="icon-button" disabled={busy} aria-label={`นำรายการ ${row} ออก`} onClick={onRemove}>×</button></div></td>
  </tr>;
}
