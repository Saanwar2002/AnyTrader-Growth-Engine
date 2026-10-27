const MEMBER_ROSTER_CURSOR_KEYS = new Set(["scope", "organisationId", "lastUid"]);

/** Validate an exact organisation-bound member-roster cursor payload. */
export function getValidMemberRosterCursorUid(value: unknown, expectedOrganisationId: string): string | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== MEMBER_ROSTER_CURSOR_KEYS.size
      || keys.some((key) => typeof key !== "string" || !MEMBER_ROSTER_CURSOR_KEYS.has(key))) return null;

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      snapshot[key as string] = descriptor.value;
    }
    if (snapshot.scope !== "organisation_member_roster"
      || snapshot.organisationId !== expectedOrganisationId
      || typeof snapshot.lastUid !== "string"
      || !/^[A-Za-z0-9_-]{1,128}$/.test(snapshot.lastUid)) return null;
    return snapshot.lastUid;
  } catch {
    return null;
  }
}
