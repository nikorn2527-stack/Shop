# Monthly Buddhist receipt numbers

User request: new sale receipts use Buddhist year (last two digits), month (two digits), sequence (four digits). Example November 2569: 69110001. Implementation assumption stated to the user: no RC prefix/separators, monthly sequence reset, old receipt numbers retained.

- [x] Test new numbering, daily continuity, Bangkok month/year rollover, idempotency, legacy preservation, existing/voided monthly maxima and four-digit exhaustion.
- [x] Replace only the live checkout number generator. Read the highest exact eight-digit number for the Bangkok month; allocate inside the existing checkout transaction and existing unique order-number constraint. No schema changes or historical renumbering. Refuse overflow rather than silently changing the four-digit format.
- [x] Run focused/full tests, TypeScript and build; verify real receipt rendering and repeat-print metadata using simulated data only.
- [x] Commit/push the test branch. Do not merge main, deploy Railway, restore Local over production, or change any existing financial records.

## Results
- New monthly numbering tests failed against the original daily RC generator before implementation, then all eight passed.
- Full suite: 93 files / 707 tests passed. TypeScript and production build passed. Scanner search regression also passed separately.
- Browser verification used a synthetic cash sale in the separate demo database: 69110001 appeared on the receipt, both print dispatches and PDF/PNG filenames; first original and second copy. No browser runtime errors.
- No schema migration, historical renumbering or production access. Settings font-size sample now illustrates the new format; historical search fixtures retain the old format to verify compatibility.
