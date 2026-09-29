# คู่มือปรับใช้บนคลาวด์ (Cloud Deployment Guide)

> เอกสารนี้อธิบายการติดตั้ง PNG Shop บนผู้ให้บริการคลาวด์สาธารณะ (Railway, AWS, GCP, Azure) โดยใช้ **source code ชุดเดียวกัน** กับการติดตั้ง On-Premise — ความแตกต่างถูกควบคุมด้วย env var `DEPLOYMENT_MODE=cloud` (ดู `server/_core/deployment.ts`)

---

## หลักการสำคัญสำหรับ Cloud

1. **Ephemeral filesystem** — ไฟล์ใน container ไม่คงที่; ทุก path ที่ต้องคง (database, uploads, config, backups) ต้องวางบน **persistent volume** หรือ external service
2. **Stateless container** — application process ต้องไม่เก็บ state ในหน่วยความจำระหว่าง requests (session ใช้ JWT ใน signed cookie, ไม่ใช้ in-memory Map)
3. **HTTPS สิ้นสุดที่ edge** — provider ทำ TLS ให้อัตโนมัติ (Railway) หรือ operator วาง Caddy/Cloudflare Proxy ด้านหน้า (self-hosted cloud VM)
4. **Database path** — `SQLITE_DB_PATH` ต้องชี้ไป path ใน volume ที่ mount แล้ว (เช่น `/data/welfare-store.sqlite`); ถ้าชี้ไป path ใน ephemeral FS ข้อมูลหายเมื่อ restart

---

## 1) Railway (แนะนำ — มี `railway.json` ใน repo อยู่แล้ว)

### ขั้นตอนสำคัญ

1. **สมัคร Railway** → Login with GitHub → อนุญาตให้อ่าน repo `Shop`
2. **New Project** → **Deploy from GitHub repo** → เลือก repo `Shop`
3. **Branch**: `main` (หรือ `main-v2` สำหรับ production hardening branch — ดู `docs/RAILWAY.md` Section 2)
4. Railway อ่าน `railway.json` อัตโนมัติ:
   - `startCommand`: `pnpm start`
   - `healthcheckPath`: `/`
   - `restartPolicyType`: `ON_FAILURE`
5. Build ใช้ Nixpacks อัตโนมัติ (ตรวจ `package.json` → ติดตั้ง pnpm → `pnpm install` → `pnpm build`)

> ดูคู่มือแบบ step-by-step ที่ `docs/RAILWAY.md`

### Environment variables สำหรับ Cloud

ตั้งใน Railway Dashboard → Service → **Variables**:

| Variable            | ค่าตัวอย่าง                              | หมายเหตุ                                                          |
| ------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| `DEPLOYMENT_MODE`   | `cloud`                                 | เปิด cloud-only code paths (ดู `server/_core/deployment.ts`)     |
| `CLOUD_PROVIDER`    | `railway`                               | optional — log traceability only                                 |
| `CLOUD_REGION`      | `asia-southeast1`                       | optional — Railway ใช้ region `us-west2` หรือ `ap-southeast1`     |
| `DATA_RESIDENCY`    | `thailand`                               | optional — สำหรับ audit log (ข้อมูลอยู่ที่ไหน)                   |
| `SQLITE_DB_PATH`    | `/data/welfare-store.sqlite`            | **ต้อง** ชี้ไปใน volume — ดู Section 2 ด้านล่าง                    |
| `SQLITE_BACKUP_DIR` | `/data/backups`                         | ใน volume เดียวกับ DB                                            |
| `JWT_SECRET`        | `<random 32+ char>`                     | **จำเป็น** — secret สำหรับ signed session cookie                 |
| `OWNER_OPEN_ID`     | `<OAuth subject>`                       | ระบุบัญชีผู้บริหารคนแรก (สำหรับ OAuth flow)                       |
| `OAUTH_SERVER_URL`  | `https://auth.example.com`              | external OAuth IdP (optional — ระบบมี password login built-in)   |
| `VITE_APP_ID`       | `png-shop`                              | ใช้ใน client-side สำหรับ OAuth client_id                         |
| `NODE_ENV`          | `production`                            | Railway ตั้งให้อัตโนมัติเมื่อ deploy                                |
| `PORT`              | (ไม่ต้องตั้ง — Railway ใส่ให้เอง)         | Railway ใช้ `PORT` env var ทุกครั้ง                                |

> ⚠️ `JWT_SECRET` ต้องอย่างน้อย 32 ตัวอักษรและไม่เปลื่ยนระหว่าง deploys — ถ้าเปลื่ยน session ทุกบัญชีหลุดล็อกอิน

---

## 2) Database path strategy สำหรับ Cloud

### ปัญหา

Container filesystem บน Railway/Render/Fly.io เป็น **ephemeral** — ถ้ารีสตาร์ทหรือ redeploy ไฟล์ใน `/app/...` ทั้งหมดหาย (ยกเว้นอยู่ใน volume ที่ mount)

### ทางแก้

