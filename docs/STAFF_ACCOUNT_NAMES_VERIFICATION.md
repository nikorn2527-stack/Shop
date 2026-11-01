# Staff account naming verification

This feature follows the approved username/report-name workflow and is included with the hospital login work for the planned new customer system. No production import, Railway deployment or remote push has occurred.

## Behavior

- New account form retains Thai full name and optional entered English name; proposes lowercase username from English (Nikorn Punnonngiw → nikorn.p) and short report name from Thai (นิกร พันโนนงิ้ว → นิกร.พ).
- Suggestions remain editable. Manual overrides survive edits to the name fields.
- All usernames, including inactive accounts, participate in case-insensitive collision suggestions. Surname prefixes extend before numeric suffixes. Backend uniqueness remains the final guard against concurrent creation.
- English spelling is entered by the administrator; the app does not invent transliterations. A valid username can be entered manually when no English name is provided.
- Existing display_name is the report/display identity already consumed by auth, sessions, receipts and transaction actors. New full_name and english_name preserve separate full identities. Old accounts keep their username and existing display name; editing an old profile is explicit, and its username is read-only.
- Existing account IDs, hashes and historical actor/cashier strings are retained. Name changes affect new activity; old records are not rewritten or regrouped across aliases.
- Only administrators can create/edit accounts. Password strength, last-admin and self-role protections remain unchanged.
- Full and English names are available in account management/search. New fields are optional in API contracts for compatibility with existing clients.

## Evidence

- 132 tests passed across 7 files: shared suggestions, profile migration/persistence, real tRPC create/update and auth context, existing store suite, session uniqueness/transfer and authorization.
- A file-backed legacy database migration test preserved username, ID and password hash across reopen and alias editing. The initial-setup administrator case also preserves the original full name when its first report alias is saved. Other tests used memory databases only.
- TypeScript check and production frontend/backend build passed; existing bundle-size warning remains.
- Browser plugin unavailable; Playwright Chromium used on localhost with every API call mocked and no real account creation.
- Verified desktop 1440×1000 and mobile 390×844 form; no mobile horizontal overflow. Verified generated values, surname-extension collision, manual overrides, submitted full/English/display fields, read-only existing usernames and self-edit omission of role changes. No page errors.
- Temporary React preview harness was removed after validation. Its layout was corrected to use the actual main-shell/page-content nesting before final checks; an earlier harness-only clipped table was not a product defect.
- Screenshots inspected with view_image: /tmp/shop-login-preview/user-create-desktop.png and user-create-mobile.png. Browser result: /tmp/shop-login-preview/user-names-browser-checks.json.

## Release notes

Branch feat/staff-account-names builds on the hospital-login commit d1208c2, based on cached origin/main 0086647. Reconcile with current remote main before publishing. Run the normal backup procedure before deploying the schema migration to an existing database. No customer member datasets, login fixture or credentials are committed.
