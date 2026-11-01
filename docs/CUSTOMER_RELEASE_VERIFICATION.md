# Customer release: welcome defaults and fixed features

User explicitly approved removing the commercial version/license UI, keeping the agreed feature set when moving from Railway to the customer server, and making the approved Login image and hospital name appear immediately rather than requiring manual upload.

## Welcome defaults

- Approved garden WebP is a bundled default; old empty login settings and old caches now render it automatically.
- Default organization is โรงพยาบาลธัญญารักษ์อุดรธานี, including old blank configuration. Existing logo and app name are retained.
- Existing custom embedded images are retained. Background modes default/custom/plain distinguish an explicit plain selection from unconfigured old settings. Settings include a restore-default button.
- Workspace background, print documents, credentials, members and opening stock are unaffected.

## About and deployment portability

- Customer settings show About with the running server software version, shop/organization and developer, replacing package comparison, key redemption and trials.
- All recognized server release channels use a managed complete feature set; stored legacy license values are retained without gating functionality or imposing an expiry. Deprecated commercial widgets cannot render through old callers.
- Windows POS registration and first-password rules remain; role permissions and auth checks remain. Moving from cloud to Windows does not downgrade features or user counts.
- Initial administrator setup no longer presents commercial choices and still shows validation errors.
- Windows installers and physical Windows/POS/printer certification remain future packaging work. A future migration needs a tested full backup/restore, all referenced assets/configuration, LAN and printer setup, a short final-write pause and relogin; no zero-downtime or offline synchronization claim.

## Verification

164 Vitest tests passed in 11 files, covering managed feature parity, old key compatibility, setup atomicity, backup/restore, roles, existing store operations, branding cache/default/custom/plain behavior and background independence. TypeScript and production build passed; existing bundle-size warning remains.

Playwright Chromium fallback used because the Browser plugin is unavailable. All API calls mocked locally, no real login or business writes. About desktop 1440×1000 and mobile390×844 verified without package/key/trial text or overflow; first-run setup still shows an alert on empty submission. Default Login verified with the actual original public logo and deliberately empty old background/organization settings at1672×941,390×844,320×640 and844×390. Verified bundled-image src and exact hospital text, reveal/hide, Enter, error, confirmed transfer and broken-image fallback. No page errors. Screenshots inspected with view_image.

Evidence outside git: /tmp/shop-login-preview/login-default-desktop.png, login-default-mobile.png, default-login-browser-checks.json, about-desktop.png and about-mobile.png. Temporary preview harness removed. Real member/product import remains deferred. Deployment targets the existing test Railway site as explicitly authorized.
