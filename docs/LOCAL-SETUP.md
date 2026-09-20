# คู่มือติดตั้งและใช้งานบนเครื่อง Local

คู่มือสำหรับดึงระบบร้านค้าสวัสดิการจาก GitHub ลงมาใช้งานบนเครื่องของตัวเอง
ตั้งแต่ติดตั้ง รันแอป ดึงข้อมูลจริง ไปจนถึงใช้งานจริงในร้าน

---

## 1. สิ่งที่ต้องมีก่อน (ติดตั้งครั้งเดียว)

| โปรแกรม | เวอร์ชันขั้นต่ำ | ตรวจสอบ | ดาวน์โหลด |
|---|---|---|---|
| **Node.js** | **22 ขึ้นไป** (สำคัญ — ใช้ `node:sqlite` ในตัว) | `node --version` | https://nodejs.org (เลือก LTS) |
| **pnpm** | 10 ขึ้นไป | `pnpm --version` | `corepack enable` หรือ `npm i -g pnpm` |
| **Git** | ใดก็ได้ | `git --version` | https://git-scm.com |

> หาก `pnpm --version` ไม่ขึ้นอะไร รัน `corepack enable` ก่อนแล้วเปิด terminal ใหม่
> (corepack มาพร้อม Node.js แล้ว)

---

## 2. ดึงโปรเจกต์จาก GitHub

เปิด terminal (Windows: PowerShell หรือ CMD) แล้วรัน:

```bash
git clone https://github.com/nikorn2527-stack/Shop.git
cd Shop
```

ติดตั้ง dependency:

```bash
pnpm install
```

---

## 3. เปิดแอป (โหมดพัฒนา)

```bash
pnpm dev
```

แล้วเปิดเบราว์เซอร์ที่ **http://localhost:3000**

- คำสั่ง `dev` ใช้ `cross-env` จึงรันได้ทั้ง Windows / macOS / Linux
- ถ้าพอร์ต 3000 ถูกโปรแกรมอื่นใช้อยู่ ระบบจะหาพอร์ตว่างถัดไปให้เอง แล้วบอกใน terminal
- **ไม่ต้องสร้างไฟล์ .env** — ทุกค่ามี default ที่ใช้ได้ทันที (ดู `.env.example` หากต้องการปรับ)

### ล็อกอินครั้งแรก (โหมดพัฒนา)

เมื่อรันด้วยฐานข้อมูลใหม่ (`data/welfare-store.sqlite` ยังไม่มี) ระบบจะ
**สร้างบัญชีทดสอบให้อัตโนมัติ** แล้วเข้าหน้าล็อกอินได้เลย ไม่ต้องผ่านหน้าลงทะเบียนครั้งแรก:

| บัญชี | รหัสผ่าน | สิทธิ์ |
|---|---|---|
| `kanyanat` | `1234` | เจ้าหน้าที่ (staff) |
| `woraphot` | `1234` | ผู้บริหาร (admin) |

> บัญชีทดสอบชุดนี้สร้างเฉพาะโหมด `pnpm dev` เท่านั้น
> โหมด production (`pnpm start`) จะบังคับลงทะเบียนผู้บริหารจริงตามขั้นตอนปกติ

---

## 4. ดึงข้อมูลจริงมาใช้ (สำคัญที่สุด)

โฟลเดอร์ `data/` **ไม่ได้อยู่ใน git** (กันข้อมูลร้านหลุดขึ้น repository สาธารณะ)
ดังนั้นหลัง clone ใหม่จะได้ฐานข้อมูลเปล่า มี 2 วิธีดึงข้อมูลจริงมาใช้:

### วิธี A — คัดลอกไฟล์ฐานข้อมูลโดยตรง (ง่ายที่สุด)

1. จากเครื่อง/ระบบเดิม เอาไฟล์ `data/welfare-store.sqlite` มาให้ได้
   (สั่งสำรองจากเครื่องเดิมด้วย `pnpm backup:sqlite` ก็ได้ — ไฟล์จะอยู่ใน `data/backups/`)
2. ปิดแอปก่อน (Ctrl+C ใน terminal ที่รัน `pnpm dev`)
3. วางไฟล์ที่ `data/welfare-store.sqlite` ของเครื่องใหม่ (สร้างโฟลเดอร์ `data` ถ้ายังไม่มี)
4. รัน `pnpm dev` ใหม่ — ข้อมูลสมาชิก ยอดขาย สต็อก บัญชีผู้ใช้ทั้งหมดจะมาพร้อมกัน

### วิธี B — ใช้คำสั่งกู้คืนจากไฟล์สำรอง

