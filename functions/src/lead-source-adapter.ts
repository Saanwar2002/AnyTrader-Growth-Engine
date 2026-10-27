/**
 * Provider-neutral contract for future lead-source integrations.
 * No network requests or provider credentials are handled in this module.
 */
export type LeadSourceReviewStatus = "pending" | "approved" | "rejected";
export type LeadSourceField = "businessName" | "category" | "location" | "website" | "email" | "phone";

export interface LeadSourceAdapterManifest {
  sourceId: string;
  displayName: string;
  termsUrl: string;
  reviewStatus: LeadSourceReviewStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  approvalExpiresAt?: string;
  permittedPurpose?: "business_provider_recruitment";
  maxRequestsPerMinute: number;
  maxRecordsPerRun: number;
  allowedFields: LeadSourceField[];
}
export interface LeadSourceCandidate {
  businessName: string;
  category?: string;
  location?: string;
  website?: string;
  email?: string;
  phone?: string;
  sourceRecordId?: string;
}
export interface LeadSourceProvenance {
  sourceId: string;
  sourceName: string;
  termsUrl: string;
  collectedAt: string;
  sourceRecordId?: string;
}
export interface AttributedLeadSourceCandidate {
  candidate: LeadSourceCandidate;
  provenance: LeadSourceProvenance;
}
export interface LeadSourceDiscoveryRequest { category: string; location: string; limit: number; }
export interface LeadSourcePageRequest<TCursor = string> extends LeadSourceDiscoveryRequest {
  cursor?: TCursor;
}
export interface LeadSourcePage<TRecord = unknown, TCursor = string> {
  records: TRecord[];
  nextCursor?: TCursor | null;
}
/** Implementations must only call a provider through an approved, permitted API. */
export interface LeadSourceAdapter<TCursor = string> {
  manifest: LeadSourceAdapterManifest;
  discoverPage(request: LeadSourcePageRequest<TCursor>): Promise<LeadSourcePage<LeadSourceCandidate, TCursor>>;
}
const ALLOWED_FIELDS = new Set<LeadSourceField>(["businessName", "category", "location", "website", "email", "phone"]);
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
function hasSparseEntries(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return true;
  }
  return false;
}
function normalizeBoundedSerializableCursor(value: unknown): { valid: boolean; value?: unknown } {
  const seen = new Set<object>();
  const isJsonSafe = (candidate: unknown): boolean => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return true;
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate !== "object") return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      if (hasSparseEntries(candidate)) return false;
      const ownKeys = Reflect.ownKeys(candidate);
      if (ownKeys.some((key) => key !== "length"
        && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= candidate.length))) return false;
      for (let index = 0; index < candidate.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || !isJsonSafe(descriptor.value)) return false;
      }
      seen.delete(candidate);
      return true;
    }

    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Reflect.ownKeys(candidate)) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || !isJsonSafe(descriptor.value)) return false;
    }
    seen.delete(candidate);
    return true;
  };

  try {
    if (!isJsonSafe(value)) return { valid: false };
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string" || serialized.length > 2048) return { valid: false };
    return { valid: true, value: JSON.parse(serialized) as unknown };
  } catch {
    return { valid: false };
  }
}
/** Return manifest defects; never infer permission or source scope. */
export function validateLeadSourceManifest(manifest: LeadSourceAdapterManifest, now: Date = new Date()): string[] {
  const issues: string[] = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["A source adapter manifest is required."];
  if (typeof manifest.sourceId !== "string" || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(manifest.sourceId)) {
    issues.push("sourceId must be a stable 2–64 character lowercase identifier.");
  }
  if (typeof manifest.displayName !== "string" || manifest.displayName.trim().length < 2 || manifest.displayName.trim().length > 100) {
    issues.push("displayName must contain 2–100 characters.");
  }
  try {
    const terms = new URL(manifest.termsUrl);
    if (terms.protocol !== "https:" || terms.username || terms.password) issues.push("termsUrl must be an HTTPS URL without embedded credentials.");
  } catch {
    issues.push("termsUrl must be a valid HTTPS URL.");
  }
  if (!["pending", "approved", "rejected"].includes(manifest.reviewStatus)) issues.push("reviewStatus must be pending, approved, or rejected.");
  if (!Number.isInteger(manifest.maxRequestsPerMinute) || manifest.maxRequestsPerMinute < 1 || manifest.maxRequestsPerMinute > 600) {
    issues.push("maxRequestsPerMinute must be an integer between 1 and 600.");
  }
  if (!Number.isInteger(manifest.maxRecordsPerRun) || manifest.maxRecordsPerRun < 1 || manifest.maxRecordsPerRun > 500) {
    issues.push("maxRecordsPerRun must be an integer between 1 and 500.");
  }
  if (!Array.isArray(manifest.allowedFields) || manifest.allowedFields.length === 0
    || hasSparseEntries(manifest.allowedFields)
    || manifest.allowedFields.some((field) => !ALLOWED_FIELDS.has(field))
    || new Set(manifest.allowedFields).size !== manifest.allowedFields.length) {
    issues.push("allowedFields must be a non-empty list of unique supported lead fields.");
  } else if (!manifest.allowedFields.includes("businessName")) {
    issues.push("allowedFields must include businessName.");
  }
  if (manifest.reviewStatus === "approved") {
    if (!isIsoDate(manifest.reviewedAt)) issues.push("Approved sources require a valid ISO-8601 reviewedAt timestamp.");
    else if (!(now instanceof Date) || !Number.isFinite(now.getTime())) issues.push("Approval validation clock must be a valid date.");
    else if (Date.parse(manifest.reviewedAt) > now.getTime()) issues.push("reviewedAt must not be in the future.");
    if (typeof manifest.reviewedBy !== "string" || !manifest.reviewedBy.trim()) issues.push("Approved sources require a reviewer reference.");
    if (!isIsoDate(manifest.approvalExpiresAt)) {
      issues.push("Approved sources require a valid ISO-8601 approvalExpiresAt timestamp.");
    } else if (!isIsoDate(manifest.reviewedAt) || Date.parse(manifest.approvalExpiresAt) <= Date.parse(manifest.reviewedAt)) {
      issues.push("approvalExpiresAt must be later than reviewedAt.");
    } else if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || Date.parse(manifest.approvalExpiresAt) <= now.getTime()) {
      issues.push("Approved source permission has expired or the validation clock is invalid.");
    }
    if (manifest.permittedPurpose !== "business_provider_recruitment") {
      issues.push("Approved sources must explicitly permit the business_provider_recruitment purpose.");
    }
  }
  return issues;
}
/** Fail closed until a human has recorded permission review for this exact purpose. */
export function assertLeadSourceAdapterRunnable(manifest: LeadSourceAdapterManifest, now: Date = new Date()): void {
  const issues = validateLeadSourceManifest(manifest, now);
  if (issues.length) throw new Error(`Lead source adapter manifest is invalid: ${issues.join(" ")}`);
  if (manifest.reviewStatus !== "approved") throw new Error("Lead source adapter is blocked until its terms and permitted use are approved.");
}

