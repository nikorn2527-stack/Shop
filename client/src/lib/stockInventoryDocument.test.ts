import { describe, expect, it } from 'vitest';
import { buildStockInventoryDocument } from './stockInventoryDocument';
const cards=[{product:{itemNumber:7,sku:'SKU-007',barcode:'0001234567890',name:'ผงซักฟอกแอทแทคอีซี่(สีชมพู)',unit:'ถุง',stock:2,price:20},lots:[{}],status:'ปกติ'},
 {product:{itemNumber:12,sku:'SKU-012',barcode:' ',name:'สินค้าไม่มีบาร์โค้ด',unit:'ชิ้น',stock:3,price:5},lots:[],status:'สต็อกต่ำ'}];
describe('stock inventory document layout',()=>{
 it('matches report column order, preserves permanent Items after filtering and keeps a compact document',()=>{
  const doc=buildStockInventoryDocument(cards,'วันนี้');
  expect(doc.columns).toEqual(['Item','รหัส/บาร์โค้ด','ชื่อสินค้า','หน่วย','คงเหลือ','ราคาต่อหน่วย','มูลค่าคงเหลือ','สถานะ']);
  expect(doc.rows).toHaveLength(2);expect(doc.rows[0]).toEqual(['7','0001234567890',cards[0].product.name,'ถุง','2','20.00','40.00','ปกติ']);
  expect(doc.rows[1].slice(0,2)).toEqual(['12','SKU-012']);
  expect(doc.compact).toBe(true);expect(doc.numericCols).toEqual([4,5,6]);expect(doc.nowrapCols).toContain(1);
  expect(doc.totalsRow?.[4]).toBe('5');expect(doc.totalsRow?.[6]).toBe('55.00');
  expect(buildStockInventoryDocument(cards.slice(1),'กรอง').rows[0][0]).toBe('12');
 });
});
