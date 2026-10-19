# Phase 2 — Firebase Backend Foundation Scaffold Report

**Branch:** `development/chatgpt-mvp`  
**Status:** Backend scaffold implemented and locally checked; not deployed or production-ready  
**Backend decision:** Firebase Cloud Functions v2 callable functions, Firestore, and Firebase Authentication context  
**Configured deployment runtime:** Node.js 22

## Delivered endpoints

All data endpoints require an authenticated Firebase callable request. Organisation-owned documents are scoped under `organisations/{organisationId}/...`; a supplied organisation ID is never sufficient without a membership check.

- `listMyOrganisations`: uses the authenticated UID to find only that user's organisation memberships and validates stored roles before returning summaries.
- `createOrganisation`: validates the name and transactionally creates an organisation plus its owner membership.
- `createCampaign`: checks membership, validates bounded fields, and permits creation only for owner/admin.
- `updateCampaignStatus`: permits only owner/admin to set one of the allowed campaign statuses.
- `listCampaigns`: checks membership and returns at most 100 campaigns for that organisation.
- `listLeads`: checks membership and returns at most 200 leads for that organisation.
- `createLead`: checks a writable role and verifies the campaign exists inside the same organisation. Lead completeness score and explanations are calculated server-side.
- `updateLeadContact`: validates lead fields and recalculates completeness server-side.
- `updateLeadStatus`: validates allowed statuses, blocks moving a suppressed lead to contacted, and writes the status change plus activity event transactionally.
- `updateLeadNotes`: validates note length and transactionally writes the note change plus activity event.
- `setLeadSuppression`: validates a strict boolean and transactionally records suppression changes. Owners/admins/members may suppress; only owners/admins may remove the restriction.
- `createOutreachDraft`: creates draft-only records; no send capability exists. The lead read, suppression check, draft creation, and activity entry are in one Firestore transaction.
- `listOutreachDrafts`: checks organisation membership and returns at most 200 drafts.
- `updateOutreachDraft`: validates subject/body and transactionally checks the linked lead is not suppressed before editing; creates an activity event.
- `deleteOutreachDraft`: deletes a draft and records an activity event transactionally. It never sends a message.

## Security design

- Caller identity is derived from Firebase callable request context, never from a supplied UID.
- Organisation and document IDs are validated against bounded path-safe formats.
- Membership role is read from Firestore, not accepted from the request body.
- Campaign creation/status changes are owner/admin-only. Lead and draft mutations require owner/admin/member; viewers are read-only.
- Firestore direct client access remains deny-by-default. The Admin SDK bypasses those rules, so every callable enforces authentication, membership, and role checks.
- Lead status, email, text lengths, and suppression inputs are validated server-side.
- Related lead/draft mutations and activity records are written transactionally.
- Suppression is a server-side gate for creating/editing drafts; removing suppression requires an owner/admin.
- No API keys or Firebase service-account credentials are included in the repository.

## Known gaps — do not expose as production service yet

- No dedicated Firebase project has been configured and no deployment has been performed.
- The frontend now selects a Firebase email/password sign-in and cloud workspace UI when required public config values exist; without them it remains in local synthetic demo mode. The cloud UI connects organisation discovery/creation, campaign creation/listing, lead creation/listing/status/suppression, and draft create/list/delete to callable functions. This UI has not been validated against a real project or Firebase emulators.
- The full emulator smoke suite has not completed, and tenant isolation is not yet proven end-to-end. One isolated `createOrganisation` callable smoke check did pass against the demo Auth/Functions/Firestore emulators.
- No App Check enforcement, rate limiting, idempotency keys, comprehensive security audit log, or usage quotas yet.
- Server-side CSV batch import and cursor pagination are not implemented.
- The Functions runtime is configured for Node.js 22, while the remote development workspace runs Node.js 20. Build and pure guard tests passed there, but deployment must use the configured runtime.

## Verification performed in the remote development workspace

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm test` | Passed — 58 tests across 7 files |
| `npm run build` | Passed |
| `npm --prefix functions run build` | Passed |
| `npm --prefix functions test` | Passed — 12 server guard tests |
| `npm audit` | Passed — 0 reported vulnerabilities after the root package override for @grpc/grpc-js |
| `npm --prefix functions audit` | Passed — 0 reported vulnerabilities |

Java was installed in the remote development workspace and the emulators started. The isolated `createOrganisation` callable smoke check passed. The broader smoke suite did not complete because the sandbox has approximately 1 GB RAM and additional Functions emulator workers exhausted available memory. This is an environment limitation, not a passing result: run `npm run test:emulators` on a machine/CI runner with enough memory before treating tenant isolation as verified.

## Remaining before Phase 2 can be called complete

1. Create a dedicated Firebase project for Growth Engine; never reuse production AnyTrader credentials or databases.
2. Copy `.firebaserc.example` to `.firebaserc` locally and replace the placeholder; never commit service-account credentials.
3. Enable Firebase Authentication and configure approved sign-in providers.
4. Run Auth, Firestore, and Functions emulators and prove unauthenticated calls fail, non-members cannot access organisation data, members cannot create campaigns or remove suppression, and Organisation A cannot access Organisation B.
5. Configure the dedicated project and validate the sign-in/cloud UI through Auth, Functions, and Firestore emulators before any production deployment.
6. Add App Check, rate limiting, idempotency protection, audit events, monitoring, and privacy/retention controls before external production use.

## Scope boundary

This scaffold does not connect to live lead sources, Gemini, email delivery, billing, or production AnyTrader services. It does not turn the browser-local demo into a multi-user SaaS by itself.
