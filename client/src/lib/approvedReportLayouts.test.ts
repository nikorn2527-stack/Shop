import {describe,it,expect} from 'vitest';
import {shortOpeningLot,stockReceiptLayout,hospitalTransactionLayout} from './approvedReportLayouts';
describe('approved portrait report layouts',()=>{
 it('shortens only a matching opening LOT for display, keeping supplier lots and stored values intact',()=>{
  expect(shortOpeningLot('OPEN-20261102-000123','000123')).toBe('OPEN-20261102');
  expect(shortOpeningLot('OPEN-20261102-000123','999')).toBe('OPEN-20261102-000123');
  expect(shortOpeningLot('SUPPLIER-000123','000123')).toBe('SUPPLIER-000123');
 });
 it('puts receipt date first without time and preserves barcode text, money and per-unit totals',()=>{
  const source=[{sku:'S1',barcode:'000123',name:'สินค้า',unit:'ขวด',lot:'OPEN-20261102-000123',receivedAt:'2026-11-02 07:10:00',receivedQty:2,sellingPrice:10,sellingValue:20,expiry:null,actor:null}];
  const result=stockReceiptLayout(source);expect(result.columns.slice(0,4)).toEqual(['วันที่รับเข้า','บาร์โค้ดสินค้า','ชื่อสินค้า','LOT']);
  expect(result.rows[0]).toEqual(['02/11/69','000123','สินค้า','OPEN-20261102','2 ขวด','10.00','20.00','—','ไม่ระบุ']);
  expect(result.summaryBlocks).toEqual([['จำนวนรับรวม · ขวด','2']]);expect(source[0].lot).toBe('OPEN-20261102-000123');
  expect(result.numericCols).not.toContain(1);
 });
 it('orders transaction card, member and amount consistently with an unbroken Bangkok date/time',()=>{
  const result=hospitalTransactionLayout([{createdAt:'2026-11-02 07:10:00',cardNumber:'000123',memberNumber:'000007',amount:-25,memberName:'นาย ตัวอย่าง นามสกุลเต็ม',actor:'เจ้าหน้าที่'}]);
  expect(result.columns).toEqual(['วัน–เวลา','เลขบัตร','เลขสมาชิก','ชื่อสมาชิก','จำนวนเงิน (บาท)','ผู้ทำรายการ']);
  expect(result.rows[0]).toEqual(['2 พ.ย. 2569 07:10','000123','000007','นาย ตัวอย่าง นามสกุลเต็ม','25.00','เจ้าหน้าที่']);
  expect(result.totalsRow).toEqual(['รวม 1 รายการ','','','','25.00','']);expect(result.nowrapCols).toContain(0);expect(result.numericCols).toEqual([4]);
 });
});
