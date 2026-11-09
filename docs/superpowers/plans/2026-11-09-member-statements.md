# Member statement exports

**Goal:** A family-facing A4 statement from the member detail page, with date range, opening/closing card balances, incoming/outgoing card funds and complete bill/product/quantity details. CSV, Excel, PDF and print share one document mapping.

**Existing limitation:** StatementModal currently uses member.detail's most recent 50 transactions, offers only PDF/print and has an incorrect full-month date array. Replace its data source with a dedicated authenticated, read-only query; preserve the existing member-detail history UI.

**Choices:** Extend the existing statement and report template rather than create a separate reporting system. The user confirmed full product and quantity detail per bill. Show member-linked cash/QR bills as purchases that do not change the card balance. Derive opening balance from the current stored balance and full ledger; do not create balancing transactions. Preserve historical card identifiers and item snapshots. Keep void purchases and their refunds visible without double counting wallet deductions.

## Tasks
- [x] Add integration tests for more than 50 entries, date boundaries, opening/closing balances, positive cancellation refunds, returned-card refunds, no-activity periods, different members, historical cards/items and exact database invariance.
- [x] Implement shared statement contracts, server read-only snapshot query and authenticated member.statement API. Validate calendar dates and reversed ranges. No schema/migration changes.
- [x] Test and implement one statement mapping with opening/totals rows, complete product details, numeric export columns and member metadata. Reuse the existing A4 preview, PDF and print helpers.
- [x] Replace StatementModal with range controls, loading/error/empty states and CSV/Excel/PDF/print actions. Rename the member entry button clearly. Keep the statement open after exporting or printing.
- [x] Verify targeted/full tests, TypeScript, build and browser exports/print using a separate synthetic demo database. Commit/push only the test branch. Never deploy Railway or copy Local databases, simulated transactions or QA accounts to production.

## Verification
- The new server and export-mapping tests failed before their modules existed, then passed. Coverage includes 61 entries (no 50-row cutoff), inclusive date boundaries, balances, void/refund signs, historical items/cards, member isolation and unchanged contents of every table.
- Authenticated API tests reject anonymous access and invalid calendar dates without writes.
- Full suite: 95 files / 716 tests passed. TypeScript, production build and git diff checks passed.
- Real browser on the isolated demo database: 26 card movements, 24 bills and all 66 item rows. CSV, Excel and a six-page selectable-text A4 PDF downloaded; print dispatched twice and modal remained open. The real date picker selected an empty date range correctly; desktop and 390px mobile layouts fit. No browser runtime errors.
- Browser comparison of members, transactions, sales, sale items, products, lots, card sessions/assignments, settings and audit logs was identical before/after the statement operations. Login/logout were outside that comparison.
- Browser verification exposed the shared date picker's body portal being blocked by modal pointer handling. It now portals into the nearest dialog when present; ordinary page pickers continue using document.body. The real range-picker regression and all existing date-picker tests passed.
- No schema/migration changes, simulated transactions added by this feature, production access or Railway deployment. Private demo exports and browser artifacts remain outside the repository.

## Follow-up: one product per readable row
- User requested dates, receipt numbers and product details to stop wrapping unnecessarily, with one item per row.
- Compact Bangkok Buddhist dates (DD/MM/YY HH:mm) and receipt references are kept together. Separate item name, quantity/unit, unit price and item total columns replace the long combined description. Bill summaries no longer repeat product names; complete notes and historical card references remain available in the bill/transaction row.
- Card incoming/outgoing and balance appear once per transaction/bill only. Product rows contain no additional card movements. Numeric export columns move to indexes 4–8, while member and receipt identifiers remain text.
- Focused tests: 15 passed, including statement balances and shared report rendering. TypeScript and build passed.
- Browser verified all 66 product names, quantities, dates and receipt references fit on one line without overlap in the demo document. CSV/XLSX/PDF, repeated print, date filtering and mobile layout passed; business-table snapshots remained identical. A4 output reduced from six to four pages. Only statement presentation/export mapping changed, with no database or server changes.
- Private refreshed examples: shop-member-statement-rows-review. No Railway deployment.

- Terminology requested by the user: all Thai UI labels, document titles, accessible labels and the Excel sheet name use รายการเดินบัญชี instead of สเตทเมนต์. Internal identifiers and financial data are unchanged.

- Pre-release follow-up: historical opening-balance correction was removed from normal app startup to meet the latest no-financial-adjustment requirement. Full release verification now passes 717 tests; see 2026-11-09-release-safety.md.
