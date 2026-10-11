# เอกสารสรุปสถานะและส่งต่องานระบบ Shop

วันที่จัดทำ: 2026-09-28
Repository: `nikorn2527-stack/Shop`

เอกสารฉบับนี้สรุปจาก:

1. `Technical_Review_and_Finalization_Plan_Shop_System_TH.pdf`
2. `Deployment_Guideline_Cloud_OnPremise_TH.pdf`
3. สถานะโค้ดจริงของ branch `main`, `main-v2` และ `dev`

---

## 1. ความหมายของแต่ละ Branch

เพื่อป้องกันความเข้าใจผิด ให้ยึดความหมายของ branch ดังนี้

| Branch | ความหมาย | สถานะการใช้งาน |
|---|---|---|
| `main` | ไฟล์ชุดแรกเริ่มที่สร้าง และเป็นฐานที่ลูกค้าใช้อ้างอิง/ทดสอบ | ห้าม merge การปรับปรุงเข้าโดยไม่ได้รับคำสั่งจากเจ้าของงาน |
| `main-v2` | สำเนาที่นำมาจาก `main` เพื่อปรับปรุงให้พร้อมส่งงาน | Branch หลักสำหรับแก้ไข ทดสอบ และเตรียมส่งมอบในระยะนี้ |
| `dev` | Branch ที่แยกออกไปทดลองแก้ไข/ย้ายโครงสร้าง แต่ทำไม่สำเร็จ จึงหยุดไว้ | ไม่ใช่ฐานสำหรับพัฒนาต่อหรือ merge กลับโดยอัตโนมัติ |

สถานะที่ตรวจพบ:

- `main-v2` อยู่ข้างหน้า `main` จำนวน 10 commits และมีงาน P0/P1 สำคัญเพิ่มแล้ว
- `dev` เป็นสายงานที่แยกประวัติออกไปมาก ไม่ควรนำกลับมารวมกับ `main-v2` โดยไม่ทำ technical review และคัดเลือกโค้ดเป็นรายส่วน
- ณ วันที่จัดทำเอกสาร ยังไม่มีการ merge เข้า `main`

---

## 2. สถานะความสามารถที่มีใน `main-v2`

ระบบมีฐานธุรกิจหลักค่อนข้างครบแล้ว ได้แก่ POS, สินค้า, Barcode, สมาชิก, Wallet, Stock Lot/Expiry, รายงาน, Import/Export, Backup/Restore, Audit Log, User/Role และ Edition/License

งานที่ทีมเดิมเพิ่มในชุด P0/P1 ได้แก่:

- RBAC, Permission และ Session Security
- Idle Timeout, Login Failure Lock และ Session Revoke
- Stock Movement Ledger
- Cashier Shift
- Void / Refund
- COGS, Gross Profit, Margin และ Stock Card
- Receipt PDF/Print
- SQLite Backup, Verify, Restore และ Retention
- Script ตรวจสอบ DB และ Script ยกระดับบัญชี Admin

ผลการตรวจสอบล่าสุดของ `main-v2`:

| รายการ | ผล |
|---|---|
| TypeScript check | ผ่าน |
| Automated tests | ผ่าน 143 tests จาก 7 test files |
| Production build | ผ่าน |
| Working tree | สะอาด |

ผลดังกล่าวหมายความว่าโค้ดชุดนี้ build และทดสอบตามชุดที่มีอยู่ได้ แต่ยังไม่ใช่ข้อยืนยันว่า Production/UAT พร้อมทั้งหมด

---

## 3. ข้อค้นพบที่ต้องแก้ก่อนถือว่า Production-ready

### 3.1 Server Authorization ต้องทำให้ครบ

ใน `server/_core/trpc.ts` มี middleware สำหรับ `protectedProcedure`, `adminProcedure` และ `permissionProcedure` แล้ว แต่ endpoint ธุรกิจจำนวนมากใน `server/routers.ts` ยังประกาศเป็น `publicProcedure`

ต้องตรวจและเปลี่ยน endpoint ที่กระทบข้อมูลสำคัญ เช่น:

- User และ Session
- Product และ Stock
- Checkout, Void และ Refund
- Member Wallet
- Reports
- Settings
- Backup / Restore
- Cashier Shift

การซ่อนเมนูใน Client ไม่ใช่การรักษาความปลอดภัย ต้องบังคับสิทธิ์ที่ Server ทุกครั้ง โดยใช้ permission ที่แยกตามงาน เช่น `POS.SELL`, `POS.VOID`, `POS.REFUND`, `STOCK.ADJUST`, `REPORT.PROFIT`, `SYSTEM.BACKUP` และ `SYSTEM.RESTORE`

### 3.2 ห้ามใช้ Role จาก Client ตัดสินสิทธิ์

