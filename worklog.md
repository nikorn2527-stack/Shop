
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

---
Task ID: UI-3
Agent: full-stack-developer (member number segmented control)
Task: เปลื่ยนตัวเลือก "รูปแบบเลขสมาชิก" จาก selectable cards (3 การ์ด icon Hash/CalendarDays/Pencil ที่ UI-2 ทำไว้) เป็น segmented control กระทัดรัดแบบ iOS/Stripe/Linear และเบาลง — เจ้าของงานบอกการ์ดเดิม "เหมือนเลือกดรอปดาวน์ Excel ไม่ใช่แอปทันสมัย"

Work Log:
- อ่าน worklog เข้าใจ context UI-1 และ UI-2 (cards ที่ถูกแทนถูกเพิ่มโดย UI-2)
- ตรวจ byte offsets ของ `.member-mode-grid` / `.member-mode-card` / `.member-manual-demo` / `.number-preview` ใน Home.tsx (ไฟล์บรรทัดยาว ๆ — ใช้ dd extract เพราะ Read tool truncate บรรทัดที่ 2000 ตัวอักษร)
- ตรวจสอบการใช้งาน icons Hash/Pencil ทั้งไฟล์ — ใช้เฉพาะใน member-mode section เท่านั้น → ลบ imports ออกด้วย (CalendarDays ยังใช้ที่อื่น คงไว้)
- JSX edits ใน `client/src/pages/Home.tsx` (3 จุด):
  1. ลดบรรทัด import: ลบ `  Pencil,\n` และ `  Hash,\n` ออกจาก lucide-react import block
  2. แทน `<div className="number-mode-grid member-mode-grid">` + 3 `<button className="member-mode-card">` (มี icon + body + radio) → `<div className="member-mode-segmented" role="tablist" aria-label="รูปแบบเลขสมาชิก">` + 3 `<button role="tab" className="member-mode-seg ...">` แบบ text-only (ลำดับรัน / ตามปี / กำหนดเอง) — `aria-selected={numberMode === value}`, className active ตาม state
  3. แทนกล่อง `.member-manual-demo` (มี row + label + input + icon + verbose hint small) → กล่องเดียวมี input + inline `<span className="member-manual-status ok|err">` (✓ ใช้ได้ / ✗ หมายเลขซ้ำ) แสดงเฉพาะตอนกรอกแล้ว — ลบ label row, verbose 3-state hint, hint-ico/ok-ico/err-ico icons ออก
