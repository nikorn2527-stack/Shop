# Stock receiving history validation

Date: 2026-10-06

## Implemented

- Stock screen receiving history with today/date range, product/SKU/Lot and operator filters.
- New receiving lines linked to Lot records with immutable received quantity, original line cost and operator.
- Purchased and zero-cost/free lines reported separately.
- Unknown historical operator and purchase value are not inferred from current average cost.
- Document preview and CSV/XLSX/PDF export.
- Cutoff summary export buttons use vertical layout.
- Shared Excel icon uses Phosphor FileXls.

## Verified

- TypeScript check passed.
- Full unit regression: 190 tests passed across 18 files.
- Production build passed; large-bundle warning remains.
- Browser login and receiving history search on isolated temporary database passed.
- Fixture: 10 purchased units at 5 plus 2 free units. Preview showed 12 units and total cost 50, with operator and Lot.
- Actual CSV/XLSX/PDF downloads passed. CSV and Excel contents contain the filtered Lot; Excel contains a header and two receiving rows. PDF header is valid. Preview was inspected visually.
- Mobile horizontal overflow check passed at 390px.
- No browser pageerror in the tested receiving history path.
- Download test now uses a fresh directory per run to avoid mistaking existing filenames for missing downloads.

## Not yet verified

- The temporary receiving-history fixture has no saved cutoff summary. The attempt to verify live cutoff export-button geometry stopped at the missing-summary assertion. Vertical CSS is implemented, but this is not recorded as a passing end-to-end cutoff test.
- This browser run seeds receiving lines through the store API; it does not validate submitting the receiving form itself.
- Physical printing and all PDF pages for large datasets were not tested.

No production-readiness or whole-system 100% claim is made from this validation.