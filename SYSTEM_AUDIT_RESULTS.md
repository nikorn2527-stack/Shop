# System audit — isolated database

Evidence directory: `C:\Users\Korn\AppData\Local\Temp\shop-system-audit-w1zSoG`

## Verified

- October 5, 2026 continued production audit: fixed missing login enforcement on `pos.void`. Anonymous cancellation now returns HTTP 401 before database access. Regression checks cover this alongside all three shift endpoints; real HTTP checks confirmed existing sales and shifts remained unchanged.
- Current full regression: 187/187 tests across 17 files passed; TypeScript, production build and diff checks passed. Rebuilt isolated production server on 4173; the live application on 3000 was not stopped or restored.
- Full browser suite rerun: 35/35 scenarios passed, no browser exceptions or unexpected HTTP 500 responses. Evidence: `C:\Users\Korn\AppData\Local\Temp\shop-production-audit-GhIQF1\exports-NEX8TG` and its parent `audit-results.json`.
- Tested encrypted backup download and restore. Initial harness failure assumed `.sqlite`; updated it to match the exact API-returned filename, authenticate/decrypt `.sqlite.enc` with the test key and run SQLite integrity checks. Encrypted backups remained enabled during the passing full rerun. Decrypted evidence is confined to the temporary test directory.
- New `scripts/wallet-concurrency-smoke.mjs`: two independent browser login contexts supplied separate authenticated HTTP sessions. Concurrent requests with one wallet idempotency key credited once and created one ledger row; distinct concurrent deposit keys credited twice without a lost update. Balances and ledger counts were reconciled directly against the isolated database. This is not exhaustive multi-process or concurrent checkout coverage.

- Restore investigation on October 5, 2026: a real UI restore returned EPERM while two test servers (4185 and 4173) shared the same temporary database. Stopped only the older test server on 4185, retained the live application on 3000, and reran the complete browser audit against 4173. The run exited 0, including import, restore, cutoff, exports and logout. This failure was reproduced as a test-environment file lock, not silently skipped.
- Strengthened the browser backup/restore checks: wait for the successful backup API response, retain the exact returned filename, download and integrity-check that snapshot, restore that same named row, and verify the restore HTTP response before checking that the post-backup product was removed. This removes ambiguous selection of the first backup row. Remaining coverage limitations below still apply.

- Continued audit: fixed import numeric validation. Malformed balances/prices/costs/counts no longer silently become zero; fractional stock counts are rejected rather than rounded. Invalid rows do not overwrite existing product data. Negative member balances remain supported, while negative credit limits/costs/counts are rejected.
- After this fix: all 178 regression tests across 16 files passed, TypeScript/build/diff checks passed, and the isolated production browser audit passed again (exit 0). Authenticated Chrome login plus an actual `importData.execute` HTTP request rejected a malformed price with one row error and no product insertion. Repeatable check: `scripts/import-validation-smoke.mjs`. This API check is not a clearance of every import UI error/duplicate branch.

- Resumed audit on October 5, 2026: found and fixed missing authentication on `shift.list`, `shift.open`, and `shift.close`. Anonymous requests now fail before opening the store. Three regression tests pass; HTTP requests against the rebuilt production server return 401/UNAUTHORIZED for all three endpoints without changing shift data.
- After this fix: full regression passed 176 tests across 16 files, TypeScript and production build passed, and the existing 35-case production browser audit passed again (exit 0). Repeatable anonymous HTTP checks are retained in `scripts/shift-auth-smoke.mjs`. This does not clear the outstanding permission matrix, concurrency, import-error, hardware or full document-inspection scope below.

- Latest production-build browser regression: 35 checks passed, exit code 0, using the isolated `shop-production-audit-GhIQF1` database. This is coverage of the listed scenarios, not all features or all branches.
- Automatic cutoff now has a server scheduler. A live production server crossed the configured 13:45 cutoff without a user submitting a close; the persisted closure was checked again after another scheduler tick and remained unique. The saved automatic summary was opened through the production UI and its print-media content had nonzero height; PDF evidence is in the temporary production audit directory.
- Automatic cutoff unit coverage: 5 passing cases for boundary inclusion/exclusion, retry uniqueness, missed-day catch-up, remaining period after manual close, sales quantities, a fresh database and manual mode. Final full regression: 173 tests passed. TypeScript and production build passed; the rebuilt production server then passed all 35 browser checks again.
- Repeat regression exposed intermittent first-setup audit ordering: a timestamp captured before password hashing could precede the settings audit recorded later. First-setup audit now timestamps at insertion; complete regression rerun passed after this fix.

