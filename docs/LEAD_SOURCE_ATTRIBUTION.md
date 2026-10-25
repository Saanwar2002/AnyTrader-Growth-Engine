# Lead import source attribution

CSV import supports four user-declared source labels: generic CSV, LinkedIn export, Google Maps/Places research, and another approved source. The chosen label is stored on the lead record and shown in the lead directory. It is operator-supplied attribution, not independently verified evidence that the source terms or collection method were compliant.

The selected source label is included in the import idempotency fingerprint for non-default labels. Default generic CSV imports preserve the legacy fingerprint so uncertain retries from older clients remain safe. Source labels are validated against a server-side allowlist. Imports still use the existing deduplication and transactional write path; imported leads remain suppressed and pending human review.

Only select a LinkedIn or Google Maps/Places label if you have verified that your account, collection method, intended business recruitment purpose, retention, and use comply with the relevant provider terms and applicable privacy/marketing requirements. This feature does not scrape either provider, verify permissions, or authorise outreach. Actual API integrations remain disabled pending source review, dedicated Firebase configuration, and any required billing approval.
