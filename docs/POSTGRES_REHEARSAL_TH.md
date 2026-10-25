# ซ้อมเตรียมข้อมูล PostgreSQL จาก SQLite snapshot

วันที่: 25 ตุลาคม 2569 (Asia/Bangkok)

## สถานะที่ต้องทราบก่อน

**Shop ยังรันด้วย SQLite ยังเปิดแอปทั้งระบบบน PostgreSQL ไม่ได้** ชุดนี้เพิ่ม schema และเครื่องมือสร้าง SQL สำหรับซ้อมนำเข้า 25 ตาราง ไม่ได้เปลี่ยน provider หรือติดตั้ง PostgreSQL ให้เครื่อง Windows

ส่วนที่ทำแล้วในชุดนี้:

- schema PostgreSQL ครอบคลุมคอลัมน์ปัจจุบันทั้ง 25 ตาราง รวม auth/session/สิทธิ์ บัตรและรอบบัตร ขาย รับเข้า FIFO ต้นทุน เงินสมาชิก รายงาน และประวัติระบบ
- เงินเป็น `numeric(20,2)`, ราคาต่อหน่วย/ต้นทุนเป็น `numeric(24,10)`, จำนวนเต็มและสตางค์เป็น `bigint`, รหัสและ JSON เดิมเป็น text, เหตุการณ์เป็น `timestamptz`, วันหมดอายุเป็น `date`
- การแปลง timestamp ที่ไม่มีเขตเวลาใช้ Asia/Bangkok ตามกฎของแอป เก็บ timestamp ที่มีเขตเวลาและทศนิยมวินาทีไว้ ไม่ปัดทิ้ง
- snapshot อ่านอย่างเดียว ไม่รัน migrations/seed ของ Shop กับต้นทาง ไม่ล้างข้อมูล ไม่เขียนทับ SQL ที่มีอยู่
- รักษา ID ศูนย์นำหน้า ค่า NULL ที่ไม่ทราบต้นทุน และ hash รหัสผ่าน; ตั้ง identity sequence หลัง ID สูงสุด
- นำเข้าภายใน transaction เดียว, ตรวจจำนวนแถว/ยอดรวมทุกคอลัมน์ตัวเลข, ตรวจ FK และ unique request ID ก่อน commit; ติดตั้ง trigger รอบบัตรหลังนำเข้าประวัติเพื่อไม่สร้างรายการซ้ำ
- หยุดหากชนิดข้อมูลไม่ตรง รูปแบบวันผิด ทศนิยมเกินขอบเขต schema เปลี่ยน มี view/trigger ที่ไม่รองรับ request ID ซ้ำ หรือต้นทางมี WAL ที่ยังใช้งาน
- ไฟล์ SQL ใช้ได้เฉพาะฐานชื่อขึ้นต้น `shop_pg_rehearsal_` และจะหยุดถ้ามี schema `shop` อยู่แล้ว ไม่ใช้ DROP/TRUNCATE หรือแก้ schema เดิม

ยังไม่ได้ยืนยัน SQL/trigger/constraint/sequence นี้กับ PostgreSQL server จริง Environment ไม่มี driver/server และ network policy ไม่อนุญาตดาวน์โหลด ผล unit tests จึงยืนยันเฉพาะการสร้างชุดย้าย/ตรวจค่าและการรักษาต้นทาง ไม่ใช่ผลนำเข้า PostgreSQL หรือ Windows

## สร้าง SQL จาก snapshot ทดสอบ

ใช้ไฟล์ snapshot ที่สร้างและตรวจผ่านด้วย `backup:sqlite` เท่านั้น ห้ามใช้ไฟล์ฐานที่ร้านกำลังเปิดทำงาน และห้ามคัดลอกเฉพาะไฟล์หลักขณะที่ยังมี WAL ค้างอยู่ เครื่องมือไม่เลือกฐานร้านให้อัตโนมัติ

ตัวอย่าง PowerShell จากโฟลเดอร์โปรเจกต์ (Node 24 และ dependencies ของ Shop ต้องพร้อม):

```powershell
New-Item -ItemType Directory -Path .\migration-private -Force
pnpm.cmd db:postgres:export --source "C:\Shop-Test-Backups\verified-snapshot.sqlite" --out ".\migration-private\rehearsal.sql"
```

`migration-private/` อยู่ใน `.gitignore` ไฟล์ SQL มีข้อมูลส่วนบุคคล hash รหัสผ่าน และ session เดิม ให้เก็บในโฟลเดอร์ที่จำกัดสิทธิ์บน Windows ไม่ส่งไฟล์นี้ในแชตหรือ commit ขึ้น GitHub รายงาน console ไม่แสดงแถวข้อมูลหรือรหัสผ่าน ถ้าสร้าง SQL ล้มเหลวจะไม่เหลือไฟล์ปลายทางที่ดูเหมือนสำเร็จ

