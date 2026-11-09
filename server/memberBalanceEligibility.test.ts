import { afterEach, describe, expect, it } from 'vitest';
import {createSqliteStore,createBlankCards,registerMember,memberBalances,returnMemberCard,assignMemberCard,releasePhysicalCard,closeMemberAccount,getMemberDetail,walletTx,type SqliteDb} from './sqliteStore';
const databases:SqliteDb[]=[];
const fresh=()=>{const db=createSqliteStore();databases.push(db);return db;};
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
const session=(db:SqliteDb,n:string)=>Number(db.prepare('SELECT id FROM card_usage_sessions WHERE member_number=? AND ended_at IS NULL').get(n)!.id);
const numbers=(db:SqliteDb)=>memberBalances(db).map(row=>row.memberNumber);
const member=(db:SqliteDb,card:string,initialDeposit=0)=>{createBlankCards(db,[card]);return registerMember(db,{firstName:'ทดสอบ',lastName:card,cardNumber:card,...(initialDeposit>0?{initialDeposit}:{})}).member;};
describe('current-member balance report eligibility',()=>{
 it('includes zero-balance current members and never-issued members',()=>{
  const db=fresh(),a=member(db,'STAY-0'),b=registerMember(db,{firstName:'ยังไม่ได้รับบัตร',lastName:'ทดสอบ'}).member;
  expect(numbers(db)).toEqual([a.memberNumber,b.memberNumber]);
 });
 it('hides an explicit zero-balance return and leaves the member and history intact',()=>{
  const db=fresh(),a=member(db,'OUT-0');
  returnMemberCard(db,{memberNumber:a.memberNumber,cardNumber:'OUT-0',expectedSessionId:session(db,a.memberNumber),mode:'refund'});
  expect(numbers(db)).not.toContain(a.memberNumber);
  expect(getMemberDetail(db,a.memberNumber)?.member.balance).toBe(0);
  expect(db.prepare('SELECT COUNT(*) AS n FROM card_assignments WHERE member_number=?').get(a.memberNumber)?.n).toBe(2);
  expect(memberBalances(db,{search:a.memberNumber})).toEqual([]);
 });
 it('hides a full refund with returned card but preserves the ledger and allows later re-enrolment',()=>{
  const db=fresh(),a=member(db,'OUT-PAID',100);
  returnMemberCard(db,{memberNumber:a.memberNumber,cardNumber:'OUT-PAID',expectedSessionId:session(db,a.memberNumber),mode:'refund'});
  const ledger=db.prepare('SELECT * FROM member_transactions').all();
  expect(numbers(db)).not.toContain(a.memberNumber);
  expect(db.prepare('SELECT * FROM member_transactions').all()).toEqual(ledger);
  createBlankCards(db,['REJOIN']);assignMemberCard(db,{memberNumber:a.memberNumber,cardNumber:'REJOIN',expectedCardNumber:null});
  expect(memberBalances(db).find(row=>row.memberNumber===a.memberNumber)).toMatchObject({cardNumber:'REJOIN',balance:0});
 });
 it('does not mistake card replacement or a generic release for departure',()=>{
  const db=fresh(),a=member(db,'OLD');createBlankCards(db,['NEW']);
  assignMemberCard(db,{memberNumber:a.memberNumber,cardNumber:'NEW',expectedCardNumber:'OLD',expectedSessionId:session(db,a.memberNumber)});
  expect(numbers(db)).toContain(a.memberNumber);
  releasePhysicalCard(db,'NEW');expect(numbers(db)).toContain(a.memberNumber);
 });
 it('hides a closed account only once its card is returned, without hiding the new card holder',()=>{
  const db=fresh(),a=member(db,'CLOSED');closeMemberAccount(db,{memberNumber:a.memberNumber,cardNumber:'CLOSED',expectedSessionId:session(db,a.memberNumber)});
  expect(numbers(db)).toContain(a.memberNumber);
  releasePhysicalCard(db,'CLOSED');expect(numbers(db)).not.toContain(a.memberNumber);
  const b=registerMember(db,{firstName:'ผู้ถือใหม่',lastName:'ทดสอบ',cardNumber:'CLOSED'}).member;
  expect(memberBalances(db).find(row=>row.memberNumber===b.memberNumber)).toMatchObject({cardNumber:'CLOSED',balance:0});
 });
 it('keeps an ordinary withdrawal to zero visible',()=>{
  const db=fresh(),a=member(db,'STILL-HERE',20);walletTx(db,{memberNumber:a.memberNumber,type:'withdrawal',amount:20});expect(numbers(db)).toContain(a.memberNumber);
 });
});
