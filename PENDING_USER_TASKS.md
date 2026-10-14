# User-request follow-up

This checklist records outstanding acceptance checks, not production approval.
Before closing a later request, review this file and update only items supported by evidence.

## Implemented; verification still incomplete

### Latest verified repairs (9 October 2026)
- Receiving draft protection, selected-product search, editable Lot text, keyboard intake and mixed existing/new-product batch have browser/database reconciliation evidence in `docs/USABILITY_AUDIT_LATEST.md` and `scripts/receive-rows-smoke.mjs`.
- Receiving history now separates recorded acquisition cost/value from current selling price/value. CSV/Excel checks validate exact column values, filtered Lot and exclusion of another Lot; PDF download and preview checked. Unknown legacy acquisition values remain "ไม่ระบุ" rather than zero.
- The receiving-history day defaults use Bangkok dates. Existing notes below are historical and do not override these verified updates.
- Remaining acceptance includes physical devices, all report pages, permissions and the rest of the application. No full production approval.
- Card lifecycle/browser inventory and desktop/mobile history popup checked again using explicit login transfer. Automatic/external codes, full refund/release, assigning an existing member and zero-balance return reconcile with database; CSV card intake, complete role matrix and concurrency are still outstanding.
- Actual POS cash/QR/member-wallet checkout, receipt PDF/PNG, held bill reload/restore and database reconciliation verified after fixing main-scanner recognition of physical card numbers. Full multi-row cart, all roles and reversal-after-card-reassignment remain outstanding.
- Settings save/reload persistence, simulated save failure retaining values, discard and mobile/desktop save-panel checks passed on an isolated production server.

- Reusable physical cards (local changes): inventory tables and legacy backfill, registration assignment, separate return, lost/damaged blocking, shared registration without automatic card printing, and inventory panel in Members. HTTP on isolated production server 4197 verified login/create/register/duplicate rejection/return/reuse/anonymous rejection; database reconciliation preserved first member balance 25 and new member balance 0 with three assignment records. Regression 193/193 passed. The original browser launch failure and replacement-card gap were resolved by the later evidence recorded below. Remaining: CSV intake, complete role matrix/concurrency, import integration and full browser regression of changed registration requirements. Sidebar grouped into front-office/back-office without changing existing permissions. No production approval or push.

- Member-card balances: default excludes zero balances; option includes all members. Reconcile filtered counts/totals in preview, PDF, print and spreadsheets through the browser, including negative balances and an empty result.
- POS limit reduction: sidebar entry, member selection, shared validation and confirmation verified. Submit a request on an isolated database and verify pending status, unchanged limit, approval/rejection and reload.
- Settings unsaved floating card: appearance, persistence and discard verified. Verify successful save/reload and failed-save retention through the browser, including mobile overlap.
- Latest cutoff summary: expand/collapse with a saved closure fixture and verify current-period figures remain unchanged.
- POS layout: verify a full multi-row cart and complete cash/QR/member checkout after the latest layout changes, reconciling receipt, stock and ledger.
- Shared calendar: test remaining consumers, not just stock receiving.
- Shared palette: inspect remaining pages and login disabled-button readability.
- Member card workflow and Navy Slate palette: replacement preserves the member identity/balance and rotates the physical-card session atomically; closed accounts expose return-only actions; member detail/POS use the live `cardUsable` guard. TypeScript, 275-test regression, 112-test SQLite regression, production build, isolated card browser/database reconciliation and desktop/mobile palette smoke passed on 14 October 2026. Evidence: `C:\Users\Korn\AppData\Local\Temp\shop-card-actions-OS4XU9` and `C:\Users\Korn\AppData\Local\Temp\isolated-review-n2lj7N`. This does not certify physical scanners/cards or the complete role/concurrency matrix.

## Decisions / requirements not yet implemented or fully accepted

- Stock receiving history/report (requested): expose date/time, SKU/name, lot, original received quantity (not remaining quantity), unit, cost/value, expiry and receiver; filter Today/date range/product/lot, preview/print/PDF/Excel. Existing stock_lots and RECEIVE movement records are not a completed receiving report. Movement currently records one aggregate with no lot ref_id and average inventory cost, and its reason omits auto-generated lotLabel; do not infer original purchase value or receiver-to-lot links by ambiguous timestamps. Preserve historical unknown values explicitly and test new receipts plus subsequent sales/counts before acceptance.

- Member registration: full POS form extracted to MemberRegistrationModal and shared by POS and Members. Browser verification on isolated production-build server (port 4191) passed twice: register from Members with 25 initial balance and from POS with 10, open member card, select new member in POS, and verify both records/balances after reload. Photo-upload control presence verified; actual image upload, camera capture and card export still require acceptance. Changes remain local, not pushed.
- Member balance card: override the pale icon color with a visible dark-blue wallet icon on a light-blue surface. TypeScript/build checks do not replace browser visual acceptance.
- Store receipts/payments: distinguish member-card spending from new cash/QR receipts; adding a complete store cash ledger remains unimplemented. Do not double-count deposits and later wallet purchases.

- Lot numbering: currently date-derived when blank, not a unique running sequence. A sequence was suggested but not implemented; confirm requirements before changing it.
- Bill history: storage is separate from the display limit. Complete pagination/search acceptance for older bills; do not equate a loaded-page limit with retained history.
- Production acceptance: finish role matrix, import duplicate/error scenarios, concurrency, export page-by-page reconciliation and changed-file/artifact review. Physical peripherals require access to the actual hardware.

## Current copy-cleanup request

- Removed the 11 supplied visible explanations from settings, dashboard, reports and stock forms; preserve form controls and business logic.
- Item 12 was blank and is not treated as an additional removal request.
- Final checks and browser outcomes are reported in the response; do not infer full-system acceptance from these checks.