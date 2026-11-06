import {describe,expect,it} from 'vitest';
import type {MemberBalanceRow} from '@shared/storeTypes/reports';
import {memberBalanceExport} from './memberBalanceExport';
const member=(cardNumber:string|null,balance=0):MemberBalanceRow=>({id:1,memberNumber:'000123',cardNumber,patientCode:null,prename:null,firstName:'ทดสอบ',lastName:'รายงาน',type:'สมาชิก',status:'active',createdAt:'2026-11-06 12:00:00',totalIn:100,totalOut:100-balance,balance});
describe('current cards in all balance exports',()=>{
 it('keeps current-card numbers as text after member number, including zero balances',()=>{
  const result=memberBalanceExport([member('0009876543210')]);
  expect(result.columns.slice(0,4)).toEqual(['ลำดับ','เลขสมาชิก','เลขบัตรปัจจุบัน','ชื่อสมาชิก']);
  expect(result.rows[0].slice(0,3)).toEqual(['1','000123','0009876543210']);
  expect(result.rows[0][7]).toBe('0.00');expect(result.numericCols).toEqual([5,6,7]);expect(result.numericCols).not.toContain(2);
  expect(result.totalsRow).toHaveLength(result.columns.length);
 });
 it('uses a dash for absent cards and computes totals from exactly the displayed rows',()=>{
  const result=memberBalanceExport([member(null,20),member(' ',30)]);
  expect(result.rows.map(row=>row[2])).toEqual(['—','—']);expect(result.totalsRow[7]).toBe('50.00');expect(result.rows).toHaveLength(2);
 });
});
