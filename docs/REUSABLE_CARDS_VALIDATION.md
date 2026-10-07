# Reusable card implementation — local work in progress

## Implemented
- Separate physical card inventory and assignment history.
- Backfill existing member card references on database initialization.
- Register using an existing blank/returned card; block unknown, lost, damaged or assigned cards.
- Return detaches card without changing member number, wallet balance or financial transactions.
- Reuse assigns the physical card to a new member; money does not follow the card.
- Registration UI shared by Members/POS no longer automatically prints a member card.
- Card inventory controls in Members; front-office/back-office navigation grouping preserves existing permissions.

## Evidence
- TypeScript and production build passed (existing bundle-size warning remains).
- Full regression: 193 tests passed across 19 files.
- Actual HTTP requests against isolated production server on port 4197: login, add blank card, register with 25 initial balance, duplicate registration rejected, return, reuse, and anonymous return denied.
- Read-only database reconciliation: original balance remains 25, new member balance is 0, member numbers differ, original card is detached, new member holds it, three assignment events exist.
- Browser test attempted repeatedly but installed Chrome exited before page creation. This is not a successful UI test.

## Not accepted yet
- Browser operation and visual layout, full updated registration/export regression.
- Existing-member card replacement, CSV card intake and assignment history screen.
- Import/member-card edit integration, legacy duplicate handling and concurrent sessions.
- Lost/damaged role matrix and physical scanner testing.

Changes remain local. No commit/push or production readiness claim.