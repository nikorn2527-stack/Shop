import { Check, Pencil, Trash2 } from "@/lib/icons";
import { RowActionButton } from "./RowActionButton";
import { useState } from "react";
import { ExpiryDateInput } from "./ExpiryDateInput";

type Entry = {lot:string;expiry:string;purchaseQty:string;freeQty:string;paidAmount:string;sellingPrice:string;previousCost?:number|null;expectedSellingPrice?:number};
export function ReceiveEntryRow({entry,index,name,code,unit,sellingPrice,canChangePrice=false,busy,onUpdate,onRemove}:{
  entry:Entry;index:number;name:string;code?:string|null;unit?:string;sellingPrice:number;canChangePrice?:boolean;
  busy:boolean;onUpdate:(field:keyof Entry,value:string)=>void;onRemove:()=>void;
}) {
  const [editing,setEditing]=useState(false);
  const [nameExpanded,setNameExpanded]=useState(false);
  const row=index+1;
  const total=Number(entry.purchaseQty)+Number(entry.freeQty);
  const field=(key:"purchaseQty"|"freeQty"|"paidAmount",label:string,min:number,step:string)=><label>{label}<input aria-label={`${label}รายการ ${row}`} type="number" min={min} step={step} value={entry[key]} disabled={busy} onChange={e=>onUpdate(key,key==="paidAmount" ? e.target.value : e.target.value.replace(/^0+(?=\d)/,""))} /></label>;
  const unitCost=entry.paidAmount.trim() && total>0 ? `฿${(Number(entry.paidAmount)/total).toFixed(4)}` : "—";
  return <tr className={`receive-main-row${editing ? " receive-row-editing" : ""}`}>
    <td><button type="button" className={`receive-product-name${nameExpanded ? " is-expanded" : ""}`} title={`${name}${code ? ` / ${code}` : ""}`} aria-label={`${nameExpanded ? "ย่อชื่อสินค้า" : "ดูชื่อสินค้าเต็ม"}รายการ ${row}: ${name}`} aria-expanded={nameExpanded} onClick={()=>setNameExpanded(current=>!current)}><b>{name}</b>{code && <><span className="receive-inline-divider"> / </span><small className="receive-product-code">{code}</small></>}</button></td>
    <td title={`จำนวนซื้อ / จำนวนแถม (${unit||"หน่วย"})`}>{editing ? <div className="receive-inline-fields">{field("purchaseQty","จำนวนซื้อ",1,"1")}{field("freeQty","จำนวนแถม",0,"1")}</div> : <div className="receive-inline-values"><span>{entry.purchaseQty}</span><small> / {entry.freeQty||"0"}</small></div>}</td>
    <td><div className="receive-inline-values">{editing ? field("paidAmount","ยอดจ่าย",0,"0.01") : <b>฿{Number(entry.paidAmount||0).toFixed(2)}</b>}<small> / {entry.previousCost==null ? "—" : `฿${entry.previousCost.toFixed(4)}`}</small><small> / {unitCost}</small></div></td>
    <td><div className="receive-inline-values">{editing && canChangePrice ? <label>ราคาขาย<input aria-label={`ราคาขายรายการ ${row}`} type="number" min="0" step="0.01" value={entry.sellingPrice} placeholder={sellingPrice.toFixed(2)} disabled={busy} onChange={e=>onUpdate("sellingPrice",e.target.value)} /></label> : <span className={entry.sellingPrice.trim() ? "receive-price-changed" : undefined} title={entry.sellingPrice.trim() && entry.expectedSellingPrice!==undefined ? `ราคาขายเดิม ฿${entry.expectedSellingPrice.toFixed(2)}` : undefined}>฿{sellingPrice.toFixed(2)}</span>}</div></td>
    <td>{editing ? <div className="receive-inline-fields"><label>Lot<input aria-label={`Lot รายการ ${row}`} value={entry.lot} disabled={busy} placeholder="อัตโนมัติ" onChange={e=>onUpdate("lot",e.target.value)} /></label><label>วันหมดอายุ<ExpiryDateInput value={entry.expiry} disabled={busy} onChange={v=>onUpdate("expiry",v)} label={`วันหมดอายุรายการ ${row}`} /></label></div> : <div className="receive-inline-values receive-inline-lot" title={`${entry.lot||"อัตโนมัติ"} / หมดอายุ ${entry.expiry||"ไม่ระบุ"}`}><span className="receive-lot-label">{entry.lot||"อัตโนมัติ"}</span><small> / {entry.expiry||"ไม่ระบุ"}</small></div>}</td>
    <td><div className="receive-row-actions"><RowActionButton disabled={busy} label={`${editing ? "เสร็จสิ้นการแก้ไขรายการ" : "แก้ไขรายการ"} ${row}`} tone={editing ? "success" : "default"} aria-pressed={editing} onClick={()=>setEditing(current=>!current)}>{editing ? <Check aria-hidden="true" /> : <Pencil aria-hidden="true" />}</RowActionButton><RowActionButton disabled={busy} label={`นำรายการ ${row} ออก`} tone="danger" onClick={onRemove}><Trash2 aria-hidden="true" /></RowActionButton></div></td>
  </tr>;
}
