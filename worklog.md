
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

---
Task ID: UI-2
Agent: full-stack-developer (settings + member number UX)
Task: แก้ 4 ปัญหา UI/UX หน้าตั้งค่า — แอปคลีนลง (ลด verbose text), ลบ section รูปแบบการชำระเงินที่รองรับ, ปรับ UX เลขสมาชิก manual ให้ใช้ง่าย, และอธิบาย section ติดตั้งแอป Windows ให้ชัด

Work Log:
- อ่าน worklog เดิมเข้าใจ context (P1 auth + UI-1 done; stack = Vite + React 19 + Express + tRPC + Drizzle + SQLite, pnpm)
- ใช้ ripgrep (Grep tool) หาตำแหน่ง byte ที่แม่นยำของ 4 sections ใน `client/src/pages/Home.tsx` (ไฟล์ 1913 บรรทัด ส่วนใหญ่อยู่ใน line 1662 ที่ยาวมาก) — ใช้ `grep -ob` + `dd` extract เพื่ออ่านเนื้อหาแบบตรงจากไฟล์ (เพราะ Read tool truncate บรรทัดยาว ๆ ที่ 2000 ตัวอักษร)
- Issue 1 (overall cleanliness): trim verbose `<p>` descriptions ในหน้า Settings — 3 จุดหลัก: (1) SectionHeader description "ตั้งค่าร้านค้าแบ่งเป็น ${N} หมวด..." → "เลือกหมวดและแท็บด้านบน"; (2) รอบตัดยอดประจำวัน description ยาว → "ให้ระบบตัดยอดอัตโนมัติตามเวลา หรือเจ้าหน้าที่กดตัดเอง"; (3) เมนูลัดหน้าร้าน (POS) description ยาว → "เปิด/ปิดปุ่มและคีย์ลัด F บนรางซ้าย POS · บันทึกแล้วทุกเครื่องเห็นเหมือนกัน"; สีธีมของแอป description กระชับลง — ยังคีบ label/hint ที่จำเป็น ไม่ strip หมด
- Issue 2 (ลบ "รูปแบบการชำระเงินที่รองรับ"): ลบ `<section>` ทั้งหมดที่อยู่ก่อน section บัญชีพร้อมเพย์ ใน `{tab === "payment" && ...}` block — เคยมี 3 การ์ด descriptive (เงินสด/QR/หักบัญชีสมาชิก) + inline-note + jump button แต่ไม่มีการตั้งค่าจริง เป็น descriptive-only ซ้ำกับที่ POS แสดงอยู่แล้ว — ตอนนี้แท็บ "การชำระเงิน" เหลือแค่ section บัญชีพร้อมเพย์ (ที่มี input จริง)
- Issue 3 (เลขสมาชิก manual UX): ทำ 4 สิ่ง
  1. เปลี่ยน 3 mode options จาก tuple `[value, title, detail]` → object array พร้อม icon component (Hash / CalendarDays / Pencil — เพิ่ม Pencil + Hash ใน lucide-react import block) และเปลี่ยนปุ่มเป็น `.member-mode-card` (selectable card style — มี icon container + body + check-radio ในแถวเดียว)
  2. เพิ่ม state `manualDemoNumber` + validation logic `manualDemoTrim`/`manualDemoTaken`/`manualDemoValid` (เช็ค non-empty + ไม่ซ้ำกับ `membersQuery.data` — mirror validation ของ cashier ที่ Pos.tsx)
  3. ตอนเลือก "manual" แสดงกล่อง `.member-manual-demo` (มี input placeholder "ตัวอย่าง: M-100001" + icon check/X สีเขียว/แดง + inline hint ที่เปลี่ยนตามสถานะ) — admin พิมพ์ทดลองและเห็น feedback จริงทันที
  4. ปรับ `.number-preview` label จาก "ตัวอย่างสมาชิกถัดไป" → "สมาชิกใหม่คนถัดไปจะได้เลข" (ตรงตามที่ issue ขอ — preview effect of choice ทันที); สำหรับ manual mode nextNumber = "กรอกเอง" (ฟังก์ชันเดิม formatMemberNumber)
