# Release Note — v[VERSION] — [DATE]

> เอกสารส่งมอบการปล่อยระบบ (Release Handover Note)
> คัดลอกเอกสารนี้ไปยัง `docs/releases/v[VERSION]-[DATE].md` แล้วกรอกรายละเอียดครบทุกส่วนก่อนประกาศ release. ทุก release ต้องมี Version / Test / Migration / Backup / Health Check / Rollback Plan ตามมาตรฐาน section 5 ของ `docs/TECHNICAL_REVIEW_DEPLOYMENT_HANDOFF_TH.md`.

---

## Version

- **App version:** [package.json `version`, เช่น 1.0.0]
- **Schema version:** [ค่าจาก `system.releases.schemaVersion` ใน tRPC, เช่น 1.0]
- **Node:** [ผลลัพธ์ของ `getVersionInfo().nodeVersion` เช่น v20.10.0]
- **Platform:** [ผลลัพธ์ของ `getVersionInfo().platform` เช่น linux / darwin / win32]
- **Build date:** [ผลลัพธ์ของ `getVersionInfo().buildDate` (ISO), หรือ n/a ถ้าเป็น dev mode]

## Migrations

รายการ database migration ที่รันใน release นี้ (เรียงตามลำดับที่รัน):

- [ชื่อ migration หรือ "none" ถ้าไม่มี schema change]
- ตัวอย่าง: `0002_member_card_number.sql` — เพิ่ม `members.card_number` + `members.patient_code` (nullable TEXT)
- ตัวอย่าง: `0003_release_logs.sql` — สร้างตาราง `release_logs` (P4)

ผลการรัน migrations (จาก `scripts/update.sh` step 7):

```
[paste output ของ pnpm db:push ตรงนี้]
```

Schema version ก่อน/หลัง:

- ก่อนรัน migrations: [เช่น 1.0]
- หลังรัน migrations: [เช่น 1.1]

## Backup

ข้อมูลสำรองที่สร้างก่อน/ระหว่าง release (จาก `scripts/update.sh` step 2):

- **Backup file:** `welfare-store-YYYYMMDDTHHMMSSZ.sqlite` (ใน `data/backups/`)
- **Verified:** [yes/no — PRAGMA integrity_check + 4 core tables]
- **SHA256:** [hash เต็ม 64 ตัวอักษร]
- **Size (bytes):** [byte count]
- **Encrypted:** [yes/no — ถ้าตั้ง `BACKUP_ENCRYPTION_KEY` ไฟล์สำรองจะเป็น `.sqlite.enc`]

## Health Check

ผลการตรวจสอบหลัง release (จาก `scripts/update.sh` step 9):

- **Status:** ok
- **Endpoint:** `GET /api/trpc/system.health`
- **Version reported:** [จากฟิลด์ `version` ของ response]
- **Uptime (seconds):** [จากฟิลด์ `uptime`]
- **DB connected:** true
- **DB size (bytes):** [จากฟิลด์ `db.sizeBytes`]
- **Memory used (MB):** [จากฟิลด์ `memory.usedMB`]
- **Memory total (MB):** [จากฟิลด์ `memory.totalMB`]
- **Timestamp:** [จากฟิลด์ `timestamp`]

Raw response (paste full payload):

```json
{
  "status": "ok",
  ...
}
```

## Changes

รายการสิ่งที่เปลี่ยนแปลงใน release นี้ (bullet list, แยกตามหมวด):

- **Features:**
  - [เช่น เพิ่มระบบ release/rollback — version tracking + health check + release_logs table]
- **Fixes:**
  - [เช่น แก้บั๊ก logout ไม่ล้าง cookie (P1 fix)]
- **Database schema:**
  - [เช่น สร้างตาราง `release_logs` (P4) + index `idx_sales_client_req` (P2-b)]
- **Configuration / env vars:**
  - [เช่น `BACKUP_ENCRYPTION_KEY` เพิ่มใหม่ (P3) — optional, ≥32 ตัวอักษร]
- **Scripts:**
  - [เช่น `scripts/update.sh` + `scripts/rollback.sh` (P4)]

Commit range ที่รวมอยู่ใน release นี้:

- จาก commit: [hash 7 ตัวแรก, เช่น 5840715]
- ถึง commit: [hash 7 ตัวแรก, เช่น de89620]

## Testing

