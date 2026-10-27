const SECURITY_AUDIT_EVENT_KEYS = new Set([
  "schemaVersion", "eventType", "organisationId", "actorUid", "resourceType",
  "resourceId", "outcome", "metadata", "createdAt",
]);

/**
 * Snapshot a persisted audit event without invoking getters. Timestamp and
 * metadata values are copied as opaque values and validated separately.
 */
export function snapshotPersistedSecurityAuditEvent(value: unknown): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== SECURITY_AUDIT_EVENT_KEYS.size
      || keys.some((key) => typeof key !== "string" || !SECURITY_AUDIT_EVENT_KEYS.has(key))) return null;

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      snapshot[key as string] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}
