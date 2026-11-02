# Confirmed provisional opening balance

The owner confirmed that the previously blank G100 opening balance is500, replacing the provisional zero used at import. This is an opening-liability correction, not a new deposit and not a database restore.

The one-time startup correction locates the row through the original import batch, workbook and source row. No person name or card number is hardcoded. It requires the original card still assigned, an active unclosed member and card session, no sales or member transactions for that member, and both current and opening balances still zero. Otherwise it records needs_review and changes no money. It rechecks under a write lock after a full native safety backup and rechecks the migration marker for concurrent startup.

On success only the target balance and session opening balance become500. Original source provenance remains, supplemented by a confirmation field. A non-financial audit entry and one-time marker commit atomically with the correction. No deposit/withdrawal/sale row is created, no historical receipt is changed, and no other account, balance, product or password is altered. Public health exposes only applied/needs_review/not_applicable, without identities or amounts, to verify deployment safely.

Tests cover idempotency, existing activity, changes during backup, concurrent startup, closed accounts, wrong import batches, backup failure and audit rollback. A private restored-copy rehearsal included a deposit on a different member: the financial transaction rows, other member balance, stock/price/cost and account/password rows stayed identical while the target opening balance changed to500. The imported-cohort opening total becomes104808; current running balances can differ because real operations have started.
