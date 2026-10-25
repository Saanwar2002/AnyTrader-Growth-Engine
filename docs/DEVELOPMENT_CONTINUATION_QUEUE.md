## AutoPilot run — organisation settings (2026-10-25)

- Added an owner/admin-only organisation display-name update callable and cloud workspace form.
- The update revalidates tenant membership and role inside the transaction, applies a per-organisation/user mutation quota, and writes an allowlisted audit event only when the name changes. Identical-name saves are no-ops.
- Added unauthenticated-callable inventory, source-contract, emulator persistence/cross-tenant denial, and UI coverage.
- Next feature priority: plan/entitlement scaffolding and durable server-side attribution aggregates. Billing remains deferred until entitlements are tested; production deployment remains blocked on dedicated Firebase/App Check and operational controls.

---

## AutoPilot run — source attribution analytics (2026-10-25)

- Added a loaded-record summary grouped by user-declared CSV source label, with qualified/onboarded counts and rates.
- The UI explicitly says labels are not independently verified and that calculations cover only loaded leads. Missing legacy source labels appear as "unknown" rather than being guessed.
- Added tests for sorting, rates, unknown labels, and empty input. No additional database reads, source scraping, PII collection, or outreach behavior was introduced.
- Next product focus: durable tenant-scoped aggregate analytics and organisation settings/entitlements. A dedicated Firebase project, live App Check verification, privacy/source permission review, and production controls remain operator prerequisites.

---

## AutoPilot run — campaign funnel analytics (2026-10-25)

- Added contacted lead counts and qualified/onboarded rates to the campaign performance summary.
- Rates use only currently loaded leads as their denominator, are rounded to one decimal place, and are labelled as loaded-lead rates in the table. Existing partial-pagination warning remains visible, so these metrics are not represented as full-database conversion analytics.
- Added unit coverage for the rates and empty campaigns. No new database reads, PII collection, billing, or outreach behavior was introduced.
- Next feature focus: organisation settings and durable attribution/aggregate analytics, while retaining explicit partial-data semantics and tenant-scoped server-side access. The dedicated Firebase project and live App Check verification remain operator prerequisites.

---

## AutoPilot run — direct audit input validation merged (2026-10-25)

- PR #21, [Validate inputs at lead identifier audit boundary](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/pull/21), was merged after exact-head CI run [40177935742](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40177935742) passed both Functions and frontend/emulator jobs.
- The pure read-only analyzer now rejects non-array input, null/non-object entries, missing or blank IDs, and duplicate record IDs before producing a report. Regression tests cover each case; canonicalization and duplicate grouping behaviour are unchanged.
- The bounded pagination coordinator still independently validates adapter pages, tenant scope, page limits, repeated cursors, duplicate IDs across pages, and truncation. The analyzer adds a second defensive boundary for direct callers.
- No Firestore adapter, live database scan, backfill, production data access, deletion, deployment, or outreach was introduced.
- Next safe batch: reconcile stale continuation notes and keep the production gate explicit. A real tenant-scoped migration adapter remains blocked until the separate Growth Engine Firebase project, least-privilege access, and operator-reviewed dry-run procedure are configured. Do not claim legacy duplicate coverage is complete before a verified backfill.

---

## AutoPilot run — malformed legacy import regression verified (2026-10-24)

- The malformed-legacy import fixture and audit-event assertions were added in commit `63fb24943043fd170f052f372d4e8fb6fced2481`. Initial CI runs exposed an overly strict aggregate-count assertion; commit `14cc0c286559e5ec2b976bde9272aa1a68c39e04` corrected the helper without changing import behaviour.
- CI runs [40092440423](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40092440423) and [40092444096](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40092444096) completed successfully on the corrected head; both frontend/emulator and Functions jobs passed.
- The emulator now proves malformed legacy contact/key types do not block a distinct valid import, audit events contain aggregate metadata only, replay does not create a second event, and malformed legacy contact fields remain suppressed/pending review.
- Next safe batch: reject malformed record entries from the bounded audit adapter instead of allowing null/missing-ID records to fail later inside the analyzer. Legacy mixed-case duplicate backfill and production controls remain gated on review and the separate Firebase project.

---

## AutoPilot run — CSV audit assertion corrected for repeated aggregate counts (2026-10-24)

- CI runs [40092254379](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40092254379) and [40092258779](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40092258779) failed in the emulator smoke step; both Functions jobs passed.
- Root cause was test-helper strictness, not import behaviour: two legitimate successful imports had the same aggregate audit metadata (`importedCount: 1`, `duplicatesSkipped: 0`), while the assertion helper assumed those counts could occur only once. The total event count remained the primary exactly-once check.
- The helper now accepts an explicit expected number of events matching aggregate counts; the malformed-legacy scenario expects two such events and still verifies the total audit count stays at five after replay.
- The corrected head requires a fresh CI run before proceeding. No production data, deployment, merge, or outreach was involved.

---

## AutoPilot run — malformed legacy import safety regression (2026-10-24)

- Verified the previous head `6fb122b55c9eef9d0dc22d25455b5a97890ca905`; Growth Engine CI run [40091962211](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40091962211) completed successfully for both frontend/emulator and Functions jobs.
- Added an emulator-only malformed legacy lead fixture with non-string contact/canonical-key fields. The smoke test checks that a separate valid import succeeds, audit metadata records only aggregate counts, idempotent replay adds no second audit event, malformed fields are serialized safely, and the legacy lead stays suppressed/pending review.
- At the time of this entry, CI for the new code/test head still needs its own verification; the prior green run does not validate this change.
- Keep all fixtures restricted to the local `demo-growth-engine-test` Firestore emulator. Legacy mixed-case duplicates still require a reviewed dry-run/backfill before complete legacy coverage can be claimed. Production blockers remain unchanged; no deployment or outreach is authorized.

---

## AutoPilot run — legacy duplicate fallback regression verified (2026-10-24)

- Verified the repository and active branch: `Saanwar2002/AnyTrader-Growth-Engine`, `development/next-phase`. PR #10 remains open, draft, and unmerged. No merge, deployment, production data access, or outreach sending occurred.
- Added an emulator-only seed fixture for two legacy leads without `dedupeEmailKey`/`dedupeWebsiteKey`, plus smoke coverage that exact-value email and website fallbacks skip both duplicates. The fixture refuses to run outside the local `demo-growth-engine-test` Firestore emulator.
- The first attempt exposed an over-escaped emulator-host guard; fixed it in commit `82dfaaf085044a361903daea7f7a64d7c0ce6496`.
- Both Growth Engine CI runs [40088182846](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40088182846) and [40088188514](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40088188514) completed successfully on that exact head. Frontend/emulator and Functions jobs passed.
- Next safe engineering batch: add focused audit-event invariants around duplicate-only imports and malformed legacy records, avoiding redundant assertions where existing emulator checks already cover the contract. Legacy mixed-case records still require a reviewed dry-run/backfill before canonical duplicate coverage can be claimed. Production blockers remain: dedicated Growth Engine Firebase project, App Check setup/enforcement, operational monitoring/TTL, and privacy/retention review. Synthetic data only; outreach remains draft-only.

---

## AutoPilot run — documentation and CI evidence sync (2026-10-24)

- Verified repository: `Saanwar2002/AnyTrader-Growth-Engine`; active development branch: `development/next-phase`; PR #10 remains open, draft, and unmerged. No merge or deployment was performed.
- Verified the PR head `a3d973ae7a138b0fb6adfb2fa67b9e5f983637b3` had successful Growth Engine CI run [40080470912](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40080470912): both frontend/emulator and Functions jobs passed, including typecheck, unit tests, build, emulator smoke tests, dependency audit, and Functions tests/build.
- Documentation batches completed: marked emulator coverage accurately in `docs/ROADMAP.md`; refreshed the verified CI evidence in `docs/PRODUCTION_SECURITY_READINESS.md` and `README.md`.
- These documentation-only commits were then created on this branch: `9b25a4398bd9d8feea890610a18c2fe16d67839b`, `5e439cdf199b5de0552cffbce371ff6f988a2d29`, and `438dd5b6d95d2ba4323745ba4fbebcf6fac9e9e3`. CI for the final documentation commit must be checked separately; the earlier green run does not validate these later commits.
- Next safe engineering batch: continue targeted malformed-legacy-record and audit-event invariant regressions, inspect test conventions before editing, and validate the exact new head in CI. Production blockers remain: dedicated Growth Engine Firebase project, App Check setup/enforcement, operational monitoring/TTL, and privacy/retention review. Synthetic data only; outreach remains draft-only.

---

## Latest continuation update — draft retry safety and audit metadata checks verified (2026-10-24)

- Latest code/test commit: `05dfef69c19db738c048212bc97487cb1722b7e7`.
- CI run [40043306751](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40043306751) completed successfully on that exact head. Both jobs passed: frontend typecheck, unit tests, production build, emulator integration smoke tests, and Firebase Functions authorization tests/build plus dependency audit.
- Outreach draft creation uses caller-scoped idempotency keys and a normalized-payload SHA-256 fingerprint; exact retries return the original draft, changed payload reuse is rejected, and replay rechecks lead suppression/contact-review state before returning. UI retains the key after uncertain failures; no message is sent automatically.
- Emulator coverage now explicitly verifies a retry cannot bypass a contact review that becomes pending after a draft was created. The 100-record draft-pagination fixture uses a unique key per draft, avoiding false duplicate-payload conflicts.
- Audit event emulator assertions now check per-event metadata allowlists and reject unexpected or content-bearing keys, in addition to checking event counts, tenant scope, actor, outcome, schema version, and timestamp.
- Dependency security remediation remains in place: `functions/package-lock.json` uses `body-parser@2.4.0`, and CI verifies the registry integrity before dependency auditing.
- PR #10 remains open, draft, and unmerged. All work stays on `development/next-phase`; do not merge or deploy without explicit approval.
- Next safe batch: continue targeted role/lifecycle tests for malformed legacy records and audit invariants. Production access/retention controls remain blocked on policy review and the dedicated Firebase project. Synthetic data only; outreach remains draft-only.
---
## Latest continuation update — CSV retry regression fixed; CI green (2026-10-23)

- Latest commit: `c2e31b169e81ccd9fda1fd1cad0189b09669ba1c` (`test: make CSV retry success response explicit`).
- CI runs [40028252434](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40028252434) and [40028245069](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40028245069) both completed successfully on that exact head. Verified: frontend typecheck, unit tests, production build, emulator smoke tests, Functions authorization tests/build, and dependency advisory checks.
- The CSV retry regression now explicitly mocks a one-lead successful retry after a simulated timeout. The previous failure was caused by the test's shared default mock returning two imported leads while the assertion expected one; the implementation's campaign/idempotency binding was not the failing assertion.
- PR #10 remains open and unmerged. Continue only on `development/next-phase`; do not merge without explicit approval.
- Next engineering batch: add retry idempotency to manual lead creation (server-side key/payload binding, atomic replay, and a stable client key across uncertain failures), then consider other mutations only after reviewing retry semantics. Keep this scoped; do not expand into a broad idempotency framework.
- Production remains blocked on the separate Firebase project, App Check enforcement and token tests, monitoring/budget alerts, TTL configuration where required, privacy/legal retention review, and operational recovery readiness. Synthetic data only; outreach remains draft-only.

---

## Latest continuation update — CSV import idempotency verified; audit policy documented (2026-10-22)

- CI run [39843237307](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39843237307) completed successfully for head `76a45ed6c4dc8f580433bc374475773dc1235101`. Both jobs passed: frontend typecheck/unit tests/build plus Firebase Emulator integration smoke tests, and Functions authorization tests/build. The smoke job includes same-key replay, conflicting payload rejection, and concurrent import retry coverage.
- PR #10 remains open and unmerged: https://github.com/Saanwar2002/AnyTrader-Growth-Engine/pull/10. Keep all work on `development/next-phase`; do not merge without explicit approval.
- Added `docs/AUDIT_EVENT_RETENTION_POLICY.md` as a proposed policy. It distinguishes product lead activity from security audit events and specifies minimal event fields, tenant-authorised access, tamper resistance, retention/deletion decisions, and verification gates. This is documentation, not implementation of a durable audit event store.
- Next engineering batch: implement a minimal trusted audit-event writer and cover the highest-impact mutations first, after checking transaction boundaries and existing activity records. Keep event metadata allow-listed and avoid copying lead contact details. Add emulator tests for atomic success events, rejected mutations, and tenant isolation.
- Production remains blocked on dedicated Firebase project, App Check enforcement and token tests, monitoring/budget alerts, TTL configuration where required, privacy/legal retention review, and operational recovery readiness. Synthetic data only; outreach remains draft-only.

---

## Phase 3A follow-up — CSV import duplicate hardening (2026-10-22)

- Added server-side `importLeads` in PR #10, capped at 25 rows, with authenticated tenant membership and transactional role checks, per-operation rate limiting, server-side validation, activity records, and suppression/pending-review defaults.
- Follow-up review identified a duplicate edge case: choosing only one primary key could miss two rows that shared a website but had different emails. The batch now tracks email, website, and business/location identifiers independently, and emulator coverage exercises the website variant.
- CI status must be checked against the latest PR head after these follow-up commits; do not treat earlier green jobs as validation of the latest changes.
- Next Phase 3 items: add cursor-based pagination for lead and draft directories; then design idempotency keys for retried mutations and a durable audit-event/retention policy.
- Release remains blocked on a dedicated Firebase project, App Check setup/enforcement tests, operational monitoring, quota calibration, and privacy/consent/retention review. Keep synthetic data only and outreach draft-only.

## Dependency automation and App Check boundary review — 2026-10-21

- Confirmed CI runs for commits `273fa515` and `e9acd485` completed successfully. This validates the existing `Growth Engine CI` workflow for those commits, but does not by itself execute the new scheduled dependency-audit workflow.
- Added weekly Dependabot update configuration for root npm dependencies, Functions npm dependencies, and GitHub Actions. Updates are proposed as pull requests; they are not auto-merged or deployed.
- Clarified in `docs/PRODUCTION_SECURITY_READINESS.md` that scheduled audit workflow and Dependabot configuration must be reviewed and promoted to the repository default branch before their scheduled automation becomes active. Manual dispatch also requires the workflow to exist on the default branch.
- Reconfirmed `firestore.rules` denies all direct client reads/writes and `src/firebaseClient.ts` remains in local demo mode until required Firebase web config is supplied.
- Reconfirmed the backend has 15 callable exports and App Check is not enforced. Do not enable `enforceAppCheck` prematurely: it must be paired with a separately configured Growth Engine Firebase project, registered client App Check provider, and production-like valid/invalid token tests.
- Remain on `development/chatgpt-mvp`; no merge to `main`, no production Firebase setup, no production data, and no automated outreach.

## Add npm advisory gates to CI — 2026-10-21

- Updated `.github/workflows/ci.yml` to run `npm audit --audit-level=high` in both root and Firebase Functions jobs, after their respective `npm ci --no-audit` install steps.
- High and critical advisory findings now fail the relevant CI job. Lower-severity advisories may be reported without failing the selected threshold and still require review.
- This is a gate, not yet a clean-audit claim: inspect the first workflow results for both lockfiles and triage any findings before calling dependency security verified. Consider scheduled scans for newly disclosed advisories.
- Remain on `development/chatgpt-mvp`; no production deployment, production AnyTrader data, or automated outreach.

## Dependency vulnerability monitoring gap — 2026-10-21

- Reviewed `.github/workflows/ci.yml`: both root and Functions installs use `npm ci --no-audit`, and no dedicated dependency advisory scan is configured.
- This does not establish that any package is vulnerable; it means CI currently provides no advisory-status verification. Do not infer a clean dependency posture from passing typecheck/tests/build alone.
- Added a production-readiness blocker to audit both lockfiles, review/remediate or risk-accept findings, and introduce repeatable dependency monitoring.
- Next: run an advisory audit against both lockfiles, assess actual findings before changing versions, then add a sustainable CI/scheduled check and rerun all tests. Remain on `development/chatgpt-mvp`; synthetic data only and no production deployment.

## Abuse and reliability audit — 2026-10-21

- Reviewed the current emulator and unit-test coverage for concurrent mutation quotas, concurrent read quotas, failed-precondition side effects, malformed persisted quota state, timestamp conversion failures, and races between contact-channel edits and draft creation.
- Existing regressions already exercise the key abuse/reliability boundaries: concurrent requests serialize against the final quota slot; rejected mutations do not alter protected records or create success activity; a contact edit keeps the lead suppressed and pending review; any draft committed before that edit is surfaced as requiring review.
- The adversarial timestamp conversion batch passed both CI jobs in [run 39620531888](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39620531888). No duplicate tests were added where equivalent runtime coverage already exists.
- Remaining release blockers are operational rather than test-only: separate Firebase project, App Check enforcement and verification, deployed quota/budget alerts, Firestore TTL configuration, quota calibration, and privacy/consent/retention/offboarding review. Keep all data synthetic and outreach draft-only.

## Rejected contact-review requests do not consume quota — 2026-10-20

