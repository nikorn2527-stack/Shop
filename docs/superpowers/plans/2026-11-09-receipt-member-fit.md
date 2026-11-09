# Fit member identity on receipts

User reported that the enlarged member name plus number overflowed onto another line on a real printed receipt.

- Reduce the receipt-only member name from 15px to 12px bold, retaining the full name and safe wrapping for unusually long names.
- Remove the generated สมาชิก prefix and keep the member number on its own clearly labeled row. General customers do not get an empty member row.
- Use scoped inline presentation so the global stylesheet asset remains unchanged for open production tabs. No member records, balances, receipt data or other member screens change.
- Added identity tests failed before implementation and now verify the name and member number are separate, with no duplicate prefix or empty guest row.
- Production-CSS browser tests: 58/80mm native print, PDF/PNG, fresh and unavailable old stylesheet, 12px name fitting a representative full-name fixture on one line, no overflow, and separate complete member reference. Existing header alignment/time regression also passed.
- Full suite: 727 tests in 97 files passed. TypeScript and build passed. Synthetic receipts and mocked print metadata only; no real financial transactions.
