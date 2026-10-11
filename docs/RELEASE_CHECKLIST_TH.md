# คู่มือ Checklist สำหรับ Release (Release Checklist)

> เอกสารนี้คือ checklist มาตรฐานสำหรับทุก release ของ PNG Shop — ครอบคลุมทั้ง pre-release, deploy, post-release, rollback, และ hotfix ฉุกเฉิน
>
> Pre-release section ถูก automation ใน `scripts/release-checklist.sh` — รันก่อนทุกครั้ง
>
> สำหรับ release ปกติ: ใช้ Pre-release + Deploy + Post-release + Rollback Plan (หากต้อง)
> สำหรับ hotfix ฉุกเฉิน: ใช้ Emergency Hotfix Procedure ด้านล่าง

---

## 1) Pre-release Checklist (ก่อน release)

### Automated (run `scripts/release-checklist.sh`)

```bash
./scripts/release-checklist.sh
```

Script ตรวจ 7 รายการ:
1. Version จาก `package.json`
2. TypeScript check (`npx tsc --noEmit`) — **HARD gate**, ต้อง 0 errors
3. Production build (`pnpm run build`) — **HARD gate**, ต้องสำเร็จ
4. Tests (`pnpm test:sqlite`) — SOFT (warning หาก fail)
5. Git working tree clean — SOFT (warning หากมี uncommitted changes)
6. Schema version — info (check via `system.health` หลัง deploy)
7. Backup exists in `data/backups/` — SOFT (warning หากไม่มี)

> Script ใช้ `set -euo pipefail` — หยุดทันทีเมื่อ HARD check ล้มเหลว; SOFT แค่ warning ไม่หยุด

### Manual (รอบล่าง operator)

- [ ] **CHANGELOG / commit history ระบุ version ใหม่** — ดู `git log --oneline v<previous>..HEAD`
- [ ] **Migration plan (ถ้ามี schema change)** — `pnpm db:push` idempotent แต่ต้องมี rollback plan สำหรับ data change
- [ ] **Backup สำเร็จ** — `pnpm backup:sqlite` ผ่าน; ไฟล์ `.sqlite.enc` อยู่ใน `data/backups/`
- [ ] **Smoke test บนเครื่อง dev ผ่าน** — login, POS checkout, void/refund, wallet tx, reports load, settings save
- [ ] **Health endpoint ตอบ OK บนเครื่อง dev** — `curl http://localhost:3000/api/trpc/system.health`
- [ ] **RBAC enforcement ยังใช้ได้** — anonymous โดน 401, staff ทำงานได้, admin ops โดน FORBIDDEN (ดู `worklog.md` P1 + P1-fix)
- [ ] **ระบบ backup encryption key ยังใช้ได้** — `BACKUP_ENCRYPTION_KEY` ใน `.env` ไม่หมดอายุ

---

## 2) Deploy Checklist (ตอน release)

### สำหรับ On-Premise (รัน `scripts/update.sh`)

```bash
# 1. (Optional) ดึงโค้ดใหม่ลงเครื่อง operator ก่อน
git fetch origin --tags
git checkout v<new-version>   # หรือ main / main-v2

# 2. รัน update script (ทำ 10 steps อัตโนมัติ)
./scripts/update.sh <new-version>
```

`scripts/update.sh` ทำ 10 steps:
1. Pre-check: version, disk space ≥200MB, Node ≥20, pnpm, git, service health
2. Backup database → `data/backups/welfare-store-<ISO>.sqlite`
3. Backup configuration → `data/backups/config-<ISO>/` (.env, https/, Caddyfile)
4. Pull artifact: `git fetch origin --tags --force` + checkout ref
5. Stop service: `lsof -ti tcp:${PORT}` → SIGTERM → SIGKILL fallback
6. Update package: `pnpm install --frozen-lockfile`
7. Run migrations: `pnpm db:push`
8. Start service: `NODE_ENV=production nohup pnpm start`
9. Health check + smoke test 4 core tables (`app_users`, `members`, `store_settings`, `products`)
10. Log release: POST `/api/trpc/system.logRelease` (optional auth via `RELEASE_LOG_DEV_USER`)

### สำหรับ Cloud (Railway auto-deploy)

