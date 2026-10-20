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

Both receiving entry points use the same two-pane desktop layout: a 360px form
pane on the left and a wider receipt review on the right.
Scanning a known code fills the product details in the form and loads the
last documented cost and current selling price. An unknown barcode opens new
product fields in that same form, preserving the scanned code. Name, category,
unit, optional size, selling price, quantities, paid amount, lot and expiry can
be entered without opening a second dialog. Adding the row queues it only.

Queued rows show a compact summary; their Edit action enables direct edits to quantities, amount, price, lot and expiry.
The totals and receipt unit cost update immediately. Product creation, receipts,
catalog price changes and audit logs commit in one transaction after whole-batch
confirmation. Cancellation writes nothing. An unfinished row blocks submission.
Any invalid entry or stale price rolls back the batch. Conflicting prices for the
same product are rejected; only administrators can create products or reprice.
Small screens scroll inside the table rather than widening the page.

Validation: stockIntake tests cover historical-cost context, free units, zero/unknown
cost, same-label receipt separation, immediate increases and reductions, immutable
old sales and atomic failure. API permission tests cover receiving without repricing.
`scripts/receiving-pricing-smoke.mjs` uses a fresh /tmp database to exercise actual
forms, quantity edits, new-product queuing, warnings, cancel/confirm, desktop/mobile
review and unchanged historical sale snapshots.
