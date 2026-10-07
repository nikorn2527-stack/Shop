# Cost/profit and sales-value reporting

Status: design and isolated calculation foundation only; not wired into checkout yet.

## Separate purposes
- Cost/profit: net actual sales revenue minus historical cost of units sold.
- General sales reports: actual net sales amounts, independent of acquisition cost.
- Inventory at selling price: clearly label retail valuation; current selling price is not a historical sale or accounting carrying amount.
- Receipts/purchases during a period are not all cost of sales when goods remain unsold.

## Proposed costing policy
Moving weighted average using remaining quantity and inventory value in integer satang.
Purchased and free quantities enter the same cost pool; paid receipt value enters once.
Never reconstruct inventory value from a displayed two-decimal average.
Each issue saves allocated cost amount; final issue consumes the residual value.
Historical sale cost snapshots remain immutable. Lot picking/expiry policy is separate from valuation policy.

## Required integration (not completed)
1. Preserve exact paid receipt amount from UI/API instead of only rounded unit cost.
2. Persist inventory quantity/value and each sale cost allocation atomically.
3. Allocate bill discounts to sale rows with residual reconciliation.
4. Handle sale reversals, returns, counts, imports and manual cost changes as explicit valuation events.
5. Reconcile opening value + receipts + adjustments - issued cost = closing value.
6. Split cost/profit page from unrelated report tabs; reuse date controls and document templates.
7. Validate daily/monthly/custom-period exports against saved allocations.
8. Baseline legacy stock explicitly; flag uncertain historical values instead of silently rewriting old bills.

Example: 100 baht / 22 units must allocate exactly 10,000 satang across all issues,
not 4.55 baht * 22 = 100.10. Later receipt values mix with residual value.

Accounting review required: agree treatment of purchase discounts, freight, tax,
returns, shrinkage and opening valuation with the customer's accountant before acceptance.