const FIELD_MAX_LENGTHS: Record<LeadSourceField, number> = {
  businessName: 200,
  category: 120,
  location: 200,
  website: 320,
  email: 320,
  phone: 80,
};

/**
 * Validate provider output and attach provenance before it can enter a future
 * import workflow. This is pure and does not persist records or contact anyone.
 */
export function attributeLeadSourceCandidates(
  manifest: LeadSourceAdapterManifest,
  candidates: unknown,
  collectedAt: string,
  now: Date = new Date(),
): AttributedLeadSourceCandidate[] {
  assertLeadSourceAdapterRunnable(manifest, now);
  if (!isIsoDate(collectedAt)) throw new Error("collectedAt must be a valid ISO-8601 timestamp.");
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Collection validation clock must be a valid date.");
  }
  if (Date.parse(collectedAt) > now.getTime()) {
    throw new Error("collectedAt must not be in the future.");
  }
  if (!Array.isArray(candidates)) throw new Error("Lead source output must be an array.");
  if (hasSparseEntries(candidates)) {
    throw new Error("Lead source output must not contain sparse entries.");
  }
  if (candidates.length > manifest.maxRecordsPerRun) {
    throw new Error("Lead source output exceeded its configured per-run record limit.");
  }

  const seenSourceRecordIds = new Set<string>();
  return candidates.map((candidate: unknown) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Lead source output contains a malformed candidate.");
    }
    const record = candidate as Record<string, unknown>;
    const allowedKeys = new Set<string>([...manifest.allowedFields, "sourceRecordId"]);
    if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
      throw new Error("Lead source output contains a field outside its manifest allowlist.");
    }
    for (const field of manifest.allowedFields) {
      if (field === "businessName") continue;
      const value = record[field];
      if (value !== undefined && (typeof value !== "string" || value.length > FIELD_MAX_LENGTHS[field])) {
        throw new Error(`Lead source output contains an invalid ${field} value.`);
      }
    }
    if (typeof record.businessName !== "string" || !record.businessName.trim()
      || record.businessName.length > FIELD_MAX_LENGTHS.businessName) {
      throw new Error("Lead source output requires a valid businessName.");
    }
    if (record.sourceRecordId !== undefined
      && (typeof record.sourceRecordId !== "string" || !record.sourceRecordId.trim() || record.sourceRecordId.length > 200)) {
      throw new Error("Lead source output contains an invalid sourceRecordId.");
    }
    if (typeof record.sourceRecordId === "string") {
      const sourceRecordId = record.sourceRecordId.trim();
      if (seenSourceRecordIds.has(sourceRecordId)) {
        throw new Error("Lead source output contains duplicate sourceRecordId values.");
      }
      seenSourceRecordIds.add(sourceRecordId);
    }

    const normalized: LeadSourceCandidate = { businessName: record.businessName.trim() };
    for (const field of manifest.allowedFields) {
      if (field === "businessName") continue;
      const value = record[field];
      if (typeof value === "string" && value.trim()) normalized[field] = value.trim();
    }
    if (typeof record.sourceRecordId === "string") normalized.sourceRecordId = record.sourceRecordId.trim();

    return {
      candidate: normalized,
      provenance: {
        sourceId: manifest.sourceId,
        sourceName: manifest.displayName,
        termsUrl: manifest.termsUrl,
        collectedAt,
        ...(normalized.sourceRecordId ? { sourceRecordId: normalized.sourceRecordId } : {}),
      },
    };
  });
}


