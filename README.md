# AnyTrader Growth Engine

A standalone, multi-brand lead discovery and provider acquisition tool for AnyTrader, HandyTrader, and future marketplaces.

## Initial pilot

- **Provider category:** Painters and decorators
- **Initial market:** United Kingdom (configurable by campaign)
- **Data mode:** Synthetic/demo records only until an approved data source is configured
- **Outreach:** Draft-only; a human must review and approve messages
- **Repository boundary:** This project is independent of the AnyTrader application. Do not modify the AnyTrader repository or its `main` branch as part of this project.

## Product goals

1. Configure campaigns by brand, service category, geography, and acquisition objective.
2. Discover leads through authorised, policy-compliant data-source adapters.
3. Normalize records and deduplicate leads.
4. Score leads with transparent, explainable criteria.
5. Review, qualify, and manage leads in a dashboard.
6. Generate outreach drafts without sending messages automatically.
7. Track onboarding attribution and campaign outcomes when integrations are deliberately configured.
8. Keep brand-specific settings separate from reusable platform logic.

## Planned delivery phases

1. **Foundation:** project structure, typed domain models, campaign configuration, synthetic data, basic tests, and setup documentation.
2. **Lead-source adapters:** integrate approved APIs or data providers; document permissions, limits, and data provenance.
3. **Qualification:** normalization, deduplication, configurable scoring, and suppression/opt-out controls.
4. **Review dashboard:** campaign and lead list views, filters, status changes, and record details.
5. **Outreach drafts:** brand-aware templates, preview, audit trail, and explicit human approval; no automatic sending.
6. **Attribution and analytics:** onboarding links, source/campaign tracking, and performance reporting.
7. **Hardening and deployment:** security review, privacy/retention controls, observability, and deployment documentation.

## Safety and privacy principles

- Do not use unauthorised scraping or bypass access controls.
- Respect data-source terms, rate limits, privacy law, and applicable marketing rules.
- Do not send outreach automatically in the initial release.
- Do not commit API keys, passwords, access tokens, or personal lead data.
- Keep synthetic fixtures clearly labelled as fictional.
- Do not connect to production AnyTrader data or services without a separately reviewed integration plan.

## Initial implementation guidance

Choose the simplest maintainable stack after inspecting the repository and confirming the available runtime. Keep provider integrations behind interfaces so the application is not coupled to one source. Add tests for validation, deduplication, scoring, and campaign isolation from the beginning.

## Status

Project bootstrap only. No production integrations or live lead collection are configured yet.
