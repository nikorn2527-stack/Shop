# โครงสร้างไดเรกทอรีสำหรับการติดตั้ง On-Premise (PNG Shop)

> เอกสารนี้อธิบายโครงสร้างไดเรกทอรีเชิงแนวคิด (conceptual layout) สำหรับการติดตั้ง PNG Shop บนเครื่อง Server/VM/Docker ของหน่วยงาน (On-Premise) ตามมาตรฐานในเอกสาร `TECHNICAL_REVIEW_DEPLOYMENT_HANDOFF_TH.md` Section 4

---

## หลักการออกแบบ

ใช้แนวทาง **One Codebase – Two Deployment Models**:

- Source code ชุดเดียวกัน (`main-v2`) deploy ได้ทั้งบน Cloud และ On-Premise
- ความแตกต่างระหว่างสองโหมดถูกควบคุมด้วย **Configuration** (`DEPLOYMENT_MODE` env var) + **Infrastructure** (`Dockerfile`, `docker-compose.yml`)
- Lifecycle ของส่วนประกอบต่าง ๆ (Application, Database, Uploads, Config, Backups, Logs) ต้อง **แยกจากกัน** — update application ต้องไม่ลบหรือเขียนทับข้อมูลที่อยู่ใน persistent volume

---

## โครงสร้างไดเรกทอรี

```text
/app       Application (git repo + node_modules)
/data      Database (welfare-store.sqlite)
/uploads   Member photos / slip images (future: move from DB to disk)
/config    Environment (.env, certificates)
/backups   SQLite backup files
/logs      Application logs
```

### รายละเอียดแต่ละ directory

| Path       | เนื้อหา                                                                 | สร้างโดยใคร / เมื่อไหร่              | Lifecycle                                                            |
| ---------- | --------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `/app`     | Source code (git checkout), `node_modules/`, `dist/` (build output)   | `scripts/update.sh` Step 4 (Receive Artifact) | เปลื่ยนทุกครั้งที่ release ใหม่ — ไม่มี persistent data ในนี้       |
| `/data`    | SQLite database file `welfare-store.sqlite` (+ `-wal`, `-shm` ชั่วคราว) | สร้างตอน first install หรือ migrate | ต้องอยู่ตลอด — backup ทุกครั้งก่อน release ใน `data/backups/`         |
| `/uploads` | รูปสมาชิก, สลิปเงินเข้า (future — ปัจจุบันยังเก็บใน DB blob)              | Application runtime                | สะสมตามอายุการใช้งาน — ต้องไม่ถูกลบตอน update application           |
| `/config`  | `.env` (env vars), HTTPS certificates, OAuth keys, license public key   | Operator วางด้วยมือ (manual)       | เปลื่ยนเฉพาะตอนตั้งค่าครั้งแรก / หมุนเวียน cert — ไม่ใช่ทุก release |
| `/backups` | SQLite backup (`welfare-store-<ISO>.sqlite`), config backup (`config-<ISO>/`) | `scripts/update.sh` Step 2-3 และ `scripts/sqlite-backup.ts` cron | สะสม — operator ต้องดาวน์โหลดไปเก็บ offline เป็นระยะ            |
| `/logs`    | Application logs (`update-<ISO>.log`, `rollback-<ISO>.log`, runtime logs) | `scripts/update.sh` + `scripts/rollback.sh` สร้างอัตโนมัติ | หมุนเวียนตาม log retention policy (แนะนำ 90 วัน)                  |

---

## กฎเกณฑ์สำคัญ (Rules)

### Rule 1: Application update ต้อง **ไม่** เขียนทับ persistent data

เมื่อรัน `scripts/update.sh` (หรือ `docker-compose pull && up -d`):

- ✅ อนุญาตให้ update `/app` (git checkout, `pnpm install`, `pnpm build`)
- ✅ อนุญาตให้ update `/data/welfare-store.sqlite` schema ผ่าน `pnpm db:push` (migration มี version tracking ใน `store_settings.schema_version`)
- ❌ **ห้าม** ลบ/เขียนทับ `/data` ระหว่าง release (ยกเว้น migration step)
- ❌ **ห้าม** ลบ/เขียนทับ `/uploads`
- ❌ **ห้าม** ลบ/เขียนทับ `/config`
- ❌ **ห้าม** ลบ/เขียนทับ `/backups`

