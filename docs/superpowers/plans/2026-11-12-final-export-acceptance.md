# Export document acceptance implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, with a final independent review.

**Goal:** Apply the approved document standard and deliver every available export as review artifacts before production deployment.

**Architecture:** One A4 document frame reserves consistent brand/title/period/meta positions and uses 14mm margins. Dense tables use a smaller consistent font and explicit protected identity/date/quantity/money columns. Preserve all business rows, raw LOTs, amounts and member identities.

**Spec:** User-approved column rules and fixed visual anchors; evidence /workspace/private/column-wrap-audit-20261112/ผลตรวจคอลัมน์.md.

## Constraints
- No production deployment/merge, database upload, migration or historical business-data edit.
- Existing review branch only; exclude private technical profile documents and all QA databases from git.
- A4 portrait,14mm margins; no ellipsis/truncation of identities, names or values.
- Few columns use normal text; dense columns may reduce table text consistently before allowing name/detail wraps.
- Slips retain thermal profiles; no card numbers/copy labels; preserve manual finish and no duplicate money operations.

## Tasks
- [x] Test and implement consistent A4 anchors, separate heading/body wrapping, dense table sizing and 14mm A4 print-helper margins.
- [x] Apply tested column policies to every report/stock/member table; verify all loaded protected cells stay single-line without overlap.
- [x] Inventory every export entry, export current PDF/CSV/Excel/images where available, capture print-only forms, and provide an indexed review pack with explicit unavailable formats.
- [x] Full tests,TypeScript,build, fresh independent review and read-only business snapshots; save changes on review branch only.

## Review focus
Legacy hyphenated receipt references;13-digit cards/barcodes;OPEN lots;quantity+Thai units;large money;long member/product/staff names;no-period/no-meta forms;statement intentional detail lines;thermal slips and print-only cards/count sheets.

## Verification and delivery
- Full755 tests/102files,TypeScript and production build passed after final code changes.
- Actual Chromium layout checks:21 A4 export datasets, protected cells stay single-line without cell overlap, all brand/title/table anchors match (52.91/119.16/265.16px at A4 preview). Long unbroken names30/110chars stay inside688.1875px safe width (RED/GREEN).
-21 CSV/Excel pairs have identical row/value matrices and preserved leading zeros.21 PDFs retain checked identities/numeric values and expected model rows.
-10 isolated slip cases keep documents open after PDF/PNG/two prints; financial tables unchanged by document actions.
- Independent reviewer found auto-layout long-name overflow; corrected and independently rechecked clean.
- Delivery:46 document/variant entries,45 PDFs(122 source pages),21 Excel,22 CSV,11 PNG, indexed ZIP and combined all-pages PDF. Print-only samples come from actual captured print HTML; no physical printer used.
- Artifacts and QA databases remain outside git under /workspace/private/final-export-acceptance-20261112/. No production merge/deploy/database upload. No migration or business-operation code changed.

- Grand-total footer repeats prevented: actual202-row multipage PDF verified footer occurs once, compared with6 occurrences before fix.