ช่องที่ต้องติ๊กครบก่อนประกาศ release-ready:

- [x] TypeScript check ผ่าน (`npx tsc --noEmit` 0 errors)
- [x] Dev server บูทได้ (`pnpm dev` บน port 3000 ส่ง HTTP 200)
- [ ] POS checkout ทำงาน (เงินสด / QR / หักบัญชีสมาชิก)
- [ ] Void บิล และ Refund ทำงาน
- [ ] Wallet transaction (เติม/ถอน/คืนบัตรเงินสด) ทำงาน
- [ ] Reports โหลดได้ทุกแท็บ (สรุปยอดขาย / ประวัติบิล / ธุรกรรม / สินค้าคงคลัง / ยอดเงินในบัตร)
- [ ] Settings บันทึกได้ (ทุก tab — ทั่วไป / หมายเลขสมาชิก / การพิมพ์ / การสำรอง / การเชื่อมต่อ)
- [ ] Backup + Restore drill ผ่าน (admin กด "ทดสอบกู้คืน" จากไฟล์สำรองล่าสุด)
- [ ] Health check endpoint ตอบ `{"status":"ok"}` จาก anonymous request
- [ ] Rollback drill ผ่าน — `./scripts/rollback.sh <backup-file>` คืนระบบได้จริง
- [ ] Login + Logout ทำงาน (cookie ถูกล้างจริง — P1 fix)
- [ ] RBAC enforcement ทุก endpoint ทำงาน (staff ทำ admin ops ไม่ได้ — P1)

## Rollback Plan

แผนย้อนกลับเมื่อ release นี้มีปัญหาหลัง deploy:

- **Backup file:** `data/backups/<filename จากส่วน Backup ด้านบน>`
- **Git commit hash:** [hash 7 ตัวแรกของ commit ต้นน้ำ — ใช้สำหรับ `git checkout` ย้อนกลับ]
- **Rollback command:**
  ```bash
  ./scripts/rollback.sh <backup-file>
  # หรือระบุ git ref ที่จะย้อนไป:
  GIT_PREV_REF=<commit-hash> ./scripts/rollback.sh <backup-file>
  ```
- **Estimated RTO:** [Recovery Time Objective — เช่น 5 นาที สำหรับ rollback ในเครื่อง]
- **Pre-rollback checklist:**
  1. หยุดผู้ใช้ใช้งานร้านชั่วคราว (ปิด POS)
  2. แจ้งเจ้าหน้าที่หน้าร้านว่าระบบกำลัง rollback
  3. รัน `./scripts/rollback.sh <backup-file>` แล้วรอจนเห็น "Rollback COMPLETE"
  4. ทดสอบ checkout 1 บิล + void 1 บิลเพื่อยืนยัน
  5. แจ้งทีมกลับมาใช้งานได้

## Sign-off

การส่งมอบ release นี้ต้องมีการลงนามก่อนประกาศ production-ready:

- **Released by:** [ชื่อ-นามสกุล ผู้ส่งมอบ]
- **Role:** [ผู้พัฒนา / ผู้บริหารระบบ / ผู้บริหารฝ่ายเทคโนโลยี]
- **Date (ISO):** [YYYY-MM-DDTHH:MM:SSZ]
- **Commit hash:** [hash 7 ตัวแรกของ commit สุดท้ายที่รวมอยู่ใน release]
- **Backup verified by:** [ชื่อผู้ยืนยัน integrity ของไฟล์สำรอง]
- **Health check observed by:** [ชื่อผู้สังเกตการณ์ health check หลัง boot]
- **Reviewed by:** [ชื่อ reviewer ทบทวน release note]

---

## Appendix — รายการไฟล์ที่เปลี่ยนใน release นี้

```
$ git diff --stat <prev-tag>..HEAD
```

วางผลลัพธ์ตรงนี้:

```
[file list]
```

## Appendix — รายการไฟล์ที่ touch database schema

อ้างอิงเพื่อตรวจทบทวน migration:

- [เช่น `server/sqliteStore.ts` — เพิ่มตาราง release_logs ใน createSqliteStore]
- [เช่น `drizzle/0002_*.sql` — migration script]

## Appendix — env vars ที่ใหม่/เปลี่ยน

- `[VAR_NAME]` — [คำอธิบาย + ค่า default + ความปลอดภัย (required/optional, length min/max, sensitive?)]
