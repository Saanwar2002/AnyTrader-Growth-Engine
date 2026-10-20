# Transactional Rate-Limit Operations Runbook

**Status:** Operational guidance only. Logging and enforcement are implemented; production alert policies and response ownership must still be configured in the separate Firebase project.

## Signals

The callable backend emits structured Cloud Functions logs for:
- **Warning — `Mutation rate limit exceeded`:** a user/organisation/operation quota was exhausted. The event contains the operation, a SHA-256 quota key, quota/window settings and approximate retry duration.
- **Error — `Rate-limit state validation failed`:** persisted state or quota configuration was invalid. The mutation fails closed with `failed-precondition`.

The quota key is a hash of the organisation ID, user UID and operation. Do not attempt to identify a person from the hash alone. Events intentionally do not include raw user or organisation IDs.

## Initial response

1. Confirm the environment/project and identify the callable operation and event timestamp.
2. Determine whether the event is isolated or repeated for the same hashed quota key and operation.
3. For quota-exhaustion warnings, compare frequency and retry duration with expected application usage. A single event may be normal guardrail behavior; bursts may indicate a client retry loop, automation bug, or abuse.
4. For invalid-state errors, treat the event as an integrity issue. Check recent deployments and quota configuration changes; investigate the corresponding `rateLimits/{hashed-key}` document using an authorised operator identity.
5. Do not clear or edit a quota document merely to silence an alert. Preserve relevant timestamps and evidence, identify the cause, and record any corrective action.
6. If a legitimate workload is being blocked, review measured traffic and transaction costs before changing the quota. Changes require tests against the emulator pagination workload and review for abuse exposure.
7. If abuse is suspected, apply the organisation's incident process and review adjacent authentication, callable error and billing signals. Do not expose hashed keys or internal incident details to customers.

## Safe recovery for invalid persisted state

- Confirm the error is in the intended Firebase project and environment.
- Inspect the specific quota document and deployment/configuration history.
- Preserve a copy of the malformed fields and timestamps in the incident record without copying unrelated personal data.
- Correct or remove the state only after the operator has established the intended recovery behavior and received appropriate approval.
- Re-run the relevant emulator regression and verify the callable fails closed for malformed state.
- Record the resolution and add a regression test if a new failure mode was discovered.

## Alerting and ownership checklist

Before production use, configure and verify:
- [ ] Warning alert for repeated quota-exhaustion events, with a threshold tuned to expected traffic.
- [ ] High-priority alert for invalid rate-limit state errors.
- [ ] Log retention and access permissions appropriate to the service's operational needs.
- [ ] Named alert owner, escalation path and response-time expectations.
- [ ] Budget alerts and monitoring for Firestore reads/writes and Cloud Functions invocations.
- [ ] A documented process for quota tuning, including tests and approval.
- [ ] A separate-project test proving alerts fire on synthetic warning and error events.

**Production caveat:** This runbook does not mean alerts have been deployed. App Check, production-project configuration, monitoring/alert verification, privacy and operational readiness checks remain release blockers.


## Rate-limit document lifecycle and safe cleanup

**Current behavior:** each user/organisation/operation quota uses a stable hashed document under `rateLimits/{hash}`. The document is reused across windows and currently has no expiry field managed by the application. Consequently, the number of distinct quota documents can grow as new users, organisations, or operations appear. No Firestore TTL policy is configured by this repository.

**Do not delete an active quota document to recover from throttling.** Removing it resets that bucket to its first-request state and can bypass the configured quota. First establish that the stored window has expired according to the server-side evaluator, and preserve evidence before any operator cleanup.

Before enabling automated cleanup in the separate Firebase project:

1. Add a server-managed Firestore timestamp field (for example, `expireAt`) to quota documents, derived from the persisted window start plus the configured window duration and a documented safety grace period. Do not accept this timestamp from clients.
2. Ensure each successful quota update refreshes the expiry timestamp consistently with the window actually stored. Keep quota evaluation authoritative; TTL is storage cleanup, not enforcement.
3. Configure and verify a Firestore TTL policy for the exact collection group/field in the intended project. Merely writing an `expireAt` field does not enable TTL.
4. Verify with emulator/integration tests that an expired bucket behaves as a fresh window even if its old document remains, and that deleting only an already-expired bucket cannot grant requests before the original window would have expired.
5. Monitor document counts and cleanup lag, document the grace period and rollback procedure, and confirm that TTL configuration is present in deployment operations before marking this control complete.

Until that work is implemented and verified, quota documents are expected to persist. Do not manually bulk-delete the collection as a substitute for a lifecycle policy.