1. Merge PR เข้า `main` (หรือ `main-v2`)
2. Railway auto-build + redeploy (~3-6 นาที)
3. ระหว่าง deploy แอป restart ~20-40 วินาที — Volume ไม่กระทบ
4. หลัง deploy ตรวจสอบด้วย:
   ```bash
   curl https://<project>.up.railway.app/api/trpc/system.health
   ```
   คำตอบที่คาดหวัง: `{"status":"ok", "version":"<new-version>", "db":{"connected":true}, ...}`

### สำหรับ Docker Compose (On-Premise)

```bash
git pull
docker compose up -d --build
docker compose logs -f png-shop   # watch startup
```

### Health check หลัง deploy (ทั้งสามโหมด)

```bash
# 1. HTTP health endpoint (P4)
curl -fsS https://<host>/api/trpc/system.health | jq

# 2. Smoke test 4 core tables (run inside container หรือบน host)
node -e "
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync('data/welfare-store.sqlite');
const rows = db.prepare('SELECT name FROM sqlite_master WHERE type=\"table\"').all();
const required = ['app_users', 'members', 'store_settings', 'products'];
const missing = required.filter(r => !rows.some(row => row.name === r));
if (missing.length) { console.error('MISSING:', missing); process.exit(1); }
console.log('✓ 4 core tables present');
"
```

### Smoke test UI

- [ ] Login admin → 200 OK
- [ ] หน้า POS → สินค้าโชว์ → checkout → receipt พิมพ์ได้
- [ ] หน้าสต็อก → CRUD สินค้า ได้
- [ ] หน้ารายงาน → โหลดข้อมูลสำเร็จ (today + 7 วัน + 30 วัน)
- [ ] หน้าตั้งค่า → save สำเร็จ (ลองแก้ PromptPay number + save)
- [ ] หน้าสมาชิก → ลงทะเบียน + ฝาก-ถอน wallet ได้
- [ ] Void / refund transaction → ปิดยอดประจำวัน → report daily โชว์ยอดถูก

---

## 3) Post-release Checklist (หลัง release)

- [ ] **บันทึก release log** — verify ในแอป: ตั้งค่า → ประวัติการ release มี entry ใหม่ (action = "อัปเดตระบบ", version = `<new-version>`)
  - ถ้า `scripts/update.sh` ไม่ได้ auto-log (เพราะไม่ใส่ `RELEASE_LOG_DEV_USER/PASS`): บันทึกเองผ่าน UI หน้าตั้งค่า → ประวัติ release → เพิ่ม entry
- [ ] **ตรวจสอบ backup ใหม่** — ไฟล์ `welfare-store-<ISO>.sqlite` อยู่ใน `data/backups/`; ดาวน์โหลดเก็บ offline
- [ ] **อัปเดต version tag** — `git tag v<new-version> && git push origin v<new-version>` (หากยังไม่ทำ)
- [ ] **Verify schema version** — `system.health` ตอบ `db.connected: true` + ขนาด DB ไม่ลดลงผิดธรรมชาติ
- [ ] **Verify cron backup ยังทำงาน** — `crontab -l | grep sqlite-backup` (On-Premise) หรือ Railway Cron Service (Cloud)
- [ ] **Monitor 24 ชม.แรก** —
  - ตรวจ `data/logs/update-<ISO>.log` (On-Premise) หรือ Railway logs (Cloud)
  - ดู audit log ในแอป: ตั้งค่า → ประวัติการทำงาน → ไม่มี error แปลก ๆ
- [ ] **Announce** — ส่งข้อความให้เจ้าหน้าที่ทราบว่า "อัปเดตเสร็จแล้ว กรุณา logout แล้ว login ใหม่"

---

## 4) Rollback Procedure

### เมื่อไหร่ต้อง rollback?

Rollback ทันทีถ้า:
- Health check ล้มเหลวหลัง deploy (curl system.health ตอบ non-200 หรือ timeout)
- Smoke test UI ล้มเหลว (login ไม่ได้, checkout ไม่ได้, reports error)
- พบ data corruption (transaction หาย, balance ผิด, member หาย)
- Audit log มี error spike ผิดปกติ

### ขั้นตอน Rollback

#### สำหรับ On-Premise (รัน `scripts/rollback.sh`)

```bash
./scripts/rollback.sh
```

