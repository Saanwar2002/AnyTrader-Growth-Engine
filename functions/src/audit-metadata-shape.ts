/**
 * Require the complete event-specific metadata shape, not merely a subset of
 * allowed keys. Persisted audit rows missing required flags are malformed too.
 */
export function hasExactAuditMetadataKeys(value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === allowedKeys.length
    && actualKeys.every((key) => allowedKeys.includes(key))
    && allowedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
