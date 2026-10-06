# Customer preview — 2026-10-06

This revision is for customer acceptance testing, not certification that every production workflow is defect-free.

## Latest request verified

- Unsaved-settings undo button has readable Slate text; edits persist until save/discard.
- Collapsed sidebar icons are 22px and centered, including when a low-stock badge exists. Badges are positioned separately from the icon.
- POS shortcut label is “เพิ่มสินค้าใหม่”.
- `scripts/customer-preview-ui-smoke.mjs` passed against a freshly started production build with an isolated test database. It checks actual layout, label, computed text color and discard behavior.
- TypeScript and production build passed. Build retains the large-bundle warning.
- Regression: 190 tests passed across 18 files after the final CSS fix.

## Limitations

Review `PENDING_USER_TASKS.md` before production deployment. Outstanding checks include full role/concurrency coverage, physical printers/scanners, full multi-row checkout reconciliation and remaining shared registration/ledger requirements. Some checklist entries describe earlier implementation stages and require reconciliation with the newer audit documents; do not interpret them as acceptance.

No live customer transactions were created by the latest UI check. Runtime databases, credentials and downloaded artifacts are not included in this preview commit. Local helper instructions and the obsolete one-off palette rewrite script are intentionally excluded.