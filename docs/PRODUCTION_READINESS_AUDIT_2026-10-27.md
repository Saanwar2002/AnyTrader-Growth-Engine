# Production readiness audit — 27 October 2026

> **Continuation addendum — 27 October 2026, 21:45 UTC**  
> This addendum updates the repository/CI checkpoint after the original audit below; it is not a substitute for re-verifying external Firebase, privacy, monitoring, backup, or release controls.  
>  
> - **Current main checkpoint:** `09e7981a1ec9e2200d5f998b1e32a056e69915cf`.  
> - **Current main CI:** run [40589493999](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40589493999) completed successfully for that checkpoint; both Firebase Functions tests/build and frontend typecheck/tests/build including emulator smoke tests passed. Re-run the full suite on any release candidate.  
> - **Additional repository-only hardening since the earlier checkpoint:** deterministic pagination cursor-cycle keys; bounded and strictly decoded AI provider response streams; accessor/symbol/shape validation for AI provider envelopes; safe AI context/options snapshots; plan usage, rate-limit, membership, audit metadata, and lead-identifier reservation data-shape validation; and an explicit single-candidate contract for AI draft generation. Regression tests use synthetic/local data and CI emulators.  
> - **Release decision unchanged: NOT PRODUCTION READY.** No dedicated Growth Engine Firebase project or live App Check token flow has been verified. Privacy/retention approval, monitoring/budget alerts, backup/recovery evidence, approved source-provider configuration, legacy data reconciliation, release ownership, and rollback rehearsal remain blockers.  
> - No production deployment, live data migration, billing activation, live provider connection, or outreach was performed.  
>  
> ---
>  
## Executive decision

**Status: NOT PRODUCTION READY.** The repository has a substantially hardened development backend and a green CI pipeline, but the live Firebase project, live App Check flow, privacy/retention operations, monitoring, backup/recovery, and approved data-source configuration have not been verified. Continue using synthetic data and local/emulator environments only. Do not connect production AnyTrader systems or data, deploy cloud resources, enable billing, or initiate outreach as part of this audit.

This is an evidence-based repository audit, not a certification that any external Firebase project or cloud environment is configured.

## Exact repository checkpoint

- Repository: `Saanwar2002/AnyTrader-Growth-Engine`
- Branch: `main`
- Audited code checkpoint: `38fd77eff8031bfc469a2a8f519f8ac6100dc975`.
- Recent merged hardening includes PRs #239–#241 (offboarding-preview input, persisted quota-state, and concurrent quota-boundary safeguards), PR #243 (member-addition idempotency inventory), PR #246 (client-side Firebase project allow-list), PRs #249–#250 (offboarding inventory/type parity), and PRs #263–#266 (strict JSON-safe cursors, accessor rejection, candidate validation with provenance, and cumulative pagination-run limits), PR #269 (plain-data candidate records with accessor/symbol rejection), and PR #270 (immutable per-run manifest snapshot).
- Exact current-main CI: [run 40532460007](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40532460007) for commit `38fd77eff8031bfc469a2a8f519f8ac6100dc975` — **success**; both Functions and frontend/emulator jobs passed.
- Recent merged source-contract hardening rejects future approval/collection timestamps, lossy or accessor-backed cursors and candidate records, malformed candidate fields, duplicate trimmed provider record IDs across pages, repeated pagination cursors, and cumulative run-budget overruns. The page pipeline attaches provenance before returning records, and each run snapshots its manifest/field allowlist. These are provider-neutral safeguards only; no provider is connected.
- Offboarding preview remains owner-only, bounded, tenant-scoped, read-only, App-Check protected outside the emulator, and quota-limited. Invalid organisation IDs and malformed/exhausted quota states fail closed; denied roles do not consume quota.
- The dedicated Growth Engine Firebase project, live App Check verification, privacy/retention approvals, monitoring/budget alerts, backup/recovery, and approved data-source configuration remain release blockers. No production deployment or live migration was performed.

## Readiness scorecard

Status meanings:
- **PASS — repository evidence:** code/config and automated tests support the control within the checked scope.
- **PARTIAL — development only:** a code safeguard exists, but a live environment or operator process is not verified.
- **BLOCKED — release gate:** missing or unverified work prevents production use.

