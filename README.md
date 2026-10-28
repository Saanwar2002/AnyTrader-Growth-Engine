# AnyTrader Growth Engine

A standalone, multi-brand lead discovery and provider acquisition workspace for AnyTrader, HandyTrader, and future businesses. The current release is a **local demo MVP**, not a production SaaS service.

## What works now

- Responsive dashboard with overview metrics and recent activity.
- Create campaigns with a brand, service category, target location, and acquisition goal.
- View campaign cards and change campaign status.
- Lead directory with an accessible search field; filters for lead status, service category, contact permission, and campaign; sorting by default order, business name A–Z, highest completeness score, or most recently added; active-filter count and clear-all controls; a clear-filters action when no records match; plus a lead details panel and editable internal notes.
- Lead status workflow: new, in review, qualified, contacted, onboarded, and rejected.
- Transparent completeness score (0–100) with an explanation of which fields contributed.
- CSV import with a 2 MB file limit, automatic header suggestions, configurable field mapping for unfamiliar spreadsheets, quoted-field support including embedded line breaks, row validation, per-campaign demo duplicate detection and a campaign-scoped client duplicate preview aligned with server-side tenant-scoped canonical email/website/business-location checks plus source-record-ID duplicate checks scoped to campaign and self-declared source label, with a visible partial-preview warning and an in-place load-more action whenever additional lead pages remain, and a review table that lets you include/exclude candidates before committing the import.
- Export currently visible leads to CSV, or export a selected subset (up to 25 selected at a time). Bulk selection selects every filtered loaded lead when there are 25 or fewer matches, and the first 25 in the current sort order when there are more. Selection exports include only selected records in loaded pages and do not fetch additional pages.
- Create and edit outreach drafts; no send action exists.
- Local activity history and a demo reset action.
- Synthetic example data clearly labelled as fictional.
- Automated tests for lead normalization/scoring, CSV parsing, demo persistence, interactive campaign/CSV/suppression/draft workflows, and server-side authorization guards.

## Run locally

Frontend requirements: Node.js 20 or newer and npm. The Firebase Functions backend targets Node.js 22.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. With no `.env.local` file, the app runs in local synthetic-data demo mode.

**Cloud mode is scaffolded but not yet configured.** Do not add Firebase values until a dedicated Growth Engine project exists and its Auth/Functions/Firestore/App Check setup has been validated in emulators. Email/password and Google sign-in are implemented in the cloud UI, but Google sign-in must be enabled in Firebase Console before it can work. At that point, copy `.env.example` to `.env.local` and use only that dedicated project's public web-app config. Never point this app at production AnyTrader. The cloud UI requires App Check configuration and expects the callable Functions API to be deployed to the same project. All deployed callable functions enforce App Check; the only bypass is the local Firebase Functions emulator. Never deploy until the dedicated project, App Check provider, and legitimate client token flow have been verified.

Quality checks:

```bash
npm run typecheck
npm test
npm run build
npm --prefix functions ci
npm --prefix functions run build
npm --prefix functions test
npm run test:emulators # optional; requires Node.js 22, Java, and emulator downloads
```

## Enable Google sign-in (Firebase setup)

1. Open the dedicated **Growth Engine** Firebase project in Firebase Console; do not use production AnyTrader.
2. Go to **Authentication → Sign-in method** (or **Sign-in providers**) and enable **Google**. Choose the project support email and save.
3. In **Authentication → Settings → Authorized domains**, confirm the exact development/hosting domain is listed. Firebase usually adds localhost for local development, but verify it; add only domains you control.
4. Register the web app with Firebase App Check, configure reCAPTCHA v3 for the intended domains, and add its site key as `VITE_FIREBASE_APPCHECK_SITE_KEY`. Configure the matching public web-app values in local `.env.local` from `.env.example`. Set `VITE_GROWTH_ENGINE_FIREBASE_PROJECT_ID` to the separately approved dedicated Growth Engine project ID; cloud mode remains disabled if it is missing or differs from `VITE_FIREBASE_PROJECT_ID`. Do not commit that file or use production project values.
5. Run the app locally and test both Google sign-in and email/password flows. Also test a cancelled popup, a popup-blocked browser, and a Google account whose email already belongs to an email/password account.
6. Before using real users/data, complete the emulator-backed tenant-isolation tests and security review. Google authentication proves the user's identity; it does **not** grant organisation access. All workspace permissions must continue to be enforced by server-side membership checks.

