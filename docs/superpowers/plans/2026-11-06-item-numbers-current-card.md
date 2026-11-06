# Item numbers and current report card — implementation plan

Goal: Preserve business identities and financial history while numbering products in source-document order and displaying only the currently assigned card in the balance screen.
Architecture: Add an independent persistent products.item_number, backfill original opening-import products by source row, append subsequent/unmatched products by ID, and allocate future numbers atomically in SQLite. Never reuse allocated numbers. Display current members.card_number on screen; keep export configuration free of card data.
Tech stack: TypeScript, node:sqlite, React/tRPC, Vitest, Playwright.
Spec: User-approved requirements in this conversation, 2026-11-06. Local work only; no Railway deployment.

Constraints: No changes to existing IDs, SKUs, barcodes, sales, stock, prices, member balances or card assignments. Back up before persistent backfill. Reruns must not renumber. New live products outside the original 196 must remain present and receive subsequent numbers.

Review focus: Source gaps become consecutive Item numbers; unmatched and inactive products remain; deleted highest Item is not reused; migration backup failure makes no changes; rotating cards show current holder and stay absent from exports.

## Task 1 — Permanent Item numbering
Files: server/migrations/productItemNumbers.ts, server/sqliteStore.ts, shared/storeTypes/{inventory,reports}.ts; tests server/productItemNumbers.test.ts and migration tests.
- [x] Write and observe failing allocation/report-order tests.
- [x] Add transactional backfill, unique index and database-level insert allocation, with a durable high-water mark.
- [x] Expose itemNumber on products/report rows; order reports by it and display it consistently under filtering and in exports.
- [x] Verify migration with original document metadata, extra products, repeat startup, backup failure, and unchanged business tables.

## Task 2 — Current revolving card on balance screen
Files: client/src/pages/reports/Reports.tsx. Existing memberBalances API already returns current members.card_number.
- [x] Pin current-card transfer behavior in a real database test.
- [x] Add screen-only current-card column and refetch on opening/focus; do not add card to export rows.
- [x] Browser-check screen and actual export with synthetic unique card marker.

## Task 3 — Release readiness on Local
- [x] Run type check, build and relevant/full unit suite.
- [x] Rehearse upgrade against a separate copy of Local pre-launch real data and compare all business records before/after; produce a private item-number mapping for review.
- [x] Verify Local browser, keep changes reviewable, and report limits: no current live snapshot and no Railway deployment.

## Verification (2026-11-06)
86 test files / 676 tests passed, type check and production build passed. Rehearsal against the 196-product opening dataset matched all document rows and preserved all original columns/records in 26 tables, apart from the appended audit entry. An older 224-product dataset retained every product, ordered 193 document matches first and appended 31 extras. Browser checks covered current-card screen display and exclusion from balance CSV/XLSX/shared preview/print; PDF download and first-page visual inspection also passed. Hospital inventory preview and CSV preserve Item order. Receipt address uses the existing settings field, and browser downloads/print-request captures passed for 58/72/80 mm. No physical printer test and no Railway deployment. Local account recovery was tested only on a private throwaway copy, and is not part of this code change.

Stock export follow-up: reordered the current-stock document to Item/code/name/unit/quantity/price/value/status, compact spacing, removed the duplicate snapshot summary row, and preserved SKU/lot/expiry detail in spreadsheet exports. All 677 tests pass (87 files); type check and build pass. Real-browser verification of all 196 catalog rows found zero wrapped product names and no horizontal document overflow (688/688 px). Actual stock CSV retains all 196 permanent Item numbers and 11 detail columns. Receipt sample with the user-provided hospital address was generated from the actual app with synthetic guest-sale data. No Railway deployment.

## Revised customer requirement — current members and cards in exports
This supersedes the earlier screen-only card requirement: include the current card after member number in CSV, Excel, PDF, preview and print. Preserve card/member identifiers as text, including leading zeroes; absent cards display an em dash. All outputs share a single column mapping.

Remove the zero-balance visibility checkbox and always show zero-balance current members. With no clinical departure field in this application, the report excludes zero-balance members only when they have no currently linked card and either (a) account_closed is set or (b) their latest assignment action is a release with the official complete-return notes used by returnMemberCard/full refund. A generic release, never-issued card, replacement, ordinary withdrawal to zero, or later re-assignment does not by itself establish departure. Pending physical card returns remain visible. This is a read-only query change: no schema migration, financial write, account change or deletion of history.

Verification: 89 test files / 685 tests passed; type check and production build passed. Real-browser rehearsal used a separate database copy on port3001. It verified current zero members, completed zero/paid returns, replacement cards, no-card placeholder, no status column or old checkbox, actual CSV and XLSX cells, extracted PDF text, shared preview and captured print HTML. Leading-zero card identifiers remain text in XLSX. Physical printer output and the latest production dataset were not tested. Test branch only; no Railway deployment.

## Local transaction demonstration
Added a CLI-only `demo:transactions` command. It copies the selected project-local SQLite database into a fixed ignored `.transaction-demo` workspace, preserves all account credentials, marks branding as demonstration data, and seeds through native business functions. The original file remains byte-identical. The command refuses Cloud/Railway and external/unmarked paths, reuses an existing marked demo without duplicating records, and backs up the old demo before an explicit rebuild. Nothing is seeded from application startup or HTTP routes.

The 196-product rehearsal generated 71 bills (one voided), 43 wallet transactions, 396 new lots and 21 scenario types, including complete/zero returns, staying zero balances, card replacement/reuse, receipts, all payment methods, intake/free units, costing, price change, lot stock count, order preparation, day closure and shifts. Original 105 member rows and all user/account rows were compared unchanged in the copied database; original source SHA256 was unchanged. Browser checks passed for login, clear demo branding, all report sections, correct member eligibility and current-card export, with no runtime errors. Full suite: 91 files / 691 tests pass; final focused suite: 6 tests pass; type check and production build pass. Cloud guard separately exited with code1. No Railway deployment; user starts the demonstration on their own Local with the documented command.
