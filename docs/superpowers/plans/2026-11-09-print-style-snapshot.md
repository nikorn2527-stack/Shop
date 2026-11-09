# Preserve slip styles across deployments

## Reproduction and cause
A tab opened before a production deployment retains its loaded stylesheet, but its print iframe requests the old hashed stylesheet URL again. After that asset is removed, the server serves its HTML fallback at the CSS URL. The parent page still looks correct while the receipt prints with default fonts, inline labels and no alignment or rules. Development tests using inline Vite styles did not cover this production stale-tab case.

Verified the old production CSS URL returns HTML while the new CSS returns text/css. A production-build browser reproduction showed the parent receipt brand remained display:flex/Sarabun, while its print document became display:block/Times New Roman when the stylesheet disappeared. The user also confirmed Ctrl+F5 restores printing from the original bill without another sale.

## Fix
- Snapshot loaded CSSOM rules, in document order, into the print document instead of refetching the application's hashed stylesheet URLs.
- Preserve media restrictions and live CSSOM changes; skip disabled sheets. Keep the original link for cross-origin stylesheets that the browser will not expose to CSSOM.
- Apply the same snapshot in receipt and shared wallet-slip canvas clones; wait for their fonts before rendering PDF/PNG. This fixes the same failure independently reproduced in downloads.
- No backend, database, schema, financial transaction, balance, stock, receipt-number or printer-profile changes.

## Verification
- Reproduced native fallback with the real production CSS file, then made the old asset unavailable. After the fix the printed document retains flex layout and Sarabun with no application stylesheet refetch.
- Actual ReceiptModal: 58/80mm, fresh/stale CSS, PDF/PNG downloads and helper HTML rendered to PDF. Amounts, address, enlarged member name and styling retained. Canvas dimensions remain within 3% of the fresh render rather than expanding to an unstyled page viewport.
- 721 tests in 96 files passed; TypeScript, build and diff checks passed.
- All browser documents use synthetic receipts, mocked print metadata and intercepted helper output. No real sale or wallet mutation was used.
