# Production Readiness: Security Gate

**Status: NOT READY for public production deployment.**

Use only the separate Growth Engine Firebase project and synthetic data until every blocking control below is implemented and verified. Do not connect production AnyTrader data or enable automated outreach.

## Verified development controls

- Firebase Authentication is required for all 15 callable exports.
- Server-side organisation membership, role, and tenant checks are enforced.
- Firestore client rules deny direct client reads and writes.
- Contact-restriction and outreach-draft checks fail closed for malformed or unverified records.
- All callable exports have server-side rate limits; mutation quota updates are transactional with the protected mutation, and read quotas are consumed before collection queries.
- Rate-limit state validation fails closed. Structured quota logs use a hashed quota key and do not include raw user or organisation IDs.
- Emulator regressions cover exhausted and malformed quota states, mutation side effects, concurrent mutation/read quota boundaries, exact persisted read-quota counts, and expired read-quota window reset with refreshed TTL expiry.
- Latest verified CI for commit `573f4150f964234b450213b520acd8cc698a4ccc` passed both the Functions tests/build and frontend typecheck/tests/build jobs: [run 39620531888](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39620531888). The verified branch includes callable security-contract checks, draft-only outreach assertions, and adversarial timestamp conversion tests.

These checks support development readiness only; they do not establish production readiness.

## Blocking: Firebase App Check

The audit found 15 callable exports and no `enforceAppCheck` options in `functions/src/index.ts`. App Check is not currently enforced.

- [ ] Create the separate Growth Engine Firebase project.
- [ ] Register each supported app with Firebase App Check and configure the appropriate production provider.
- [ ] Enforce App Check on every callable after legitimate clients are configured to send valid tokens.
- [ ] In a production-like environment, verify missing/invalid tokens are rejected and valid tokens work.
- [ ] Retain authentication, authorisation, and tenant-isolation checks; App Check does not replace them.

## Abuse monitoring and cost controls

Initial per-user/per-organisation fixed-window limits are implemented for organisation creation and campaign, lead, suppression, and outreach-draft mutations. Paginated list callables also have independent quotas: 120/minute for organisation, campaign, and lead lists; 60/minute for outreach-draft lists. `listMyOrganisations` uses a global per-UID bucket.

- [ ] Calibrate initial limits against expected legitimate traffic before public release.
- [ ] Configure and test alerts for repeated quota exhaustion and invalid persisted quota state.
- [ ] Configure budget alerts and monitoring for Functions invocations and Firestore reads/writes.
- [ ] Assign an operational owner, escalation path, and response-time expectations.
- [ ] Configure appropriate log access and retention in the separate Firebase project.

See [RATE_LIMIT_OPERATIONS_RUNBOOK.md](./RATE_LIMIT_OPERATIONS_RUNBOOK.md). The runbook is guidance, not evidence that production alerts have been deployed.

## Rate-limit document lifecycle

Quota documents carry a server-managed `expireAt` timestamp based on the stored window end plus a five-minute grace period. The field does not delete documents by itself; a Firestore TTL policy must be configured in the separate project.

- [ ] Configure and verify TTL for the intended collection and `expireAt` field.
- [ ] Verify expiry/cleanup behavior in the target project and monitor cleanup lag and document growth.
- [ ] Preserve the rule that TTL is storage cleanup only; quota evaluation remains authoritative.
- [ ] Never bulk-delete active quota documents to resolve throttling, because deletion can reset a live quota bucket.

## Privacy, legal, and operational readiness

- [ ] Define and test retention, deletion, user offboarding, backups, and recovery.
- [ ] Review provider terms and authorised sourcing methods for each lead source.
- [ ] Review contact permissions, lawful basis, privacy notices, and applicable marketing requirements before outreach use.
- [ ] Keep outreach draft-only until legal, consent, and operational controls have been reviewed; internal review clearance is not proof of consent or lawful basis.
- [ ] Verify the production-like release checklist and incident-response process before public deployment.

## Release rule

Remain in synthetic-data development/demo use until every blocking item above is completed and independently verified. No production AnyTrader data, production integrations, or automated outreach before that point.
