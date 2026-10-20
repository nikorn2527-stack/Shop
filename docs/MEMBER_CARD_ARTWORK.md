# Member card artwork and export

The permanent 90 × 55 mm membership card uses one 360 × 220 px artwork:
brand/type at the top, photo on the left, identity centered, QR on the right,
and a centered barcode below. Enrollment date and status share the footer.
Wallet balance remains on screen only, outside the printable document.

`styles/member-card.css` isolates document layout from dashboard card selectors.
A4 preview slots scale that same artwork to their physical dimensions.

`captureMemberCard` copies computed styles and embeds local Sarabun font files
and images in an SVG foreignObject. The browser shapes Thai text before the
result is drawn to a 1440 × 880 px canvas. PDF and PNG use the same rendering;
they no longer draw Thai glyphs individually via html2canvas.
Batch PDF places each rendered card at the configured sheet coordinates.
Export waits for images/fonts and QR generation; failures appear in the dialog.

Verification: `scripts/member-card-artwork-smoke.mjs` uses a fresh temporary
SQLite database. It downloads actual PNG, 90 × 55 mm PDF, multipage cards and
A4 PDF; compares PNG pixels to the native screen card; decodes the exported
barcode; checks mobile controls and the receiving scanner/add-button gap.
Physical printer/label calibration still depends on the selected device/media.