ต้องตัด fallback ที่ยอมรับ `actorRole` จาก request เมื่อไม่มี session สำหรับ business mutation สิทธิ์ต้องมาจาก authenticated server session เท่านั้น และต้องมี integration test สำหรับ staff, admin และ dev

### 3.3 License Signing

ปัจจุบันยังมี license secret อยู่ใน source code ต้องปรับเป็น signed license architecture ที่ลูกค้ามีเฉพาะ public verification key ส่วน private signing key ต้องอยู่นอก source/customer deployment หรืออยู่ใน signing service ที่ควบคุมโดยเจ้าของระบบ

### 3.4 Backup และ Disaster Recovery

ระบบมี backup/verify/restore แล้ว แต่แนวทาง Production ยังต้องเพิ่ม:

- Backup Database และ Uploaded Files ให้สอดคล้องกันตามช่วงเวลา
- สำเนาแยกออกจากเครื่องหลัก
- Encryption และการป้องกัน Secret/Configuration
- Retention ตามนโยบายของลูกค้า
- Restore Drill จริง
- กำหนด RPO/RTO
- SOP สำหรับ Backup, Restore และกรณีเครื่องเสียหรือ Ransomware

### 3.5 Transaction Integrity และ Idempotency

ต้องยืนยันว่า checkout, wallet, receive, void/refund และ cashier close บันทึกข้อมูลที่เกี่ยวข้องแบบ atomic transaction เดียว และต้องกันการกดซ้ำ, double request, network retry และ partial failure

---

## 4. แนวทาง Deployment ใหม่จากเอกสารชุดที่สอง

### หลักการหลัก

ใช้แนวทาง **One Codebase – Two Deployment Models**:

- Application Code และ Release Version ใช้ชุดเดียวกันให้มากที่สุด
- ความแตกต่างระหว่าง Cloud และ On-Premise ควบคุมด้วย Configuration, Infrastructure และ Deployment Profile
- ห้ามทำ Cloud และ On-Premise เป็น source code คนละชุดโดยไม่จำเป็น

### Cloud

ผู้ให้บริการเป็นผู้ดูแล Application, Database, Storage, Monitoring, Backup และ Infrastructure เป็นหลัก เหมาะกับลูกค้าที่ต้องการเริ่มใช้งานเร็วและไม่ต้องดูแล Server เอง

### On-Premise

ติดตั้งบน Server/VM ของหน่วยงาน ข้อมูลอยู่ภายใน Infrastructure ของลูกค้า และต้องมีวิธีติดตั้ง/อัปเดตแบบควบคุมได้ ไม่ควรใช้การเข้าเครื่องแล้ว `git pull`, ติดตั้ง dependency หรือแก้ source code ด้วยมือเป็นกระบวนการหลัก

### Component ที่ต้องแยกจาก Application

ควรแยก lifecycle ของส่วนต่อไปนี้ออกจากตัวโปรแกรม:

- Application
- Database
- File Storage / Uploads
- Configuration และ Secret
- Backup
- Logs / Monitoring

โครงสร้างเชิงแนวคิดสำหรับ On-Premise:

```text
/app       Application / Container definition
/data      Database persistent data
/uploads   Documents / images / attachments
/config    Environment / settings / certificates
/backups   Database and file backups
/logs      Application and operational logs
```

Application update ต้องไม่ลบหรือเขียนทับ Persistent Data, Uploads, Configuration และ Backup โดยตรง

---

## 5. มาตรฐาน Update และ Release ที่ต้องทำต่อ

### Update Flow สำหรับ On-Premise

1. Pre-check: Version, Disk, Service Health และ Compatibility
2. Backup Database และ Persistent Files
3. Backup Configuration ที่จำเป็น
4. รับ Deployment Artifact เวอร์ชันใหม่
5. หยุด Service เฉพาะที่จำเป็น
6. อัปเดต Container หรือ Package
7. รัน Database Migration แบบมี Version
8. Start Service
9. Health Check และ Smoke Test
10. บันทึกผลอัปเดตและ Version ใหม่

หาก Migration หรือ Health Check ไม่ผ่าน ต้องมี Rollback Plan ที่สอดคล้องกับชนิดของ Migration และต้องไม่สมมติว่า Database Rollback ทำได้อัตโนมัติเสมอ

### Release Management

ทุก Release ควรมี:

- Version ที่ตรวจสอบได้ เช่น `v1.0.0`
- Release Note
- รายการ Database Migration
- Compatibility ระหว่าง Version
- Installer/Artifact เดียวกันสำหรับ Cloud และ On-Premise
- ประวัติผู้ติดตั้ง วันที่ติดตั้ง ผลการอัปเดต และสถานะ Rollback
- Hotfix ID เมื่อแก้ Production

แนวทาง Pipeline:

```text
Commit
  -> Automated Test
  -> Build Container Image / Package
  -> Tag Version
  -> Publish Artifact
  -> Deploy Cloud / ส่ง Package ที่อนุมัติให้ On-Premise
```