The current implementation uses Firebase's `signInWithPopup` with `GoogleAuthProvider`. If the same email already exists under another sign-in method, do not automatically link credentials; guide the user through a verified account-recovery/linking flow in a later hardening pass.

## CSV import format

A header row is required. The import first suggests column mappings, which you can review or change before previewing rows. The business name mapping is required; category, location, website, email, and phone are optional. Common aliases are detected automatically, including `businessName`, `companyName`, `tradingName`, `organisation`, `service`, `trade`, `industry`, `town`, `postcode`, `address`, `domain`, `contactEmail`, `mobile`, and `phoneNumber`. Any other named column can be manually mapped to a supported field.

- `category` or `serviceCategory`
- `location`, `city`, or `area`
- `website` or `url`
- `email` or `emailAddress`
- `phone` or `telephone`
- `sourceRecordId`, `providerRecordId`, or `externalRecordId` for an optional source-side row identifier (up to 200 characters)

Lead rows show an **Open website** shortcut only when the stored website value can be safely normalised to HTTP(S); it opens in a protected new tab. Unsafe schemes, credential-bearing URLs, local hosts, and malformed values are not rendered as links. This convenience does not establish that a website is trustworthy or that outreach is permitted.

The CSV import panel includes a blank downloadable template with all supported core columns and the optional source record ID column. The preview displays each ID before confirmation; exports preserve it for traceability. The ID is user-supplied metadata, not proof of source authenticity or permission to contact.

Import starts with a review summary, skips blank-name rows and businesses already present in the selected campaign using case-insensitive whitespace-normalised names, and lets you include/exclude candidate rows before confirming. The table shows up to eight candidates at a time; select-all applies to the complete candidate set. The parser handles a UTF-8 BOM, escaped quotes and quoted fields containing line breaks; rejects empty or duplicate headers, malformed quote placement, rows with more values than the header, oversized lead fields and malformed non-empty email addresses; and reports original source line numbers. The mapping step lets you map unfamiliar headings to supported lead fields; unmapped columns are ignored. Duplicate preview also compares optional source record IDs against loaded leads from the same campaign and self-declared source label, plus earlier upload rows; the server remains authoritative. Review every imported record before any outreach. This remains a lightweight MVP CSV parser and is not a full RFC 4180 implementation; recovery from an unmatched quote uses a conservative heuristic and should be verified against representative imports.

## Current pilot defaults

- **Provider category:** Painters and decorators.
- **Initial market:** United Kingdom; each campaign can specify another location.
- **Data mode:** Synthetic examples and user-supplied CSV only. Campaign cards provide manual Google Maps and LinkedIn company-search shortcuts based on the selected service category and target location; these links do not scrape or import results.
- **Outreach:** Draft-only; a human must review and personalise messages.
- **Repository boundary:** This project is independent of the AnyTrader application. Do not modify the original AnyTrader repository or its `main` branch as part of this project.

## Important limitations

The local demo is not a secure multi-user service. It uses browser localStorage, not a cloud database; data is local to that browser profile and may be lost if browser storage is cleared. The cloud backend/UI is still a scaffold and must not be treated as production-ready.

