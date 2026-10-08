# Customer test update — 2026-10-08

This release includes all current application changes, not the local database.

## Included
- Card number generation, compact inventory and modal usage history.
- Shared card return/issue form; full refund and return without manager approval.
- New card issuance is rejected while the member still holds a card.
- Member registration card input first; clearer labels.
- Member search results remain visible and scrollable in selection dialogs.
- Visible member confirmation button and two-column POS quick products.
- Settings success/error popups, persistent unsaved changes controls.
- Stock count sheet narrower margins and wider barcode column.

## Verification
- TypeScript and production build passed.
- Vitest reported 223 tests passed across 24 files. Terminal integration closed after the summary.
- Production-build browser scripts reported PASS for search/confirmation/POS columns,
  settings save success and simulated failure, and card creation/return/issue/history.
- All browser writes used isolated database copies.

## Data and limitations
- Railway data is managed separately by the owner; no database restore is part of this release.
- Database migrations run at startup; take a Railway backup before deploying.
- Private input lists, backup files and destructive preparation scripts are not committed.
- Unified product name + size display across all reports/exports is still pending.
- Missing product costs must be supplied before relying on profitability figures.
- This is a customer testing release, not a claim of complete production certification.