- Added a local-emulator-only read-only assertion for the transactional `setLeadSuppression` quota counter.
- The stale-revision and malformed-persisted-revision tests capture the counter before the rejected request and assert it is unchanged afterwards.
- This verifies failed preconditions do not consume the mutation quota or create clearance activity.
- The helper accepts only the demo project, local Firestore emulator, and the specific suppression operation.

## Contact-review regression found and fixed — 2026-10-20

- The new fresh-lead stale-clearance test exposed a state-classification bug: editing contact details on a lead already suppressed as `pending` could incorrectly change its review status to `blocked`.
- Updated `updateLeadContact` to preserve `blocked` only when the normalized existing review status is actually `blocked`; other contact changes remain suppressed and pending review.
- This distinguishes a restriction awaiting review from an explicit block, while keeping both states suppressed.
- The first CI run failed on this assertion; the fix is committed and awaits a complete rerun.

## Malformed persisted contact-review revision fails closed — 2026-10-20

- Added a local-emulator-only seeder that corrupts the revision on a synthetic lead, guarded by the demo project ID and local Firestore emulator host.
- The smoke test submits a clearance request against that malformed persisted revision and expects `functions/failed-precondition`.
- It verifies the lead remains suppressed and pending review and no “Lead contact restriction removed” activity is recorded.
- This tests corrupted persisted state separately from stale-but-valid revisions; it does not alter production data.

## Stale contact-review clearance has no side effects — 2026-10-20

- Added a fresh synthetic lead specifically for stale-clearance side-effect coverage, independent of leads with legitimate prior review history.
- The test changes the email to increment the contact-review revision, then submits the old revision to clear the restriction and expects `functions/failed-precondition`.
- It asserts no “Lead contact restriction removed” activity was created and confirms suppression, pending review, and the newer revision all remain intact.
- This supplements the existing stale-revision regression and runs only against the local Firebase emulator with synthetic records.

## Contact-review flag type matrix — 2026-10-20

- Expanded the malformed contact-review regression from a single string to a small type matrix: string `"false"`, numeric zero, object, array, and null.
- Each malformed `doNotContact` value must fail with `functions/invalid-argument`; the test then verifies the synthetic lead remains suppressed/pending and neither block nor clear activity is written.
- This is input-validation coverage, not a concurrency proof. All checks use the local Firebase emulator and synthetic records.

## Reject malformed contact-review flags without side effects — 2026-10-20

- Added an emulator regression that submits the string `"false"` to the boolean `doNotContact` field. The callable must reject it with `functions/invalid-argument` rather than interpreting a truthy/falsy value as a review decision.
- Verifies the synthetic lead remains suppressed with `contactReviewStatus: "pending"` and that neither the “marked do not contact” nor “restriction removed” activity is written.
- Synthetic local-emulator data only. No production deployment or outreach sending.

## Viewer contact-review denial has no side effects — 2026-10-20

- Extended the emulator-only activity assertion to optionally forbid a specific activity message while allowing legitimate prior history for the same lead.
- After a viewer's `setLeadSuppression(..., doNotContact: true)` request is denied, the smoke test verifies no matching `Lead marked do not contact` activity exists and the lead remains unsuppressed.
- This tests both audit-trail integrity and state preservation after a role-denied contact-review operation. Emulator-only, synthetic data.

## Failed contact-review operation leaves no activity-log entry — 2026-10-20

- Added a guarded, read-only Admin SDK assertion against the local demo Firestore emulator.
- After a synthetic missing-lead suppression attempt is rejected with functions/not-found, the test verifies there is no activity-log record for that lead ID. This protects audit history from claiming a review action occurred when the protected mutation failed.
- The assertion refuses non-emulator/non-demo projects. Synthetic data only; no production deployment or outreach sending.

## Rejected legacy draft edit does not consume the final quota slot — 2026-10-20

- Expanded the local-emulator-only quota fixture allowlist to seed the `updateOutreachDraft` boundary (119 of 120 requests used).
- Added an integration check that editing a legacy draft with missing status is rejected before quota consumption, then verifies a valid existing draft edit can still consume the final slot.
- This complements the prior state-preservation assertions. It verifies transactional ordering for rejected writes; activity writes remain coupled to successful mutations in the same Firestore transaction. Synthetic emulator only.

## Rejected legacy draft edits preserve stored record state — 2026-10-20

- Extended the emulator integration test to attempt edits against both a legacy outreach record marked `sent` and one with a missing status.
- Both edits must fail with `functions/failed-precondition`; subsequent list reads assert the sent status and original content remain unchanged, while the missing status remains visibly `unknown` rather than being silently treated as a draft.
- This verifies rejected draft operations fail closed without mutating persisted business records. Synthetic local emulator only; no sending or production deployment.

## Rejected missing-target request does not consume quota — 2026-10-20

- Added an emulator regression that seeds the updateLeadNotes bucket one request below its limit, attempts to edit a nonexistent synthetic lead, confirms functions/not-found, then proves a valid edit can still consume the final slot.
- This verifies target-existence failures occur before quota consumption and that rejected operations do not waste a legitimate user's remaining quota. Emulator-only, synthetic data; CI verification pending.

## Failed status update leaves legacy lead unchanged — 2026-10-20

- Added an emulator regression that snapshots a synthetic legacy lead whose referenced campaign is missing, attempts to mark it contacted, confirms the callable fails with `functions/failed-precondition`, and re-reads the lead to prove its status was not mutated.
- This complements the existing missing-campaign failure assertion by checking the protected record remains unchanged after rejection. Local emulator/synthetic data only; no production deployment or outreach sending. CI verification pending.

## Reject non-string and oversized pagination tokens — 2026-10-20

- Extended emulator integration coverage for all four paginated callable endpoints: organisation, campaign, lead, and outreach-draft listings.
- Each endpoint must reject object-shaped cursor tokens and strings longer than the 512-character bound with `functions/invalid-argument`, before cursor document resolution.
- Existing cross-collection, cross-tenant, missing-document, malformed-timestamp, and full multi-page coverage remains in place. CI verification pending; fixtures remain synthetic and emulator-only.

## Fail closed on malformed persisted campaign and lead fields — 2026-10-20

- Hardened campaign and lead list serialization so corrupted/non-string persisted values cannot pass through to frontend responses. Text fields are bounded, unknown status values are represented as `unknown`, lead scores are finite and clamped to 0–100, and score reasons are restricted to a bounded string array.
- Added emulator-only malformed campaign/lead fixtures and assertions that list APIs return JSON-safe values while preserving the malformed lead's suppressed/unverified contact state.
- CI verification pending. No production data or services used; outreach remains draft-only.

## Safe serialization of malformed persisted timestamps — 2026-10-20

- Added a defensive timestamp serializer for campaign, lead, and outreach-draft list responses. It returns an ISO string only when the persisted value exposes a callable toDate() that returns a valid Date; malformed values, invalid dates, and thrown conversions become null rather than failing the whole list response.
- Added unit coverage for valid timestamps, missing/non-object values, a non-callable toDate, invalid return types/dates, and throwing conversions.
- Added an emulator-only corrupted draft timestamp fixture and an integration assertion that the draft remains listable with createdAt: null.
- CI pending. The previous malformed-draft-content batch passed both CI jobs in run 39431117535.

## Fail closed on malformed persisted outreach-draft content — 2026-10-20

- Extended the guarded emulator-only legacy fixture with a draft whose subject is an object and body is a number rather than strings.
- The listing response now returns bounded string values only, marks missing/blank/non-string/overlong subject or body as requiring review, and keeps an explicit suppression warning higher priority than the malformed-content warning.
- Emulator assertions verify corrupted Firestore values cannot leak as non-string values to the frontend and cannot be presented as a ready-to-use draft. CI pending.
- The preceding cross-tenant verification-fixture correction is being re-run in CI run [39430883901](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39430883901).

## Cross-tenant draft write verification fixture correction — 2026-10-20

- The first CI run for the cross-tenant campaign/draft denial batch exposed a test-fixture issue, not an authorization failure: the draft selected for post-denial verification was older than 100 newer pagination fixtures, so it correctly did not appear on the first page.
- The smoke test now creates a dedicated synthetic victim draft after pagination setup and verifies that this exact draft remains unchanged and present after denied cross-tenant edit/delete attempts.
- The Functions tests/build passed; the emulator smoke job failed only at the stale fixture lookup. Reverification is pending in CI run [39426525880](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39426525880).
- Continue with malformed input and persisted-record integrity coverage after this regression is green. No production data or services used.

## Cross-tenant campaign and draft write denial — 2026-10-20

- Added emulator checks for an authenticated user with no membership attempting campaign creation and outreach-draft create/edit/delete against another organisation's actual tenant ID.
- Every attempt must fail with `functions/permission-denied`; follow-up owner reads confirm no campaign was created, the draft subject was not changed, and the draft was not deleted.
- This complements foreign document-ID checks and the existing coverage for cross-tenant lead, suppression, and campaign-status mutations. CI verification pending.
- Production remains blocked on separate-project App Check configuration/enforcement, deployed alerts, quota calibration, Firestore TTL configuration, and privacy/operational readiness.

## Runtime authentication coverage for every callable — 2026-10-20

- Expanded emulator smoke coverage from a single unauthenticated listing check to all 15 exported callable handlers.
- Each callable is invoked after signing out with an empty payload and must return `functions/unauthenticated`. This verifies authentication rejection occurs before payload-specific validation, tenant reads, or mutations across read and write surfaces.
- Source-level guard also checks every callable explicitly requires the caller UID before its rate limiter and uses its own operation-specific quota key. Full CI verification pending.
- Production remains blocked on separate-project App Check configuration/enforcement, deployed alerts, quota calibration, Firestore TTL configuration, and privacy/operational readiness.

## Verify malformed persisted read-quota state fails closed — 2026-10-20

- Added an emulator smoke regression that seeds a malformed listLeads quota document and verifies the callable rejects with functions/failed-precondition, matching the fail-closed contract already covered for mutations.
- This complements exhausted read-quota checks for all four read callables and mutation quota-boundary/concurrency checks.
- Callable rate-limit coverage and exact operation-key guard passed both CI jobs in run [39419030893](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39419030893). This new emulator assertion is pending CI.
- Production remains blocked on separate-project App Check configuration/enforcement, deployed alerts, quota calibration, Firestore TTL configuration, and privacy/operational readiness.

## Verify rate-limit guard operation-key alignment — 2026-10-20

- Strengthened the callable coverage unit test so each exported callable must use its own exact operation name as the rate-limit bucket key, not merely mention either limiter somewhere in its source segment.
- This guards against accidental copy/paste errors that would make unrelated callable quotas share one bucket or bypass the intended operation-specific quota.
- The baseline callable-coverage guard passed both CI jobs in run [39418278746](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39418278746). The first attempt exposed a test-only escaping error in a dynamically built regular expression (CI run [39418845301](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39418845301)); replaced it with a simpler extraction of the limiter call and an exact operation-key assertion. Reverification is pending.
- Production remains blocked on separate-project App Check configuration/enforcement, deployed alerts, quota calibration, Firestore TTL configuration, and privacy/operational readiness.

## Guard against unthrottled callable additions — 2026-10-20

- Added a Functions unit-test guard that discovers every exported `onCall` handler in `functions/src/index.ts` and fails if its handler body does not invoke the transactional mutation limiter or read limiter.
- This is a regression guard against adding a new callable that accidentally bypasses server-side quota enforcement. It does not prove quota values are appropriate or replace runtime emulator coverage. CI verification pending.

## Verify expired mutation rate-limit bucket reset — 2026-10-20

- Extended the emulator-only quota seeder to support the createOrganisation bucket, while keeping it restricted to the local demo emulator and fixed operation allowlist.
- Added an end-to-end smoke assertion that seeds an expired, exhausted one-hour organisation-creation quota, invokes the callable, and verifies the transaction starts a fresh window with count 1 and correctly advanced expireAt metadata.
- This complements expired read-quota coverage and confirms the mutation path also relies on persisted window state rather than stale TTL metadata. CI verification pending. App Check, production alert policies, quota calibration, privacy and operational readiness remain release blockers.

## Verify server-managed rate-limit expiry metadata — 2026-10-20

- Added a local-emulator-only assertion script and wired it into the smoke test immediately after the first successful `listMyOrganisations` call.
- The integration assertion reads the quota document using the same SHA-256 tuple key and verifies that `expireAt` is a Firestore Timestamp exactly equal to the persisted window start plus the 60-second window and five-minute grace period.
- The assertion refuses to run unless the project is `demo-growth-engine-test` and Firestore is the local emulator. This verifies expiry metadata, not actual TTL deletion; enabling and validating TTL in the separate project remains an operational step.
- CI verification pending. App Check, production alert policies, quota calibration, privacy and operational readiness remain release blockers.

## Rate-limit quota document lifecycle groundwork — 2026-10-20

- The shared quota writer now sets a server-managed Firestore `expireAt` timestamp at the actual fixed-window end plus a five-minute grace period. Repeated requests preserve the same window-based expiry; a reset window advances it.
- This is only lifecycle groundwork: the quota evaluator still enforces windows and fails closed on malformed state. Firestore TTL is not enabled by repository code and must be configured and verified separately in the intended Firebase project.
- Corrected the runbook warning label to match the neutral `Rate limit exceeded` log message and updated the lifecycle instructions.
- CI verification pending. No production deployment; App Check, alert policies, quota calibration, privacy and operational readiness remain release blockers.

## Clarify rate-limit log wording for read and mutation calls — 2026-10-20

- The rate-limit helper is shared by all mutation and paginated read callables, so its warning message incorrectly labelled exhausted read quotas as mutation events.
- Changed the warning text to the neutral `Rate limit exceeded`; structured fields and enforcement behavior are unchanged.
- The preceding batch passed CI run [39410924491](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39410924491), including Firebase Functions tests/build and emulator integration coverage for all four paginated read quotas. This logging correction is pending CI.

## Verify rate limits on every paginated read callable — 2026-10-20

- Extended the local-emulator-only rate-limit fixture seeder to support `listCampaigns` and `listOutreachDrafts`, with each operation's actual quota boundary (120/minute for campaigns, 60/minute for drafts).
- Added emulator smoke assertions that exhausted campaign-list and draft-list quotas return `functions/resource-exhausted`, complementing the existing lead-list and organisation-list coverage.
- This checks all four paginated read callables end-to-end. CI verification pending; limits remain provisional, and production App Check, alerting, quota calibration, and privacy/operational controls remain blockers.

## Organisation-list quota fixture allowlist correction — 2026-10-20

- CI run [39408488685](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39408488685) confirmed the prior fix accepted the exact `global` bucket, but the emulator smoke test still failed because the seeder's operation allowlist had not included `listMyOrganisations`.
- Expanded only the fixed operation allowlist to include the organisation-list quota fixture already described in its usage message. The seeder remains restricted to the local demo emulator, exact `global` sentinel or validated organisation IDs, and the existing known operations.
- Full CI verification pending. No production deployment; App Check, alerting, quota calibration, and privacy/operational controls remain release blockers.

## Organisation-list quota fixture validation fix — 2026-10-20

- CI run [39408134212](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39408134212) passed Functions tests/build but the emulator smoke test failed before asserting the new quota: the local-only seeder rejected the special `global` bucket used for the cross-organisation listing quota.
- Updated the seeder's organisation-key guard to allow the exact `global` sentinel while continuing to validate ordinary organisation IDs and restricting the operation allowlist. Re-running CI to verify the regression.

## Organisation-list read quota coverage — 2026-10-20

- CI for commit `c71f984babd413200c9d9851fd7e5b3a88d5d3fa` passed both Firebase Functions and frontend jobs (run [39406076932](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39406076932)).
- Follow-up audit found `listMyOrganisations` was not actually consuming the documented 120/minute per-user global quota. Added the quota before cursor and collection-group reads, expanded the local-only seeder allowlist, and added emulator coverage for the exhausted quota.
- Verification is pending CI. This remains development-only; App Check, alerting, quota calibration, and operational/privacy controls still block public production use.

## Concurrent mutation rate-limit regression — 2026-10-20

- Added a deterministic emulator test that seeds the `updateLeadNotes` counter one request below its 240-request quota and dispatches five concurrent requests for the same user/organisation/operation.
- Expected exactly one successful mutation and four `functions/resource-exhausted` responses; only the successful request may change lead data. This tests Firestore transaction conflict/retry behaviour at the quota boundary, not just sequential checks.
- The local-only seeder now supports a `boundary` state (count 239) and remains restricted to the demo emulator and fixed operation. CI run [39401203117](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39401203117) passed both jobs, including emulator integration.

## Invalid persisted rate-limit state integration regression — 2026-10-20

- Extended the local emulator quota regression to seed both an exhausted quota and a malformed persisted counter for `updateLeadNotes`.
- The expected behavior is `functions/resource-exhausted` for the exhausted counter and `functions/failed-precondition` for malformed state; both rejected calls must leave the lead unchanged.
- The seeder remains restricted to the local demo Firestore emulator and the fixed operation. CI run [39400377207](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39400377207) passed both jobs, including emulator integration.

## Rate-limit boundary regression correction 3 — 2026-10-20

- CI run `39399726469` confirmed the seeded quota was enforced and logged `resource-exhausted`, but the final no-side-effect assertion searched `lead.leadId` instead of the API's `lead.id`, so it could not find the unchanged record.
- Corrected the post-call lookup to use `id`. This correction is pending CI verification.

