# Development continuation: security and implementation queue

Branch: `development/chatgpt-mvp`

This is a source-inspection work queue, not a certification or test report.

## Confirmed from source inspection
- Callable functions require an authenticated UID.
- Organisation membership is checked server-side for organisation-scoped reads and writes.
- Campaign writes require owner/admin; lead and draft writes require owner/admin/member.
- Suppression removal requires owner/admin.
- Draft creation and editing check the associated lead's suppression state inside a Firestore transaction.
- The draft-list response currently does not return the associated lead's current suppression state.

## Work required before Firebase connection
1. Add a server-derived suppression/review indicator to listed drafts, based on current lead state.
2. Add callable/unit tests for a lead becoming suppressed after draft creation.
3. Test cross-tenant references for leads, campaigns and drafts.
4. Resolve the existing emulator transaction timeout and run the complete integration suite.
5. Review Firestore rules and environment configuration before deploying to a dedicated Firebase project.

## Known limitations
- End-to-end tenant isolation is not yet verified because the emulator suite did not complete successfully.
- No dedicated Firebase project is configured or deployed.
- Do not use real provider/customer data until the security and integration checks pass.
- The current `listMyOrganisations` query has a 100-membership cap; implement pagination or explicitly report truncation before broad SaaS rollout.

## Next build focus
Implement and test the cloud draft suppression warning first. Then continue the callable authorization audit and integration-test reliability work. Keep all changes on `development/chatgpt-mvp`; do not modify `main` or the original AnyTrader repository.
