# Production Readiness: Security Gate

**Status: NOT READY for public production deployment.**

## Post-merge verification — 25 October 2026

- PRs #15 and #16 (privacy/offboarding), #18–#20 (readiness evidence and callable inventory), #21 (defensive lead-audit input validation), and #22 (continuation queue sync) are merged into `main`.
- Current main commit at this checkpoint: `81374864b4535f1b11c23ac4a83e3deb8bb56274`.
- Exact-main CI run [40178337347](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40178337347) completed successfully for both Functions and frontend/emulator jobs after the latest merge.
- The read-only lead identifier analyzer now rejects malformed direct-call inputs and duplicate IDs before reporting; it does not connect to Firestore or backfill records.
- The offboarding callable is a read-only preview only. It does not delete records, close accounts, configure TTL, or authorise production offboarding.

Use only the separate Growth Engine Firebase project and synthetic data until every blocking control below is implemented and verified. Do not connect production AnyTrader data or enable automated outreach.

## Verified development controls

- Firebase Authentication is required for all 17 callable exports, including the owner-only `previewOrganisationOffboarding` preview.
- Server-side organisation membership, role, and tenant checks are enforced.
- Firestore client rules deny direct client reads and writes.
- Contact-restriction and outreach-draft checks fail closed for malformed or unverified records.
- All callable exports have server-side rate limits; mutation quota updates are transactional with the protected mutation, and read quotas are consumed before collection queries.
- Rate-limit state validation fails closed. Structured quota logs use a hashed quota key and do not include raw user or organisation IDs.
- Emulator regressions cover exhausted and malformed quota states, mutation side effects, concurrent mutation/read quota boundaries, exact persisted read-quota counts, and expired read-quota window reset with refreshed TTL expiry.
- Latest verified CI for the previously verified PR head `82dfaaf085044a361903daea7f7a64d7c0ce6496` on `development/next-phase` passed both jobs in [run 40088188514](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40088188514). Verified job steps: frontend typecheck, unit tests, production build, emulator integration smoke tests, Functions authorization tests/build, dependency advisory checks, and the Functions lockfile integrity guard all completed successfully. This records the earlier verified head, not the current PR head or production readiness. Regression coverage includes tenant-scoped authorization ordering and transactional role revalidation, organisation cursor/membership validation, pagination-token binding to organisation and collection, transactional outreach-draft safeguards (including explicit `sent: false` on valid drafts and fail-closed handling of missing/inconsistent sent flags), bounded/atomic/idempotent CSV imports with new leads suppressed by default (including exact replay, conflicting payload rejection, and concurrent same-key requests), renewed contact review when lead email, phone, or website changes while preserving blocked-lead suppression, and lead-directory search/filter reset behaviour. The latest emulator batch also seeds two synthetic legacy leads without canonical keys and verifies exact-value email and website fallback queries skip duplicates; the fixture refuses to run outside the local demo Firestore emulator. The CI workflow push and pull-request branch filters target `development/next-phase` and `main`.

These checks support development readiness only; they do not establish production readiness.

## Blocking: live Firebase App Check verification

**Code-level enforcement is implemented; live project verification remains incomplete.** The callable exports in `functions/src/index.ts` use `enforceAppCheck` for deployed runtimes, with the emulator-only exception guarded by `FUNCTIONS_EMULATOR`. The frontend requires its public App Check site key before entering cloud mode and initialises the reCAPTCHA v3 provider with automatic token refresh. These code and emulator checks do not prove that a dedicated Firebase project or live attestation flow is configured correctly.

- [ ] Create the separate Growth Engine Firebase project.
- [ ] Register each supported app with Firebase App Check and configure the appropriate production provider.
- [x] Add `enforceAppCheck` to all callable exports for deployed runtimes; the explicit `FUNCTIONS_EMULATOR` exception exists only for local emulator tests.
- [x] Require the web App Check site key before the frontend enters cloud mode and initialise the reCAPTCHA v3 provider with automatic token refresh.
- [ ] Configure the dedicated project, register the app/provider and authorised domains, then verify valid client tokens against deployed or production-like Functions before enabling cloud mode.
- [ ] In a production-like environment, verify missing/invalid tokens are rejected and valid tokens work; source-contract and emulator tests do not prove live attestation.
- [x] Retain authentication, authorisation, and tenant-isolation checks independently of App Check.

## Abuse monitoring and cost controls

Initial per-user/per-organisation fixed-window limits are implemented for organisation creation and campaign, lead, suppression, and outreach-draft mutations. Paginated list callables also have independent quotas: 120/minute for organisation, campaign, and lead lists; 60/minute for outreach-draft lists. `listMyOrganisations` uses a global per-UID bucket. The owner-only `previewOrganisationOffboarding` callable has its own read quota and performs bounded, non-destructive inventory reads.

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

See [PRIVACY_DATA_RETENTION_AND_OFFBOARDING.md](./PRIVACY_DATA_RETENTION_AND_OFFBOARDING.md) for the source-verified Firestore collection inventory and a dry-run-first offboarding design. It is a specification only: no bulk deletion, account deletion, or production TTL policy is implemented by that document. The schema inventory must be reconciled against any legacy/manual records before real-data offboarding.

- [ ] Define and test retention, deletion, user offboarding, backups, and recovery.
- [ ] Review provider terms and authorised sourcing methods for each lead source.
- [ ] Review contact permissions, lawful basis, privacy notices, and applicable marketing requirements before outreach use.
- [ ] Keep outreach draft-only until legal, consent, and operational controls have been reviewed; internal review clearance is not proof of consent or lawful basis.
- [ ] Verify the production-like release checklist and incident-response process before public deployment.

## Release rule

Remain in synthetic-data development/demo use until every blocking item above is completed and independently verified. No production AnyTrader data, production integrations, or automated outreach before that point.


## Latest review checkpoint — 24 October 2026

PR #10 was merged into `main` via squash commit `9e110070f093f8ed28b3624457d8889283554507`; post-merge CI run [40110628299](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40110628299) passed. The current deployment-guard change is in draft PR #14 at head `14f09bc3dc28c4790ae87ef9c95bb054624d8f4d`; CI run [40132165677](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40132165677) completed successfully with both the Functions and frontend/emulator jobs green. CI success is not a substitute for reviewing overlapping PRs or approving a merge.


## Deployment target allow-list guard

- [x] Add a Firebase CLI predeploy guard that requires an explicit `GROWTH_ENGINE_FIREBASE_PROJECT_ID` allow-list and an exact match with `GCLOUD_PROJECT`.
- [x] Reject missing target/allow-list values, mismatched project IDs, and `demo-*` projects; add unit tests for each case.
- [ ] After the dedicated Growth Engine project is created, configure the expected project ID in the deployment environment and verify a deliberate mismatch is blocked and the approved target passes the guard. Do not deploy as part of this test.
- [ ] Independently review the target project ID before any deployment; this guard cannot determine whether an operator intentionally configured the wrong project as the allow-list.

The guard only protects Firebase CLI deployment flows that execute the repository's configured predeploy hook. It does not protect manual console changes, other deployment tools, or an operator who explicitly allow-lists the wrong project.
