export interface ExpectedImportReplay {
  actorUid: string; requestHash: string; organisationId: string; campaignId: string; received: number;
}
export interface ValidImportReplayResult {
  organisationId: string; campaignId: string; received: number; imported: number; duplicatesSkipped: number;
  leads: Array<{ leadId: string; businessName: string }>; sent: false; messageSentByThisAction: false;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
/** Validate the exact persisted CSV-import replay response before returning it. */
export function getValidImportReplayResult(savedValue: unknown, expected: ExpectedImportReplay): ValidImportReplayResult | null {
  if (!isRecord(savedValue) || savedValue.actorUid !== expected.actorUid
    || savedValue.requestHash !== expected.requestHash || !isRecord(savedValue.result)) return null;
  const result = savedValue.result;
  const keys = ["organisationId","campaignId","received","imported","duplicatesSkipped","leads","sent","messageSentByThisAction"];
  const actual = Object.keys(result);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(result, key))
    || result.organisationId !== expected.organisationId || result.campaignId !== expected.campaignId
    || result.received !== expected.received || !Number.isSafeInteger(result.imported)
    || (result.imported as number) < 0 || !Number.isSafeInteger(result.duplicatesSkipped)
    || (result.duplicatesSkipped as number) < 0
    || (result.imported as number) + (result.duplicatesSkipped as number) !== expected.received
    || result.sent !== false || result.messageSentByThisAction !== false || !Array.isArray(result.leads)
    || result.leads.length !== result.imported) return null;
  const seen = new Set<string>();
  const leads: Array<{leadId:string;businessName:string}> = [];
  for (const item of result.leads) {
    if (!isRecord(item)) return null;
    const itemKeys = Object.keys(item);
    if (itemKeys.length !== 2 || !itemKeys.includes("leadId") || !itemKeys.includes("businessName")
      || !isDocumentId(item.leadId) || typeof item.businessName !== "string" || item.businessName.length < 1
      || seen.has(item.leadId)) return null;
    seen.add(item.leadId);
    leads.push({ leadId: item.leadId, businessName: item.businessName });
  }
  return {
    organisationId: expected.organisationId, campaignId: expected.campaignId, received: expected.received,
    imported: result.imported as number, duplicatesSkipped: result.duplicatesSkipped as number,
    leads, sent: false, messageSentByThisAction: false,
  };
}
/** Ensure each replayed lead still exists in the original tenant/campaign under the original creator. */
export function isPersistedImportedLeadReplayAvailable(
  value: unknown,
  expected: { actorUid: string; campaignId: string; businessName: string; sourceLabel: string },
): boolean {
  return isRecord(value) && value.createdBy === expected.actorUid
    && value.campaignId === expected.campaignId && value.businessName === expected.businessName
    && value.source === expected.sourceLabel && value.status === "new"
    && value.doNotContact === true && value.contactReviewStatus === "pending"
    && value.contactReviewRevision === 0;
}