- CSS edits ใน `client/src/index.css` (2 จุด, ท้ายไฟล์):
  1. ลบ `.member-mode-grid` / `.member-mode-card` (10 rules + media query) → เพิ่ม `.member-mode-segmented` (inline-flex pill พื้น muted, border radius 9999, padding 3px, gap 2px), `.member-mode-seg` (text-only, 12.5px, transparent bg, transition .15s), `.member-mode-seg.active` (white pill, foreground text, font-weight 600, shadow 0 1px 2px), `:not(.active):hover` (foreground color), `:disabled` (opacity .55)
  2. ลด `.member-manual-demo` padding 11/12 → 8/10 + ใช้ flex row inline, ลด input height 34 → 32, ลบ `.member-manual-demo-row` / `.member-manual-demo-label` / `.member-manual-demo-hint` / `.hint-ico` / `.ok-ico` / `.err-ico` (ไม่ใช้แล้ว), เพิ่ม `.member-manual-status` (inline-flex pill, 11px bold, whitespace nowrap) + `.ok` (เขียวเข้ม #2f6f57) / `.err` (แดงเข้ม #a85050) variants
- เก็บ state logic ทั้งหมดไว้ (`numberMode`, `manualDemoNumber`, `setManualDemoNumber`, `manualDemoTrim`, `manualDemoTaken`, `manualDemoValid`) — ไม่แตะ logic แค่เปลื่ยน rendering
- เก็บ `.number-preview` ("สมาชิกใหม่คนถัดไปจะได้เลข: {nextNumber}") ไว้เหมือนเดิม — label ถูกปรับโดย UI-2 แล้ว
- ไม่แตะ tRPC contract หรือ backend auth logic; ไม่เปลื่ยน type ของ `memberNumberMode` (ค่า "running"|"year"|"manual" เหมือนเดิม); เป็น CSS + JSX เท่านั้น
- `pnpm run check` (tsc --noEmit) → 0 errors
- บูต dev server (./start-dev.sh) → curl `/` HTTP 200 ผ่าน (มีแค่ warning OAuth env var ที่เป็น sandbox issue ไม่เกี่ยว)
- commit `c318aa4` push ขึ้น origin/main-v2 สำเร็จ (7901cb2..c318aa4, no rebase ต้องทำเพราะ no new commits บน remote)

Stage Summary:
- ไฟล์ที่เปลื่ยน: `client/src/pages/Home.tsx` (ลบ imports 2 บรรทัด + JSX 2 จุด: segmented control + manual demo กระชับ), `client/src/index.css` (ลด 31 บรรทัด CSS เดิม + เพิ่ม 19 บรรทัด CSS ใหม่)
- UI ใหม่: ตัวเลือก "รูปแบบเลขสมาชิก" เป็น segmented pill สะอาด text-only (ลำดับรัน / ตามปี / กำหนดเอง) — selected = ิมขาวบน track muted, ไม่มี icon รก — ทันสมัยเหมือน iOS/Stripe/Linear ตามที่เจ้าของงานขอ
- กล่องทดลอง manual กระชับขึ้น: input เดียว + status inline (✓ ใช้ได้ / ✗ หมายเลขซ้ำ) แสดงเฉพาะตอนพิมพ์ — ลบ label row และ verbose hint 3-state ออก
- `pnpm run check` ผ่าน 0 errors, dev server HTTP 200 ผ่าน
- commit hash: `c318aa4` บน origin/main-v2 — รอเจ้าของงาน pull ไปเทส UI บนเครื่อง

---
Task ID: UI-4
Agent: full-stack-developer (sliding segmented control)
Task: อัปเกรด member-number mode segmented control ให้เป็น iOS-style ที่ตัวเลือก active จะ **เลื่อน (slide)** ไปที่ตำแหน่งที่เลือกแทนการสลับสีแบบจุด และลบเส้นคั่น (│) ระหว่าง segments — เจ้าของงานบ่นว่า "ทำไมไม่เลื่อน ตัวคั่นมันยังมีอยู่ ตัวเลือกต่างๆ ปรับมันให้ทันสมัยได้ไหม"

Work Log:
- อ่าน worklog เข้าใจ context ของ UI-1, UI-2, UI-3 (UI-3 คือตัวที่เปลื่ยน selectable cards เป็น segmented pill text-only แบบ static — ตัว active ใช้สีพื้นขาว + shadow แบบ toggle ไม่ slide)
- ใช้ Grep tool หา byte offset ของ `.member-mode-segmented` ใน Home.tsx (offset 271706) และ extract บริบทด้วย `dd` (ไฟล์เป็นบรรทัดยาว ๆ minified)
- อ่านบริบท declaration ของ `numberMode` ที่ line 1465 (`const numberMode = form?.memberNumberMode ?? "running";`)
- อ่าน CSS เดิมของ `.member-mode-segmented` / `.member-mode-seg` ที่ index.css line 5355–5359 (UI-3) — มี `flex-wrap: wrap; gap: 2px;` และ active ใช้ `background: #fff` แบบ toggle ไม่มี sliding element
- JSX edits ใน `client/src/pages/Home.tsx` (2 จุด):
  1. เพิ่ม helper `const memberModeIndex = numberMode === "year" ? 1 : numberMode === "manual" ? 2 : 0;` หลังบรรทัด `const numberMode` — map ค่า numberMode → index 0/1/2 สำหรับ translateX ของ slider
  2. เพิ่ม slider element เป็น **first child** ของ `.member-mode-segmented`: `<span className="member-mode-slider" aria-hidden="true" style={{ transform: \`translateX(${memberModeIndex * 100}%)\` }} />` — ตัว white pill ที่จะเลื่อนไปที่ segment ที่ active
- CSS edits ใน `client/src/index.css` (ที่ block เดิมของ UI-3 บรรทัด 5351–5359):
  - `.member-mode-segmented`: เปลื่ยนเป็น `position: relative; display: inline-flex;` (รองรับ absolute slider), ลบ `flex-wrap: wrap` (ถ้า wrap slider math พัง), ลด `gap` จาก 2px → 0 (ลบช่องว่าง = ลบความรู้สึกมีเส้นคั่น), padding คืน 3px, รักษา track muted + border + radius 9999px
  - `.member-mode-slider` (ใหม่): `position: absolute; top: 3px; left: 3px; height: calc(100% - 6px); width: calc((100% - 6px) / 3);` — width = 1 ใน 3 ของ inner track (padding 3px แต่ละด้าน), พื้นขาว + radius 9999 + shadow `0 1px 3px rgba(0,0,0,0.08)`, **transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)** (iOS ease), `z-index: 0; pointer-events: none;` (ปุ่มด้านบนกดได้)
  - `.member-mode-seg`: เพิ่ม `position: relative; z-index: 1; flex: 1 1 0;` (เนื้อปุ่มอยู่เหนือ slider), padding 6/14 → **7/16** (hit area ใหญ่ขึ้น), font 12.5 → **13px**, weight **500** normal / **600** active, ลด transition เหลือแค่ `color 0.15s` (ไม่ transition all ตอน hover เพราะ slider เป็นคนจัดพื้นหลัง), min-height 30 → **32px**
  - `.member-mode-seg.active`: ลบ `background: #fff` + `box-shadow` ออก (slider เป็นคนให้พื้นขาว + shadow ตอนนี้) เหลือแค่ `font-weight: 600; color: #4a5240;`
  - `.member-mode-seg:not(.active):hover` คงไว้ (color smooth slide ตอน hover)
  - `.member-mode-seg:disabled` คงไว้
