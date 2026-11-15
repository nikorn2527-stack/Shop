# Approved hospital login design

User approved generated concept `/workspace/generated_images/exec-5d52b915-5ee2-4740-8c0a-1a5bc66d331b.png`.

Use the original mint garden background, a centered welcome heading and hospital name above a white login card, two aligned fields and green #65DC98 submit button. Restore the existing customer logo above the heading, as explicitly discussed. Copy: ยินดีต้อนรับสู่ร้านค้าสวัสดิการ; โรงพยาบาลธัญญารักษ์อุดรธานี; เข้าสู่ระบบ; ชื่อผู้ใช้; รหัสผ่าน. Keep `POWERED BY PNG TEAM` below the card (team branding standard updated 13 November 2026).

Approaches: use an existing configurable embedded login background rather than hardcode imagery across the application. Add a login-only organization name setting, blank by default for existing installations, and prepare the approved image/settings as a separate handover payload. This preserves existing logos, store names and the ability to remove/change the image without rebuilding. The customer-specific name is configuration, not a default for unrelated installations.

Preserve auth logic, Enter submit, password reveal, transfer confirmation and error feedback. No changes to credentials, business data, workspace imagery or printed documents. Retain the existing staff-only notice as small unframed text under the form for clarity. This is an intentional continuation of existing functionality beyond the generated concept. At small widths wrap headings and permit vertical scrolling, including landscape and keyboard use. No new motion.

No Railway writes or pushes. Build in a separate worktree from cached origin/main 0086647. Public brand endpoint may supply the existing logo for local preview only.
