import {afterEach,describe,expect,it} from 'vitest';
import {createSqliteStore,createBlankCards,registerMember,memberTransactions,cardUsageHistory,type SqliteDb} from './sqliteStore';
const databases:SqliteDb[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
describe('member names in reports and historical transaction slips',()=>{
 it.each(['นาย','นาง','นางสาว','แพทย์หญิง',null,''])('includes the saved prefix %s without inventing one when absent',prename=>{
  const db=createSqliteStore();databases.push(db);createBlankCards(db,['NAME-CARD']);
  const member=registerMember(db,{...(prename!==null?{prename}:{}),firstName:'สมาชิก',lastName:'ทดสอบ',cardNumber:'NAME-CARD'}).member;
  for(const type of ['activation','deposit','withdrawal','refund','purchase'])db.prepare('INSERT INTO member_transactions(member_number,type,detail,amount,balance_after) VALUES(?,?,?,?,?)').run(member.memberNumber,type,'ตัวอย่างรายงาน',10,100);
  const before=db.prepare('SELECT * FROM member_transactions ORDER BY id').all();
  const expected=[prename,'สมาชิก','ทดสอบ'].filter(Boolean).join(' ');
  const rows=memberTransactions(db,{memberNumber:member.memberNumber});
  expect(rows).toHaveLength(5);
  expect(rows.map(row=>row.memberName)).toEqual(Array(5).fill(expected));
  expect(cardUsageHistory(db,'NAME-CARD').sessions[0].memberName).toBe(expected);
  expect(db.prepare('SELECT * FROM member_transactions ORDER BY id').all()).toEqual(before);
  expect(db.prepare('SELECT prename,first_name,last_name FROM members WHERE member_number=?').get(member.memberNumber)).toEqual({prename:prename||null,first_name:'สมาชิก',last_name:'ทดสอบ'});
 });
});
