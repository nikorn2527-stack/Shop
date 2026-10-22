# Product icons

The product image chooser offers 32 local SVG illustrations with Thai labels,
search and category filtering. Use it from Add product, Edit product, or the
always-visible receiving form. The catalog is shared in `shared/productIcons.ts`;
assets ship with the app in `client/public/images/product-icons/`.

Choosing an icon replaces the draft image. Confirming the chooser changes only
the parent form's draft; saving the product (or confirming its receiving batch)
is what writes it. Cancel either step to retain the saved artwork. Choose the
category default to remove the selected image and use the category emoji.
Existing photographs and explicit emoji remain unchanged until edited.

The same artwork is shown in POS, scan results and the stock table. Legacy manual
products with no image or emoji can use a name-matched illustration in the UI;
this fallback never updates database rows. Unknown names and normal barcoded
products use category emoji, including ice cream. Choosing a specific icon is
available for every product, regardless of barcode or panel membership.

No migration, reseed, stock adjustment or bulk rewrite is required. Category
fallbacks live in `shared/productCategories.ts`. To extend the library, add a
local SVG and a labelled entry to the shared catalog.

Validation uses fresh temporary demo databases: unit tests cover asset existence,
20 manual-product name matches, preservation of existing artwork, category
fallbacks and persistence without inventory/price changes. Browser QA covers
selection, search/filtering, cancellation at both levels, reload/POS rendering,
mobile category reset and receiving with a selected icon.