---

## 6. Roadmap งานถัดไป

### Phase 1 — Standardize

- กำหนด Docker/Container หรือ Deployment Definition
- แยก Configuration และ Persistent Data
- กำหนด Versioning และ Release Note
- กำหนด Supported OS, Node/Runtime และ Database Version

### Phase 2 — Safe Update

- สร้าง Backup ก่อน Update
- ควบคุม Database Migration
- เพิ่ม Health Check หลัง Update
- จัดทำ Rollback Procedure

### Phase 3 — Operations

- Monitoring และ Application Health
- Application Log, Error Log และ Audit Log
- Release History
- System Information / Current Version
- Update Permission สำหรับผู้ดูแลเท่านั้น

### Phase 4 — Automation

- Update Package
- Private Registry หรือ Offline Package
- ลดการแก้เครื่องลูกค้าด้วยมือ
- รองรับ Environment ที่ไม่มี Internet ตามข้อจำกัดของลูกค้า

### Phase 5 — Scale

- Customer Environment Inventory
- ติดตาม Version ของแต่ละหน่วยงาน
- กำหนด SLA, RPO/RTO และ Support Policy
- กำหนดระยะเวลารองรับ Version เก่า

---

## 7. Checklist ก่อนประกาศว่ารองรับ On-Premise

- [ ] ติดตั้ง Environment ใหม่ได้จากเอกสารหรือ Script โดยไม่แก้ Source Code
- [ ] Database และ Uploaded Files ไม่หายเมื่อ Update Application
- [ ] มี Backup ก่อน Update และตรวจสอบผลสำเร็จได้
- [ ] Database Migration มี Version และตรวจสอบสถานะได้
- [ ] มี Health Check หลัง Update
- [ ] มี Rollback Plan
- [ ] Configuration และ Secret ไม่อยู่ใน Source Code หรือ Container Image
- [ ] ระบุ Version ของทุก Environment ได้
- [ ] มี Log เพียงพอสำหรับ Troubleshooting
- [ ] มี SOP ติดตั้ง, Update, Backup, Restore และ Support
- [ ] ทดสอบ Restore จาก Backup จริงอย่างน้อยหนึ่งรอบก่อน Production
- [ ] มีรายการ Port และ Network Dependency ให้ฝ่าย IT ลูกค้า

---

## 8. เรื่องที่ทีม/เจ้าของผลิตภัณฑ์ต้องตัดสินใจ

1. Supported OS และ Platform สำหรับ On-Premise
2. วิธี Distribution: Private Registry, Offline Image/Package หรือ Installer
3. Database Engine และ Version ที่จะ Support
4. Licensing/Activation สำหรับ On-Premise
5. SLA, Backup Responsibility และ Remote Support
6. Version Support Policy และระยะเวลารองรับ Release เก่า
7. Cloud Provider, Region, Data Residency และ Security Baseline
8. รูปแบบ Certificate/HTTPS สำหรับ Cloud และ On-Premise

---

## 9. ข้อความสั้นฝากถึงทีมที่จะทำต่อ

> ขอให้ทีมพัฒนาต่อโดยยึด `main-v2` เป็นฐานหลัก และอย่า merge เข้า `main` จนกว่าจะผ่านการทดสอบจากเจ้าของงานก่อน งานสำคัญลำดับแรกคือบังคับ Authorization ฝั่ง Server ให้ครบ, ปิดช่องโหว่จาก role ที่มาจาก Client, ตรวจ Transaction/Idempotency, ทำ Backup/Restore และ Release/Rollback ให้เป็นระบบ จากนั้นค่อยพัฒนาแนวทาง One Codebase สำหรับ Cloud และ On-Premise โดยทุก Release ต้องมี Version, Test, Migration, Backup, Health Check และเอกสารส่งมอบที่ตรวจสอบย้อนหลังได้ ส่วน `dev` ให้ถือเป็น branch ทดลองที่หยุดไว้ ไม่ควรนำกลับมารวมโดยไม่คัดเลือกและตรวจสอบโค้ดใหม่ทั้งหมด

---

## สรุปสุดท้าย

`main` เป็นฐานแรกเริ่มและเป็นฐานที่ลูกค้าใช้อ้างอิง จึงต้องคงความเสถียรไว้
`main-v2` เป็นฐานที่ควรพัฒนาต่อเพื่อปิดงานก่อนส่งมอบ
`dev` เป็นสายทดลองที่หยุดแล้ว และไม่ควรใช้เป็นต้นทางของ Release

เป้าหมายระยะยาวคือทำให้ `main-v2` ผ่าน P0/P1, ผ่าน UAT บนเครื่องจริง, มี Release Artifact และ Deployment SOP ที่ชัดเจน แล้วจึงค่อยพิจารณา merge เข้า `main` เมื่อได้รับคำสั่งโดยตรง
