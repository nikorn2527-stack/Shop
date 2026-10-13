# Local Printer Helper

บริการนี้ต้องรันบนเครื่อง POS ที่ต่อกับเครื่องพิมพ์ โดยรับคำขอผ่าน
`http://127.0.0.1:3031` เท่านั้น แล้วส่งงานเข้า print spooler ของระบบปฏิบัติการ

## ติดตั้ง

ติดตั้ง [Bun](https://bun.sh/) และ Chromium ที่ Puppeteer จัดการให้ จากนั้นเปิด
Terminal ในโฟลเดอร์นี้แล้วรัน:

```powershell
bun install --frozen-lockfile
bun run start
```

เปิด `http://127.0.0.1:3031/` เพื่อตรวจ health check ค่าของ `version` ต้องเป็น
`2.0-paper-size`

## ตรวจสอบก่อนนำไปใช้

```powershell
bun run check
```

จาก root ของ repository สามารถทดสอบ rendering โดยไม่ส่งงานเข้าเครื่องพิมพ์จริง:

```powershell
node scripts/printer-helper-smoke.mjs
```

หากต้องการตรวจ printer ที่ระบุ:

```powershell
$env:PRINT_TEST_PRINTER = "ชื่อเครื่องพิมพ์ใน Windows"
node scripts/printer-helper-smoke.mjs
```

Smoke test ตั้ง `PRINTER_HELPER_DRY_RUN=1` ให้เอง จึงตรวจ Chromium rendering,
ขนาดกระดาษ และ Windows `PrintDocument` pipeline โดยไม่เรียก `Print()` จริง

## ใช้งานจริง

- ตั้งชื่อเครื่องพิมพ์และความกว้างกระดาษในหน้า Settings ของ POS
- ตั้ง paper size ใน driver ของ Windows ให้ตรงกับกระดาษ 58, 72 หรือ 80 มม.
- ใช้ `bun run start` สำหรับเครื่อง POS; `bun run dev` มีไว้พัฒนาเท่านั้น
- การตัดกระดาษขึ้นกับ driver และความสามารถของเครื่องพิมพ์
- Helper ต้องเปิดค้างอยู่ระหว่างใช้งาน POS

บริการ bind เฉพาะ `127.0.0.1` จึงไม่เปิด port `3031` ให้เครื่องอื่นใน LAN
เข้าถึงโดยตรง