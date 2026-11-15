# Approved export and transaction slip cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** Implement the approved report layouts and five consistent transaction completion slips on the review branch, without production deployment or database migration.

**Architecture:** Keep existing financial operations unchanged. Build slip documents from their successful, persisted operation results and reuse ReceiptModal for all completion controls. Report changes are pure display/export mappings.

**Tech Stack:** React/TypeScript, tRPC, SQLite, Vitest, Chromium/Playwright.

**Spec:** Conversation approvals and /workspace/private/export-approval-20261111/รายการเสนออนุมัติ.md; latest correction removes card numbers from ALL slips.

## Global Constraints
- Work on review/export-wording-cleanup only; do not merge/deploy.
- No database files, migrations, production calls or imported demo records in git.
- Preserve balances, ledger rows, stock, original LOT values and revolving-card identity.
- Do not add card numbers to slips. Keep member name and member number.
- Keep M1 wording วันที่เปิดใช้บัตร; preserve M2 optional returned-zero inclusion.
- After print/download, keep completion document open until explicit finish.
- PDF / image / print / finish share the sale-receipt positions; no copy labels/options.

## Review Focus
- Zero refunds and zero initial funds still have confirmation documents without inventing ledger movements.
- Money and timestamps come from saved transactions, not stale member balances or client clocks.
- Reprinting/downloading must not call register, wallet, checkout or return mutations again.
- A recycled physical card must not alter old document identity; no card number is printed.
- Long names and all four actions must fit 58/80mm and desktop/mobile dialogs.

### Task 1: Approved report layouts
Files: StockReceiptHistory.tsx; report helper/tests; Reports.tsx; sqliteStore.ts read-only history SELECT.
- [x] Write/observe failing tests for strict legacy OPEN-lot display shortening and hospital transaction column order/totals.
- [x] Implement S1 portrait, date-first/date-only, barcode/name separate, quantity+unit, short display-only LOT; preserve raw stored LOT and supplier lots.
- [x] Implement R1 date+time one line, card/member/amount order; Buddhist period dates and concise titles; remove redundant hospital summary blocks.
- [x] Run focused tests and TypeScript.

### Task 2: Saved document evidence
Files: shared/storeTypes/documents.ts; server operation response wrappers; documentPrinting.ts; tests.
- [x] Test saved amount/reference/time for deposit/withdrawal, card return and registration; include zero and repeat document reads.
- [x] Add typed document result/read-only mapping to existing successful operations; no extra monetary writes.
- [x] Enable printing registration/activation references using existing records/settings, without schema changes.
- [x] Verify ledger deltas remain exactly existing operation deltas.

### Task 3: Shared completion forms
Files: ReceiptModal.tsx; new transaction-slip wrapper/helper; ReturnCardModal.tsx; MemberRegistrationModal.tsx; Pos.tsx; MemberDetail.tsx; tests.
- [x] Test no card fields, operation labels, money summaries and signature roles.
- [x] Reuse ReceiptModal paper/action slots for all five operations.
- [x] Keep return/registration completion state until finish, defer parent callbacks until finish, retain real successful result.
- [x] Replace POS/member wallet success layouts with the same component; remove stale duplicate slip markup/preview paths.
- [x] Validate print/download/finish behavior without repeating financial mutations.

### Task 4: Verification and delivery
- [x] Run full suite, TypeScript and production build.
- [x] On a fresh isolated QA copy, exercise sale/deposit/withdrawal/return/registration and all document actions; capture actual screenshots.
- [x] Review changes and staged file list; exclude user private docs/databases.
- [x] Commit/push review branch only. Summarize implemented vs deferred items and production unchanged.

## Verification evidence
- 748 tests / 101 files pass; TypeScript check and production build pass.
- Isolated QA database: /workspace/private/approved-slip-implementation-20261112/qa3/store.sqlite (copy only, excluded from git).
- Actual browser: 10 completion cases, PDF + PNG + two print commands each, documents stay open, business tables unchanged by document actions, mobile buttons fit; manifest qa3/manifest.json.
- S1 actual CSV/XLSX/PDF/preview and raw LOT preservation verified; R1 actual deposit PDF verified. Artifacts remain private, outside repository.
- Independent review identified prior account-closure refund attribution; exact request matching and a zero-return document reference fix it. Regression observed RED then GREEN; targeted re-review has no remaining material findings.
- Hardware printing is not verified; the local print helper was mocked. No main merge, Railway deployment, schema migration or database upload.