```bash
# ตรวจไฟล์สำรองก่อนว่าใช้การได้
pnpm backup:sqlite:verify data/backups/<ชื่อไฟล์สำรอง>.sqlite

# กู้คืนไปที่ไฟล์หลัก (เขียนทับ ต้องระบุ --overwrite)
pnpm backup:sqlite:restore data/backups/<ชื่อไฟล์สำรอง>.sqlite data/welfare-store.sqlite --overwrite
```

> ทุกครั้งก่อนกู้คืน/เขียนทับ แนะนำสำรองไฟล์ปัจจุบันไว้ก่อนด้วย `pnpm backup:sqlite`

---

## 5. ใช้งานจริงในร้าน (โหมด production)

โหมด production เร็วกว่าและเหมาะกับการใช้งานต่อเนื่อง:

```bash
pnpm build
pnpm start
```

- ครั้งแรกจะให้ลงทะเบียนผู้บริหารจริง (ตั้งชื่อร้าน + บัญชีผู้บริหาร) ผ่านหน้า Setup
- แนะนำตั้ง `.env` อย่างน้อย `JWT_SECRET` (สุ่มด้วย:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)

### ให้เครื่องอื่นในร้านเข้าใช้ด้วย (LAN)

เปิด **ตั้งค่า → การเชื่อมต่อ** ในแอป จะมี URL ของเครื่อง (ตาม IP ใน LAN)
พร้อมปุ่มคัดลอกให้เครื่องอื่นเปิดผ่านเบราว์เซอร์ได้ทันที

---

## 6. การสำรองข้อมูล (อย่าลืมทำเป็นประจำ)

- สำรองด้วยตนเอง: `pnpm backup:sqlite` (ได้ไฟล์ timestamped + ตรวจ integrity ในตัว)
- ระบบสำรองอัตโนมัติทุกวัน 02:00 น. (เริ่มตรวจ 30 วินาทีหลังบูตเซิร์ฟเวอร์)
- ตั้งเวลา cron บนเครื่องเอง (ทุก 6 ชม. ฯลฯ): ดู `docs/sqlite-backup.md`
- ไฟล์อยู่ที่ `data/backups/` เก็บตาม retention (default 30 วัน)
- **ควรก๊อปไฟล์สำรองออกนอกเครื่องเป็นระยะ** (USB / cloud) กันกรณีเครื่องพัง

---

## 7. คำสั่งตรวจสอบ / พัฒนาต่อ

```bash
pnpm test        # ชุดทดสอบทั้งหมด (122 tests)
pnpm test:sqlite # ทดสอบเฉพาะส่วน SQLite (แบบ serial นิ่งกว่า)
pnpm check       # ตรวจ TypeScript
pnpm build       # สร้าง production build
```

---

## 8. ปัญหาที่พบบ่อย (Troubleshooting)

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `node:sqlite` ไม่มี / error ตอน `pnpm dev` | Node ต่ำกว่า 22 — อัปเดต Node.js เป็น LTS ล่าสุดแล้วรัน `pnpm install` ใหม่ |
| `pnpm: command not found` | รัน `corepack enable` แล้วปิด-เปิด terminal ใหม่ หรือ `npm i -g pnpm` |
| เปิด localhost:3000 แล้วว่าง/ไม่เข้า | ดู terminal ว่าพอร์ตถูกย้าย (จะบอก "using port ... instead") |
| ล็อกอินไม่ได้ แม้ใช้บัญชีทดสอบ | เกิดจากใช้ DB เดิมที่มีบัญชีจริง — บัญชีทดสอบสร้างเฉพาะ DB ใหม่ ใช้บัญชีจริงของร้านแทน |
| Windows: สคริปต์ถูกบล็อก (execution policy) | เปิด PowerShell เป็น Administrator แล้วรัน `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| ข้อมูลหายหลังย้ายเครื่อง | อย่าลืมโฟลเดอร์ `data/` — ดูหัวข้อ 4 ข้างบน |
| `pnpm install` ช้า/ล้ม | ลอง `pnpm install --fetch-timeout 120000` หรือตรวจ network/proxy |

---

## สรุปไฟล์/โฟลเดอร์ที่เกี่ยวข้อง

```
Shop/
├── data/
│   ├── welfare-store.sqlite      # ฐานข้อมูลจริง (ไม่อยู่ใน git!)
│   └── backups/                  # ไฟล์สำรอง timestamped
├── .env.example                  # ตัวอย่างการตั้งค่า (ไม่จำเป็นต้องใช้ตอน dev)
├── docs/
│   ├── LOCAL-SETUP.md            # คู่มือนี้
│   ├── sqlite-backup.md          # รายละเอียดระบบสำรองข้อมูล
│   └── ARCHITECTURE.md           # สถาปัตยกรรมโค้ด
└── scripts/sqlite-backup.ts      # สคริปต์ backup/verify/restore
```
