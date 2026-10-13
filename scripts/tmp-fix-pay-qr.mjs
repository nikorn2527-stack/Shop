import fs from 'node:fs';
const p = 'client/src/pages/Pos.tsx';
let t = fs.readFileSync(p,'utf8');
const edits = [
  // 1) สรุปบิลโหมด QR: รวม "N รายการ · M ชิ้น" แถวเดียว + ตัดวิธีชำระ/ผู้ทำรายการที่ซ้ำหัวบิล (ประหยัด ~2 แถว)
  [`<div className="wallet-confirm-rows pay-confirm-rows"><div><span>จำนวนรายการ</span><b>{cart.length} รายการ</b></div><div><span>จำนวนชิ้น</span><b>{cartPieces} ชิ้น</b></div><div><span>ยอดรวมสินค้า</span><b>{money(subtotal)}</b></div>{discountValue > 0 && <div><span>ส่วนลด</span><b className="green-text">- {money(discountValue)}</b></div>}<div><span>วิธีชำระเงิน</span><b>{payConfirm}</b></div>`,
   `<div className="wallet-confirm-rows pay-confirm-rows"><div><span>จำนวนรายการ</span><b>{cart.length} รายการ · {cartPieces} ชิ้น</b></div><div><span>ยอดรวมสินค้า</span><b>{money(subtotal)}</b></div>{discountValue > 0 && <div><span>ส่วนลด</span><b className="green-text">- {money(discountValue)}</b></div>}<div><span>วิธีชำระเงิน</span><b>{payConfirm}</b></div>`],
  // ผู้ทำรายการซ้ำ — เก็บไว้เฉพาะโหมดที่ไม่ใช่ QR (QR ต้องการที่ให้ช่องติ๊ก)
  [`</div>}{payConfirm === "หักบัญชีสมาชิก" && selectedMember && <div><span>ยอดคงเหลือหลังชำระ</span>`,
   `</div>}{payConfirm !== "QR / สแกน" && <div><span>ผู้ทำรายการ</span><b>{cashier}</b></div>}{payConfirm === "หักบัญชีสมาชิก" && selectedMember && <div><span>ยอดคงเหลือหลังชำระ</span>`],
  [`<div><span>ผู้ทำรายการ</span><b>{cashier}</b></div><div className="pay-confirm-total">`,
   `<div className="pay-confirm-total">`],
  // 2) QR เคารพสวิตช์ตั้งค่า (qr/bank/both) — โหมด qr อย่างเดียวไม่โชว์บัญชีธนาคาร
  [`{payQrUrl ? <div className="pay-qr-figure">`,
   `{showQrFigure ? (payQrUrl ? <div className="pay-qr-figure">`],
  [`<CircleHelp size={17} /><span>ยังไม่ได้ตั้งบัญชีพร้อมเพย์ — ตั้งค่าที่เมนู การชำระเงิน</span></div>}{(settingsQuery.data?.bankAccounts ?? [])`,
   `<CircleHelp size={17} /><span>ยังไม่ได้ตั้งบัญชีพร้อมเพย์ — ตั้งค่าที่เมนู การชำระเงิน</span></div>) : null}{showBankAccounts && (settingsQuery.data?.bankAccounts ?? [])`],
  // 3) คำภาษาคน: ช่องติ๊ก + ปุ่มรวมเป็นคำเดียว "ยืนยัน" (เดิม "ตรวจสอบการชำระเงินแล้ว" vs "ติ๊กตรวจสอบก่อน" คนละคำ)
  [`<b>ตรวจสอบการชำระเงินแล้ว</b>`, `<b>ยืนยันว่าได้รับเงินแล้ว</b>`],
  [`? "ติ๊กตรวจสอบก่อน"`, `? "ยืนยันก่อน" `],
];
let ok = 0;
for (const [oldText, newText] of edits) {
  if (!t.includes(oldText)) { console.log('MISS: '+oldText.slice(0,80)); continue; }
  t = t.split(oldText).join(newText);
  ok++;
}
fs.writeFileSync(p, t);
console.log('applied '+ok+'/'+edits.length);
