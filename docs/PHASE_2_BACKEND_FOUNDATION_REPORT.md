# Phase 2 — Firebase Backend Foundation Scaffold Report

Branch: development/chatgpt-mvp  
Status: Scaffold implemented and locally checked; not deployed or production-ready  
Backend decision: Firebase Cloud Functions v2 callable functions, Firestore, and Firebase Authentication context  
Runtime: Node.js 22 for deployed Functions

## Delivered

- firebase.json configures the Functions source, Firestore rules, and local Auth/Functions/Firestore emulator ports.
- .firebaserc.example provides a placeholder only; it contains no real project ID or credentials.
- firestore.rules denies all direct client reads and writes by default. The Admin SDK backend bypasses these rules, so each callable must enforce authentication and authorisation itself.
- functions/src/index.ts adds:
  - createOrganisation: requires an authenticated caller, validates the name, and atomically creates the organisation and its owner membership.
  - createCampaign: requires authentication, validates bounded input, verifies membership, and permits campaign creation only for owner/admin roles.
  - listCampaigns: requires authentication and membership before listing at most 100 campaigns scoped to the requested organisation.
- functions/src/authorization.ts provides bounded text and organisation-ID validation and a strict owner/admin campaign-write guard.
- Server guard tests cover invalid text, optional goals, unsafe organisation IDs, and non-privileged roles.
- Root Vitest configuration includes frontend tests and server guard tests while excluding compiled Functions output.
- Upgraded the frontend test runner to Vitest 4.1.12 after an audit found critical/moderate issues in the previous Vitest dependency tree.

## Security design

- Caller identity is derived from the verified Firebase callable request context, never from a supplied UID.
- Organisation IDs are selectors only; each endpoint checks membership before accessing tenant data.
- Membership role is read from Firestore, not accepted from the request body.
- Campaign creation is restricted to owner/admin. Campaign listing requires membership.
- Firestore direct client access remains deny-by-default while the frontend is still in local demo mode.
- No API keys or Firebase service-account credentials are included in the repository.
- The initial API does not yet implement App Check enforcement, rate limiting, comprehensive audit events, or tenant-level usage quotas; do not expose it as a production service yet.

## Verification performed in the remote development workspace

| Check | Result |
|---|---|
| npm run typecheck | Passed |
| npm test | Passed — 39 tests across 4 files |
| npm run build | Passed |
| npm --prefix functions run build | Passed |
| npm --prefix functions test | Passed — 4 guard tests |
| npm audit | Passed — 0 reported vulnerabilities |
| npm --prefix functions audit | Passed — 0 reported vulnerabilities |

These checks do not substitute for Firebase Emulator Suite tests or a deployed security review. The remote development workspace runs Node.js 20; Functions compilation and pure guard tests passed there, but deployment/runtime must use the configured Node.js 22 runtime.

## Remaining before Phase 2 can be called complete

1. Create a dedicated Firebase project for Growth Engine; never reuse production AnyTrader credentials or databases.
2. Copy .firebaserc.example to .firebaserc and replace the placeholder locally. Do not commit credentials or service-account keys.
3. Enable Firebase Authentication and configure allowed sign-in providers.
4. Run Auth, Firestore, and Functions emulators and add integration tests proving unauthenticated calls fail, non-members cannot read data, members cannot create campaigns, and Organisation A cannot access Organisation B.
5. Add a sign-in UI and typed frontend API adapter; keep local demo mode isolated and clearly labelled.
6. Add rate limiting/App Check, audit events, monitoring, and privacy/retention controls before any external production use.

## Scope boundary

This scaffold does not connect to live lead sources, Gemini, email delivery, billing, or production AnyTrader services. It does not turn the browser-local demo into a multi-user SaaS by itself.
