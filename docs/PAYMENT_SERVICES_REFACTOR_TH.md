# แยก service งานขายและเงินสมาชิก: ระยะที่ 2

## ขอบเขต

ย้ายกฎและลำดับงานของ `checkout` และ `walletTx` ออกจาก `server/sqliteStore.ts` โดยเก็บ facade และรูปแบบ API เดิมไว้ ไม่เปลี่ยนหน้าจอ schema สูตรปัดเศษ หรือสิทธิ์ การใช้จริงในระยะนี้ยังเป็น synchronous SQLite ไม่ใช่ PostgreSQL

| ส่วน | หน้าที่ |
| --- | --- |
| `server/services/checkout.ts` | รวมรายการ ตรวจสินค้า/สมาชิก/ส่วนลด กำหนดยอดขาย ตัดสต็อกและต้นทุน หักเงินสมาชิก และคืนใบเสร็จ |
| `server/services/wallet.ts` | เติม/ถอน/คืนเงิน ตรวจยอดและเงื่อนไขบัตร ปล่อยบัตรเมื่อคืนเงินครบ และคืนผลธุรกรรม |
| `server/repositories/checkoutRepository.ts` และ `walletRepository.ts` | สัญญาส่วนอ่านเขียนที่แต่ละ service ใช้ ไม่มี SQL |
| `server/repositories/memberLedgerRepository.ts` | สัญญาร่วมของยอดสมาชิก ledger audit และ synchronous unit of work |
| `server/repositories/sqliteCheckoutRepository.ts` และ `sqliteWalletRepository.ts` | SQL เขียนบิล/รายการขาย และอ่านผลเดิมตาม request ID |
| `server/repositories/sqliteMemberLedger.ts` | เขียนยอดสมาชิกและ ledger บน connection เดียวกับผู้เรียก ไม่เปิดหรือ commit transaction เอง |
| `shared/storeTypes/members.ts` | เพิ่ม WalletReceipt เป็นชนิดข้อมูลผลลัพธ์กลาง โดยคง fields และชนิดข้อมูลเดิม |
| `server/sqliteStore.ts` | ประกอบ adapter และคงทางเข้าเดิมให้ router/ผู้เรียกเดิม |

การตรวจบัตรที่ใช้งานได้ การอ่านสินค้า การออกเลขบิล การตัด Lot และการปล่อยบัตรยังใช้ delegate เดิมบน connection เดียวกัน ส่วนการคืนบิล การจัดการบัตร และการปิดบัญชีรอบใช้งานยังมี orchestration บางส่วนอยู่ใน facade จึงยังไม่ถือว่าแยก SQL/กฎธุรกิจทั้งแอปเสร็จแล้ว

## ขอบเขต transaction

การขายหนึ่งครั้งอ่านข้อมูลและบันทึกบิล รายการขาย จำนวนสินค้า Lot การแบ่งต้นทุน เงินสมาชิก ledger และ audit ใน transaction เดียวกัน หากจุดใดผิดพลาด ทุกส่วนย้อนคืนรวมกัน การตัด Lot ยังเป็นพฤติกรรมเดิมตามวันหมดอายุที่ใกล้ก่อน (ชื่อ helper เดิมคือ deductLotsFifo)

การเติม/ถอน/คืนเงินปกติมี transaction ของตัวเอง รวมการปล่อยบัตรและปิด session ผ่าน trigger เดิม การคืนเงินระหว่างปิดบัญชีแบบยังไม่รับบัตรคืนเข้าร่วม transaction ของงานปิดบัญชี และไม่ commit ก่อนผู้เรียกด้านนอก

การอ่านผลเดิมตาม clientRequestId อยู่ก่อนการตรวจบัตรหรือจุดขายเช่นเดิม จึงยังคืนผลสำเร็จเดิมได้หลังยกเลิกการผูกจุดขายหรือคืนบัตรไปแล้ว การลองซ้ำไม่เขียนบิล สต็อก เงิน ledger หรือ audit เพิ่ม

## การตรวจสอบ

- จำลองความผิดพลาดจริงด้วย SQLite trigger ที่หลังสร้างบิล หลังตัดสต็อก/มูลค่า Lot หลังบันทึกต้นทุน และหลังหักเงินสมาชิก
- จำลองการคืนเงินล้มเหลวระหว่างเขียน ledger ปล่อยบัตร เปลี่ยนประวัติการผูกบัตร ปิด session และเขียน audit
- ตรวจการเติมเงิน/ถอนเงินล้มเหลวตอนท้าย และการปิดบัญชีล้มเหลวหลังคืนเงินแล้ว
- เปรียบเทียบ snapshot 13 ตารางรวม sequence ก่อนและหลังล้มเหลว แล้วลองซ้ำด้วย request ID เดิมให้สำเร็จ และลองซ้ำอีกครั้งโดยไม่มีการเขียนเพิ่ม
- ตรวจผ่าน appRouter: เติมเงิน → ขายโดยหักบัญชี → คืนเงินครบยอด พร้อม retry ทุกขั้น รวมถึง BAD_REQUEST เมื่อเงินไม่พอ
- ใช้ชุดทดสอบเดิมครอบคลุมรายงาน ต้นทุน Lot สิทธิ์ จุดขาย และบัตรหมุนเวียน เพิ่ม dependency guard กัน service อ้าง SQLite หรือ database driver โดยตรง

ทั้งหมดใช้ฐานข้อมูลในหน่วยความจำหรือฐานทดสอบแยก ไม่เปิดหรือแก้ไขฐานข้อมูลธุรกิจจริง ไม่ได้ทดสอบเครื่องพิมพ์หรือ Windows LAN สามเครื่องในรอบนี้

## ก่อน PostgreSQL และตัวติดตั้ง

interface และ service ระยะนี้ยัง synchronous ห้ามนำ async callback ไปใช้กับ transaction wrapper เดิมหรือถือว่าเปลี่ยน connection string แล้วใช้ PostgreSQL ได้ ต้องทำ async service/repository และ API error mapping พร้อม pool connection เดียวตลอด transaction รวมถึงแยก helper ที่ยังเหลือ

ความคืบหน้าถัดมา: เพิ่ม async transaction foundation และ async wallet แยกไว้แล้ว โดยย้ายกฎเงินไปใช้ร่วมกับ service เดิม ดู [รายละเอียด](ASYNC_POSTGRES_FOUNDATION_TH.md) แต่ยังไม่มี PostgreSQL repository/driver ที่ทดสอบจริงและยังไม่เปิดเส้นทาง async นี้ใน router

การ replay ยังค้นด้วย request ID ตามพฤติกรรมเดิม ยังไม่ได้เพิ่ม unique constraint หรือ fingerprint สำหรับป้องกันการนำ key เดิมไปใช้กับ payload อื่น ส่วน PostgreSQL ต้องเพิ่มการควบคุมนี้พร้อมการล็อกแถวสมาชิก/สินค้า/Lot ในลำดับเดียวกัน และออกเลขบิลด้วย counter ที่รองรับ concurrent transactions ไม่ใช้ MAX + 1

หลังทำ PostgreSQL adapter/migration ต้องตรวจเทียบยอดและทดสอบสองเครื่องแย่งสินค้าชิ้นสุดท้าย ใช้ยอดสมาชิกเดียวกันพร้อมกัน ส่งคำขอซ้ำหลังเครือข่ายขาด และสำรอง/กู้คืน ก่อนทดสอบบน Windows สามเครื่องตาม `LOCAL_THREE_MACHINE_TEST_TH.md` แล้วจึงตรวจ Setup/นำเข้า/ตัวติดตั้งจริง
