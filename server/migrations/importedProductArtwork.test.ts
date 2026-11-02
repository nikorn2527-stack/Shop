import { describe, expect, it, vi } from 'vitest';
import { createSqliteStore } from '../sqliteStore';
import { repairImportedProductArtwork } from './importedProductArtwork';

function fixture() {
 const db=createSqliteStore();
 db.exec("CREATE TABLE opening_import_rows (entity_type TEXT,entity_key TEXT,source_file TEXT,source_row INTEGER,source_json TEXT,imported_at TEXT)");
 const add=db.prepare('INSERT INTO products (id,sku,name,category,unit,price,cost,stock,emoji,image_url) VALUES (?,?,?,\'ของใช้\',\'ชิ้น\',5,3,17,?,?)');
 add.run(1,'02','แสตมป์','📦',null);add.run(2,'01','ซองจดหมาย','⭐',null);add.run(3,'05','ชุดแก้วกาแฟ','📦','data:image/png;base64,YWJj');add.run(4,'OTHER','กล่องที่เลือกเอง','📦',null);
 for(const id of [1,2,3])db.prepare('INSERT INTO opening_import_rows VALUES (\'product\',?,\'source.xlsx\',1,\'{}\',\'2026-11-02\')').run(String(id));
 return db;
}
describe('opening import artwork repair',()=>{
 it('restores automatic artwork only for imported generic boxes, with business values unchanged',()=>{
  const db=fixture();try{
   const before=db.prepare('SELECT id,stock,price,cost FROM products').all();
   const backup=vi.fn(()=> 'safety.sqlite');
   expect(repairImportedProductArtwork(db,{now:'2026-11-02 09:00:00',backup})).toMatchObject({changed:1});
   expect(backup).toHaveBeenCalledOnce();
   expect(db.prepare('SELECT emoji FROM products ORDER BY id').all().map(x=>x.emoji)).toEqual([null,'⭐','📦','📦']);
   expect(db.prepare('SELECT id,stock,price,cost FROM products').all()).toEqual(before);
   db.prepare('UPDATE products SET emoji=\'📦\' WHERE id=1').run();
   expect(repairImportedProductArtwork(db,{now:'2026-11-02 10:00:00',backup})).toMatchObject({changed:0});
   expect(db.prepare('SELECT emoji FROM products WHERE id=1').get()?.emoji).toBe('📦');
   expect(backup).toHaveBeenCalledOnce();
  }finally{db.close()}
 });
 it('does not touch an unrelated database or write a marker',()=>{
  const db=createSqliteStore();try{const before=db.prepare('SELECT COUNT(*) AS n FROM store_settings').get();expect(repairImportedProductArtwork(db,{now:'now'})).toMatchObject({changed:0});expect(db.prepare('SELECT COUNT(*) AS n FROM store_settings').get()).toEqual(before);}finally{db.close()}
 });
 it('does not modify icons when the safety backup fails',()=>{
  const db=fixture();try{expect(()=>repairImportedProductArtwork(db,{now:'now',backup:()=>{throw Error('backup failed')}})).toThrow('backup failed');expect(db.prepare('SELECT emoji FROM products WHERE id=1').get()?.emoji).toBe('📦');}finally{db.close()}
 });
 it('rolls back both artwork and marker if audit recording fails',()=>{
  const db=fixture();try{
   db.exec("CREATE TRIGGER fail_artwork_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit failed');END");
   expect(()=>repairImportedProductArtwork(db,{now:'now'})).toThrow('audit failed');
   expect(db.prepare('SELECT emoji FROM products WHERE id=1').get()?.emoji).toBe('📦');
   expect(db.prepare("SELECT 1 FROM store_settings WHERE key='migration_opening_artwork_v1'").get()).toBeUndefined();
  }finally{db.close()}
 });
});
