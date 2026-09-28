
---
Task ID: 1-fix (P1 follow-up: logout cookie bug)
Agent: main (orchestrator)
Task: แก้บั๊ก logout ไม่ล้าง session (ตามรายงานเจ้าของงาน)

Work Log:
- เจ้าของงานเทส P1 บนเครื่อง พบ:
  - lockout หลังพยายาม 5 ครั้ง (ไม่ใช่ 3 ตามที่เช็คลิสต์เดิมเขียน) → ยืนยัน `LOGIN_MAX_FAILURES = 5` ในโค้ด
  - logout แล้วกลับหน้าล็อกอิน "ใช้ไม่ได้" → บั๊ก cookie ไม่ถูกลบจริง
- หาสาเหตุ: login ตั้ง cookie ด้วย `sameSite: "lax"` แต่ logout ใช้ `getSessionCookieOptions()` ที่คืน `sameSite: "none"` — browser มองเป็น cookie คนละตัว เลยไม่ลบจริง
- แก้ `server/_core/cookies.ts`: `getSessionCookieOptions` คืน `sameSite: "lax"` ให้ตรงกับ login
- `pnpm run check` ผ่าน
- ทดสอบ curl:
  - login kanyanat → Set-Cookie app_session_id (Lax)
  - logout → Set-Cookie: app_session_id=; Expires=1970; SameSite=Lax ✅ (cookie ถูกลบจริง)
  - anonymous dashboard.stats/product.list → 401 ✅
  - anonymous ส่ง actorRole:"ผู้บริหาร" แอบ → ยัง FORBIDDEN ✅ (CVE ปิดจริง)
- ทดสอบ staff session (kanyanat):
  - B1-B7 (product.list, dashboard.stats, reports.daily, stock.rows, member.list, logs.list, settings.get) → 200 ครบ ✅
  - C1 product.create, C3 reports.closeDay, C4 backup.create, C5 settings.set → FORBIDDEN ครบ ✅
- commit `479ef93` push ขึ้น origin/main-v2 สำเร็จ (rebase ผ่าน)

Stage Summary:
- แก้บั๊ก logout สำเร็จ — ตอนนี้ logout ล้าง cookie จริง กลับหน้าล็อกอินได้สะอาด
- P1 auth enforcement ทำงานถูกต้องครบ: staff ทำงานได้, admin ops โดนห้าม, anonymous โดน 401, CVE bypass ปิด
- คำแนะนำเช็คลิสต์เทสแก้ไข: lockout = 5 ครั้ง (ไม่ใช่ 3)
- รอเจ้าของงาน pull commit `479ef93` ไปเทส logout อีกรอบ + เทส UI-level (POS flow, receipt, F2-F6) ที่เหลือ

---
Task ID: UI-1
Agent: full-stack-developer (UI fixes)
Task: แก้ 3 ปัญหา UI/styling — สต็อกสินค้า scroll ไม่ได้, รายงานการ์ด/ฟิลเตอร์รกเกะจอ, ตั้งค่าเครื่องพิมพ์รกเหมือนคู่มือ