| Area | Status | Evidence and remaining work |
|---|---|---|
| Build and automated regression suite | **PASS — repository evidence** | Post-merge CI run 40532460007 passed both Functions and frontend/emulator jobs for checkpoint `38fd77eff8031bfc469a2a8f519f8ac6100dc975`, including typecheck, unit tests, build, dependency guards, CLI cloud-target/argument guard checks, and Firebase emulator smoke tests. Rerun against the exact release candidate before release. |
| Tenant authorization | **PASS — development only** | Callable handlers enforce Firebase Auth and organisation membership/roles; emulator tests cover cross-tenant denial. Still require project-specific security review and production-like verification. |
| Direct Firestore client access | **PASS — repository evidence** | `firestore.rules` denies direct client reads/writes. Keep this default until narrowly scoped rules are independently reviewed. |
| Callable App Check enforcement | **PARTIAL** | Deployed callable options enforce App Check; the bypass is explicitly limited to the Functions emulator. The frontend requires a public site key. A live project/provider/token flow has not been verified. |
| Dedicated Growth Engine Firebase project | **BLOCKED** | `.env.example` is blank and repository documentation states no dedicated project has been configured/deployed. Create a separate project; never use production AnyTrader. |
| Deployment target guard | **PARTIAL** | `scripts/guard-firebase-deploy.mjs` requires an explicit `GROWTH_ENGINE_FIREBASE_PROJECT_ID` equal to `GCLOUD_PROJECT` and rejects demo projects. The actual allow-list value and target project have not been configured or independently verified. |
| Lead canonical identifiers | **PASS — code; PARTIAL for legacy data** | CSV import, manual creation, and contact edits persist canonical email, website, and business/location keys and use bounded tenant-scoped duplicate lookups. PR #218 added duplicate rejection to manual creation and edits; emulator tests pass. Legacy records with different historical casing/spacing can still evade exact-value fallback until a complete backfill is reviewed and verified. See `docs/LEAD_DUPLICATE_IDENTIFIER_MIGRATION.md`. |
| Reservation integrity audit | **PASS — repository evidence; diagnostic only** | A bounded read-only analyzer and emulator-only CLI report missing/orphan/mismatched/malformed/unverifiable reservations and duplicate canonical identifiers without raw contact values. The CLI refuses cloud Firestore targets, and CI covers its guard and emulator behavior. Findings do not authorize repairs or migration. |
| Legacy identifier migration | **BLOCKED for production** | Available backfill harness is intentionally local-emulator-only and refuses cloud targets. The reservation audit is also emulator-only. No production adapter, live backfill, or pre/post migration evidence exists. |
| Approved source integrations | **BLOCKED** | Current acquisition entry points include manual search shortcuts and user-supplied CSV. No approved live source-provider integration is connected. Review source terms, permissions, rate limits, and privacy obligations before building or enabling adapters. |
| Outreach and consent | **PARTIAL — safe default** | The app is draft-only and has no send action. Leads default to Do Not Contact/pending review; a cleared internal review is not proof of consent or lawful basis. Keep outreach disabled until legal and operational review is complete. |
| Privacy, retention, and deletion | **BLOCKED** | Privacy/offboarding documentation is a specification and the offboarding callable is a bounded, read-only preview. Destructive deletion, account deletion, and production retention/TTL policy are not implemented or authorized. Complete the data inventory and approve retention/legal-hold policy before implementing deletion. |
| Monitoring and cost controls | **BLOCKED** | Code-level rate limits and structured logs exist. Production alerts, budget alerts, log access/retention, alert ownership, escalation, and cost calibration are not verified in a live project. |
| Backups and recovery | **BLOCKED** | No tested production backup/restore or recovery evidence is present in this repository checkpoint. Rehearse with non-production data and record recovery objectives and results. |
| Authentication provider configuration | **PARTIAL** | Email/password and Google sign-in code exists, but Firebase provider enablement, authorized domains, account-collision paths, and real sign-in flows have not been verified in a dedicated project. |
| Billing and SaaS plans | **BLOCKED** | Plan/quota controls exist in code, but subscription billing is not connected. Do not enable paid plans or activate billing as part of development CI. |
| Release rollback and human ownership | **BLOCKED** | No project-specific release operator, approved deployment target, rollback rehearsal, or incident-response evidence has been recorded. |

## Required work before production

### Gate A — project and identity

1. Create a separate Growth Engine Firebase project and record the exact project ID in the approved secure deployment environment.
2. Configure Authentication providers and authorized domains; verify email/password and Google flows, including cancellation and account-collision handling.
3. Register the intended web app with App Check and test missing, invalid/expired, and valid attestation tokens against a production-like Functions environment.
4. Verify the deployment guard blocks a deliberately mismatched target and accepts only the independently reviewed Growth Engine project ID. Do not deploy during this test.

### Gate B — data safety and tenant boundaries

1. Complete an independent review of callable authorization, tenant scoping, role boundaries, Firestore rules, indexes, and secret/environment handling.
2. Run the full test and emulator suite on the exact release candidate SHA.
3. Reconcile the lead identifier migration inventory per organisation, review all malformed records and collision groups, rehearse the migration, and obtain explicit approval before designing any project-specific production adapter.
4. Do not import real lead data until source permissions, privacy notice, lawful basis, retention, and applicable marketing rules have been reviewed.

### Gate C — operations and recovery

1. Configure budget alerts and monitoring for Functions and Firestore usage; test alert delivery and assign an owner/escalation path.
2. Decide and implement audit/log retention and Firestore TTL only after reviewing data lifecycle requirements.
3. Test backup/restore and recovery using synthetic or non-production data; record recovery objectives and evidence.
4. Approve incident response, deployment rollback, operator access, and release sign-off.

### Gate D — final release decision

1. Record evidence and dates for each gate in `docs/CLOUD_RELEASE_READINESS_GATE.md`.
2. Verify exact repository, branch, PR head SHA, required CI jobs, review threads, and post-merge CI before any release.
3. Obtain explicit human approval for the exact cloud deployment and any real-data use. No production rollout or outreach is implied by a green CI run.

## Stop conditions

Remain in local demo/emulator use if the dedicated project is absent or uncertain, live App Check is unverified, tenant isolation has not been reviewed, migration collisions remain unresolved, privacy/retention decisions are missing, recovery is untested, or operational alerts have no owner. This audit must be refreshed after material changes and immediately before a release candidate is approved.