## Rate-limit boundary regression correction 2 — 2026-10-20

- CI run `39399378339` reached the quota assertion but the callable returned `functions/invalid-argument`: `listLeads` exposes the document key as `id`, not `leadId`.
- Corrected the test to use the documented `id` field. This test correction is pending CI verification.

## Rate-limit boundary regression correction — 2026-10-20

- First CI attempt `39399069087` failed because the original lead was no longer present in the default first page after the pagination fixture had inserted many newer records.
- Corrected the integration test to select a lead from the current first page and then assert that same lead's notes are unchanged after the rate-limited mutation.
- This correction is pending CI verification.

## Rate-limit boundary integration regression — 2026-10-20

- Added a local-emulator-only quota seeder restricted to the demo project, local Firestore emulator, and the fixed `updateLeadNotes` operation.
- Extended the emulator smoke test to seed an exhausted quota, assert the callable returns `functions/resource-exhausted`, and verify the protected lead notes remain unchanged.
- CI verification is pending for this change. The fixture does not configure production quotas or create cloud resources.

## Structured rate-limit logging — 2026-10-20

- Added Cloud Functions structured warning logs when mutation quotas are exhausted and error logs when stored quota state or quota configuration is invalid.
- Events include operation, a SHA-256 quota key, configured request/window limits, and retry duration; raw user IDs and organisation IDs are intentionally omitted.
- CI run [39398354009](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39398354009) passed both jobs for commit `83c5138732051e1d87a0dc2c1a225f381f6efad3`, including Functions tests/build and the emulator integration suite. Alert policies, log retention and incident-response procedures still need configuration in the separate Firebase project. This is observability groundwork, not a production readiness claim.

## Transactional mutation rate limits verified — 2026-10-20

- CI run [39397754995](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39397754995) passed both jobs for commit `0ea93bf11d90886150ea22ecdf949475488673e9`: frontend typecheck, all 259 unit tests, production build, Firebase Functions tests/build, and emulator integration smoke tests.
- The emulator integration exercised the existing synthetic pagination workload with transactional quotas enabled; the Firestore read-before-write ordering correction and adjusted per-operation quotas are verified by the full suite.
- Quotas are initial guardrails, not a production certification. Monitoring/alerts, App Check, rate-limit calibration against real traffic, and operational recovery/privacy controls remain outstanding. No production deployment; outreach remains draft-only.

## Tune quotas for pagination integration coverage — 2026-10-20

- CI run [39397419151](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39397419151) passed Functions tests/build but the emulator smoke suite hit the 10/minute campaign-creation quota while creating 99 synthetic campaigns through the callable to verify pagination.
- Raised campaign creation to 150/minute and draft creation to 200/minute so the existing 100-record callable pagination regression can run while quotas still bound sustained request volume. Lead creation remains 200/minute. These are initial settings and must be recalibrated with observed legitimate traffic before public release.
- Full CI verification pending; no deployment or automated outreach sending.

## Tune initial mutation quotas to accommodate integration workloads — 2026-10-20

- CI run [39397141770](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39397141770) confirmed the Firestore read/write ordering correction, but the emulator suite then reached the initial 60/minute createLead quota during its high-volume synthetic regression run.
- Raised initial limits to createLead 200/minute, contact edits and suppression 120/minute, status/notes 240/minute, draft creation 100/minute, draft edits/deletion 120/minute. Campaign limits remain 10/minute for creation and 30/minute for status changes; organisation creation remains 5/hour. All remain transactionally enforced per user, organisation and operation.
- These are initial conservative service guardrails and require production traffic calibration plus monitoring. Full CI verification pending.

## Rate-limit transaction ordering correction — 2026-10-20

- CI run [39396886505](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39396886505) passed frontend typecheck, 259 unit tests, production build, and Functions unit tests/build, but emulator integration exposed that the quota helper queued a write before some protected callables finished reading their target documents.
- Moved quota consumption to after all transaction reads and immediately before the protected mutation writes. This preserves atomic quota enforcement while respecting Firestore's read-before-write transaction requirement. Full CI rerun pending.
- Remain on development/chatgpt-mvp; no production deployment or automated outreach sending.

## Transactional rate limiting for mutation callables — 2026-10-20

- Added server-side fixed-window quotas scoped to user, organisation, and operation. Quota documents use a SHA-256 digest rather than storing identifiers in the document path.
- Quotas are consumed in the same Firestore transaction as each protected mutation, so concurrent requests cannot race past the counter. Initial limits: organisation creation 5/hour; campaign creation 10/minute; campaign status 30/minute; lead creation/contact edits/suppression 60/minute; lead status/notes 120/minute; draft creation 20/minute; draft edits 30/minute; draft deletion 60/minute.
- Malformed stored quota state fails closed; exhausted quotas return resource-exhausted. Added pure unit tests for window start, quota boundary, expiry, clock rollback, and malformed state.
- CI verification pending. Limits are initial safeguards, not a substitute for monitoring, App Check, or provider-level abuse controls. No production deployment; outreach remains draft-only.

## Return authoritative contact-review state from lead edits — 2026-10-20

- Updated updateLeadContact to return the server's resulting doNotContact, contactReviewStatus, and contactRestrictionVerified values alongside the edited fields.
- This makes the callable response reflect when an email, phone, or website edit has reset review to pending, and when a metadata-only edit preserves a valid clearance. Updated the frontend API response type and added emulator assertions for both paths.
- CI run [39395349806](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39395349806) passed both jobs for commit `0f7240c13e871e5eefc519731c8f918e31d87c21`: frontend typecheck/tests/build and Firebase Functions tests/build with emulator integration. Synthetic emulator coverage only; no deployment and no automated outreach sending.

## Contact-review metadata-edit regression added — 2026-10-20

- Added emulator integration assertions that changing a lead's business name/category/location while preserving email, phone, and website does not reset an explicit contact-review decision.
- The test verifies the record remains explicitly contactable only because its persisted restriction is still `doNotContact: false` and review state remains `cleared`; the adjacent channel-change cases still require fresh review.
- Verification is pending the next CI run. This is synthetic emulator coverage only; no production Firebase deployment and no automated outreach.

## Cross-organisation pagination cursor tests verified — 2026-10-20

- Corrected the smoke-test ordering in commit `d4a90c470f7e944de621823719782219e697d98d`.
- CI run [39393304067](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39393304067) passed both jobs: frontend typecheck/tests/build and Firebase Functions tests/build with emulator integration.
- Campaign, lead, and outreach-draft list calls now exercise rejection of foreign-organisation cursor paths after the second synthetic organisation exists. Cursor-only target IDs ensure the assertion tests path scoping before target lookup.
- Continue only on `development/chatgpt-mvp`. No production Firebase deployment; outreach remains draft-only.



## Cross-organisation cursor smoke-test ordering correction — 2026-10-20

- CI run [39393008760](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39393008760) passed frontend typecheck, all 250 frontend/unit tests, build, and Firebase Functions tests/build, but emulator integration failed because the new cross-organisation cursor assertions referenced `orgTwo` before its declaration.
- Moved those three assertions until after the second synthetic organisation is created, and changed cursor targets to deliberately nonexistent cursor-only IDs. This isolates the property under test: reject a foreign-organisation path before trying to read its target document.
- Full CI verification is pending. No production Firebase deployment or outreach sending; continue only on `development/chatgpt-mvp`.


## Cross-organisation pagination cursor rejection — 2026-10-20

- CI run [39388129286](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39388129286) passed both jobs for commit `02b359d269184b0266065423f826f07765cf1c53`, including organisation, campaign, lead, and outreach-draft pagination over 100 synthetic records.
- Added emulator assertions that a syntactically valid campaign, lead, or draft cursor belonging to a different organisation is rejected with `functions/invalid-argument` when used against the first organisation.
- This is regression coverage for tenant boundaries in pagination; verification of the new assertions is pending CI.
- Keep this branch isolated; no production Firebase deployment, real provider/customer data, or automated outreach.

## Tenant-scoped collection pagination integration coverage — 2026-10-20

- Latest CI run [39387266054](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39387266054) passed both jobs for commit `f573beae04e37d9a94b0a7d0f196d6c60edbe876`, including the 105-organisation pagination emulator test.
- Added emulator-only fixtures for 105 campaigns, 105 leads, and 105 outreach drafts in one synthetic organisation; the smoke test now walks every page and asserts each fixture appears exactly once, continuation tokens terminate, and valid draft/lead review states remain intact.
- The new seed script refuses to write outside the local `demo-growth-engine-test` Firestore emulator. Verification of this follow-up batch is pending CI.
- Keep this branch isolated; no production Firebase deployment, real provider/customer data, or automated outreach.

## Organisation pagination integration coverage — 2026-10-20

- CI run [39386902786](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39386902786) passed both jobs for commit `ef53bf6a7e7a485742be46cc0f85238674fff05a`: frontend typecheck/unit tests/build plus emulator smoke tests, and Firebase Functions tests/build.
- Added end-to-end emulator coverage that seeds 105 synthetic organisation memberships for the authenticated test user, pages through the callable, checks termination and continuation tokens, and asserts all 105 fixture organisations appear exactly once.
- The fixture script is guarded to refuse writes unless running against the local `demo-growth-engine-test` Firestore emulator. Verification of this new pagination coverage is pending CI.
- Keep this branch isolated; no production Firebase deployment, real provider/customer data, or automated outreach.

## Extend contacted-status integration coverage for malformed contact restrictions — 2026-10-20

- Added emulator assertions that leads with a missing `doNotContact` value or malformed string value cannot be transitioned to `contacted`, even when legacy review metadata says `cleared` and the referenced campaign exists.
- The backend already uses an explicit-false contact gate; this batch adds direct callable regression coverage so the safety property is tested end-to-end, not only through pure helper tests or draft creation.
- Verification pending CI. Keep the change on `development/chatgpt-mvp`; no production Firebase deployment and no outreach sending.

## Successful CI verification — 2026-10-20

- CI run [39379763922](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39379763922) completed successfully for commit `3747dfe4f18c022d887ea795fde19a4ebbe7ddc0` on `development/chatgpt-mvp`. Both jobs passed: frontend typecheck/unit tests/production build plus emulator smoke tests, and Firebase Functions authorization tests/build.
- The previous run had correctly started rejecting a malformed organisation pagination cursor, while the smoke test still expected the older permissive behaviour. The smoke test now expects `functions/invalid-argument`, matching the fail-closed cursor validation.
- README limitations/roadmap updated to distinguish passing emulator CI from the still-unconfigured dedicated Firebase project and production readiness. Do not deploy, connect production AnyTrader data, or enable automated outreach; outreach remains draft-only.

## Suppression authorization TypeScript guard follow-up — 2026-10-19

- CI run [39334559481](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39334559481) exposed a TypeScript strict-nullability issue in the new transaction guard: the membership validator returns a boolean, so TypeScript did not infer that the membership data object exists after validation.
- Added an explicit null/undefined check before accessing the current membership role. This is a type-safety correction to the fail-closed membership check; it does not relax authorization.
- The frontend job's typecheck, 211 tests, and production build passed, but the emulator smoke step was blocked because the Functions TypeScript build failed on the same compiler error. Functions authorization unit tests (129) passed.
- Verification pending for the fix commit. Keep all changes on `development/chatgpt-mvp`; Firebase deployment remains deferred and outreach remains draft-only.

## Transactional suppression authorization — 2026-10-19

- CI run [39334305213](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39334305213) passed both frontend and Functions jobs for commit `131b74739251945146f74a8de108dbc92bdf07ca`, including the emulator regression that rejects `contacted` status when the lead's campaign record is missing.
- Continued the authorization audit: `setLeadSuppression` previously checked the caller's role before entering the transaction. A role demotion between that check and the write could leave a stale authorization decision.
- The suppression mutation now re-reads and validates the caller's membership inside the same Firestore transaction as the lead update, and re-checks both lead-write permission and the owner/admin requirement for clearing restrictions. Existing member/viewer emulator assertions continue to cover the role matrix.
- Verification pending for this follow-up commit. Keep changes on `development/chatgpt-mvp`; Firebase project setup/deployment remains deferred, and outreach remains draft-only.

# Development continuation: security and implementation queue

Branch: `development/chatgpt-mvp`

This is a source-inspection work queue, not a certification or test report.

## Confirmed from source inspection
- Callable functions require an authenticated UID.
- Organisation membership is checked server-side for organisation-scoped reads and writes.
- Campaign writes require owner/admin; lead and draft writes require owner/admin/member.
- Suppression removal requires owner/admin.
- Draft creation and editing check the associated lead's suppression state inside a Firestore transaction.
- `listOutreachDrafts` resolves current lead records and returns `leadSuppressed`, `requiresReview`, and `reviewReason`; missing lead records and records without an explicit boolean `doNotContact: false` are flagged for human review (fail closed).
- The cloud UI displays a warning for drafts needing review and disables editing while the warning applies; deletion remains available.
- UI regression tests cover the suppression warning/edit lock, loading a second organisation page, clearing previous-tenant records during workspace switching, and ignoring stale responses after a tenant switch.
- Workspace data refreshes ignore stale asynchronous results and clear tenant-scoped data on sign-out, when no organisation is selected, and immediately when switching organisations; draft editing state is cleared at the same boundary.
- Organisation listing now uses a validated Firestore membership cursor token, fetches 101 records to determine whether more pages exist, returns 100 per page, and provides a UI Load more control. Tokens are checked server-side for expected path shape and ownership by the signed-in UID.
- The organisation pagination UI merges additional pages without replacing the existing list and has a regression test for loading a second page.
- Pure authorization tests now cover missing, suppressed, unverified, and explicitly contactable draft review states, plus organisation pagination token path/UID validation.
- The typed frontend API has a regression test for forwarding a pagination token to the callable.
- The emulator smoke script checks a suppression restriction added after draft creation, including list warning and server-side rejection of draft edits. It checks that one organisation cannot list another organisation's leads, campaigns, or outreach drafts, create a lead using another organisation's campaign, or create/update/delete a draft using another organisation's records.
- Draft creation and editing now verify that the lead's campaign document exists within the same organisation, and fail closed if the campaign reference is missing.

## Verification status as of 2026-10-20

The previous “Work required before Firebase connection” checklist is historical and has now been exercised in CI on the isolated development branch:

- [x] Frontend typecheck, unit tests, and production build pass in CI.
- [x] Firebase Functions authorization unit tests and TypeScript build pass in CI.
- [x] Emulator integration passes in CI, including cross-tenant access checks, suppression/contact-review gates, campaign-reference checks, malformed contact restrictions, and 105+ pagination fixtures for organisations, campaigns, leads, and drafts.
- [x] Foreign-organisation pagination cursors are rejected; malformed organisation owner membership records fail closed.
- [x] The emulator smoke test runs in the dedicated demo project ID against local emulators only.

Latest verification: CI run [39395349806](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39395349806) passed both jobs for commit `0f7240c13e871e5eefc519731c8f918e31d87c21`.

## Remaining blockers and limitations

- **Not production ready.** App Check is not enforced; the separate Growth Engine Firebase project and valid app/provider configuration are still prerequisites.
- Server-side per-user/per-organisation rate limiting, monitoring, budget alerts, retention/deletion/offboarding, backups, and recovery procedures remain to be implemented or operationally verified.
- Provider terms, contact permissions, privacy, and marketing requirements must be reviewed before any outreach use.
- Keep using synthetic data only. Do not connect production AnyTrader data, deploy to a public production environment, or enable automatic outreach. Outreach remains draft-only.

## Latest security audit updates
- The shared `requireMembership` guard now validates that the membership document's stored UID matches the authenticated caller and that the role is one of `owner`, `admin`, `member`, or `viewer`. Malformed membership records fail closed.
- The organisation listing also verifies that the membership document ID matches the caller UID, in addition to checking its stored UID and role. This prevents malformed membership documents from appearing as valid workspace entries.
- Added unit coverage for the shared membership record validator.
- Workspace refresh now clears tenant-specific records and draft-editing state immediately while a newly selected organisation loads; a regression test was added.
- These changes are committed. An isolated Functions TypeScript build completed successfully, and `node --check scripts/emulator-smoke-test.mjs` passed. The Functions Vitest run crashed with `Bus error` before reporting tests; frontend checks and emulator integration remain unverified.

## Next build focus
Continue the callable authorization audit and integration-test reliability work; resolve the emulator transaction timeout and run the expanded cross-tenant tests before Firebase connection. Keep all changes on `development/chatgpt-mvp`; do not modify `main` or the original AnyTrader repository.


## Latest implementation note (2026-10-19)
- `listOutreachDrafts` now uses Firestore Admin SDK `db.getAll(...refs)` to batch-fetch the distinct associated lead documents rather than starting up to 200 separate read promises. Results are associated to lead IDs by the input order returned by Firestore. This is a source-level performance improvement only; it has not been freshly built or integration-tested in the current environment.
- Still required: verify the batch-read mapping with unit/emulator tests, add explicit emulator cases for missing/malformed suppression fields and cross-tenant list operations, and run the 101+ organisation pagination test.

