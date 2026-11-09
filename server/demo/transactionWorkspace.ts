import {createRequire} from 'node:module';
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createSqliteStore} from '../sqliteStore';
import {seedTransactionScenarios,type TransactionScenarioSummary} from './transactionScenarios';
const {DatabaseSync,backup}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const PURPOSE='shop-local-transaction-demo';
type Config={purpose:string;version:number;source:string;secret:string;summary:TransactionScenarioSummary};
function unlinked(path:string){if(existsSync(path)&&(lstatSync(path).isSymbolicLink()||(!lstatSync(path).isDirectory()&&lstatSync(path).nlink!==1)))throw Error('Linked demo paths are not supported');}
function inside(root:string,path:string){const rel=relative(root,path);return rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel);}
export async function prepareTransactionDemo(projectRoot:string,sourcePath:string,options:{rebuild?:boolean}={}){
 const root=resolve(projectRoot),source=resolve(root,sourcePath),work=join(root,'.transaction-demo'),databasePath=join(work,'store.sqlite'),configPath=join(work,'config.json');
 if(!inside(root,source)||inside(work,source)||source===databasePath)throw Error('Source must be a Local database inside the project, outside the demo workspace');
 for(const path of [root,source,join(root,'data'),work,databasePath,configPath,databasePath+'-wal',databasePath+'-shm',join(work,'backups')])unlinked(path);
 if(!existsSync(source)||!lstatSync(source).isFile())throw Error('Local database not found. Restore your Local backup before preparing examples');
 let config:Config|undefined;
 if(existsSync(configPath)){
  config=JSON.parse(readFileSync(configPath,'utf8')) as Config;
  if(config.purpose!==PURPOSE||config.version!==1||config.source!==source||typeof config.secret!=='string'||config.secret.length<32)throw Error('Invalid demo workspace marker; no files changed');
 }
 if(existsSync(databasePath)&&!config)throw Error('An unmarked demo destination exists; nothing was overwritten');
 if(existsSync(databasePath)&&!options.rebuild){
  const db=new DatabaseSync(databasePath,{readOnly:true});try{const row=db.prepare("SELECT value FROM store_settings WHERE key='transaction_demo_scenarios_v1'").get() as {value:string}|undefined;if(!row)throw Error('Incomplete demo database; use --rebuild to create a fresh isolated copy');return {databasePath,secret:config!.secret,summary:JSON.parse(row.value) as TransactionScenarioSummary,reused:true};}finally{db.close();}
 }
 mkdirSync(work,{recursive:true,mode:0o700});mkdirSync(join(work,'backups'),{recursive:true,mode:0o700});
 const staging=join(work,`staging-${randomUUID()}.sqlite`),previousBackupDir=process.env.SQLITE_BACKUP_DIR;
 try{
  const original=new DatabaseSync(source,{readOnly:true});try{
   if(Object.values(original.prepare('PRAGMA quick_check').get()!)[0]!=='ok')throw Error('Local database integrity check failed');
   if(!Number(original.prepare('SELECT COUNT(*) AS n FROM app_users WHERE active=1').get()!.n))throw Error('Create the Local administrator before preparing examples; no account will be created automatically');
   await backup(original,staging);
  }finally{original.close();}
  process.env.SQLITE_BACKUP_DIR=join(work,'backups');const demo=createSqliteStore(staging);
  let summary:TransactionScenarioSummary;
  try{
   demo.prepare("INSERT OR REPLACE INTO store_settings(key,value) VALUES('transaction_demo_workspace','1')").run();
   summary=seedTransactionScenarios(demo);
   demo.prepare('DELETE FROM app_sessions').run(); // Separate copied sessions; credentials stay identical.
   if(Object.values(demo.prepare('PRAGMA quick_check').get()!)[0]!=='ok')throw Error('Demonstration integrity check failed');
   demo.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }finally{demo.close();}
  if(existsSync(databasePath)){
   const old=new DatabaseSync(databasePath,{readOnly:true});try{await backup(old,join(work,'backups',`demo-before-rebuild-${Date.now()}.sqlite`));}finally{old.close();}
   for(const suffix of ['', '-wal','-shm'])rmSync(databasePath+suffix,{force:true});
  }
  renameSync(staging,databasePath);
  const next:Config={purpose:PURPOSE,version:1,source,secret:config?.secret??randomBytes(48).toString('hex'),summary};
  writeFileSync(configPath,JSON.stringify(next,null,2),{mode:0o600});
  writeFileSync(join(work,'summary.json'),JSON.stringify(summary,null,2),{mode:0o600});
  writeFileSync(join(work,'SCENARIOS.md'),`# ข้อมูลธุรกรรมจำลอง ${summary.date}\n\nต้นฉบับ: ${source}\nฐานข้อมูลจำลอง: ${databasePath}\nใช้บัญชีและรหัสผ่าน Local เดิม · ไม่มีการเปลี่ยนบัญชีหรือรหัสผ่าน\n\nขายสินค้าเดิม ${summary.catalogProductsSold} ชนิด · บิล ${summary.sales} ใบ · รายการกระเป๋าเงิน ${summary.walletTransactions} รายการ · ล็อตเพิ่ม ${summary.stockLots} ล็อต\n\n${summary.scenarios.map(s=>'- '+s).join('\n')}\n\n## สมาชิกตัวอย่าง\n${Object.entries(summary.members).map(([key,number])=>'- '+key+': '+number).join('\n')}\n\n## ผลที่ควรได้ในรายงานยอดเงิน\n- ยังอยู่ ยอด 0 ต้องแสดง: ${summary.members.zeroStaying}\n- ถอนเหลือ 0 แต่ยังอยู่ ต้องแสดง: ${summary.members.withdrawnZero}\n- คืนบัตรยอด 0 ต้องซ่อน: ${summary.members.returnedZero}\n- คืนเงินครบและคืนบัตร ต้องซ่อน: ${summary.members.returnedPaid}\n- ปิดรอบและคืนบัตร ต้องซ่อน: ${summary.members.returnedClosed}\n- เปลี่ยนบัตร ต้องแสดงบัตรล่าสุด ${summary.replacementCard} ของสมาชิก ${summary.members.replacement}\n- ยังไม่มีบัตร ต้องแสดงขีดแทนเลขบัตร: ${summary.members.noCard}\n\nค้นหาคำว่า “ตัวอย่าง” ในหน้าสมาชิกเพื่อดูเฉพาะกรณีจำลอง\nเมื่อต้องการกลับข้อมูลเดิม: หยุดคำสั่งจำลองแล้วใช้ pnpm dev ตามเดิม\n`,{mode:0o600});
  return {databasePath,secret:next.secret,summary,reused:false};
 }finally{
  if(previousBackupDir===undefined)delete process.env.SQLITE_BACKUP_DIR;else process.env.SQLITE_BACKUP_DIR=previousBackupDir;
  for(const suffix of ['', '-wal','-shm'])rmSync(staging+suffix,{force:true});
 }
}
