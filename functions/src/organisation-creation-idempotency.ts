export interface ExpectedOrganisationCreationReplay {
  actorUid: string;
  requestHash: string;
  name: string;
}

export interface ValidOrganisationCreationReplayResult {
  organisationId: string;
  name: string;
  role: "owner";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOrganisationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function getValidOrganisationCreationReplayResult(
  savedValue: unknown,
  expected: ExpectedOrganisationCreationReplay,
): ValidOrganisationCreationReplayResult | null {
  if (!isRecord(savedValue)
    || savedValue.actorUid !== expected.actorUid
    || savedValue.requestHash !== expected.requestHash
    || !isRecord(savedValue.result)) return null;
  const result = savedValue.result;
  const expectedKeys = ["organisationId", "name", "role"];
  const actualKeys = Object.keys(result);
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key) => !expectedKeys.includes(key))
    || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(result, key))
    || !isOrganisationId(result.organisationId)
    || result.name !== expected.name
    || result.role !== "owner") return null;
  return { organisationId: result.organisationId, name: expected.name, role: "owner" };
}