Work Log:
- อ่าน worklog เดิมเข้าใจ context (P1 auth done, project stack = Vite + React 19 + Express + tRPC + Drizzle + SQLite, pnpm)
- ไล่โครงสร้าง JSX/CSS ของ 3 ไฟล์เป้าหมาย: `client/src/pages/Stock.tsx`, `client/src/pages/Home.tsx` (line 1017 reports, line 1662 settings), `client/src/index.css`
- Issue 1 (สต็อกสินค้า scroll): ตรวจพบว่า `.page-content` ถูกล็อกเป็น flex column + overflow:hidden (ตั้งแต่ `min-width:561px`) แต่ `.stock-page` ไม่ได้ส่งต่อ flex/min-height ลงไป ทำให้ `.table-wrap` ไม่มีกรอบความสูง ตารางจึงดันสูงและโดน clip — แก้โดยเติม CSS ทำให้ `.stock-page` เป็น flex column (`flex:1 1 0; min-height:0`) + max-height fallback `65vh` บน `.table-wrap` (sticky thead และ custom scrollbar มีอยู่แล้ว)
- Issue 2a (การ์ด/หัวข้อรายงานเกะจอ): compact การ์ด `.report-cards-dense` (padding ลด 8/12 → 5/11, font strong 18.5→15.5px, facts 9.5→9px), compact `.report-quick-guide` (padding 10/12 → 5/10, margin 14→8, font 11.5→10.5px), compact `.panel-heading`/`.section-header p` ในบริบทรายงานผ่าน `:has(.report-workbench)` scope (font 11→10.5px, margin/gap ลด)
- Issue 2b (ฟิลเตอร์ chip รกซ้อน): compact padding/font ของ chip ทุกกลุ่ม (`.report-view-pills`, `.report-period-pills`, `.tx-type-pills`, `.report-groupby`, `.report-range-status`) — padding 6-7px→4px, font 11.5→11px, ลด row gap (12-13px→7-8px) ทำให้ชิดขึ้นและเห็นข้อมูลเร็วขึ้น; สถานะ selected ยังชัด (teal fill + white text + ✓ check บน staff pills)
- Issue 3 (เครื่องพิมพ์หน้าร้าน = คู่มือยาว): แก้ที่ `Home.tsx` line 1662 โดยห่อ `<div className="printer-flow-steps">` (4 ขั้นตอนพร้อมคำอธิบายยาว) ไว้ใน `<HelpDisclosure id="printer-flow-steps" label="คำแนะนำการใช้งาน" className="printer-flow-disclosure">` — default พับเก็บ, กดเปิดดูเมื่อต้องการ; เพิ่ม CSS สำหรับ `.printer-flow-disclosure` ให้ปุ่ม/กล่องเน้นสีเขียวเข้มกว่า help-disclosure ทั่วไป
- รัน `pnpm run check` → 0 TypeScript errors
- บูต dev server ทดสอบ → HTTP 200 ที่ `/` (curl ผ่าน, มีแค่ warning OAuth ที่เป็น env var ไม่เกี่ยว)
- commit `860ccf9` พร้อม push ขึ้น origin/main-v2 สำเร็จ (rebase ผ่าน, ไม่มี conflict)

Stage Summary:
- ไฟล์ที่เปลี่ยน: `client/src/index.css` (+70 บรรทัดใหม่ท้ายไฟล์), `client/src/pages/Home.tsx` (1 บรรทัด JSX แก้ — เปิด/ปิด HelpDisclosure รอบ printer-flow-steps)
- Issue 1 ✅: ตารางสต็อก scroll แนวตั้งได้ (max-height 65vh + sticky thead + custom scrollbar) บนจอ tablet/desktop; บนจอมือถือ page-content เลื่อนหน้าปกติ
- Issue 2a ✅: การ์ดรายงาน + quick-guide + หัวข้อ (SectionHeader/panel-heading) กระชับขึ้น ~30-40px → เห็นข้อมูลตารางเร็วขึ้น
- Issue 2b ✅: chip ฟิลเตอร์ทุกกลุ่ม (view/period/staff/groupby/status) ชิดขึ้น สถานะ selected ยังชัด (teal + ✓)
- Issue 3 ✅: 4 ขั้นตอนคู่มือเครื่องพิมพ์ถูกพับเก็บใน HelpDisclosure ค่าเริ่มต้น หน้าตั้งค่าสะอาด; กด "คำแนะนำการใช้งาน" เปิดดูได้
- ไม่แตะ tRPC contract หรือ backend auth logic; เป็น CSS + JSX wrapper เท่านั้น
- commit hash: `860ccf9` บน origin/main-v2 — รอเจ้าของงาน pull ไปเทส UI บนเครื่อง
