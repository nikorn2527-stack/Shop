# Shared card actions: local validation

## Implemented
- Shared member card action dialog used by POS and member details.
- POS shortcut is configurable using the `card` shortcut key in settings.
- Return explicitly distinguishes refunding the full balance from retaining it with the original member.
- Existing members can receive a vacant card without changing their member number or balance.
- Replacement validates the expected previous card and holding session, and rolls back on failure.
- Server rejects returning a card using a previous holder's session.
- Lost/damaged replacement status requires administrator access at the API.

## Verified
- TypeScript and production build passed.
 Full regression: 222 tests passed in 24 files for the card-generation changes.
- New tests cover replacement rollback, stale sessions, balance retention, full refund and separation between holders.
- Chrome on isolated production server: POS shortcut opened member selection; member card-code search returned an existing member; no JavaScript exception observed in these steps.
- `scripts/card-actions-smoke.mjs` submits shared card actions through Chrome against a fresh temporary database copy and an isolated production server. Verified retaining a 45-baht balance when returning the card, assigning another card to the same member after reload, refunding 45 baht and returning that card, exactly one refund transaction, closure of the original holding round and SQLite integrity. No JavaScript exception observed.
- No live database changed and no commit/push/deploy performed in this round.

## Card generation browser verification
Before this checkpoint, the expanded Chrome test passed twice on fresh temporary database copies:
- Generated two batches of two cards: `BROWSER-00001` through `BROWSER-00004`, with no duplicates.
- Registered external code `EXTERNAL-123456` as a blank card.
- Verified generated card status and creator in SQLite after reloading.
- Assigned `BROWSER-00001` to the existing member while preserving the 45-baht balance, then refunded and returned it; exactly one refund was recorded.
- SQLite integrity check returned `ok`; no JavaScript exception occurred.
- Evidence: `C:\Users\Korn\AppData\Local\Temp\shop-card-actions-qyJQAu` and `C:\Users\Korn\AppData\Local\Temp\shop-card-actions-v5zwzp`.
- This did not exercise a physical scanner, printing the generated codes, mobile inventory layout, or all concurrent-generation scenarios through the browser.

## Not yet complete
Latest resumption verification: the isolated production-browser test passed again on a fresh copy at `C:\Users\Korn\AppData\Local\Temp\shop-card-actions-mvCD6g`. TypeScript and diff check passed. The regression log reported 222/222 tests passing in 24 files; the terminal wrapper subsequently reported closure, so its exit status is not used as proof of a clean test-process exit.

- Browser replacement of an already assigned card, zero-balance returns, lost/damaged handling, and mobile layout. Basic return/assignment/refund submissions and reload reconciliation are verified above.
- Unified lost/damaged selection in the shared dialog.
- Session validation for every card-originated sale and wallet request (not only card actions).
- Sale reversal attribution to the original holding round after the card has been reassigned.
- Full configuration hide/show test for the new shortcut.
- Retry handling of the new return endpoint after a successful response is lost.
- Rich per-type usage summary and consistent card inventory entry points.

This is an implementation checkpoint, not production sign-off.