- คงค่าสีโทนเขียวมรกต/earthy ของโปรเจกต์ (`#eef2ec` track, `#fff` slider, `#838a78` text, `#4a5240` active) แทน slate/blue ที่ task template แนะนำ — รักษา visual consistency กับสีเดิมของแอป
- ไม่แตะ tRPC contract, state logic (`numberMode`, `manualDemoNumber`, validation), `.member-manual-demo`, `.number-preview`, หรือ type ของ `memberNumberMode` (ค่า "running"|"year"|"manual" เหมือนเดิม)
- `pnpm run check` (tsc --noEmit) → 0 errors
- บูต dev server (`./start-dev.sh`) → curl `/` HTTP 200 ผ่าน (มีแค่ warning OAuth env var ที่เป็น sandbox issue ไม่เกี่ยว)
- commit `bda0900` push ขึ้น origin/main-v2 สำเร็จ (c318aa4..bda0900, no rebase ต้องทำเพราะ no new commits บน remote)

Stage Summary:
- ไฟล์ที่เปลื่ยน: `client/src/pages/Home.tsx` (+3 บรรทัด: helper const memberModeIndex + 1 JSX slider span), `client/src/index.css` (+6 บรรทัด CSS ใหม่ + ปรับ 5 rules ของ .member-mode-segmented / .member-mode-seg)
- พฤติกรรมใหม่: ตอนนี้คลิก "ลำดับรัน" → "ตามปี" → "กำหนดเอง" จะเห็นตัว white pill **เลื่อน slide** ไปที่ตำแหน่งนั้นด้วย cubic-bezier ease 0.22s (iOS feel) — ไม่ใช่สลับสีแบบจุดเหมือนเดิม; ไม่มีเส้นคั่น (│) ระหว่าง segments เลย — รู้สึก clean ทันสมัยเหมือน iOS/Stripe/Linear
- เลือกใช้ dedicated `<span className="member-mode-slider" />` แทน `::before` pseudo-element เพราะ React inline-style กำหนด transform ได้สด ไม่ต้องเขียน CSS variable / data-attribute workaround
- ค่าสีโทน earthy (`#eef2ec` muted track + `#fff` slider + `#4a5240`/`#838a78` text) สอดคล้องกับ palette โปรเจกต์ (เขียวมรกต) — ไม่ slip ไป blue/slate ตาม task fallback default
- ไม่แตะ tRPC contract หรือ backend auth logic; ไม่เปลื่ยน type ของ `memberNumberMode`; เป็น CSS + JSX เท่านั้น
- `pnpm run check` ผ่าน 0 errors, dev server HTTP 200 ผ่าน
- commit hash: `bda0900` บน origin/main-v2 — รอเจ้าของงาน pull ไปเทส UI บนเครื่อง

