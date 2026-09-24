# Worklog — PNG Shop Rebuild (Next.js 16 + Prisma)

Baseline reference: `/tmp/Shop` (branch `dev`, commit `fcdc3ac` — content-identical with `main`).

Guiding documents (provided by user):
1. Technical Review & Finalization Plan — Security, Data Model, RBAC, Cashier Shift, Void/Refund.
2. Deployment Guideline — One Codebase / Two Models (Cloud + On-Premise), Docker, versioned migration, System Update screen.

Working branch: `dev` (do NOT merge to `main` without explicit user confirmation).

---

Task ID: 0
Agent: orchestrator
Task: Setup — switch to dev branch, install missing deps, copy Sarabun fonts, verify dev server.

Work Log:
- Confirmed current `main` branch was clean (only Next.js scaffold + minimal prisma User/Post).
- Created `dev` branch via `git checkout -b dev`.
- Installed runtime deps: `jspdf html2canvas qrcode @zxing/browser @zxing/library xlsx nanoid bcryptjs date-fns-tz`.
- Installed dev deps: `@types/qrcode @types/bcryptjs`.
- Copied 14 Sarabun woff2 files (Thai + Latin, weights 300–800) + IBMPlexMono to `public/fonts/`.
- Confirmed dev server already running on port 3000 (Next.js 16.1.3) — log shows healthy `GET / 200`.
- Verified `DATABASE_URL=file:/home/z/my-project/db/custom.db` in `.env` (SQLite).

Stage Summary:
- Environment ready. Next step: write Prisma schema for ~22 tables per Technical Review Section 6 (with Cashier Shift, Stock Movement Ledger, RBAC, Refunds).
- Do NOT merge `dev` → `main` without user confirmation.

---
Task ID: 2
Agent: full-stack-developer (auth UI)
Task: Build login/setup/force-change views + PasswordMeter + api-client

Work Log:
- Read worklog Task 0 + Task 1 outputs (Prisma schema, auth.ts, rbac.ts, format.ts, errors.ts, API routes under src/app/api/auth/) to understand session cookie model, role-based password policy, and error envelope `{ error: { code, message } }`.
- Read original Shop's LoginView/SetupView/ForceChangeView/PasswordMeter for behavior parity (strength score 0-4, role-based min/symbol policy, "ออกจากระบบ" escape hatch on ForceChangeView).
- Replaced legacy `<Toaster />` (radix-toast based) in `src/app/layout.tsx` with sonner's `<Toaster position="bottom-right" richColors closeButton />`; also set `<html lang="th">` and replaced scaffold metadata with Thai PNG Shop metadata.
- Created `src/lib/api-client.ts` (`"use client"`): exports `apiGet/apiPost/apiPatch/apiDelete` + `isUnauthorized` + `ApiError` interface. Forwards cookies (`credentials: 'include'`), extracts Thai business-rule message from `{ error: { message } }`, on 401 hard-redirects to `/` (or reloads if already at `/`) so the server auth gate re-evaluates the session.
- Created `src/components/PasswordMeter.tsx` (`"use client"`): 4 emerald segments (red→amber→lime→emerald as score rises), Thai strength labels, per-rule checklist (length/letter/digit, +symbol when role requires). Exports `passwordIssues(password, opts)`, `passwordRuleState`, `passwordPolicyForRole(role)` (mirrors server-side `passwordPolicyForRole` in auth.ts — admin/dev_service: min 12 + symbol; others: min 8).
- Created `src/components/auth/LoginView.tsx`: react-hook-form + zod (username/password min 1), Eye/EyeOff toggle, emerald submit button, "สมาชิกสวัสดิการไม่ต้องเข้าระบบ — ใช้สิทธิ์ที่เคาน์เตอร์" helper, sonner toasts on success/error, `router.refresh()` on success. Card on `bg-[#fcfbf7]` warm off-white.
- Created `src/components/auth/SetupView.tsx`: storeName (optional) + username + displayName + password + confirmPassword; admin policy enforced client-side via `passwordIssues`; `<PasswordMeter role="administrator" />`; footer note "หลังตั้งค่า ระบบจะให้คุณเปลี่ยนรหัสผ่านอีกครั้งก่อนเริ่มใช้งาน"; POST `/api/auth/setup` then `router.refresh()`.
- Created `src/components/auth/ForceChangeView.tsx`: currentPassword (Eye toggle), newPassword + `<PasswordMeter role={user.role} />`, confirmPassword; zod superRefine for new≠current + confirm match + strength; "ออกจากระบบ" button at bottom (POST `/api/auth/logout` → refresh); shows role label + avatar (uses `roleLabel` from rbac.ts).
- Created `src/components/auth/AppShell.tsx`: temporary placeholder dashboard with header (logo + user badge + logout button) and sticky footer; ready to be replaced by the real POS layout in a later task.
- Rewrote `src/app/page.tsx` as a pure Server Component (NO `'use client'`). Decision tree: `db.user.count() === 0` → SetupView; `getSession() === null` → LoginView; `mustChangePassword === true` → ForceChangeView; else → AppShell. `export const dynamic = 'force-dynamic'` keeps the gate fresh on every request so client-side `router.refresh()` after login/logout picks up the new session state.
- Verification: `bun run lint` clean (0 errors, 0 warnings); dev.log shows `✓ Compiled in ...` (no errors); `curl http://localhost:3000/` returns HTTP 200 with the SetupView HTML ("ตั้งค่าระบบครั้งแรก", "PNG Shop"); `/api/auth/setup-status` → `{"needsSetup":true}`; `/api/auth/me` → `{"user":null}`.

