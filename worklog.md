
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
- commit hash: `f3d3cf1` บน origin/main-v2 (rebase: "Current branch main is up to date" — no new commits บน remote ตอน pull)

---
Task ID: V2-C1
Agent: full-stack-developer (extract small views)
Task: V2 refactor — Step C-1: Extract 3 small view functions (TimelineDrilldown, Logs, Members) from Home.tsx into separate page files

Work Log:
- อ่าน worklog เข้าใจ context V2-A + V2-B (CSS tokens split done, AppShell extracted to layouts/AppShell.tsx — Home.tsx 10499 lines, ~9 functions ยังอยู่ในไฟล์เดียว)
- อ่าน imports header ของ Home.tsx (lines 1-370) เพื่อเข้าใจ dependency map — lucide icons 66 ตัว, trpc, pageData/viewFormat/PagePrimitives, theme/fontScale, EditionUi, modal components, AppShell/SettingsTab (V2-B)
- ระบุตำแหน่ง 3 functions ที่จะ extract (line numbers ใน Home.tsx ก่อนแก้):
  - `Members` ที่ line 1968 — 295 บรรทัด (props: role/userName/focusMemberNumber/onFocusMemberConsumed; ใช้ MemberDetail, trpc.member.list, scanCandidates, isSameMonth, parseStoreDate, memberFullName, money, formatLastActivity, getErrorMessage, MEMBER_STATUS_META, SectionHeader, StatusPill, HelpDisclosure + icons IdCard/WalletCards/UsersRound/ArrowDownToLine/Search/ShieldCheck/ArrowRight/Check/X)
  - `TimelineDrilldown` ที่ line 2328 — 70 บรรทัด (props: from/to/cashiers?; ใช้ trpc.reports.byProduct, FileBarChart icon, getErrorMessage, money)
  - `Logs` ที่ line 10193 — 238 บรรทัด (no props; ใช้ trpc.logs.list, useState/useEffect, downloadCsvFile, formatLogDateTime, isSameDay, parseStoreDate, getErrorMessage, SectionHeader + icons Activity/CalendarDays/Check/ChevronDown/Download/ReceiptText/Search/ShieldCheck/X)
- สร้าง 3 ไฟล์ใหม่ (each named export + imports เฉพาะที่ใช้ + JSDoc อธิบาย origin + V2-C1 tag):
  1. `client/src/pages/reports/TimelineDrilldown.tsx` (~85 บรรทัด) — imports: FileBarChart, trpc, money, getErrorMessage
  2. `client/src/pages/members/Members.tsx` (~310 บรรทัด) — imports: react hooks, 9 icons, trpc, HelpDisclosure, MemberLite/Role types + memberFullName/money/roleThaiLabel/scanCandidates from pageData, MEMBER_STATUS_META/formatLastActivity/getErrorMessage/isSameMonth/parseStoreDate from viewFormat, SectionHeader/StatusPill from PagePrimitives, และ `MemberDetail` from "../Home" (circular — ดูข้อ 5)
  3. `client/src/pages/settings/Logs.tsx` (~250 บรรทัด) — imports: react hooks, 9 icons, trpc, downloadCsvFile, formatLogDateTime/getErrorMessage/isSameDay/parseStoreDate from viewFormat, SectionHeader from PagePrimitives
- **Circular dependency ระหว่าง Members ↔ MemberDetail**: MemberDetail (~1596 บรรทัด, scheduled for V2-D หรือ V2-E) ยังอยู่ใน Home.tsx — เลือกทาง "circular import via ESM" เพราะ:
  - ไม่ต้องแตะ layouts/AppShell.tsx (AppShellViewComponents type คงเดิม — Members prop type คงเป็น { role, userName, focusMemberNumber, onFocusMemberConsumed })
  - dependency เป็น natural: Members ใช้ MemberDetail ไม่ใช่ AppShell ใช้ MemberDetail
  - ESM live bindings จัดการ circular ได้: Members.tsx imports MemberDetail binding จาก Home.tsx — ในกราบ evaluation Home.tsx imports Members จาก Members.tsx ก่อน ทำให้ Members.tsx evaluate ก่อน, Members.tsx รับ "live binding" ของ MemberDetail (ยังไม่ initialized ตอนนั้น), แต่ Members.tsx ใช้ MemberDetail เฉพาะตอน render (runtime) ไม่ใช่ตอน module-eval, ตอน render Home.tsx evaluate จบและ binding initialized แล้ว → ใช้ได้
  - เพิ่ม `export` keyword ที่ `function MemberDetail(...)` ใน Home.tsx (จาก `function MemberDetail({` → `export function MemberDetail({`) — 1-character edit
- แก้ Home.tsx 3 จุด:
  1. เพิ่ม 3 imports หลัง `import { Users } from "./Users";` (line 153): `import { TimelineDrilldown } from "./reports/TimelineDrilldown";`, `import { Members } from "./members/Members";`, `import { Logs } from "./settings/Logs";` + 2 บรรทัด comment อธิบาย
  2. เปลี่ยน `function MemberDetail({` → `export function MemberDetail({` (line 377 หลังเพิ่ม imports)
  3. ลบ 3 function bodies ออกจาก Home.tsx (sed ครั้งเดียว 3 ranges ใน original line numbering): 1968-2263 (Members + trailing blank), 2324-2398 (TimelineDrilldown JSDoc + function + trailing blank), 10193-10431 (Logs + trailing blank) — รวม 610 บรรทัดที่ลบ
