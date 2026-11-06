import 'dotenv/config';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {prepareTransactionDemo} from '../server/demo/transactionWorkspace';

async function main(){
 const args=process.argv.slice(2),allowed=new Set(['--prepare','--rebuild','--port']);let port=3000;
 for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw Error('Usage: pnpm demo:transactions [--prepare] [--rebuild] [--port 3000]');if(args[i]==='--port'){port=Number(args[++i]);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid demo port');}}
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js 24 or newer is required');
 if(process.env.DEPLOYMENT_MODE?.trim().toLowerCase()==='cloud'||process.env.RAILWAY_ENVIRONMENT_ID||process.env.RAILWAY_PROJECT_ID)throw Error('This demonstration command is for Local only; refused in cloud/Railway');
 if(process.env.SHOP_DATABASE_PROVIDER&&process.env.SHOP_DATABASE_PROVIDER!=='sqlite')throw Error('Only the Local SQLite database is supported');
 if(!args.includes('--prepare')||args.includes('--rebuild'))await new Promise<void>((accept,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(Error(`Port ${port} is busy. Stop the Local app with Ctrl+C before starting the demonstration`)));probe.listen(port,'127.0.0.1',()=>probe.close(()=>accept()));});
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 console.log('กำลังเตรียมสำเนา Local และรายการจำลอง...');
 const demo=await prepareTransactionDemo(root,process.env.SQLITE_DB_PATH??'data/welfare-store.sqlite',{rebuild:args.includes('--rebuild')});
 console.log(`\nข้อมูลจำลองเท่านั้น — ฐานข้อมูล Local เดิมไม่ถูกแก้ไข\n${demo.reused?'ใช้ชุดจำลองเดิม ไม่เพิ่มรายการซ้ำ':'สร้างสำเนาและรายการตัวอย่างแล้ว'}\nสินค้าเดิมที่มีตัวอย่างขาย: ${demo.summary.catalogProductsSold} ชนิด\nบิล: ${demo.summary.sales} · เติม/ถอน/ซื้อ/คืนเงิน: ${demo.summary.walletTransactions} รายการ\nฐานข้อมูล: ${demo.databasePath}\nรายการกรณีทดสอบ: .transaction-demo/SCENARIOS.md\nเข้าสู่ระบบด้วยบัญชีและรหัสผ่าน Local เดิม\n`);
 if(args.includes('--prepare'))return;
 console.log(`เปิด http://127.0.0.1:${port}/ — หยุดด้วย Ctrl+C แล้วใช้ pnpm dev เพื่อกลับข้อมูลเดิม\n`);
 const child=spawn(process.execPath,[resolve(root,'node_modules/tsx/dist/cli.mjs'),'watch',resolve(root,'server/_core/index.ts')],{cwd:root,stdio:'inherit',env:{...process.env,NODE_ENV:'development',DEPLOYMENT_MODE:'development',CLOUD_PROVIDER:'',SHOP_DATABASE_PROVIDER:'sqlite',DATABASE_URL:'',SQLITE_DB_PATH:demo.databasePath,SQLITE_BACKUP_DIR:resolve(root,'.transaction-demo/backups'),SEED_DEMO_DATA:'0',SHOP_RELEASE_CHANNEL:'legacy',HTTPS:'0',PORT:String(port),JWT_SECRET:demo.secret}});
 process.once('SIGINT',()=>child.kill('SIGINT'));process.once('SIGTERM',()=>child.kill('SIGTERM'));
 await new Promise<void>((accept,reject)=>{child.once('error',reject);child.once('close',code=>{process.exitCode=code??0;accept();});});
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Local demonstration failed');process.exitCode=1;});
