# Business API permissions review

## Verified changes
- Permission middleware now reads the application role (`appRole`), with legacy admin/user fallback only when that field is absent.
- Stock movement history requires STOCK.VIEW and authentication.
- Receive and purchase-list mutations require STOCK.RECEIVE; stock counts require STOCK.COUNT.
- Member wallet mutations require MEMBER.WALLET; identity/status mutations require MEMBER.EDIT.
- Existing administrator-only product creation inside a receipt batch remains in place.
- Six direct caller tests cover unauthenticated reads, cashier/auditor receive denial, stock-officer reads, auditor wallet/status denial, and a revoked administrator permission.

## Validation
- New tests failed before implementation; all six pass after implementation. Two test inputs were corrected to actual API contracts (stock.rows and wallet type deposit).
- TypeScript: passed.
- Full regression: 261 tests, 33 files, exit 0.
- Production build: exit 0; existing large-chunk warning remains.
- Isolated production-build receive browser suite: exit 0; evidence at C:\Users\Korn\AppData\Local\Temp\stock-intake-audit-q0Qc6u.
- Isolated production-build POS browser suite: exit 0; evidence at C:\Users\Korn\AppData\Local\Temp\pos-transactions-audit-4YWzU7.
- git diff --check: passed.

## Remaining scope
This is not a complete authorization audit. Other routes, role-specific UI availability, concurrent transactions, multi-page documents, backup/restore, and production proxy configuration still require verification. Browser suites above verify administrator cross-module regression, not every role's UI. No production data change, push, or deployment was performed.