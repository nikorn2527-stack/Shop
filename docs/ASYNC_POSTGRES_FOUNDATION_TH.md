# พื้นฐาน async transaction สำหรับ PostgreSQL

## สถานะ

เพิ่มโครงสร้างและทดสอบสัญญาการทำงานแล้ว แต่ยังไม่มีไลบรารี `pg`, PostgreSQL server, business repository หรือการย้ายข้อมูลจริง แอปยังใช้ SQLite เช่นเดิม ไม่เปิดเส้นทางให้เลือก PostgreSQL และไม่ใส่ await ลงใน transaction wrapper ของ SQLite

| ส่วน | หน้าที่ |
| --- | --- |
| `server/database/postgresTransaction.ts` | async unit of work ที่รับ pool/client ตาม transport contract และสร้าง repository ภายใน transaction |
| `server/repositories/asyncUnitOfWork.ts` | สัญญา callback แบบ Promise ซึ่งต้องรอทุกงานก่อนจบ |
| `server/repositories/asyncWalletRepository.ts` | สัญญางานเงินสมาชิกแบบ async; implementation จริงยังต้องทำการล็อกแถว |
| `server/services/asyncWallet.ts` | รอผลอ่าน/เขียนยอด ledger คืนบัตร และ audit ทีละขั้น รองรับการเข้าร่วม transaction ของงานปิดบัญชี |
| `server/domain/walletPlan.ts` | กฎและแผนคำนวณที่ใช้ร่วมกับ service SQLite เดิม ป้องกันสูตรเงินแยกเป็นสองชุด |
| `server/_core/storeErrors.ts` | แปลง StoreError แบบ sync และ async โดยรอ rejection หลัง await; router เดิมยังใช้ wrapper แบบ sync |

## สิ่งที่ async unit of work รับผิดชอบ

1. ขอ connection จาก pool หนึ่งตัวต่อ transaction และใช้ตัวนั้นตั้งแต่ BEGIN จนจบ ไม่ใช้ pool.query สลับ connection กลางรายการ
2. ตั้ง timezone Asia/Bangkok, statement timeout และ lock timeout แบบ transaction-local ด้วย parameterized query; ค่าปกติ 10000/3000 ms
3. รอ callback และ query ที่ส่งไปแล้วให้จบก่อน commit/rollback หรือคืน connection หาก callback จบขณะ query ยังทำงาน จะรอ query นั้นแล้ว rollback
4. ปิด query scope เมื่อ callback จบ การนำ repository เก่าไปใช้อีกต้องไม่ส่ง SQL ลง connection ที่คืน pool แล้ว
5. ความผิดพลาดในงานหรือ query ทำให้ rollback แม้ callback จับ query rejection แล้วพยายามคืนค่าปกติ; ยังไม่รองรับการกู้จาก SQL error ด้วย savepoint
6. หาก rollback ยืนยันไม่ได้ ให้เก็บทั้ง error หลักและ rollback error พร้อมทิ้ง connection ไม่คืนให้คำขอถัดไปใช้
7. หาก COMMIT ตอบกลับเป็นข้อผิดพลาด ให้รายงาน TransactionCommitUnknownError อย่างระมัดระวัง เพราะคำสั่งอาจถึง server แล้ว การส่ง ROLLBACK ตามหลังไม่ใช่หลักฐานว่าไม่ได้ commit ห้าม retry การเขียนอัตโนมัติ
8. ไม่มี retry loop ภายใน helper การทดสอบ concurrent callbacks ยืนยันเพียงว่าใช้ client คนละตัว ไม่ได้ยืนยัน row lock หรือ isolation ของ PostgreSQL จริง

ผู้เรียกต้อง await ทุก repository operation; helper ตรวจเฉพาะ query ที่ส่งผ่าน scope แล้ว ไม่สามารถติดตาม async งานอื่นที่ callback ปล่อยหลุดออกไปเอง ห้ามเรียกบริการภายนอกหรือพิมพ์เอกสารระหว่างถือ transaction

## ผลทดสอบที่นับเป็นหลักฐานได้

