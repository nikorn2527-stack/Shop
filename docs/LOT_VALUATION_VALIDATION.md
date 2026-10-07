# Lot valuation implementation — local verification

## Implemented
- Receipt paid amount is recorded in integer satang and allocated across purchased/free receipt lines without losing residual value.
- Checkout records sale-item/lot quantities and allocated cost; dated lots are consumed before undated lots (expiry, receipt time, ID).
- Tracked valued-lot shortages reject checkout with transaction rollback.
- Void restores the original lot quantity and allocated value; repeated void is rejected.
- Daily/product/category/cashier cost expressions prefer recorded sale-item cost, with legacy fallback. Dated aggregates exclude voided bills.
- Lot-count shortages create separate value adjustments. Valued surpluses require a separately valued receipt rather than inventing a purchase value.

## Verified locally
- TypeScript check passed.
- 206 tests passed across 22 files.
- Production build passed (existing bundle-size warning remains).
- New database execution tests: 100 baht/22 units including gifts; 60 baht/10 units second receipt; cross-lot sale of 25 units costs exactly 118 baht and leaves 42 baht; void restores 160 baht; repeated void does not change value.
- Selling all 22 units separately allocates exactly 10,000 satang.
- Count-loss value plus remaining value reconciles to receipt value; unvalued surplus is rejected without changing value.

## Not yet accepted as complete
- Browser receipt/checkout/count/void/export round-trip on the latest production build has not been executed for this implementation.
- No per-sale lot-allocation drilldown UI/API yet.
- Legacy bills without lot allocations cannot be restored to an invented original lot; explicit legacy reversal handling remains necessary.
- Import, product deletion/lot deletion, stock-count surplus UX, financial reports with discounts/multi-item cashier aggregation, and concurrent sessions need additional verification.
- Existing receipt-history line values and export semantics need reconciliation with allocated gift costs.
- Product-level displayed average still includes legacy estimated opening value; it is not an authoritative per-lot purchase valuation.
- No live database migration, commit, or push was performed in this verification.

These results do not certify full-system production readiness or accounting-policy approval.