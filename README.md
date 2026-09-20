# PNG Shop — ร้านค้าสวัสดิการโรงพยาบาล

เว็บแอปร้านค้าสวัสดิการสำหรับใช้งานภายในโรงพยาบาล โดยออกแบบให้เจ้าหน้าที่ใช้งานหน้า POS ได้รวดเร็ว และผู้บริหารติดตามยอดขาย สต็อก สมาชิก และรายการ Log ได้จากแดชบอร์ดเดียว

## สถานะปัจจุบัน

ระบบชุดนี้มี **UI prototype ที่ใช้งานและทดสอบ workflow ได้**, ระบบทดสอบ SQLite สำหรับสมาชิกและธุรกรรม, ระบบ backup/restore SQLite และชุดทดสอบอัตโนมัติ ส่วนการเชื่อมข้อมูลธุรกิจเข้าฐานข้อมูล production และการเข้าสู่ระบบจริงยังอาศัยโครงสร้าง Manus WebDev ที่เตรียมไว้และควรทำเป็นงานถัดไป

> ข้อมูลตัวอย่างที่เห็นบนหน้าจอเป็น mock data เพื่อสาธิต workflow ห้ามใช้เป็นข้อมูลผู้ป่วยหรือข้อมูลจริง

## เริ่มต้นสำหรับนักพัฒนา

### ความต้องการของเครื่อง

- Node.js **22 ขึ้นไป** เพราะ local SQLite ใช้ `node:sqlite`
- pnpm 10 ขึ้นไป
- Git

ตรวจสอบเวอร์ชัน:

```bash
node --version
pnpm --version
git --version
```

### ดึงโปรเจกต์จาก GitHub

```bash
git clone https://github.com/nikorn2527-stack/Shop.git
cd Shop
```

### ติดตั้งและเปิดเว็บ

```bash
pnpm install
pnpm dev
```

เปิด `http://localhost:3000` ในเบราว์เซอร์ คำสั่ง `dev` ใช้ `cross-env` จึงรองรับ Windows PowerShell, macOS และ Linux

ฐานข้อมูลใหม่บนโหมด dev จะสร้างบัญชีทดสอบให้อัตโนมัติ (`kanyanat` / `woraphot` · รหัส `1234`) และข้ามหน้าลงทะเบียนครั้งแรก

> ดึงข้อมูลร้านจริงมาใช้บนเครื่องตัวเอง (โฟลเดอร์ `data/` ไม่อยู่ใน git)
> และวิธีใช้งานจริงในร้าน ดูคู่มือฉบับเต็ม: **[docs/LOCAL-SETUP.md](docs/LOCAL-SETUP.md)**

### ตรวจสอบก่อนส่งงาน

```bash
pnpm test       # unit tests ทั้งหมด
pnpm check      # TypeScript
pnpm build      # production build
```

หากทำงานเฉพาะ SQLite:

```bash
pnpm test:sqlite
```

## คู่มือฟีเจอร์

### หน้าภาพรวม

แดชบอร์ดแสดงยอดขาย สมาชิกที่ใช้งาน สินค้าที่ต้องติดตาม ยอดเงินสมาชิก กราฟยอดขาย สินค้าใกล้หมดสต็อก สินค้าใกล้หมดอายุ และกิจกรรมล่าสุด

### หน้าร้าน / POS

เจ้าหน้าที่ค้นหาสินค้าหรือจำลองการสแกนบาร์โค้ด เพิ่มสินค้าเดิมซ้ำเพื่อเพิ่มจำนวน เลือกสมาชิก วิธีชำระเงิน และใช้รายการทางลัดสำหรับเติมเงิน ถอนเงิน หรือรายการพิเศษ หลังชำระเงินจะแสดง receipt preview พร้อมดาวน์โหลด PDF/รูปภาพและพิมพ์ใบเสร็จ

### สมาชิกและบัญชี

ค้นหาและกรองสมาชิกตามสถานะ เปิดหน้ารายละเอียดเพื่อดูการซื้อ เติมเงิน และถอนเงิน ระงับสมาชิกผ่าน confirmation dialog และลงทะเบียนสมาชิกพร้อมกำหนดเงินเริ่มต้นได้

