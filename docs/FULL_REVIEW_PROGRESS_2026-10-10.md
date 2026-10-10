# Full-system review: verified progress, not production sign-off

## Safety
- Read `.clinerules`; saved the pending registration browser-test changes in Git checkpoint `8bc2b9b` before continuing.
- Browser scenarios use isolated copies and production builds. No Railway database restore, deployment or push performed.

## Defect repaired
Cancelling an old wallet sale after a card was returned/reused credited the correct member but linked the reversal to that member's currently open card round. Positive refunds were also counted as outgoing in round summaries.

- `voidSale` now preserves the original sale's card round, including NULL for historical sales with no known round.
- Round income/outgoing totals use the signed ledger amount rather than transaction names.
- Historical closing balances remain unchanged; a later reversal remains a separately dated transaction.
- Added regression exercising a sale, full card return, reuse by a second member, a new card for the original member, cancellation and duplicate-cancellation rejection.
- The new regression failed on the original implementation and passed after the repair. Fixture setup corrections were required before reproducing the defect.

## Results after repair
- TypeScript: passed.
- Regression: 255 tests, 32 files passed; command exit 0.
- Production build: exit 0; existing >500 kB bundle warning remains unresolved.
- Card browser/database lifecycle: exit 0, artifacts `C:\Users\Korn\AppData\Local\Temp\shop-card-actions-0xqedw`.
- Finance/stock/POS desktop/mobile browser scenario: exit 0, no page errors; artifacts `C:\Users\Korn\AppData\Local\Temp\sales-stock-fixes-2DoNlg`.
- Settings persistence/success/failure/discard browser scenario: exit 0; artifacts `C:\Users\Korn\AppData\Local\Temp\settings-popup-y1vQTx`.
- Isolated HTTP malformed-price import and concurrent wallet browser checks: exit 0, database integrity and foreign keys checked by the runner.
- Report template preview/PDF/print monochrome browser checks: exit 0; generated `C:\Users\Korn\AppData\Local\Temp\shop-monochrome-check.pdf`.
- Earlier resumed runs verified registration from Members/POS, actual photo upload, card PNG 1440x880/PDF 90x55mm, persistence, and stock-count preview headers. These were not rerun after the backend-only reversal fix.

## Still open
This is not complete acceptance of every menu. Role-by-role authenticated authorization, all multi-page report exports, physical printer/scanner/camera testing, production proxy/rate-limit configuration, and the bundle warning still require investigation. The legacy all-menu script depends on stale port/data/UI assumptions; its failure is not counted as a pass. Future work must preserve original assertions or replace them with equally explicit checks rather than merely bypassing failures.