---
Task ID: UI-5
Agent: main (orchestrator)
Task: ปรับ panel เลขสมาชิกให้เป็น preset-first + collapsible advanced (หลังเจ้าของบอกทั้ง panel "ห่วย")

Work Log:
- เจ้าของบอก: ไม่ใช่แค่ toggle แต่ทั้ง panel ที่มี 7+ ฟิลด์ (คำนำหน้า, หลักเลขรัน, รูปแบบปี, หลักปี, ตัวคั่น, เดือนเริ่มรอบ, สำเร็จรูป) + คำอธิบายยาว = ดูเหมือนฟอร์ม Excel
- ออกแบบใหม่: preset-first + collapsible advanced
  - default view: sliding segmented control (UI-4) + BIG preview card (28px monospace)
  - manual demo input ยังอยู่ inline (เมื่อเลือก manual)
  - 7 ฟิลด์ขั้นสูงทั้งหมด ซ่อนใน disclosure "แสดงตัวเลือกขั้นสูง" (default พับ)
  - ลบ paragraph อธิบายยาวออก (พรีวิวตัวเลขสดๆ แสดงผลอยู่แล้ว)
- เพิ่ม state `memberAdvancedOpen` ใกล้ `manualDemoNumber`
- แก้ JSX: แทรก preview card + toggle + advanced-wrap (ห่อ format-grid + presets)
- ลบ duplicate member-manual-demo + settings-inline-note + number-preview ที่เดิมอยู่ท้าย
- เพิ่ม CSS: .member-preview-card, .member-advanced-toggle, .member-advanced-wrap (2-col grid desktop / 1-col mobile)
- `pnpm run check` ผ่าน 0 errors
- server boot HTTP 200
- commit `e04add1` push ขึ้น origin/main-v2 สำเร็จ

Stage Summary:
- Panel เลขสมาชิกสะอาด default — เห็นเเค่ toggle + preview ตัวเลขใหญ่
- ฟิลด์ขั้นสูงทั้ง 7 ซ่อนใน collapsible (กด "แสดงตัวเลือกขั้นสูง" ขยายออก)
- ลบคำอธิบายยาว ใช้พรีวิวตัวเลขเป็นตัวบอกผลแทน
- ฟังก์ชันเดิมครบ: field bindings ไม่เปลี่ยน, memberNumberMode type ไม่เปลี่ยน, tRPC API ไม่เปลี่ยน

---
Task ID: UI-6
Agent: main (orchestrator)
Task: รายงาน → ประวัติธุรกรรมสมาชิก — 2 บรรทัด/รายการ + แก้ truncation

Work Log:
- เจ้าของบอก: ตาราง on-screen ข้อมูล detail ยาว อ่านยาก อยากให้เป็น 2 บรรทัด/รายการ จัดช่องตามที่ export
- พบสาเหตุ: CSS `.tx-detail` truncate (`max-width: 380px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis`) → ข้อความ detail ยาวถูกตัด
- แก้: เปลี่ยนแต่ละ transaction จาก `<tr>` เดียว เป็น array ของ 2 `<tr>`:
  - บรรทัด 1 (main): date | member | type | amount | balance | actor | (admin: พิจารณา)
  - บรรทัด 2 (detail): `<td colSpan>` แสดง detail เต็ม width (ไม่ truncate, wrap ตามธรรมชาติ)
