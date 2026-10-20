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
