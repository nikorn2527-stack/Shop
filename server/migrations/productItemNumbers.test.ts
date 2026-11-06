import { createRequire } from 'node:module';
import type { SqliteDb } from '../sqliteStore';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { describe, expect, it, vi } from 'vitest';
import { initializeProductItemNumbers } from './productItemNumbers';

function legacy() {
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE products(id INTEGER PRIMARY KEY,sku TEXT,barcode TEXT,name TEXT,stock INTEGER,cost REAL,price REAL,active INTEGER);
 CREATE TABLE opening_import_rows(entity_type TEXT,entity_key TEXT,source_file TEXT,source_row INTEGER,imported_at TEXT);
 CREATE TABLE audit_logs(action TEXT,actor TEXT,actor_role TEXT,detail TEXT,tone TEXT,created_at TEXT);
 CREATE TABLE sales(id INTEGER,total REAL,product_id INTEGER);
 CREATE TABLE members(id INTEGER,balance REAL,card_number TEXT);
 INSERT INTO products VALUES(9,'02','02','แสตมป์',15,3,4,1),(2,'01','01','ซองจดหมาย',9,1,2,0),(20,'NEW','00','สินค้าเพิ่มหลังเปิดระบบ',10,5,8,1);
 INSERT INTO sales VALUES(1,20,9); INSERT INTO members VALUES(1,500,'CARD-A');`);
 const imported=db.prepare("INSERT INTO opening_import_rows VALUES('product',?,'ทะเบียนคุมสินค้า ณ 30 ต.ค 69.xlsx',?,'2026-11-02 07:10:52')");
 imported.run('9',88); imported.run('2',89);
 return db;
}
const business = (db:SqliteDb) => ({
 products:db.prepare('SELECT id,sku,barcode,name,stock,cost,price,active FROM products ORDER BY id').all(),
 sales:db.prepare('SELECT * FROM sales').all(),members:db.prepare('SELECT * FROM members').all(),
 opening:db.prepare('SELECT * FROM opening_import_rows').all(),
});
describe('safe legacy Item migration',()=>{
 it('uses document order including inactive products, appends live additions, and preserves business values',()=>{
  const db=legacy();try{
   const before=business(db);const backup=vi.fn(()=> 'before-items.sqlite');
   expect(initializeProductItemNumbers(db,{now:'2026-11-06',backup})).toMatchObject({changed:3});
   expect(backup).toHaveBeenCalledOnce();expect(business(db)).toEqual(before);
   expect(db.prepare('SELECT id,item_number FROM products ORDER BY item_number').all()).toEqual([{id:9,item_number:1},{id:2,item_number:2},{id:20,item_number:3}]);
   db.prepare('UPDATE opening_import_rows SET source_row=1 WHERE entity_key=?').run('2');
   expect(initializeProductItemNumbers(db,{now:'later',backup})).toMatchObject({changed:0});
   expect(backup).toHaveBeenCalledOnce();
   expect(db.prepare('SELECT id FROM products ORDER BY item_number').all()).toEqual([{id:9},{id:2},{id:20}]);
   db.prepare('DELETE FROM products WHERE id=20').run();
   db.prepare("INSERT INTO products(id,sku,name) VALUES(30,'NEXT','ใหม่')").run();
   expect(db.prepare('SELECT item_number FROM products WHERE id=30').get()?.item_number).toBe(4);
  }finally{db.close()}
 });
 it('uses document barcode order on older Local data without opening-import metadata',()=>{
  const db=legacy();try{
   db.exec('DROP TABLE opening_import_rows');
   initializeProductItemNumbers(db,{now:'now'});
   // Barcode 02 occurs before 01 in the source order and precedes 01, despite product IDs.
   expect(db.prepare('SELECT id FROM products ORDER BY item_number').all()).toEqual([{id:9},{id:2},{id:20}]);
  }finally{db.close()}
 });
 it('makes no schema or data changes if the backup fails',()=>{
  const db=legacy();try{const before=business(db);expect(()=>initializeProductItemNumbers(db,{now:'now',backup:()=>{throw Error('backup failed')}})).toThrow('backup failed');expect(business(db)).toEqual(before);expect(db.prepare('PRAGMA table_info(products)').all().some(c=>c.name==='item_number')).toBe(false);}finally{db.close()}
 });
 it('rolls back schema, numbers and allocator when audit recording fails',()=>{
  const db=legacy();try{
   const before=business(db);db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failed');END");
   expect(()=>initializeProductItemNumbers(db,{now:'now'})).toThrow('audit failed');expect(business(db)).toEqual(before);
   expect(db.prepare('PRAGMA table_info(products)').all().some(c=>c.name==='item_number')).toBe(false);
   expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='product_item_sequence'").get()).toBeUndefined();
  }finally{db.close()}
 });
});
