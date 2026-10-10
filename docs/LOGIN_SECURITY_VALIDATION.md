# Login security changes

## Policy
- One active local session per account. A second login checks the password, then asks for explicit transfer confirmation before revoking the old session.
- No five-minute inactivity logout. Existing seven-day absolute session lifetime is unchanged.
- The session administration screen shows last server contact; background requests also update this timestamp, so it is not evidence of human activity.

## Additional request protection
- Before password hashing: at most 15 login requests per account/source and 120 per source in a five-minute window.
- Requests exceeding the limit return HTTP 429 with a Thai retry message. Existing account password-failure lockout remains in place.
- Limits include successful attempts and transfer confirmation requests. Normal authenticated work is not throttled by this login limiter.
- The in-memory limiter caps its entries and removes expired windows. Account names are hashed in limiter keys; passwords are never stored by it.
- Source uses Express's resolved `req.ip`, falling back to the connection address. Arbitrary `X-Forwarded-For` headers are not trusted by default.

## Verification
`npm run check`, `npm run build`, `npm test -- --pool=forks --maxWorkers=1 --minWorkers=1`.

After building: `node --import tsx scripts/single-session-smoke.mjs`.
This browser/HTTP check runs a separate production server on a temporary database copy. It verifies transfer confirmation, revocation, cookie HttpOnly, per-account and source HTTP 429 responses, spoofed forwarding headers, and continued validity of the new authenticated session.

## Deployment limitations
- Per-process counters reset when the server restarts and are not shared across application instances. Multi-instance deployment requires a shared limiter or edge protection.
- Behind a reverse proxy, an unconfigured proxy causes clients to share the proxy's source limit. Configure only known trusted proxy addresses at deployment; do not blindly trust all forwarding headers.
- MFA, lock-screen PIN, device labels, CSRF/origin review, OAuth-session parity and a full security audit are not included in these changes.
- Existing historical parallel sessions are not removed merely by opening the database; the next confirmed login replaces them.
- These changes do not change database business transactions or automatically deploy to Railway.