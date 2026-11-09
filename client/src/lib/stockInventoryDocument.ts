import type { Product } from '@shared/storeTypes/inventory';
import type { ReportDocConfig } from '@shared/reportDoc';
import { reportSellingValue } from '@shared/reportValuation';
import { exportCount, exportNumber } from '../exportUtils';
import { money } from '../pages/pageData';

type InventoryCard = {
 product: Pick<Product,'itemNumber'|'sku'|'barcode'|'name'|'unit'|'stock'|'price'>;
 lots: readonly unknown[];
 status: string;
};

/** Current inventory, in the same identity-column order as the period report. */
export function buildStockInventoryDocument(cards: readonly InventoryCard[], periodLabel: string): ReportDocConfig {
 const qty=cards.reduce((sum,card)=>sum+card.product.stock,0);
 const value=cards.reduce((sum,card)=>sum+reportSellingValue(card.product.stock,card.product.price),0);
 return {
  fileName:'stock-report.pdf',title:'รายงานสินค้าคงคลัง',periodLabel,
  meta:[['จำนวนรายการ',`${cards.length} รายการ`],['คงเหลือรวม',`${qty.toLocaleString('th-TH')} หน่วย`],['มูลค่าคงคลังรวม (ราคาขาย)',money(value)],['ล็อตทั้งหมด',`${cards.reduce((sum,card)=>sum+card.lots.length,0)} ล็อต`]],
  columns:['Item','รหัส/บาร์โค้ด','ชื่อสินค้า','หน่วย','คงเหลือ','ราคาต่อหน่วย','มูลค่าคงเหลือ','สถานะ'],
  numericCols:[4,5,6],columnWidths:['5%','18%','30%','6%','7%','11%','12%','11%'],nowrapCols:[0,1,3,4,5,6,7],
  rows:cards.map(({product:p,status})=>[exportCount(p.itemNumber),p.barcode?.trim()||p.sku,p.name,p.unit,exportCount(p.stock),exportNumber(p.price),exportNumber(reportSellingValue(p.stock,p.price)),status]),
  totalsRow:['รวม','',`${cards.length} รายการ`,'',exportCount(qty),'',exportNumber(value),''],
  brandName:'ร้านค้าสวัสดิการ',compact:true,
  footnote:'ข้อมูลคงคลัง ณ เวลาสร้างเอกสาร · รายละเอียดล็อตและวันหมดอายุดูได้จากหน้าจอรายการคงคลัง',
 };
}
