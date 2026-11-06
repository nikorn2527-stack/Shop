import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckoutReceipt } from '@shared/storeTypes/sales';
const state = vi.hoisted(() => ({ settings: {appName:'ร้านทดสอบ',storeAddress:'',receiptPaperWidth:'58',bankAccounts:[]} }));
vi.mock('@/lib/trpc',()=>({trpc:{settings:{get:{useQuery:()=>({data:state.settings})}}}}));
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
  const html=render();expect(html).toContain('โรงพยาบาลธัญญารักษ์อุดรธานี\nที่อยู่ทดสอบ 123 หมู่ 4');expect(html.indexOf('ร้านทดสอบ')).toBeLessThan(html.indexOf('ที่อยู่ทดสอบ'));expect(html).toContain('class="receipt-address"');
 });
 it('omits an empty address and escapes configured text as text',()=>{
  state.settings.storeAddress='  ';expect(render()).not.toContain('class="receipt-address"');
  state.settings.storeAddress='<img src=x onerror=alert(1)>';const html=render();expect(html).toContain('&lt;img');expect(html).not.toContain('<img src=x');
 });
});
