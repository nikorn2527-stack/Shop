# Imported product artwork repair

The opening-data preparation substituted 📦 for missing emoji. The original catalog intentionally left these values empty so the client could resolve category emoji and named SVG artwork for short/manual barcodes. An explicit 📦 prevented that fallback.

A one-time startup migration is scoped to product IDs recorded in opening_import_rows, only when the current emoji is 📦 and no custom image is present. It clears that unintended value to NULL, preserving other chosen icons, photographs and unrelated products. A marker prevents later user choices from being reset. It does not restore a database or modify quantities, prices, costs, members, transactions, accounts or passwords.

For file databases a native SQLite safety backup runs before the repair. Artwork, marker and audit recording commit together; failed backup or audit recording leaves artwork unchanged. Existing license/auth behavior is unchanged. The private one-off preparation script was separately corrected to retain missing emoji for future imports.

Verification: 132 tests passed across migration, existing artwork, store and backup suites; TypeScript and production build passed. On a private restored copy of the opening database, startup backed up and repaired 196 values. Full product ID/quantity/price/cost and member balance rows were compared before/after and stayed identical. Codes02,01 and08 resolved to stamp.svg, envelope.svg and sandals.svg respectively. The original delivery database was unchanged. Real datasets and credentials are not committed.
