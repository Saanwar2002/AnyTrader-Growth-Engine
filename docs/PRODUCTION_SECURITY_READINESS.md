# Production Readiness: Security Gate

**Status: Not ready for public production deployment.**

This project must use its own Growth Engine Firebase project and synthetic data until the following controls are configured and verified.

## Existing controls
- Firebase Authentication on callable requests.
- Server-side organisation membership, role, and tenant checks.
- Firestore client rules deny direct client reads and writes.
- Contact-restriction and draft checks fail closed for malformed or unverified records.
- CI runs frontend checks, Functions tests/build, and emulator integration.

## Blocking: Firebase App Check
Audit on 2026-10-20 found 15 callable exports in `functions/src/index.ts` and zero `enforceAppCheck` options. App Check is not currently enforced by the callable definitions.

- [ ] Create the separate Growth Engine Firebase project.
- [ ] Register each supported app with Firebase App Check and configure a production provider.
- [ ] Enforce App Check on every callable after legitimate clients are configured to send valid tokens.
- [ ] Test missing/invalid tokens are rejected and valid tokens work in a production-like environment.
- [ ] Keep authentication, authorisation, and tenant isolation checks. App Check does not replace them.

## Abuse and operational controls
- [ ] Add server-side per-user and per-organisation rate limits for high-volume operations.
- [ ] Monitor repeated denials, unusual request volume, errors, and unexpected costs.
- [ ] Configure budget alerts and an operational response owner.
- [ ] Define data retention, deletion, offboarding, backups, and recovery.
- [ ] Review provider terms, contact permissions, privacy, and marketing requirements before any outreach use.

## Release rule
Keep this in synthetic-data development/demo use until the blocking items are implemented and verified. Do not connect production AnyTrader data or enable automated outreach.
