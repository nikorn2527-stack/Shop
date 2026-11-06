import type {MemberBalanceRow} from '@shared/storeTypes/reports';
import {exportCount,exportNumber} from '../exportUtils';
import {memberFullName} from '../pages/pageData';
import {formatThaiDate} from '../pages/viewFormat';

/** One column mapping shared by CSV, Excel, PDF, preview and print. */
export function memberBalanceExport(members:readonly MemberBalanceRow[]){
 return {
  columns:['ลำดับ','เลขสมาชิก','เลขบัตรปัจจุบัน','ชื่อสมาชิก','วันที่เปิดใช้บัตร','ยอดทั้งหมด (บาท)','ยอดจ่าย (บาท)','คงเหลือ (บาท)'],
  numericCols:[5,6,7],
  rows:members.map((row,index)=>[exportCount(index+1),row.memberNumber,row.cardNumber?.trim()||'—',memberFullName(row),formatThaiDate(row.createdAt),exportNumber(row.totalIn),exportNumber(row.totalOut),exportNumber(row.balance)]),
  totalsRow:['รวม',`${members.length} ราย`,'','','',exportNumber(members.reduce((sum,row)=>sum+row.totalIn,0)),exportNumber(members.reduce((sum,row)=>sum+row.totalOut,0)),exportNumber(members.reduce((sum,row)=>sum+row.balance,0))],
 };
}