/** Validate a bounded request before passing it to a provider adapter. */
export function validateLeadSourcePageRequest<TCursor = string>(
  value: unknown,
  manifest: LeadSourceAdapterManifest,
  now: Date = new Date(),
): LeadSourcePageRequest<TCursor> {
  assertLeadSourceAdapterRunnable(manifest, now);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Lead source page request must be an object.");
  }
  const request = value as Record<string, unknown>;
  if (typeof request.category !== "string" || !request.category.trim() || request.category.length > 120) {
    throw new Error("Lead source category must contain 1 to 120 characters.");
  }
  if (typeof request.location !== "string" || !request.location.trim() || request.location.length > 200) {
    throw new Error("Lead source location must contain 1 to 200 characters.");
  }
  if (!Number.isSafeInteger(request.limit) || (request.limit as number) < 1
    || (request.limit as number) > manifest.maxRecordsPerRun) {
    throw new Error("Lead source page limit exceeds the configured bound.");
  }
  const hasCursor = Object.prototype.hasOwnProperty.call(request, "cursor") && request.cursor !== undefined;
  const normalizedCursor: { valid: boolean; value?: unknown } = hasCursor ? normalizeBoundedSerializableCursor(request.cursor) : { valid: true };
  if (!normalizedCursor.valid) {
    throw new Error("Lead source cursor must be JSON-serializable and at most 2048 characters.");
  }
  return {
    category: request.category.trim(),
    location: request.location.trim(),
    limit: request.limit as number,
    ...(hasCursor ? { cursor: normalizedCursor.value as TCursor } : {}),
  };
}

