export interface ExpectedBulkLeadStatusReplay {
  organisationId: string;
  status: string;
  leadIds: readonly string[];
}

export interface ValidBulkLeadStatusReplayResult {
  organisationId: string;
  status: string;
  updatedCount: number;
  unchangedCount: number;
  leadIds: string[];
}

const RESULT_KEYS = ["organisationId", "status", "updatedCount", "unchangedCount", "leadIds"] as const;

function snapshotReplayResult(value: unknown): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const keys = Reflect.ownKeys(value);
    if (keys.length !== RESULT_KEYS.length || keys.some((key) => typeof key !== "string" || !RESULT_KEYS.includes(key as typeof RESULT_KEYS[number]))) {
      return null;
    }

    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of RESULT_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    // Persisted state is untrusted; hostile proxies must fail closed.
    return null;
  }
}

function snapshotChangedIds(value: unknown): string[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes("length")) return null;

    const result: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!keys.includes(String(index))) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Validate the committed response before returning it for an idempotent retry.
 * The result is copied using own data descriptors only: accessors, unexpected
 * fields, custom prototypes, sparse/extended arrays, and hostile proxies fail closed.
 */
export function getValidBulkLeadStatusReplayResult(
  value: unknown,
  expected: ExpectedBulkLeadStatusReplay,
): ValidBulkLeadStatusReplayResult | null {
  const snapshot = snapshotReplayResult(value);
  if (!snapshot
    || snapshot.organisationId !== expected.organisationId
    || snapshot.status !== expected.status
    || !Number.isSafeInteger(snapshot.updatedCount)
    || !Number.isSafeInteger(snapshot.unchangedCount)
    || (snapshot.updatedCount as number) < 0
    || (snapshot.unchangedCount as number) < 0) {
    return null;
  }

  const changedIds = snapshotChangedIds(snapshot.leadIds);
  if (!changedIds) return null;

  const requestedIds = new Set(expected.leadIds);
  if (changedIds.some((id) => id.length === 0 || id.includes("/") || !requestedIds.has(id))
    || new Set(changedIds).size !== changedIds.length
    || snapshot.updatedCount !== changedIds.length
    || (snapshot.updatedCount as number) + (snapshot.unchangedCount as number) !== expected.leadIds.length) {
    return null;
  }

  return {
    organisationId: expected.organisationId,
    status: expected.status,
    updatedCount: snapshot.updatedCount as number,
    unchangedCount: snapshot.unchangedCount as number,
    leadIds: changedIds,
  };
}
