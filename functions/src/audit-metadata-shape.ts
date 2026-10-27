/**
 * Snapshot an exact metadata record through own data descriptors.
 * This avoids executing a Proxy's get trap or an accessor while validating values
 * and provides a detached plain record for persistence.
 */
export function snapshotExactAuditMetadata(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const actualKeys = Reflect.ownKeys(value);
    if (actualKeys.length !== allowedKeys.length) return null;
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of actualKeys) {
      if (typeof key !== "string" || !allowedKeys.includes(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      snapshot[key] = descriptor.value;
    }
    return allowedKeys.every((key) => Object.prototype.hasOwnProperty.call(snapshot, key))
      ? snapshot
      : null;
  } catch {
    return null;
  }
}

/** Require the complete event-specific metadata key set without reading properties. */
export function hasExactAuditMetadataKeys(value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> {
  return snapshotExactAuditMetadata(value, allowedKeys) !== null;
}
