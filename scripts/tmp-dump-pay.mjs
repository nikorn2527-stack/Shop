import fs from 'node:fs';
const p = 'client/src/pages/Pos.tsx';
let t = fs.readFileSync(p,'utf8');
const dump = (label, key, len=900) => {
  const i = t.indexOf(key);
  if (i<0) { console.log(label+' NOT-FOUND '+key.slice(0,60)); return; }
  fs.writeFileSync('C:/Temp/'+label+'.txt', t.slice(Math.max(0,i-600), i+len));
  console.log(label+' @'+i+' -> C:/Temp/'+label+'.txt');
};
dump('pay-summary','pay-confirm-rows');
dump('pay-qr','pay-qr-block');
dump('pay-verify','pay-verify-block');
dump('pay-btn','pay-confirm-button pos-premium');