การ์ดการันตี: ใน Docker, ทุก persistent path ถูก mount เป็น **named volume** หรือ **bind mount** ที่อยู่นอก `/app` ของ container (ดู `docker-compose.yml`)

### Rule 2: แต่ละ directory มี lifecycle อิสระ

- `/app` — เปลื่ยนทุก release (via git, `pnpm install`, `pnpm build`)
- `/data` — เปลื่ยนเฉพาะตอน migrate schema; อยู่ตลอด
- `/uploads` — เติบโตตามอายุการใช้งาน; ไม่ depend on application version
- `/config` — เปลื่ยนเฉพาะตอนตั้งค่าครั้งแรก / หมุนเวียน cert
- `/backups` — สะสม; retention policy แยก (operator ลบ manually)
- `/logs` — retention 90 วัน (or as configured)

### Rule 3: Backup strategy ครอบคลุม `/data` + `/config` (ไม่รวม `/app`)

เพราะ `/app` อยู่ใน git อยู่แล้ว — version control คือ backup ของ application code

Backup ต้องครอบคลุม:

1. **Database** (`/data/welfare-store.sqlite`) — `scripts/update.sh` Step 2 สร้าง `welfare-store-<ISO>.sqlite` ใน `/backups` ก่อนทุก release; `scripts/install-sqlite-backup-cron.sh` ติดตั้ง cron รายวัน
2. **Configuration** (`/config/.env`, certificates) — `scripts/update.sh` Step 3 คัดลอกไป `config-<ISO>/` ใน `/backups`
3. **Encrypted backup** (optional) — `pnpm backup:sqlite` (P3 — AES-256-GCM) เข้ารหัสด้วย `BACKUP_ENCRYPTION_KEY` env var; ดู `docs/BACKUP_RESTORE_SOP_TH.md`

ไม่จำเป็นต้อง backup:

- `/app` — อยู่ใน git, restore ด้วย `git checkout <ref>`
- `/node_modules` — regenerate ด้วย `pnpm install --frozen-lockfile`
- `/dist` — regenerate ด้วย `pnpm build`
- `/logs` — operational ไม่ใช่ business data

---

## การ映射ไปยัง Docker container

เมื่อรันผ่าน `docker-compose.yml`:

```text
Host filesystem                  Container path
─────────────────                ───────────────
./data                          → /app/data          (welfare-store.sqlite, backups)
./data/backups                  → /app/data/backups  (backup files)
./.env                          → /app/.env          (read-only mount)
```

`VOLUME ["/app/data", "/app/data/backups"]` ใน `Dockerfile` ประกาศเจตนาว่าสอง path นี้เป็น persistent data — `docker run` โดยไม่ mount จะสร้าง anonymous volume อัตโนมัติ (ดีกว่าเขียนทับลง `/app`)

---

## การเปลื่ยนจาก Cloud → On-Premise (หรือกลับ)

เพราะ codebase ชุดเดียวกัน — migration ระหว่างโหมดคือ **data migration + config change** ไม่ใช่ code change:

1. ตั้ง `DEPLOYMENT_MODE=onpremise` (จาก `cloud`) ใน `/config/.env`
2. รัน `scripts/update.sh` (or `docker-compose up -d --build`) บนเครื่อง on-prem
3. กู้คืน database จาก encrypted backup (`pnpm backup:sqlite:restore`)
4. กู้คืน `/config` และ `/uploads` จาก tarball ที่ดาวน์โหลดจาก cloud
5. Verify ด้วย `system.health` + smoke test 4 core tables

สำหรับการวางแผน Cloud migration โปรดดู `docs/CLOUD_DEPLOYMENT_GUIDE_TH.md`

---

## อ้างอิง

- `docs/TECHNICAL_REVIEW_DEPLOYMENT_HANDOFF_TH.md` Section 4 — แนวทาง Deployment ใหม่
- `Dockerfile` — container image definition (Node 22 + pnpm + esbuild bundle)
- `docker-compose.yml` — on-premise orchestration
- `scripts/update.sh` — 10-step on-premise update flow (P4)
- `scripts/rollback.sh` — 7-step rollback procedure (P4)
- `docs/BACKUP_RESTORE_SOP_TH.md` — backup encryption + restore drill (P3)
- `docs/RELEASE_CHECKLIST_TH.md` — release checklist (P6)
