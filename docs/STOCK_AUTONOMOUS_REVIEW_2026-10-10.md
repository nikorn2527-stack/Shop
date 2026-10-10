# Stock / intake / catalog review — 2026-10-10

## Scope and isolation
- Reviewed stock browsing, intake, new product creation, product editing/deletion, and their effects on POS.
- Read the repository `.clinerules`. Browser scenarios used isolated temporary databases and a local production server; no production deployment or production data changes.
- Existing unrelated working-tree changes were left intact.

## Corrections
- Extracted price-tier serialization into `client/src/lib/productPriceTiers.ts`. Only completely empty rows are ignored; incomplete rows, non-positive/non-finite prices or quantities, and duplicate labels are rejected instead of silently losing entered data.
- Catalog creation validates the reorder threshold as a non-negative integer instead of silently rounding fractional input.
- Product details refresh after a successful edit instead of continuing to display stale values.
- Expanded stock intake regression and browser checks, including catalog creation validation, detail refresh, deletion, and intake/edit propagation to POS.

## Verified results
- TypeScript: `npm run check` passed in the final verification.
- Regression: 31 test files / 250 tests passed.
- Production build passed. Existing bundle-size warning remains; this is not a warning-free build.
- Final stock browser run: `node --import tsx scripts/receive-rows-smoke.mjs` exited 0.
- Stock browser coverage: category filtering, search by name/SKU/barcode, unfinished intake preservation, inline product creation, receipt save/reload, CSV/Excel/PDF exports and filtered content/cost checks, catalog validation, edit/detail refresh, POS price/name and stock-limit checks, catalog deletion, and no captured page errors.
- POS browser run passed cash, QR, member payment, held bills, and receipt export scenarios.
- Stock table and add/edit dialogs checked at 1366x768 and 390x844, including horizontal table scrolling and scroll-container reachability. Desktop/mobile intake screenshots were also inspected.

## Evidence
- Final stock evidence: `C:\Users\Korn\AppData\Local\Temp\stock-intake-audit-B0CPhz`
- Final stock log: `C:\Users\Korn\AppData\Local\Temp\stock-review-final-browser.log`
- Regression log: `C:\Users\Korn\AppData\Local\Temp\stock-review-tests.log`
- Build log: `C:\Users\Korn\AppData\Local\Temp\stock-review-build.log`
- POS log: `C:\Users\Korn\AppData\Local\Temp\stock-review-pos.log`

## Limits
### Follow-up: receiving usability
- Replaced the narrow vertical intake sidebar with a full-width editor: five fields and add/clear actions in two desktop rows; two columns on mobile.
- Purchase quantity now starts empty instead of 1. Free quantity selects its existing value on focus.
- Completed receipt rows display summaries, with edit/remove buttons at the end. Editing uses a separate draft with save/cancel; invalid drafts and unfinished edits block final submission.
- Browser regression checks explicitly cover blank quantity typing, two-row layout, add-button visibility without scrolling, read-only summaries, edit cancellation and validation, and mobile overflow.
- Follow-up regression: 250 tests passed; TypeScript/build passed with the existing bundle warning. Browser evidence and logs: `C:\Users\Korn\AppData\Local\Temp\receive-ux-browser.log` (evidence directory printed at its start).

These results confirm the exercised scenarios, not universal 100% correctness. Physical cameras/scanners, production permissions/network behavior, all catalog semantics, and every possible device size were not independently certified. No deployment was performed. Screenshots intentionally show some scroll containers at their end to verify access to bottom/rightmost content.