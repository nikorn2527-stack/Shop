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
