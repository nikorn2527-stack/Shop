import {randomUUID} from 'node:crypto';
import {
 createProduct,listProducts,createBlankCards,registerMember,receiveStockLines,
 checkout,walletTx,returnMemberCard,assignMemberCard,closeMemberAccount,
 closeBusinessDay,voidSale,stockCountLots,addOrderItem,updateProduct,
 registerPosTerminal,openShift,closeShift,getShiftById,getSettings,setSettings,
 formatDateTime,type SqliteDb,
} from '../sqliteStore';

const MARKER='transaction_demo_scenarios_v1';
const ACTOR='เจ้าหน้าที่ตัวอย่าง ก';
const ACTOR_B='เจ้าหน้าที่ตัวอย่าง ข';
export type TransactionScenarioSummary={
 date:string;catalogProductsSold:number;sales:number;walletTransactions:number;stockLots:number;
 members:Record<string,string>;replacementCard:string;scenarios:string[];
};

/** CLI-only, never called by application startup or HTTP routes. */
export function seedTransactionScenarios(db:SqliteDb):TransactionScenarioSummary {
 if(db.prepare("SELECT value FROM store_settings WHERE key='transaction_demo_workspace'").get()?.value!=='1')throw Error('An isolated transaction demo workspace is required');
 const previous=db.prepare('SELECT value FROM store_settings WHERE key=?').get(MARKER) as {value:string}|undefined;
 if(previous)return JSON.parse(previous.value);
 const catalog=listProducts(db).filter(p=>p.price>0);
 if(!catalog.length)throw Error('Restore a Local catalog before creating transaction examples');
 if(db.prepare("SELECT 1 FROM products WHERE sku LIKE 'DEMO-TX-%'").get())throw Error('Demonstration SKU already exists; rebuild a fresh isolated copy');
 const counts=()=>db.prepare('SELECT (SELECT COUNT(*) FROM sales) AS sales,(SELECT COUNT(*) FROM member_transactions) AS walletTransactions,(SELECT COUNT(*) FROM stock_lots) AS stockLots').get() as {sales:number;walletTransactions:number;stockLots:number};
 const before=counts();const members:Record<string,string>={};
 const cards=Array.from({length:15},(_,i)=>'990066'+String(i+1).padStart(7,'0'));
 createBlankCards(db,cards,ACTOR,'admin');
 let nextCard=0;
 const add=(key:string,label:string,initialDeposit=0)=>{
  const result=registerMember(db,{firstName:'ตัวอย่าง '+label,lastName:'ทดสอบเท่านั้น',cardNumber:cards[nextCard++],...(initialDeposit>0?{initialDeposit}:{}),actor:ACTOR,actorRole:'admin'}).member;
  members[key]=result.memberNumber;return result;
 };
 const budget=Math.ceil(catalog.reduce((sum,p)=>sum+p.price,0)*2+1000);
 const spender=add('spender','เติมเงินและซื้อสินค้า',budget);
 const qrMember=add('qr','จ่าย QR และถอนเงิน',500);
 const zero=add('zeroStaying','ยังอยู่ ยอดศูนย์',100);
 const withdrawn=add('withdrawnZero','ถอนเงินเหลือศูนย์ ยังอยู่',30);
 const returnedZero=add('returnedZero','ออกแล้ว คืนบัตรยอดศูนย์');
 const returnedPaid=add('returnedPaid','ออกแล้ว คืนเงินและบัตร',120);
 const replacement=add('replacement','เปลี่ยนบัตร ยังอยู่',50);
 const pending=add('pendingCardReturn','ปิดรอบ รอรับบัตรคืน',80);
 const returnedClosed=add('returnedClosed','ปิดรอบและรับบัตรคืน',90);
 const deposit=add('deposit','เติมและถอนหลายครั้ง');
 members.noCard=registerMember(db,{firstName:'ตัวอย่าง ยังไม่รับบัตร',lastName:'ทดสอบเท่านั้น',actor:ACTOR,actorRole:'admin'}).member.memberNumber;
 const session=(n:string)=>Number(db.prepare('SELECT id FROM card_usage_sessions WHERE member_number=? AND ended_at IS NULL').get(n)!.id);
 const refundReturn=(n:string,card:string)=>returnMemberCard(db,{memberNumber:n,cardNumber:card,expectedSessionId:session(n),mode:'refund',actor:ACTOR,actorRole:'admin'});
 const settings=getSettings(db);setSettings(db,{appName:`ข้อมูลจำลอง · ${settings.appName}`,backupAutoEnabled:false},ACTOR,'admin');
 const used=new Set(db.prepare('SELECT number FROM pos_terminals').all().map(row=>Number(row.number)));
 const free=Array.from({length:999},(_,i)=>i+1).filter(number=>!used.has(number));
 if(free.length<2)throw Error('Two free POS numbers are required for the isolated demonstration');
 const posA=randomUUID(),posB=randomUUID();registerPosTerminal(db,posA,free[0],ACTOR);registerPosTerminal(db,posB,free[1],ACTOR_B);
 const shift=openShift(db,{cashierName:ACTOR,openingCash:500,note:'ข้อมูลจำลองเท่านั้น'});
 // Every existing priced catalog item gets a real intake and a sale example.
 for(const p of catalog){
  const unitCost=p.cost>0?p.cost:p.price;
  receiveStockLines(db,{productId:p.id,lot:`DEMO-TX-${p.id}`,lines:[{qty:5},{qty:1,cost:0}],paidAmount:Math.round(unitCost*5*100)/100,actor:ACTOR,actorRole:'admin'});
 }
 const first=catalog[0],second=catalog[1]??first;
 checkout(db,{items:[{productId:first.id,qty:1}],paymentMethod:'เงินสด',receivedCash:first.price+100,cashier:ACTOR,terminalDeviceId:posA});
 checkout(db,{items:[{productId:second.id,qty:1}],paymentMethod:'QR / สแกน',paymentVerified:true,memberNumber:qrMember.memberNumber,cashier:ACTOR_B,terminalDeviceId:posB});
 checkout(db,{items:[{productId:first.id,qty:1}],paymentMethod:'หักบัญชีสมาชิก',memberNumber:spender.memberNumber,cashier:ACTOR,terminalDeviceId:posA});
 closeBusinessDay(db,{actor:ACTOR,note:'ตัวอย่างตัดยอดรอบแรก · มีรอบใหม่สำหรับทดลองขายต่อ'});
 for(let i=0;i<catalog.length;i+=3){
  const batch=catalog.slice(i,i+3),method=(['เงินสด','QR / สแกน','หักบัญชีสมาชิก'] as const)[Math.floor(i/3)%3];
  const total=batch.reduce((sum,p)=>sum+p.price,0),discount=i%5===0?Math.min(5,Math.floor(total/10)):0;
  checkout(db,{items:batch.map(p=>({productId:p.id,qty:1})),paymentMethod:method,discount,
   ...(method==='เงินสด'?{receivedCash:total+100}:method==='QR / สแกน'?{paymentVerified:true}:{memberNumber:spender.memberNumber}),
   cashier:i%2===0?ACTOR:ACTOR_B,terminalDeviceId:i%2===0?posA:posB});
 }
 // A member still present with zero after a purchase; no card return.
 checkout(db,{items:[{name:'ตัวอย่างซื้อครบยอดเพื่อทดสอบยอดศูนย์',price:100,qty:1,unit:'รายการ'}],paymentMethod:'หักบัญชีสมาชิก',memberNumber:zero.memberNumber,cashier:ACTOR});
 walletTx(db,{memberNumber:withdrawn.memberNumber,type:'withdrawal',amount:30,actor:ACTOR,note:'ตัวอย่างยังอยู่ ยอดศูนย์'});
 for(const amount of [100,200,50])walletTx(db,{memberNumber:deposit.memberNumber,type:'deposit',amount,actor:ACTOR,note:'รายการเติมเงินจำลอง'});
 walletTx(db,{memberNumber:deposit.memberNumber,type:'withdrawal',amount:75,actor:ACTOR_B,note:'รายการถอนเงินจำลอง'});
 walletTx(db,{memberNumber:qrMember.memberNumber,type:'withdrawal',amount:100,actor:ACTOR_B,note:'ถอนเงินตัวอย่าง'});
 refundReturn(returnedZero.memberNumber,returnedZero.cardNumber!);refundReturn(returnedPaid.memberNumber,returnedPaid.cardNumber!);
 members.recycledCard=registerMember(db,{firstName:'ตัวอย่าง ผู้ถือบัตรเวียนคนใหม่',lastName:'ทดสอบเท่านั้น',cardNumber:returnedZero.cardNumber!,actor:ACTOR}).member.memberNumber;
 const replacementCard=cards[14];assignMemberCard(db,{memberNumber:replacement.memberNumber,cardNumber:replacementCard,expectedCardNumber:replacement.cardNumber!,expectedSessionId:session(replacement.memberNumber),actor:ACTOR});
 closeMemberAccount(db,{memberNumber:pending.memberNumber,cardNumber:pending.cardNumber!,expectedSessionId:session(pending.memberNumber),actor:ACTOR});
 closeMemberAccount(db,{memberNumber:returnedClosed.memberNumber,cardNumber:returnedClosed.cardNumber!,expectedSessionId:session(returnedClosed.memberNumber),actor:ACTOR});refundReturn(returnedClosed.memberNumber,returnedClosed.cardNumber!);
 const voided=checkout(db,{items:[{productId:first.id,qty:1}],paymentMethod:'หักบัญชีสมาชิก',memberNumber:spender.memberNumber,cashier:ACTOR_B});
 const sale=db.prepare('SELECT id FROM sales WHERE order_number=?').get(voided.orderNumber)!;voidSale(db,{saleId:Number(sale.id),reason:'ตัวอย่างยกเลิกบิลและคืนยอดสมาชิก',actor:ACTOR,actorRole:'admin'});
 const newProduct=createProduct(db,{sku:'DEMO-TX-NEW',name:'ตัวอย่าง สินค้าใหม่รับเข้าพร้อมของแถม',category:'ของใช้',unit:'ชิ้น',price:25,cost:15,actor:ACTOR});
 receiveStockLines(db,{productId:newProduct.id,lot:'DEMO-TX-NEW-1',lines:[{qty:8},{qty:2,cost:0}],paidAmount:120,actor:ACTOR});
 receiveStockLines(db,{productId:newProduct.id,lot:'DEMO-TX-NEW-2',lines:[{qty:3}],paidAmount:54,actor:ACTOR});
 updateProduct(db,{productId:newProduct.id,price:27,actor:ACTOR});stockCountLots(db,{counts:db.prepare('SELECT id,qty FROM stock_lots WHERE product_id=? AND qty>0 ORDER BY id').all(newProduct.id).map((lot,index)=>({lotId:Number(lot.id),countedQty:Number(lot.qty)-(index===0?2:0)})),note:'ตัวอย่างตรวจนับต่างจากระบบ',actor:ACTOR});
 const near=createProduct(db,{sku:'DEMO-TX-EXPIRY',name:'ตัวอย่าง สินค้าล็อตใกล้หมดอายุ',price:15,cost:9,reorderPoint:10,actor:ACTOR});
 receiveStockLines(db,{productId:near.id,lot:'DEMO-TX-EXPIRY',expiryDate:new Date(Date.now()+7*86400000).toISOString().slice(0,10),lines:[{qty:2}],paidAmount:18,actor:ACTOR});
 const empty=createProduct(db,{sku:'DEMO-TX-EMPTY',name:'ตัวอย่าง สินค้าคงเหลือศูนย์',price:10,cost:6,reorderPoint:10,actor:ACTOR});addOrderItem(db,{productId:empty.id,qty:12,note:'รายการสั่งซื้อจำลอง',actor:ACTOR});
 closeShift(db,{shiftId:shift.id,countedCash:getShiftById(db,shift.id)!.expectedCash,note:'ตัวอย่างปิดกะ เงินตรง'});
 const after=counts();const summary:TransactionScenarioSummary={date:formatDateTime().slice(0,10),catalogProductsSold:catalog.length,sales:after.sales-before.sales,walletTransactions:after.walletTransactions-before.walletTransactions,stockLots:after.stockLots-before.stockLots,members,replacementCard,scenarios:['เงินสดและเงินทอน','QR','หักบัญชีสมาชิก','ส่วนลด','เติมเงิน','ถอนเงิน','ซื้อจนยอดศูนย์แต่ยังอยู่','คืนบัตรยอดศูนย์','คืนเงินครบและคืนบัตร','บัตรเวียนผู้ถือใหม่','เปลี่ยนบัตร','ปิดรอบรอคืนบัตร','ปิดรอบและคืนบัตร','ยกเลิกบิลคืนสต๊อกและเงิน','รับเข้าและของแถม','ต้นทุนต่างรอบและปรับราคาขาย','ตรวจนับสต๊อก','ล็อตใกล้หมดอายุ','สต๊อกศูนย์และรายการสั่งซื้อ','ตัดยอดรอบขาย','เปิดและปิดกะ']};
 db.prepare('INSERT INTO store_settings(key,value) VALUES(?,?)').run(MARKER,JSON.stringify(summary));return summary;
}
