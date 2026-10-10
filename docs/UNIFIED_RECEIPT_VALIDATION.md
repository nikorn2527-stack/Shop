# Unified product creation and stock receiving

## Implemented
- Existing products and new product drafts can be received in one batch.
- Scanning/selecting an existing item immediately adds an editable receipt row; no separate add-to-list step is required.
- New product drafts also enter the same table immediately. Quantity Enter advances to payment; payment Enter returns to scanning.
- New products are prepared inline; database creation waits for batch submission.
- Required fields are visible; optional Lot, expiry and product metadata are collapsible.
- Receipt rows expose separate quantities, payment values, expiry and supplier Lot codes.
- Missing Lot codes receive a server-generated daily sequence.
- Row validation errors appear inside the receiving dialog without discarding rows.

## Browser verification
Run `node --import tsx scripts/receive-rows-smoke.mjs` from `D:\Shop-v2` after building.
The script backs up the local database into a temporary directory and starts a separate production server. It does not write to the source database.

Verified:
- Existing item: 3 units, payment 15 baht, supplier Lot `ROW-LOT-001`.
- New item: 4 units, selling price 25 baht, payment 40 baht, unit cost 10 baht.
- Invalid quantity in row 2 blocks the entire submission; neither original stock nor new product is changed.
- Corrected batch saves both items; database stock, lot values, calculated costs and receiving operator match.
- Database integrity check returns `ok`; application reload succeeds.
- Mobile dialog stays within 390px; its wide receipt table has internal horizontal scrolling.

Not certified by this test: physical scanner, printer, all optional product modes, or all application features. Changes remain local until explicitly released.