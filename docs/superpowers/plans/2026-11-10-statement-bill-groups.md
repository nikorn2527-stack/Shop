# Group statement products under their bill

User requested that the รายการเดินบัญชี detail list show each bill's products underneath that bill for easier reading.

- Preserve transaction and original bill-item ordering.
- Use the existing report groupStartRows presentation: a bold bill/transaction header with its date, reference and card movement, followed by bullet-marked product rows.
- Product rows omit repeated date/reference values and retain quantity, unit price and line total. No card movement or balance is repeated on product rows.
- CSV and Excel keep the same grouped row order as preview, PDF and print. No server, schema, stored financial values or application CSS changes.
- Regression tests first failed, then passed for two bills with multiple products, correct contiguous child rows and unchanged incoming/outgoing totals.
- Full suite: 728 tests in 97 files passed; TypeScript and build passed.
- Browser on the isolated demo: 26 transaction groups, 24 bills and 66 product rows correctly associated, with no extra card movements. CSV/XLSX/PDF, repeated print, date filtering, mobile and single-line identifiers/product names passed. Business tables remained identical before/after. Four-page A4 PDF manually inspected, including subsequent pages beginning at bill headers.
- All examples are synthetic and private, outside Git. No production test transactions created.