- ทดสอบ transport contract ด้วย client จำลอง: success, rollback, query ค้าง/ไม่ได้ await, repository หมดอายุ, BEGIN/config/factory ล้มเหลว, rollback ล้มเหลว, COMMIT ไม่ทราบผล, pool acquisition ล้มเหลว และหลาย transaction ใช้ connection แยกกัน
- ทดสอบ async wallet ด้วย repository/unit-of-work จำลอง พร้อมเทียบผลเติม/ถอน/คืนเงินกับ SQLite facade เดิม การจำลองนี้ไม่ใช่ PostgreSQL integration test
- ตรวจการส่งซ้ำหลังคืนบัตร และงานปิดบัญชีที่ต้องควบคุม transaction ด้านนอก
- ตรวจ error mapping หลัง await และใช้ regression tests เดิมตรวจพฤติกรรม SQLite ของแอปต่อ

ยังไม่ได้ทดสอบ SQL protocol, `pg` driver, pool จริง, row locking, deadlock, PostgreSQL COMMIT semantics, schema/migration หรือ Windows LAN สามเครื่อง จึงยังไม่ใช้ผลนี้ยืนยันว่ารองรับ PostgreSQL แล้ว

## ข้อจำกัดของ Environment ที่ตรวจพบ

Environment ที่ทำงานในรอบนี้มี network policy แบบ restricted/enforced และไม่มี allowed hosts ไม่มี `pg`, `psql` หรือ postgres binary; Docker daemon ใช้งานได้แต่ไม่มี image ที่ cache ไว้ ผู้ใช้ใน executor เป็น UID 1000

การติดตั้ง npm driver ต้องเข้าถึง `registry.npmjs.org` ส่วนแหล่งแพ็กเกจ Debian ที่ตั้งไว้ใน Environment คือ `snapshot.debian.org` หากเลือกเตรียม PostgreSQL จากแพ็กเกจ Linux ต้องเปิดปลายทางนี้และเตรียมขั้นตอนติดตั้งสำหรับสิทธิ์ที่มี หรือเตรียม PostgreSQL ใน Environment setup แทน การใช้ Docker สำหรับทดสอบเป็นอีกทางเลือกและต้องอนุญาต registry/ปลายทางดาวน์โหลด image ที่เกี่ยวข้องด้วย ไม่ใช่ข้อบังคับบนเครื่องลูกค้า

ไม่ได้เปลี่ยนนโยบายเครือข่าย ดาวน์โหลดผ่านทางเลี่ยง หรือเพิ่ม dependency ที่ไม่มี lockfile ตรวจสอบแล้ว การปรับสิทธิ์ต้องผ่าน Environment configuration ของเจ้าของ; เครื่องมือในเซสชันนี้อ่านสถานะ Environment ได้แต่ไม่มีคำสั่งแก้ configuration

## ขั้นต่อไปเมื่อเตรียม Environment แล้ว

1. เพิ่ม `pg` และ types พร้อม lockfile แล้วทดสอบ helper กับ PostgreSQL แยกจริงก่อนเชื่อมข้อมูลธุรกิจ
2. ทำ async repository ที่ล็อกสมาชิก/บัตรบน connection เดียวกัน พร้อม unique request ID และ payload fingerprint เพื่อแก้ผล COMMIT ที่ไม่ทราบสถานะอย่างปลอดภัย
3. ทำ async งานขาย/รับเข้าและ helper ที่เหลือ รวมถึง auth/session และ error mapping ทุกทางที่ต้องรอฐานข้อมูล ห้ามเปิด provider แบบครึ่งแอปเขียน SQLite อีกครึ่งเขียน PostgreSQL
4. ทำ schema/migration แบบรักษา ID ศูนย์นำหน้า เวลา ต้นทุนที่ไม่ทราบ และยอดเงิน/สต็อก พร้อม reconciliation และ backup/restore
5. ทดสอบ PostgreSQL หลาย connection แล้วทดสอบ Windows เครื่องหลักหนึ่งเครื่องและเครื่องใช้งานสองเครื่อง ก่อนทำตัวติดตั้งจริง
