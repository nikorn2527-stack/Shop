# Slip originals and copies Implementation Plan

**Goal:** Keep slips open for repeat printing, mark subsequent dispatches สำเนา, and let downloads choose ต้นฉบับ or สำเนา.

**Architecture:** Resolve sale numbers, wallet request IDs and returned-card sessions to durable document keys. Store an idempotent print-dispatch counter and authenticated actor in a dedicated store_settings namespace. Financial rows remain untouched. Browser print cancellation cannot establish physical output; counts describe requests, never confirmed paper.

**Tech Stack:** SQLite, tRPC, React, existing print/export helpers.

## Constraints and rollout
- Local/test branch only; no Railway deployment or production database replacement.
- First dispatch of a new document is original; later dispatches are copies, including after reopening or on another terminal.
- Existing documents predate tracking and default to copy conservatively.
- PDF/PNG selection does not increment printing counts.
- Failed metadata requests block printing and retain the UUID for an idempotent retry.

## Tasks
- [x] Add backend tests for durable counting, aliases, legacy documents, request retries, invalid references, and untouched financial rows; verify they fail before implementation.
- [x] Implement document resolver/counter and authenticated printing.issue endpoint using existing settings storage; initialize rollout boundary once.
- [x] Add shared slip controls/hook, document references and copy label to sales, wallet and legacy card-return slips. Await version changes before print capture; preserve manual exit.
- [x] Verify focused and full tests, TypeScript, build, browser print/reprint/download behavior and financial invariance. Update this plan with results.

## Verification
- Full suite: 92 files / 697 tests passed; the subsequent numeric-session alias regression brings focused print tests to five, all passed.
- TypeScript and production build passed. SQL alias normalization was subsequently type checked and covered by the focused print tests.
- Browser on an isolated transaction-demo database: new wallet document issued ordinals 1,2,3,4 across the live slip, report receipt and reopening. First original; all subsequent copies. Manual close behavior retained.
- Lost response after committed metadata: retry reused the UUID and original ordinal, without submitting a print job while metadata failed.
- PDF and PNG downloads verified for both choices; downloads did not increment print count. Copy filenames carry -สำเนา.
- Business tables (members, member_transactions, sales, sale_items, products, stock_lots) matched exactly before/after printing and exporting. Synthetic deposit occurred only in the separate demo workspace.
- Auth and actor tests passed; database reopen and separate-connection counting passed. No Railway deployment or production data access.

## Operational meaning
Counts describe print-dispatch requests. Browser cancellation, printer failure or closing the system print dialog cannot prove whether paper was emitted; subsequent deliberate requests are conservatively marked copy. Documents that predate tracking are treated as copies on printing because no historical print evidence exists. Download selection remains explicit and does not change financial history or dispatch count.
