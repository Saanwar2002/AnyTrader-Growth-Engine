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
- [x] Add initial server-side per-user/per-organisation fixed-window rate limits to organisation creation and campaign, lead, suppression, and outreach-draft mutations. Limits are enforced transactionally and fail closed on malformed persisted quota state. Remaining: calibrate limits against expected usage, add operational monitoring/alerts, and verify production behaviour before public release.
- [ ] Monitor repeated denials, unusual request volume, errors, and unexpected costs.
- [ ] Configure budget alerts and an operational response owner.
- [ ] Define data retention, deletion, offboarding, backups, and recovery.
- [ ] Review provider terms, contact permissions, privacy, and marketing requirements before any outreach use.

## Release rule
Keep this in synthetic-data development/demo use until the blocking items are implemented and verified. Do not connect production AnyTrader data or enable automated outreach.


## Rate-limit observability

- Mutation quota exhaustion emits a structured warning with operation, hashed quota key, quota/window settings and retry duration.
- Invalid persisted quota state emits a structured error with the operation and hashed quota key. Raw user and organisation IDs are not included in these events.
- Log emission is implemented, but alert policies, retention configuration and operational response procedures still require configuration in the separate Firebase project. This does not remove the production-readiness blocker.


## Rate-limit observability

- Mutation quota exhaustion emits a structured warning with operation, hashed quota key, quota/window settings and retry duration.
- Invalid persisted quota state emits a structured error with the operation and hashed quota key. Raw user and organisation IDs are not included in these events.
- Structured logging passed CI run [39398354009](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39398354009). Alert policies, retention configuration and incident-response procedures still need configuration in the separate Firebase project.


## Rate-limit regression coverage

- A local-emulator integration regression now seeds the `updateLeadNotes` quota at its limit, verifies `resource-exhausted`, and confirms no lead data was changed. The fixture seeder refuses to run unless connected to the local demo Firestore emulator and only supports this fixed operation.
- CI verification is pending. Production alerting and quota calibration remain outstanding.

- Test fixture selection correction: the quota-boundary test uses an existing lead from the current first page after pagination fixtures have been created. Initial attempt failed because the original lead had moved outside that page; the correction is pending CI.

- Follow-up fixture correction: `listLeads` returns the document identifier as `id`; the integration test now passes that field to `updateLeadNotes`. Verification is pending CI.

- Follow-up assertion correction: post-call lookup now uses `listLeads`'s `id` field consistently. The prior run confirmed quota enforcement but failed to locate the record for the no-side-effect assertion; correction pending CI.

## Invalid rate-limit state regression

- The emulator smoke suite now checks both an exhausted quota and malformed persisted counter state. Expected results: `resource-exhausted` and fail-closed `failed-precondition`, respectively, with no mutation side effects. CI verification is pending.
