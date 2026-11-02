import { describe,expect,it,vi } from 'vitest';
import { createSqliteStore,createBlankCards,assignMemberCard } from '../sqliteStore';
import { confirmImportedOpeningBalance, openingBalanceCorrectionStatus } from './confirmedOpeningBalance';
const batch='2026-11-02 07:10:52';
function fixture(){
 const db=createSqliteStore();
 db.exec('CREATE TABLE opening_import_rows(entity_type TEXT,entity_key TEXT,source_file TEXT,source_row INTEGER,source_json TEXT,imported_at TEXT)');
 db.prepare("INSERT INTO members(member_number,first_name,last_name,balance,status) VALUES ('TEST','Test','Member',0,'active')").run();
 db.prepare("INSERT INTO members(member_number,first_name,last_name,balance,status) VALUES ('OTHER','Other','Member',200,'active')").run();
 createBlankCards(db,['1234567890']);assignMemberCard(db,{memberNumber:'TEST',cardNumber:'1234567890',expectedCardNumber:null});
 db.prepare('INSERT INTO opening_import_rows VALUES (?,?,?,?,?,?)').run('member','TEST','ทะเบียนเงินรับฝากผู้ป่วย.xlsx',100,JSON.stringify({balance:'0',balance_provisional:true,card_number:'1234567890'}),batch);
 return db;
}
describe('confirmed imported opening balance',()=>{
 it('corrects the confirmed provisional zero once without a deposit or modifying other balances',()=>{
  const db=fixture();try{const backup=vi.fn(()=> 'safety.sqlite');expect(confirmImportedOpeningBalance(db,{now:'now',backup})).toMatchObject({status:'applied',delta:500});
   expect(db.prepare("SELECT balance FROM members WHERE member_number='TEST'").get()?.balance).toBe(500);
   expect(db.prepare("SELECT opening_balance FROM card_usage_sessions WHERE member_number='TEST'").get()?.opening_balance).toBe(500);
   expect(db.prepare("SELECT balance FROM members WHERE member_number='OTHER'").get()?.balance).toBe(200);
   expect(db.prepare('SELECT COUNT(*) AS n FROM member_transactions').get()?.n).toBe(0);
   expect(confirmImportedOpeningBalance(db,{now:'later',backup})).toMatchObject({status:'applied',delta:0});expect(backup).toHaveBeenCalledOnce();expect(openingBalanceCorrectionStatus(db)).toBe('applied');
  }finally{db.close()}
 });
 it('stops if this member already has a transaction',()=>{
  const db=fixture();try{db.prepare("INSERT INTO member_transactions(member_number,type,detail,amount,payment_method,balance_after) VALUES ('TEST','deposit','Real deposit',100,'เงินสด',100)").run();db.exec("UPDATE members SET balance=100 WHERE member_number='TEST'");expect(confirmImportedOpeningBalance(db,{now:'now'}).status).toBe('needs_review');expect(db.prepare("SELECT balance FROM members WHERE member_number='TEST'").get()?.balance).toBe(100);expect(db.prepare('SELECT COUNT(*) AS n FROM member_transactions').get()?.n).toBe(1);}finally{db.close()}
 });
 it('rechecks inside the lock after backup in case activity occurred meanwhile',()=>{
  const db=fixture();try{const backup=()=>{db.exec("UPDATE members SET balance=10 WHERE member_number='TEST'");return 'backup.sqlite'};expect(confirmImportedOpeningBalance(db,{now:'now',backup}).status).toBe('needs_review');expect(db.prepare("SELECT balance FROM members WHERE member_number='TEST'").get()?.balance).toBe(10);}finally{db.close()}
 });
 it('does not apply twice if another startup finishes during backup',()=>{
  const db=fixture();try{const backup=()=>{confirmImportedOpeningBalance(db,{now:'other startup'});return 'safety.sqlite'};expect(confirmImportedOpeningBalance(db,{now:'now',backup})).toMatchObject({status:'applied',delta:0});expect(db.prepare("SELECT balance FROM members WHERE member_number='TEST'").get()?.balance).toBe(500);}finally{db.close()}
 });
 it('does not alter another import batch or an unrelated database',()=>{
  const db=fixture();try{db.exec("UPDATE opening_import_rows SET imported_at='another batch'");expect(confirmImportedOpeningBalance(db,{now:'now'}).status).toBe('not_applicable');expect(openingBalanceCorrectionStatus(db)).toBe('not_applicable');}finally{db.close()}
 });
 it('does not credit a closed account or a returned card',()=>{
  const db=fixture();try{db.exec("UPDATE members SET account_closed=1 WHERE member_number='TEST'");expect(confirmImportedOpeningBalance(db,{now:'now'}).status).toBe('needs_review');expect(db.prepare("SELECT balance FROM members WHERE member_number='TEST'").get()?.balance).toBe(0);}finally{db.close()}
 });
 it('rolls back on audit failure and does not modify money when backup fails',()=>{
  const db=fixture();try{expect(()=>confirmImportedOpeningBalance(db,{now:'now',backup:()=>{throw Error('backup failed')}})).toThrow('backup failed');db.exec("CREATE TRIGGER fail_confirmation BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failed');END");expect(()=>confirmImportedOpeningBalance(db,{now:'now'})).toThrow('audit failed');expect(db.prepare("SELECT balance FROM members WHERE member_number='TEST'").get()?.balance).toBe(0);expect(openingBalanceCorrectionStatus(db)).toBe('not_applicable');}finally{db.close()}
 });
});
