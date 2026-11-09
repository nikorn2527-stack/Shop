import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteStore, createProduct, listProducts, stockBalanceReport, registerMember, createBlankCards, assignMemberCard, releasePhysicalCard, memberBalances, type SqliteDb } from './sqliteStore';
const databases: SqliteDb[] = [];
const fresh = () => { const db=createSqliteStore(); databases.push(db); return db; };
afterEach(()=>{for(const db of databases.splice(0))db.close();});
describe('permanent product Item numbers',()=>{
 it('allocates distinct sequential Item numbers independently from barcode and product ID',()=>{
  const db=fresh();
  const a=createProduct(db,{name:'รายการแรก',sku:'Z',barcode:'99',price:5});
  const b=createProduct(db,{name:'รายการสอง',sku:'A',barcode:'01',price:8});
  expect(a).toHaveProperty('itemNumber',1);
  expect(b).toHaveProperty('itemNumber',2);
  expect(stockBalanceReport(db).map(row=>row.productId)).toEqual([a.id,b.id]);
  expect(stockBalanceReport(db).map(row=>(row as any).itemNumber)).toEqual([1,2]);
  expect(stockBalanceReport(db,{search:'รายการสอง'}).map(row=>(row as any).itemNumber)).toEqual([2]);
 });
 it('does not reuse an Item after deactivation or deletion, including raw import inserts',()=>{
  const db=fresh();const a=createProduct(db,{name:'แรก',price:3});
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(a.id);
  const b=createProduct(db,{name:'สอง',price:4});
  db.prepare('DELETE FROM products WHERE id=?').run(b.id);
  const raw=db.prepare("INSERT INTO products(sku,name,price) VALUES('RAW','นำเข้า',5)").run();
  expect(listProducts(db,true).find(p=>p.id===Number(raw.lastInsertRowid))).toHaveProperty('itemNumber',3);
  expect(listProducts(db,true).find(p=>p.id===a.id)).toHaveProperty('itemNumber',1);
 });
});
describe('current revolving card in member balances',()=>{
 it('reads the current holder, never a previous session, without changing money',()=>{
  const db=fresh();createBlankCards(db,['AUDIT-CARD']);
  const a=registerMember(db,{firstName:'ผู้ถือเดิม',lastName:'ทดสอบ'}).member;
  const b=registerMember(db,{firstName:'ผู้ถือใหม่',lastName:'ทดสอบ'}).member;
  assignMemberCard(db,{memberNumber:a.memberNumber,cardNumber:'AUDIT-CARD',expectedCardNumber:null});
  expect(memberBalances(db).find(row=>row.memberNumber===a.memberNumber)?.cardNumber).toBe('AUDIT-CARD');
  releasePhysicalCard(db,'AUDIT-CARD');
  assignMemberCard(db,{memberNumber:b.memberNumber,cardNumber:'AUDIT-CARD',expectedCardNumber:null});
  const rows=memberBalances(db);
  expect(rows.find(row=>row.memberNumber===a.memberNumber)?.cardNumber).toBeNull();
  expect(rows.find(row=>row.memberNumber===b.memberNumber)?.cardNumber).toBe('AUDIT-CARD');
  expect(rows.map(row=>row.balance)).toEqual([0,0]);
  expect(db.prepare('SELECT COUNT(*) AS n FROM member_transactions').get()?.n).toBe(0);
 });
});