- Lead listing now exposes `contactRestrictionVerified`; the cloud UI shows `REVIEW RESTRICTION` and disables draft creation when `doNotContact` is missing or malformed instead of displaying the lead as contactable. A UI regression test covers this fail-closed state. This change is source-committed but still requires execution of the frontend tests and build.

- Follow-up authorization review found that `updateLeadStatus` previously blocked status `contacted` only when `doNotContact === true`. A legacy or malformed lead with a missing/non-boolean restriction could therefore be marked contacted through a direct callable request even though the UI showed `REVIEW RESTRICTION`. Added `canMarkLeadContacted`, which permits that transition only when `doNotContact === false`, and added pure authorization tests for true, undefined, null, and string values. The callable now returns a failed-precondition error for suppressed or unverified restriction states. Source committed; tests have not yet been run.
- Follow-up UI review now also keeps the safe action available for malformed contact-restriction records: users can mark the lead do-not-contact, while draft creation remains disabled. Removing a restriction continues to be enforced by the server's owner/admin authorization. Added a regression assertion for the enabled Suppress action. Source committed; frontend tests/build still pending.
- Build-environment follow-up (2026-10-19): found the root `package-lock.json` was physically truncated at 40,335 bytes and invalid JSON. Restored the last valid lockfile version from repository history; verified it parses as JSON and contains 282 package entries. Commit: `083e8f2cbccce42a2457eaab76427ee537aef883`. Attempts to install dependencies in the constrained remote workspace were killed or timed out before `tsc` became available, so typecheck, tests and build are still unverified. The workspace has Node 20; Functions require Node 22.

- CI scaffolding added on 2026-10-19 in `.github/workflows/ci.yml` (commit `2df602b5c72868733239fd7e84a80d7c8e3e12e3`). It defines separate Node 22 jobs for frontend typecheck/unit tests/production build and Firebase Functions authorization tests/compile, plus smoke-script syntax validation. This workflow has not yet run successfully; GitHub Actions account billing/spending restrictions previously reported by the project owner may prevent jobs from starting. It is not a substitute for the pending emulator integration run.

- 2026-10-19: added cursor pagination to the tenant-scoped lead and outreach-draft list callables. Each endpoint validates that the cursor path belongs to the requested organisation and expected collection, reads at most 101 records, returns up to 100, and provides a next-page token. The frontend API and cloud workspace now expose “Load more leads” and “Load more drafts” controls with duplicate-safe merges and stale-tenant response guards. Added pure validation tests for cursor-path isolation and API tests for forwarding page tokens. Commits include `b21aabf`, `ca9d0a3`, `330e39a`, `3f267dd`, `e693d16`, `91b45eb`, `488a6a8`, and `1193919`. This is source-level progress only; frontend/Functions tests, build and emulator pagination with more than 100 records remain unverified.

- 2026-10-19: added cursor pagination for campaign listing to remove the fixed 100-campaign ceiling. The callable validates cursor paths against the selected organisation and campaigns collection, reads at most 101 documents, returns up to 100, and returns a next-page token. The backend API now accepts campaign page tokens and the cloud workspace has a duplicate-safe “Load more campaigns” control guarded against stale tenant responses. Added validator and API regression coverage. Source changes are committed; runtime tests/build and Firestore cursor behaviour remain unverified until dependencies and emulator execution are available.


- 2026-10-19 follow-up: campaign pagination reset state is now cleared on sign-out, organisation deselection, and tenant switches, preventing a previous tenant's continuation token or loading state from lingering. Added a cloud UI regression test for loading a second campaign page while retaining the first page. Commits: `28f7cf5bd6d682329eb934009286cd395e195f8d` and `81db9f38cf8bafeae96901e40396351bb44a0bb8`. This is source-reviewed only; the test suite and build have not been executed in the current constrained environment.
- Additional tenant-switch regression coverage now also asserts that the previous organisation's campaign is removed from the UI immediately, alongside its lead, before the newly selected workspace finishes loading (commit `003a7809cf2ae3e836d5b5c0ff2ac2678e7da77c`). Runtime execution remains pending.


- 2026-10-19: CSV export now prefixes spreadsheet-formula-like cell values with a text marker before CSV quoting, while preserving standard quote escaping. This is applied to every exported lead field and covered by unit cases for formula-like prefixes, leading whitespace/control characters, ordinary values, and embedded quotes. Commits: `602eecb610bebc4b911e5573a4daba802b1a6b27`, `da07f5a2dd42d541adeab9e7ce99c8c7020e7779`, `110f01a1cc0b21e63001c1825ba23bc9dfedf625`, `9c9daf06b2bedac773f198bde3db6ce3ddae588f`. Source changes reviewed, but tests/build have not been executed because the dependency/runtime verification limitation remains.


- 2026-10-19 follow-up: corrected the CSV export guard to detect actual tab/CR/LF control characters (rather than the literal backslash sequences), and tightened row parsing so quote characters in unquoted fields or non-whitespace text after a closing quote cause the row to be skipped with a warning. Added regression cases for malformed quote placement. Commits: `0fbf2bc7611fd53816c7122eac44bef515d8c1b7`, `ec61038779484912c708e54533bddad001d3bfc6`, `f74c67a46047f4110d46fbe211d9a214e8a2088b`, `219b49435924ef6ca466e1f3bbcdaa4628c660fb`. Tests remain unexecuted. The importer still processes physical lines independently, so valid quoted fields containing embedded newlines are not supported yet; implement a record-aware parser before claiming full CSV compatibility.

- Follow-up test fixture correction: malformed-quote regression cases now use actual newline separators so they exercise distinct physical CSV rows. Commit: `550f9444e1a9d83a3bce6718aa927aa63dbd332a`. Still not executed.


- 2026-10-19 contact-review safety follow-up: server-created leads now default to `doNotContact: true` until an owner/admin explicitly clears the restriction after review; the callable response reflects the same safe default. The emulator smoke script now asserts this default and expects draft creation to fail before clearance. Frontend draft-creation helper now permits only explicit `doNotContact === false`, with a regression test for an unverified/missing value. Commits: `c586bba19dc4e3d43d93a5d4aecaec23dceb811b`, `842058057d8db6c9fe5e6e1cae2574bfae617be3`, `e75f0905d410f0342ec51c636fbcbf32ee49d75b`, `966199c143de0fadcffba41dd010c5636decf947`. Not runtime-tested yet. This gate is a conservative workflow safeguard, not a determination of lawful basis or permission to contact; users must verify data source, applicable privacy/marketing rules and consent/lawful basis independently.

- Local-demo parity follow-up: CSV-imported leads in the browser demo now also default to `doNotContact: true`; the import UI regression test asserts the restriction badge appears and the Draft action is disabled until the user explicitly reviews the record. Commits: `b95861c811a5d6860c040f5866474e48cf160adf`, `7c820fb38e2d679065340fe33ac7c5bb26bc03d1`. Not runtime-tested yet.

- CSV field validation follow-up: local CSV import now rejects rows with lead fields exceeding the same length limits enforced by the server (business name 160, category 100, location 160, website 500, email 254, phone 80) and rejects malformed non-empty email addresses. The regex was checked and corrected to use actual whitespace matching. Commit: `85b246f161f7a57b49c48319005759d0a895a00f`, correction: `ee212fe71ac7c22524ef3c368e66e74592f0dee1`. Dedicated regression tests could not be added in the latest attempt, and no tests/build have run; add tests and verify these changes before treating them as complete.


- 2026-10-19 follow-up: introduced `contactReviewStatus` (`pending`, `cleared`, `blocked`) in the local lead domain and CSV-import flow, updated local lead and draft badges to distinguish pending review from confirmed suppression, and gated local contacted-status transitions on review clearance. The cloud workspace now explicitly clears pending review and disables that action for non-admin roles; backend contacted-status validation also checks review status. Added regression coverage for the draft/contacted gates and emulator smoke assertion. Relevant commits: `cc7e1a2`, `0ee6f3a`, `ca47dcc`, `0cd0b6e`, `732ad1e`, `77539b9`, `e5ba335`, `355f85c`, `b2f69bb`, `d28aca5`, `a3148d8`, `3914cc7`. Tests and build remain unexecuted.

- Additional UX follow-up: the local demo contact filter now separates “Needs contact review” from “Do not contact” and “Review cleared”, so a pending review is not mislabeled as a confirmed opt-out in filtering. Regression coverage checks that pending CSV-imported leads appear in the review filter and not in the do-not-contact filter. Commits: `14b7590`, `f3d37f6`. Tests remain unexecuted.

- CSV parser follow-up: added record-level scanning so quoted fields can contain embedded line breaks while preserving physical source-line numbers for later validation errors. Added regression coverage for a multiline location field followed by an invalid email row, and adjusted unmatched-quote recovery to preserve a later valid row when no closing quote exists. README now documents the supported multiline case and notes that the parser remains a lightweight MVP implementation. Commits: `d373f23`, `fc6eb87`, `aa5d4a0`, `538d5b7`, `f885753`. Source reviewed only; unit tests/build have not run, so this parser change remains unverified at runtime.

- Further contact-state edge-case follow-up: local draft buttons now use the shared `canCreateOutreachDraft` gate instead of only checking the boolean suppression field; local filters and lead-detail controls also treat `contactReviewStatus: blocked` as suppressed if the boolean field is inconsistent. Commits: `de36ab5`, `39d0523`, `abd09c7`. Source checks confirm the intended branches are present; tests/build are still not executed.

- Draft editing follow-up: local demo edit controls and the save handler now both require the shared contact-review gate to pass. Existing drafts remain visible with review/suppression warnings but cannot be edited while their lead is pending or restricted, matching the cloud workflow. Added a regression assertion for a draft whose lead is subsequently suppressed. Commits: `e1e7270`, `1b3cbf5`. Runtime tests/build remain unverified.

- 2026-10-19 follow-up: authorization review found that existing-draft review-state messages used the same wording for pending review and malformed/unverified contact restrictions, while unit expectations distinguished them. The helper now reports pending review separately and uses an unverified-restriction warning for missing/malformed restriction state. Source committed as `adeb14709d46a1cf79cbae029d1599030561dfe4`; Functions tests have not been run, so this is not runtime-verified.
- CSV parser follow-up: adjusted unmatched-quote lookahead to require a plausible closing quote boundary (delimiter, whitespace/record boundary, or end-of-input) rather than treating any later quote as a closer. This remains a heuristic for malformed CSV; test coverage should be expanded for unmatched quotes followed by later quoted records, and the full CSV suite must run before relying on recovery behaviour. Source commit: `17a38f15c19a3c72abe208a89e54d7963d2357f9`.
- Additional authorization regression coverage (2026-10-19): added tests asserting an explicitly `cleared` contact-review status is accepted only when `doNotContact === false`, and unrecognised/malformed statuses fail closed with an unverified-restriction warning. Commit: `27c7e2223e5b148e5bee6db0066443b08b49c2f9`. Tests are committed but have not been executed.
- CSV follow-up (2026-10-19): added regression coverage for a valid multiline field followed by a later quoted record. A proposed malformed-row recovery test was removed after source inspection showed that the current heuristic cannot reliably distinguish an unmatched quote from a legitimate multiline quoted field followed by quoted records; that ambiguity remains a known limitation. Do not treat malformed-quote recovery as reliable until the parser is redesigned around a deterministic record state machine and runtime tests pass. Commits: `d4f14ba9eb432df4944063899b1f239acf472dd5`, `72f5cf31b27c70dafb4fa9fae6b79728046171b7`. Tests not executed.
- Pagination security follow-up (2026-10-19): extended `scripts/emulator-smoke-test.mjs` with malformed/cross-collection cursor cases for organisation, campaign, lead and outreach-draft listing. These assertions are committed but not runtime-verified because the emulator smoke suite previously timed out in the constrained environment. Commit: `86527c6780578a3a1af1282a0c2e4d9776266a9f`.
- Test-structure correction (2026-10-19): source inspection found several CSV parser test cases had accidentally fallen outside the `parseLeadCsv` test suite due to an early closing brace. Moved the suite closure to after the final CSV parsing case so these cases remain registered as tests. Commit: `571907a5f2f2542a5ab6d29f03b797bb12375c2d`. This is a source-level correction only; Vitest has not been run.
- Contact-review display hardening (2026-10-19): source review found malformed review statuses could be displayed as `cleared` in the cloud lead list when `doNotContact === false`, even though the verified flag remained false. Added `normaliseContactReviewStatus`, preserving recognised statuses and mapping malformed/unverified values to a safe pending or blocked display. Added unit tests and wired the helper into `listLeads`. Commits: `0c6962bffe26f14b1864da5b36e2a82138627a1c`, `8c3a0ddb535dcaa438ad4b0d74f95daadcea3cd3`, `e5eca0da2252d7fbc6753cd290b238c431a75e5c`. Source committed; tests/build not executed.
- Test-structure correction (2026-10-19): corrected `src/domain.test.ts` so the CSV parsing cases remain inside the `parseLeadCsv` suite rather than being declared at module scope. Commit: `571907a5f2f2542a5ab6d29f03b797bb12375c2d`. Vitest has not been run.
- Contact restriction consistency follow-up (2026-10-19): tightened `normaliseContactReviewStatus` so an active `doNotContact: true` restriction cannot be displayed as cleared even if the stored review status contradictorily says `cleared`. The expected `pending` + `doNotContact: true` state remains pending for new leads awaiting review. Added regression assertions for conflicting `cleared`/`blocked` states. Commits: `d81072c2bbb48f37feebbc6ac9b5af96d8c4b599`, `e9ee6b52ce2fa3fd93e3d253f4b76f42b97e4278`. Tests not executed.
- Added additional server authorization regression assertions (2026-10-19): `canCreateServerOutreachDraft` and `canMarkLeadContacted` must reject `doNotContact: true` even when review metadata says `pending`, `cleared`, or `blocked`. This supplements the conflicting-status normalisation fix and protects the action gates directly. Commit: `0f1b108388698cc4a4448b31d8952643fb65e23d`. Tests remain unexecuted because the current environment has not produced a successful test run.
- Draft-review consistency fix (2026-10-19): `getOutreachDraftReviewState` previously treated `doNotContact: true` + `contactReviewStatus: "pending"` as review-pending but not suppressed. This contradicted the explicit restriction and could understate the restriction in existing-draft warnings. The helper now treats any `doNotContact: true` or `contactReviewStatus: "blocked"` as suppressed, regardless of conflicting metadata. Updated regression tests for pending and cleared contradictions. Commits: `86a007c3de9d529c4e75c448caa7947e8e7a68ac`, `1d60074668ca7ecdac63e8cd8dea2f60c0e1851e`. Tests not executed.
- Draft/lead campaign relationship integrity (2026-10-19): added `hasConsistentDraftCampaign` to reject missing, malformed, or mismatched campaign IDs between a draft and its associated lead. `listOutreachDrafts` now flags inconsistent relationships for human review, and `updateOutreachDraft` refuses to edit a draft with a mismatched relationship. Added unit assertions for matching IDs, mismatches, missing values, null, and unsafe IDs. Commits: `939f45f2b4edef6682e53466c027ec1b9e7d8688`, `a10e9f76fe24f9814db55cd6f21b35af945c3203`, `487460b804910aa89eb64e2cf3dce7e39e59042f`. Tests not executed.
- Follow-up correction (2026-10-19): code review caught the campaign-consistency guard initially landing in `createOutreachDraft`, where the newly generated draft has no `campaignId` field until the lead is read. Moved that guard to `updateOutreachDraft`; draft creation continues deriving `campaignId` from the lead and verifying the campaign exists in the same transaction. Commit: `9d7745983aced9f88f8144a8ece6b1488c338e81`. Runtime tests remain unexecuted; re-check draft creation and editing during the next available test run.

- 2026-10-19 cleanup resilience: `deleteOutreachDraft` previously validated the stored draft `leadId` as a hard precondition, so a malformed legacy draft could not be deleted through the normal cleanup UI/API. The delete callable now permits deletion while recording an activity entry that omits the invalid lead reference and explicitly notes the malformed record. Commit: `b00cbe4da1ff3eb5b1b0cc4e4bdbaf8d05d02eab`. Source-inspected only; Functions tests/build and emulator checks have not run successfully.

- 2026-10-19 error-message consistency: both `createOutreachDraft` and `updateOutreachDraft` now describe the lead as suppressed whenever `doNotContact === true` or `contactReviewStatus === "blocked"`, including the contradictory `doNotContact: true` + `contactReviewStatus: "pending"` case. Previously, that conflict could produce a pending-review message instead of the explicit suppression message even though the action was correctly rejected. Commit: `e18d96264e185ce49fca9e5e0d45476e6614a4f4`. Source inspected; runtime tests remain pending.

## Six-workstream batch — 2026-10-19

