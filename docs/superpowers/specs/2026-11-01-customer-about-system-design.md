# Fixed-feature customer delivery

Approved: remove customer-facing commercial tiers, trial and license-key UI; retain an About page with software version for support. Cloud and customer-hosted delivery must retain the same agreed functions. No expiration or feature/user-count downgrade when moving from Railway to Windows.

Use managed full functionality in every supported release channel, retaining existing role authorization, POS registration and initial-password policy per channel. Keep old stored license values and cryptographic parsing for compatibility; they no longer gate this customer application. Retire shared commercial UI exports as no-op compatibility components so other feature pages cannot surface upgrade dialogs. Replace the old settings edition tab content/label with About, retaining its internal tab ID for old links. Do not change production business data or passwords. Version comes from the server health endpoint, not a made-up paid edition.

Keep existing settings visual design. Verify cloud and Windows policies, permissions, auth setup, About UI and build. Publish to the same existing test Railway site already authorized; do not import real datasets. Self-hosted migration remains a future cutover with tested backup/restore, asset/config transfer, short final-write pause and relogin; no promise of zero downtime or offline dual-write synchronization.
