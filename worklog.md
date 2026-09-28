
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