1. **Callable authorisation audit:** reviewed the exported callables in `functions/src/index.ts`. Organisation-scoped reads/writes check authenticated UID and membership; campaign mutations use owner/admin permission; lead/draft mutations use owner/admin/member permission; suppression clearance remains owner/admin-only. Document references are validated and resolved under the supplied organisation path. Existing Firestore rules deny direct client reads/writes. This is a source review, not a substitute for emulator tests.
2. **Tenant/reference integrity:** reviewed organisation-scoped campaign, lead, and draft references plus pagination-token path checks. Draft creation/update verify the lead/campaign relationship and current contact gate in transactions; listing flags mismatched/missing relationships. Existing smoke checks exercise cross-tenant access but have not completed successfully in the constrained environment.
3. **CSV import safety:** added a guard that rejects a custom CSV mapping when one source column is assigned to multiple fields, avoiding silent copying of one value into unrelated fields. Regression test added. Commits: `33c16a9b573dbfa41e4ab1dc67c71e41af975202`, `d6151bfc763bc417073d241c60ca10b2ad283977`.
4. **Regression tests:** added a focused ambiguous-mapping test. Existing authorization and CSV suites already cover malformed identifiers, role boundaries, contradictory suppression metadata, malformed CSV quotes, duplicate headers, length limits, invalid emails, and formula-injection-safe export. Test execution is still pending.
5. **CI/verification:** checked and repaired the Node 22 frontend and Functions workflow after adding a tracked-credential guard; both jobs remain configured for install, typecheck/tests/build (plus smoke-script syntax validation). Commit: `86614674c1a35bc24cfd0da67c420af619f876d6`. GitHub Actions has previously been blocked by account billing/spending limits, and local dependency installation has timed out, so no successful test/build claim is made. Re-run CI after the billing restriction is resolved.
6. **Firebase readiness:** added ignore patterns for Firebase emulator state and common service-account credential filenames in `.gitignore` (commit `5709b26a2ca74e1e602b5738fd0c6661b47a7494`). Keep Firebase unconfigured until a dedicated Growth Engine project is created. Before any real-data launch, configure Auth/Google provider, Functions, Firestore, App Check/abuse controls, billing alerts and authorised domains, then pass emulator tenant-isolation checks. Never commit service-account keys or connect this tool to production AnyTrader Firebase.

**Current status:** the code/docs changes above are committed on `development/chatgpt-mvp`. Automated tests, production builds and full emulator checks remain unverified. No production deployment or Firebase project was created.

## Next six-task batch — 2026-10-19

1. **CSV whitespace parser fix:** corrected the post-quote whitespace matcher so it recognises actual whitespace instead of a literal backslash-`s` sequence. The parser now accepts whitespace before a quoted field only when that prefix is whitespace, while continuing to reject non-whitespace characters before the opening quote and trailing text after the closing quote. Commit: `9dd4c4ebcf120d76ca3907bfe329b38d6c347808`.
2. **CSV regression coverage:** added tests for leading/trailing whitespace around quoted fields and confirmed that trailing non-whitespace text remains rejected. Commit: `15670437f78edb6a0a9a7da2c9725d80d728a94c`. These tests are committed but not yet executed.
3. **Backend input-validation smoke checks:** expanded the emulator smoke script to verify server-side rejection of malformed email addresses and business names exceeding the 160-character limit. Commit: `80aad25d99e88b2b02acb0b14b79dc3a4ef776a9`. Emulator execution remains pending.
4. **Credential ignore coverage:** expanded `.gitignore` to cover private-key files and common exported credential containers (`.pem`, `.key`, `.p12`, `.pfx`, `id_rsa`, `id_ed25519`). Commit: `b3b64220726902a2358ba90653d5d36f5c39cf56`.
5. **CI credential guard:** expanded the workflow's tracked-file check to catch those private-key and credential-container patterns in addition to environment files and Firebase service-account JSON. Commits: `71f6a7cd2ead1f02b3e01664c93f34c345798074`, followed by a correction restoring the complete shell pipeline: `2c71902b65480d7b5a94de88e416ae3227beb6cc`. The final guard expression was re-fetched and checked.
6. **Post-change verification review:** re-fetched the changed files from `development/chatgpt-mvp` and reviewed the inserted code and workflow structure. GitHub combined status currently has no reported checks for the inspected commit; dependency installation, tests, build and emulator execution have not been demonstrated as passing. No Firebase setup/deployment was performed.

**Batch status:** source changes are committed. Runtime verification remains a release blocker; do not connect real provider data or deploy until CI and emulator tenant-isolation/contact-restriction checks pass.

- 2026-10-19 follow-up batch: expanded pure authorization regression coverage with a full owner/admin/member/viewer permission matrix, per-role suppression and restriction-removal checks, malformed membership-record cases, adversarial organisation/collection pagination-token cases, and contact-action fail-closed cases for malformed review metadata. Commits: `a5576340b07988760b50ef4b7410389676a826b1`, `ec4ddafc5af08cdef840d9e7c3eeb1e0ef6afb76`, `1f153ed30a6c2b7c1d275aba1096fab4d52eb605`, `cd5511994d578c73661e70fba3b9e75b1131891a`, `859dab6c48b47d4815a0c743c6079f4a6fd6b46c`. These are committed source-level test additions only; they have not been executed in the current environment.
- Remaining verification blockers are unchanged: run root typecheck/unit tests/build and Functions tests in a stable Node 22 environment; run emulator integration end-to-end; add/execute explicit 101+ organisation pagination and malformed/missing persisted contact-restriction cases; confirm the GitHub Actions billing restriction is resolved before treating CI as green. No Firebase project was configured or deployed in this batch.

## Follow-up batch — 2026-10-19 (CI and pagination regression hardening)

1. **Repaired malformed GitHub Actions workflow:** source review found that `.github/workflows/ci.yml` had become corrupted after the valid Functions job, with stray shell fragments and duplicate `functions` job keys. Replaced it with one complete frontend job and one Functions job, retaining Node 22, the credential guard, typecheck, tests, build, and smoke-script syntax check. Commit: `d733e0958c7b3a4cf03b1802f45fafc68f961f91`.
2. **Lead pagination UI regression test:** added a test that loads a subsequent lead page, preserves the first page, and deduplicates a repeated lead ID. Commit: `f926b35779e79fbf3a7243647b4d41529324ee6a`.
3. **Draft pagination UI regression test:** added equivalent coverage for outreach draft pagination and duplicate IDs. Commit: `f926b35779e79fbf3a7243647b4d41529324ee6a`.
4. **Corrected cursor test fixture:** changed the malformed organisation cursor fixture to contain an actual newline instead of the two literal characters backslash+n. Commit: `a71960c7a39778a1ad79d38b1f1b0203209351f6`.
5. **Workflow source structure review:** re-fetched the repaired workflow and confirmed it contains exactly one `frontend` job and one `functions` job, with no leftover corruption markers. This is source-level inspection, not a GitHub Actions execution.
6. **Verification status and follow-up:** test additions and workflow repair are committed, but runtime tests/build/emulator remain unverified because the CI billing restriction and local dependency-install limitations are unresolved. Do not treat this branch as release-ready until an actual CI run succeeds.

## Follow-up batch — 2026-10-19 (CI repair and green verification)

1. **Repair CI workflow structure:** removed corrupted trailing shell fragments and duplicate `functions` job keys from `.github/workflows/ci.yml`. The repaired workflow has exactly one frontend job and one Functions job. Commit: `d733e0958c7b3a4cf03b1802f45fafc68f961f91`.
2. **Fix frontend typecheck blockers:** replaced a missing Testing Library `toBeDisabled` matcher with the native button `.disabled` property and removed unsupported `api` props from `CloudWorkspace` test renders. Commits: `c40a3b8dd371a8a4c5b8a9f284d7d774147d78b5`, `edfd93403957d046ed784e842d7e40ede2b80058`, `6ddd87b0f243c75ae14680c99622026353f02d8c`.
3. **Fix Functions test isolation:** added `functions/vitest.config.ts` and pointed the Functions test script to it, preventing Vitest from loading the root Vite config from the Functions package. Commits: `eb8711f48f8cdd95fd9c88d94ae7f9014e4258b2`, `df6b2404413cdfd54b8f452592e94e23c38c09c9`.
4. **Correct authorization regression fixtures:** removed a valid lead cursor from the invalid-token cases and retained the supported legacy contact path only when review status is absent and the restriction boolean is explicitly false. Corrected the newline fixture to exercise an actual newline. Commits: `a71960c7a39778a1ad79d38b1f1b0203209351f6`, `621ac8189f8379d3ad60d8830a106689b3213332`.
5. **Fix UI test findings and add pagination coverage:** cancellation via the CSV preview close button now announces cancellation; workspace tests reset mock implementations and correctly handle campaign names appearing in both the campaign list and lead-campaign selector. Added lead and draft pagination append/deduplication tests. Commits: `cd23421270621f777babee2245c22019d650e038`, `d1b0194312a98fc4506c3b54d9c3b19f99702c95`, `f926b35779e79fbf3a7243647b4d41529324ee6a`, `842f96ba619cf304fbcb2395a900a5de6fe159e2`.
6. **Run CI and use its findings:** GitHub Actions run `39314872146` for commit `842f96ba619cf304fbcb2395a900a5de6fe159e2` completed successfully. Both jobs passed: frontend dependency install, typecheck, unit tests, production build and emulator-smoke-script syntax; Functions dependency install, authorization tests and compilation. The run URL is https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39314872146.

**Remaining release blocker:** full Firebase emulator integration and tenant-isolation checks have not been demonstrated as passing. This CI run does not deploy Firebase or validate a configured project. Keep the dedicated Firebase project deferred until the emulator suite passes.

## Emulator integration follow-up — 2026-10-19

1. **Build Functions before emulator startup:** updated `npm run test:emulators` to compile the TypeScript Functions package before starting the Firebase emulators. This avoids relying on a stale or missing `functions/lib` build output when the emulator loads the configured Functions entry point.
2. **Make emulator checks part of CI:** added Java 21 setup and a dedicated Firebase Auth/Functions/Firestore emulator smoke-test step to the frontend CI job, with a 15-minute step limit. CI will now execute the integration checks rather than only syntax-checking the smoke script.
3. **Stale pagination cursor coverage:** added integration assertions that syntactically valid campaign, lead, and outreach-draft cursor paths are rejected when the referenced document no longer exists.
4. **Verification boundary:** these changes are committed to `development/chatgpt-mvp`; the new emulator-enabled workflow must finish before claiming the integration suite passes. Existing successful CI results predate this change and do not validate emulator startup, transaction completion, tenant isolation, or suppression end-to-end.
5. **Release gates still open:** verify the emulator run reaches both tenant accounts, confirms cross-organisation reads/writes are denied, validates pending/suppressed lead gates and direct Firestore denial, and completes without the previous `createOrganisation` timeout. Keep Firebase deployment and real data deferred.

## Emulator verification results and pagination coverage — 2026-10-19

- **Confirmed passing:** GitHub Actions run [39315635130](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39315635130) completed successfully after the emulator smoke command installed the Functions package dependencies before compiling. The Auth, Functions, and Firestore emulators ran together; the smoke test completed its two-tenant isolation checks, unauthenticated denial, direct Firestore denial, contact-review/suppression gates, and draft create/update/delete checks. The previous `createOrganisation` timeout did not recur.
- **Pagination hardening:** added integration checks for missing/stale campaign, lead, and draft cursor documents, plus a >100-record lead pagination scenario that verifies page size, continuation token, final-page state, and no duplicate IDs across pages.
- **Current verification:** the new run for the >100-record pagination scenario is still in progress at the time of this note. Do not treat that additional pagination scenario as passing until its workflow result is complete.
- **Next batch:** if the larger scenario passes, add equivalent server pagination coverage for campaigns and outreach drafts only if runtime remains reasonable; then review role-based authorization and add viewer/member role checks. Continue to keep real Firebase configuration and deployment deferred.


## Pagination integration follow-up — 2026-10-19
- Extended the Firebase emulator smoke suite to create 100 additional synthetic campaigns and verify the campaign callable returns 100 records on page one, one record on page two, a cursor only when more records exist, and no duplicate IDs across the 101-record result set.
- The lead pagination integration already verifies the same 100+1 behaviour. Draft pagination remains source/UI covered but does not yet have a 101-record emulator test because creating the required valid lead/draft pairs adds a larger number of callable operations.
- Role enforcement remains split between tested pure authorization helpers and server-side membership guards. A follow-up emulator test should seed member/viewer memberships using a trusted emulator-only Admin SDK fixture, then verify member lead/draft writes, viewer read-only behaviour, and owner/admin-only campaign/suppression-clearance actions. Do not add a production membership-management endpoint merely for testing.


## Draft pagination integration follow-up — 2026-10-19

- Added a Firebase emulator scenario that creates 100 additional synthetic outreach drafts against the already-cleared synthetic lead, then checks 100 records on page one, one on page two, continuation/final cursor behaviour, unique IDs across both pages, and that the generated drafts remain unsent.
- This complements the existing 101-record lead and campaign pagination checks. The scenario adds 100 callable writes, so CI runtime must be observed; if the 15-minute emulator step becomes unstable, split or seed only via a trusted emulator-only fixture rather than weakening assertions.
- Role-specific emulator checks remain a follow-up: use a trusted emulator-only Admin SDK fixture to seed member/viewer membership documents; do not create a production endpoint just for tests.


## Role-based emulator authorization follow-up — 2026-10-19

- Confirmed GitHub Actions run [39318714101](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39318714101) completed successfully. Frontend typecheck, unit tests, production build, Functions authorization tests/build, and the Firebase Auth/Functions/Firestore emulator integration step all passed for commit `ab900904a191c3a9735501fa54ca8d25b6c86fd5`. This run included the 101-record lead, campaign, and draft pagination checks.
- Added `functions/scripts/seed-emulator-membership.mjs`, a test-only Admin SDK fixture that refuses to run unless the project is `demo-growth-engine-test` and the Firestore emulator host is local. It creates no callable or production membership-management endpoint.
- Expanded `scripts/emulator-smoke-test.mjs` to seed member/viewer memberships and test actual callable authorization: member can update lead notes and add suppression but cannot clear suppression or create campaigns; viewer can list leads but cannot create/edit leads, create campaigns, change suppression, or create drafts.
- **Verification pending:** the new role-based tests are committed but have not yet run. Wait for the CI run on the latest commit to finish; check that the fixture's emulator-only guard accepts the environment passed by `firebase emulators:exec`. Do not claim the new role matrix passes until that run is green.
- Keep Firebase project setup/deployment deferred. Continue only on `development/chatgpt-mvp`; do not change the Growth Engine `main` branch or the original AnyTrader repository.


## Role and pagination CI verification — 2026-10-19

- **Confirmed passing:** GitHub Actions run [39319921499](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39319921499) completed successfully for commit `b4e6adb80aa134a69b3935a5d4a02b4073fbd333`. Both the frontend typecheck/tests/build job and the Firebase Functions tests/build job passed; the frontend job also completed the Auth/Functions/Firestore emulator integration smoke tests.
- The previous run [39319622493](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39319622493) exposed a test-fixture count issue, not an application pagination defect: owner and admin setup had already created two campaigns, while the campaign pagination test added 100 more but expected exactly 101. The test now adds 99 synthetic campaigns, making the expected 101 total records explicit.
- Emulator coverage now verifies 101-record lead, campaign, and draft pagination; continuation tokens and unique IDs; owner/admin/member/viewer authorization cases; organisation isolation; malformed and stale cursor rejection; suppression and contact-review gates; and draft-only operations.
- Keep Firebase project creation/deployment deferred until the user creates the dedicated project. Continue only on `development/chatgpt-mvp`; do not change Growth Engine `main` or the original AnyTrader repository.
- **Next batch:** audit callable authorization and validation for inconsistent legacy records and lifecycle mutations (lead status/contact changes, draft updates/deletes, campaign status), adding targeted emulator assertions where they materially close a gap without making CI unnecessarily slow.


## Legacy outreach-draft integrity and cleanup — 2026-10-19

- Latest lifecycle-validation CI run [39323914332](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39323914332) completed successfully for commit `fcae234baed11eed257267e12a8206c4e673e32e`; frontend and Functions checks passed.
- Added a guarded emulator-only Admin SDK fixture for two legacy integrity cases: a draft whose lead is missing and a draft whose campaign ID disagrees with its lead's authoritative campaign.
- Expanded emulator smoke assertions to ensure both malformed drafts remain visible and explicitly require review, both are blocked from editing, and the orphan can still be deleted as a safe cleanup action. Deletion must remain draft-only and never send a message.
- The fixture refuses to run unless the project is `demo-growth-engine-test` and Firestore emulator host is local. No production callable, Firebase project, or real provider data is involved.
- **Verification pending:** CI must pass on the commit containing these tests before this batch is considered complete.
- Next: inspect lifecycle consistency and stale legacy-record handling in lead/campaign mutations, then assess whether any additional assertions materially improve coverage without inflating emulator runtime. Continue only on `development/chatgpt-mvp`; do not alter Growth Engine `main` or the original AnyTrader repository.


## Legacy-draft emulator fixture guard correction — 2026-10-19

- CI run [39324288617](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39324288617) failed only in the emulator integration step; frontend typecheck, all 211 frontend/unit tests, production build, and Functions authorization tests/build passed.
- Failure evidence: the new legacy-draft fixture rejected the local emulator host because its IPv4 regular-expression escapes were double-escaped. This is a test-fixture guard defect, not an application authorization or draft-integrity failure.
- Corrected the fixture's host pattern to match the proven existing emulator-only fixture. It continues to require project ID `demo-growth-engine-test` and a local Firestore emulator host before seeding any records.
- **Verification pending:** rerun CI before treating legacy-draft integrity assertions as passed.


