import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,readFileSync,existsSync,writeFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {createSqliteStore,createProduct,createAppUser} from '../sqliteStore';
import {prepareTransactionDemo} from './transactionWorkspace';
const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
function fixture(){const root=mkdtempSync(join(tmpdir(),'shop-demo-'));roots.push(root);mkdirSync(join(root,'data'));const source=join(root,'data','welfare-store.sqlite');const db=createSqliteStore(source);createProduct(db,{name:'สินค้าของ Local',price:20,cost:12,stock:5});createAppUser(db,{username:'owner',password:'OriginalLocal123!',displayName:'ผู้ดูแลเดิม',role:'admin'});db.close();return {root,source};}
describe('isolated demo file preparation',()=>{
 it('copies Local without changing source bytes or credentials and reuses the same seeded demo on rerun',async()=>{
  const {root,source}=fixture(),before=hash(source);const demo=await prepareTransactionDemo(root,source);
  expect(hash(source)).toBe(before);expect(demo.databasePath).toBe(join(root,'.transaction-demo','store.sqlite'));expect(demo.summary.sales).toBeGreaterThan(0);
  const a=createSqliteStore(source),b=createSqliteStore(demo.databasePath);try{expect(b.prepare('SELECT * FROM app_users').all()).toEqual(a.prepare('SELECT * FROM app_users').all());}finally{a.close();b.close();}
  const counts=demo.summary;expect((await prepareTransactionDemo(root,source)).summary).toEqual(counts);expect(hash(source)).toBe(before);
 });
 it('rebuilds only the marked demo and keeps a verified backup of its prior state',async()=>{
  const {root,source}=fixture();const before=hash(source);await prepareTransactionDemo(root,source);
  const rebuilt=await prepareTransactionDemo(root,source,{rebuild:true});expect(rebuilt.reused).toBe(false);expect(hash(source)).toBe(before);
  const files=readdirSync(join(root,'.transaction-demo','backups'));expect(files.some(name=>name.startsWith('demo-before-rebuild-'))).toBe(true);
 });
 it('refuses an existing unmarked destination instead of overwriting it',async()=>{
  const {root,source}=fixture();mkdirSync(join(root,'.transaction-demo'));const target=join(root,'.transaction-demo','store.sqlite');writeFileSync(target,'DO NOT OVERWRITE');
  await expect(prepareTransactionDemo(root,source)).rejects.toThrow(/unmarked/i);expect(readFileSync(target,'utf8')).toBe('DO NOT OVERWRITE');
 });
 it('refuses external source paths and missing source files',async()=>{
  const {root,source}=fixture();await expect(prepareTransactionDemo(root,join(root,'data','missing.sqlite'))).rejects.toThrow(/Local database/i);
  await expect(prepareTransactionDemo(root,join(root,'..','outside.sqlite'))).rejects.toThrow(/inside/i);expect(existsSync(join(root,'.transaction-demo','store.sqlite'))).toBe(false);expect(existsSync(source)).toBe(true);
 });
});
