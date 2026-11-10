import {exportCount,exportNumber} from '@/exportUtils';
type ProductSalesExportRow={name:string;sku:string|null;barcode:string|null;bills:number;qty:number;revenue:number;cogs:number;profit:number;priceMin?:number;priceMax?:number};
export function productSalesExport(source:ProductSalesExportRow[],includeCosts:boolean){
 const columns=['บาร์โค้ดสินค้า','สินค้า (รหัส)','ราคาขาย/หน่วย (บาท)','บิล','ชิ้น','ยอดขาย (บาท)',...(includeCosts?['ต้นทุน (บาท)','กำไร (บาท)']:[])];
 const rows=source.map(row=>{
  const price=row.priceMin==null||row.priceMax==null?'—':row.priceMin===row.priceMax?exportNumber(row.priceMin):`${exportNumber(row.priceMin)}–${exportNumber(row.priceMax)}`;
  return [row.barcode||'—',`${row.name}${row.sku?` (${row.sku})`:''}`,price,exportCount(row.bills),exportCount(row.qty),exportNumber(row.revenue),...(includeCosts?[exportNumber(row.cogs),exportNumber(row.profit)]:[])];
 });
 const total=(key:'bills'|'qty'|'revenue'|'cogs'|'profit')=>source.reduce((sum,row)=>sum+row[key],0);
 const totalsRow=['รวมทุกสินค้า','','',exportCount(total('bills')),exportCount(total('qty')),exportNumber(total('revenue')),...(includeCosts?[exportNumber(total('cogs')),exportNumber(total('profit'))]:[])];
 return {columns,rows,totalsRow,numericCols:includeCosts?[2,3,4,5,6,7]:[2,3,4,5]};
}
export function nonzeroStockRows<T extends {remaining:number}>(rows:readonly T[]):T[]{return rows.filter(row=>row.remaining!==0);}
