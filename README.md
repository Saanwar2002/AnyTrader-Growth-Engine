# AnyTrader Growth Engine

A standalone, multi-brand lead discovery and provider acquisition workspace for AnyTrader, HandyTrader, and future businesses. The current release is a **local demo MVP**, not a production SaaS service.

## What works now

- Responsive dashboard with overview metrics and recent activity.
- Create campaigns with a brand, service category, target location, and acquisition goal.
- View campaign cards and change campaign status.
- Lead directory with search and filters for status and campaign, plus a lead details panel and editable internal notes.
- Lead status workflow: new, in review, qualified, contacted, onboarded, and rejected.
- Transparent completeness score (0–100) with an explanation of which fields contributed.
- CSV import with a 2 MB file limit, automatic header suggestions, configurable field mapping for unfamiliar spreadsheets, basic quoted-field support, row validation, per-campaign duplicate detection, and a review table that lets you include/exclude candidates before committing the import.
- Export currently visible leads to CSV.
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

Open the local URL printed by Vite.

Quality checks:

```bash
npm run typecheck
npm test
npm run build
npm --prefix functions ci
npm --prefix functions run build
npm --prefix functions test
```

## CSV import format

A header row is required. The import first suggests column mappings, which you can review or change before previewing rows. The business name mapping is required; category, location, website, email, and phone are optional. Common aliases are detected automatically, including `businessName`, `companyName`, `tradingName`, `organisation`, `service`, `trade`, `industry`, `town`, `postcode`, `address`, `domain`, `contactEmail`, `mobile`, and `phoneNumber`. Any other named column can be manually mapped to a supported field.

- `category` or `serviceCategory`
- `location`, `city`, or `area`
- `website` or `url`
- `email` or `emailAddress`
- `phone` or `telephone`

Import starts with a review summary, skips blank-name rows and businesses already present in the selected campaign using case-insensitive whitespace-normalised names, and lets you include/exclude candidate rows before confirming. The table shows up to eight candidates at a time; select-all applies to the complete candidate set. The parser handles a UTF-8 BOM and escaped quotes, rejects empty or duplicate headers and rows with more values than the header, and reports original source line numbers. The mapping step lets you map unfamiliar headings to supported lead fields; unmapped columns are ignored. Review every imported record before any outreach. This is a lightweight MVP CSV parser; it does not support quoted fields containing line breaks or guarantee full RFC 4180 compliance.

## Current pilot defaults

- **Provider category:** Painters and decorators.
- **Initial market:** United Kingdom; each campaign can specify another location.
- **Data mode:** Synthetic examples and user-supplied CSV only.
- **Outreach:** Draft-only; a human must review and personalise messages.
- **Repository boundary:** This project is independent of the AnyTrader application. Do not modify the original AnyTrader repository or its `main` branch as part of this project.

## Important limitations

This release is a browser-local demo, not a secure multi-user service:

- It uses browser localStorage, not a cloud database. Data is local to that browser profile and may be lost if browser storage is cleared.
- The frontend still uses browser localStorage and is not connected to the backend. A Firebase Functions scaffold now provides authenticated organisation/campaign operations and tenant-scoped lead listing, creation, status updates, notes, suppression, and draft creation. Firestore direct client access is denied by default. The backend has not been connected to the UI, deployed, or integration-tested against Firebase emulators.
- There is no configured dedicated Firebase project, sign-in screen, emulator-backed tenant-isolation test, production audit system, subscription billing, or live source-provider integration. Server-side draft creation checks suppression transactionally; only owners/admins can remove a contact restriction.
- Do not use it to store real customer data, sensitive personal data, or production credentials.
- The scoring model measures record completeness, not trustworthiness, service quality, or business legitimacy.
- CSV imports are not sent to an external service.
- No messages are sent automatically or manually by the app.
- Do not connect to production AnyTrader services or data without a separately reviewed integration plan.

## Roadmap

1. **Local demo MVP:** usable campaign and lead workflows, synthetic data, CSV import/export, drafts, and unit tests.
2. **Authentication and tenant-safe persistence:** configure the dedicated Firebase project, connect Firebase Auth to the UI, exercise callable endpoints in emulators, add tenant-isolation integration tests, and only then replace local demo persistence.
3. **Workflow hardening:** richer import preview, lead details/notes, activity history, opt-out/suppression controls, and stronger CSV edge-case tests.
4. **Approved source adapters:** only APIs/data providers whose terms permit the intended use.
5. **Server-side AI assistance:** validated classification and draft generation with usage limits and human review.
6. **Attribution and SaaS controls:** onboarding attribution, plans, quotas, and later billing.
7. **Production hardening:** privacy/retention workflows, monitoring, backups, recovery, and security review.

## Safety and privacy principles

- Do not use unauthorised scraping or bypass access controls.
- Respect data-source terms, rate limits, privacy law, and applicable marketing rules.
- Do not commit API keys, passwords, access tokens, or personal lead data.
- Keep synthetic fixtures clearly labelled as fictional.
- Use server-side permission checks for all privileged operations; the initial callable Functions scaffold checks Firebase Auth context and organisation membership.
- Use a separate Firebase project for Growth Engine; never reuse production AnyTrader credentials or databases.
