export type LeadSourceAdapterKind = "approved_api" | "manual_import" | "synthetic_demo";

export interface LeadSourceApproval {
  providerId: string;
  status: "approved";
  termsUrl: string;
  reviewedAt: string;
  reviewedBy: string;
  permittedUse: "lead_discovery";
  expiresAt: string;
}

export interface LeadSourceAdapterDefinition {
  id: string;
  kind: LeadSourceAdapterKind;
  maxPageSize: number;
  approval?: LeadSourceApproval;
}

export interface LeadSourcePageRequest<TCursor = string> {
  query: string;
  pageSize: number;
  cursor?: TCursor;
}

export interface LeadSourcePage<TRecord, TCursor = string> {
  records: TRecord[];
  nextCursor?: TCursor | null;
}

export interface LeadSourceAdapter<TRecord = unknown, TCursor = string> {
  readonly definition: LeadSourceAdapterDefinition;
  fetchPage(request: LeadSourcePageRequest<TCursor>): Promise<LeadSourcePage<TRecord, TCursor>>;
}

export interface LeadSourceProvenance {
  providerId: string;
  sourceRecordId: string;
  retrievedAt: string;
  sourceUrl?: string;
}

export type LeadSourceAdapterReadiness =
  | { ready: true; definition: LeadSourceAdapterDefinition }
  | {
      ready: false;
      reason:
        | "invalid-definition"
        | "invalid-adapter-id"
        | "unsupported-kind"
        | "invalid-page-size"
        | "approval-required"
        | "approval-provider-mismatch"
        | "invalid-approval"
        | "invalid-terms-url"
        | "invalid-review-time"
        | "review-time-in-future"
        | "approval-expired";
    };

const ADAPTER_ID = /^[a-z][a-z0-9_-]{1,63}$/;
const ISO_UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function parseCanonicalUtcTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_UTC_MILLISECONDS.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return null;
  return parsed;
}

function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname)
      && !url.username && !url.password;
  } catch {
    return false;
  }
}

/**
 * Fail-closed registration gate for future source integrations.
 * This validates policy metadata only; it does not fetch data or prove legal compliance.
 */
export function assessLeadSourceAdapterReadiness(
  value: unknown,
  now: Date = new Date(),
): LeadSourceAdapterReadiness {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    return { ready: false, reason: "invalid-review-time" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ready: false, reason: "invalid-definition" };
  }

  const definition = value as Partial<LeadSourceAdapterDefinition>;
  if (typeof definition.id !== "string" || !ADAPTER_ID.test(definition.id)) {
    return { ready: false, reason: "invalid-adapter-id" };
  }
  if (!["approved_api", "manual_import", "synthetic_demo"].includes(definition.kind ?? "")) {
    return { ready: false, reason: "unsupported-kind" };
  }
  if (!Number.isSafeInteger(definition.maxPageSize)
    || (definition.maxPageSize ?? 0) < 1
    || (definition.maxPageSize ?? 501) > 500) {
    return { ready: false, reason: "invalid-page-size" };
  }

  if (definition.kind !== "approved_api") {
    return { ready: true, definition: definition as LeadSourceAdapterDefinition };
  }

  const approval = definition.approval;
  if (!approval || typeof approval !== "object") {
    return { ready: false, reason: "approval-required" };
  }
  if (approval.providerId !== definition.id) {
    return { ready: false, reason: "approval-provider-mismatch" };
  }
  if (approval.status !== "approved" || approval.permittedUse !== "lead_discovery"
    || typeof approval.reviewedBy !== "string" || !approval.reviewedBy.trim()
    || approval.reviewedBy.length > 120) {
    return { ready: false, reason: "invalid-approval" };
  }
  if (!isSafeHttpsUrl(approval.termsUrl)) {
    return { ready: false, reason: "invalid-terms-url" };
  }

  const reviewedAt = parseCanonicalUtcTimestamp(approval.reviewedAt);
  const expiresAt = parseCanonicalUtcTimestamp(approval.expiresAt);
  if (reviewedAt === null || expiresAt === null || expiresAt <= reviewedAt) {
    return { ready: false, reason: "invalid-review-time" };
  }
  if (reviewedAt > now.getTime()) {
    return { ready: false, reason: "review-time-in-future" };
  }
  if (expiresAt <= now.getTime()) {
    return { ready: false, reason: "approval-expired" };
  }

  return { ready: true, definition: definition as LeadSourceAdapterDefinition };
}

/** Validate provenance and copy only its allowlisted fields. */
export function validateLeadSourceProvenance(
  value: unknown,
  expectedProviderId: string,
  now: Date = new Date(),
): LeadSourceProvenance {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Lead source provenance validation time is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Lead source provenance must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (typeof expectedProviderId !== "string" || !ADAPTER_ID.test(expectedProviderId)
    || record.providerId !== expectedProviderId) {
    throw new Error("Lead source provenance provider does not match the active adapter.");
  }
  if (typeof record.sourceRecordId !== "string" || !record.sourceRecordId.trim()
    || record.sourceRecordId.length > 256) {
    throw new Error("Lead source provenance requires a bounded source record ID.");
  }
  const retrievedAt = parseCanonicalUtcTimestamp(record.retrievedAt);
  if (retrievedAt === null || retrievedAt > now.getTime()) {
    throw new Error("Lead source provenance retrieval time must be a valid past UTC timestamp.");
  }
  if (record.sourceUrl !== undefined && !isSafeHttpsUrl(record.sourceUrl)) {
    throw new Error("Lead source provenance URL must be a safe HTTPS URL.");
  }

  return {
    providerId: expectedProviderId,
    sourceRecordId: record.sourceRecordId,
    retrievedAt: record.retrievedAt as string,
    ...(record.sourceUrl !== undefined ? { sourceUrl: record.sourceUrl as string } : {}),
  };
}


/**
 * Validate one bounded page request before handing it to an adapter.
 * The request is copied so unknown caller-supplied properties do not cross the boundary.
 */
export function validateLeadSourcePageRequest<TCursor = string>(
  value: unknown,
  definition: LeadSourceAdapterDefinition,
): LeadSourcePageRequest<TCursor> {
  const readiness = assessLeadSourceAdapterReadiness(definition);
  if (!readiness.ready) {
    throw new Error("Lead source adapter is not ready for requests.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Lead source page request must be an object.");
  }

  const request = value as Record<string, unknown>;
  if (typeof request.query !== "string" || !request.query.trim()
    || request.query.length > 500) {
    throw new Error("Lead source query must contain 1 to 500 characters.");
  }
  if (!Number.isSafeInteger(request.pageSize)
    || (request.pageSize as number) < 1
    || (request.pageSize as number) > readiness.definition.maxPageSize) {
    throw new Error("Lead source page size exceeds the configured bound.");
  }

  return {
    query: request.query.trim(),
    pageSize: request.pageSize as number,
    ...(Object.prototype.hasOwnProperty.call(request, "cursor")
      ? { cursor: request.cursor as TCursor }
      : {}),
  };
}
