import fs from 'node:fs';
const t = fs.readFileSync('client/src/pages/Pos.tsx','utf8');
const keys = ['pay-qr-block','pay-bank-accounts','pay-confirm-rows','pay-verify-block','\u0e15\u0e34\u0e4a\u0e01\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e2d\u0e1a\u0e01\u0e48\u0e2d\u0e19','\u0e15\u0e23\u0e27\u0e08\u0e2a\u0e2d\u0e1a\u0e01\u0e32\u0e23\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19\u0e41\u0e25\u0e49\u0e27'];
for (const k of keys) {
  const i = t.indexOf(k);
  console.log(k+' @'+i);
}
const i = t.indexOf('pay-qr-block');
fs.writeFileSync('C:/Temp/pay-qr-segment.txt', t.slice(Math.max(0,i-2000), i+9000));
console.log('wrote segment len '+t.slice(Math.max(0,i-2000), i+9000).length);
