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
- The emulator smoke script checks a suppression restriction added after draft creation, including list warning and server-side rejection of draft edits. It now also checks that one organisation cannot create a draft for another organisation's lead or update/delete that organisation's draft.
- Draft creation and editing now verify that the lead's campaign document exists within the same organisation, and fail closed if the campaign reference is missing.

## Work required before Firebase connection
1. Run typecheck, unit tests and production build for the current branch when a working execution environment is available; latest membership validation and workspace-switch regression tests also remain unverified by execution.
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
- These changes are committed, but no current-branch typecheck, unit test, build, or emulator suite has yet been run.

## Next build focus
Continue the callable authorization audit and integration-test reliability work; resolve the emulator transaction timeout and run the expanded cross-tenant tests before Firebase connection. Keep all changes on `development/chatgpt-mvp`; do not modify `main` or the original AnyTrader repository.
