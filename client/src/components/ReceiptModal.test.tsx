import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutReceipt } from '@shared/storeTypes/sales';
const state = vi.hoisted(() => ({ settings: {appName:'ร้านทดสอบ',storeAddress:'',receiptPaperWidth:'58',bankAccounts:[]} }));
vi.mock('@/lib/trpc',()=>({trpc:{printing:{issue:{useMutation:()=>({mutateAsync:vi.fn()})}},settings:{get:{useQuery:()=>({data:state.settings})}}}}));
// Radix portals are browser-only; test the real printable document inside them.
vi.mock('./WorkflowDialog',()=>({WorkflowDialog:({children}:{children:unknown})=>children}));
import { ReceiptModal } from './ReceiptModal';
const receipt: CheckoutReceipt={orderNumber:'TEST',createdAt:'2026-11-06 12:00:00',items:[],subtotal:0,discount:0,total:0,paymentMethod:'เงินสด',memberNumber:null,memberName:null,balanceAfter:null,cashier:'ผู้ทดสอบ'};
const render=()=>renderToStaticMarkup(createElement(ReceiptModal,{receipt,onClose:()=>{}}));
beforeEach(()=>vi.stubGlobal('React',React));
afterEach(()=>vi.unstubAllGlobals());
describe('store address in the shared receipt document',()=>{
 it.each(['58','72','80'])('shows configured address below store name on %s mm receipts',width=>{
  state.settings.receiptPaperWidth=width;state.settings.storeAddress='  โรงพยาบาลธัญญารักษ์อุดรธานี\nที่อยู่ทดสอบ 123 หมู่ 4  ';
  const html=render();expect(html).toContain('โรงพยาบาลธัญญารักษ์อุดรธานี');expect(html).toContain('ที่อยู่ทดสอบ 123 หมู่ 4');expect(html.indexOf('ร้านทดสอบ')).toBeLessThan(html.indexOf('ที่อยู่ทดสอบ'));expect(html).toContain('class="receipt-address"');
 });
 it('omits an empty address and escapes configured text as text',()=>{
  state.settings.storeAddress='  ';expect(render()).not.toContain('class="receipt-address"');
  state.settings.storeAddress='<img src=x onerror=alert(1)>';const html=render();expect(html).toContain('&lt;img');expect(html).not.toContain('<img src=x');
 });
});

describe('receipt without copy labels',()=>{
 it('omits copy labels and download variant choices on new and reopened receipts',()=>{
  const html=renderToStaticMarkup(createElement(ReceiptModal,{receipt,onClose:()=>{},mode:'reprint'}));
  expect(html).not.toContain('สำเนา');
  expect(html).not.toContain('รูปแบบเอกสารดาวน์โหลด');
  expect(render()).not.toContain('class="slip-copy-mark"');
 });
});

describe('receipt reference and time rows',()=>{
 it('renders the number, date and unbroken time as three individual rows',()=>{
  const html=render();expect(html.match(/class="receipt-meta-row"/g)).toHaveLength(3);
  expect(html).toContain('เลขที่ใบเสร็จ');expect(html).toContain('12:00 น.');
  expect(html).toContain('white-space:nowrap;text-align:right');
 });
});

describe('receipt member identity',()=>{
 it('keeps the full name separate from the member number without a duplicate member prefix',()=>{
  const html=renderToStaticMarkup(createElement(ReceiptModal,{receipt:{...receipt,memberName:'นายสมชาย นามสกุลตัวอย่าง',memberNumber:'TEST-001'},onClose:()=>{}}));
  const customer=html.slice(html.indexOf('class="receipt-customer"'),html.indexOf('</div>',html.indexOf('class="receipt-customer"')));
  expect(customer).toContain('นายสมชาย นามสกุลตัวอย่าง');
  expect(customer).not.toContain('TEST-001');
  expect(customer).not.toContain('สมาชิกนาย');
  expect(customer).toContain('font-size:12px');
  expect(html).toContain('class="receipt-member-reference"');
  expect(html.indexOf('class="receipt-member-reference"')).toBeLessThan(html.indexOf('class="receipt-customer"'));
  expect(html).toContain('เลขสมาชิก');expect(html).toContain('TEST-001');
 });
 it('does not add an empty membership row for a general customer',()=>{
  const html=render();expect(html).toContain('บุคคลทั่วไป');expect(html).not.toContain('class="receipt-member-reference"');
 });
});
