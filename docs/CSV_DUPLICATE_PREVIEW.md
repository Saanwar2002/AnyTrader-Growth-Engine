# CSV duplicate preview

Before a CSV import is confirmed, the workspace flags likely duplicates using the same broad match families as the server: normalised email, canonical website, and business name plus location. It checks the currently loaded lead records and earlier non-duplicate rows in the selected file.

The preview never removes rows automatically and never replaces the transactional server-side dedupe. Server validation remains authoritative across the organisation's complete stored inventory. When additional lead pages exist, the UI says the preview is partial. The feature is advisory only; it does not verify source permissions, consent, or eligibility for outreach.