#### ทางเลือก A: Railway Volume (แนะนำ — ง่ายที่สุด)

1. Service → **Settings** → **Volumes** → **New Volume**
2. Mount path: `/data`
3. ขนาดเริมต้น 1 GB (ขยายได้ภายหลัง)
4. Railway mount volume ให้ทุก replica — database คงที่ข้ามาระหว่าง deploys

```text
container filesystem:    /app/...           (ephemeral — หายทุก redeploy)
persistent volume:       /data/...          (คงที่ — DB + backups)
                         ├── welfare-store.sqlite
                         └── backups/
```

#### ทางเลือก B: External SQLite-compatible service

สำหรับ multi-region หรือ HA (high-availability): ใช้ [LiteFS](https://github.com/superfly/litefs) (SQLite replication) หรือ [Turso](https://turso.tech) (libSQL) แทน local file — ต้องเขียน adapter layer ใน `server/sqliteStore.ts` (out of scope ของ P5 — see `docs/TECHNICAL_REVIEW_DEPLOYMENT_HANDOFF_TH.md` Section 6 Phase 5)

#### ทางเลือก C: S3-backed DB (production-advanced)

Mirror SQLite file ไป S3 bucket หลังทุก write (ครั้งละไม่กี่ KB) — ทำได้ผ่าน custom WAL hook แต่ซับซ้อน; แนะนำใช้ volume (A) แทน

---

## 3) Backup strategy สำหรับ Cloud

### ข้อจำกัดสำคัญ

Cloud volume ไม่ใช่ backup — ถ้าลบ service / ลบ volume / บัญชีถูกแบน ข้อมูลหายทั้งก้อน **ทันที**

### SOP สำรองข้อมูลสำหรับ Cloud

1. **Automated encrypted backup** (P3 — `scripts/sqlite-backup.ts` + cron):
   - `BACKUP_ENCRYPTION_KEY` env var เก็บ AES-256-GCM key
   - รัน `pnpm backup:sqlite` ทุก ๆ 6 ชั่วโมง (ผ่าน cron job ใน container หรือ Railway Cron Service)
   - ไฟล์ `.sqlite.enc` อยู่ใน `/data/backups/`
2. **Operator download** (manual, weekly):
   - ตั้งค่า → สำรองข้อมูล → ดาวน์โหลด `.sqlite.enc` ลงเครื่อง / Google Drive / S3 bucket อื่น
   - เก็บอย่างน้อย 4 รอบล่าสุด (4 สัปดาห์)
3. **Pre-release backup** (P4 — `scripts/update.sh` Step 2):
   - `scripts/update.sh` สร้าง `welfare-store-<ISO>.sqlite` ใน `/data/backups/` ก่อนทุก release
   - ดาวน์โหลดไฟล์นี้ก่อน confirm deploy ใน Railway Dashboard
4. **Restore drill** (quarterly):
   - ทดลอง restore จาก backup ที่ดาวน์โหลด → spin up instance ใหม่ → verify `system.health` + smoke test 4 core tables
   - ดู `docs/BACKUP_RESTORE_SOP_TH.md` Section "Restore Drill"

### What NOT to backup

- `/app/` — อยู่ใน git; restore ด้วย `git checkout <ref>`
- `/node_modules/` — regenerate ด้วย `pnpm install --frozen-lockfile`
- `/dist/` — regenerate ด้วย `pnpm build`
- `/data/logs/` — operational logs ไม่ใช่ business data

---

## 4) HTTPS setup สำหรับ Cloud

### Railway (auto-HTTPS)

- Railway จัดการ HTTPS ที่ edge ให้อัตโนมัติ — ลิงค์ `https://<project>-xxxx.up.railway.app` ใช้ได้ทันที
- Application ไม่ต้องตั้ง `HTTPS=1` หรือจัดการ certificate เอง
- **ผลพลอยได้**: กล้องสแกนบาร์โค้ด (BarcodeCameraModal) และกล้องถ่ายภาพ (CameraCaptureModal) ใช้ได้เลย เพราะ `getUserMedia()` ต้องการ secure context

### Self-hosted Cloud VM (AWS EC2 / GCP Compute / Azure VM)

ใช้ **Caddy** เป็น reverse proxy + auto-Let's Encrypt:

```caddyfile
pos.example.com {
    reverse_proxy localhost:3000
}
```

- Caddy ขอ Let's Encrypt cert อัตโนมัติ ตอนบูตครั้งแรก
- Application รัน `node dist/index.js` บน port 3000 (HTTP)
- Caddy รับ HTTPS 443 → forward ไป 3000

> โปรเจกต์มี `server/_core/https.ts` ที่สามารถตั้ง self-signed cert สำหรับ LAN ได้ (ใช้ตอน dev ในเครือข่ายท้องถิ่น) — แต่สำหรับ cloud production แนะนำให้ HTTPS สิ้นสุดที่ edge (Caddy / Railway)

### Cloudflare Tunnel (zero-port-open)

สำหรับกรณีที่ไม่อยากเปิด port ใด ๆ สู่ internet:

```bash
cloudflared tunnel --url http://localhost:3000
```

- ไม่ต้องเปิด firewall port
- Cloudflare จัดการ HTTPS + DDoS protection
- เหมาะกับการเชื่อม POS หน้าร้านเข้ากับ cloud DB โดยไม่ expose IP

---

## 5) การอัปเดตบน Cloud

### Railway (auto-deploy)

1. Merge PR เข้า `main` (หรือ `main-v2`)
2. Railway auto-detect → redeploy (build + restart)
3. ระหว่าง deploy แอป restart ~20-40 วินาที — Volume ไม่กระทบ ข้อมูลไม่หาย
4. หลัง deploy ตรวจ `system.health`:
   ```
   curl https://<project>.up.railway.app/api/trpc/system.health
   ```
   ต้องตอบ `{"status":"ok", "version":"1.0.0", "db":{"connected":true}, ...}`

### Self-hosted Cloud VM

```bash
./scripts/update.sh 1.0.1
```

`scripts/update.sh` (P4) ทำ 10 steps ครบ: pre-check → backup DB → backup config → git fetch → stop service → pnpm install → migrate → start → health check → log release

---

## 6) การ Rollback บน Cloud

### Railway

1. Dashboard → Service → **Deployments** → เลือก deployment ก่อนหน้า → **Redeploy**
2. ถ้า DB schema มี breaking change: ดาวน์โหลด backup `.sqlite.enc` ล่าสุด → `railway ssh` → restore ไป `/data/welfare-store.sqlite`
3. Verify `system.health` + smoke test

### Self-hosted Cloud VM

```bash
./scripts/rollback.sh
```

`scripts/rollback.sh` (P4) ทำ 7 steps: stop service → backup current (forensic) → restore DB → git checkout prev → start → health check → log rollback

---

## 7) การดูแลหลังการ deploy

### ตรวจสุขภาพระบบ

```bash
# Health endpoint (P4)
curl https://<host>/api/trpc/system.health

# คำตอบที่คาดหวัง:
# {"result":{"data":{"json":{
#   "status":"ok",
#   "version":"1.0.0",
#   "uptime":<seconds>,
#   "db":{"connected":true, "sizeBytes":<bytes>},
#   "memory":{"usedMB":<mb>, "totalMB":<mb>},
#   "timestamp":"<ISO>"
# }}}}
```

### ดู release log

หน้า **ตั้งค่า → ประวัติการ release** ในแอป (admin only — uses `system.releases` tRPC procedure)

### Smoke test หลัง deploy

- [ ] Login ด้วย admin → 200 OK
- [ ] เปิดหน้า POS → สินค้าโชว์ → 200 OK
- [ ] บันทึก transaction ทดสอบ → 201 Created + receipt พิมพ์ได้
- [ ] หน้ารายงาน → โหลดข้อมูลสำเร็จ
- [ ] หน้าสต็อก → CRUD สินค้า ได้

---

## 8) Migration Cloud → On-Premise (และกลับ)

เพราะ codebase ชุดเดียวกัน — migration คือ data + config change ไม่ใช่ code change:

### Cloud → On-Premise

1. Download encrypted backup จาก cloud (`.sqlite.enc`)
2. ติดตั้ง on-prem ผ่าน `docker-compose up -d --build`
3. กู้คืน DB ด้วย `pnpm backup:sqlite:restore` (P3 — ใส่ `BACKUP_ENCRYPTION_KEY`)
4. ตั้ง `DEPLOYMENT_MODE=onpremise` ใน `/config/.env`
5. Verify `system.health` + smoke test

### On-Premise → Cloud

1. สำรองข้อมูลจาก on-prem (`./data/welfare-store.sqlite`)
2. สร้าง service ใหม่บน Railway ตาม `docs/RAILWAY.md`
3. `railway ssh` → ก๊อปไฟล์ SQLite เข้า `/data/welfare-store.sqlite` (ทางเลือก 7ก ใน RAILWAY.md)
4. ตั้ง `DEPLOYMENT_MODE=cloud`
5. Restart service → verify

---

## อ้างอิง

- `docs/RAILWAY.md` — คู่มือ Railway แบบ 10 นาที (step-by-step)
- `docs/ON_PREMISE_STRUCTURE_TH.md` — โครงสร้างไดเรกทอรี On-Premise
- `docs/BACKUP_RESTORE_SOP_TH.md` — backup encryption + restore drill (P3)
- `docs/RELEASE_CHECKLIST_TH.md` — release checklist (P6)
- `docs/TECHNICAL_REVIEW_DEPLOYMENT_HANDOFF_TH.md` Section 4 — แนวทาง deployment ใหม่ (one codebase)
- `railway.json` — Railway build/deploy config
- `Dockerfile` — container image definition (P5)
- `docker-compose.yml` — on-premise orchestration (P5)
- `server/_core/deployment.ts` — deployment mode helpers (P5)
- `scripts/update.sh` — 10-step update flow (P4)
- `scripts/rollback.sh` — 7-step rollback flow (P4)
