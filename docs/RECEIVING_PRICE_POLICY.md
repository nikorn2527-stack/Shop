# Receipt costs and selling-price changes

Receiving shows the cost of the last documented receipt, current catalog selling
price, and this receipt's unit cost. Unit cost is actual amount paid divided by
purchased plus free units; it is not guessed from the selling price. Unknown
historical receipt costs remain unknown, while a documented free receipt costs
zero. A receipt-group identifier keeps purchased/free lines together and prevents
repeated manual lot labels received in the same second from mixing histories.
Legacy receipts without that identifier are grouped by lot label and timestamp.

Administrators may enter a new selling price while receiving a unit-priced
product. A blank field keeps the current price. Tier-priced products continue to
use the product editor for their price tiers. The confirmation lists price changes
and warns about reductions. After confirmation, the new price applies to all
remaining units of that product, irrespective of receipt lot. There is no deferred
price scheduler and no requirement to finish an old lot before changing prices.

Reducing prices can still be profitable; compare the new price against existing
lot costs. Raising prices does not by itself guarantee a profit if new costs are
higher still. The form warns when the effective selling price is below this
receipt's unit cost. Unknown remaining-stock cost is identified explicitly.

Checkout continues to consume lots in earliest-expiry order, then receipt date
and id, and snapshots each sale's price and exact allocated cost. Receiving or
changing prices does not rewrite historical sale prices, costs or allocations.
The catalog's weighted average cost remains a separate existing calculation.

New-product receipt quantities, free units, actual amount, lot and expiry can be
entered in the new-product dialog. Its button queues the entire entry immediately.
Product creation, receipts, catalog price changes and audit logs commit in one
transaction after the whole-batch confirmation. Cancellation writes nothing. Any
invalid entry or stale price rolls back the batch. Conflicting prices for the same
product are rejected; only administrators can create products or reprice them.

The receipt review uses one row per entry across the workspace: product/code,
purchased/free quantities, actual amount, previous and new unit costs, final
selling price, lot, expiry, and edit/remove actions. Small screens scroll inside
the table rather than widening the page.

Validation: stockIntake tests cover historical-cost context, free units, zero/unknown
cost, same-label receipt separation, immediate increases and reductions, immutable
old sales and atomic failure. API permission tests cover receiving without repricing.
`scripts/receiving-pricing-smoke.mjs` uses a fresh /tmp database to exercise actual
forms, quantity edits, new-product queuing, warnings, cancel/confirm, desktop/mobile
review and unchanged historical sale snapshots.
