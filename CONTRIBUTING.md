# Team Handoff and Contribution Guide

## ก่อนเริ่มงาน

สร้าง branch จาก `main` และตั้งชื่อให้บอกประเภทงาน:

```bash
git checkout main
git pull origin main
git checkout -b feat/<short-name>
```

ตัวอย่าง: `feat/stock-receiving`, `fix/member-balance`, `docs/onboarding`

## ลำดับการแก้ฟีเจอร์

เริ่มจากกำหนด domain และสิทธิ์ก่อนแก้ UI หากเป็นข้อมูลจริงให้เริ่มที่ schema และ database helper จากนั้นเพิ่ม tRPC procedure แล้วจึงเชื่อม React page การเปลี่ยนแปลงที่กระทบเงิน สต็อก สมาชิก หรือรายงานต้องมี test ก่อนเปิด Pull Request

## คำสั่งที่ต้องผ่าน

```bash
pnpm test
pnpm check
pnpm build
git diff --check
```

หากแก้ SQLite หรือ backup ให้รันเพิ่ม:

```bash
pnpm test:sqlite
pnpm backup:sqlite
```

## Pull Request checklist

- อธิบายปัญหาและสิ่งที่แก้
- ระบุไฟล์หรือ domain ที่ได้รับผลกระทบ
- ระบุคำสั่งทดสอบที่รันและผลลัพธ์
- แนบ screenshot เฉพาะเมื่อมีการเปลี่ยน UI
- เพิ่ม migration และ permission test หากเกี่ยวกับ database หรือสิทธิ์
- ตรวจว่าไม่มี `.env`, token, ข้อมูลสมาชิกจริง, SQLite file, backup หรือ log ติดไปใน commit

## หลักการเขียนโค้ด

ใช้ tRPC เป็นช่องทางเรียก backend อย่าสร้าง fetch wrapper ใหม่โดยไม่จำเป็น ใช้ component จาก `client/src/components/ui` และคง design token ใน `client/src/index.css` การคำนวณยอดเงินต้องใช้หน่วย integer ที่ชัดเจนหรือกำหนด rounding rule เดียวกันทั้ง server และ client ห้ามเชื่อค่าที่ส่งมาจาก client สำหรับ role, balance, stock หรือราคา

## การ debug บน Windows

โปรเจกต์ใช้ `cross-env` แล้ว ดังนั้นให้ใช้คำสั่งมาตรฐาน:

```powershell
pnpm install
pnpm dev
```

หาก dependencies เสียหาย:

```powershell
Remove-Item -Recurse -Force node_modules
pnpm install
```

## สิ่งที่ควรทำต่อใน production

แยก `Home.tsx` เป็นหน้า domain, เชื่อม tRPC กับ database จริง, เพิ่ม server-side authorization และสร้าง audit log แบบ immutable ก่อนนำไปใช้กับข้อมูลจริงของสมาชิก
