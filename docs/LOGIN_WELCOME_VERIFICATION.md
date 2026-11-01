# Hospital login verification

Base: cached origin/main 0086647. Branch: feat/hospital-login. No production writes, deployment or git push.

## Design and implementation

Approved concept: /workspace/generated_images/exec-5d52b915-5ee2-4740-8c0a-1a5bc66d331b.png.
Approved background optimized into client/public/images/login-garden.webp (60,792 bytes), with no baked-in text. Existing public customer logo was fetched read-only for local preview and is not embedded in source.

The hospital name is a new login-only setting, blank by default. On the new customer system, set loginOrganizationName to โรงพยาบาลธัญญารักษ์อุดรธานี and upload login-garden.webp through the existing login-background setting. Keep appName and appLogo unchanged. For a controlled setup the private, not-applied patch is /tmp/shop-login-preview/login-settings-patch.json; it contains only the two login fields. Old installations keep their saved image/plain setting. No patient data or credentials were used.

## Validation

- TypeScript noEmit passed; production frontend/backend build passed (existing bundle-size warning).
- 10 targeted Vitest tests passed: settings persistence, image independence/audit privacy, palette/image sanitization, old/new branding cache and login rate limiting.
- Browser plugin unavailable in this session; local Playwright Chromium used instead.
- All browser API calls mocked locally. Real customer public logo used. No production authentication attempted.
- Native concept viewport 1672×941; additional 390×844, 320×640 and 844×390 checks.
- No horizontal overflow; footer reachable on short screens.
- Verified disabled empty submit, password reveal/hide, Enter submission, bad-credential feedback, explicit session transfer confirmation, mocked successful submit and broken-image fallback. No browser page errors.

## Visual comparison ledger

Concept and latest browser desktop/mobile screenshots inspected with view_image in the same pass.

| Item | Result |
| --- | --- |
| Welcome copy and hospital name | Matches approved Thai wording; editable organization setting |
| Composition | Centered heading above single white form card, footer below |
| Background | Original approved garden image, centered cover crop; quiet mobile crop |
| Typography | Local Sarabun font, dark green headings, aligned readable field labels |
| Palette and controls | #65DC98 enabled submit, dark text, visible keyboard focus, muted disabled state |
| Responsive behavior | Headings wrap at 320px; short landscape can scroll vertically |
| Customer logo | Restored original logo above heading, as explicitly requested |

Intentional differences from generated art: original customer logo added; existing staff-only guidance retained as discreet unframed text; empty submit has accessible disabled styling and keyboard autofocus is visible. Typography/card dimensions adapt to real browser fonts and available width. Login mechanism remains the existing app flow.

Copy check: welcome heading, hospital name, login heading, username/password labels and placeholders, submit and PNG TEAM footer match. Existing staff-only guidance is the documented retained functional copy.

Evidence: /tmp/shop-login-preview/login-desktop.png, login-desktop-ready.png, login-mobile.png, login-narrow.png, login-landscape.png and browser-checks.json. These are review artifacts outside git. The UI was visually verified against the accepted design with the differences above; this is not an end-to-end production login or Railway deployment test.