ต้องใช้ snapshot schema ปัจจุบัน เครื่องมือไม่อัปเกรด snapshot รุ่นเก่าเอง หากพบ schema ไม่ตรงให้หยุดและทำแผนอัปเกรดสำเนาแยกก่อน ไม่แก้ต้นฉบับของร้าน

## นำเข้าฐาน PostgreSQL ทดสอบบน Windows

ขั้นนี้เป็นการซ้อมของผู้พัฒนา ยังไม่ใช่คำสั่งเปิดใช้ Shop บน PostgreSQL และยังไม่ผ่านการรันจริงใน Environment ของแชต ใช้เครื่อง Windows หลักที่ติดตั้ง PostgreSQL พร้อมคำสั่ง `createdb`, `psql` อยู่ใน PATH ถ้ายังไม่มีให้เตรียม PostgreSQL รุ่นที่ทีมจะรองรับก่อน

```powershell
createdb -h localhost -U postgres shop_pg_rehearsal_20261025
psql -X -v ON_ERROR_STOP=1 -h localhost -U postgres -d shop_pg_rehearsal_20261025 -f ".\migration-private\rehearsal.sql"
```

ให้กรอกรหัสผ่านเมื่อโปรแกรมถาม ไม่ใส่รหัสผ่านใน command line หรือส่งกลับในแชต ตัวอย่างใช้บัญชี migration สำหรับฐานทดสอบ ไม่ใช่ role ที่แอปจะใช้ตอนขายจริง

คำสั่งต้องจบโดยไม่มี ERROR และมี COMMIT จากนั้นตรวจบันทึกการย้าย:

```powershell
psql -X -h localhost -U postgres -d shop_pg_rehearsal_20261025 -c "SELECT version, applied_at, source_sha256, schema_sha256 FROM shop.schema_migrations;"
```

หากคำสั่งล้มเหลว transaction จะไม่ commit ให้ตรวจข้อความผิดพลาดก่อน ไม่ล้างฐานเดิมหรือแก้ยอดเพื่อให้การตรวจผ่าน หากจะซ้อมใหม่ให้สร้างฐานทดสอบชื่อใหม่ โดยไม่เขียนทับฐานเดิม

การตรวจยอดในไฟล์นี้ยืนยันจำนวนแถวและผลรวมที่ถ่ายโอน ยังต้องตรวจบิล/ยอดรายสมาชิก/FIFO/รอบตัดยอดกับแอป PostgreSQL จริง และทดสอบ backup/restore ก่อนย้ายข้อมูลธุรกิจ

## ขั้นที่เหลือก่อนทดสอบแอปสามเครื่อง

1. ติดตั้ง `pg` พร้อม lockfile และเตรียม PostgreSQL server ทดสอบจริง
2. ทำ async repository สำหรับ auth/session/สิทธิ์/ตั้งค่า สมาชิก/บัตร สินค้า/รับเข้า/FIFO ขาย/void เงินสมาชิก รายงาน ปิดรอบ และงานตามเวลา ให้ทุกเส้นทางใช้ provider เดียวกัน
3. เชื่อม backup/restore แบบ `pg_dump`/`pg_restore` และ provider startup/shutdown/health check; SQLite backup ใช้แทนไม่ได้
4. ทดสอบการนำเข้า schema/ข้อมูลจริง การทำงานของ triggers/sequence การ rollback และ retry หลัง connection ขาด รวมสองเครื่องแย่งสินค้าชิ้นสุดท้ายและใช้ยอดสมาชิกพร้อมกัน
5. ทดสอบ Windows เครื่องหลักกับ browser อีกสองเครื่องผ่าน LAN จึงยืนยัน PostgreSQL พร้อมใช้ทั้งระบบได้

ขณะนี้ตั้ง `SHOP_DATABASE_PROVIDER=postgresql` จะทำให้แอปหยุดตั้งแต่ก่อนเปิด SQLite เพื่อป้องกันเข้าใจผิดว่ากำลังขายบน PostgreSQL เช่นเดียวกับ `DATABASE_URL=postgresql://...` โดยไม่ได้เลือก provider หากตั้งใจใช้ SQLite พร้อม URL ของระบบอื่น ให้ระบุ `SHOP_DATABASE_PROVIDER=sqlite` อย่างชัดเจน URL MySQL ของ OAuth เดิมไม่เปลี่ยนพฤติกรรม

อย่าเปลี่ยน provider หรือทดสอบกับข้อมูลร้านจริงจนกว่าขั้นที่เหลือจะผ่านครบ
