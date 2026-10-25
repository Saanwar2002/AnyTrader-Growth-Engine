export interface ExpectedLeadCreationReplay {
  actorUid: string; requestHash: string; organisationId: string; campaignId: string;
  businessName: string; category: string; location: string; website: string; email: string; phone: string;
}
export interface ValidLeadCreationReplayResult {
  leadId: string; organisationId: string; campaignId: string; businessName: string; category: string;
  location: string; website: string; email: string; phone: string; status: "new"; source: "manual";
  score: number; scoreReasons: string[]; doNotContact: true; contactReviewStatus: "pending";
  contactReviewRevision: 0;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
export function getValidLeadCreationReplayResult(savedValue: unknown, expected: ExpectedLeadCreationReplay): ValidLeadCreationReplayResult | null {
  if (!isRecord(savedValue) || savedValue.actorUid !== expected.actorUid
    || savedValue.requestHash !== expected.requestHash || !isRecord(savedValue.result)) return null;
  const result = savedValue.result;
  const keys = ["leadId","organisationId","campaignId","businessName","category","location","website","email","phone","status","source","score","scoreReasons","doNotContact","contactReviewStatus","contactReviewRevision"];
  const actual = Object.keys(result);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(result, key))
    || !isDocumentId(result.leadId) || result.organisationId !== expected.organisationId
    || result.campaignId !== expected.campaignId || result.businessName !== expected.businessName
    || result.category !== expected.category || result.location !== expected.location
    || result.website !== expected.website || result.email !== expected.email || result.phone !== expected.phone
    || result.status !== "new" || result.source !== "manual"
    || typeof result.score !== "number" || !Number.isFinite(result.score)
    || !Array.isArray(result.scoreReasons) || !result.scoreReasons.every((reason) => typeof reason === "string")
    || result.doNotContact !== true || result.contactReviewStatus !== "pending" || result.contactReviewRevision !== 0) return null;
  return {
    leadId: result.leadId as string, organisationId: expected.organisationId, campaignId: expected.campaignId,
    businessName: expected.businessName, category: expected.category, location: expected.location,
    website: expected.website, email: expected.email, phone: expected.phone, status: "new", source: "manual",
    score: result.score, scoreReasons: [...result.scoreReasons] as string[], doNotContact: true,
    contactReviewStatus: "pending", contactReviewRevision: 0,
  };
}
export function isPersistedLeadCreationReplayAvailable(
  value: unknown,
  expected: Pick<ExpectedLeadCreationReplay, "actorUid" | "campaignId" | "businessName" | "category" | "location" | "website" | "email" | "phone">,
  result: Pick<ValidLeadCreationReplayResult, "score" | "scoreReasons">,
): boolean {
  if (!isRecord(value) || !Array.isArray(value.scoreReasons)) return false;
  return value.createdBy === expected.actorUid && value.campaignId === expected.campaignId
    && value.businessName === expected.businessName && value.category === expected.category
    && value.location === expected.location && value.website === expected.website
    && value.email === expected.email && value.phone === expected.phone
    && value.status === "new" && value.source === "manual" && value.score === result.score
    && value.scoreReasons.length === result.scoreReasons.length
    && value.scoreReasons.every((reason: unknown, i: number) => reason === result.scoreReasons[i])
    && value.doNotContact === true && value.contactReviewStatus === "pending" && value.contactReviewRevision === 0;
}
