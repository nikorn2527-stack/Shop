import {describe,it,expect} from 'vitest';
import {productSalesExport,nonzeroStockRows} from './reportExportLayouts';
describe('customer report layouts',()=>{
 it('keeps barcode text first in all formats and costs only in spreadsheets',()=>{
  const row={productId:1,name:'น้ำ',sku:'A',barcode:'0000123',category:null,bills:2,qty:3,revenue:30,cogs:18,profit:12,marginPct:40,priceMin:10,priceMax:10};
  const pdf=productSalesExport([row],false),sheet=productSalesExport([row],true);
  expect(pdf.columns).toEqual(['บาร์โค้ดสินค้า','สินค้า (รหัส)','ราคาขาย/หน่วย (บาท)','บิล','ชิ้น','ยอดขาย (บาท)']);
  expect(pdf.rows[0]).toEqual(['0000123','น้ำ (A)','10.00','2','3','30.00']);
  expect(sheet.rows[0].slice(0,6)).toEqual(pdf.rows[0]);
  expect(sheet.rows[0].slice(6)).toEqual(['18.00','12.00']);
  expect(sheet.numericCols).not.toContain(0);
 });
 it('shows historical price ranges without substituting a misleading average',()=>{
  const row={name:'น้ำ',sku:null,barcode:null,bills:2,qty:2,revenue:25,cogs:10,profit:15,priceMin:10,priceMax:15};
  expect(productSalesExport([row],false).rows[0][2]).toBe('10.00–15.00');
 });
 it('excludes only zero stock, retains negative anomalies and original item numbers, and does not mutate input',()=>{
  const rows=[{itemNumber:1,remaining:0},{itemNumber:2,remaining:3},{itemNumber:7,remaining:-1}];
  expect(nonzeroStockRows(rows)).toEqual([rows[1],rows[2]]);expect(rows).toHaveLength(3);
 });
});