`scripts/rollback.sh` ทำ 7 steps:
1. **Stop service** — SIGTERM → SIGKILL fallback
2. **Backup current DB** (forensic) → `data/backups/welfare-store-rollback-source-<ISO>.sqlite` (เก็บ broken state ไว้ตรวจสอบ)
3. **Restore DB** — verify SQLite magic header → `cp -p <backup-file> data/welfare-store.sqlite` → `PRAGMA integrity_check`
4. **Git checkout previous** — `git checkout HEAD@{1}` (fallback `HEAD^` หรือ `GIT_PREV_REF` env var)
5. **Start service** — `pnpm install --frozen-lockfile && pnpm start`
6. **Health check** — same as update.sh step 9
7. **Log rollback** — POST `/api/trpc/system.logRelease` ด้วย `action: "rollback"`

#### สำหรับ Cloud (Railway)

1. Dashboard → Service → **Deployments** → เลือก deployment ก่อนหน้า → **Redeploy**
2. ถ้า DB schema มี breaking change:
   - ดาวน์โหลด backup `.sqlite.enc` ล่าสุดจาก Railway (Settings → Volumes → browse `/data/backups/`)
   - ถอดรหัส: `pnpm backup:sqlite:restore` บนเครื่อง local
   - `railway ssh` → upload restored SQLite → `cp welfare-store.sqlite /data/welfare-store.sqlite`
3. Restart service → verify `system.health`

#### สำหรับ Docker Compose

```bash
# 1. Stop
docker compose down

# 2. Restore DB from backup
cp data/backups/welfare-store-<ISO>.sqlite data/welfare-store.sqlite

# 3. Rollback code
git checkout <previous-tag>

# 4. Rebuild + start
docker compose up -d --build

# 5. Verify
curl http://localhost:3000/api/trpc/system.health
```

### Pre-rollback checklist

- [ ] ระบุ root cause ของปัญหา (อย่า rollback สุ่ม ๆ — อาจเป็น data corruption ที่จะกลับมาทำงานกับ rollback ก็ไม่ดีขึ้น)
- [ ] สำรองสถานะปัจจุบัน (broken state) ก่อน — จะได้มี forensic evidence
- [ ] ตรวจ backup file ที่จะ restore: magic header + `PRAGMA integrity_check`
- [ ] ตรวจ release log ล่าสุดเพื่อยืนยันว่า rollback ไปที่ version ไหน (`system.releases`)
- [ ] Estimate RTO (recovery time objective): rollback เอง ~5-10 นาที; ถ้า DB restore ใหญ่ อาจนานถึง 30 นาที

### Post-rollback checklist

- [ ] Verify `system.health` → 200 OK + db connected
- [ ] Smoke test UI (login + POS checkout + reports)
- [ ] บันทึก release log entry: action = "ย้อนระบบกลับ", version = `rollback-<ISO>`, notes = root cause
- [ ] Notify stakeholders: "ระบบย้อนกลับเป็น version `<previous>` แล้ว ปัญหา `<root-cause>` อยู่ระหว่างตรวจสอบ"
- [ ] ตั้ง issue สำหรับ root cause analysis (RCA) — อย่าลืม

---

## 5) Emergency Hotfix Procedure

### เมื่อไหร่ใช้?

Hotfix ใช้เมื่อ:
- Production ล่ม (health check fail ทุก node / curl ตอบ 500/timeout)
- Data loss / corruption ที่กระทบผู้ใช้จริง
- Security vulnerability ที่ active exploit
- ห้ามใช้ hotfix สำหรับ: feature request, minor bug, cosmetic — ใช้ release ปกติ

### ขั้นตอน Hotfix

#### Step 1: Triage (≤15 นาที)

1. ระบุ severity:
   - **P0 (Critical)**: ระบบล่ม, หาเงินไม่ได้ → hotfix ทันที
   - **P1 (High)**: feature หลักพังบางส่วน → hotfix ภายใน 4 ชม.
   - **P2 (Medium)**: workaround มี → release ปกติ
2. สื่อสารกับ stakeholder: "เรากำลังดำเนินการ คาดว่าใช้เวลา <estimate>"
3. สำรองสถานะปัจจุบันก่อนทำอะไร: `cp -p data/welfare-store.sqlite data/backups/welfare-store-hotfix-source-<ISO>.sqlite`

#### Step 2: Branch + Fix