## Legacy missing-campaign integrity — 2026-10-19

- Confirmed CI run [39329995087](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39329995087) completed successfully for commit `109d548c9f1f0fddd6a0f1b8f4d9bc710abe2809`; frontend typecheck/tests/build, Functions authorization tests/build, and the emulator integration smoke suite passed, including orphan and campaign-mismatch draft handling.
- Code review found one additional legacy-data gap: a draft could match its lead's campaign ID while that campaign document had been deleted. The list view could have presented it without a review warning, although editing already failed closed.
- Updated `listOutreachDrafts` to verify the referenced campaign document exists inside the same organisation. Missing campaign records now require review, and suppression remains visible even when another integrity check fails.
- Extended the guarded local-emulator fixture and smoke assertions with a synthetic lead/draft referencing a missing campaign record; verifies the draft is flagged, editing is rejected, and deletion remains available without sending.
- CI run [39330460126](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39330460126) completed successfully for commit `8bced0fb1330b13916d4bcd9dca3827f2e71a63a`; frontend and Firebase Functions jobs passed, including the emulator integration suite and the new missing-campaign-record scenario. Keep Firebase setup/deployment deferred; work only on `development/chatgpt-mvp`.


## Latest UI warning and legacy-draft integrity verification — 2026-10-19

- **Confirmed passing:** GitHub Actions run [39330762769](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39330762769) completed successfully for commit `1641f70f15a7c4200994da4e4b6c6cb226024e94`. Both frontend and Firebase Functions jobs passed, including frontend typecheck/unit tests/build and the Auth/Functions/Firestore emulator integration smoke suite.
- The overlapping docs-only run [39330719427](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39330719427) was cancelled when the newer UI commit started. Its Functions job passed; treat the newer successful run as the verification result for the latest branch head.
- The Lead Directory now explicitly explains that clearing an internal review restriction does not establish consent or another lawful basis for outreach. Outreach remains draft-only.
- Re-reviewed `updateOutreachDraft`: within a Firestore transaction it reads the draft and lead, checks their campaign IDs agree, applies the contact-review gate, then reads the campaign document in the same organisation and fails closed if it is missing before any writes. The existing missing-campaign emulator scenario therefore exercises the intended edit rejection path. Firestore transaction reads precede writes.
- Lifecycle review found no campaign-deletion callable; campaign status updates check organisation membership/owner-admin role and return not-found for a missing campaign. Lead mutations are scoped to the organisation's lead path and use transactional existence checks. Continue to assess legacy lifecycle edge cases without adding a production membership or data-repair endpoint just for testing.
- **Next review:** inspect whether lead lifecycle mutations and draft creation consistently fail closed when a legacy lead's campaign record is missing, and add focused emulator assertions only where they materially improve safety. Keep work on `development/chatgpt-mvp`; do not change Growth Engine `main`, the original AnyTrader repository, or configure/deploy Firebase.


## Transactional campaign-status lifecycle hardening — 2026-10-19

- Reviewed campaign status mutation against the other lifecycle operations. It previously fetched the campaign, then issued a separate update. Although no campaign-delete callable currently exists, the two-step sequence left a check/update gap if the record changed or was removed by an authorised administrative operation.
- Changed `updateCampaignStatus` to read campaign existence and apply the status update in one Firestore transaction. The operation still requires owner/admin permission and validates the status before entering the transaction; missing campaigns continue to return a controlled `not-found` error.
- Existing emulator coverage already checks that an invalid campaign status is rejected and that updating a missing campaign returns `functions/not-found`; CI will re-run these alongside tenant isolation, role checks, pagination, and contact-review gates.
- This is a backend integrity improvement only. No production Firebase project, provider source, or sending integration was configured.
- Verification pending for this commit; do not mark it passed until the workflow completes successfully.


## Campaign status transaction regression — 2026-10-19

- The transactional campaign-status update has passed CI run [39331734989](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39331734989), including the frontend/emulator job and Functions job.
- Added an emulator regression scenario to verify that an owner can pause a campaign, the updated status is persisted and returned by the campaign list, and the owner can reactivate it. This tests the successful path alongside the existing invalid-status, missing-campaign, and cross-tenant denial cases.
- Verification pending for this additional smoke-test change. Wait for CI to complete before treating the expanded regression as passed. No Firebase project or production integration was configured.


## Lead lifecycle persistence regression — 2026-10-19

- Extended the local Firebase emulator smoke test to cover successful lead lifecycle changes after the lead's internal contact-review gate is explicitly cleared.
- The test now moves the synthetic lead to `qualified`, verifies that status through `listLeads`, moves it to `contacted`, and verifies persistence again. Existing checks still reject `contacted` while the lead is pending review or suppressed.
- This adds an end-to-end regression for both positive status persistence and the contact-review safety gate without changing production semantics or introducing new services.
- Verification is pending until GitHub Actions completes for this commit. Firebase deployment remains deferred; outreach remains draft-only.


## Suppressed-lead draft creation regression — 2026-10-19

- **Confirmed passing:** GitHub Actions run [39333135974](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39333135974) completed successfully for commit `639da935e6fdfa7411689459028160888d5ff577`. Both frontend and Firebase Functions jobs passed, including the emulator smoke suite.
- The emulator smoke test verifies that a do-not-contact restriction blocks editing an existing outreach draft and creating a new draft, and that removing the internal restriction permits editing again.
- Clearing the internal review restriction does not establish consent or lawful basis for real-world outreach. The tool remains draft-only.

## Missing-campaign lead draft-creation regression — 2026-10-19

- Extended the emulator smoke suite with a legacy lead whose internal review status is cleared but whose referenced campaign record is missing.
- The test asserts that creating an outreach draft for that lead fails with `functions/failed-precondition`. This confirms that the campaign-integrity guard is enforced even when the contact-review gate is cleared.
- The fixture uses synthetic records in the guarded local emulator; no production Firebase project or real provider data is involved.
- Verification pending until CI passes on the new commit.


## Suppression persistence during contact edits — 2026-10-19

- Extended the local emulator smoke test to edit a lead's ordinary contact fields while its do-not-contact restriction is active.
- The test verifies the contact update does not clear `doNotContact` or the `blocked` review state, and that outreach draft creation remains rejected afterward.
- This protects against a future regression where an innocent contact-detail edit could accidentally reopen a suppressed lead. Synthetic emulator data only; no production integration.
- Verification pending until GitHub Actions completes for the new commit.


## Suppression persistence across notes and status mutations — 2026-10-19

- Added emulator regression checks that update ordinary lead notes while the lead is suppressed, then verify the persisted `doNotContact` flag remains true and the contact-review status remains `blocked`.
- Added assertions that a suppressed lead cannot be transitioned to `contacted`, and that note edits do not reopen draft creation.
- These tests use synthetic data in the local Firebase emulator; they do not configure or contact a production Firebase project. Verification pending until CI completes on the new commit.


## Contacted-status campaign integrity — 2026-10-19

- **Confirmed passing:** CI run [39334018538](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39334018538) passed both frontend and Firebase Functions jobs for commit `df6e41634e6df9c0b3aeb451af8513df231b6aa2`, including emulator smoke tests for suppression persistence across contact edits, notes edits, and status changes.
- Lifecycle review found that a synthetic legacy lead could have an internally cleared contact-review state while its campaign record was missing. Draft creation already rejects this, but changing the lead's status to `contacted` did not independently validate the campaign reference.
- Updated `updateLeadStatus` to check campaign existence transactionally before permitting `contacted`. Added an emulator regression using the guarded legacy fixture. Other non-contacted lifecycle transitions retain their existing behaviour.
- Verification pending for the new commit. Emulator-only synthetic data; no production Firebase setup or outreach sending.


## Transactional membership revalidation for write operations — 2026-10-19

- **Prior CI baseline:** run [39334743855](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39334743855) completed successfully after the suppression transaction's membership nullability fix. Frontend typecheck/tests/build, Functions authorization tests/build, and the emulator smoke suite all passed.
- Audit found that several write callables checked organisation role before opening a Firestore transaction, then relied on that earlier role snapshot while mutating records. A membership role change between the pre-check and transaction could leave a stale authorization decision in use.
- Added a shared transactional role guard and applied it inside campaign creation/status changes and lead/draft create, edit, status, notes, and delete transactions. The guard re-reads the caller's membership in the transaction, validates the membership record and current role, and checks the relevant permission before any business writes. Existing fast pre-checks remain for clear early errors; the transactional guard is authoritative at commit time.
- Suppression changes retain their dedicated transactional guard, including the owner/admin-only suppression-clear rule. Read-only callables and organisation creation are unchanged. No membership-management endpoint was added; no production Firebase project, provider source, or sending integration was configured.
- **Verification pending:** wait for the new CI run to pass before considering this batch complete. Keep all work on development/chatgpt-mvp; do not modify Growth Engine main or the original AnyTrader repository.


## Legacy outreach status integrity — 2026-10-19

- Previous transactional-role hardening passed GitHub Actions run [39335145242](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39335145242): both frontend and Firebase Functions jobs succeeded, including emulator smoke coverage.
- A further lifecycle audit found that the draft list normalised every stored record to UI status `draft`, and the update callable did not check the stored status. A malformed/legacy record marked `sent` or with a missing status could therefore be shown as a draft and potentially edited back into a draft-shaped record.
- The list now flags any record whose persisted status is not exactly `draft` as requiring review. Editing now fails closed unless the stored status is exactly `draft`. Deletion remains available for safe cleanup, with no send action. Added a guarded emulator-only synthetic `sent` status fixture and assertions for visibility/review warning, edit rejection, and safe deletion.
- **Verification pending:** CI run must pass before this change is considered complete. Keep work on `development/chatgpt-mvp`; no production Firebase configuration, real lead data, or sending integration.


## Honest display of legacy outreach status — 2026-10-19

- Follow-up audit found that although legacy records with missing/non-draft status were flagged for review and could not be edited, the list response still normalised their displayed status to `draft`. This could mislead operators about the stored record state.
- The list now preserves a non-empty stored status (or displays `unknown` when absent), the frontend labels non-draft records as requiring review, and the emulator smoke test asserts a synthetic `sent` record is returned as `sent` rather than `draft`. Editing remains blocked and deletion remains available for cleanup; no sending integration was added.
- Verification pending for the commit. Keep changes on `development/chatgpt-mvp`; Firebase deployment remains deferred.


## Missing legacy outreach status regression — 2026-10-19

- Latest code commit `7fd3b551e2e2498f0307b2c9c5661ec54ab1360c` passed GitHub Actions run [39335801496](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39335801496): frontend typecheck/tests/build and Firebase Functions tests/build both succeeded.
- Added a second guarded synthetic legacy fixture where the persisted outreach record has no `status` field. The emulator smoke test now verifies it remains visible as `unknown`, requires review, cannot be edited, and can be deleted safely without sending.
- This complements the existing `sent` status regression, covering both known non-draft and missing status values. Verification of this new test is pending until CI completes.
- Continue only on `development/chatgpt-mvp`; keep Firebase deployment deferred and outreach draft-only.


## Legacy contact-restriction integrity regression — 2026-10-19

- CI run [39336093918](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39336093918) passed both frontend and Firebase Functions jobs for the missing-status regression commit.
- Extended the guarded emulator fixture with synthetic legacy leads whose `doNotContact` value is missing or malformed (a string instead of a boolean), while review metadata misleadingly says `cleared`.
- Added assertions that drafts tied to both records remain visible with a restriction-verification warning, cannot be edited, and new draft creation fails with `failed-precondition`. This checks that review metadata cannot override an absent or malformed authoritative restriction value.
- CI run [39336484729](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39336484729) passed both frontend and Firebase Functions jobs, including the emulator integration smoke test. The test verifies missing/malformed restriction leads are not presented as verified and normalise to pending review.
- Follow-up audit added direct `listLeads` assertions for those same legacy records, so the API/UI-facing lead list must report `contactRestrictionVerified: false` and `contactReviewStatus: pending`. Verification of these added assertions is pending.
- Changes remain on `development/chatgpt-mvp`; no production Firebase configuration, real lead data, or sending integration.


## Fail-closed normalisation for legacy contact restrictions — 2026-10-19

- CI run [39336793423](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39336793423) caught a real regression in the new direct lead-list assertions: `normaliseContactReviewStatus` preserved a misleading `cleared` metadata value when `doNotContact` was missing or malformed.
- Fixed the helper so only an explicit boolean `doNotContact: false` can support a cleared state. Missing/malformed restriction values now normalise to `pending`, even if review metadata says `cleared`; an explicit blocked state remains blocked. Updated the adversarial unit-test matrix.
- Re-run CI including the emulator smoke suite before treating this as verified. Continue on `development/chatgpt-mvp` only; production Firebase remains deferred and outreach stays draft-only.


## Clarify deletion semantics for legacy outreach records — 2026-10-19

- CI run [39337157941](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39337157941) passed after the fail-closed contact restriction normalisation fix. Both frontend and Functions jobs succeeded, including emulator integration checks.
- The next audit found ambiguous wording when deleting a legacy record whose stored status is `sent`: the activity log said “no message was sent,” which could be misread as a claim about the record's entire history. Wording now says the deletion action itself did not send a message. The delete response adds explicit `messageSentByThisAction: false`, and emulator assertions cover this field for non-draft and unknown-status cleanup.
- Verify the new commit through full CI before treating this follow-up as complete. Continue on `development/chatgpt-mvp` only; no deployment or sending integration.


## Pagination cursor validation regression coverage — 2026-10-19

- Latest commit `7a216f5852844a7ac35c28b48c2a2b0f43eb1fad` passed CI run [39337550663](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39337550663): both frontend and Firebase Functions jobs completed successfully, including typecheck, unit tests, builds, and emulator smoke tests.
- Continued the backend audit with focused unit coverage for pagination token validators used by organisation, campaign, lead, and outreach-draft listings. The tests cover user binding, organisation binding, collection binding, path traversal, extra path segments, overlong tokens, and non-string input.
- This is regression coverage for the existing path guards; it does not change pagination behaviour or data access. Next review will check cursor document state and pagination behaviour against deleted or malformed legacy records.
- Verification pending until CI completes for this test-only commit. Continue on `development/chatgpt-mvp` only; Firebase deployment remains deferred and outreach remains draft-only.


## Validate organisation pagination cursor state — 2026-10-19

- Pagination cursor validator unit tests passed in CI run [39337823753](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39337823753); both frontend and Functions jobs succeeded, including emulator integration checks.
- Tightened `listMyOrganisations` cursor validation: in addition to the safe path, the cursor must exist, be the signed-in user's valid membership record with a supported role, and belong to an existing organisation. This prevents stale or malformed membership documents from being accepted as query cursors.
- Added an emulator-only malformed-membership fixture script guarded to the demo project and local Firestore emulator, plus an integration assertion that such a cursor is rejected with `functions/invalid-argument`.
- Verification pending full CI. Continue only on `development/chatgpt-mvp`; production Firebase remains deferred and outreach remains draft-only.


## Fix emulator-only malformed membership fixture guard — 2026-10-19

- CI run [39338235700](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39338235700) failed in the emulator smoke test because the fixture's loopback-host regular expression was over-escaped and rejected the valid emulator host `127.0.0.1:8080`. Frontend typecheck/tests/build and Firebase Functions tests/build passed; the smoke test stopped at fixture setup before its new malformed-membership assertion.
- Corrected the regex to match the literal dots in `127.0.0.1:8080` or `localhost:8080`. The demo-project and emulator-host safety checks remain enforced.
- Full CI verification is pending. Continue only on `development/chatgpt-mvp`; do not deploy Firebase or add any sending integration.


## Validate ordered pagination cursor timestamps — 2026-10-19

- Tightened `listCampaigns`, `listLeads`, and `listOutreachDrafts` so an existing cursor document is rejected unless its persisted `createdAt` exposes a finite Firestore timestamp value. Truthy strings/objects no longer pass cursor validation.
- Added unit regressions for finite, missing, non-numeric, non-finite, and throwing timestamp values.
- Added a guarded local-emulator fixture and callable integration checks for malformed `createdAt` values across all three ordered collections. Fixture requires project `demo-growth-engine-test` and loopback Firestore emulator.
- Verification pending CI run. Work remains isolated to `development/chatgpt-mvp`; no production Firebase deployment or message sending.


## Fix draft restriction smoke-test record selection — 2026-10-20

- CI run [39339439259](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39339439259) failed only in emulator smoke assertions after the malformed timestamp and membership cursor checks executed. The failing assertion selected `drafts[0]`, which is not guaranteed to be the original draft once member/admin-created drafts exist and the list is ordered by creation time.
- Updated the integration test to locate the exact original draft by ID before asserting that a later suppression is reflected and requires review. This keeps the test checking the intended security behaviour without relying on incidental result ordering.
- Rerun full CI before treating this batch as verified. Continue on `development/chatgpt-mvp` only; no deployment and no automatic outreach sending.


## Make draft-list smoke assertions independent of list contents — 2026-10-20

