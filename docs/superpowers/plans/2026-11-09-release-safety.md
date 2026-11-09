# Release preparation: preserve production financial data

The user requires a code update only, with no Local database replacement, demo transactions, QA credentials, resets or opening-balance corrections in production. This document records preparation, not deployment approval or evidence of a production deployment.

## Prepared scope
1. Permanent ITEM ordering and automatic numbering for newly created products.
2. Current linked card number in balance reports and all export formats.
3. Balance report includes current members at zero; excludes completed zero-balance departures/returns using recorded account/card history.
4. Store address and larger member name on sale receipts.
5. Compact stock exports with ITEM.
6. POS artwork visibility without stock badges covering the image.
7. Wrapped slip action buttons and explicit manual exit after print.
8. Persistent print-dispatch history and copy marking; explicit original/copy download selection.
9. New sale receipt numbering: Buddhist YY + MM + four digits, reset monthly; historical numbers retained.
10. รายการเดินบัญชีสมาชิก: full read-only range query, per-product quantity/price rows, CSV/Excel/PDF/A4 print, compact dates and unbroken receipt references.

## Financial startup safeguard
A pre-existing startup hook could correct an imported provisional opening balance. It has been removed from normal application startup. The maintenance utility remains available only as an explicitly invoked function, and tests preserve its original behavior; no runtime startup imports or calls it.

A new regression test fails against the former startup behavior and passes after removal, even when the restored database exactly meets the historical correction's eligibility conditions. Reopening does not change the member balance, card-session opening balance, transaction history or original import record.

## Expected database writes
- ITEM adds its column, allocator, index and trigger and assigns missing item numbers, with a backup before backfilling populated product data. IDs, codes, stock, costs, prices and financial history are retained.
- Print metadata uses dedicated store_settings keys, records dispatch attempts (not confirmed paper) and leaves financial transactions unchanged.
- Normal future business transactions continue to write as before. New receipt numbers apply only to new completed sales.
- Member statements and report filters read existing data without creating balancing entries.

## Verification and limits
- Full suite: 95 files / 717 tests passed. TypeScript and production build passed.
- Rehearsed startup twice on isolated copies of the two uploaded Nov 2 and Nov 6 backups; compared existing financial fields in members, member_transactions, products, sales, sale_items, stock_lots and card_usage_sessions. Snapshots remained identical and SQLite quick_check returned ok; source files were read-only and unchanged.
- Browser statement verification already covers complete product exports, native print dispatch, range filtering, mobile layout and identical business tables before/after.
- These are uploaded historical backups, not a newly obtained copy of the current Railway database. Production itself has not been modified or deployed during this preparation.

## Deployment procedure
Before an authorized deployment, take and verify a fresh backup of the production database. Preserve the Railway volume and database path; deploy the reviewed code only. Do not restore a Local file, run demo scripts, reset/setup accounts or seed sample data. Verify the deployed version, migration backup, financial totals, existing receipt reprint and a read-only statement after startup.
