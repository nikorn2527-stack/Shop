# POS autonomous review — 2026-10-10

## Scope and safety
- Reviewed POS sales only, following `D:\Shop-v2\.clinerules`.
- Browser automation used the existing Puppeteer scripts and isolated temporary SQLite fixtures. No deployment or production database changes were performed.

## Confirmed fix
- `D:\Shop-v2\client\src\pages\Pos.tsx`: retain the checkout request ID for retries of an unchanged payload after an ambiguous network failure; clear it on success. Added an immediate submission guard against repeated confirmation and corrected the error message so it does not falsely claim an unconfirmed sale was never saved.
- `D:\Shop-v2\scripts\pos-transactions-smoke.mjs`: added a lost-response test that allows the server to commit, throws a client network error, retries through the actual payment UI, and verifies the sales count and stock change only once.
- `D:\Shop-v2\scripts\pos-layout-audit.mjs`: audit quantity values directly and distinguish hidden menus and clipped scroll content from genuinely covered controls.

## Verification
- TypeScript: `npm run check` — passed.
- Production build: `npm run build` — passed with a Vite large-chunk warning; not a zero-warning build.
- Regression: `npm test -- --pool=forks --maxWorkers=1 --minWorkers=1` — 29 files, 237 tests passed.
- POS layout audit — passed at 1902x951, 1440x900, 1366x768 and 390x844, including cart quantity editing and multi-row access.
- POS transaction browser smoke — passed: cash, QR verification, member-account balance, held-bill restoration, PDF/PNG downloads, SQLite integrity, and lost-response retry without duplicate sale/stock deduction.
- Evidence: `C:\Users\Korn\AppData\Local\Temp\pos-layout-audit-wPlAFs` and `C:\Users\Korn\AppData\Local\Temp\pos-transactions-audit-SI7Boo`.

## Limits
### Follow-up: catalog category semantics
- The initial review tested filter mechanics but missed incorrect catalog classification. Local records stored ice (`น้ำแข็ง`) under supplies and coffee cups (`ชุดแก้วกาแฟ`) under drinks.
- Corrected these exact local records only: ice to food (`อาหาร`), coffee cups to supplies (`ของใช้`). The correction script backs up the local database before changes, uses the existing product-update path, verifies all other product fields are unchanged, and checks SQLite integrity. No production database was changed.
- POS category tabs now derive from catalog categories rather than a fixed four-category list, exposing existing personal-supplies and ice-cream categories too.
- Verification: 30 test files / 239 tests passed; TypeScript and production build passed (large-chunk warning remains). Browser tests passed category semantics/filtering, multi-row scrolling, cash/QR/member payments, held bills, exports, and lost-response retry.
- Latest screenshots: `C:\Users\Korn\AppData\Local\Temp\pos-transactions-audit-OhsBsF\catalog-categories.png`; layout evidence: `C:\Users\Korn\AppData\Local\Temp\pos-layout-audit-bHR4q4`.
- These checks verify the two confirmed misclassified products and category filtering; they do not certify the business classification of every catalog item.

### Follow-up: unify supplies categories
- Combined local personal/household supplies into `ของใช้`, with a database backup and verification that other product fields (including SKU, price and stock) did not change. Local catalog now has 73 products in the unified supplies category.
- Shared category normalization merges legacy names in the stock add/edit forms, POS filters and printed stock-count grouping. Existing SKU prefixes remain unchanged.
- Verification: 30 test files / 240 tests passed; TypeScript and production build passed (large-chunk warning remains). Browser smoke passed unified add-product options, catalog filtering and POS transactions; layout audit passed.
- Corrected the browser test to close the add-product form using its actual Cancel button instead of assuming Escape support.
- Evidence: `C:\Users\Korn\AppData\Local\Temp\pos-transactions-audit-b78eGW\stock-unified-categories.png` and `C:\Users\Korn\AppData\Local\Temp\pos-layout-audit-QIlp14`.
- No deployment or production database changes were performed.

- No claim of 100% correctness for every device or untested path. Physical barcode/camera/printer hardware and real payment-provider settlement were not verified.
- Retry protection added here is retained in component memory: it does not survive a page reload and only reuses the key when the payload is unchanged. Check sale history before changing or abandoning a bill after an ambiguous network failure.
- Existing unrelated working-tree changes were not reverted. Full-tree whitespace checking reports existing trailing whitespace in `D:\Shop-v2\client\src\layouts\AppShell.tsx`; scoped review files pass whitespace checking.