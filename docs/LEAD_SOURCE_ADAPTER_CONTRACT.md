# Approved Lead-Source Adapter Contract

This module establishes a provider-neutral boundary for future lead-source integrations. It does not connect to any provider or fetch live records.

## Safety rules

- API adapters are not ready unless they have a provider-specific, time-bounded approval record that identifies the reviewed terms URL, reviewer, review time, expiry, and permitted lead-discovery use.
- Manual CSV and synthetic-demo sources remain distinct adapter kinds; an API approval cannot be reused for another provider.
- Every imported source record should carry bounded provenance (provider ID, source record ID, retrieval timestamp, and optional HTTPS source URL).
- Provenance validation returns only allowlisted fields. Arbitrary provider payloads, contact data, and secrets are not copied into the provenance object or logs.
- Page size is capped at 500 by the contract; providers can set a lower limit.
- This gate does not prove lawful basis, provider compliance, contact permission, or consent. Those still require operator/legal review. No scraping, production credentials, data backfill, or outreach is introduced.

## Next integration steps

1. Review the intended use and current terms for each chosen provider separately.
2. Record an approval only after that review; do not mark a provider ready based on this helper alone.
3. Implement one adapter at a time and validate every returned record's provenance before mapping it into the existing lead-import workflow.
4. Keep human contact review and the existing do-not-contact gate authoritative.
