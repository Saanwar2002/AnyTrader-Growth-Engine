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

## Work required before Firebase connection
1. Run the full frontend typecheck, unit tests and production build. In an isolated remote workspace, the current Functions TypeScript build completed successfully, but the Functions unit test runner terminated with `Bus error`; no test assertions completed. The workspace default Node version is 20 while the Functions package requires Node 22, so repeat under a stable Node 22 environment.
2. Add emulator integration coverage for missing lead records and malformed/missing `doNotContact` values, and run a 101+ membership pagination test.
3. Run the expanded cross-tenant draft/lead checks in the emulator and verify campaign-reference validation.
4. Resolve the existing emulator transaction timeout and run the complete integration suite.
5. Review Firestore rules and environment configuration before deploying to a dedicated Firebase project.

## Known limitations
- End-to-end tenant isolation is not yet verified because the emulator suite did not complete successfully.
- No dedicated Firebase project is configured or deployed.
- Do not use real provider/customer data until the security and integration checks pass.
- Organisation listing is cursor-paginated in source, but the implementation still needs runtime tests with more than 100 memberships and verification that Firestore accepts the collection-group cursor as expected. No typecheck, unit test, build, or emulator run has been completed for the latest pagination commits.

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
