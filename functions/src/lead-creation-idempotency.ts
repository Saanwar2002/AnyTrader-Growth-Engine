export interface ExpectedLeadCreationReplay {
  actorUid: string; requestHash: string; organisationId: string; campaignId: string;
  businessName: string; category: string; location: string; website: string; email: string; phone: string;
  dedupeEmailKey: string; dedupeWebsiteKey: string; dedupeBusinessLocationKey: string; sourceRecordId?: string;
}
export interface ValidLeadCreationReplayResult {
  leadId: string; organisationId: string; campaignId: string; businessName: string; category: string;
  location: string; website: string; email: string; phone: string;
  dedupeEmailKey: string; dedupeWebsiteKey: string; dedupeBusinessLocationKey: string; status: "new"; source: "manual";
  score: number; scoreReasons: string[]; doNotContact: true; contactReviewStatus: "pending";
  contactReviewRevision: 0; sourceRecordId?: string;
}
function snapshotPlainRecord(value: unknown): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}
function isDocumentId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function snapshotDenseStringArray(value: unknown): string[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(0|[1-9]\d*)$/.test(key)))) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0 || lengthDescriptor.value > 100 || keys.length !== lengthDescriptor.value + 1) return null;
    const copy: string[] = [];
    for (let index = 0; index < lengthDescriptor.value; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") return null;
      copy.push(descriptor.value);
    }
    return copy;
  } catch {
    return null;
  }
}
export function getValidLeadCreationReplayResult(savedValue: unknown, expected: ExpectedLeadCreationReplay): ValidLeadCreationReplayResult | null {
  const saved = snapshotPlainRecord(savedValue);
  if (!saved || Object.keys(saved).length !== 3
    || !Object.prototype.hasOwnProperty.call(saved, "actorUid")
    || !Object.prototype.hasOwnProperty.call(saved, "requestHash")
    || !Object.prototype.hasOwnProperty.call(saved, "result")
    || saved.actorUid !== expected.actorUid || saved.requestHash !== expected.requestHash) return null;
  const result = snapshotPlainRecord(saved.result);
  if (!result) return null;
  const keys = ["leadId","organisationId","campaignId","businessName","category","location","website","email","phone","dedupeEmailKey","dedupeWebsiteKey","dedupeBusinessLocationKey","status","source","score","scoreReasons","doNotContact","contactReviewStatus","contactReviewRevision", ...(expected.sourceRecordId !== undefined ? ["sourceRecordId"] : [])];
  const actual = Object.keys(result);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(result, key))
    || !isDocumentId(result.leadId) || result.organisationId !== expected.organisationId
    || result.campaignId !== expected.campaignId || result.businessName !== expected.businessName
    || result.category !== expected.category || result.location !== expected.location
    || result.website !== expected.website || result.email !== expected.email || result.phone !== expected.phone
    || result.dedupeEmailKey !== expected.dedupeEmailKey || result.dedupeWebsiteKey !== expected.dedupeWebsiteKey
    || result.dedupeBusinessLocationKey !== expected.dedupeBusinessLocationKey
    || (expected.sourceRecordId !== undefined && result.sourceRecordId !== expected.sourceRecordId)
    || result.status !== "new" || result.source !== "manual"
    || typeof result.score !== "number" || !Number.isFinite(result.score) || result.score < 0 || result.score > 100
    || !snapshotDenseStringArray(result.scoreReasons)
    || result.doNotContact !== true || result.contactReviewStatus !== "pending" || result.contactReviewRevision !== 0) return null;
  return {
    leadId: result.leadId as string, organisationId: expected.organisationId, campaignId: expected.campaignId,
    businessName: expected.businessName, category: expected.category, location: expected.location,
    website: expected.website, email: expected.email, phone: expected.phone,
    dedupeEmailKey: expected.dedupeEmailKey, dedupeWebsiteKey: expected.dedupeWebsiteKey,
    dedupeBusinessLocationKey: expected.dedupeBusinessLocationKey, status: "new", source: "manual",
    score: result.score, scoreReasons: snapshotDenseStringArray(result.scoreReasons) as string[], doNotContact: true,
    contactReviewStatus: "pending", contactReviewRevision: 0,
    ...(expected.sourceRecordId !== undefined ? { sourceRecordId: expected.sourceRecordId } : {}),
  };
}
export function isPersistedLeadCreationReplayAvailable(
  value: unknown,
  expected: Pick<ExpectedLeadCreationReplay, "actorUid" | "campaignId" | "businessName" | "category" | "location" | "website" | "email" | "phone" | "dedupeEmailKey" | "dedupeWebsiteKey" | "dedupeBusinessLocationKey" | "sourceRecordId">,
  result: Pick<ValidLeadCreationReplayResult, "score" | "scoreReasons">,
): boolean {
  const persisted = snapshotPlainRecord(value);
  const persistedReasons = persisted ? snapshotDenseStringArray(persisted.scoreReasons) : null;
  const expectedReasons = snapshotDenseStringArray(result.scoreReasons);
  if (!persisted || !persistedReasons || !expectedReasons) return false;
  return persisted.createdBy === expected.actorUid && persisted.campaignId === expected.campaignId
    && persisted.businessName === expected.businessName && persisted.category === expected.category
    && persisted.location === expected.location && persisted.website === expected.website
    && persisted.email === expected.email && persisted.phone === expected.phone
    && persisted.dedupeEmailKey === expected.dedupeEmailKey && persisted.dedupeWebsiteKey === expected.dedupeWebsiteKey
    && persisted.dedupeBusinessLocationKey === expected.dedupeBusinessLocationKey
    && (expected.sourceRecordId === undefined ? persisted.sourceRecordId === undefined : persisted.sourceRecordId === expected.sourceRecordId)
    && persisted.status === "new" && persisted.source === "manual" && persisted.score === result.score
    && persistedReasons.length === expectedReasons.length
    && persistedReasons.every((reason, index) => reason === expectedReasons[index])
    && persisted.doNotContact === true && persisted.contactReviewStatus === "pending" && persisted.contactReviewRevision === 0;
}
