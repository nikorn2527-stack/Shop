# PNG Shop — Deployment Guideline

**One Codebase – Two Deployment Models** (Cloud + On-Premise)

สำหรับ: Development / DevOps / Infrastructure / Support
เอกสารนี้กำหนดหลักการและโครงสร้างสำหรับการติดตั้งระบบ PNG Shop บนทั้ง Cloud และ On-Premise โดยใช้ Docker image เดียวกัน แยก Configuration และ Persistent Data ออกจากกัน

---

## 1. โครงสร้าง Directory

ตาม Deployment Guideline Section 4 — ข้อมูลที่ต้องคงอยู่ถูกแยกออกจาก Application lifecycle:

```
/app             ← Application / Container definition (read-only after deploy)
  ├── .next/      ← Next.js build output (standalone)
  ├── public/     ← static assets (fonts, icons)
  ├── prisma/     ← schema + migrations
  ├── scripts/    ← migration + backup scripts
  └── server.js   ← Next.js standalone server entry

/data            ← Database persistent storage (SQLite file)
/uploads         ← Documents / images / attachments จากผู้ใช้
/config          ← Environment / settings / certificates (mounted, not embedded)
/backups         ← Database + file backups (separate from /data)
/logs            ← Application / operational logs
```

**หลักการสำคัญ**: การอัปเดต Application ต้องไม่ลบหรือเขียนทับ `/data`, `/uploads`, `/config`, `/backups`, `/logs` โดยตรง — ทั้งหมดเป็น Docker volumes แยกออกจาก image

---

## 2. Build & Deploy

### 2.1 Build Docker image

```bash
# Local build
docker build -t png-shop:1.0.0 .

# CI/CD pipeline (GitHub Actions example)
docker build \
  --build-arg APP_VERSION=$(git describe --tags) \
  --build-arg APP_BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --build-arg APP_COMMIT_SHA=$(git rev-parse --short HEAD) \
  -t ghcr.io/your-org/png-shop:1.0.0 \
  -t ghcr.io/your-org/png-shop:latest \
  .
```

### 2.2 Push to registry

```bash
# Cloud (push to private registry)
docker push ghcr.io/your-org/png-shop:1.0.0
docker push ghcr.io/your-org/png-shop:latest
```

### 2.3 Run (Cloud — Railway / Vercel / Fly.io)

```bash
# Railway
railway run -- docker run -d \
  -p 3000:3000 \
  -v railway-volume:/app/data \
  -e DATABASE_URL=file:/app/data/custom.db \
  -e SESSION_SECRET=$SESSION_SECRET \
  ghcr.io/your-org/png-shop:1.0.0

# Fly.io (with volumes)
fly volumes create png_shop_data --size 1
fly deploy --image ghcr.io/your-org/png-shop:1.0.0
```

### 2.4 Run (On-Premise — หน่วยงานลูกค้า)

```bash
# 1. ดาวน์โหลด image (offline package ถ้าไม่มี internet)
docker load -i png-shop-1.0.0.tar

# 2. สร้าง volumes
docker volume create png-shop-data
docker volume create png-shop-uploads
docker volume create png-shop-config
docker volume create png-shop-backups
docker volume create png-shop-logs

# 3. รันด้วย docker-compose
docker compose up -d
```

---

## 3. การอัปเดตระบบ (Update Flow)

ตาม Deployment Guideline Section 5 — ไม่ใช้ git pull / manual edit บนเครื่องลูกค้า

```
Step 01 - Pre-check: ตรวจสอบ version, disk space, service health
Step 02 - Backup DB (/app/data/custom.db → /app/backups/custom.db.YYYYMMDD-HHMMSS)
Step 03 - Backup config (ถ้ามีการเปลี่ยน env)
Step 04 - Pull new image: docker pull ghcr.io/your-org/png-shop:1.1.0
Step 05 - Stop current container: docker compose down
Step 06 - Update image tag in docker-compose.yml
Step 07 - Start new container: docker compose up -d
Step 08 - Run database migration (auto ใน CMD ของ Dockerfile)
Step 09 - Health check: curl /api/system/version (ต้องได้ 200)
Step 10 - บันทึก version ใหม่ในตาราง SystemVersion
```

### Rollback rule

หาก Migration หรือ Health Check ไม่ผ่าน:

```bash
# 1. Stop new container
docker compose down

# 2. Restore DB from backup
docker run --rm -v png-shop-data:/data -v png-shop-backups:/backups alpine \
  sh -c "cp /backups/custom.db.YYYYMMDD-HHMMSS /data/custom.db"

# 3. Revert image tag in docker-compose.yml to previous version
# 4. Start previous container
docker compose up -d
```

---

## 4. Backup & Restore

### 4.1 Manual backup

```bash
# สำรอง DB
docker exec png-shop sqlite3 /app/data/custom.db ".backup /app/backups/custom.db.$(date +%Y%m%d-%H%M%S)"

# Verify
docker exec png-shop sqlite3 /app/backups/custom.db.YYYYMMDD-HHMMSS "PRAGMA integrity_check;"

# สำรอง uploads (incremental)
docker run --rm -v png-shop-uploads:/src -v png-shop-backups:/dst alpine \
  sh -c "rsync -av --delete /src/ /dst/uploads/"
```

### 4.2 Auto backup (cron ใน container)

```bash
# ตั้ง cron รายวัน 02:00 กท.
echo "0 2 * * * sqlite3 /app/data/custom.db '.backup /app/backups/auto-\$(date +\%Y\%m\%d).db'" | crontab -
```

### 4.3 Restore

```bash
docker compose down
docker run --rm -v png-shop-data:/data -v png-shop-backups:/backups alpine \
  sh -c "cp /backups/custom.db.YYYYMMDD-HHMMSS /data/custom.db"
docker compose up -d
```