- Issue 4 (ติดตั้งแอป Windows ไม่เข้าใจ): หลังอ่านโค้ดพบว่า section นี้เป็น descriptive-only (ไม่มี beforeinstallprompt handler หรือ PWA install trigger) — แต่มีประโยชน์ (อธิบายวิธี install app จาก Chrome/Edge บน Windows) เลือกทาง (a): clarify + collapse แทน removal
  - เปลี่ยน icon จาก `Monitor` → `Download` (สื่อ "ดาวน์โหลด/ติดตั้งแอป" ชัดกว่า)
  - เปลี่ยน heading "ติดตั้งแอปบนเครื่องนี้ (Windows)" → "ติดตั้งเป็นแอปบนเดสก์ท็อป (Windows)"
  - เปลี่ยน description เป็นคำอธิบาย purpose ตาม issue แนะนำ: "ติดตั้งเป็นแอปบนเดสก์ท็อป — ใช้งานเหมือนโปรแกรมทั่วไป เปิดได้เต็มจอ ไม่ต้องเปิดเบราว์เซอร์ทุกครั้ง"
  - ห่อ `<div className="printer-flow-steps">` (3 ขั้นตอนยาว) ไว้ใน `<HelpDisclosure id="windows-install-steps" label="ขั้นตอนการติดตั้ง" className="windows-install-disclosure">` — default พับเก็บ หน้าการ์ดสะอาด กดเปิดดูได้
- เพิ่ม CSS ใน `client/src/index.css` ท้ายไฟล์ (~46 บรรทัด):
  - `.member-mode-grid` / `.member-mode-card` / `.member-mode-ico` / `.member-mode-body` (selectable card style — teal border + tinted bg + icon container + accessible aria-pressed; responsive: collapse to 1fr บนจอ <820px)
  - `.member-manual-demo` + `.member-manual-demo-row` / `-label` / `-input` (พร้อม `.ok` / `.err` variants — green/red feedback) + `.hint-ico` / `.ok-ico` / `.err-ico` + `.member-manual-demo-hint` (พร้อม `.ok` / `.err`)
  - `.windows-install-disclosure` (reuse green-tinted look ของ `.printer-flow-disclosure` ให้ read as one family กับ help disclosure อื่น)
- `pnpm run check` → 0 TypeScript errors
- บูต dev server (`./start-dev.sh`) → curl `/` HTTP 200 ผ่าน (มีแค่ warning OAuth env var ที่เป็น sandbox issue ไม่เกี่ยว)
- commit `7901cb2` push ขึ้น origin/main-v2 สำเร็จ (860ccf9..7901cb2, no rebase ต้องทำเพราะ no new commits บน remote)

Stage Summary:
- ไฟล์ที่เปลี่ยน: `client/src/pages/Home.tsx` (icon imports +2, state +1, validation +4 lines, JSX edits ใน line 1662 อันยาว: ลบ payment-methods section, ปรับ mode grid เป็น selectable cards พร้อม icon, เพิ่ม manual demo input + validation feedback, ห่อ windows install steps ใน HelpDisclosure, trim verbose descriptions 3 จุด, ปรับ SectionHeader description), `client/src/index.css` (+46 บรรทัด CSS ใหม่ท้ายไฟล์ สำหรับ .member-mode-card / .member-manual-demo / .windows-install-disclosure)
- Issue 1 ✅: ลด verbose text ใน Settings — SectionHeader + รอบตัดยอด + เมนูลัด POS + สีธีม กระชับขึ้น ยังคีบ Thai labels + hints ที่จำเป็น (security-sensitive settings เช่น Dev Access, backup ไม่แตะ)
- Issue 2 ✅: ลบ section "รูปแบบการชำระเงินที่รองรับ" ออกจากแท็บการชำระเงิน — ตอนนี้แท็บเหลือแค่ section "บัญชีพร้อมเพย์ร้าน" ที่มี input จริง (การชำระเงิน 3 วิธี ยังแสดงที่ POS ตามเดิม — ไม่กระทบฟังก์ชัน)
- Issue 3 ✅: เลขสมาชิก manual mode ใช้ง่ายขึ้น — 3 mode options เป็น selectable cards พร้อม icon (Hash/CalendarDays/Pencil) + กล่องทดลองกรอกพร้อม validation feedback สด (green check/red X + hint เปลี่ยนตามสถานะ) + label preview ชัดเจน ("สมาชิกใหม่คนถัดไปจะได้เลข: {nextNumber}")
- Issue 4 ✅: Section "ติดตั้งเป็นแอปบนเดสก์ท็อป (Windows)" ชัดขึ้น — Download icon + heading + 1-line purpose explanation (ตาม issue แนะนำ) + verbose 3 ขั้นตอนพับเก็บใน HelpDisclosure (default collapse, กดเปิดได้)
- ไม่แตะ tRPC contract หรือ backend auth logic; ไม่แก้ type ของ `memberNumberMode` (ค่า "running"|"year"|"manual" เหมือนเดิม); เป็น CSS + JSX เท่านั้น
- commit hash: `7901cb2` บน origin/main-v2 — รอเจ้าของงาน pull ไปเทส UI บนเครื่อง
