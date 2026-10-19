# Development continuation: security and implementation queue

Branch: `development/chatgpt-mvp`

This is a source-inspection work queue, not a certification or test report.

## Confirmed from source inspection
- Callable functions require an authenticated UID.
- Organisation membership is checked server-side for organisation-scoped reads and writes.
- Campaign writes require owner/admin; lead and draft writes require owner/admin/member.
- Suppression removal requires owner/admin.
- Draft creation and editing check the associated lead's suppression state inside a Firestore transaction.
- `listOutreachDrafts` now resolves current lead records and returns `leadSuppressed`, `requiresReview`, and `reviewReason`; missing lead records are also flagged for review.
- The cloud UI displays a warning for drafts needing review and disables editing while the warning applies; deletion remains available.
- A UI regression test now covers the warning and edit lock. The source changes have not yet been executed in a local test run.

## Work required before Firebase connection
1. Run typecheck, unit tests and production build for the current branch when a working execution environment is available.
2. Add emulator integration coverage for a lead becoming suppressed after draft creation and for missing lead records.
3. Test cross-tenant references for leads, campaigns and drafts.
4. Resolve the existing emulator transaction timeout and run the complete integration suite.
5. Review Firestore rules and environment configuration before deploying to a dedicated Firebase project.

## Known limitations
- End-to-end tenant isolation is not yet verified because the emulator suite did not complete successfully.
- No dedicated Firebase project is configured or deployed.
- Do not use real provider/customer data until the security and integration checks pass.
- The current `listMyOrganisations` query has a 100-membership cap; implement pagination or explicitly report truncation before broad SaaS rollout.

## Next build focus
Continue the callable authorization audit and integration-test reliability work; then address the organisation-list 100-membership cap before broad SaaS rollout. Keep all changes on `development/chatgpt-mvp`; do not modify `main` or the original AnyTrader repository.
