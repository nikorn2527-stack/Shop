# User-request follow-up

This checklist records outstanding acceptance checks, not production approval.
Before closing a later request, review this file and update only items supported by evidence.

## Implemented; verification still incomplete

- Member-card balances: default excludes zero balances; option includes all members. Reconcile filtered counts/totals in preview, PDF, print and spreadsheets through the browser, including negative balances and an empty result.
- POS limit reduction: sidebar entry, member selection, shared validation and confirmation verified. Submit a request on an isolated database and verify pending status, unchanged limit, approval/rejection and reload.
- Settings unsaved floating card: appearance, persistence and discard verified. Verify successful save/reload and failed-save retention through the browser, including mobile overlap.
- Latest cutoff summary: expand/collapse with a saved closure fixture and verify current-period figures remain unchanged.
- POS layout: verify a full multi-row cart and complete cash/QR/member checkout after the latest layout changes, reconciling receipt, stock and ledger.
- Shared calendar: test remaining consumers, not just stock receiving.
- Shared palette: inspect remaining pages and login disabled-button readability.

## Decisions / requirements not yet implemented or fully accepted

- Stock receiving history/report (requested): expose date/time, SKU/name, lot, original received quantity (not remaining quantity), unit, cost/value, expiry and receiver; filter Today/date range/product/lot, preview/print/PDF/Excel. Existing stock_lots and RECEIVE movement records are not a completed receiving report. Movement currently records one aggregate with no lot ref_id and average inventory cost, and its reason omits auto-generated lotLabel; do not infer original purchase value or receiver-to-lot links by ambiguous timestamps. Preserve historical unknown values explicitly and test new receipts plus subsequent sales/counts before acceptance.

- Member registration: Members currently uses a separate reduced MemberRegistrationModal while POS retains the full inline form. Extract the full POS registration workflow into one shared component, including photo/camera and post-registration card printing; do not mark shared API usage as shared form completion.
- Member balance card: override the pale icon color with a visible dark-blue wallet icon on a light-blue surface. TypeScript/build checks do not replace browser visual acceptance.
- Store receipts/payments: distinguish member-card spending from new cash/QR receipts; adding a complete store cash ledger remains unimplemented. Do not double-count deposits and later wallet purchases.

- Lot numbering: currently date-derived when blank, not a unique running sequence. A sequence was suggested but not implemented; confirm requirements before changing it.
- Bill history: storage is separate from the display limit. Complete pagination/search acceptance for older bills; do not equate a loaded-page limit with retained history.
- Production acceptance: finish role matrix, import duplicate/error scenarios, concurrency, export page-by-page reconciliation and changed-file/artifact review. Physical peripherals require access to the actual hardware.

## Current copy-cleanup request

- Removed the 11 supplied visible explanations from settings, dashboard, reports and stock forms; preserve form controls and business logic.
- Item 12 was blank and is not treated as an additional removal request.
- Final checks and browser outcomes are reported in the response; do not infer full-system acceptance from these checks.