- Browser workflow rerun on October 5, 2026; latest run: 32 checks passed, exit code 0, no pageerror events. Detailed results and export directory are recorded in the temporary `audit-results.json`.
- Incorrect and correct login, logout and refresh protection.
- POS cash and verified QR sales; receipt PDF and PNG downloads; print-media receipt content at 58/72/80 mm.
- Member wallet deposit and withdrawal, confirmation, PDF and PNG slips.
- Held bill restored after reload; member registration and card PDF/PNG export; member-balance purchase reconciled against wallet and stock in the database.
- Product creation and editing; receiving purchased and free quantities; stock count; database quantities and costs verified.
- Purchase orders: add, edit quantity and note, reload, CSV/XLSX/PDF export, preview note, remove, add low-stock items and confirm clearing.
- Member statement preview and PDF download; suspend member, reload, reactivate; persisted status verified.
- Stock CSV/XLSX/PDF downloads, spreadsheet parsing, document preview, print-frame content.
- Five reports: sales summary, bill history, member transactions, period stock balance, card balances; CSV/XLSX/PDF downloads.
- User list and settings navigation.
- Staff account creation, disable/enable, login with forced password change, subsequent login with changed password, and rejection of administrative account retrieval.
- Backup creation and download via UI; SQLite file signature verified.
- Import templates for members/products downloaded and parsed.
- Product CSV uploaded and imported via UI; database write verified. Restore via UI removed the imported product; database result verified.
- Cutoff submission, visible print-media slip, saved-summary access after reload and summary PDF download.
- Existing UI smoke passed, including desktop/mobile layout and stock count print document.
- Client tests: 28 passed. Server tests: 140 passed. TypeScript, build and diff whitespace checks passed.

## Scope limitations — not a full-system clearance

- No physical printer, scanner or camera was verified.
- PDF signatures, successful downloads and selected document DOM/layout were checked; every PDF page was not visually inspected or reconciled to every source transaction.
- Representative product creation/editing, receiving/counting/orders, registration/cards and held bills were exercised via UI. All validation/error branches, member deletion/editing, card activation/refund, bulk pricing and lot-specific counts have not been exhaustively exercised. Cashier shift functions were found server-side; no corresponding UI control was found in the inspected source, so this is not cleared as a user-facing feature.
- Multi-role permission matrix and multi-session concurrency were not fully exercised. Closure network-error handling and the actual scheduled cutoff boundary have been exercised, but all network-error branches remain outstanding.
- Import tested product creation and restoration; all member import/error/duplicate scenarios have not been exercised via UI.
- Build reports a large-chunk warning; this is not a failed build.

## Test harness fixes

- UI smoke expected an unrelated product name for DRK-001. Updated expectation to the actual fixture, with optional configuration override.
- Made UI smoke failure logging safe when the document body is absent and allowed configurable base URL.
- Added `D:\Shop-v2\scripts\system-audit.mjs` to retain repeatable browser/download/import/restore checks.
- Replenish DRK-001 only in the isolated temporary fixture when repeated runs exhaust stock. Wait for the product edit form to close rather than requiring its detail card to disappear.
- Added member statement and suspension/reactivation browser checks; evidence JSON now records completion time and the unique export directory.

## Git artifact review (partial)

- Tracked PNG files found are the three application member-photo assets; retain them.
- No tracked PDF, ZIP or SQLite test output was found by the artifact scan. Test downloads remain outside the repository in the temporary evidence directory.
- Keep functional browser/unit tests; they are regression coverage, not disposable artifacts.
- Review of remaining scripts, lockfile changes and the complete changed-file set is still outstanding. This report is not authorization to push or a full-system acceptance certificate.

Tests use a temporary SQLite database and temporary backup directory, not production transaction data.