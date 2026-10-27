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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the committed response before returning it for an idempotent retry.
 * The returned changed IDs must be unique members of the original request and
 * agree with the counts, preventing malformed stored state from being trusted.
 */
export function getValidBulkLeadStatusReplayResult(
  value: unknown,
  expected: ExpectedBulkLeadStatusReplay,
): ValidBulkLeadStatusReplayResult | null {
  if (!isRecord(value)
    || value.organisationId !== expected.organisationId
    || value.status !== expected.status
    || !Number.isSafeInteger(value.updatedCount)
    || !Number.isSafeInteger(value.unchangedCount)
    || (value.updatedCount as number) < 0
    || (value.unchangedCount as number) < 0
    || !Array.isArray(value.leadIds)) {
    return null;
  }

  const requestedIds = new Set(expected.leadIds);
  const changedIds = value.leadIds;
  for (let index = 0; index < changedIds.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(changedIds, index) || typeof changedIds[index] !== "string") {
      return null;
    }
  }
  if (changedIds.some((id) => typeof id !== "string" || id.length === 0 || id.includes("/") || !requestedIds.has(id))
    || new Set(changedIds).size !== changedIds.length
    || value.updatedCount !== changedIds.length
    || (value.updatedCount as number) + (value.unchangedCount as number) !== expected.leadIds.length) {
    return null;
  }

  return {
    organisationId: expected.organisationId,
    status: expected.status,
    updatedCount: value.updatedCount as number,
    unchangedCount: value.unchangedCount as number,
    leadIds: [...changedIds] as string[],
  };
}