```bash
# จาก main-v2 (หรือ main ถ้าเป็น stable branch)
git checkout main-v2
git pull origin main-v2
git checkout -b hotfix/<issue-id>-<short-description>

# แก้โค้ด — น้อยที่สุด ๆ, focus on the bug only
# ไม่ refactor, ไม่เพิ่ม feature, ไม่ล้าง DB

# ทดสอบ:
pnpm check                          # TypeScript 0 errors
pnpm run build                       # build สำเร็จ
pnpm test:sqlite                     # tests pass (optional — focus on the fix)
# Smoke test on dev server
PORT=3199 pnpm dev                   # boot dev server on alt port
# curl + manual UI test
```

#### Step 3: Fast-track review + merge

1. PR + 1 reviewer minimum (แม้ fast-track)
2. Verify diff minimal: `git diff main-v2...hotfix/<issue>` — ต้องไม่เกิน 200 บรรทัดที่แก้
3. Merge: `git checkout main-v2 && git merge --no-ff hotfix/<issue>`
4. Tag: `git tag v<current>+hotfix.<n>` (e.g. `v1.0.0+hotfix.1`)
5. Push: `git push origin main-v2 --tags`

#### Step 4: Deploy hotfix

```bash
./scripts/update.sh v1.0.0+hotfix.1
```

#### Step 5: Verify + log

- [ ] `system.health` → 200 OK, version = `1.0.0+hotfix.1`
- [ ] Smoke test UI (focus on the area that was broken)
- [ ] บันทึก release log: action = "Hotfix", version = `<hotfix-version>`, notes = root cause + fix
- [ ] Notify stakeholders: "hotfix deployed, ตรวจสอบ <broken-feature> กลับมาทำงาน"
- [ ] สร้าง follow-up issue: refactor / proper fix / RCA documentation (อย่าลืม — hotfix ไม่ใช่ทางแก้ถาวร)

---

## 6) Checklist Summary (one-page quick reference)

### Pre-release
- [ ] `./scripts/release-checklist.sh` ผ่าน (TypeScript 0 errors, build สำเร็จ)
- [ ] CHANGELOG / commit history ระบุ version
- [ ] Backup สำเร็จ (`.sqlite.enc` ใน `data/backups/`)
- [ ] Smoke test บน dev ผ่าน

### Deploy
- [ ] `./scripts/update.sh <version>` (On-Premise) หรือ merge PR (Cloud)
- [ ] `system.health` ตอบ 200 + version ใหม่
- [ ] Smoke test UI ผ่าน (login, POS, reports)

### Post-release
- [ ] Release log entry บันทึกแล้ว
- [ ] Backup ใหม่ดาวน์โหลด offline แล้ว
- [ ] Version tag push แล้ว
- [ ] Monitor 24 ชม.แรก

### Rollback (หากต้อง)
- [ ] `./scripts/rollback.sh` (On-Premise) หรือ Redeploy previous (Cloud)
- [ ] `system.health` → 200 OK
- [ ] Release log: action = "ย้อนระบบกลับ"
- [ ] RCA issue สร้างแล้ว

### Hotfix (emergency)
- [ ] Severity P0/P1 เท่านั้น
- [ ] Branch `hotfix/<issue>` + fix minimal
- [ ] 1 reviewer + merge + tag `<version>+hotfix.<n>`
- [ ] `./scripts/update.sh <hotfix-version>`
- [ ] Verify + log + notify + follow-up issue

---

## อ้างอิง

- `scripts/release-checklist.sh` — automated pre-release check (P6)
- `scripts/update.sh` — 10-step on-premise update flow (P4)
- `scripts/rollback.sh` — 7-step rollback flow (P4)
- `scripts/sqlite-backup.ts` — encrypted backup tool (P3)
- `docs/RELEASE_TEMPLATE_TH.md` — handover doc template (P4)
- `docs/BACKUP_RESTORE_SOP_TH.md` — backup encryption + restore drill (P3)
- `docs/ON_PREMISE_STRUCTURE_TH.md` — on-prem directory structure (P5)
- `docs/CLOUD_DEPLOYMENT_GUIDE_TH.md` — cloud deployment guide (P5)
- `docs/TECHNICAL_REVIEW_DEPLOYMENT_HANDOFF_TH.md` Section 5 — มาตรฐาน Update + Release
