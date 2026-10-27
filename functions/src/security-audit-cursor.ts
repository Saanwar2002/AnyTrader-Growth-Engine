const SECURITY_AUDIT_CURSOR_KEYS = new Set(["scope", "organisationId", "lastEventId"]);

/** Validate exact tenant-bound cursor payloads without trusting property reads. */
export function getValidSecurityAuditCursorId(value: unknown, expectedOrganisationId: string): string | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== SECURITY_AUDIT_CURSOR_KEYS.size
      || keys.some((key) => typeof key !== "string" || !SECURITY_AUDIT_CURSOR_KEYS.has(key))) return null;

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      snapshot[key as string] = descriptor.value;
    }
    if (snapshot.scope !== "organisation_security_audit"
      || snapshot.organisationId !== expectedOrganisationId
      || typeof snapshot.lastEventId !== "string"
      || !/^[A-Za-z0-9_-]{1,128}$/.test(snapshot.lastEventId)) return null;
    return snapshot.lastEventId;
  } catch {
    return null;
  }
}
