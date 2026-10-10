# Local browser audit — 9 October 2026

Scope: current local production build, temporary database copies only. No deployment or changes to customer business data.

## Issues found and fixed
- POS main scanner and cart quantity scanner recognized member numbers but not reusable physical card numbers. Both now resolve the card code to its assigned member before confirmation; cash/QR/member checkout is tested afterwards.
- Receiving: selecting another item could overwrite unfinished quantity/payment/Lot data. The unfinished draft is now preserved and a visible message requires adding or clearing it first.
- Receiving: the selected-product chip's change button did not expose the search box because parent selection immediately restored the chip. Separate search-mode state now allows searching while retaining the draft.
- Lot editing: deriving the input value with a fallback on every keystroke restored the generated Lot when the user cleared it. The suggestion now initializes the draft instead; text can be replaced normally.
- Closing receiving now clears the editor and inline new-product state, preventing previous draft fields from reappearing on a later opening.

## Verified browser/HTTP paths
- Login with valid credentials, explicit transfer in a second browser context, old-session rejection, login throttling and continued operation of the authenticated session.
- Existing product lookup by name/SKU/barcode and category filtering in POS.
- Receiving via keyboard, unfinished-draft protection, inline creation after an unknown code, typed expiry date, invalid-quantity rejection without partial writes, mixed batch save and reload.
- Database reconciliation: stock quantity, weighted cost, Lot, expiry, receipt value and operator; integrity check.
- Receiving history filters, actual document preview, CSV/Excel/PDF downloads. Spreadsheet checks validate the selected Lot/current selling value and exclusion of another Lot. This report labels selling value, not purchase payment; acquisition cost/payment is reconciled separately in the database. PDF signature and preview content checked, not every PDF page.
- Cost/profit report: an isolated fixture uses actual receiving/checkout functions; displayed revenue/COGS/profit reconciled against persisted sales. Product/daily tabs and desktop/mobile scrolling checked.
- Follow-up repair: receiving history displays recorded acquisition cost/value alongside current selling price/value. Filtered CSV/Excel values are checked by exact column names; legacy unknown amounts remain explicit. Preview and PDF download retested.
- Card lifecycle browser check retested with explicit session transfer: generation across two batches, external card registration, history popup on desktop/mobile, full refund and release, assignment to the same existing member and zero-balance release. Database balance/card binding, closed usage session and single refund reconciled.
- `scripts/pos-transactions-smoke.mjs`: actual cash sale and receipt PDF/PNG downloads, held bill/reload/restore, QR verification before stock deduction, and member-wallet sale selected by physical card. Sale counts, stock changes and member balance are reconciled.
- Settings save success persists to the database; simulated failed save retains the draft; discard and mobile/desktop save notifications are verified by `scripts/settings-popup-smoke.mjs`.

## Test-environment findings
- Previous cost/profit script assumed customer data contained sales; the refreshed dataset does not. A sale is now prepared only in the isolated database.
- Old standalone receiving-export script depends on a stopped server at port 4185. The independent receiving browser script now covers exports without relying on that server.
- Card test copied historical parallel login sessions. The script now performs the real transfer-confirmation step instead of waiting indefinitely for the app shell.

## Not certified
### Resumption verification
- Re-ran `scripts/card-actions-smoke.mjs`: exit 0. Evidence: `C:\Users\Korn\AppData\Local\Temp\shop-card-actions-VKY7nc`. Verified full refund/release, assignment after reload, zero-balance return, exactly one refund and database integrity.
- Re-ran `scripts/pos-transactions-smoke.mjs`: exit 0. Evidence: `C:\Users\Korn\AppData\Local\Temp\search-input-audit-9zAmDy`. Verified cash/QR/member-wallet sales, held-bill reload/restore, receipt downloads and database reconciliation.
- TypeScript check passed. Regression: 29 files / 237 tests passed, exit 0. These results do not certify untested features or physical devices.

Full application feature coverage, all permissions/roles, payment receipt by a bank, physical scanner/printer/camera, every exported PDF page, Railway behaviour and production load. Pending work must not be marked complete based on this audit.