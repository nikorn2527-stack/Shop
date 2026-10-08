# Card return policy validation

Returning a card while retaining the member balance is no longer supported.

- Positive balance: refund the entire balance and release the card.
- Zero balance: release the card without creating a money transaction.
- Negative balance: reject the return until the outstanding balance is resolved.
- The card.return API accepts only refund mode. Unsupported modes are rejected.
- The direct card.release path rejects any nonzero member balance.
- Atomic card replacement remains supported: the member retains their money and receives a replacement card in the same transaction. This is not a return without a card.
- Existing historical records are not rewritten.

Validation on an isolated database and production build:

- TypeScript check passed.
- Production build passed.
- Regression: 222 tests passed across 24 files, exit code 0.
- Chrome browser audit passed, exit code 0: full refund of 45, card release, reload, assignment of a generated card to the same member with zero balance, zero-balance return, exactly one refund transaction, and SQLite integrity check.
- Tests reject direct release with a positive balance and the removed keep_balance mode without changing the member balance or card binding.
- Browser evidence: C:\Users\Korn\AppData\Local\Temp\shop-card-actions-8C01z1

These changes are local; no deployment or live database mutation was performed for this validation.