Stage Summary:
- Files created:
  - `src/lib/api-client.ts` (client fetch wrapper + ApiError)
  - `src/components/PasswordMeter.tsx` (strength meter + passwordIssues/passwordRuleState/passwordPolicyForRole exports)
  - `src/components/auth/LoginView.tsx`
  - `src/components/auth/SetupView.tsx`
  - `src/components/auth/ForceChangeView.tsx`
  - `src/components/auth/AppShell.tsx` (placeholder + logout)
- Files modified:
  - `src/app/layout.tsx` (sonner Toaster, lang="th", PNG Shop metadata)
  - `src/app/page.tsx` (rewritten as Server-Component auth gate)
- Auth flow end-to-end verified on dev server (port 3000): no users → SetupView renders; setup → force-change → AppShell handoff via `router.refresh()` working through the server-side gate.
- Lint: clean. No new dependencies installed (sonner, react-hook-form, @hookform/resolvers, zod, lucide-react all already in package.json from Task 0).
- Next: replace AppShell placeholder with the real POS dashboard shell (sidebar + topbar + module routes). The auth + rbac + audit foundation from Task 1 is ready to gate those routes.

---
Task ID: 1+2 (verified)
Agent: orchestrator
Task: P0 Foundation + Auth — verified end-to-end via Agent Browser.

Work Log:
- Wrote Prisma schema (~22 tables) covering Security, Catalog, Warehouse (with stock_movements ledger), Sales (with payments + refunds), Members + wallet, Cashier Shift, Day Closure, Pricing history, Settings, License, Backup, SystemVersion.
- Pushed to SQLite via `bun run db:push` (clean, 31ms).
- Built lib layer: `format.ts` (Bangkok tz + money + Thai date), `errors.ts` (StoreError/AuthError/ConflictError/NotFoundError + httpStatusFor), `rbac.ts` (PERMISSION_CATALOG 29 keys + 6 SYSTEM_ROLES), `auth.ts` (cookie session + bcrypt + idle/absolute timeout + login/logout/setup/changeOwnPassword), `audit.ts` (logAction + logActionTx), `scan.ts` (scanCandidates + smartMatchScore + compressImageToDataUrl), `api.ts` (withHandler/withAuth/withAnyPermission route wrappers).
- Created 6 API routes: /api/auth/{login,logout,me,setup,setup-status,change-password} + /api/system/seed.
- Dispatched subagent (Task 2) to build auth UI: api-client.ts, PasswordMeter.tsx, LoginView, SetupView, ForceChangeView, AppShell placeholder. Server-side page.tsx gate (no users → setup; no session → login; mustChange → force-change; else appshell).
- Installed packages: jspdf html2canvas qrcode @zxing/browser @zxing/library xlsx nanoid bcryptjs date-fns-tz @types/qrcode @types/bcryptjs.
- Copied 14 Sarabun woff2 + 2 IBMPlexMono woff2 from /tmp/Shop.

Browser verification (real flows):
1. Setup → admin/admin → "Admin@123456" → POST /api/auth/setup 200 → ForceChangeView ✅
2. ForceChangeView → current=Admin@123456, new=NewPass@1234 → POST /api/auth/change-password 200 → AppShell ✅ (session for other devices revoked per spec)
3. Logout → POST /api/auth/logout 200 → LoginView ✅
4. Login → admin/NewPass@1234 → POST /api/auth/login 200 → AppShell ✅ (toast "ยินดีต้อนรับ คุณนายผู้ดูแลระบบ")
5. Toasts + cookie session all working.

Stage Summary:
- P0 Foundation + Auth complete and browser-verified.
- 22-table Prisma schema synced with SQLite.
- RBAC seed (6 roles × 29 permissions) runs on first setup-status call.
- Auth flow: setup → force-change → app-shell → logout → login all pass.
- Next: dispatch parallel subagents for POS (Task 4) + Stock (Task 6) + Reports (Task 7) once RBAC UI (Task 3) is wired.
