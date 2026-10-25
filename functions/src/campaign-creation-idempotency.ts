export interface ExpectedCampaignCreationReplay {
  actorUid: string;
  requestHash: string;
  organisationId: string;
  name: string;
  category: string;
  location: string;
  brand: string;
  goal: string;
}

export interface ValidCampaignCreationReplayResult {
  campaignId: string;
  organisationId: string;
  name: string;
  category: string;
  location: string;
  brand: string;
  goal: string;
  status: "active";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/**
 * Validate an idempotency record before returning its saved response. Exact
 * keys prevent unexpected persisted fields from leaking through a type cast.
 */
export function getValidCampaignCreationReplayResult(
  savedValue: unknown,
  expected: ExpectedCampaignCreationReplay,
): ValidCampaignCreationReplayResult | null {
  if (!isRecord(savedValue)
    || savedValue.actorUid !== expected.actorUid
    || savedValue.requestHash !== expected.requestHash
    || !isRecord(savedValue.result)) {
    return null;
  }

  const result = savedValue.result;
  const expectedKeys = ["campaignId", "organisationId", "name", "category", "location", "brand", "goal", "status"];
  const actualKeys = Object.keys(result);
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key) => !expectedKeys.includes(key))
    || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(result, key))
    || !isDocumentId(result.campaignId)
    || result.organisationId !== expected.organisationId
    || result.name !== expected.name
    || result.category !== expected.category
    || result.location !== expected.location
    || result.brand !== expected.brand
    || result.goal !== expected.goal
    || result.status !== "active") {
    return null;
  }

  return {
    campaignId: result.campaignId,
    organisationId: expected.organisationId,
    name: expected.name,
    category: expected.category,
    location: expected.location,
    brand: expected.brand,
    goal: expected.goal,
    status: "active",
  };
}

/**
 * Re-check tenant-contained persisted state before returning a successful
 * replay. Current campaign status is intentionally not checked: a later pause
 * or completion must not invalidate the original create request's retry.
 */
export function isPersistedCampaignCreationReplayAvailable(
  campaignValue: unknown,
  expected: Pick<ExpectedCampaignCreationReplay, "actorUid" | "name" | "category" | "location" | "brand" | "goal">,
): boolean {
  return isRecord(campaignValue)
    && campaignValue.createdBy === expected.actorUid
    && campaignValue.name === expected.name
    && campaignValue.category === expected.category
    && campaignValue.location === expected.location
    && campaignValue.brand === expected.brand
    && campaignValue.goal === expected.goal;
}