- CI run [39339735848](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39339735848) passed Firebase Functions tests/build but the emulator smoke test exposed another brittle assertion: it expected exactly one draft and inspected the first result, although the integration scenario has created additional drafts.
- The test now finds the original draft by its ID and checks that its subject update persisted and that the record remains draft-only. It no longer assumes the collection has exactly one item or a particular ordering.
- Full CI verification pending. Continue on `development/chatgpt-mvp` only; no production deployment or automatic outreach sending.


## Remove fixed-total assumptions from pagination smoke tests — 2026-10-20

- CI run [39340002191](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39340002191) passed frontend typecheck, 224 unit tests, production build, and Firebase Functions tests/build, but the emulator smoke test failed because it expected exactly one record on the second lead page. The scenario already contains additional valid lead records.
- Updated lead, campaign, and outreach-draft pagination assertions to validate non-empty later pages, absence of duplicate IDs, and a total beyond the 100-record page limit without assuming the test fixture contains an exact total. The checks still require the final page to report no further cursor.
- Awaiting full CI rerun for verification. Changes remain limited to `development/chatgpt-mvp`; no Firebase deployment or automated outreach sending.


## Reject access to orphaned organisation subcollections — 2026-10-20

- The previous membership checks validated a membership document but did not also verify the parent `organisations/{organisationId}` document exists. Firestore can retain subcollection documents after a parent document is deleted, so a leftover membership could otherwise grant access to orphaned campaign, lead, or draft records.
- Updated both the regular membership guard and transactional role guard to require the parent organisation document. Added a strictly local-emulator-only fixture that creates orphaned membership and child records, plus smoke assertions that list endpoints and lead creation fail with `permission-denied`.
- Full CI verification pending. Changes remain on `development/chatgpt-mvp`; no deployment and no automated outreach sending.


## Recover unmatched CSV quotes without swallowing later quoted records — 2026-10-20

- Added a regression case where an unclosed quoted field is followed by a valid row whose business name is quoted. The parser previously could mistake that later row's closing quote for the missing quote and consume the valid row.
- Adjusted physical-line recovery to recognise a likely new quoted record at the start of a later line, while retaining support for valid multiline fields and closing quotes at line starts.
- CI verification pending. Changes remain on `development/chatgpt-mvp`; no production Firebase deployment or automated outreach sending.


## Revalidate organisation parent when changing lead suppression — 2026-10-20

- Found that `setLeadSuppression` re-read membership transactionally but did not re-check the parent organisation document. If the parent were deleted after the initial authorization check, the remaining membership subcollection could still pass the transactional guard.
- Reused the shared transactional role guard, which validates both parent organisation and membership, while retaining the stricter owner/admin rule for clearing a contact restriction. Added an emulator regression assertion for suppression updates against an orphaned organisation.
- Full CI verification pending. Changes remain on `development/chatgpt-mvp`; no production Firebase deployment or automated outreach sending.


## Keep organisation pagination resilient to malformed membership rows — 2026-10-20

- The latest CI run for commit `26a709561768481c105bd88e3da1f79c66071085` passed both jobs (run [39377262845](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39377262845)).
- Follow-up pagination review found that `listMyOrganisations` returned a page token based on the final raw membership row, but rejected that token on the next request if the row had an invalid role. A malformed legacy row could therefore break pagination even though it was correctly omitted from results.
- A page token is now treated only as a scoped cursor: it must point to the signed-in user's membership path, contain that user's UID, and belong to an existing organisation, but its role need not be valid merely to advance past the row. Result rows still require a valid membership role, so the cursor cannot grant access to the malformed organisation.
- Updated the guarded emulator fixture and smoke test to verify the malformed row is omitted while the cursor can safely advance. Full CI verification is pending; remain on `development/chatgpt-mvp`, with no production Firebase setup or outreach sending.


## Bind owner-role permissions to the organisation's authoritative owner — 2026-10-20

- The prior pagination-hardening commit passed CI run [39377547709](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39377547709), with both jobs successful.
- Continued the membership integrity audit and found that a membership document with role `owner` was trusted without checking it against the parent organisation's `ownerUid`. Although direct client writes are denied and no membership-management endpoint exists, a corrupt or incorrectly provisioned owner record could otherwise grant owner/admin-only capabilities.
- Added a shared organisation-aware membership validator. Owner-role membership must match the parent's recorded `ownerUid`; missing or conflicting owner metadata fails closed. Admin/member/viewer roles remain governed by the membership record.
- Applied the check to read and transactional authorization plus organisation listing. Added unit tests and a guarded local-emulator regression proving a mismatched owner membership cannot access campaign data and is omitted from organisation results.
- Full CI verification pending. Work remains on `development/chatgpt-mvp`; production Firebase setup remains deferred and outreach remains draft-only.


## Owner membership integrity mutation coverage — 2026-10-20

- CI run [39377906706](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39377906706) passed both frontend and Functions jobs for commit `9321cce411a7cfedcbd9f0d3245094ecfd9dfbf6`.
- Expanded the emulator smoke suite so a membership marked `owner` but conflicting with the organisation's authoritative `ownerUid` is tested against campaign creation, campaign status changes, lead creation, and suppression mutation—not only organisation/campaign reads.
- The fixture remains synthetic and local-emulator-only. This adds regression coverage without changing production authorization behaviour. Outreach remains draft-only; Firebase deployment remains deferred.


## Owner integrity coverage across all write callables — 2026-10-20

- CI run [39378222608](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39378222608) passed both frontend and Firebase Functions jobs for commit `a879136aad464cd9511c0e559f6d333720a698a0`.
- Extended the synthetic owner-mismatch emulator fixture with a cleared lead and an unsent draft. Regression checks now cover every existing lead/campaign/draft mutation callable: campaign create/status update; lead create/contact/notes/status/suppression; draft create/edit/delete.
- These calls must all reject the inconsistent owner membership with `permission-denied`. The fixture remains guarded to the local demo emulator and does not change production behavior.


## Fail closed when authoritative owner metadata is missing — 2026-10-20

- CI run [39378526947](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39378526947) passed both frontend and Firebase Functions jobs for the owner-mismatch write-callable coverage.
- Follow-up integrity review adds a distinct synthetic organisation whose owner membership says `owner` but whose parent organisation has no `ownerUid`. This checks the missing-metadata case separately from an explicit conflicting UID.
- Emulator smoke tests require campaign listing to fail with `permission-denied` and organisation listing to omit the organisation. The fixture remains restricted to the local demo emulator; no production data or deployment is involved.
- Full CI verification is pending for this batch. Keep work on `development/chatgpt-mvp`; outreach remains draft-only.


## Reject malformed authoritative owner metadata — 2026-10-20

- CI run [39378824645](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39378824645) passed both frontend and Firebase Functions jobs for the missing-owner-metadata emulator regression.
- Added unit-test coverage for malformed `ownerUid` values (null, blank strings, numbers, booleans, objects and arrays), ensuring an `owner` membership is accepted only when the authoritative owner UID is a non-empty matching string.
- This is focused validator regression coverage; no production behavior change. Full CI verification is pending.


## Organisation pagination cursor integrity follow-up — 2026-10-20

- CI run [39379052557](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39379052557) passed both frontend and Firebase Functions jobs for commit `dddb77698d62517e7fefa2c9292798eab4ce691a`.
- The next source audit found that `listMyOrganisations` checked that a pagination cursor belonged to the caller and pointed to an existing organisation, but did not validate an `owner` membership against the parent organisation's authoritative `ownerUid`. This did not grant organisation access because page results were separately validated, but it allowed an invalid owner membership to be used as a cursor.
- Added the same authoritative membership integrity check to cursor validation and an emulator regression asserting that a mismatched owner membership cannot be used as an organisation pagination cursor. Verification pending in CI; keep changes on `development/chatgpt-mvp` and keep Firebase deployment deferred.


## Pagination cursor regression correction — 2026-10-20

- CI run [39379473644](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39379473644) found an outdated emulator expectation: the malformed-membership cursor fixture expected pagination to continue while silently omitting the organisation. Cursor validation now correctly rejects malformed membership metadata with `functions/invalid-argument`, so the smoke test now asserts that fail-closed behaviour directly.
- Firebase Functions unit tests/build passed in that run; the frontend job failed only at the emulator smoke test assertion described above. Re-run the full CI after updating the test. No production Firebase deployment performed.


## Legacy contact restriction edit regression — 2026-10-20

- Commit `61b929ba20e185cf479deecdc6f642cdbff911be` passed CI run [39382558438](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39382558438). Both frontend and Firebase Functions jobs succeeded, including emulator integration.
- Emulator checks verify that editing contact details and notes cannot implicitly verify missing or malformed contact-restriction fields. Both records remain unverified and pending review after edits.
- Continue on `development/chatgpt-mvp`; no deployment or outreach sending.


## Resolve contradictory blocked contact-review state in the UI — 2026-10-20

- Commit `9fd627981afffc2f3661c99ac8f871046f8d5c7b` passed CI run [39383138152](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39383138152), including frontend tests/build and Firebase Functions tests/build/emulator integration.
- Fixed a UI action mismatch for legacy records with `doNotContact: false` but `contactReviewStatus: "blocked"`: these records now offer review/clear rather than accidentally re-suppressing the lead. A shared helper has unit coverage; owner/admin-only clear enforcement remains in place.
- No deployment or outreach sending.

## Production security gate — 2026-10-20

- Audit found 15 callable exports in `functions/src/index.ts` and no `enforceAppCheck` options. Existing server-side authentication, membership, role checks, and tenant isolation remain essential but do not replace App Check.
- Added `docs/PRODUCTION_SECURITY_READINESS.md` documenting App Check enforcement as a blocker, plus rate limiting, monitoring, privacy/retention, and recovery requirements.
- Do not deploy publicly until the separate Growth Engine Firebase project is configured and these controls are implemented and verified.


## Reject unsafe website schemes in lead data — 2026-10-20

- Added server-side validation for lead website fields. Empty optional values and ordinary domains/HTTP(S) URLs remain accepted; custom schemes such as `javascript:`, `data:`, `vbscript:`, `file:`, FTP, protocol-relative URLs, control characters, backslashes, and whitespace-ambiguous URLs are rejected.
- `normaliseLeadFields` applies the check before persistence for both lead creation and contact-detail edits, returning `invalid-argument` for unsafe input.
- Added unit coverage for accepted common values and rejected unsafe/ambiguous cases. This input-hardening change does not imply public-production readiness. App Check, rate limiting, monitoring, and the separate Firebase project remain blockers.
- Commit is on `development/chatgpt-mvp` only. Verify the next CI run before beginning another commit batch.


## Website URL validation regression fix — 2026-10-20

- CI run [39385106975](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39385106975) caught a failing negative test: the WHATWG URL parser normalises spaces in HTTP(S) URLs, so the validator's scheme branch accepted a URL containing whitespace.
- Tightened the shared validator to reject whitespace before scheme parsing, keeping ordinary trimmed domains and HTTP(S) URLs accepted. Re-run CI before further work.


## Reject credential-bearing website URLs — 2026-10-20

- CI run [39385432146](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39385432146) passed both frontend and Firebase Functions jobs for commit `be5c6ca6d73aecf2774b4eac4729a0952c309c98`, including emulator integration.
- Continued the website-input audit: HTTP(S) URLs containing embedded username/password credentials can disguise the apparent destination (for example, `https://example.test@attacker.test/`). The server validator now rejects URLs with parsed username or password fields, and unit tests cover both userinfo patterns.
- This remains a validation hardening change; it does not fetch URLs, verify business ownership, or enable outreach. Verify full CI for this commit before starting another batch. Keep work on `development/chatgpt-mvp`; App Check, rate limiting, monitoring, and a separate Firebase project remain production blockers.


## Invalidate stale contact-review clearance after channel changes — 2026-10-20

- The latest workflow run [39386000278](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39386000278) completed successfully: both frontend and Firebase Functions jobs passed, including emulator integration.
- Found that editing a previously reviewed lead's email, phone, or website could leave the old `doNotContact: false` / cleared review state in place. That could allow draft creation for contact details that had not been reviewed.
- Updated `updateLeadContact` so a change to email, phone, or website re-applies the contact restriction and sets review to pending; an already blocked/suppressed lead stays blocked. Changes to other business fields do not themselves invalidate clearance.
- Added an emulator regression asserting a cleared lead cannot create a draft after its email changes, then explicitly re-clears the updated details before lifecycle tests continue. Verify full CI before the next change. Remain on `development/chatgpt-mvp`; no production deployment or automated outreach sending.


## Follow-up to contact-review CI regression — 2026-10-20

- CI run [39386317382](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39386317382) exposed an existing emulator test assumption that a member could edit an email and immediately create a draft using the previous clearance. The new server-side guard correctly denied that draft.
- Updated the integration scenario to assert that member contact-channel edits set the lead to pending/do-not-contact, assert draft creation is rejected, and have the admin explicitly re-review the changed details before subsequent lifecycle/draft permission checks.
- This is a test expectation update, not a relaxation of the guard. Run CI to verify before further changes.


## Rate-limit storage lifecycle review — 2026-10-20

- Reviewed the fixed-window quota evaluator and operations runbook. Quota documents use stable hashed paths and are reused when windows roll over, but distinct user/organisation/operation buckets can accumulate over time.
- Documented safe future TTL design and explicitly recorded that this repository does not configure a Firestore TTL policy. The expiry timestamp must be server-managed, tied to the actual quota window plus a safety grace period, and TTL must be configured and verified in the separate Firebase project.
- The runbook now warns against deleting active quota documents because that resets the bucket and can bypass throttling. This is a documentation-only readiness improvement; it does not implement TTL or claim production readiness.
- CI verification is pending for this documentation update.


## Fixed-window rate-limit clock-rollback retry correction — 2026-10-20

- Corrected the retry-after calculation when the server clock is earlier than the persisted window start. The quota remains blocked, and retry duration now reflects the full remaining time until the original window end rather than understating it by ignoring the clock offset.
- Updated the unit regression to assert a 61,000 ms retry when the persisted window begins at 10,000 ms and evaluation occurs at 9,000 ms with a 60,000 ms window.
- CI verification is pending for this change.


## Rate-limit evaluator boundary expansion — 2026-10-20

- Added unit regressions for requests below quota during clock rollback (the existing window start is retained and count increments), exact window-expiry boundary behavior, and invalid evaluator configuration (non-finite/negative clock, invalid maximum, and invalid window).
- These tests strengthen pure evaluator coverage without changing runtime quota behavior. CI verification is pending.


## Make rate-limit bucket keys structurally unambiguous — 2026-10-20

- CI run [39405136123](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39405136123) passed both frontend/emulator and Firebase Functions jobs for the rate-limit evaluator boundary tests.
- Centralised quota document ID generation and switched the SHA-256 input to a JSON-encoded tuple of organisation ID, authenticated UID, and operation. This avoids ambiguous delimiter-based encodings and keeps each quota dimension isolated.
- Updated the local-emulator fixture seeder to use the identical key format and added tests for deterministic 64-character hashes and organisation/user/operation isolation. CI verification for this change is pending.


## Add server-side quotas to paginated read callables — 2026-10-20

- Added fixed-window quotas for organisation, campaign, lead, and outreach-draft list endpoints to reduce the risk of repeated calls driving unbounded read/invocation costs. Tenant-scoped list quotas are keyed by organisation, authenticated user, and callable; organisation listing uses a global per-user bucket.
- Quota consumption runs in a Firestore transaction before the list query. The emulator smoke suite seeds an exhausted `listLeads` bucket and expects `functions/resource-exhausted`. Initial quotas are provisional; monitor and recalibrate before public release.
- CI verification pending. No production Firebase deployment or automated outreach sending.


## Follow-up: emulator TTL assertion guard (2026-10-20)
- CI run `39413191033` failed in `assert-emulator-rate-limit-expiry.mjs` because the local emulator host regex was over-escaped and did not match `127.0.0.1:8080`.
- Corrected the regex to match loopback IPv4 or `localhost` on port 8080. The project-ID and emulator-host safety guard remains in place.
- Verification: rerun Growth Engine CI and confirm emulator integration passes before treating this change as verified.


## Rate-limit expiry integration coverage — 2026-10-20

- CI run [39413425917](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39413425917) passed after fixing the local emulator host guard.
- Expanded the local-only expiry assertion to cover both the 60-second `listMyOrganisations` read bucket and the one-hour `createOrganisation` mutation bucket. The assertion checks persisted expiry equals window start + the operation's configured window + five-minute grace.
- Added the mutation expiry assertion to the emulator smoke test. This verifies TTL metadata on both read and mutation paths without changing enforcement or enabling TTL deletion.
- CI run [39413784099](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39413784099) passed after correcting the expiry-window assertion expression. A follow-up audit confirmed all 15 callable exports currently consume a quota: 11 mutations use transactional quotas and 4 list endpoints use read quotas.
- Corrected the assertion script's usage message so it documents both supported operations. Production Firestore TTL policy remains a separate Firebase-console/configuration task.


## Require integer rate-limit time values — 2026-10-20

- Follow-up evaluator review found that finite fractional millisecond values were accepted for the current time, window duration, and persisted window start. Runtime values from `Date.now()` and configured millisecond windows are integers, so accepting fractional values weakens persisted-state validation without serving a valid use case.
- Tightened validation to require safe integer current-time/window values and integer persisted window starts. Added unit regressions for fractional configuration and malformed persisted starts.
- Verification pending in CI. Work remains on `development/chatgpt-mvp`; no deployment or automated outreach sending.