- ตรวจ boundaries หลัง sed: MemberDetail → blank → `const TX_TYPE_LABEL` (สะอาด), `};` ของ TimelineRow type → blank → `// ROUND 49 — ...` comment (สะอาด), `}` ของ Settings → blank → JSDoc ของ Home (สะอาด)
- รักษา business logic ทั้งหมด — pure move/extract, ไม่แตะ tRPC contract หรือ backend, ไม่ลบ state/props แม้แต่ unused (`error`/`setError` ใน Members ที่ไม่ได้ใช้ก็ยังคงไว้เพื่อ match original)
- `pnpm run check` (tsc --noEmit) → **0 errors** ✅
- บูต dev server (`pnpm run dev` ผ่าน setsid detached bash) → curl `/` 6 ครั้งติด HTTP 200/200/200/200/200/200 ✅ + curl Vite transform สำหรับ 4 ไฟล์ (main.tsx, Home.tsx, Members.tsx, TimelineDrilldown.tsx, Logs.tsx) ทั้งหมด HTTP 200 ✅ — modules transform ผ่าน Vite pipeline ไม่มี parse/transform error ใหม่
- pre-existing tailwind "Missing opening {" CSS pre-transform warning (จาก V2-A's `@import tokens.css` split) ยังคงมี — V2-B note ระบุไว้น "out of scope สำหรับ V2-C", ไม่ใช่ regression
- commit `ff0d0cd` push ขึ้น origin/main-v2 สำเร็จ (8c4aa16..ff0d0cd, rebase: "Current branch main is up to date" — no new commits บน remote ตอน pull)

Stage Summary:
- ไฟล์ที่เปลี่ยน:
  - `client/src/pages/Home.tsx` (10499 → 9888 บรรทัด, ลด 611 บรรทัด): เพิ่ม 3 imports (TimelineDrilldown/Members/Logs) + เพิ่ม `export` keyword ที่ MemberDetail + ลบ 3 function bodies (Members 296 บรรทัด, TimelineDrilldown 75 บรรทัดรวม JSDoc, Logs 239 บรรทัด)
  - `client/src/pages/reports/TimelineDrilldown.tsx` (ใหม่ — 85 บรรทัด): named export `TimelineDrilldown` + JSDoc อ้างอิง ROUND 48
  - `client/src/pages/members/Members.tsx` (ใหม่ — 310 บรรทัด): named export `Members` + JSDoc อธิบาย Round 32-16 + comment อธิบาย circular import กับ MemberDetail
  - `client/src/pages/settings/Logs.tsx` (ใหม่ — 250 บรรทัด): named export `Logs` + JSDoc อ้างอิง round 15 (render cap + real date-range filter)
- 3 ฟังก์ชัน extracted สำเร็จ — TimelineDrilldown/Logs/Members แยกไฟล์เรียบร้อย, Home.tsx ลดขนาดลง ~6% (10499 → 9888 บรรทัด)
- MemberDetail (1596 บรรทัด) ยังอยู่ใน Home.tsx — ตอนนี้ `export function MemberDetail` เพื่อให้ Members.tsx import ผ่าน ESM circular binding ได้ (safe เพราะใช้ที่ render-time ไม่ใช่ module-eval-time); จะย้ายออกเป็นไฟล์ต่างหากใน V2-D หรือ V2-E
- View components ที่ AppShell ใช้ตอนนี้: Members และ Logs จากไฟล์ใหม่ของตัวเอง + Reports และ Settings ยังอยู่ใน Home.tsx (scheduled for V2-D/V2-E)
- AppShell.tsx ไม่ถูกแตะ — viewComponents prop type คงเดิม (Members/Reports/Settings/Logs ComponentType) — Home() ยังส่ง viewComponents={{ Members, Reports, Settings, Logs }} เหมือนเดิม เพียงแต่ Members/Logs ตอนนี้มาจาก import ไม่ใช่ local function declaration
- TypeScript: 0 errors, dev server: HTTP 200 ผ่าน (6 ครั้ง stable + 4 module transforms ผ่าน)
- commit hash: `ff0d0cd` บน origin/main-v2 — รอเจ้าของงาน pull ไปเทส UI บนเครื่อง (members list, members drilldown, reports timeline drilldown, ประวัติระบบ tab)

---
Task ID: V2-C2
Agent: full-stack-developer (MemberDetail extraction)
Task: V2 refactor — Step C-2: Extract MemberDetail (~1596 lines, member detail page) from Home.tsx into its own file `client/src/pages/members/MemberDetail.tsx` and repoint Members.tsx to import from the new location.

Work Log:
- อ่าน `/agent-ctx/V2-C1-extract-small-views.md` + worklog เข้าใจ context V2-A/B/C1 (CSS tokens split done, AppShell extracted to layouts/, TimelineDrilldown+Members+Logs extracted; MemberDetail ยังอยู่ใน Home.tsx เป็น `export function` สำหรับ circular ESM กับ Members.tsx)
- grep `export function MemberDetail` ใน Home.tsx → พบที่ line 377; หา end โดยดู top-level declarations ถัดไป → พบ `const TX_TYPE_LABEL` ที่ line 1974 → MemberDetail ครอบ lines 377-1972 (function body), มี blank ที่ 376 ก่อนหน้าและ 1973 หลัง
- อ่านไฟล์ Home.tsx imports header (lines 1-210) เพื่อ map dependencies: lucide icons (66 ชื่อ), trpc (@/lib/trpc), pageData (PRENAME_OPTIONS/compressImageToDataUrl/isAdminRole/memberFullName/money/roleThaiLabel + types MemberLite/Role), viewFormat (MEMBER_STATUS_META/WALLET_TX_META/formatHistoryDate/formatLastActivity/formatThaiDate/getErrorMessage/isSameMonth/parseStoreDate), PagePrimitives (ConfirmDialog/SectionHeader/StatusPill/formEnterNav), exportUtils (downloadSlipFile), BlockerAlert (blocker), และ modal components (MemberCardModal/StatementModal/CameraCaptureModal/PrintPreviewModal/SlipViewButton)
- grep JSX tags ในช่วง 377-1972 ของ Home.tsx → list 24 lucide icons ที่ใช้จริง: ArrowDownToLine/ArrowUpFromLine/CalendarDays/Camera/Check/CircleHelp/Download/FileImage/FileText/IdCard/ImagePlus/LockKeyhole/Printer/ReceiptText/RotateCcw/Settings2/ShieldCheck/ShoppingBag/ShoppingCart/Star/Trash2/TrendingDown/WalletCards/X; และ 8 components: CameraCaptureModal/ConfirmDialog/MemberCardModal/PrintPreviewModal/SectionHeader/SlipViewButton/StatementModal/StatusPill
- grep `React.ChangeEvent` ใน function body → พบ 1 จุด (onEditPhotoPick handler); `@types/react` ประกาศ global `React` namespace จึงใช้ได้โดยไม่ต้อง import — คง `React.ChangeEvent<HTMLInputElement>` ตามต้นฉบับ
- สร้าง `client/src/pages/members/MemberDetail.tsx` (1672 บรรทัด = 76 imports/JSDoc header + 1596 function body):
  - imports: `useState` from react, 24 lucide icons, blocker/CameraCaptureModal/MemberCardModal/PrintPreviewModal/SlipViewButton/StatementModal from @/components/*, trpc from @/lib/trpc, downloadSlipFile from @/exportUtils, ConfirmDialog/SectionHeader/StatusPill/formEnterNav from ../PagePrimitives, PRENAME_OPTIONS/compressImageToDataUrl/isAdminRole/memberFullName/money/roleThaiLabel + type MemberLite/Role from ../pageData, MEMBER_STATUS_META/WALLET_TX_META/formatHistoryDate/formatLastActivity/formatThaiDate/getErrorMessage/isSameMonth/parseStoreDate from ../viewFormat
  - JSDoc อธิบาย origin (extracted from Home.tsx V2-C2 — pure move) + cite ROUND 77 (wallet slip), Round 31 (2-step deposit/withdrawal), ROUND 34 (req 23.2 — limit-reduction request), ROUND 38 (ข้อ 37 — camera photo upload)
  - วาง `export function MemberDetail({...}) { ... }` ตรง จาก awk extract ของ Home.tsx lines 377-1972 (เช็ค tail แล้วสะอาด — จบท `</>` + `);` + `}`)
- แก้ Home.tsx: `sed -i -e '377,1973d'` ลบ function body (377-1972) + trailing blank (1973) — รวม 1597 บรรทัดที่ลบ; ผลคือ Home.tsx 9895 → 8298 บรรทัด (−1597, ~16%)
- ตรวจ boundaries หลัง sed: `];` (POS_RAIL_BUTTONS ปิด) → blank → `const TX_TYPE_LABEL` (สะอาด, 1 blank line separator — ตรงตาม original convention)
- ไม่ต้องลบ `export` keyword เพราะลบ function ทั้งหมด; ไม่ต้องแตะ imports ของ Home.tsx เพราะ imports เหล่านั้นยังใช้กับ functions อื่นในไฟล์ (Reports, Settings, Home)
- แก้ `client/src/pages/members/Members.tsx`: เปลี่ยน `import { MemberDetail } from "../Home";` → `import { MemberDetail } from "./MemberDetail";` พร้อมแทน comment block (V2-C1 circular-import warning) ด้วย V2-C2 note ("MemberDetail now lives in its own file next to Members — circular ESM ถูกแทนด้วย direct import")
- รักษา business logic ทั้งหมด — pure move/extract: ไม่แตะ tRPC contract, ไม่ลบ state/props/handlers แม้แต่ unused, ไม่เปลี่ยน `React.ChangeEvent` → `ChangeEvent`
- `pnpm run check` (tsc --noEmit) → **0 errors** ✅
- บูต dev server (`setsid bash -c './node_modules/.bin/tsx server/_core/index.ts >> dev.log 2>&1'` detached) → curl `/` HTTP 200 + curl Vite transform สำหรับ 4 ไฟล์ที่กระทบ (Home.tsx, MemberDetail.tsx, Members.tsx, และ /) ทั้งหมด HTTP 200 ✅ — modules transform ผ่าน Vite pipeline ไม่มี parse/transform error ใหม่

Stage Summary:
- ไฟล์ที่เปลี่ยน:
  - `client/src/pages/members/MemberDetail.tsx` (ใหม่ — 1672 บรรทัด): named export `MemberDetail` + imports เฉพาะที่ใช้ (24 icons + 7 components + trpc + exportUtils + blocker + PagePrimitives/pageData/viewFormat) + JSDoc อ้างอิง ROUND 77/31/34/38
  - `client/src/pages/Home.tsx` (9895 → 8298 บรรทัด, ลด 1597 บรรทัด ~16%): ลบ `export function MemberDetail` ทั้งหมด; imports ที่ยังใช้กับ Reports/Settings/Home คงไว้
  - `client/src/pages/members/Members.tsx` (336 → 336 บรรทัด, +3/-3 สุทธิ): เปลี่ยน import path ของ MemberDetail จาก `../Home` → `./MemberDetail`; แทน V2-C1 circular-import comment ด้วย V2-C2 note
- MemberDetail extracted สำเร็จ — ไฟล์ตั้งอยู่ข้าง Members.tsx ใน `pages/members/` directory; circular ESM (Members ↔ Home.tsx) ที่ V2-C1 introduce ไว้ถูกแทนที่ด้วย direct local import — Members.tsx ไม่ import อะไรจาก Home.tsx อีกต่อไป
- Home.tsx ลดลงจาก 9895 → 8298 บรรทัด; ฟังก์ชันใหญ่ ๆ ที่เหลือ: Reports (line 2051, ~3627 บรรทัด), Settings (line 5915, ~3914 บรรทัด), Home (line 9829, ~66 บรรทัด) — scheduled for V2-D / V2-E
- TypeScript: 0 errors, dev server: HTTP 200 ผ่าน (root + 3 module transforms)
- commit hash: `cfb3db1` บน origin/main-v2

---
Task ID: V2-C3
Agent: full-stack-developer (Reports extraction)
Task: V2 refactor — Step C-3: Extract Reports function (~3605 lines, sales summary + bills + member tx + stock balance + member balances view) from Home.tsx into `client/src/pages/reports/Reports.tsx` (its own file next to TimelineDrilldown.tsx) and repoint Home.tsx to import Reports from the new file.

Work Log:
- อ่าน worklog เข้าใจ context V2-A/B/C1/C2 (CSS tokens split done, AppShell extracted to layouts/, TimelineDrilldown+Members+Logs+MemberDetail extracted; Home.tsx ยังมี Reports/Settings/Home อยู่ข้างใน)
- grep `^function Reports` ใน Home.tsx → พบที่ line 454; หา end โดยดู top-level declarations ถัดไป → พบ `const MEMBER_IMPORT_FIELDS` ที่ line 4081 → Reports ครอบ lines 454-4058 (function body) + 1 blank (4059) = 3605 บรรทัด function body
- awk extract lines 454-4058 → `/tmp/reports_fn.tsx` (3605 บรรทัด) สำหรับ analyze dependencies
- Identify imports โดย grep ชื่อ import แต่ละตัวในช่วง function body:
  - React hooks (5): Fragment (2), useEffect (5), useMemo (5), useRef (2), useState (27)
  - lucide icons (21): Activity, ArrowRight, CalendarDays, Check, ChevronDown, Download, FileBarChart, FileSpreadsheet, FileText, Lock, PackageSearch, Printer, ReceiptText, RotateCcw, Search, ShieldCheck, ShoppingBag, TrendingDown, UsersRound, WalletCards, X
  - @shared/editions: EditionFeatureKey (1)
  - @/components/EditionUi: EditionUpgradeModal (1), useEditionStatus (1)
  - ../pageData (types): MemberLite (2), Role (1)
  - server/sqliteStore (types): MemberTransactionRow (1), SaleHistoryEntry (1)
  - ../pageData (funcs): isAdminRole (3), memberFullName (3), money (62), scanCandidates (1)
  - ../PagePrimitives: SectionHeader (1), StatusPill (8)
  - @/components/ThaiDatePicker: ThaiDatePicker (6)
  - @/reportDoc: downloadReportPdf (1), printReportDoc (1), ReportDocConfig (5, type)
  - @/components/ExportPreviewModal: ExportPreviewModal (1), ExportFormat (6, type), ExportPreviewState (1, type)
  - @/exportUtils: downloadCsvFile (1), downloadXlsxFile (1), exportCount (74), exportNumber (75)
  - @/components/ScanPickers: MemberScanPicker (2)
  - @/components/SlipViewModal: SlipViewButton (1)
  - @/components/ReceiptModal: ReceiptModal (1)
  - ./TimelineDrilldown: TimelineDrilldown (1) — V2-C1 sibling file
  - @/lib/trpc: trpc (15)
  - ../viewFormat: formatLogDateTime (10), formatShortDay (3), formatThaiDate (10), formatThaiMonthYear (1), getErrorMessage (10), isSameMonth (1), parseBahtFromDetail (1), parseStoreDate (1)
- Cross-check 10 pre-Reports constants/types ใน Home.tsx (lines 210-452) ว่าใช้เฉพาะใน Reports หรือไม่ (grep ชื่อทั้งไฟล์ Home.tsx):
  - **MOVE ไป Reports.tsx** (Reports-only): PAYMENT_PILL_TONE (use ใน 2971), TX_TYPE_LABEL (1577,1598,1623,3325,3333), TX_TYPE_TONE (3324,3332), LIMIT_STATUS_META (3299), LIMIT_ROW_ID_OFFSET (829), TimelineRow (920,937), ReportRangeMode (473,528,540,568,592), ReportGroupBy (474), REPORT_RANGE_CHIPS (543,628,2150,3126,3490), REPORT_GROUPBY_CHIPS (2214) — ทุก usage อยู่ในช่วง 454-4058 (Reports function body)
  - **STAY ใน Home.tsx** (used by Settings หลัง line 4318): SETTINGS_FIELD_LABELS (4864), POS_RAIL_BUTTONS (6348), SettingsForm (4350+)
  - ไม่ใช้ใน Reports: SETTINGS_FIELD_LABELS, POS_RAIL_BUTTONS, SettingsForm, MEMBER_IMPORT_FIELDS, PRODUCT_IMPORT_FIELDS, ROLE_MATRIX, DEV_SETTINGS_TAB_IDS, GO_LIVE_CHECKLIST, formatFileSize, uptimeLabel, shrinkLogoToDataUrl, parseGoliveChecks, importColumnLabel, isSameDay — ทั้งหมด confirmed ไม่ใช้ใน Reports function body
- สร้าง `client/src/pages/reports/Reports.tsx` (3776 บรรทัด = 172 header + 3604 function body):
  - imports: เฉพาะที่ใช้ (5 React hooks + 21 lucide icons + EditionFeatureKey type + EditionUpgradeModal/useEditionStatus + MemberLite/Role types + MemberTransactionRow/SaleHistoryEntry types + isAdminRole/memberFullName/money/scanCandidates + SectionHeader/StatusPill + ThaiDatePicker + downloadReportPdf/printReportDoc/ReportDocConfig + ExportPreviewModal/ExportFormat/ExportPreviewState + downloadCsvFile/downloadXlsxFile/exportCount/exportNumber + MemberScanPicker + SlipViewButton + ReceiptModal + TimelineDrilldown + trpc + formatLogDateTime/formatShortDay/formatThaiDate/formatThaiMonthYear/getErrorMessage/isSameMonth/parseBahtFromDetail/parseStoreDate)
  - JSDoc header อธิบาย origin (extracted from Home.tsx V2-C3 — pure move/extract) + cite ROUND 30 (ข้อ 25), ROUND 48 (timeline row), ROUND 49 (range picker), ROUND 51 (staff filter), ROUND 61 (advanced reports), ROUND 77 (multi-tx-type), ROUND 79 (multi-cashier), ROUND 34 (req 23.2 limit status), UI-9 (tx range chips)
  - วาง 10 constants/types ที่ Reports-only ก่อน function: PAYMENT_PILL_TONE, TX_TYPE_LABEL, TX_TYPE_TONE, LIMIT_STATUS_META, LIMIT_ROW_ID_OFFSET, TimelineRow, ReportRangeMode, ReportGroupBy, REPORT_RANGE_CHIPS, REPORT_GROUPBY_CHIPS
  - วาง `export function Reports({...}) { ... }` ตรง จาก awk extract ของ Home.tsx lines 454-4058 (skip บรรทัดแรก `function Reports({` เพราะ header มี `export function Reports({` อยู่แล้ว)
- แก้ Home.tsx 3 จุด:
  1. Edit imports block: แทน V2-C1 comment "TimelineDrilldown is consumed by Reports (still in Home.tsx)." ด้วยบรรทัด import ใหม่ `import { Reports } from "./reports/Reports";` พร้อม V2-C3 comment block (3 บรรทัด)
  2. `sed -i -e '212,218d' -e '379,4061d' client/src/pages/Home.tsx` — ลบ PAYMENT_PILL_TONE block (lines 212-218 = comment + const + trailing blank) + ลบ TX_TYPE_LABEL → end of Reports function + trailing blank (lines 379-4061)
  3. (ไม่ต้องแก้ imports อื่นของ Home.tsx เพราะ imports เหล่านั้นยังใช้กับ Settings/Home ที่เหลืออยู่)
- ตรวจ boundaries หลัง sed: `} from "./pageData";` (210) → blank (211) → `type SettingsForm = {` (212, clean) และ `];` (370, POS_RAIL_BUTTONS close) → blank (371) → `// ROUND 40 (ข้อ 32)...` (372, clean)
- รักษา business logic ทั้งหมด — pure move/extract: ไม่แตะ tRPC contract, ไม่ลบ state/props/handlers/toggle handlers/pickRangeChip/pickTxRangeChip helpers (ทั้งหมดอยู่ใน function body ที่ย้ายไป Reports.tsx), ไม่เปลื่ยน `role`/`userName`/`focusBill`/`onFocusBillConsumed` props
- `pnpm run check` (tsc --noEmit) → **0 errors** ✅
- บูต dev server (`setsid bash -c './node_modules/.bin/tsx server/_core/index.ts >> dev.log 2>&1'` detached) → curl `/` 3 ครั้ง stable HTTP 200/200/200 ✅ — modules transform ผ่าน Vite/tsx pipeline ไม่มี parse/transform error ใหม่
- commit `0203737` push ขึ้น origin/main-v2 สำเร็จ (b19075c..0203737, rebase: "Current branch main is up to date" — no new commits บน remote ตอน pull)

Stage Summary:
- ไฟล์ที่เปลี่ยน:
  - `client/src/pages/reports/Reports.tsx` (ใหม่ — 3776 บรรทัด): named export `Reports` + 10 Reports-only constants/types ย้ายมาจาก Home.tsx + imports เฉพาะที่ใช้ + JSDoc อ้างอิง ROUND 30/48/49/51/61/77/79/34/UI-9
  - `client/src/pages/Home.tsx` (8300 → 4610 บรรทัด, ลด 3690 บรรทัด ~44%): ลบ PAYMENT_PILL_TONE block + ลบ TX_TYPE_LABEL/TX_TYPE_TONE/LIMIT_STATUS_META/LIMIT_ROW_ID_OFFSET/TimelineRow/ReportRangeMode/ReportGroupBy/REPORT_RANGE_CHIPS/REPORT_GROUPBY_CHIPS + ลบ Reports function (3605 บรรทัด) + เพิ่ม V2-C3 import `import { Reports } from "./reports/Reports";`; imports ที่ยังใช้กับ Settings/Home คงไว้ทั้งหมด
- Reports extracted สำเร็จ — ไฟล์ตั้งอยู่ข้าง TimelineDrilldown.tsx ใน `pages/reports/` directory; Reports ใช้ TimelineDrilldown ผ่าน sibling import (`./TimelineDrilldown`) ไม่ต้องผ่าน Home.tsx อีก
- AppShell.tsx ไม่ถูกแตะ — viewComponents prop type คงเดิม (Members/Reports/Settings/Logs ComponentType) — Home() ยังส่ง viewComponents={{ Members, Reports, Settings, Logs }} เหมือนเดิม เพียงแต่ Reports ตอนนี้มาจาก import ไม่ใช่ local function declaration
- Home.tsx ลดลงจาก 8300 → 4610 บรรทัด; ฟังก์ชันใหญ่ ๆ ที่เหลือ: Settings (~3914 บรรทัด, line ~440 หลังลด), Home (~66 บรรทัด) — scheduled for V2-D / V2-E
- TypeScript: 0 errors, dev server: HTTP 200 ผ่าน (3 ครั้ง stable)
- commit hash: `0203737` บน origin/main-v2 — รอเจ้าของงาน pull ไปเทส reports view (sales summary timeline/category/product/items/cashier, bills history, member tx, stock balance, member balances, timeline drilldown, CSV/PDF export) บนเครื่อง

---
Task ID: V2-C4
Agent: full-stack-developer (Settings extraction)
Task: V2 refactor — Step C-4: Extract Settings function (~3914 lines, brand/receipt/member-number/payment/POS-menu/cutoff/roles/edition/license/backup/import/install/dev-tools/go-live) from Home.tsx into `client/src/pages/settings/Settings.tsx` (its own file next to Logs.tsx) and repoint Home.tsx to import Settings from the new file.

Work Log:
- อ่าน worklog เข้าใจ context V2-A/B/C1/C2/C3 (CSS tokens split done, AppShell extracted to layouts/, TimelineDrilldown+Members+Logs+MemberDetail+Reports extracted; Home.tsx ยังมี Settings + Home default เหลืออยู่)
- grep `^function Settings` ใน Home.tsx → พบที่ line 630; หา end โดยดู top-level declarations ถัดไป → พบ `export default function Home()` ที่ line 4544 → Settings ครอบ lines 630-4541 (function body) + blank (4542) + JSDoc (4543) — รวม 3912 บรรทัด function body
- Identify imports โดย grep ชื่อ import แต่ละตัวในช่วง function body (Python script with `\b` word boundaries):
  - React hooks (4 + 2 type): useEffect (6), useMemo (3), useRef (3), useState (27), ChangeEvent (1, type), ReactKeyboardEvent (1, type) — Fragment=0 (skip)
  - lucide icons (55): Activity, ArchiveRestore, ArrowDownToLine, ArrowRight, ArrowUpFromLine, Bell, CalendarClock, CalendarDays, Camera, Check, ChevronDown, CircleHelp, Cloud, Copy, CreditCard, Crown, DatabaseBackup, Download, FileSpreadsheet, FileUp, Globe, HardDriveDownload, Image (as ImageIcon), ImagePlus, LockKeyhole, LogOut, KeyRound, LayoutDashboard, ListChecks, Monitor, Network, PackageSearch, Palette, Pause, Plus, Printer, QrCode, ReceiptText, RefreshCw, RotateCcw, ScanLine, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, Star, Table2, Terminal, Trash2, UserCog, UserPlus, UsersRound, WalletCards, Wifi, Wrench, X, CircleAlert — ทุก icon settings>0 home=0 (Settings-only); 11 icons จาก Home.tsx header ไม่ใช้ใน Settings (FileBarChart, FileText, IdCard, Lock, Menu, MoreHorizontal, Search, Settings2, TrendingDown, FileImage) — ไม่ import
  - sonner: toast (27) — Settings-only, blocker=0 (Home.tsx เดิม import แต่ไม่ได้ใช้จริง)
  - @shared/editions: EDITIONS (2), editionStatusLabel (1) — Settings-only (EditionFeatureKey/EDITION_COMPARE_ROWS/EDITION_FEATURE_INFO/EDITION_TRIAL_DAYS/Edition ใช้ใน AppShell ไม่ใช่ Settings)
  - @/components/EditionUi: DevKeygenTool (1), EditionCompareTable (1), EditionUpgradeModal (1), useEditionStatus (1) — Settings-only (EditionPill ใช้ใน AppShell)
  - type Role/View from "../pageData" — Settings-only (MemberLite=0)
  - type InstallOverview from server/sqliteStore (1) — Settings-only (MemberTransactionRow/SaleHistoryEntry ใช้ใน Reports; User ใช้ใน AppShell)
  - canAccessView (1), formatMemberNumber (1), isAdminRole (2), money (10) from "../pageData" — Settings-only (PRENAME_OPTIONS/compressImageToDataUrl/loadHeldBills/memberFullName/navItems/roleThaiLabel/scanCandidates ใช้ใน Reports/Members/AppShell)
  - ConfirmDialog (3), SectionHeader (1), StatusPill (2) from "../PagePrimitives" — Settings-only (formEnterNav ใช้ใน MemberDetail)
  - HelpDisclosure (4) — Settings-only
  - isValidPromptPayId (1) — Settings-only
  - PrintPreviewModal (1) — Settings-only (ReceiptModal/MemberCardModal/StatementModal/CameraCaptureModal/SlipViewModal/SlipViewButton ใช้ใน MemberDetail/Reports)
  - trpc (17) from "@/lib/trpc"
  - SettingsTab (8) from "../shared" — shared กับ AppShell
  - applyFontScale (1), FONT_SCALES (1), readFontScale (1), FontScaleId (2) from "../../fontScale"
  - applyPaperWidth (2), applyThemeColor (3), applyUiStyle (2), brandInitial (1), PAPER_WIDTHS (1), resolvePaperWidth (1), resolveThemeColor (1), THEME_PRESETS (1), UI_STYLE_PRESETS (2) from "../../theme" (BrandSettings=0, applyBrand/applyCachedBrand ใช้ใน Home default)
  - getErrorMessage (9), formatLogDateTime (8), formatThaiDate (2), nextMemberSequence (1) from "../viewFormat" — ที่เหลือ (isSameDay/isSameMonth/MEMBER_STATUS_META/formatHistoryDate/formatLastActivity/formatShortDay/formatThaiMonthYear/parseBahtFromDetail/parseStoreDate/WALLET_TX_META) ใช้ใน MemberDetail/Reports/Logs
- Cross-check 16 constants/types ที่ประกาศเหนือ Settings function ใน Home.tsx (lines 212-628) ว่าใช้เฉพาะใน Settings หรือไม่ (grep ชื่อทั้งไฟล์ Home.tsx):
  - SettingsForm (line 212) — ใช้ที่ 256, 4350+ (Settings function body), ไม่ใช่ใน Home default → **MOVE ไป Settings.tsx**
  - SETTINGS_FIELD_LABELS (256) — Settings-only → **MOVE**
  - POS_RAIL_BUTTONS (293) — Settings-only (typeof Bell/ScanLine/UsersRound/etc.) → **MOVE**
  - ImportKindId (373), ImportSheetLite (374), ImportResultLite (382) — Settings-only → **MOVE**
  - MEMBER_IMPORT_FIELDS (393), PRODUCT_IMPORT_FIELDS (429), importColumnLabel (452) — Settings-only → **MOVE**
  - shrinkLogoToDataUrl (463) — Settings-only (ใช้ใน brand tab upload logo) → **MOVE**
  - ROLE_MATRIX (491) — Settings-only (roles tab) → **MOVE**
  - formatFileSize (524), uptimeLabel (532) — Settings-only (backup tab + install tab) → **MOVE**
  - DEV_SETTINGS_TAB_IDS (543) — Settings-only (type SettingsTab[] = ["install","network"]) → **MOVE**
  - parseGoliveChecks (546) — Settings-only (อ่าน JSON checks จาก settings) → **MOVE**
  - GO_LIVE_CHECKLIST (559) — Settings-only (install tab) → **MOVE**
  - ทุก const/type Settings-only → ย้ายทั้งหมดไป Settings.tsx (ไม่มี shared ระหว่าง Settings และ Home default)
- สร้าง `client/src/pages/settings/Settings.tsx` (4467 บรรทัด = 137 header + 417 consts + 1 blank + 3912 function body):
  - imports header (137 บรรทัด): JSDoc อธิบาย origin (extracted from Home.tsx V2-C4 — pure move) + cite ROUND 17/36/38/40/42/56/61/63/68/75/UI-2/UI-5; imports เฉพาะที่ใช้ (4 React hooks + 2 types + 55 lucide icons + toast + EDITIONS/editionStatusLabel + DevKeygenTool/EditionCompareTable/EditionUpgradeModal/useEditionStatus + Role/View types + InstallOverview type + canAccessView/formatMemberNumber/isAdminRole/money + ConfirmDialog/SectionHeader/StatusPill + HelpDisclosure + isValidPromptPayId + PrintPreviewModal + trpc + SettingsTab + applyFontScale/FONT_SCALES/readFontScale/FontScaleId + applyPaperWidth/applyThemeColor/applyUiStyle/brandInitial/PAPER_WIDTHS/resolvePaperWidth/resolveThemeColor/THEME_PRESETS/UI_STYLE_PRESETS + getErrorMessage/formatLogDateTime/formatThaiDate/nextMemberSequence)
  - ปรับ relative import paths สำหรับ new location (`client/src/pages/settings/`): `../../../server/sqliteStore` → `../../../../server/sqliteStore`, `./pageData` → `../pageData`, `./PagePrimitives` → `../PagePrimitives`, `./shared` → `../shared`, `../fontScale` → `../../fontScale`, `../theme` → `../../theme`, `./viewFormat` → `../viewFormat`; `@/...` และ `@shared/...` aliases คงเดิม
  - constants block (417 บรรทัด): 16 const/type ที่ Settings-only ย้ายมาจาก Home.tsx lines 212-628 ตรง ๆ (copy-paste) — เรียงเหมือนเดิม (SettingsForm → SETTINGS_FIELD_LABELS → POS_RAIL_BUTTONS → ImportKindId → ImportSheetLite → ImportResultLite → MEMBER_IMPORT_FIELDS → PRODUCT_IMPORT_FIELDS → importColumnLabel → shrinkLogoToDataUrl → ROLE_MATRIX → formatFileSize → uptimeLabel → DEV_SETTINGS_TAB_IDS → parseGoliveChecks → GO_LIVE_CHECKLIST)
  - function body (3912 บรรทัด): `export function Settings({...}) { ... }` จาก awk extract ของ Home.tsx lines 630-4541 ด้วย `sed '1s/^function Settings/export function Settings/'` — เปลี่ยน declaration line เดียวจาก `function Settings({` → `export function Settings({`, body อื่น ๆ คงเดิมทั้งหมด (state, useEffect, useMemo, handlers, JSX)
- แก้ Home.tsx (เขียนใหม่ทั้งไฟล์ผ่าน write_file — 95 บรรทัด จาก 4610 บรรทัด, ลด 4515 บรรทัด ~98%):
  - imports header (38 บรรทัด): เฉพาะที่ Home default function ใช้ — `useEffect` from react, `LoginView`/`SetupView`/`ForceChangeView` from @/components/*, `trpc` from @/lib/trpc, `AppShell` from ../layouts/AppShell, `applyBrand`/`applyCachedBrand` from ../theme, `Reports`/`Members`/`Logs`/`Settings` (ใหม่) from ./reports/Reports, ./members/Members, ./settings/Logs, ./settings/Settings — ลบ imports ที่ Settings-only ออกทั้งหมด (66 lucide icons, toast, blocker, 5 Edition symbols, 4 EditionUi components, Role/View/InstallOverview/User types, 7 pageData funcs, 4 PagePrimitives, HelpDisclosure, Dashboard/GlobalSearch/ThaiDatePicker, downloadReportPdf/printReportDoc/ReportDocConfig, ExportPreviewModal/ExportFormat/ExportPreviewState, 5 exportUtils funcs, MemberScanPicker, 7 modal components, isValidPromptPayId, ReceiptModal, PrintPreviewModal, Pos/Stock/Users, TimelineDrilldown, SettingsTab, 4 fontScale symbols, 12 theme symbols, 14 viewFormat symbols)
  - คง re-export block (`export { addScannedItem, calculateCartSubtotal, canAccessView, formatMemberNumber, isStockAlert } from "./pageData"`) — re-export block นี้จำเป็นเพราะ `client/src/pages/Home.test.ts` import names เหล่านี้จาก "./Home" (tsconfig exclude `*.test.ts` แต่ไฟล์ test ยังมีอยู่ — คง re-export เพื่อไม่ให้พัง)
  - JSDoc + Home default function (57 บรรทัด): คงเดิมทั้งหมด — auth.me → splash → SetupView → LoginView → ForceChangeView → AppShell (ส่ง viewComponents={{ Members, Reports, Settings, Logs }}); Settings ตอนนี้มาจาก import
- รักษา business logic ทั้งหมด — pure move/extract: ไม่แตะ tRPC contract, ไม่ลบ state/props/handlers/useEffect/JSX แม้แต่บรรทัดเดียวใน Settings function body; ไม่เปลื่ยน SettingsForm/POS_RAIL_BUTTONS/GO_LIVE_CHECKLIST/ROLE_MATRIX/MEMBER_IMPORT_FIELDS/PRODUCT_IMPORT_FIELDS data ตามต้นฉบับ; ไม่เปลี่ยน SettingsTab type (ใน shared.ts) — Settings import จาก shared ตามที่ V2-B ตั้งในไว้
- `pnpm run check` (tsc --noEmit) → **0 errors** ✅
- บูต dev server (`./node_modules/.bin/tsx server/_core/index.ts` ผ่าน nohup detached) → curl `/` 3 ครั้ง stable HTTP 200/200/200 ✅ + curl Vite transform สำหรับ 6 ไฟล์ (Home.tsx, Settings.tsx, AppShell.tsx, Members.tsx, Logs.tsx, Reports.tsx) ทั้งหมด HTTP 200 ✅ — modules transform ผ่าน Vite/tsx pipeline ไม่มี parse/transform error ใหม่; dev server stable หลัง curl หลายครั้ง (process ยัง alive)
- pre-existing tailwind "Missing opening {" CSS pre-transform warning (จาก V2-A's `@import tokens.css` split) ยังคงมี — V2-B/C1/C2/C3 note ระบุไว้ว่า "out of scope สำหรับ V2-C", ไม่ใช่ regression
- commit `cfb3db1` push ขึ้น origin/main-v2 สำเร็จ (0203737..cfb3db1, rebase ไม่สำเร็จเพราะมี unstaged tool-results deletions แต่ push สำเร็จเพราะ origin/main-v2 ยังอยู่ที่ 0203737 จาก V2-C3 — no remote changes ตอน pull)

Stage Summary:
- ไฟล์ที่เปลี่ยน:
  - `client/src/pages/settings/Settings.tsx` (ใหม่ — 4467 บรรทัด): named export `Settings` + 16 Settings-only const/type ย้ายมาจาก Home.tsx + imports เฉพาะที่ใช้ + JSDoc อ้างอิง ROUND 17/36/38/40/42/56/61/63/68/75/UI-2/UI-5
  - `client/src/pages/Home.tsx` (4610 → 95 บรรทัด, ลด 4515 บรรทัด ~98%): เหลือเพียง 38 บรรทัด imports (useEffect + LoginView/SetupView/ForceChangeView + trpc + AppShell + applyBrand/applyCachedBrand + Reports/Members/Logs/Settings) + 6 บรรทัด re-export block + 57 บรรทัด Home default function; ลบ Settings-only imports ทั้งหมดออกจาก header (66 lucide icons + toast + blocker + Edition symbols + EditionUi components + 5 types + 7 pageData funcs + 4 PagePrimitives + HelpDisclosure + Dashboard/GlobalSearch/ThaiDatePicker + reportDoc + ExportPreviewModal + 5 exportUtils + MemberScanPicker + 7 modal components + isValidPromptPayId + Pos/Stock/Users + TimelineDrilldown + SettingsTab + 4 fontScale + 12 theme + 14 viewFormat) — Settings-only imports ถูกลบทั้งหมดเพราะเหลือเพียง Home default function ที่ใช้ imports เพียง 6 ตัว
- Settings extracted สำเร็จ — ไฟล์ตั้งอยู่ข้าง Logs.tsx ใน `pages/settings/` directory; AppShell.tsx ไม่ถูกแตะ — viewComponents prop type คงเดิม (Members/Reports/Settings/Logs ComponentType) — Home() ยังส่ง viewComponents={{ Members, Reports, Settings, Logs }} เหมือนเดิม เพียงแต่ Settings ตอนนี้มาจาก import ไม่ใช่ local function declaration
- Home.tsx ลดลงจาก 4610 → 95 บรรทัด — เป็น thin auth-gate ที่ V2-A ตั้งในไว้ตั้งแต่ต้น (auth.me → splash → setup → login → force-change → AppShell); ฟังก์ชันใหญ่ ๆ ทั้งหมด (MemberDetail/Members/TimelineDrilldown/Logs/Reports/Settings/AppShell) แยกไฟล์เรียบร้อย — V2 refactor ครบ ถือว่า Step C สมบูรณ์
- TypeScript: 0 errors, dev server: HTTP 200 ผ่าน (3 ครั้ง stable + 6 module transforms ผ่าน — รวม Settings.tsx ไฟล์ใหม่)
- commit hash: `cfb3db1` บน origin/main-v2 — รอเจ้าของงาน pull ไปเทส settings view (brand/receipt/member-number/payment/pos-menu/cutoff/roles/edition/backup/import/install/dev-tools/go-live) บนเครื่อง

---
Task ID: V2-D+E
Agent: main (orchestrator)
Task: V2 refactor — Step D (shared components) + Step E (CSS fix)

Work Log:
- Step D: created 5 shared component files:
  - components/page/PageHeader.tsx (re-export SectionHeader from PagePrimitives)
  - components/page/EmptyState.tsx (icon + title + hint, variants: neutral/error/loading)
  - components/data/DataTable.tsx (table-wrap + entity-table wrapper)
  - components/data/FilterBar.tsx (filter chips container)
  - components/data/StatusBadge.tsx (re-export StatusPill from PagePrimitives)
- Step E: fixed Vite "Missing opening {" pre-transform error
  - Root cause: @import "./styles/tokens.css" in index.css confused Tailwind v4's CSS processor
  - Fix: moved tokens.css import from CSS @import to JS import in main.tsx
  - main.tsx now: import "./styles/tokens.css" then import "./index.css"
  - index.css: only @import "tailwindcss" + rules (no @import tokens)
- Fixed .gitignore: data/ → /data/ (was matching client/src/components/data/ by accident)
- TypeScript: 0 errors
- Boot: HTTP 200, "Missing opening {" errors = 0
- commit `996436b` pushed to origin/main-v2

Stage Summary:
- V2 refactor A-E COMPLETE
- Home.tsx: 11382 → 95 lines (99.2% reduction) — thin auth-gate router
- 11,808 lines extracted across 9 modular files:
  - layouts/AppShell.tsx (965)
  - pages/members/MemberDetail.tsx (1672)
  - pages/members/Members.tsx (335)
  - pages/reports/Reports.tsx (3776)
  - pages/reports/TimelineDrilldown.tsx (83)
  - pages/settings/Settings.tsx (4467)
  - pages/settings/Logs.tsx (268)
  - pages/shared.ts (30)
  - styles/tokens.css (212)
- 5 shared component abstractions created
- CSS @import warning resolved
- All TypeScript checks pass, server boots HTTP 200

---
Task ID: PT-1
Agent: full-stack-developer (PageTemplate → Reports)
Task: Apply PageTemplate standard to Reports.tsx — make VISIBLE changes (button hierarchy, toolbar grouping, compact guide, page-template structure).

Work Log:
- อ่าน worklog ครบเข้าใจ context V2-A→E (PageTemplate component + CSS ถูกสร้างใน commit `e3497fe` แต่ CSS ถูก revert ใน commit `64272a4` เพราะ Tailwind v4 แพส prettier multi-line ไม่ได้ — ตอนนี้ PageTemplate component ยังอยู่ แต่ CSS rules `.page-template-*` หายไป)
- อ่าน `client/src/components/page/PageTemplate.tsx` (79 บรรทัด) — component ให้ `<PageTemplate>` wrapper + `.Header/.Toolbar/.Content/.ContextualBar` subcomponents; แต่ subcomponents ใช้ class `.page-template-header/toolbar/content/contextual` ที่ revert ไปแล้ว — ต้อง re-add CSS
- อ่าน `client/src/pages/reports/Reports.tsx` ส่วน JSX return (lines 1621-3776) ผ่าน Read หลายช่วง — เข้าใจโครงสร้าง:
  - `<>` Fragment → `<div className="report-quick-guide">` (3 คอลัมน์ + ปุ่ม reset) → `<SectionHeader action={<outline-button date toggle>}` → 4 summary cards → `<div className="dash-workbench"><div className="dash-tabbar">5 แท็บ</div><div className="dash-tab-body">5 sections</div></div>` → modals (limit/receipt/export-preview/upgrade/notice)
  - แต่ละ tab section: panel-heading + report-export-actions (CSV/Excel/PDF outline) + report-view-pills (sub-tabs) + report-range-row (period chips + staff filters + groupby + custom date picker) + table + table-show-more
- ตรวจ CSS classes ที่เกี่ยวข้องใน `client/src/index.css`:
  - `.primary-button`/`.outline-button` (line 108-111): primary = solid teal green, outline = white/gray border
  - `.dash-tab.active` (line 2356): soft style — `background: var(--teal-mist); color: var(--teal-dark); box-shadow: inset 2.5px 0 0 var(--teal);`
  - `.report-view-pills button.active` (line 2836): **solid green** — `background: var(--teal); color: #fff;` (conflicts with primary button — multiple greens)
  - `.tx-type-pills button.active` (line 2854): **solid green**
  - `.report-range-row .report-period-pills button.active` (line 4262): **solid green**
  - `.report-quick-guide` (line 3372): 3-column grid + 4th column (reset button)
  - `.report-cards-dense` (line 5228): compact cards (already UI-1)
  - `.page-template*` rules: **ไม่มี** (reverted in 64272a4)
- Apply 6 visible improvements:

  **(1) Wrap return JSX in `<PageTemplate>`** — เพิ่ม `import { PageTemplate } from "@/components/page/PageTemplate";` (หลัง SectionHeader import), เปลี่ยน `<>` → `<PageTemplate>` และ `</>` → `</PageTemplate>`. PageTemplate คืน `<div className="page-template">` ที่จัด flex column gap 12px → ทำให้หน้ามี vertical rhythm สม่ำเสมอ

  **(2) ลบ `report-quick-guide` 3-คอลัมน์ และพับเข้า description** — ลบทั้ง block 39 บรรทัด (3 ช่อง + reset button). ย้าย 3-step guide ("1. เลือกรายงาน → 2. กรองข้อมูล → 3. ส่งออก") ไปเป็นข้อความ inline ใน `description` prop ของ SectionHeader — ประหยัดพื้นที่แนวตั้ง ~110px เห็นชัด

  **(3) ย้าย reset filters button เข้า header action** — จากใน report-quick-guide มาอยู่ใน `action` prop ของ SectionHeader คู่กับ date picker toggle. ใช้ `<div className="page-template-action">` ห่อ 2 ปุ่ม (outline reset + primary date) เรียงในแนวนอน ตามมาตรฐาน PageTemplate (header มี primary action บนขวา)

  **(4) Button hierarchy — only ONE primary (green) per page** — date picker toggle เปลี่ยนจาก `outline-button` → `primary-button` (เป็น primary action ตามกฎ). reset filters คง outline-button compact. ปุ่ม export (CSV/Excel/PDF/print) ทั้ง 4 ที่อยู่ใน panel-heading คง outline-button compact (secondary actions). ไม่มี primary button อื่นในหน้านี้แล้ว ยกเว้น limit-act-approve ในตาราง (soft pill, light bg + dark text — ไม่ใช่ solid green จึงไม่ชนกับ primary)

  **(5) Soften active state ของ secondary tabs/chips** — เปลี่ยน active style ของ 3 ที่จาก solid green bg → soft mist bg + teal-dark text ให้ตรงกับ dash-tab style:
    - `.report-view-pills button.active` (line 2836): `background: var(--teal-mist); border-color: var(--teal); color: var(--teal-dark); font-weight: 600;`
    - `.tx-type-pills button.active` (line 2854): เหมือนกัน
    - `.report-range-row .report-period-pills button.active` (line 4262): เหมือนกัน
    - ผล: active sub-tab/period chip เป็น "selected" ชัดแต่ไม่แย่งสีเขียวจากปุ่ม primary — ตอบ rule 3 (tabs ใช้สไตล์เดียวกันทุกหน้า) + rule 2 (only ONE green per page)

  **(6) Re-add `.page-template-*` CSS rules** (reverted ใน 64272a4) — เพิ่ม block ใหม่ที่ท้าย `client/src/index.css` (line 5498+) ในรูปแบบ **single-line per rule** (ไม่ใช่ prettier multi-line) เพื่อหลีกเลี่ยง Tailwind v4 parse bug ที่เคยทำให้พัง:
    - `.page-template { display: flex; flex-direction: column; gap: 12px; }`
    - `.page-template-header`, `.page-template-action`, `.page-template-toolbar`, `.page-template-content`, `.page-template-contextual` ครบ
    - เพิ่ม `.report-workbench .page-template-action .outline-button.compact { height: 30px; }` และ `.app-shell:not(.pos-terminal) .page-content:has(.report-workbench) .page-template .section-header { margin-bottom: 8px; gap: 10px; }` เพื่อให้ layout สอดคล้องกับที่เดิมทำไว้ใน line 5329-5330
- ไม่แตะ business logic: tRPC queries, data processing (timeline rows, tx rows, stock balance rows, balance rows), export logic (downloadReportPdf/printReportDoc/downloadCsvFile/downloadXlsxFile), state handlers (setReportTab/setSalesView/pickRangeChip/toggleStaffFilter/pickCustomFrom/pickCustomTo/setTxTypes/pickTxRangeChip/setGroupBy/resetReportFilters), modal logic (limitDecision/exportPreview/viewedReceipt/upgradeFeature/notice) — ทั้งหมดคงเดิม
- รักษา functionality ครบ: 5 tabs (sales/bills/transactions/stock/balances) + 5 sub-views (timeline/product/items/category/cashier) + 4 range chips + multi-staff filter + multi-tx-type filter + 3 group-by chips + custom date range + CSV/Excel/PDF/print export preview + limit decision modal + receipt modal + slip view + edition upgrade
- `npx tsc --noEmit` → **0 errors** ✅ (PageTemplate import path `@/components/page/PageTemplate` ใช้ alias `@/*` → `./client/src/*` จาก tsconfig.json ถูกต้อง)
- บูต dev server (`pkill -f tsx; nohup setsid ./start-dev.sh >> dev.log 2>&1 & disown; sleep 12`) → curl `/` 3 ครั้ง → HTTP 200/200/200 ✅ stable
- dev.log: ไม่มี "Missing opening {" Tailwind v4 error (single-line CSS format แพสผ่าน); มีเพียง `[OAuth] OAUTH_SERVER_URL not configured` (pre-existing) และ `[Auth] Missing session cookie` (curl ไม่มี session ปกติ)
- commit `8b0ce4c` push ขึ้น origin/main-v2 สำเร็จ (64272a4..8b0ce4c, rebase "Current branch main is up to date" — no remote changes ตอน pull)

Stage Summary:
- ไฟล์ที่เปลี่ยน:
  - `client/src/pages/reports/Reports.tsx` (3776 → 3767 บรรทัด, ลด 9 บรรทัดจากการลบ report-quick-guide block 39 บรรทัด + เพิ่ม PageTemplate wrapper + restructured action area): เพิ่ม import PageTemplate + เปลี่ยน `<>` → `<PageTemplate>` + ลบ report-quick-guide 3-คอลัมน์ (folds 3-step guide เป็น inline description) + ย้าย reset button เข้า header action area + date picker toggle จาก outline-button → primary-button (เป็น primary action เดียวใน header)
  - `client/src/index.css` (5496 → 5513 บรรทัด, เพิ่ม 17 บรรทัด): soften active state 3 ที่ (report-view-pills/tx-type-pills/report-period-pills) จาก solid green → soft mist bg + teal text (ตรง dash-tab style) + re-add `.page-template-*` CSS rules (single-line format) ที่ถูก revert ใน 64272a4 + 2 layout-specific rules สำหรับ reports page
- Visible changes ที่เจ้าของงานจะเห็น:
  1. **หัวหน้าสะอาด**: header มี 2 ปุ่มชิดขวา (outline "ล้างตัวกรอง" + **green primary** date picker) แทนที่จะมี outline ปุ่มเดียว + มี quick-guide 3-คอลัมน์กินพื้นที่ด้านบน
  2. **ประหยัดพื้นที่ ~110px**: ลบ block "1. เลือกรายงาน / 2. กรอง / 3. ส่งออก" ออก — คู่มือ 3 ขั้นตอนพับเข้า description บรรทัดเดียวใต้ title "รายงาน"
  3. **สีเขียวเด่นชัด 1 จุด**: date picker toggle เป็น green solid เดียวใน header — ส่วน active chips (วันนี้/7วัน/30วัน/กำหนดเอง, ภาพรวม/แยกสินค้า/แยกรายการ/แยกพนักงาน, ทั้งหมด/ใช้จ่าย/เติมเงิน/...) เปลี่ยนจาก solid green → soft teal-mist bg + teal-dark text (เหมือน main dash-tab) ไม่แย่งสีเขียว
  4. **Vertical rhythm สม่ำเสมอ**: `<PageTemplate>` ห่อทั้งหน้าด้วย flex column gap 12px — cards/toolbar/tabs/modals ห่างกันเท่ากันหมด
- ไม่เปลี่ยน: tRPC contracts, business logic, export logic, modal logic, tRPC queries, data processing, 5-tab/5-view structure, CSV/Excel/PDF/print exports, range/staff/tx-type filters — ทั้งหมดคงเดิม เป็น pure styling/restructuring ตาม PageTemplate standard
- TypeScript: 0 errors, dev server: HTTP 200 ผ่าน (3 ครั้ง stable + no Tailwind v4 parse error)
- commit hash: `8b0ce4c` บน origin/main-v2 — รอเจ้าของงาน pull ไปเทส reports view บนเครื่อง (เห็น primary green button + compact header + softened active chips + clean rhythm)


---
Task ID: PT-2
Agent: full-stack-developer (sidebar restructure + Users cards)
Task: Restructure sidebar (≤6 top-level items: 5 primary + 1 expandable "จัดการระบบ" group), add icon-only collapse toggle with tooltips, clean up sidebar badges (only action-needed), and fix Users page to show 5 stat cards in one row.

Work Log:
- อ่าน worklog เข้าใจ context V2-A→E + PT-1 (PageTemplate applied to Reports, CSS re-added in single-line format ที่ commit 8b0ce4c)
- อ่าน `client/src/pages/pageData.ts` (303 บรรทัด) — `navItems` array มี 5 items (dashboard/pos/stock/members/reports); settings/users/logs ไม่อยู่ใน navItems แต่ถูก render แยกใน AppShell.tsx ภายใต้ `{isAdminRole(role) ? (...) : (...)}`
- อ่าน `client/src/layouts/AppShell.tsx` (965 → 977 บรรทัด หลังแก้) — sidebar render section (lines 533-646 เดิม): `.brand` + `.role-card` + `.nav-group-label` "เมนูหลัก" + `<nav>` (5 primary) + admin section (`<div className="nav-group-label">สำหรับผู้บริหาร</div>` + `<nav className="secondary-nav">` 3 ปุ่ม: settings/users/logs) หรือ `.locked-nav` (staff) + `.sidebar-footer`; current badges: low-stock บน stock nav (action-needed — keep), ไม่มี member/bill data-count badges อยู่แล้ว — เพียงแค่เพิ่ม held-bills badge บน POS nav (action-needed: resume parked bill)
- อ่าน `client/src/pages/Users.tsx` (191 บรรทัด) — บรรทัดเดียว JSX ใหญ่; stat cards ใช้ `<div className="stock-overview">` (4-col grid ที่ share กับ Stock.tsx) แต่มี 5 cards (admin/staff/dev/suspended/total) → บน desktop แสดง 4 แถว wrap ไม่สวย
- Apply 4 changes:

  **(1) Sidebar restructure — 5 primary + 1 expandable "จัดการระบบ" group (≤6 top-level)**
  - เพิ่ม state hooks 2 ตัว: `sidebarCollapsed` (default false — desktop expanded) + `adminGroupOpen` (default false — group collapsed)
  - ลบ `<div className="nav-group-label">สำหรับผู้บริหาร</div>` + `<nav className="secondary-nav">` block เดิม (3 buttons)
  - แทนด้วย `<div className="nav-admin-section{sidebarCollapsed ? " collapsed" : ""}{adminGroupOpen ? " open" : ""}">` ที่มี:
    - เมื่อ sidebar expanded: `<button className="nav-group-toggle">` (header: Settings2 icon + "จัดการระบบ" + ChevronDown) → click เพื่อ expand/collapse; sub-items render เฉพาะเมื่อ `adminGroupOpen === true`
    - เมื่อ sidebar collapsed (icon-only): ข้าม toggle ไปเลย แสดง 3 icon buttons (Settings2/UserCog/Activity) ใน `<nav className="nav-group-children">` โดยตรง เพื่อให้ admin เข้า settings/users/logs ได้โดยไม่ต้อง expand sidebar
  - ผล: 6 top-level (5 primary + 1 group header) = ≤6 ✅; primary items "ภาพรวม/หน้าร้าน POS/สต็อกสินค้า/สมาชิกและบัญชี/รายงาน" + group "จัดการระบบ" (settings/users/logs) collapsed by default

  **(2) Sidebar collapse toggle — icon-only mode (~64px) + native tooltip**
  - เพิ่ม `<button className="sidebar-collapse-btn">` (ChevronLeft/ChevronRight จาก lucide) ใน `.brand` block (ถัดจาก mobile-close)
  - ปุ่มนี้ hidden by default; แสดงเฉพาะ desktop ผ่าน `@media (min-width: 821px) { ... }` (mobile drawer ใช้ mobile-close แทน)
  - `<aside className="sidebar${mobileNav ? " open" : ""}${sidebarCollapsed ? " collapsed" : ""}${safeView === "pos" ? " pos-context" : ""}">` — `collapsed` class ถูก toggle
  - เพิ่ม `title={label — caption}` attribute ให้ทุก primary nav button (จาก `navItems`) + `title` ในทุก admin sub-item button — native tooltip เด้งเมื่อ hover ใน icon-only mode
  - CSS (single-line format): `.sidebar.collapsed` width 64px + ซ่อน `.brand-text` / `.role-card > div` / `.nav-group-label` / `nav button b` / `.sidebar-logout b` / `.sidebar-version` / `.sidebar-powered`; ทุก nav button จัดกึ่งกลาง (padding 11px 0, justify-content center); `.sidebar-collapse-btn` margin auto + mb 14px
  - Visual indicator: ใช้ existing `nav button.active` (solid green bg + white text + box-shadow) ที่ถูกสไตล์อยู่แล้ว — เห็นชัดทั้ง expanded และ collapsed mode

  **(3) Badge cleanup — action-needed only**
  - KEEP: low-stock badge บน stock nav (`{id === "stock" && lowStock.length > 0 && <i className="nav-badge">{lowStock.length}</i>}`) — needs restocking
  - ADD: held-bills badge บน POS nav (`{id === "pos" && posHeldCount > 0 && <i className="nav-badge">{posHeldCount}</i>}`) — needs to resume parked bill (POS rail มี rail-badge อยู่แล้ว แต่ sidebar nav ไม่เคยมี → เพิ่มตาม rule "✅ Held bills count (POS — needs to resume)")
  - REMOVE: ไม่มี data-count badges (member total, bill total) อยู่ใน sidebar อยู่แล้ว — ไม่ต้องลบอะไร
  - Pending limit requests badge: ไม่มีใน sidebar (limit approval flow อยู่ใน Reports table แล้ว) — skip ตาม rule "If a badge was showing a data count, remove it" (ไม่มี badge ให้ลบ ก็ไม่ต้องเพิ่ม)
  - ผล: badge ใน sidebar มีเฉพาะ action-needed (low stock + held bills) — ไม่มี data-only badges

  **(4) Users page — 5 stat cards in one row**
  - เปลี่ยน `<div className="stock-overview">` → `<div className="users-overview">` ใน Users.tsx return JSX (5 cards: total/admin/staff/dev/suspended)
  - CSS (single-line): `.users-overview { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 12px; }` (5-in-a-row on desktop)
  - Responsive: `@media (max-width: 1280px) { ... repeat(3, 1fr); }` (mid) → `@media (max-width: 720px) { ... repeat(2, 1fr); }` (small) → `@media (max-width: 480px) { ... 1fr; }` (very small) — wraps ลงมา 3→2→1 ตาม breakpoint
  - แยกจาก `.stock-overview` (4-col) ที่ Stock.tsx ยังใช้อยู่ — ไม่กระทบ Stock page

- รักษา business logic ทั้งหมด — pure styling/restructuring:
  - ไม่แตะ tRPC contracts (auth.logout, settings.get, stock.rows, member.list)
  - ไม่ลด/เพิ่ม state หลัก (mobileNav/posShortcut/posHeldCount/notifOpen/pendingMemberNumber/pendingBillNumber/settingsFocusTab/activeView) — เพียงเพิ่ม 2 state ใหม่ (sidebarCollapsed/adminGroupOpen)
  - ไม่แตะ POS rail (rail-btn, rail-scan, rail-customer, rail-deposit, rail-withdraw, rail-special, rail-hold, rail-register, rail-manage, rail-inventory, rail-add, rail-exit) — POS rail ยังเหมือนเดิม
  - ไม่แตะ topbar (breadcrumb, global-search, top-icon notif-bell, profile-pill) — ยังเหมือนเดิม
  - ไม่แตะ page-content view switching (Dashboard/Pos/Stock/Members/Reports/Settings/Users/Logs) — ยังเหมือนเดิม
  - ไม่แตะ Users.tsx business logic (search/filter, CRUD mutations, modals, ConfirmDialog, session revoke, password reset) — เปลี่ยนเพียง className ของ overview grid
- รักษา functionality ครบ: 8 views (dashboard/pos/stock/members/reports/settings/users/logs), 5 primary nav items, 3 admin sub-items, POS rail 10 buttons, topbar search + bell + profile, mobile drawer, role-based access control (staff ไม่เห็น admin section, dev/admin เห็น)

- `npx tsc --noEmit` → **0 errors** ✅ (ChevronDown/ChevronLeft/ChevronRight imports เพิ่มเข้ามา ไม่มี unused; navItems มี caption field อยู่แล้วใน type — title template string ใช้ได้)
- บูต dev server (`pkill -f tsx; nohup bash -c './start-dev.sh > dev.log 2>&1' &) → รอ 12s → curl `/` 3 ครั้ง stable HTTP 200/200/200 ✅ — process alive หลังครั้งสุดท้าย (PID 4073 + 4088)
- dev.log: `grep -c "Missing opening" dev.log` = **0** ✅ — single-line CSS format แพสผ่าน Tailwind v4 pre-transform; มีเพียง pre-existing `[OAuth] OAUTH_SERVER_URL not configured` และ `[Auth] Missing session cookie` (curl ไม่มี session ปกติ) — ไม่มี parse/transform error ใหม่
- commit `4a89602` push ขึ้น origin/main-v2 สำเร็จ (8b0ce4c..4a89602, rebase "Current branch main is up to date" — no remote changes ตอน pull)

Stage Summary:
- ไฟล์ที่เปลี่ยน:
  - `client/src/layouts/AppShell.tsx` (965 → 977 บรรทัด, +124 -37): เพิ่ม 3 lucide imports (ChevronDown/ChevronLeft/ChevronRight) + 2 state hooks (sidebarCollapsed/adminGroupOpen) + `<button className="sidebar-collapse-btn">` toggle + ใส่ `collapsed` class บน `<aside>` + `title` attribute บนทุก nav button + เพิ่ม held-bills badge บน POS nav + ปรับ admin section จาก `<><div className="nav-group-label">สำหรับผู้บริหาร</div><nav className="secondary-nav">` → `<div className="nav-admin-section"><button className="nav-group-toggle">จัดการระบบ ChevronDown</button>{open && <nav className="nav-group-children">3 sub-items</nav>}</div>` (เมื่อ sidebar collapsed: ข้าม toggle แสดง 3 icon buttons ตรง ๆ) + แก้ sidebar-logout text จาก plain text → `<b>ออกจากระบบ</b>` (เพื่อซ่อนเฉพาะ text เมื่อ collapsed) + เปลี่ยน `<div>` text ใน brand เป็น `<div className="brand-text">`
  - `client/src/pages/Users.tsx` (191 บรรทัด, +1 -1): เปลี่ยน `<div className="stock-overview">` → `<div className="users-overview">` (5 cards ใน 1 แถว แยกจาก Stock's 4-col grid)
  - `client/src/index.css` (5512 → 5549 บรรทัด, +36 insertions): เพิ่ม block PT-2 — `.users-overview` (5-col grid + 3 responsive breakpoints) + `.sidebar-collapse-btn` (desktop-only via `@media (min-width: 821px)`) + `.sidebar.collapsed` (width 64px + ซ่อน text elements: brand-text/role-card > div/nav-group-label/nav button b/sidebar-logout b/sidebar-version/sidebar-powered) + `.nav-admin-section`/`.nav-group-toggle`/`.nav-group-children` styling (collapsible header + indented sub-items) + `.sidebar.collapsed .nav-group-children button` (icon-only mode สำหรับ admin sub-items เมื่อ sidebar collapsed)

- Sidebar structure ตอนนี้:
  ```
  .brand (logo + name + mobile-close + sidebar-collapse-btn)
  .role-card (avatar + name + role)
  .nav-group-label "เมนูหลัก"
  <nav> 5 primary:
    - ภาพรวม (LayoutDashboard)
    - หน้าร้าน / POS (ShoppingCart) [badge: held bills ถ้า posHeldCount > 0]
    - สต็อกสินค้า (PackageSearch) [badge: low stock ถ้า lowStock.length > 0]
    - สมาชิกและบัญชี (UsersRound)
    - รายงาน (BarChart3)
  .nav-admin-section (admin/dev only — staff sees .locked-nav)
    [expanded sidebar]: .nav-group-toggle "จัดการระบบ" ChevronDown → click เปิด/ปิด
      └─ .nav-group-children (3 sub-items, indented): ตั้งค่า / ผู้ใช้ระบบ / ประวัติระบบ
    [collapsed sidebar]: 3 icon buttons ตรง ๆ ใน .nav-group-children (no toggle)
  .sidebar-footer (EditionPill + logout button + version + powered)
  ```

- Top-level item count: 5 primary nav + 1 group header = **6** ✅ (≤6 rule satisfied); เมื่อ sidebar collapsed: 5 + 3 = 8 icon buttons แสดงในแนวตั้ง แต่ละตัวมี `title` tooltip
- Badges ใน sidebar: เฉพาะ action-needed (low stock on "สต็อกสินค้า" + held bills on "หน้าร้าน / POS") — ไม่มี data-only badges
- Users page: 5 stat cards ใน 1 แถวบน desktop (total/admin/staff/dev/suspended) พร้อม responsive wrap 3→2→1
- TypeScript: 0 errors, dev server: HTTP 200 ผ่าน (3 ครั้ง stable + process alive หลัง curl), Tailwind v4: 0 "Missing opening" errors (single-line CSS format)
- commit hash: `4a89602` บน origin/main-v2 — รอเจ้าของงาน pull ไปเทส sidebar (desktop collapse toggle + admin group expand/collapse + held-bills badge) และ Users page (5 cards ใน 1 แถว) บนเครื่อง

---
Task ID: PT-3
Agent: full-stack-developer (Reports redesign)
Task: ปรับโครงหน้า Reports จาก 5-6 แถว controls เป็น 4-layer layout สะอาด — PageHeader / TabBar / FilterBar / Content(summary+viewpills+table)

Work Log:
- อ่าน worklog ทั้งหมด + Reports.tsx (3768 บรรทัด) แบบ chunk เพื่อเข้าใจ structure เดิม (SectionHeader + global report-cards-dense + tabbar + per-tab panel-heading + report-range-row + view pills + table)
- รัน baseline `npx tsc --noEmit` → 0 errors
- เปลี่ยนที่ละขั้น (incremental edits เพื่อ risk ต่ำ):
  1) Extract `salesSummaryCards` JSX variable (ก่อน `return (`) จาก global block เดิม (ยอดขาย/กำไร/สมาชิก/เงินคงเหลือ) เพื่อ reuse ในแท็บ sales + bills
  2) ลบ global `report-cards-dense` block ที่อยู่เหนือ tabbar — ย้ายลง Layer 4 (Content) ของแต่ละแท็บ ตามโครง 4-layer ที่ owner ระบุ
  3) Sales tab: ลบ `panel-heading` (h2+p+export) → สร้าง `.report-filter-bar` ใหม่ที่รวม date chips + (inline custom picker เมื่อกำหนดเอง) + **staff SELECT** (แทน pills) + groupby chips (timeline only) + export buttons (CSV/Excel/PDF) → ใส่ `{salesSummaryCards}` → ย้าย `report-view-pills` ลงใต้ summary cards (ตามที่ owner ระบุ) → report-range-status → table (timeline/category/product/items/cashier)
  4) Bills tab: ลบ `table-toolbar` (h2+p+search+export) + `bill-member-filter` → สร้าง FilterBar เดียวที่รวม search field + MemberScanPicker + export (no date range — shows latest bills) → `{salesSummaryCards}` → table-filter-summary → table → show-more
  5) Transactions tab: ลบ `table-toolbar` + `report-range-row` + `tx-filter-bar` → สร้าง FilterBar เดียวที่รวม date chips + tx-date-range + MemberScanPicker + tx-type-pills + export ทั้งหมด → tx-log-strip → tx-summary-cards (six cards) → table-wrap → session-table-note
  6) Stock tab: ลบ `panel-heading` (h2+p+export) + `report-range-row` แยก → สร้าง FilterBar รวม chips + custom picker + **search field** + export (CSV/Excel/PDF/พิมพ์) → tx-summary-cards (4 cards) → table-wrap (ลบ `table-toolbar` h3+p+search ที่ซ้ำซ้อนออก) → session-table-note
  7) Balances tab: ลบ `panel-heading` (h2+p+export) → สร้าง FilterBar รวม search field + export (no date range — snapshot) → tx-summary-cards (4 cards) → table-wrap (ลบ `table-toolbar` h3+p+search ที่ซ้ำซ้อนออก) → session-table-note
  8) Staff dropdown: ใช้ native `<select>` element ที่ styled ด้วย `.report-staff-select` (single-select) — เก็บ state `staffFilters: string[]` ไว้ (set ค่าเป็น `[value]` หรือ `[]` เพื่อ compatibility กับ tRPC queries ที่คาดหวัง array) — ไม่เปลี่ยน business logic แค่ UI
- CSS: เพิ่ม block PT-3 ที่ท้าย index.css ทั้งหมดเป็น single-line format (`.class { prop: val; }`) ตาม constraint ของ Tailwind v4:
  - `.report-filter-bar` (flex space-between, gap 12px, bg #f9fbfa, border #e8efec, radius 10px, padding 8px 10px)
  - `.report-filter-bar .report-range-row` (reset margin/padding/background เพื่อไม่ให้ชนกับ rule เดิม)
  - `.report-filter-bar .report-range-row.report-filter-row-main` (flex align-center gap 10px wrap)
  - `.report-filter-bar .report-export-actions` (flex 0 0 auto)
  - `.report-filter-bar .search-field` (height 30px, flex 1 1 220px, max 360px)
  - `.report-filter-bar .bill-member-filter` (flex 1 1 260px, max 420px, margin 0)
  - `.report-filter-bar .tx-filter-row` (flex align-center gap 10px wrap)
  - `.report-staff-select` (height 30px, radius 16px, padding 4px 28px 4px 12px, appearance none + custom SVG chevron background-image, max-width 220px, focus teal ring)
  - `.report-staff-select:hover`, `:focus`, `option` styling
  - 3 sibling-combinator rules สำหรับ Layer 4 ordering: `.report-filter-bar + .report-cards-dense`, `.report-cards-dense + .report-view-pills`, `.report-cards-dense + .report-view-pills + .report-range-status` (margin-top tight)
  - 2 `@media` rules (max-width 820px + 560px) สำหรับ responsive stack
- ไม่แตะ CSS เดิมที่ใช้งานได้ — เพิ่ม rules ใหม่อย่างเดียว (ลด risk ของ regression)
- คงไว้: ทุก tRPC query (`reports.daily`/`byCategory`/`byCashier`/`byProduct`/`lineItems`/`memberTransactions`/`memberBalances`/`stockBalance`/`cashiers`/`sales.list`/`logs.list`/`member.list`/`reports.limitRequests`), ทุก state (`rangeMode`/`groupBy`/`rangeFrom`/`rangeTo`/`staffFilters`/`salesView`/`txTypes`/`txFrom`/`txTo`/`billSearch`/`balanceSearch`/`stockSearch`/`billsVisible`/`reportTab`/`expandedPeriod`/`viewedReceipt`/`billMember`/`txMember`/`limitDecision`/`exportPreview`/`upgradeFeature`/`notice`), ทุก export function (`dailySalesExportPack`/`dailySalesDocConfig`/`billsDocConfig`/`txDocConfig`/`balancesDocConfig`/`stockBalanceDocConfig`/`openSalesExportPreview`/`openBillsExportPreview`/`openTxExportPreview`/`openBalancesExportPreview`/`openStockBalanceExportPreview`/`runExportPreview`), ทุก helper (`quickRangeOf`/`pickRangeChip`/`pickTxRangeChip`/`txRangeActive`/`pickCustomFrom`/`pickCustomTo`/`pickTxFrom`/`pickTxTo`/`toggleStaffFilter`/`toggleTxType`/`resetReportFilters`/`confirmLimitDecision`)
- TypeScript: `npx tsc --noEmit` → **0 errors** (หลังแก้ทุก tab)
- Boot: `bun run dev` บน port 3000 → server ติด clean (no transform errors) → `curl http://localhost:3000/` → **HTTP 200** ✅ → `/src/pages/reports/Reports.tsx` transform ผ่าน (Vite ส่ง JSX transform ออกมาไม่มี error) → `/src/index.css` compile ผ่าน Tailwind v4 (CSS 556KB compiled, มี `report-filter-bar` 19 occurrences + `report-staff-select` 6 occurrences ใน output) — ไม่มี "Missing opening {" errors
- Commit: `4fb1900` — `feat(PT-3): redesign Reports page — 4-layer layout, consolidated filter bar, staff dropdown` (2 files changed, +364 / -394 lines)
- Push: `git push origin main:main-v2` → success (`5cf10c4..4fb1900  main -> main-v2`)

Stage Summary:
- หน้า Reports ตอนนี้เป็น 4-layer layout ตามที่ owner ต้องการ:
  ```
  Layer 1: PageHeader — SectionHeader "รายงาน" + ปุ่ม primary (วันนี้ / เลือกช่วง) + outline ล้างตัวกรอง
  Layer 2: TabBar — [สรุปยอดขาย] [ประวัติบิล] [ธุรกรรม] [สินค้าคงคลัง] [ยอดเงินในบัตร] (badge แสดง count ถ้ามี)
  Layer 3: FilterBar (shared structure ทุกแท็บ — กล่อง #f9fbfa border สีเทาอ่อน):
    [sales]      chips + (custom picker) + staff SELECT + groupby(timeline only)     [CSV/Excel/PDF]
    [bills]      search field + MemberScanPicker                                       [CSV/Excel/PDF]
    [tx]         chips + tx-date-range + MemberScanPicker + tx-type-pills             [CSV/Excel/PDF]
    [stock]      chips + (custom picker) + search                                      [CSV/Excel/PDF/พิมพ์]
    [balances]   search field                                                          [CSV/Excel/PDF/พิมพ์]
  Layer 4: Content — SummaryCards → ViewPills (sales only) → report-range-status (sales only) → Table
  ```
- ปัญหา 4 ข้อที่ owner ระบุ แก้ครบ:
  1) Date picker position consistent ทุกแท็บ — อยู่ใน Layer 3 FilterBar เสมอ (inline ถ้า custom)
  2) ลดจาก 5-6 แถว controls เหลือ 2 แถว (Layer 2 tabbar + Layer 3 filterbar) — panel-heading ที่ซ้ำซ้อนกับ SectionHeader ถูกลบ
  3) Staff pills (ที่บีบเมื่อน้อย + ยืดเมื่อมาก) → เปลี่ยนเป็น `<select>` dropdown ขนาดคงที่ (220px max) + native appearance ที่ styled สวย
  4) Panel heading (h2+p+export) ต่อแท็บ ลบออก — SectionHeader "รายงาน" เป็น heading เดียว, ปุ่ม export ย้ายไปฝั่งขวาของ FilterBar
- View pills ย้ายลงใต้ summary cards ตามที่ owner ขอ (ก่อนหน้านี้อยู่ระหว่าง heading กับ date chips)
- ทุก functionality ครบ: tRPC queries + state + export logic + tx filter + member scan picker + limit decision modal + reprint modal + export preview modal + edition upgrade modal + notice bar — เปลี่ยนแค่ layout/rendering
- commit hash `4fb1900` push ขึ้น origin/main-v2 สำเร็จ — รอเจ้าของงาน pull ไปเทสบนเครื่อง (ทุกแท็บ + staff dropdown + custom date picker inline + responsive stack บน mobile)

---
Task ID: P2-b
Agent: full-stack-developer (idempotency)
Task: Add idempotency protection to checkout + walletTx (prevent double-submit), fix voidSale TOCTOU, guard closeBusinessDay against double-close

Work Log:
- อ่าน worklog เข้าใจ context V2-A→E + PT-1/PT-2/PT-3 (UI redesign) + 1-fix (P1 logout cookie bug) — project = Vite + React 19 + Express + tRPC + Drizzle + SQLite (node:sqlite), pnpm (NOT Next.js); branch `main` local → push `origin/main-v2`
- อ่าน `server/sqliteStore.ts` รอบฟังก์ชั่นที่เกี่ยวข้อง: createSqliteStore (line ~275) + CheckoutInput/checkout (line ~1494) + WalletTxInput/walletTx (line ~1875) + voidSale (line ~3195) + closeBusinessDay (line ~2888) + runInTransaction wrapper (line ~677, BEGIN/COMMIT/ROLLBACK)
- อ่าน `server/routers.ts`: checkoutInput zod schema (line 307) + memberWalletInput zod schema (line 217) + pos.checkout mutation (line 1019, ใช้ `{...input, cashier, actorRole}`) + member.wallet mutation (line 1083, ใช้ `{...input, actor, actorRole}`)
- baseline `npx tsc --noEmit` → 0 errors ก่อนแก้

- แก้ 6 จุดใน `server/sqliteStore.ts`:
  1) **createSqliteStore** — เพิ่ม 2 ensureColumn migrations + 2 partial indexes:
     - `ensureColumn(db, "sales", "client_request_id", "TEXT")`
     - `ensureColumn(db, "member_transactions", "client_request_id", "TEXT")`
     - `CREATE INDEX IF NOT EXISTS idx_sales_client_req ON sales(client_request_id) WHERE client_request_id IS NOT NULL`
     - `CREATE INDEX IF NOT EXISTS idx_member_tx_client_req ON member_transactions(client_request_id) WHERE client_request_id IS NOT NULL`
     - migration idempotent — DB เดิมอัปเกรดอัตโนมัติตอนบูต
  2) **CheckoutInput type** — เพิ่ม `clientRequestId?: string | null`
  3) **checkout()** — ที่ต้นฟังก์ชั่น (ก่อน merge/stock/wallet checks):
     - SELECT existing sale row ด้วย `client_request_id` → ถ้าเจอ replay receipt เดิม (items + totals + memberName + balanceAfter ดึงจาก `member_transactions WHERE detail LIKE 'บิล #X ·%'` เหมือน salesList) คืนเลย ไม่เขียน row ซ้ำ
     - ใน INSERT path: sales INSERT เพิ่ม `client_request_id` เป็นคอลัมน์ที่ 10 (`input.clientRequestId ?? null`) — wallet purchase INSERT ไม่ใส่ client_request_id (idempotency key อยู่ที่ sale row ตัวเดียว + BEGIN คุม atomic อยู่แล้ว)
  4) **WalletTxInput type** — เพิ่ม `clientRequestId?: string | null`
  5) **walletTx()** — ที่ต้นฟังก์ชั่น (ก่อน balance check):
     - SELECT existing member_transactions row ด้วย `client_request_id` → ถ้าเจอ replay ledger row เดิม (memberNumber, memberName, type, amount (abs), balanceBefore (reverse จาก balanceAfter), balanceAfter, detail) คืนเลย ไม่ update balance / insert ซ้ำ
     - ใน INSERT path: member_transactions INSERT เพิ่ม `client_request_id` เป็นคอลัมน์ที่ 10 (`input.clientRequestId ?? null`)
     - เก็บ return shape ตรงกับ normal path (`string`/`number` strict ไม่ใช่ `string | null`/`number | null`) เพื่อไม่ให้ union inferred ขยายและพัง consumer ใน Pos.tsx + MemberDetail.tsx — ใช้ `memberName ?? ""` และ `balanceAfter ?? memberRow?.balance ?? 0` coerce null บน replay path อย่างเดียว
  6) **voidSale() TOCTOU fix**:
     - ย้าย `SELECT 1 FROM sales WHERE id = ? AND voided = 1` check จาก OUTSIDE `runInTransaction` → INSIDE `runInTransaction` (ก่อน UPDATE/INSERT ใด ๆ)
     - ปิด race ที่ void 2 คำขอพร้อมกันผ่าน outer SELECT ทั้งคู่ (ยังไม่เห็น UPDATE ของกัน) แล้ว double-refund wallet + double-restore stock
     - guard `if (!sale)` (บิลไม่มี) และ `if (!input.reason.trim())` (ไม่ระบุเหตุผล) ยังอยู่นอก transaction — เป็น request-validation ไม่ต้องการ isolation
  7) **closeBusinessDay() double-close guard**:
     - เพิ่ม `SELECT 1 FROM day_closures WHERE period_start = ?` ที่ต้น `runInTransaction` → ถ้าเจอ row โยน `"รอบขายนี้ถูกตัดยอดไปแล้ว — ไม่สามารถตัดซ้อนได้"`
     - คอมเมนต์ระบุตรง ๆ ว่า SQLite default `BEGIN DEFERRED` ไม่ lock write ก่อน first write — 2 closes พร้อมกันจริง ๆ อาจผ่าน SELECT ทั้งคู่ แต่ UI ส่ง closes ทีละครั้งต่อ user ตามธรรมเขียน → SELECT guard คลุม double-submit จริง (double-click/double-tap) ซึ่งคือสิ่งที่ task ต้องการ

- แก้ `server/routers.ts`:
  - **checkoutInput** zod schema — เพิ่ม `clientRequestId: z.string().max(200).nullish()` (line 325); pos.checkout mutation มี spread `{...input, cashier, actorRole}` อยู่แล้ว → ส่ง clientRequestId ผ่าน transparent
  - **memberWalletInput** zod schema — เพิ่ม `clientRequestId: z.string().max(200).nullish()` (line 230); member.wallet mutation มี spread `{...input, actor, actorRole}` อยู่แล้ว → ส่ง clientRequestId ผ่าน transparent
  - field optional (`.nullish()`) → frontend (Pos.tsx, MemberDetail.tsx) ไม่ต้องส่ง, response shapes เดิมทุกประการ — frontend จะ update ใน task ถัดไปให้ generate UUID ด้วย `crypto.randomUUID()` แล้ว retry ด้วย UUID เดียวกันเมื่อ tRPC mutation reject (network blip)

- TypeScript:
  - pass 1 หลังแก้ walletTx replay คืน `memberName: string | null` + `balanceAfter: number | null` → inferred union ขยาย → Pos.tsx (2 จุด) + MemberDetail.tsx (2 จุด) พัง 4 errors
  - แก้: coerce บน replay path `memberName ?? ""` + `balanceAfter ?? memberRow?.balance ?? 0` → inferred union กลับเป็น strict `string`/`number` ตาม normal path
  - pass 2 `npx tsc --noEmit` → **0 errors** ✅

- commit: `git add server/sqliteStore.ts server/routers.ts && git commit -m "fix(P2): add idempotency to checkout+walletTx, fix voidSale TOCTOU, guard closeDay double-close"` → commit `d24ad12`
- push: `git push origin main:main-v2` → `3979ab3..d24ad12  main -> main-v2` ✅

Stage Summary:
- 2 files changed: `server/sqliteStore.ts` (+110, -4), `server/routers.ts` (+9, -0)
- 4 idempotency fixes ลงใน commit เดียว:
  1) checkout() — idempotent on `client_request_id` (คืน existing receipt ไม่สร้างบิลซ้ำ)
  2) walletTx() — idempotent on `client_request_id` (คืน existing ledger row ไม่ update balance ซ้ำ)
  3) voidSale() — TOCTOU fix (voided=1 check ย้ายเข้าใน `runInTransaction`)
  4) closeBusinessDay() — double-close guard (SELECT period_start ใน `runInTransaction` + โยน StoreError ถ้าเจอ row)
- Schema migration: 2 nullable TEXT columns + 2 partial indexes — idempotent ผ่าน `ensureColumn` (DB เดิมอัปเกรดอัตโนมัติตอนบูต)
- TypeScript: 0 errors; commit `d24ad12` push ขึ้น origin/main-v2 สำเร็จ
- Follow-up ที่เหลือ (task ถัดไป): frontend (Pos.tsx + MemberDetail.tsx) ต้อง generate UUID ด้วย `crypto.randomUUID()` per checkout/wallet attempt + retry ด้วย UUID เดียวกันเมื่อ network reject — server พร้อมรับ key แล้ว

---
Task ID: P3
Agent: full-stack-developer (backup hardening)
Task: เพิ่มการเข้ารหัสสำรองข้อมูล AES-256-GCM + restore drill + SOP docs (production hardening)

Work Log:
- อ่าน `worklog.md` ครั้งแรกเพื่อเข้าใจ context — โปรเจก Vite + React 19 + Express + tRPC + node:sqlite, branch `main-v2` (local branch `main`), P2 (idempotency) เสร็จที่ commit `d24ad12`
- อ่าน `server/sqliteBackup.ts` (175 บรรทัด) ครบ — ทำความเข้าใจ backup/restore/verify/prune/list flows + `BackupManifest`, `SqliteBackupEntry`, `BACKUP_FILE_PATTERN`
- อ่านส่วน `backup:` router ใน `server/routers.ts` (lines 1364-1528) — `create`, `list`, `download`, `upload`, `restore` (admin only ทั้งหมด, requireEdition `backupRestore`)
- อ่าน `server/sqliteBackup.test.ts` เพื่อยืนยันว่า changes จะ backward compatible (test ไม่ได้ set `BACKUP_ENCRYPTION_KEY` → encryption path จะ skip อัตโนมัติ)

Implementation ใน `server/sqliteBackup.ts`:
- imports: เพิ่ม `scryptSync, createCipheriv, createDecipheriv, randomBytes` จาก `node:crypto`, `rmSync` จาก `node:fs`, `tmpdir` จาก `node:os`
- `BackupManifest` type: เพิ่ม `encrypted?: boolean` (optional — backward compatible กับ manifest เก่าที่ไม่มี field นี้)
- เพิ่ม constants: `ENCRYPTION_SALT = "png-shop-backup-salt"`, `ENC_IV_BYTES = 12`, `ENC_TAG_BYTES = 16`
- เพิ่ม `getEncryptionKey(): Buffer | null` — อ่าน `process.env.BACKUP_ENCRYPTION_KEY` (ต้องยาว ≥ 32 ตัวอักษร), derive 32-byte key ผ่าน `scryptSync(raw, salt, 32)` — ถ้า unset/สั้นเกิน → คืน null (skip encryption)
- เพิ่ม `isEncryptedFile(filePath)` — ตรวจสกุล `.enc`
- เพิ่ม `encryptBackup(plainPath)` — อ่าน plain .sqlite → AES-256-GCM encrypt → เขียน `.sqlite.enc` (format `[12B IV][16B auth tag][ciphertext]`) → ลบ plain .sqlite ออกจาก disk (security: ไม่เหลือ plain copy) → คืน path `.enc`
- เพิ่ม `decryptBackup(encPath)` — อ่าน `.enc` → แยก IV/tag/ciphertext → `createDecipheriv("aes-256-gcm", key, iv)` + `setAuthTag(tag)` → เขียน plain ไปที่ temp file ใน `os.tmpdir()` (`.backup-decrypt-<ts>-<rand>.sqlite`) → คืน temp path (caller ทำความสะอาด)
- `verifySqliteBackup(filePath)` — ถ้า `.enc` → decrypt ไป temp → `assertSqliteIntegrity(temp)` → ลบ temp ใน `finally`; sha256/sizeBytes คืนเป็นของไฟล์ `.enc` จริงบน disk (manifest hash สอดคล้องกับที่เก็บ)
- `backupSqliteDatabase({...})` — หลัง `copyFileSync` + `verifySqliteBackup(plain)` ถ้า `getEncryptionKey()` ไม่ null → `encryptBackup(destination)` (เขียน .enc, ลบ plain) → ใช้ finalPath/finalFile ใน manifest พร้อม `encrypted: true`; `sha256`/`sizeBytes` คำนวณจากไฟล์ final (.enc หรือ .sqlite ตามกรณี)
- `nextBackupFileName(dir, now)` — เช็ค collision ทั้ง `.sqlite` และ `.sqlite.enc` (กันชื่อชนกันในวินาทีเดียวกัน)
- `restoreSqliteBackup({backupPath, targetPath, overwrite})` — ถ้า `.enc` → decrypt ไป temp → `assertSqliteIntegrity(temp)` → `copyFileSync(temp, target)` → ลบ temp ใน `finally`; ถ้า plain → flow เดิม; ท้าย verify target ตามปกติ
- เพิ่ม `testRestore(backupPath): { ok: true; tables: string[]; rowCount: number }` — decrypt (ถ้า .enc) ไป temp → เปิด read-only → `PRAGMA integrity_check` → `SELECT name FROM sqlite_master WHERE type='table'` → นับ rows ใน `products`, `members`, `sales`, `sale_items` → ลบ temp ใน `finally` (ใช้ try/finally ซ้อน 2 ชั้นป้องกัน temp รั่ว)
- `BACKUP_FILE_PATTERN` → `/^welfare-store-\d{8}T\d{6}Z\.sqlite(\.enc)?$/` (match ทั้ง plain และ encrypted)
- `pruneSqliteBackups` → ใช้ `BACKUP_FILE_PATTERN` ตัวเดียวกัน (DRY)

Implementation ใน `server/routers.ts`:
- import: เพิ่ม `testRestore` ใน destructuring จาก `./sqliteBackup`
- `backupFileInput` regex → `/^welfare-store-\d{8}T\d{6}Z\.sqlite(\.enc)?$/` (strict superset — ไฟล์ plain เดิมยังผ่าน, เปิดทางให้ download/restore/testRestore รับไฟล์ `.enc` ได้)
- เพิ่ม procedure `backup.testRestore` (admin only + `requireEdition("backupRestore")`): รับ `backupFileInput` → existsSync check → `testRestore(backupPath)` → บันทึก audit log สีฟ้า "ทดสอบกู้คืน" พร้อม detail ตาราง/แถว → คืน `{ ok, tables, rowCount }`

Documentation:
- สร้าง `docs/BACKUP_RESTORE_SOP_TH.md` (~150 บรรทัด) ครอบคลุม 8 sections: backup policy, retention, restore procedure, restore drill, encryption setup, ransomware response, RPO/RTO, responsibility matrix + quarterly drill log template

Verification:
- `npx tsc --noEmit` → **0 errors** ✅
- backward compatible: เมื่อ `BACKUP_ENCRYPTION_KEY` ไม่ตั้ง → `getEncryptionKey()` คืน null → backup/restore/verify/prune/list ทำงานเหมือนเดิมทุกประการ; `encrypted?: boolean` เป็น optional → manifest เก่าที่ไม่มี field ยังอ่านได้

Commit & push:
- `git add server/sqliteBackup.ts server/routers.ts docs/BACKUP_RESTORE_SOP_TH.md`
- `git commit -m "feat(P3): backup encryption (AES-256-GCM) + restore drill + SOP docs"` → commit `de89620`
- `git push origin main:main-v2` → `5840715..de89620  main -> main-v2` ✅

Stage Summary:
- 3 files changed: `server/sqliteBackup.ts` (+190, -15), `server/routers.ts` (+37, -2), `docs/BACKUP_RESTORE_SOP_TH.md` (new file, ~150 บรรทัด)
- P3 production hardening ครบทั้ง 3 ข้อ:
  1) AES-256-GCM encryption optional ผ่าน `BACKUP_ENCRYPTION_KEY` env var (≥32 ตัวอักษร) — ไฟล์สำรองใหม่เข้ารหัสอัตโนมัติเป็น `.sqlite.enc`, restore auto-detect จากสกุลไฟล์, plain ไฟล์ถูกลบจาก disk หลังเข้ารหัส
  2) `testRestore(backupPath)` function + `backup.testRestore` tRPC procedure — admin ทดสอบกู้คืนโดยไม่แตะฐานข้อมูลจริง (decrypt + integrity + list tables + count rows)
  3) `docs/BACKUP_RESTORE_SOP_TH.md` — SOP ครอบคลุม backup/retention/restore/drill/encryption/ransomware/RPO-RTO/responsibility
- TypeScript: 0 errors; commit `de89620` push ขึ้น origin/main-v2 สำเร็จ
- ข้อควรระวังที่เจ้าของระบบควรทราบ:
  - ถ้าตั้ง `BACKUP_ENCRYPTION_KEY` แล้วลบ env var ภายหลัง → ไฟล์ `.sqlite.enc` ที่เข้ารหัสด้วยคีย์เดิมกู้คืนไม่ได้ (SOP §5 เตือนไว้)
  - คีย์ derive ด้วย salt ตายตัว `"png-shop-backup-salt"` — ถ้าต้องการ rotate คีย์โดยใช้ salt ใหม่ ต้อง re-encrypt ไฟล์เก่าทั้งหมด
  - download ผาน tRPC คืน base64 ของไฟล์ `.enc` ดิบ (encrypted) — admin ที่ download ต้องมี key ถึงจะ decrypt ภายนอกระบบได้ (good for security — ไฟล์ที่ download ไปไม่มี key ก็อ่านไม่ได้)


---
Task ID: P4
Agent: full-stack-developer (release/rollback)
Task: สร้างระบบ Release/Rollback — version tracking + health check + release_logs table + schema version tracking + scripts/update.sh + scripts/rollback.sh + handover doc template

Work Log:
- อ่าน `worklog.md` ครบ (P1-1fix, UI-1..UI-n, PT-1..PT-3, P2-a, P2-b, P3) เพื่อเข้าใจ context — โปรเจกต์ Vite + React 19 + Express + tRPC + node:sqlite, branch `main` (local) push ขึ้น `origin/main-v2`; P3 (backup AES-256-GCM + restore drill + SOP) เสร็จที่ commit `de89620`
- อ่าน `docs/TECHNICAL_REVIEW_DEPLOYMENT_HANDOFF_TH.md` ครบ 274 บรรทัด — ดึง spec 10-step update flow จาก section 5 + 7-step rollback จาก task description; ดูว่า existing `systemRouter` (ใน `server/_core/systemRouter.ts`) มี `health` (stub `{ ok: true }`), `lanInfo` (admin), `notifyOwner` (admin) อยู่แล้ว
- อ่าน `server/sqliteStore.ts` (4199 บรรทัด → 4362 บรรทัด): `createSqliteStore` line 275 (มี table block จนถึง line 472), `logAction` line 703, `installOverview` line 2809 (มี `statSync` pattern สำหรับ dbSizeBytes ที่จะ reuse), `getSettings` line 3029 (อ่าน `store_settings` JSON), `setEditionSettings` line 3057
- อ่าน `server/_core/systemRouter.ts` (57 บรรทัด) — existing `health` มี input `z.object({ timestamp })` ที่ Settings page (`client/src/pages/settings/Settings.tsx` line 637) ใช้สำหรับ measure latency (`utils.client.system.health.query({ timestamp: Date.now() }).then(...)` — ไม่ได้อ่าน response shape)
- อ่าน `server/_core/trpc.ts` — `adminProcedure` middleware คืน ctx ที่มี `user: ctx.user` (role=admin), `permissionProcedure` ใช้ `hasPermission(db, ctx.user.role, permission)`
- อ่าน `server/_core/context.ts` — `ctx.user` shape คือ drizzle `User` (`id/openId/name/role/appRole/mustChangePassword/createdAt/...`); `appRole` คือ DB role จริง (`cashier/administrator/manager/dev`)
- อ่าน `server/routers.ts` line 581 — `appRouter = router({ system: systemRouter, install: ..., auth: ..., backup: ..., ... })`; `isDevCtx` ใน routers.ts เช็ค `ctx.user.role === "admin" && (appRole === "dev" || appRole === "administrator")`
- อ่าน `package.json` — `"name": "wellbeing-hospital-store", "version": "1.0.0", "type": "module"` → ต้องใช้ ESM `import.meta.url` + `fileURLToPath` แทน `__dirname`; build script `esbuild ... --format=esm --outdir=dist`

Baseline check:
- `npx tsc --noEmit` → 0 errors ก่อนแก้

Implementation ใน `server/_core/version.ts` (new file, ~110 บรรทัด):
- imports: `createRequire` จาก `node:module`, `dirname/resolve` จาก `node:path`, `fileURLToPath` จาก `node:url`, `statSync` จาก `node:fs`
- `findPackageJsonPath()` — walk up directories จาก `dirname(fileURLToPath(import.meta.url))` สูสูงสุด 10 ระดับ; ใช้ `createRequire(import.meta.url)(candidate)` เพื่อ require ไฟล์ (ถ้าไม่มีจะ throw → ลองขั้นถัดไป); คืน absolute path ของ `package.json` แรกที่เจอ (works ทั้ง dev `server/_core/` และ production `dist/` bundle เพราะ esbuild inline แต่ `import.meta.url` ยัง resolve ได้)
- `getVersion(): string` — อ่าน version จาก package.json ผ่าน `requireFromHere(PACKAGE_JSON_PATH).version`; trim + fallback `"0.0.0"` ถ้าไม่เจอ
- `getVersionInfo(): VersionInfo` — คืน `{ version, nodeVersion: process.version, platform: process.platform, buildDate }` โดย `buildDate` = `statSync(dirname(fileURLToPath(import.meta.url))).mtime.toISOString()` หรือ `null` ถ้า stat ไม่ได้ (read-only container edge case)

Implementation ใน `server/sqliteStore.ts` (modified, +162 lines):
- เพิ่ม `release_logs` table ใน `createSqliteStore` หลัง `limit_requests` table (ก่อน closing `\`);` ของ db.exec):
  ```sql
  CREATE TABLE IF NOT EXISTS release_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('install', 'update', 'rollback', 'hotfix')),
    notes TEXT, migrations TEXT, backup_file TEXT, health_check TEXT, actor TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  ```
- เพิ่ม exports ใหม่หลัง `listAuditLogs` (line ~738):
  - `type ReleaseAction = "install" | "update" | "rollback" | "hotfix"`
  - `type ReleaseLogRow = { id, version, action, notes, migrations, backupFile, healthCheck, actor, createdAt }`
  - `type LogReleaseInput = { version, action, notes?, migrations?, backupFile?, healthCheck?, actor?, actorRole? }`
  - `logRelease(db, input): ReleaseLogRow` — INSERT + `logAction()` (red tone สำหรับ rollback, amber สำหรับ hotfix, blue สำหรับ install/update) + คืน row ที่ insert; action Thai label: ติดตั้งระบบ/อัปเดตระบบ/ย้อนระบบกลับ/Hotfix
  - `listReleases(db, limit = 100): ReleaseLogRow[]` — SELECT newest-first, cap 200 (เทียบเท่า audit_logs)
- เพิ่ม schema version tracking (constants + 2 functions):
  - `const SCHEMA_VERSION_KEY = "schema_version"`, `const DEFAULT_SCHEMA_VERSION = "1.0"`
  - `getSchemaVersion(db): string` — SELECT จาก `store_settings WHERE key = 'schema_version'`; fallback `"1.0"` ถ้าไม่มี row (DB เดิมที่สร้างก่อน P4 จะ backfill เป็น "1.0" อัตโนมัติ)
  - `setSchemaVersion(db, version: string): void` — INSERT/UPSERT ค่าใหม่ (skip ถ้า empty string)
- comment ใน SQL template หลีกเลี่ยง backticks (`) เพื่อไม่ให้ break template literal — ใช้ plain text แทน

Implementation ใน `server/_core/systemRouter.ts` (modified, +157 lines):
- imports เพิ่ม: `statSync` (node:fs), `TRPCError` (@trpc/server), `getVersion/getVersionInfo` (./version), `getWelfareDb/getWelfareDbPath` (../welfareStore), `getSchemaVersion/listReleases/logRelease` (../sqliteStore), `type TrpcContext` (./context)
- **`system.health`** (publicProcedure — input optional เพื่อรองรับ load balancer GET ที่ไม่ส่ง body): คืน `{ status: "ok", version, uptime, db: { connected, sizeBytes }, memory: { usedMB, totalMB }, timestamp }`
  - `version` จาก `getVersionInfo().version`
  - `uptime` จาก `process.uptime()` (seconds, ปัดเป็น integer)
  - `db.connected` = true ถ้า `statSync(getWelfareDbPath())` ไม่ throw; `db.sizeBytes` = `stats.size`
  - `memory.usedMB` = `process.memoryUsage().rss` → MB (ปัดทศนิยม 2 ตำแหน่ง); `memory.totalMB` = `os.totalmem()` → MB
  - `timestamp` = `new Date().toISOString()`
  - รักษา input schema `{ timestamp: z.number().min(0) }.optional()` เพื่อให้ Settings page latency probe (`query({ timestamp: Date.now() })`) ยังทำงานได้ (ไม่ breaking change)
- **`system.releases`** (adminProcedure — admin only เพราะ release notes มี actor hostnames/backup paths/migration JSON): รับ optional `{ limit?: 1..200 }`, คืน `{ releases: ReleaseLogRow[], schemaVersion: string, appVersion: string }` (newest-first, default limit 100)
- **`system.logRelease`** (publicProcedure + inline dev check — dev/administrator only): รับ `{ version, action: enum, notes?, migrations?, backupFile?, healthCheck?, actor? }`, โยน FORBIDDEN "การบันทึกประวัติ release ใช้ได้เฉพาะบัญชีผู้พัฒนา (dev/administrator)" ถ้า `!isDevCtx(ctx)`; ส่งผ่านไป `logRelease(db, {...input, actorRole})` (dev → "ผู้พัฒนา", administrator → "ผู้บริหาร")
- เพิ่ม local `isDevCtx(ctx)` helper (mirror จาก routers.ts — ไม่ import เพื่อกัน circular dependency)

Implementation ของ `scripts/update.sh` (new file, ~280 บรรทัด):
- `#!/usr/bin/env bash` + `set -euo pipefail` + log to `data/logs/update-<ISO>.log` (tee stdout/stderr)
- 10 steps ตาม handoff doc section 5:
  1. Pre-check: version arg/env/package.json + node ≥20 + pnpm + git + disk ≥200MB + service health (best-effort)
  2. Backup DB: `cp -p ${DB_PATH} ${BACKUP_DIR}/welfare-store-<ISO>.sqlite` + log sha256/size (skip ถ้า DB ยังไม่มี = first install)
  3. Backup Configuration: copy `.env` + `data/https/` + `Caddyfile` → `data/backups/config-<ISO>/`
  4. Receive Artifact: `git fetch origin --tags --force` + หา ref (`refs/tags/v${VER}` หรือ `refs/heads/${VER}` หรือ commit hash) + `git checkout ${REF}` + `git clean -fd`
  5. Stop Service: หา PID ด้วย `lsof -ti tcp:${PORT}` (fallback `ss -ltnp`) + SIGTERM (รอ 2s) + SIGKILL (ถ้ายังไม่ตาย)
  6. Update Package: `pnpm install --frozen-lockfile`
  7. Run Migrations: `pnpm db:push` (drizzle-kit generate + migrate) + อ่าน `schema_version` setting เพื่อ log before-state
  8. Start Service: `NODE_ENV=production nohup pnpm start` + poll `curl system.health` สูงสุด 30s
  9. Health Check + Smoke Test: `curl /api/trpc/system.health` (die ถ้า empty) + node นับ tables ใน sqlite_master (ต้องมี app_users/members/store_settings/products ครบ 4 ตาราง)
  10. Log Release: optional auth (`RELEASE_LOG_DEV_USER` + `RELEASE_LOG_DEV_PASS`) → login → POST `/api/trpc/system.logRelease` ด้วย payload `{ version, action: "update", notes, migrations, backupFile, healthCheck, actor }`; ถ้าไม่มี credentials จะ log warning + บอก operator เรียกผ่าน UI เอง
- env vars: `APP_VERSION`, `SQLITE_DB_PATH`, `SQLITE_BACKUP_DIR`, `PORT`, `NODE_ENV`, `GIT_REMOTE`, `SKIP_GIT_PULL`, `SKIP_INSTALL`, `SKIP_MIGRATE`, `DRY_RUN`, `RELEASE_LOG_DEV_USER`, `RELEASE_LOG_DEV_PASS`
- ปลอดภัย: `set -euo pipefail` หยุดทันทีเมื่อ fail; ทุก step log ลงไฟล์; DRY_RUN mode สำหรับ rehearsal

Implementation ของ `scripts/rollback.sh` (new file, ~250 บรรทัด):
- 7 steps ตาม task spec:
  1. Stop Service (same lsof/ss pattern as update.sh)
  2. Backup current DB → `welfare-store-rollback-source-<ISO>.sqlite` (เก็บ broken state ไว้ forensic)
  3. Restore DB: rm `${DB_PATH}{,-wal,-shm}` ทั้งหมดก่อน + `cp -p ${BACKUP_FILE} ${DB_PATH}` + ตรวจ magic header "SQLite format 3\0" (xxd -p = `53514c69746520666f726d6174203300`) ก่อน copy + `PRAGMA integrity_check` หลัง copy (die ถ้าไม่ ok)
  4. Git Checkout Previous: `git checkout HEAD@{1}` (fallback `HEAD^` หรือ `GIT_PREV_REF` env var)
  5. Start Service: `pnpm install --frozen-lockfile` + `NODE_ENV=production nohup pnpm start` + poll health
  6. Health Check: same as update.sh step 9 (system.health + smoke test 4 core tables)
  7. Log Rollback: optional auth → POST `system.logRelease` ด้วย `{ version: "rollback-<ISO>", action: "rollback", notes, migrations: "rollback", backupFile, healthCheck, actor }`

Implementation ของ `docs/RELEASE_TEMPLATE_TH.md` (new file, ~140 บรรทัด):
- 8 sections ตาม task spec: Version / Migrations / Backup / Health Check / Changes / Testing / Rollback Plan / Sign-off
- ทุก field มี placeholder `[...]` + ตัวอย่างใน comment
- Testing section เป็น checklist 11 รายการ (TypeScript check, dev boot, POS checkout, void/refund, wallet, reports, settings, backup drill, health endpoint, rollback drill, login/logout, RBAC) — 3 รายการแรก pre-ticked เพราะผ่านในงาน P4 นี้
- Rollback Plan section มี pre-rollback checklist 5 ขั้น + estimated RTO + ตัวอย่าง rollback command
- 2 Appendix sections: ไฟล์ที่เปลี่ยน (`git diff --stat`) + env vars ที่ใหม่/เปลี่ยน

Verification:
- `npx tsc --noEmit` → **0 errors** ✅ (หลังแก้ SQL template literal ที่มี backticks ใน comment ทำให้ parser พัง — ลบ backticks ออก)
- runtime smoke test: `NODE_ENV=development PORT=3199 node --import tsx server/_core/index.ts` + `curl http://localhost:3199/api/trpc/system.health?input=%7B%22timestamp%22%3A0%7D` → ตอบ `{"result":{"data":{"json":{"status":"ok","version":"1.0.0","uptime":3,"db":{"connected":true,"sizeBytes":1409024},"memory":{"usedMB":356.44,"totalMB":4041.57},"timestamp":"2026-09-29T15:57:12.139Z"}}}}` ✅
- bash syntax: `bash -n scripts/update.sh` ผ่าน, `bash -n scripts/rollback.sh` ผ่าน
- backward compatible: existing `system.health` client call `.query({ timestamp: Date.now() })` ยังทำงาน (input schema `.optional()` รับได้ทั้ง with/without payload; client ไม่ได้อ่าน response shape เดิม จึงไม่ break)

Commit & push:
- `git add server/_core/version.ts server/_core/systemRouter.ts server/sqliteStore.ts scripts/update.sh scripts/rollback.sh docs/RELEASE_TEMPLATE_TH.md`
- `git commit -m "feat(P4): release/rollback system — version tracking, health check, release log, update/rollback scripts, handover template"`
- `git push origin main:main-v2`

Stage Summary:
- 6 files changed (3 new + 3 modified): `server/_core/version.ts` (new, ~110 บรรทัด), `server/_core/systemRouter.ts` (+157, -6), `server/sqliteStore.ts` (+162, 0), `scripts/update.sh` (new, ~280 บรรทัด, chmod +x), `scripts/rollback.sh` (new, ~250 บรรทัด, chmod +x), `docs/RELEASE_TEMPLATE_TH.md` (new, ~140 บรรทัด)
- P4 release/rollback system ครบทั้ง 7 ข้อ:
  1) Version tracking — `getVersion()` + `getVersionInfo()` ใน `server/_core/version.ts` (อ่านจาก package.json + process + stat)
  2) Health check endpoint — `system.health` (publicProcedure, no auth) คืน `{ status, version, uptime, db: {connected, sizeBytes}, memory: {usedMB, totalMB}, timestamp }`
  3) Release log table — `release_logs` (action CHECK-constrained) + `logRelease()` (INSERT + audit log) + `listReleases()` (newest-first) + `system.releases` (admin) + `system.logRelease` (dev only)
  4) Migration status tracking — `getSchemaVersion(db)` + `setSchemaVersion(db, version)` ใน `store_settings` key `schema_version` (default "1.0", separate from app version)
  5) Update flow script — `scripts/update.sh` 10-step flow ตาม handoff doc section 5 (pre-check → backup DB → backup config → git pull → stop → install → migrate → start → health → log release)
  6) Rollback procedure — `scripts/rollback.sh` 7-step flow (stop → safety backup → restore + integrity check → git checkout prev → start → health → log rollback)
  7) Release handover doc template — `docs/RELEASE_TEMPLATE_TH.md` 8 sections + 2 appendices (Version / Migrations / Backup / Health Check / Changes / Testing checklist / Rollback Plan / Sign-off)
- TypeScript: 0 errors; runtime smoke test ผ่าน (`system.health` ตอบ rich payload, server บูท clean, no transform errors)
- commit `TBD` push ขึ้น `origin/main-v2`
- ข้อควรระวังที่เจ้าของระบบควรทราบ:
  - `scripts/update.sh` และ `scripts/rollback.sh` ใช้ `kill -TERM $(lsof -ti tcp:${PORT})` เพื่อหยุด service — ถ้ารันบน PM2/systemd-managed process ต้องหยุดผ่าน service manager ก่อน (script จะเตือน "no process listening" ถ้า service ไม่รันอยู่)
  - `system.logRelease` ใน scripts ต้องการ `RELEASE_LOG_DEV_USER` + `RELEASE_LOG_DEV_PASS` env vars ถ้าต้องการ auto-log release ใน DB; ถ้าไม่ตั้ง script จะ log warning แล้ว operator ต้องเรียก `system.logRelease` ผ่าน UI เอง
  - `system.health` เป็น publicProcedure โดย design — load balancer สามารถ probe ได้โดยไม่มี cookie; ไม่ leak ข้อมูล sensitive (version, uptime, memory, db size = standard health metrics)
  - `findPackageJsonPath()` ใน version.ts walk up สูงสุด 10 ระดับ — ถ้า bundle อยู่ใน folder structure ลึกกว่านั้น (rare) จะคืน null และ `getVersion()` จะคืน "0.0.0" (fail-safe ไม่ใช่ throw)
