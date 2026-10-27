# AI-assisted outreach draft suggestions

## Current behavior
The authenticated `suggestOutreachDraft` callable requests a draft suggestion from Gemini. It never sends messages and does not create a persisted draft by itself. The user must review/edit the suggestion and explicitly save it through the existing server-side draft creation path, which rechecks organisation membership and lead contact restrictions.

## Data minimisation and safeguards
- Only business name, category, location, campaign brand, campaign goal, and organisation name are sent to Gemini.
- Lead email, phone, internal notes, and other contact channels are not included in the model request.
- Prompt instructions treat all supplied fields as untrusted reference data, not instructions.
- Responses are constrained to a JSON subject/body schema and validated server-side as plain text and within the existing draft length limits.
- The server-side validator accepts only a plain data object with the exact `subject` and `body` keys; accessor-backed, symbol-keyed, hidden, unknown-field, array, and class-instance responses are rejected without invoking getters.
- Generation inputs are snapshotted through own enumerable data descriptors before use; context and option objects with accessors, symbol/unknown keys, hidden properties, arrays, or class instances fail closed without invoking getters.
- A `DRAFT ONLY — NOT SENT.` marker is enforced.
- The callable requires an authenticated lead editor, an existing campaign, an eligible lead that is not suppressed or awaiting contact review, and App Check outside the Functions emulator.
- Requests are rate-limited to 10 per user per organisation per minute. Provider timeouts are bounded.
- No generated draft is sent or scheduled. Human review is mandatory.

## Configuration
1. Configure a secret in the dedicated Growth Engine Firebase project: `firebase functions:secrets:set GEMINI_API_KEY`.
2. Optionally set `GEMINI_MODEL` in the Functions environment; the default is `gemini-3.8-flash`.
3. Deploy only after reviewing Gemini data handling, quotas/billing, App Check, and the production release checklist.
4. Test with synthetic data and a configured emulator secret before using real business records.

If the secret is absent, the callable fails closed with a configuration error. If Gemini is unavailable or returns invalid output, the UI offers the manual-draft workflow instead. The browser never receives the API key.
