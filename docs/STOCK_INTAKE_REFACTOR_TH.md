# แยกงานรับเข้าสินค้าออกจาก SQLite: ระยะที่ 2 ช่วงแรก

## สิ่งที่เปลี่ยน

แยกกฎการรับเข้าเป็น service ที่ไม่อ้าง `DatabaseSync`, `sqliteStore`, SQL หรือไฟล์ฐานข้อมูลโดยตรง ทั้ง API รับเข้าทีละสินค้าและรับเข้าหลายสินค้ายังผ่าน facade เดิม จึงไม่เปลี่ยนเส้นทาง API รูปแบบผลลัพธ์ สิทธิ์ หรือหน้าจอ

| ส่วน | ตำแหน่งและหน้าที่ |
| --- | --- |
| สัญญาข้อมูล | `shared/storeTypes/inventory.ts`: เพิ่ม ReceiveStockLinesInput ให้ผู้เรียกใช้ชนิดข้อมูลร่วมกัน |
| กฎธุรกิจ | `server/services/stockIntake.ts`: ตรวจจำนวนซื้อ/แถม ยอดจ่าย ราคาเดิมที่ผู้ใช้เห็น ต้นทุนเฉลี่ย การแบ่งมูลค่าระหว่าง Lot และลำดับบันทึก |
| สัญญา repository | `server/repositories/stockIntakeRepository.ts`: ระบุงานอ่าน/เขียนที่ service ต้องใช้ และขอบเขต transaction |
| SQLite adapter | `server/repositories/sqliteStockIntakeRepository.ts`: SQL ตรวจบาร์โค้ด เขียน Lot เพิ่มสต็อก และเปลี่ยนราคาขาย ใช้ connection เดียวกับ facade |
| Error และเงิน | `server/domain/storeError.ts`, `server/domain/money.ts`: class error และสูตรเดิม แยกจากการเปิดฐานข้อมูล; facade re-export เพื่อคงผู้เรียกเดิม |
| ทางเข้ารุ่นเดิม | `server/sqliteStore.ts`: ประกอบ adapter และส่งงานให้ service รวมทั้งรองรับ insideTransaction ของผู้เรียกเดิม |

การสร้างสินค้า การหาเลข Lot การอ่านสินค้า การบันทึก movement และ audit ยังใช้ delegate ของ SQLite เดิมบน connection เดียวกัน นี่เป็นขั้นเปลี่ยนผ่าน ไม่ใช่การแยก SQL ทั้งแอปเสร็จแล้ว

## ข้อกำหนดที่รักษาไว้

- การรับเข้าหลายสินค้าทั้งชุดมี transaction เดียว: สร้างสินค้า เขียน Lot เพิ่มสต็อก เปลี่ยนราคาขาย movement และ audit ต้องสำเร็จร่วมกันหรือย้อนคืนทั้งหมด
- รับเข้าแบบเดี่ยวเริ่ม transaction ของตัวเอง ส่วนผู้เรียกเดิมที่มี transaction อยู่แล้วเข้าร่วม transaction เดิม ไม่ BEGIN/COMMIT ซ้อน
- อ่านข้อมูลสินค้าสำหรับการรับเข้าภายใน transaction; ตรวจราคาที่ผู้ใช้เห็นก่อนแก้ราคาขาย เพื่อไม่ทับราคาที่เปลี่ยนระหว่างกรอก
- สูตรเงิน การปัดเศษ และการแบ่งจำนวนสตางค์ด้วย BigInt ใช้แบบเดิม ไม่ปรับความแม่นยำระหว่าง refactor
- จำนวนแถมและมูลค่าศูนย์ยังมีความหมายเดิม ไม่แก้ข้อมูลย้อนหลังที่ไม่ทราบต้นทุนให้กลายเป็นศูนย์
- ประวัติรับเข้าและอ้างอิง IN-… ยังใช้ ID และ receipt_group เดิม ไม่มีการเปลี่ยน schema หรือย้ายข้อมูลจริง
- StoreError เป็น class เดียวกันทั้งจุดประกาศใหม่และ facade เดิม จึงยังแปลงข้อผิดพลาดธุรกิจเป็น BAD_REQUEST ได้

## สิ่งที่ทดสอบ

ใช้ฐาน SQLite ในหน่วยความจำและไฟล์ทดสอบแยกเท่านั้น จำลองการล้มเหลวจริงด้วย SQLite trigger หลังเริ่มเขียนข้อมูลแล้ว ได้แก่ Lot แถม movement audit รับเข้า การเปลี่ยนราคา และ audit ราคา ตรวจ snapshot ของสินค้า Lot movement audit และ sequence ว่าย้อนคืนครบ จากนั้นทำรายการสำเร็จซ้ำเพื่อยืนยันว่า connection ใช้ต่อได้

ตรวจการรับเข้าเดี่ยว การเข้าร่วม transaction เดิม ต้นทุนซื้อ/แถม การแบ่งสตางค์ ประวัติต้นทุน และการรับเข้าผ่าน appRouter ทั้งสองทาง รวมถึงสิทธิ์และการแปลง error เพิ่มตัวตรวจ dependency เพื่อป้องกัน service กลับไปอ้างฐานข้อมูลโดยตรง

ไม่ได้ทดสอบ LAN บน Windows สามเครื่องหรือ PostgreSQL ในระยะนี้ ผลทดสอบ SQLite ไม่ยืนยันความถูกต้องของ concurrent writes บน PostgreSQL

## ก่อนรองรับ PostgreSQL

repository และ service รอบนี้เป็น **synchronous** เพื่อเข้ากับ runtime SQLite ที่ใช้อยู่ ห้ามส่ง Promise หรือใส่ await ลงใน transaction wrapper เดิมแล้วคาดหวังว่าจะ commit/rollback ถูกต้อง

ขั้นต่อไปต้องออกแบบ service/repository แบบ async พร้อม transaction ที่ยืม pool connection หนึ่งตัวตลอดรายการ รวมถึง API error mapping และทุกจุดที่เรียกฐานข้อมูล ไม่เสียบ PostgreSQL เข้า synchronous port นี้โดยตรง สำหรับ PostgreSQL ต้องมีการล็อกแถวสินค้าก่อนคำนวณ/ตรวจราคา ลำดับล็อกสม่ำเสมอ และตัวออกเลข Lot ที่ป้องกันเลขชนกัน จากนั้นตรวจการรับเข้าชนกับการขายจริงตามคู่มือ `LOCAL_THREE_MACHINE_TEST_TH.md`

ยังต้องแยกงานขาย/เงินสมาชิกและ helper ที่เหลือ ออกแบบ PostgreSQL schema/migration ตรวจเทียบยอด สำรอง/กู้คืน และทดสอบบน Windows ก่อนจัดทำตัวติดตั้งสำหรับลูกค้า