- The default demo mode uses browser localStorage and synthetic data only. If all required `VITE_FIREBASE_*` web config values are supplied in `.env.local` and `VITE_GROWTH_ENGINE_FIREBASE_PROJECT_ID` exactly matches `VITE_FIREBASE_PROJECT_ID`, the app instead shows the cloud sign-in and workspace UI, which calls the authenticated Functions API. The cloud UI supports organisation discovery/creation, campaign creation/listing, lead creation/listing/status changes, internal notes, suppression, and draft creation/listing/editing/deletion. As of 24 October 2026, GitHub Actions CI run [40093634576](https://github.com/Saanwar2002/AnyTrader-Growth-Engine/actions/runs/40093634576) passed both jobs for PR head `9fdffcfe86a57f631a27d641705a06ec466d284d`: frontend typecheck, unit tests, production build, Firebase Functions tests/build, dependency advisory checks, and the emulator integration smoke suite, including legacy exact-value email/website duplicate fallback checks. CI success is not production-readiness approval. The emulator suite covers synthetic cross-tenant isolation, callable authorization, pagination beyond 100 records, malformed cursor and legacy-record handling, and draft-only safeguards. This is meaningful emulator verification, not a production security certification.
- No dedicated Growth Engine Firebase project has been configured or deployed, and subscription billing and live source-provider integrations are not connected. Keep cloud mode disabled outside controlled emulator/local testing until a dedicated project is configured and separately reviewed. The cloud UI supports email/password and Google sign-in, organisation selection/creation, campaign creation, lead creation/status/suppression, and draft creation/deletion. New server-created leads and CSV-imported demo leads default to Do Not Contact pending review. Draft creation requires an explicit clear restriction, and server-side draft creation checks suppression transactionally; only owners/admins can remove a cloud contact restriction. This is a workflow safeguard, not proof of consent or a lawful basis to contact.
- Do not use it to store real customer data, sensitive personal data, or production credentials.
- The scoring model measures record completeness, not trustworthiness, service quality, or business legitimacy.
- CSV imports are not sent to an external service.
- No messages are sent automatically or manually by the app.
- Do not connect to production AnyTrader services or data without a separately reviewed integration plan.

## Roadmap

1. **Local demo MVP:** usable campaign and lead workflows, synthetic data, CSV import/export, drafts, and unit tests.
2. **Authentication and tenant-safe persistence:** emulator-backed callable authorization and tenant-isolation regression tests are now passing in CI; next configure a dedicated Firebase project, validate its Auth/Functions/Firestore setup, and complete a project-specific security review before enabling cloud mode outside local development.
3. **Workflow hardening:** richer import preview, lead details/notes, activity history, opt-out/suppression controls, and stronger CSV edge-case tests.
4. **Approved source adapters:** only APIs/data providers whose terms permit the intended use.
5. **Server-side AI assistance:** validated classification and draft generation with usage limits and human review.
6. **Attribution and SaaS controls:** onboarding attribution, plans, quotas, and later billing.
7. **Production hardening:** privacy/retention workflows, monitoring, backups, recovery, and security review.

## Cloud release readiness

Before enabling cloud mode or deploying Firebase resources, complete the [Cloud Release Readiness Gate](docs/CLOUD_RELEASE_READINESS_GATE.md). A green CI run is necessary but does not prove that a real Firebase project, App Check, privacy controls, or recovery procedures are ready. Keep cloud mode disabled until the dedicated Growth Engine Firebase project is created and verified. See the [evidence-based Production Readiness Audit for 27 October 2026](docs/PRODUCTION_READINESS_AUDIT_2026-10-27.md) for the current main SHA, exact post-merge CI result, and remaining blockers.

## Safety and privacy principles

- Do not use unauthorised scraping or bypass access controls.
- Respect data-source terms, rate limits, privacy law, and applicable marketing rules.
- Do not commit API keys, passwords, access tokens, or personal lead data.
- Keep synthetic fixtures clearly labelled as fictional.
- Use server-side permission checks for all privileged operations; the initial callable Functions scaffold checks Firebase Auth context and organisation membership.
- Use a separate Firebase project for Growth Engine; never reuse production AnyTrader credentials or databases.


## Firebase deployment safety gate

Firebase CLI deployments are blocked unless `GROWTH_ENGINE_FIREBASE_PROJECT_ID` explicitly names the approved Growth Engine project and Firebase CLI supplies a matching `GCLOUD_PROJECT`. The guard rejects missing values, mismatched targets, and `demo-*` emulator project IDs before the Functions predeploy build. Set both values only after creating and reviewing the dedicated Growth Engine Firebase project; never set the expected ID to the production AnyTrader project. This is a guard against accidental target selection, not proof that the project is correctly secured or that App Check has been verified.

## Privacy, retention, and offboarding

See [`docs/PRIVACY_DATA_RETENTION_AND_OFFBOARDING.md`](./docs/PRIVACY_DATA_RETENTION_AND_OFFBOARDING.md) for the proposed data inventory, retention decisions, tenant-scoped dry-run-first offboarding workflow, and release acceptance criteria. This is a specification only: destructive offboarding, production TTL, and account deletion are not implemented or authorised.


## Tenant offboarding preview

See [`docs/TENANT_OFFBOARDING_PREVIEW.md`](docs/TENANT_OFFBOARDING_PREVIEW.md) for the owner-only, bounded, non-destructive inventory callable and its explicit limitations. No deletion or production retention policy is enabled.
