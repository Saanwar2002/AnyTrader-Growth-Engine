export type LeadIdentifierReservationType = "email" | "website" | "businessLocation";

export interface ValidLeadIdentifierReservationState {
  leadId: string;
  identifierType: LeadIdentifierReservationType;
}

/**
 * Validate the persisted reservation identity without trusting property access.
 * createdAt is accepted as optional legacy metadata but is never used to
 * decide whether a reservation is authoritative.
 */
export function getValidLeadIdentifierReservationState(
  value: unknown,
  expectedType: LeadIdentifierReservationType,
): ValidLeadIdentifierReservationState | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const keys = Reflect.ownKeys(value);
    const allowedKeys = new Set(["schemaVersion", "identifierType", "leadId", "createdAt"]);
    if (keys.some((key) => typeof key !== "string" || !allowedKeys.has(key))
      || keys.length < 3 || keys.length > allowedKeys.size) return null;

    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      snapshot[key as string] = descriptor.value;
    }

    if (!Object.prototype.hasOwnProperty.call(snapshot, "schemaVersion")
      || !Object.prototype.hasOwnProperty.call(snapshot, "identifierType")
      || !Object.prototype.hasOwnProperty.call(snapshot, "leadId")
      || snapshot.schemaVersion !== 1
      || snapshot.identifierType !== expectedType
      || typeof snapshot.leadId !== "string"
      || !/^[A-Za-z0-9_-]{1,128}$/.test(snapshot.leadId)) return null;

    return { leadId: snapshot.leadId, identifierType: expectedType };
  } catch {
    return null;
  }
}
