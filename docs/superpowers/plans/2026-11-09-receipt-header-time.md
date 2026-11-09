# Receipt header and time layout

User requested readable bill-header ordering and a time that does not leave น. alone on another line.

- Show organisation, street address and contact lines as separate blocks; split telephone/fax lines without altering saved settings. Preserve explicit line breaks and infer an organisation/street separation only for the first flat line with a street-number marker.
- Show receipt reference, Bangkok Buddhist date and full time on three full-width rows, with values aligned right and kept together. Do not renumber or alter any receipt data.
- Use inline styles scoped to this receipt markup. The application CSS asset is unchanged, so currently open tabs continue using the same stylesheet while the updated markup loads on refresh.
- New date/address tests first failed before their helper existed. A browser check exposed the grid retaining an intrinsic column width; one explicit 1fr track now makes all three rows span the receipt content width.
- Production-CSS browser tests cover 58/80mm, native/helper output, PDF/PNG with both fresh and unavailable old stylesheet URLs, complete contact numbers, single-line number/date/time and right alignment.
- Full suite: 97 files / 725 tests passed. TypeScript and production build passed. Synthetic receipts only; no backend, stored settings, database or financial changes.