### สต็อก รายงาน และตั้งค่า

หน้าจอรองรับโครงสร้างสำหรับรับเข้าและนับสต็อก วิเคราะห์สินค้าขายดี รายงานตามช่วงเวลา และตั้งค่าวิธีกำหนดเลขสมาชิก เมนูผู้บริหารจะถูกควบคุมด้วย role switch ใน prototype

## SQLite local test

SQLite adapter อยู่ที่ `server/sqliteStore.ts` และใช้สำหรับทดสอบรายละเอียดสมาชิก ประวัติธุรกรรม และการตั้งค่าเลขสมาชิกโดยไม่ต้องติดตั้ง native package

```bash
pnpm test:sqlite
```

คำสั่ง backup อยู่ใน `scripts/sqlite-backup.ts`:

```bash
pnpm backup:sqlite
pnpm backup:sqlite:verify data/backups/<backup-file>.sqlite
pnpm backup:sqlite:restore data/backups/<backup-file>.sqlite data/restored.sqlite
```

อ่านรายละเอียดการตั้ง cron, retention และ restore ได้ที่ [`docs/sqlite-backup.md`](docs/sqlite-backup.md)

## โครงสร้างโค้ด

| ตำแหน่ง | หน้าที่ |
| --- | --- |
| `client/src/App.tsx` | route หลักและ provider ของแอป |
| `client/src/pages/Home.tsx` | หน้าหลักและหน้า feature ของ prototype |
| `client/src/index.css` | design tokens, typography และ responsive styles |
| `server/routers.ts` | tRPC procedures ของ backend |
| `server/db.ts` | database helpers ของ Drizzle |
| `server/sqliteStore.ts` | SQLite adapter สำหรับ local test |
| `server/sqliteBackup.ts` | backup, verify, retention และ restore |
| `server/*.test.ts` | unit tests ฝั่ง server |
| `client/src/pages/Home.test.ts` | unit tests ตรรกะ POS |
| `drizzle/schema.ts` | schema สำหรับ database หลักของ template |
| `scripts/` | CLI และตัวติดตั้งงาน backup |
| `docs/` | คู่มือทีมและเอกสารปฏิบัติการ |

รายละเอียดภาพรวมระบบและเส้นทางข้อมูลอยู่ที่ [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## แนวทางทำงานเป็นทีม

1. สร้าง branch จาก `main` เช่น `feat/member-transaction-api` หรือ `fix/windows-dev-script`
2. แก้โค้ดพร้อมเพิ่มหรือแก้ test ที่เกี่ยวข้อง
3. รัน `pnpm test && pnpm check && pnpm build`
4. ตรวจ `git diff --check`
5. เปิด Pull Request พร้อมระบุสิ่งที่เปลี่ยน วิธีทดสอบ และข้อจำกัด
6. ห้าม commit `.env`, token, ข้อมูลสมาชิกจริง, SQLite file, backup file หรือ log ที่มีข้อมูลส่วนบุคคล

## ข้อจำกัดที่ทีมควรรู้

- Prototype UI ยังมีข้อมูล mock และยังไม่ใช่ระบบบัญชีเงินจริง
- `node:sqlite` ต้องใช้ Node.js 22 ขึ้นไป
- ห้ามใช้ `setInterval`, `node-cron` หรือ timer ใน production server เพราะ instance อาจถูกหยุดได้
- งานส่งอีเมลอัตโนมัติควรใช้ scheduled HTTP/Heartbeat หรือบริการ queue ที่กำหนดชัดเจนในงานแยก
- ข้อมูลสมาชิกและเลขบัตรประชาชนเป็นข้อมูลอ่อนไหว ควรเก็บเท่าที่จำเป็น ปิดบังในรายงาน และควบคุมสิทธิ์ฝั่ง server ไม่ใช่เพียงซ่อนเมนู

## References

เอกสารภายในโปรเจกต์:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/sqlite-backup.md`](docs/sqlite-backup.md)
