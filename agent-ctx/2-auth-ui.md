# Task ID: 2 — Auth UI (login / setup / force-change) + PasswordMeter + api-client

**Agent:** full-stack-developer (auth UI)
**Branch:** `dev`
**Date:** Task 2 build

## Scope

Build the three auth UI views (`LoginView`, `SetupView`, `ForceChangeView`) plus the `PasswordMeter` component and a thin client `api-client` fetch wrapper. The root `page.tsx` becomes a Server Component auth gate that decides which view to render based on `db.user.count()` and `getSession()`.

This task depends on Task 1's foundation: `lib/auth.ts` (session/login/setup/changeOwnPassword + `passwordPolicyForRole`), `lib/rbac.ts` (`roleLabel` + system roles), `lib/errors.ts` (`StoreError`/`AuthError` + `errorPayload`), and the API routes under `src/app/api/auth/{login,logout,me,setup,setup-status,change-password}/route.ts`.

## Files produced

| Path | Purpose |
|---|---|
| `src/lib/api-client.ts` | `"use client"` fetch wrapper. `apiGet/apiPost/apiPatch/apiDelete` + `isUnauthorized` + `ApiError`. Forwards cookies, extracts Thai message from `{ error: { message } }`, on 401 hard-redirects to `/`. |
| `src/components/PasswordMeter.tsx` | `"use client"`. 4-segment emerald strength bar + Thai label + checklist. Exports `passwordIssues`, `passwordRuleState`, `passwordPolicyForRole` (mirrors server-side policy: admin/dev_service = min 12 + symbol; others = min 8). |
| `src/components/auth/LoginView.tsx` | RHF + zod. Eye toggle, emerald submit, sonner toasts, `router.refresh()` on success. |
| `src/components/auth/SetupView.tsx` | storeName (opt) + username + displayName + password + confirm. `<PasswordMeter role="administrator" />`. POST `/api/auth/setup` → refresh. |
| `src/components/auth/ForceChangeView.tsx` | current/new/confirm + role-aware PasswordMeter. "ออกจากระบบ" escape button. POST `/api/auth/change-password` → refresh. |
| `src/components/auth/AppShell.tsx` | Temporary placeholder dashboard (header + logout + sticky footer). Will be replaced by real POS layout in a later task. |
| `src/app/page.tsx` (rewrite) | Server Component. Decision tree: no users → SetupView; no session → LoginView; `mustChangePassword` → ForceChangeView; else AppShell. `dynamic = 'force-dynamic'`. |
| `src/app/layout.tsx` (modified) | Replaced legacy radix `<Toaster />` with sonner `<Toaster position="bottom-right" richColors closeButton />`. Set `<html lang="th">` and PNG Shop metadata. |

## Key design decisions

1. **api-client 401 handling** — instead of throwing then leaving the caller to redirect, the wrapper itself triggers `window.location.href = '/'` (or `window.location.reload()` if already at `/`). This guarantees that any client component that calls an authed endpoint after session expiry lands back at the login view automatically. The thrown `ApiError` is still propagated so callers can show a toast for non-401 failures.

2. **PasswordMeter role prop** — the original Shop's meter took `{ min, needSymbol }` directly. The task spec asked for `role="administrator"`. The new component accepts `role` and internally calls `passwordPolicyForRole(role)` (mirrored from the server in `lib/auth.ts`). The exported `passwordIssues(password, opts)` helper still takes the explicit `{ min, needSymbol }` opts for parity with the original API, so forms can pre-compute policy then reuse the helper.

3. **Color palette** — emerald-600 for primary CTAs, amber-500 for the ShieldAlert icon in ForceChangeView (signaling "action required"), red-500/amber-500/lime-500/emerald-600 for the strength bar segments. No indigo, no blue.

4. **Server-Component auth gate** — `page.tsx` does NOT use `'use client'`. It calls `db.user.count()` + `getSession()` directly (both server-only). Each client view is wrapped in `<Suspense fallback={null}>` so the server doesn't try to pre-render the form state. `dynamic = 'force-dynamic'` ensures fresh session lookup on every request so the client-side `router.refresh()` after login/logout picks up the new state immediately.

5. **AppShell placeholder** — kept minimal (header with logo + user badge + logout button + sticky footer) so the auth flow can be exercised end-to-end. A later task will swap this for the real POS layout.

## Verification

- `bun run lint` — clean (0 errors, 0 warnings).
- `dev.log` — only `✓ Compiled in ...` lines and `GET / 200`; no errors or warnings.
- `curl http://localhost:3000/` — HTTP 200 with SetupView HTML (`"ตั้งค่าระบบครั้งแรก"`, `"PNG Shop"`, `storeName` input rendered).
- `curl http://localhost:3000/api/auth/setup-status` → `{"needsSetup":true}` (200).
- `curl http://localhost:3000/api/auth/me` → `{"user":null}` (200).

## Blockers / decisions

No blockers. One minor deviation from the literal task spec: the task said "Use shadcn/ui components: Card, Input, Button, Label" — all four are used as designed (Card with `py-0` override so CardContent's `p-8` is the sole padding; emerald color applied via `className` override on Button since the shadcn `default` variant is near-black). All other directives followed as written.