## Require safe integer rate-limit counts — 2026-10-20

- The rate-limit evaluator already required safe integer millisecond timestamps, but accepted any `Number.isInteger` quota maximum and persisted count. JavaScript can report very large imprecise numeric values as integers, which are not suitable for reliable quota arithmetic.
- Tightened configuration and persisted-state validation to require safe integer `maxRequests` and `count` values. Added regressions for an unsafe quota maximum and an unsafe stored count; malformed values continue to fail closed.
- CI verification pending. Work remains on `development/chatgpt-mvp`; no production Firebase deployment or automated outreach sending.


## Verify expired rate-limit bucket reset in emulator — 2026-10-20

- Added a local-demo-only expired-bucket fixture for `listMyOrganisations` and extended the expiry assertion to verify the next successful call resets the counter to one and persists a fresh window start.
- The emulator smoke test now exercises a stale bucket while its document still exists, proving the evaluator—not TTL deletion—controls expiry and that the read returns unchanged organisation data.
- CI verification pending. TTL policy is still not configured in Firebase; production App Check and operational controls remain release blockers.


## Reject unsafe millisecond values in pagination timestamp cursors — 2026-10-20

- Tightened `isValidFirestoreTimestamp` to require a safe-integer millisecond value from `toMillis()`, rather than accepting any finite number.
- Added unit regressions for normal and zero timestamps, missing/malformed values, thrown conversions, NaN/infinity, fractional milliseconds, and values outside JavaScript's safe-integer range.
- This protects cursor validation for paginated campaigns, leads, and outreach drafts. CI verification pending; no production deployment.


## Preserve Firestore sub-millisecond timestamp precision — 2026-10-20

- Follow-up review identified that Firestore Timestamp values can retain nanosecond precision, making `toMillis()` legitimately fractional. Requiring integer milliseconds could reject valid pagination cursors.
- Updated the validator to accept finite values within JavaScript's safe numeric range, including fractional milliseconds, while still rejecting NaN, infinities, unsafe magnitudes, missing methods, and thrown conversions.
- Updated unit tests to capture the valid precision case. CI verification pending.

## Guard authentication on every callable export — 2026-10-20

- The full CI run [39420305640](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39420305640) passed both frontend/emulator and Firebase Functions jobs for commit `f6fecdc28c5fa26710ea806b60cd1aeccd5c85e7`; fractional Firestore timestamp cursor precision is verified.
- Extended the source-level callable security guard so every exported `onCall` handler must explicitly require `request.auth?.uid` before consuming its server-side quota, in addition to using its own operation-specific rate-limit key.
- This is a regression guard against accidentally adding an unauthenticated callable. It does not replace per-organisation authorization checks or App Check, which remain separate controls.
- Verify the next CI run before treating this guard as complete. Work remains on `development/chatgpt-mvp`; no deployment or automated outreach sending.



## Isolate viewer contact-suppression regression fixture — 2026-10-20

- CI exposed a false-positive in the no-side-effects assertion: the test reused a lead that already had a legitimate “Lead marked do not contact” activity from an earlier member operation. The assertion was checking historical activity, not just side effects of the viewer's rejected request.
- Updated the emulator smoke test to create a dedicated synthetic lead immediately before the viewer denial check. The test now asserts no matching activity exists for that lead and verifies its default restriction remains enabled after the denied request.
- Next batch: test contact-review transitions when contact channels change, confirm a blocked restriction stays blocked, and verify failed or conflicting updates cannot clear restrictions or create misleading activity.
- CI must pass before this regression is considered closed. All work remains on `development/chatgpt-mvp`; no production deployment or automated outreach sending.


## Verify rejected contact edits have no side effects — 2026-10-20

- Added an emulator regression using a dedicated synthetic lead: an update with a malformed email must fail with `functions/invalid-argument`, preserve the original email and pending contact restriction, and create no `Lead contact details updated` activity entry.
- The prior viewer-suppression and blocked-contact-edit batch passed both CI jobs, including Firebase emulator integration, in run [39446877030](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39446877030).
- Current change awaits CI. Next: inspect whether contact review and channel edits are transactionally serialized under concurrent requests; use deterministic emulator checks where feasible and avoid claiming race coverage without a reproducible test.
- Work remains on `development/chatgpt-mvp`; no production deployment or automated outreach sending.


## Race contact-channel edits against draft creation — 2026-10-20

- Added a local Firebase-emulator regression that concurrently creates a draft for a cleared synthetic lead and changes that lead's email address.
- Expected safe outcomes: if the contact edit commits first, draft creation is rejected by the contact-review gate; if draft creation commits first, the edit re-suppresses the lead and draft listing marks the existing draft as requiring review.
- The test verifies the final lead state is always suppressed and pending. Drafts remain unsent; this does not introduce any delivery mechanism.
- CI verification pending. Work remains on `development/chatgpt-mvp`; production deployment remains blocked pending separate Firebase/App Check and operational readiness work.


## Reject unsafe website contact edits without side effects — 2026-10-20

- Added an emulator regression for changing a synthetic lead's website to the unsafe `javascript:` scheme.
- The callable must reject with `functions/invalid-argument`; the stored website must remain unchanged, the default do-not-contact/pending-review state must remain intact, and no contact-update activity may be recorded.
- The concurrent contact-edit/draft-creation regression from the preceding batch is covered by the CI run [39450150476](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39450150476), where both jobs passed including emulator integration. This new unsafe-website regression awaits CI.
- Work remains on `development/chatgpt-mvp`; no production deployment or automated outreach sending.


## Expand unsafe website edit validation matrix — 2026-10-20

- Expanded the synthetic emulator regression from a single `javascript:` payload to six unsafe URL forms: `javascript:`, `data:`, protocol-relative URLs, credential-bearing HTTPS URLs, backslash URLs, and embedded whitespace.
- Each variant must fail with `functions/invalid-argument`. The test then verifies the stored website remains the original safe URL, contact restriction remains enabled with pending review, and no contact-update activity was created.
- The preceding website-scheme regression's documentation commit passed both CI jobs including emulator integration in run [39452295459](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/39452295459). This expanded matrix is a new commit and still requires its own CI verification.
- Work remains on `development/chatgpt-mvp`; no production deployment or automated outreach sending.


## Bind contact-review clearance to the reviewed contact revision — 2026-10-20

- Added a server-managed `contactReviewRevision` to lead creation/listing and contact-update responses. It starts at zero and increments transactionally whenever email, phone, or website changes; ordinary metadata edits do not increment it.
- Clearing a contact restriction now requires the revision shown to the reviewer. The server compares it to the current revision inside the same Firestore transaction as the clearance write. A stale revision fails with `functions/failed-precondition`, leaving the lead suppressed/pending. Blocking a lead remains available without a revision.
- Updated the cloud UI and API types to send the revision being reviewed. Updated emulator smoke helpers to use the current revision and added a regression that attempts clearance using a revision captured before an email change.
- This specifically closes the race where a clear action started against old contact details could otherwise commit after a concurrent channel edit and clear the new details without a fresh review. Legacy records without a revision are treated as revision zero until updated; malformed stored revisions fail closed on clearance.
- Implementation commits: `5a591dd3799f30ed028eb83aefc7f137096d13cf` (server), `7f71e1aedc2ab050371c31e2b955c1eaadeb8c6c` (API types), `b188ccfc4e1b837e0192ed68b1f8cbfe3d657b53` (UI), `aa8b5553836aa81d9a445c648f3ea7b9d1dbd837` (stale-revision regression). Follow-up type hardening and role/orphan fixture updates are committed in `a68fa73d623de5e542a723840ab11d2e50928e3f`, `fe92a9151dc63f3d6a0b9922a2783d6e84a3c99a`, `bcd3907722d9716afc8cbb2b4cc5c8d4799b17bc`, and `d3ef797e84728bc9042ff43488715f402bc53a54`.
- CI must pass before considering this fix verified. Work remains on `development/chatgpt-mvp`; no production deployment or automated outreach sending.


## CSV import idempotency and retry safety — 2026-10-22

- Added a required bounded `idempotencyKey` to the server-side `importLeads` callable. The key is hashed with the organisation and authenticated UID to create an organisation-scoped, user-scoped Firestore record ID.
- The request hash is based on the normalised campaign and lead fields. Repeating the same key and payload returns the original committed result without creating new leads/activity records or consuming another import quota. Reusing the key with a different normalised payload fails with `functions/already-exists`.
- Idempotency record, lead writes, activity writes, and rate-limit update are committed in the same Firestore transaction. Concurrent requests are expected to serialize through the idempotency document; emulator coverage should confirm this behavior.
- Added emulator smoke assertions for exact replay, conflicting payload reuse, and concurrent same-key requests (expecting one persisted lead), plus a source-level contract test.
- CI verification is pending. Check all jobs against the newest commit before treating the batch as complete. PR #10 remains unmerged; no production deployment and no automated outreach sending.
- Next: add a concurrent same-key emulator regression; consider idempotency for other mutation callables only after reviewing client retry behavior. Keep audit-event retention/access policy and production App Check as release blockers.


## AutoPilot continuation — adversarial validation tests (2026-10-24)

- Repository/branch reverified: `Saanwar2002/AnyTrader-Growth-Engine`, `development/next-phase`. PR #10 remains open, draft, and unmerged.
- Added website input regressions for control characters, newlines, backslashes, and safe URL forms with explicit ports/query strings and case-insensitive HTTP schemes. Commits: `8cad577ab5b377e9d92baaf8c54a62d381ed2ee7`, `13589f428bba91bdd07eb9d09e1e876b13f929cf`, `638e5bf6bdbf0af056994e4db238be8ab1ebaced`.
- Added a throwing legacy timestamp getter regression: `682e45c59a1aa594bf50c6f196a110bcaedfbd6c`.
- Added email validator boundary documentation/tests and non-finite/unsafe rate-limit configuration regressions: `5713dd87d8471f3f4dbbe0c2af84ae58f457f892`, `51c26c73578a79eb54ff55efa60bb8d87a51cc17`.
- CI runs were created for intermediate heads; latest commit CI must be checked on exact head `638e5bf6bdbf0af056994e4db238be8ab1ebaced`. Do not infer the latest test batch passed from earlier green runs.
- Next: inspect exact-head CI; if tests pass, continue targeted role/lifecycle and audit-event invariant coverage. If failures appear, retrieve the first actionable log and fix only evidence-supported causes.
- No merge, deployment, live outreach, production Firebase access, secrets, billing, or branch protection changes were performed.


## AutoPilot continuation — email and rate-limit validation hardening (2026-10-24)

- Added finite-number and safe-integer boundary cases for rate-limit configuration: `51c26c73578a79eb54ff55efa60bb8d87a51cc17`.
- Tightened the server-side email syntax guard to reject whitespace/header injection, malformed dot placement, malformed domain labels, oversized local/domain parts, and invalid top-level labels. Added invalid and valid boundary cases, including plus-addressing and subdomains. Commits: `145e3cf1b5b82e6eccc6fe3124ca1574277479e9`, `f5054a8c0d2273c0d756d1783a33cffcba2e8aa3`, `93455dc415680c05ee6274667084fc1ca0a16c72`.
- The exact latest head is `93455dc415680c05ee6274667084fc1ca0a16c72`. CI status for this head is not yet returned by GitHub at the time of this update; prior green runs do not validate this change. Check the exact-head workflow before claiming tests pass.
- PR #10 remains open and draft; no merge or deployment. Synthetic data only; outreach remains draft-only.


## AutoPilot continuation — fail-closed legacy record access and validation boundaries (2026-10-24)

- Added defensive handling for throwing property accessors in persisted fixed-window rate-limit state. Malformed state now returns the existing fail-closed invalid-state result rather than throwing; regression coverage checks both quota fields.
- Added defensive handling for throwing membership uid/role accessors, with tests proving malformed membership records fail closed.
- Expanded email validation boundary coverage for the maximum accepted 254-character address and a 255-character rejected address.
- Relevant commits: d5fda1335d31f7d0d3855f828d390ca3c30a5e6c, 7fa862cbeac26ae7190bed216cade9a1b7f9ee8a, 85786627ffd27da8fa3ee1c97a758d68fb0c99fc, 1073150ef95495f43bbdcf4a178b5e706fd1af3c, 310289e739ef31faef2767eebcb87e1f9741c079.
- CI run 40082371134 on an earlier head passed Functions authorization tests/build and frontend typecheck, unit tests, and production build, but its emulator smoke step was cancelled after a newer push. This does not verify the current head.
- Exact current code head before this tracking update: 310289e739ef31faef2767eebcb87e1f9741c079; check the newest CI run for final results. Do not infer success while checks are pending or cancelled.
- PR #10 remains open, draft, and unmerged. All work remains on development/next-phase; no merge, deployment, production Firebase access, secrets, billing, or live outreach changes.


## AutoPilot continuation — accessor failure hardening (2026-10-24, follow-up)

- The latest CI run on commit 3629028bb884598ca414fa2918a721e3d548390a completed later than the prior checkpoint: run 40082659004 was fully green, including frontend typecheck, unit tests, production build, emulator smoke tests, Functions authorization tests/build, and dependency audits. This verified the code head ecf31e2d0a27a3d8f23fc00b19aa071e1c951e4c, not subsequent commits.
- Hardened organisation-owner membership validation against a role accessor that changes/throws on a second read; added a regression test. Commits c3d924e938f735e787e62117d500dfeafbb78de7 and 3629028bb884598ca414fa2918a721e3d548390a.
- Hardened Firestore timestamp cursor validation so a throwing toMillis property getter fails closed; added a regression test. Commits 2d64b20a4ac55cfc553d89aeac009671ee12a1de and 44b505bd62d61ea77b6c7fc448cd13932ec74cc2.
- CI run 40083358789 was started for commit 3629028bb884598ca414fa2918a721e3d548390a and was still in progress at last check. The latest timestamp changes have not yet been verified by CI; check the exact current head and its workflow before claiming success.
- PR #10 remains open, draft, and unmerged. Continue only on development/next-phase. No merge, deployment, live outreach, production Firebase access, secrets, billing, or branch-protection changes.


## AutoPilot continuation — timestamp and hostile membership regression tests (2026-10-24)

- Added a membership proxy regression proving that throwing own-property inspection fails closed. Commit d16074ba410dcebe2eb3c346c3e0b619aaef286e.
- The Firestore timestamp accessor hardening and getter regression are in commits 2d64b20a4ac55cfc553d89aeac009671ee12a1de and 44b505bd62d61ea77b6c7fc448cd13932ec74cc2.
- Earlier exact-head run 40082659004 was fully green for commit ecf31e2d0a27a3d8f23fc00b19aa071e1c951e4c. Later run 40083358789 passed Functions authorization tests/build and frontend typecheck, unit tests, production build, and dependency audit, but its emulator smoke step was cancelled after another commit arrived. These results do not verify the latest head.
- Current code head: d16074ba410dcebe2eb3c346c3e0b619aaef286e. CI run 40083462699 is in progress; wait for final results and do not infer success from intermediate green steps.
- PR #10 remains open, draft, and unmerged. Continue only on development/next-phase. No merge, deployment, live outreach, production Firebase access, secrets, billing, or branch-protection changes.


## AutoPilot exact-head verification — 2026-10-24

- Reverified repository `Saanwar2002/AnyTrader-Growth-Engine`, branch `development/next-phase`, HEAD `c845b624b63647258e0dac5cbf20eaf594c8bda4`; PR #10 is still open, draft, and unmerged.
- Exact-head GitHub Actions run [40083503789](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40083503789) completed successfully. Both jobs passed: Functions authorization tests/build, patched `body-parser` lock-integrity check and dependency audit; frontend typecheck, unit tests, production build, emulator smoke tests and dependency audit.
- The earlier note about run 40083462699 being in progress is historical; the current HEAD has a later completed green run. No merge, deployment, production Firebase connection, secrets, billing, branch-protection changes, or live outreach were performed.
- Next safe development focus: review audit-event coverage for tenant-scoped mutations and add targeted regression tests only where an invariant is currently missing. Re-fetch branch HEAD before any code write and require exact-head CI before proceeding to the following batch.


## Latest continuation checkpoint — 24 October 2026

- Reviewed PR #10 on `development/next-phase`; latest verified head at this checkpoint: `9fdffcfe86a57f631a27d641705a06ec466d284d`.
- Fixed a potential false-positive lead duplicate match: business/location fallback identifiers now encode the pair as a structured JSON tuple rather than concatenating values with a delimiter. Added unit regressions for delimiter collisions and whitespace/case normalization.
- GitHub Actions run [40093634576](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40093634576) passed both the Functions tests/build and frontend typecheck/tests/build/emulator smoke-test jobs for that exact head.
- Next safe batch: continue review of callable idempotency replay integrity and tenant-scoped audit-event invariants; update docs when verification status changes. PR #10 is still open and draft. Do not merge until the full diff and intended 263-commit scope are reviewed.
- Production blockers remain unchanged: dedicated Growth Engine Firebase project, App Check setup/enforcement, deployed operational/budget alerts and TTL, and privacy/legal/retention review. Keep data synthetic and outreach draft-only.