- คอลัมน์ตรงกับ export (8 ช่อง: date, member, type, detail, amount, balance, actor, พิจารณา)
- แก้ typo header "ยอดเคลือน" → "ยอดเคลื่อน"
- CSS: ลบ truncation (max-width/nowrap/ellipsis), เพิ่ม `.tx-detail-row` (subtle background, padding, border-top 0)
- `pnpm run check` ผ่าน 0 errors
- server boot HTTP 200
- commit `7789a25` push ขึ้น origin/main-v2

Stage Summary:
- ตาราง tx report ใช้ 2 บรรทัด/รายการ → detail ยาวอ่านได้ครบ ไม่โดนตัด
- คอลัมนงตรง export ทั้ง on-screen + ไฟล์
- typo แก้แล้ว

---
Task ID: V2-A
Agent: main (orchestrator)
Task: V2 refactor — Step A (CSS tokens split) + directory structure

Work Log:
- Formatted Home.tsx + index.css with prettier (Home.tsx: 1946→11382 lines readable, index.css: 5496→23263 lines)
- TypeScript + boot verified after format (0 errors, HTTP 200)
- Created V2 directory structure: layouts/, pages/{dashboard,pos,inventory,members,reports,settings}/, components/{page,data}/, styles/
- Extracted @font-face + :root design tokens + global resets → styles/tokens.css (170 lines)
- Updated index.css: replaced tokens with @import "./styles/tokens.css" (23075 lines remain, will be split into layout.css + components.css in Step E)
- Created styles/layout.css + styles/components.css as placeholder files (rules to be migrated from index.css incrementally)
- TypeScript passes, dev server boots HTTP 200
- commit `55f4f7a` pushed to origin/main-v2

Stage Summary:
- Step A ✅ DONE — CSS tokens extracted, V2 directory structure in place
- Steps B-E: assessed but NOT done — the formatted Home.tsx is 11382 lines with 9 functions:
  - MemberDetail (1597 lines), Members (360), TimelineDrilldown (88), Reports (3713), utilities (167), Settings (3913), Logs (239), AppShell (870), Home (67)
  - Extracting these requires moving 10000+ lines of JSX + resolving complex shared dependencies (types, hooks, constants, tRPC queries)
  - This is genuinely a multi-day engineering task — cannot complete in one session
- Recommended approach for B-E: use subagents per-function (one function per subagent), starting with the smallest (Logs, TimelineDrilldown) and working up to the largest (Settings, Reports)

---
Task ID: V2-B
Agent: full-stack-developer (AppShell extraction)
Task: V2 refactor — Step B (extract AppShell function from Home.tsx into layouts/AppShell.tsx + shared types module)

Work Log:
- อ่าน worklog เข้าใจ context V2-A (CSS tokens split done, directory structure in place, Home.tsx formatted 11382 lines)
- อ่าน AppShell function ที่ lines 10447-11314 ของ Home.tsx (868 บรรทัด) + Home default export ที่ 11317
- Identify dependencies ที่ AppShell ใช้ (ใช้ Python script + grep):
  - Types: User (drizzle schema), BrandSettings (theme.ts), View/Role (pageData.ts), SettingsTab (local ใน Home.tsx line 6021 — shared กับ Settings function)
  - Hooks: useEditionStatus (EditionUi), useEffect/useMemo/useRef/useState (react)
  - Functions: loadHeldBills, canAccessView, isAdminRole, memberFullName, money, navItems (pageData.ts), brandInitial, applyPaperWidth (theme.ts), formatThaiDate (viewFormat.ts)
  - Constants: MEMBER_NOTIF_LIMIT (local line 208 — AppShell-only ไม่ใช่ shared)
  - Components: Dashboard, Pos, Stock, Users, GlobalSearch, EditionPill (imported), Members/Reports/Settings/Logs (locally defined ใน Home.tsx — ต้องส่งเป็น props เพื่อหลีก circular import)
  - Other: trpc (@/lib/trpc), toast (sonner)
  - 21 icons จาก lucide-react (Activity, ArrowDownToLine, ..., X)
  - blocker, formatFileSize, uptimeLabel, POS_RAIL_BUTTONS, GO_LIVE_CHECKLIST ตรวจแล้ว ไม่ได้ใช้ใน AppShell (task description ระบุไว้แต่ไม่ตรงจริง)
