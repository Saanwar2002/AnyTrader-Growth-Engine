# Production Readiness: Security Gate

**Status: NOT READY for public production deployment.**

Use only the separate Growth Engine Firebase project and synthetic data until every blocking control below is implemented and verified. Do not connect production AnyTrader data or enable automated outreach.

## Verified development controls

- Firebase Authentication is required for all 16 callable exports.
- Server-side organisation membership, role, and tenant checks are enforced.
- Firestore client rules deny direct client reads and writes.
- Contact-restriction and outreach-draft checks fail closed for malformed or unverified records.
- All callable exports have server-side rate limits; mutation quota updates are transactional with the protected mutation, and read quotas are consumed before collection queries.
- Rate-limit state validation fails closed. Structured quota logs use a hashed quota key and do not include raw user or organisation IDs.
- Emulator regressions cover exhausted and malformed quota states, mutation side effects, concurrent mutation/read quota boundaries, exact persisted read-quota counts, and expired read-quota window reset with refreshed TTL expiry.
- Latest verified CI for commit `f40a08038baa158f85e5fc227504fea0f770a830` passed both the Firebase Functions tests/build and frontend typecheck/tests/build jobs: [run 39945331645](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39945331645). Regression coverage includes tenant-scoped authorization ordering and transactional role revalidation, organisation cursor/membership validation, pagination-token binding to organisation and collection, transactional outreach-draft safeguards, bounded/atomic/idempotent CSV imports with new leads suppressed by default, and renewed contact review when lead email, phone, or website changes while preserving blocked-lead suppression. The CI workflow push and pull-request branch filters also target `development/next-phase` and `main`.

These checks support development readiness only; they do not establish production readiness.

## Blocking: Firebase App Check

The audit found 16 callable exports and no `enforceAppCheck` options in `functions/src/index.ts`. App Check is not currently enforced.

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

## Dependency vulnerability management

The workflow runs `npm audit --audit-level=high` in both the root and Functions jobs. On commit `696f5d84cb139505fba2ab3b53546a95ec8b9dbc`, both audit commands completed successfully and each reported `found 0 vulnerabilities` (root/frontend and Functions lockfiles). The complete CI run also passed both jobs, including typecheck, unit tests, production build, Firebase emulator integration smoke tests, Functions authorization tests, and Functions compilation: [run 39623609283](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39623609283).

- [x] Review the first audit results for both lockfiles, including lower-severity findings: none were reported by either `npm audit` run at this commit.
- [x] Confirm the full frontend, Functions, and emulator CI run after adding the advisory gate.
- [x] Add `.github/workflows/dependency-audit.yml` for weekly and manual root/Functions audits, with JSON artifacts retained for 30 days and high/critical findings failing the audit job.
- [x] Add `.github/dependabot.yml` for weekly update PRs covering root npm dependencies, Functions npm dependencies, and GitHub Actions. Updates arrive as pull requests and still require CI and review; no automatic deployment is configured.
- [ ] After review, promote the audit workflow and Dependabot configuration to the repository's default branch. GitHub scheduled workflows and Dependabot configuration are not active merely because the files exist on `development/next-phase`; manual workflow dispatch also requires the workflow to exist on the default branch. **Important:** GitHub scheduled workflows run from the repository's default branch; because this work is intentionally confined to `development/next-phase`, the weekly schedule will not become active until this workflow is reviewed and promoted to the default branch. It can be tested manually from this branch.
- [ ] Re-run frontend, Functions, and emulator tests after any dependency updates.

This is a point-in-time result for the committed lockfiles, not a guarantee against future disclosures. The Functions install also emits upstream deprecation warnings for dependencies (including `glob` and Node's `url.parse()`); these are maintenance signals and were not reported as npm audit vulnerabilities in this run.

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
