# SQLite Backup

ระบบสำรองข้อมูลนี้ใช้ `node:sqlite` ของ Node.js 22 โดยไม่ต้องติดตั้ง native database package เพิ่ม สำรองไฟล์ฐานข้อมูลแบบ timestamped พร้อมตรวจ `PRAGMA integrity_check`, SHA-256 manifest และลบไฟล์เก่าตาม retention policy

## คำสั่งหลัก

```bash
# ค่าเริ่มต้น: data/welfare-store.sqlite -> data/backups เก็บ 30 วัน
pnpm backup:sqlite

# ตรวจไฟล์ backup
pnpm backup:sqlite:verify data/backups/welfare-store-YYYYMMDDTHHMMSSZ.sqlite

# กู้คืนไปยังไฟล์ใหม่ (ปลอดภัย ไม่เขียนทับไฟล์เดิม)
pnpm backup:sqlite:restore data/backups/welfare-store-YYYYMMDDTHHMMSSZ.sqlite data/restore.sqlite

# หากต้องการเขียนทับ target ต้องระบุ --overwrite
pnpm backup:sqlite:restore data/backups/welfare-store-YYYYMMDDTHHMMSSZ.sqlite data/welfare-store.sqlite --overwrite
```

สามารถเปลี่ยนค่าได้ด้วย environment variables:

```bash
SQLITE_DB_PATH=data/welfare-store.sqlite
SQLITE_BACKUP_DIR=data/backups
SQLITE_BACKUP_RETENTION_DAYS=30
```

## ตั้งเวลาสำรองอัตโนมัติ

บนเครื่องทดสอบหรือเซิร์ฟเวอร์ที่ดูแลเอง ให้รันจาก project directory:

```bash
chmod +x scripts/install-sqlite-backup-cron.sh
./scripts/install-sqlite-backup-cron.sh /path/to/wellbeing-hospital-store
```

ค่าเริ่มต้นจะสำรองทุกวันเวลา 02:00 ตามเวลาของเครื่อง หากต้องการเปลี่ยนเวลา เช่น ทุก 6 ชั่วโมง:

```bash
SQLITE_BACKUP_CRON="0 */6 * * *" ./scripts/install-sqlite-backup-cron.sh /path/to/wellbeing-hospital-store
```

ไฟล์ backup และ log ไม่ควร commit เข้า Git และควรคัดลอกไปยัง storage คนละเครื่องเป็นระยะเพื่อป้องกันความเสียหายของเครื่องหลัก สำหรับ production ควรต่อยอดให้ upload ไป object storage ที่มี versioning และ encryption แทนการเก็บไว้ใน disk เดียวกัน