- สร้าง client/src/pages/shared.ts (30 บรรทัด): export `SettingsTab` type — เป็น type เดียวที่ shared ระหว่าง AppShell และ Settings function (ใช้ Python script cross-check ทุก token ของ AppShell กับ Settings function)
- สร้าง client/src/layouts/AppShell.tsx (965 บรรทัด): ย้าย AppShell function มาทั้งหมด (868 บรรทัด body) + เพิ่ม imports header + ใหม่กำหนด `AppShellViewComponents` type และ `AppShellProps` type ที่มี `viewComponents: { Members, Reports, Settings, Logs }` prop (รับ view components เป็น props เพื่อหลีก circular import)
- แก้ Home.tsx (3 จุด):
  1. เพิ่ม imports: `import { AppShell } from "../layouts/AppShell"` + `import { SettingsTab } from "./shared"`
  2. ลบ `const MEMBER_NOTIF_LIMIT = 6` (line 208) + ลบ `type SettingsTab = ...` block (lines 6021-6035) — อันหลังย้ายไป shared.ts แล้ว, อันแรกย้ายไปเป็น const ภายใน layouts/AppShell.tsx เพราะ AppShell-only ไม่ใช่ shared
  3. ลบ AppShell function (lines 10447-11314 — 868 บรรทัด body + 1 blank = 869 บรรทัด) ออกจาก Home.tsx
  4. แก้ Home() default export (line 11317) ให้ส่ง viewComponents={{ Members, Reports, Settings, Logs }} ให้ AppShell
- หมายเหตุ: prettier format changes ของ Home.tsx จาก V2-A (1946→11382 บรรทัด) ไม่ได้ commit ใน V2-A commit (55f4f7a ครอบเฉพาะ CSS files) — commit นี้ (V2-B) จะรวม format changes นั้นด้วยเพราะ working tree มีอยู่แล้ว
- `pnpm run check` (tsc --noEmit) → 0 errors ✅
- บูต dev server (./start-dev.sh) → curl `/` HTTP 200 ผ่าน (มี warning tailwind "Missing opening {" ที่เป็น pre-existing CSS issue จาก V2-A — ไม่ใช่ V2-B's regression; tailwind v4 pre-transform ล้มเหลือตอน parse index.css หลัง @import tokens.css)

Stage Summary:
- ไฟล์ที่เปลี่ยน:
  - `client/src/pages/shared.ts` (ใหม่ — 30 บรรทัด): SettingsTab type
  - `client/src/layouts/AppShell.tsx` (ใหม่ — 965 บรรทัด): AppShell function + AppShellViewComponents/AppShellProps types + MEMBER_NOTIF_LIMIT const (ย้ายมาจาก Home.tsx)
  - `client/src/pages/Home.tsx`: ลดขนาดจาก 11382 → 10500 บรรทัด (ลบ AppShell 868 บรรทัด + ลบ SettingsTab/MEMBER_NOTIF_LIMIT local definitions) + เพิ่ม 2 imports + ปรับ Home() ให้ส่ง viewComponents prop
- AppShell extraction สำเร็จ — Home.tsx ตอนนี้เป็น thin auth-gate (SetupView/LoginView/ForceChangeView แล้ว delegate ไป AppShell) เหมือนที่ V2-A ตั้งในไว้
- View components ที่ AppShell ใช้ (Members/Reports/Settings/Logs) ยังอยู่ใน Home.tsx — ส่งเป็น props ผ่าน `viewComponents` เพื่อหลีก circular import; V2-C ถึง V2-E จะย้าย views เหล่านี้ออกเป็นไฟล์ต่างหากแล้ว AppShell import โดยตรง + ลบ `viewComponents` prop ได้
- TypeScript: 0 errors, dev server: HTTP 200 ผ่าน
- commit hash: (จะกรอกหลัง push) บน origin/main-v2
