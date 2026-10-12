# Customer test release — 2026-10-12

Scope: registration alerts, isolated receipt printing at 58/72/80 mm, one member card action entry labelled ขอลดวงเงิน, stable transaction preview, member card downloads without direct printing, and complete sales history by default.

Validation:
- TypeScript and production build passed (existing bundle-size warning remains).
- Regression: 263 tests passed in 33 files; exit code 0.
- Registration alert browser review passed on an isolated database.
- Receipt print browser review passed at 58, 72 and 80 mm. The test intercepts window.print, verifies document content and paper CSS, and checks afterprint cleanup. It does not verify physical printer output.
- Card create/assign/refund/return browser review and database reconciliation passed.
- Balance report browser review passed.

Evidence directories:
- C:\Users\Korn\AppData\Local\Temp\isolated-review-De95Eo
- C:\Users\Korn\AppData\Local\Temp\receipt-print-KVSYrC
- C:\Users\Korn\AppData\Local\Temp\receipt-print-USxGNv
- C:\Users\Korn\AppData\Local\Temp\receipt-print-fiCfbx
- C:\Users\Korn\AppData\Local\Temp\shop-card-actions-q1lTrO
- C:\Users\Korn\AppData\Local\Temp\balance-report-GffaOS

No database restore, product image import or production financial transaction is included. Printer selection is per browser/workstation. Without a working local helper, the browser print dialog is used and the operator chooses the printer. Physical paper output must be checked at the customer's workstation.