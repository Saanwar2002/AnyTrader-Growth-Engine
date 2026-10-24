# Cloud release readiness gate

## Purpose

This checklist is a human-operated release gate for enabling the Growth Engine cloud workspace or deploying Firebase resources. A green CI run is necessary, but it does not prove that a real Firebase project is correctly configured or production-ready.

**Current default: cloud mode and deployment remain blocked until the dedicated Growth Engine Firebase project is created and verified.** Never use the production AnyTrader Firebase project.

## Gate 0 — repository and change control

- [ ] Confirm the repository is `Saanwar2002/AnyTrader-Growth-Engine`; do not modify the original AnyTrader repository.
- [ ] Confirm the intended branch, PR diff, reviewers, and CI run SHA match.
- [ ] Confirm all required CI jobs have completed successfully, including frontend typecheck/tests/build, Functions tests/build, dependency advisory checks, and emulator integration smoke tests.
- [ ] Review all open security and readiness PRs for overlap and dependencies before merging. Do not merge a draft merely because CI is green.
- [ ] After each explicitly approved integration step, run and inspect CI against the resulting combined branch/head SHA; individual PR green checks are not sufficient evidence that overlapping changes work together. Re-run affected security-contract and emulator tests after integrating shared backend or configuration files.
- [ ] Confirm no secrets, service-account keys, real lead/contact data, or local environment files are tracked.

## Gate 1 — dedicated Firebase project

- [ ] Create a separate Firebase project exclusively for Growth Engine.
- [ ] Record the exact project ID in the operator's secure deployment configuration.
- [ ] Enable only the Firebase products required by the reviewed release (Authentication, Cloud Functions, and Firestore as applicable).
- [ ] Configure Authentication providers intentionally; test Google sign-in and email/password sign-in, cancellation, popup-blocked behavior, and account-collision handling.
- [ ] Configure authorized domains with only domains controlled by the operator.
- [ ] Apply and review Firestore security rules; client access must remain deny-by-default for privileged tenant data.
- [ ] Verify budget alerts, billing limits, and ownership/administrative access before creating billable resources.
- [ ] Do not copy production AnyTrader data, credentials, or configuration into this project.

## Gate 2 — App Check and environment safety

- [ ] Merge and review the App Check enforcement change before any non-emulator cloud use.
- [ ] Register the intended web app with the selected App Check provider and configure only approved domains.
- [ ] Supply the public App Check site key through the documented local/build environment variable; never put private provider secrets in frontend variables.
- [ ] Verify the app refuses cloud mode when required Firebase configuration or App Check configuration is absent.
- [ ] In the dedicated project, verify that a missing token and an invalid/expired token are rejected, and that a valid token succeeds.
- [ ] Confirm Auth, App Check, organisation membership, role checks, and tenant scoping are independently enforced; App Check is not authorisation.
- [ ] Before deployment, verify the explicit Growth Engine project allow-list equals the actual Firebase CLI target. Stop on missing or mismatched values.
- [ ] Confirm emulator project IDs cannot be used as deployment targets.

## Gate 3 — synthetic-data verification

- [ ] Run the full frontend and Functions test suites.
- [ ] Run emulator smoke tests against a synthetic demo project.
- [ ] Verify cross-tenant reads/writes and owner/admin/member role boundaries.
- [ ] Verify duplicate detection, import bounds, idempotency, rate limits, and audit event behavior.
- [ ] Verify imported leads remain suppressed / pending human review until a human resolves their status.
- [ ] Verify outreach can only be drafted and that no send action or background sending path is enabled.
- [ ] Verify offboarding preview is complete only when every allow-listed category is fully enumerated; capped or unavailable categories must fail closed.
- [ ] Do not interpret emulator tests as a production security certification.

## Gate 4 — privacy, operations, and recovery

- [ ] Approve the data-source terms, privacy notice, lawful basis, retention period, and applicable marketing rules before importing real records.
- [ ] Complete a source-backed inventory of tenant collections, root-level records, Auth users, exports, logs, backups, and third-party copies.
- [ ] Decide retention and legal-hold requirements before configuring TTL or implementing deletion.
- [ ] Test backup/restore and recovery procedures with non-production data.
- [ ] Define monitoring, alert ownership, incident response, audit retention, and cost/budget review.
- [ ] Verify quotas and abuse protections for every externally callable operation.
- [ ] Document rollback steps and a named human operator for the release.

## Gate 5 — explicit human approval

- [ ] Review and approve the exact PRs and commits intended for release.
- [ ] Review the target Firebase project and planned resource changes immediately before deployment.
- [ ] Obtain explicit approval for production deployment and any use of real data.
- [ ] Keep outreach draft-only unless a separately reviewed and explicitly approved messaging capability is implemented.
- [ ] Do not run deletion, account closure, bulk import of real leads, paid source-provider calls, or live outreach as part of this checklist.

## Stop conditions

Stop and resolve the issue if any required CI job is pending/failed, the project ID is uncertain, App Check is not verified, tenant authorization is unclear, a required inventory is incomplete, recovery is untested, or a step would expose real data or initiate an external side effect without approval.

This document is a checklist, not evidence that any gate has passed. Record evidence and date each approval in the release review; never mark a gate complete based only on this file existing.