/** Validate a bounded adapter result envelope before mapping or persistence. */
export function validateLeadSourcePageResult<TRecord = unknown, TCursor = string>(
  value: unknown,
  manifest: LeadSourceAdapterManifest,
  now: Date = new Date(),
): LeadSourcePage<TRecord, TCursor> {
  assertLeadSourceAdapterRunnable(manifest, now);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Lead source page result must be an object.");
  }
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.records)) {
    throw new Error("Lead source page records must be an array.");
  }
  if (hasSparseEntries(result.records)) {
    throw new Error("Lead source page records must not contain sparse entries.");
  }
  if (result.records.length > manifest.maxRecordsPerRun) {
    throw new Error("Lead source page result exceeds the configured record limit.");
  }
  const hasNextCursor = Object.prototype.hasOwnProperty.call(result, "nextCursor") && result.nextCursor !== undefined;
  const normalizedNextCursor: { valid: boolean; value?: unknown } = hasNextCursor
    ? normalizeBoundedSerializableCursor(result.nextCursor)
    : { valid: true };
  if (!normalizedNextCursor.valid) {
    throw new Error("Lead source next cursor must be JSON-serializable and at most 2048 characters.");
  }
  return {
    records: [...result.records] as TRecord[],
    ...(hasNextCursor ? { nextCursor: normalizedNextCursor.value as TCursor | null } : {}),
  };
}


/**
 * Validate a provider page envelope and every candidate before exposing the page
 * to an import workflow. This is pure validation/mapping; it performs no I/O.
 */
export function validateAndAttributeLeadSourcePage<TCursor = string>(
  value: unknown,
  manifest: LeadSourceAdapterManifest,
  collectedAt: string,
  now: Date = new Date(),
): LeadSourcePage<AttributedLeadSourceCandidate, TCursor> {
  const page = validateLeadSourcePageResult<unknown, TCursor>(value, manifest, now);
  const records = attributeLeadSourceCandidates(manifest, page.records, collectedAt, now);
  return {
    records,
    ...(Object.prototype.hasOwnProperty.call(page, "nextCursor") ? { nextCursor: page.nextCursor } : {}),
  };
}


/**
 * Stateful guard to reuse for every page in one discovery run. Enforces the
 * manifest's total run budget and prevents duplicate provider IDs or cursor
 * cycles from being accepted across pages. Instantiate one guard per run.
 */
export class LeadSourceAdapterRunGuard<TCursor = string> {
  private acceptedRecordCount = 0;
  private readonly seenSourceRecordIds = new Set<string>();
  private readonly seenNextCursors = new Set<string>();

  constructor(private readonly manifest: LeadSourceAdapterManifest) {}

  get recordsAccepted(): number {
    return this.acceptedRecordCount;
  }

  acceptPage(
    value: unknown,
    collectedAt: string,
    now: Date = new Date(),
  ): LeadSourcePage<AttributedLeadSourceCandidate, TCursor> {
    const page = validateAndAttributeLeadSourcePage<TCursor>(value, this.manifest, collectedAt, now);
    if (this.acceptedRecordCount + page.records.length > this.manifest.maxRecordsPerRun) {
      throw new Error("Lead source run exceeded its configured total record limit.");
    }

    const pageSourceRecordIds = new Set<string>();
    for (const record of page.records) {
      const sourceRecordId = record.candidate.sourceRecordId;
      if (!sourceRecordId) continue;
      if (this.seenSourceRecordIds.has(sourceRecordId) || pageSourceRecordIds.has(sourceRecordId)) {
        throw new Error("Lead source run contains duplicate sourceRecordId values across pages.");
      }
      pageSourceRecordIds.add(sourceRecordId);
    }

    let nextCursorKey: string | undefined;
    if (page.nextCursor !== undefined && page.nextCursor !== null) {
      const serializedCursor = JSON.stringify(page.nextCursor);
      if (typeof serializedCursor !== "string") throw new Error("Lead source next cursor is not serializable.");
      nextCursorKey = serializedCursor;
      if (this.seenNextCursors.has(nextCursorKey)) {
        throw new Error("Lead source pagination repeated a next cursor.");
      }
    }

    this.acceptedRecordCount += page.records.length;
    for (const sourceRecordId of pageSourceRecordIds) this.seenSourceRecordIds.add(sourceRecordId);
    if (nextCursorKey !== undefined) this.seenNextCursors.add(nextCursorKey);
    return page;
  }
}
