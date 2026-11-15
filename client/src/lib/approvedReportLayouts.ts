import {exportCount,exportNumber} from '@/exportUtils';
import {formatLogDateTime} from '@/pages/viewFormat';
import {parseBangkokDate,bangkokParts} from '@shared/storeTime';
export function shortOpeningLot(lot:string,code:string){
 const match=/^(OPEN-\d{8})-(.+)$/.exec(lot);
 return match && match[2]===code && code.trim() ? match[1] : lot;
}
type StockReceipt={sku:string;barcode?:string|null;name:string;unit:string;lot:string;receivedAt:string;receivedQty:number|null;sellingPrice:number;sellingValue:number|null;expiry:string|null;actor:string|null};
export function stockReceiptLayout(source:readonly StockReceipt[]){
 const units=new Map<string,number>();
 const rows=source.map(row=>{
  const code=row.barcode?.trim()||row.sku,date=parseBangkokDate(row.receivedAt),parts=date?bangkokParts(date):null;
  const day=parts?`${String(parts.day).padStart(2,'0')}/${String(parts.month).padStart(2,'0')}/${String((parts.year+543)%100).padStart(2,'0')}`:row.receivedAt;
  if(row.receivedQty!==null)units.set(row.unit,(units.get(row.unit)||0)+row.receivedQty);
  return [day,code,row.name,shortOpeningLot(row.lot,code),row.receivedQty===null?'ไม่ระบุ':`${exportCount(row.receivedQty)} ${row.unit}`,exportNumber(row.sellingPrice),row.sellingValue===null?'ไม่ระบุ':exportNumber(row.sellingValue),row.expiry??'—',row.actor??'ไม่ระบุ'];
 });
 return {columns:['วันที่รับเข้า','บาร์โค้ดสินค้า','ชื่อสินค้า','LOT','จำนวน/หน่วย','ราคาขาย/หน่วย','มูลค่าราคาขาย','หมดอายุ','ผู้ทำรายการ'],rows,numericCols:[5,6],columnWidths:['9%','14%','15%','13%','10%','8%','8%','9%','14%'],nowrapCols:[0,1,3,4,5,6,7],topAlignCells:true,summaryBlocks:Array.from(units,([unit,qty])=>[`จำนวนรับรวม · ${unit}`,exportCount(qty)] as [string,string])};
}
type Transaction={createdAt:string;cardNumber:string|null;memberNumber:string;amount:number;memberName:string|null;actor:string|null};
export function hospitalTransactionLayout(source:readonly Transaction[]){
 return {columns:['วัน–เวลา','เลขบัตร','เลขสมาชิก','ชื่อสมาชิก','จำนวนเงิน (บาท)','ผู้ทำรายการ'],columnWidths:['21%','16%','12%','23%','14%','14%'],nowrapCols:[0,1,2,4],numericCols:[4],rows:source.map(row=>[formatLogDateTime(row.createdAt),row.cardNumber??'—',row.memberNumber,row.memberName??'—',exportNumber(Math.abs(row.amount)),row.actor??'ไม่ระบุ']),totalsRow:[`รวม ${exportCount(source.length)} รายการ`,'','','',exportNumber(source.reduce((sum,row)=>sum+Math.abs(row.amount),0)),'']};
}
