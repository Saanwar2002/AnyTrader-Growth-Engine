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
- UI regression tests now cover the suppression warning/edit lock, the 100-membership truncation warning, and stale responses arriving after a tenant switch.
- Workspace data refreshes now ignore stale asynchronous results and clear tenant-scoped data on sign-out or when no organisation is selected.
- Organisation truncation detection now fetches 101 membership records to determine whether more than 100 exist, while returning only the first 100; this avoids warning users who have exactly 100 memberships.
- Pure authorization tests now cover missing, suppressed, unverified, and explicitly contactable draft review states.
- The emulator smoke script now checks a suppression restriction added after draft creation, including list warning and server-side rejection of draft edits.

## Work required before Firebase connection
1. Run typecheck, unit tests and production build for the current branch when a working execution environment is available; latest changes remain unverified by execution.
2. Add emulator integration coverage for missing lead records and malformed/missing `doNotContact` values.
3. Test cross-tenant references for leads, campaigns and drafts.
4. Resolve the existing emulator transaction timeout and run the complete integration suite.
5. Review Firestore rules and environment configuration before deploying to a dedicated Firebase project.

## Known limitations
- End-to-end tenant isolation is not yet verified because the emulator suite did not complete successfully.
- No dedicated Firebase project is configured or deployed.
- Do not use real provider/customer data until the security and integration checks pass.
- The current `listMyOrganisations` query has a 100-membership cap and now reports truncation in the UI; implement cursor-based pagination before broad SaaS rollout.

## Next build focus
Continue the callable authorization audit and integration-test reliability work; then address the organisation-list 100-membership cap before broad SaaS rollout. Keep all changes on `development/chatgpt-mvp`; do not modify `main` or the original AnyTrader repository.
