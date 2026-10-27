/**
 * Require the complete event-specific metadata shape, not merely a subset of
 * allowed keys. Persisted audit rows missing required flags are malformed too.
 */
export function hasExactAuditMetadataKeys(value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const actualKeys = Reflect.ownKeys(value);
    if (actualKeys.length !== allowedKeys.length) return false;
    for (const key of actualKeys) {
      if (typeof key !== "string" || !allowedKeys.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return false;
    }
    return allowedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  } catch {
    return false;
  }
}
