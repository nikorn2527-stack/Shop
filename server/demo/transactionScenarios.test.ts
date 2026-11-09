import {afterEach,describe,expect,it} from 'vitest';
import {createSqliteStore,createProduct,registerMember,createAppUser,memberBalances,type SqliteDb} from '../sqliteStore';
import {seedTransactionScenarios} from './transactionScenarios';
const databases:SqliteDb[]=[];
const fresh=()=>{const db=createSqliteStore();databases.push(db);return db;};
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
describe('isolated transaction demonstration scenarios',()=>{
 it('refuses an unmarked database without changing business data',()=>{
  const db=fresh();createProduct(db,{name:'ต้นฉบับ',price:20,stock:10});const before=db.prepare('SELECT * FROM products').all();
  expect(()=>seedTransactionScenarios(db)).toThrow(/isolated/i);expect(db.prepare('SELECT * FROM products').all()).toEqual(before);
 });
 it('covers payments, inventory and revolving-card cases without modifying original members or accounts, and never duplicates on rerun',()=>{
  const db=fresh();createProduct(db,{name:'สินค้าเดิม',price:20,cost:12,stock:10});createProduct(db,{name:'สินค้าเดิมสอง',price:15,cost:8,stock:3});
  registerMember(db,{firstName:'สมาชิกเดิม',lastName:'ห้ามแก้',initialDeposit:50});createAppUser(db,{username:'original.admin',password:'Original123!Safe',displayName:'ผู้ดูแลเดิม',role:'admin'});
  const members=db.prepare('SELECT * FROM members').all(),accounts=db.prepare('SELECT * FROM app_users').all();
  db.prepare("INSERT INTO store_settings(key,value) VALUES('transaction_demo_workspace','1')").run();
  const summary=seedTransactionScenarios(db);
  expect(db.prepare('SELECT * FROM members WHERE id=1').all()).toEqual(members);expect(db.prepare('SELECT * FROM app_users').all()).toEqual(accounts);
  const paymentMethods=db.prepare('SELECT DISTINCT payment_method AS method FROM sales WHERE voided=0').all().map(row=>row.method);
  expect(paymentMethods).toEqual(expect.arrayContaining(['เงินสด','QR / สแกน','หักบัญชีสมาชิก']));
  const types=db.prepare('SELECT DISTINCT type FROM member_transactions').all().map(row=>row.type);expect(types).toEqual(expect.arrayContaining(['activation','deposit','withdrawal','purchase','refund']));
  expect(db.prepare('SELECT COUNT(*) AS n FROM sales WHERE voided=1').get()?.n).toBeGreaterThan(0);
  expect(db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()?.n).toBeGreaterThan(0);
  expect(db.prepare('SELECT COUNT(*) AS n FROM day_closures').get()?.n).toBeGreaterThan(0);
  const rows=memberBalances(db);expect(rows.find(r=>r.memberNumber===summary.members.zeroStaying)?.balance).toBe(0);
  expect(rows.some(r=>r.memberNumber===summary.members.returnedZero)).toBe(false);expect(rows.some(r=>r.memberNumber===summary.members.returnedPaid)).toBe(false);
  expect(rows.find(r=>r.memberNumber===summary.members.replacement)?.cardNumber).toBe(summary.replacementCard);
  const counts=db.prepare('SELECT (SELECT COUNT(*) FROM sales) AS sales,(SELECT COUNT(*) FROM member_transactions) AS tx,(SELECT COUNT(*) FROM stock_lots) AS lots').get();
  expect(seedTransactionScenarios(db)).toEqual(summary);expect(db.prepare('SELECT (SELECT COUNT(*) FROM sales) AS sales,(SELECT COUNT(*) FROM member_transactions) AS tx,(SELECT COUNT(*) FROM stock_lots) AS lots').get()).toEqual(counts);
 });
});
