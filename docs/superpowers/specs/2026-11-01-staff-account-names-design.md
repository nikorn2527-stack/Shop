# Staff account naming — approved design

User approved: Thai full name and English full name entered by an administrator; suggest a lowercase English username (given name + dot + surname initial), editable before save; extend surname then add digits for collisions. Suggest a short report name such as นิกร.พ, also editable. Passwords remain separate and obey existing strength rules. Keep existing usernames and historical records unchanged.

Use existing display_name for the short display/report identity consumed throughout auth, receipts, reports, sessions and actors. Add full_name and english_name to retain full identities on the account. Legacy accounts keep display_name as before, with full_name falling back to it. New fields are optional in API contracts for older clients; the new create form requires Thai full name, display name and username. English is optional when a username is entered manually; no speculative transliteration.

Approaches considered: changing report renderers independently would scatter naming rules; replacing stored full names would lose information. Keep the existing display-name interface and retain full/English names in separate profile fields instead. Existing accounts can explicitly edit display name without changing username; no rewriting old sales or audit records. Stable app_users.id remains unchanged.

Follow existing Users page layout, no redesign or dependencies. All work in isolated /workspace/Shop-login, no live writes/deployment. Account creation authorization, password policies, last-admin guards and session behavior unchanged.
