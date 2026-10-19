# AnyTrader Growth Engine

A standalone, multi-brand lead discovery and provider acquisition tool for AnyTrader, HandyTrader, and future marketplaces.

## Current implementation

The first interactive demo is built with React, TypeScript, and Vite. It includes:
- Workspace overview with pipeline metrics and campaign summaries.
- Campaign creation and lifecycle status management.
- Fictional lead records, lead scoring explanations, search and filters.
- Lead detail drawer, status transitions, and activity history.
- CSV import with required-column validation, 2 MB file limit, and duplicate checks on business name + city.
- CSV export for the currently visible leads.
- Outreach draft generation with explicit human-review messaging; no sending capability exists.
- Browser-local persistence and reset-to-demo controls.
- Workspace settings that clearly identify authentication, server-side tenant isolation, and live integrations as not yet implemented.

## Initial pilot and guardrails

- **Provider category:** Painters and decorators
- **Initial market:** United Kingdom (configurable by campaign)
- **Data mode:** Synthetic/demo records and locally imported CSV only
- **Outreach:** Draft-only; nothing is sent
- **Repository boundary:** This project is independent of the AnyTrader application. Do not modify the AnyTrader repository or its `main` branch as part of this project.

All built-in sample records are fictional and use reserved example.com domains and placeholder phone numbers. CSV records in this prototype are also marked as demo records in the app. Do not import real personal data until authentication, tenant isolation, privacy controls, retention, and a secure backend are implemented and reviewed.

## Development

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

The current prototype persists state in the browser's local storage. It is not a multi-user SaaS backend and must not be treated as secure storage. Clearing/resetting browser storage removes locally saved changes.

## Architecture direction

See [docs/MASTER_ARCHITECTURE.md](docs/MASTER_ARCHITECTURE.md) for the security model and staged plan. Firebase Authentication and Firestore in a dedicated Growth Engine project plus a trusted backend are proposed for a later phase; they are not configured yet.

## Safety and privacy principles

- Do not use unauthorised scraping or bypass access controls.
- Respect data-source terms, rate limits, privacy law, and applicable marketing rules.
- Do not send outreach automatically.
- Do not commit API keys, passwords, access tokens, or personal lead data.
- Keep synthetic fixtures clearly labelled as fictional.
- Do not connect to production AnyTrader data or services without a separately reviewed integration plan.

## Current limitations

No authentication, server-side authorisation, Firestore, trusted backend, live lead sources, AI integration, billing, or production AnyTrader integration is configured. Browser-local demo data is not tenant-isolated. The app is a development prototype, not a production-ready SaaS.