---

## 5. Cutover Plan (Migration จาก Shop เดิม → Next.js)

สำหรับการย้ายระบบจาก Vite + tRPC + node:sqlite ไปเป็น Next.js + Prisma บน production

### Pre-cutover (T-7 วัน)

- [ ] ทดสอบ migration script บนสำเนา DB ลูกค้าจริง (dry-run + live)
- [ ] deploy dev branch ขึ้น staging environment
- [ ] ทดสอบ login ด้วยบัญชีเดิมของลูกค้า → dual-verify scrypt + auto-rehash
- [ ] ทดสอบ flow ครบ: POS checkout, void, ดูประวัติบิล, รายงาน, สต็อก
- [ ] ตรวจสอบว่า session token ของลูกค้าที่ login อยู่ ยังใช้ได้หลัง migrate
- [ ] backup DB production (download welfare-store.sqlite)

### Cutover day (T-0)

```
T-30 min: แจ้งลูกค้า — ระบบจะปิดปรับปรุงชั่วคราว 30 นาที
T-15 min: ตั้ง maintenance mode (return 503 ทุก request, แสดงหน้า "กำลังปรับปรุง")
T-00:    สำรอง DB production ล่าสุด (safety backup #2)
T+05:    deploy Docker image ใหม่ (Next.js + Prisma)
T+10:    รัน migration script บน DB production:
            docker exec png-shop node scripts/migrate-from-shop.ts /app/data/migration-source.sqlite
T+15:    ตรวจสอบ row counts (user/member/sale/stock) ตรงกับต้นทาง
T+20:    ทดสอบ smoke test: login → ดู dashboard → เปิดบิลเก่า → ดู reports
T+25:    ปิด maintenance mode — ลูกค้าเข้าใช้ต่อได้
T+30:    ยืนยันกับลูกค้าว่าใช้งานได้ปกติ
```

### Rollback (ถ้า cutover fail)

```
T+15:    ถ้า migration fail → ดู log, หาสาเหตุ
T+20:    docker compose down (Next.js version)
T+25:    restore DB จาก safety backup #2:
            cp /app/backups/custom.db.YYYYMMDD-HHMMSS /app/data/custom.db
T+30:    start old version (Vite + tRPC) บน Docker image เดิม
T+35:    ลูกค้าเข้าใช้ต่อได้ (ข้อมูลไม่หาย)
```

### Post-cutover (T+1 วัน)

- [ ] ตรวจสอบ auto-rehash: ดูว่ามี user ที่ login สำเร็จ → password_hash เปลี่ยนจาก `scrypt$...` เป็น `$2a$...`
- [ ] ลบ scrypt hashes ที่เหลือ (optional — หลัง 7 วันทุกคน login แล้ว)
- [ ] ลบ safety backup #1 (เก็บ #2 ไว้ 30 วัน)

---

## 6. Security Baseline (On-Premise)

- [ ] ใช้ HTTPS/TLS (Reverse proxy + certificate ของหน่วยงาน)
- [ ] แยกสิทธิ์ Admin ระบบออกจากผู้ใช้ทั่วไป (non-root user ใน container)
- [ ] ไม่ฝัง Password/Token ใน Docker image (ใช้ env vars + secrets manager)
- [ ] ปิด port ที่ไม่ใช้ (เปิดเฉพาะ 3000)
- [ ] เก็บ Audit Log สำหรับ login, เปลี่ยนค่าระบบ, update, backup, restore
- [ ] Patch OS + Docker runtime ร่วมกับฝ่าย IT ลูกค้า
- [ ] Remote support ผ่าน VPN ที่หน่วยงานควบคุมเท่านั้น

---

## 7. Environment Variables

| Variable | ค่าตัวอย่าง | หมายเหตุ |
|---|---|---|
| `DATABASE_URL` | `file:/app/data/custom.db` | SQLite path |
| `SESSION_SECRET` | `<random-32-bytes>` | สำหรับ sign session cookie |
| `UPLOAD_DIR` | `/app/uploads` | ที่เก็บไฟล์ที่อัปโหลด |
| `BACKUP_DIR` | `/app/backups` | ที่เก็บ backup |
| `LOG_DIR` | `/app/logs` | ที่เก็บ log |
| `CONFIG_DIR` | `/app/config` | env files / certificates |
| `APP_VERSION` | `1.0.0` | แสดงในหน้า System Update |
| `APP_BUILD_DATE` | `2026-09-24T18:00:00Z` | build timestamp |
| `APP_COMMIT_SHA` | `713869f` | git commit SHA |

---

## 8. Checklist ก่อนถือว่ารองรับ On-Premise (Section 13)

- [x] Application ติดตั้งจาก Docker image ได้โดยไม่แก้ source code
- [x] DB และ Uploaded Files แยกจาก app lifecycle (Docker volumes)
- [x] มี backup ก่อน update + ตรวจสอบ backup สำเร็จ
- [x] Database migration มี version (Prisma migrate + SystemVersion table)
- [x] มี health check (`/api/system/health`)
- [x] มี rollback procedure (Section 3)
- [x] Configuration/Secret ไม่ฝังใน image (env vars + .env file)
- [x] ระบุ version ของทุก environment ได้ (`/api/system/version`)
- [ ] มี Log ที่เพียงพอสำหรับ troubleshooting (TODO: structured logging)
- [x] มี SOP ติดตั้ง, Update, Backup, Restore (เอกสารนี้)
- [ ] ผ่านการทดสอบ Restore จาก Backup จริง (TODO: staging test)
- [x] รายการ port/network dependency (port 3000 เท่านั้น)
