import { auditLeadIdentifierRecords, type LeadIdentifierAuditReport, type LegacyLeadRecord } from "./lead-identifier-migration-audit";

export interface LeadAuditPage {
  records: LegacyLeadRecord[];
  /** Opaque cursor returned by the data adapter; null/undefined means end. */
  nextCursor?: string | null;
}

export interface LeadAuditPageRequest {
  /** Must be one organisation/tenant identifier, never a cross-tenant query. */
  tenantId: string;
  /** Requested page size, capped by the remaining global record budget. */
  pageSize: number;
  cursor?: string;
}

export interface BoundedLeadAuditOptions {
  tenantId: string;
  pageSize: number;
  maxRecords: number;
  /** Literal true is required to make the read-only intent explicit. */
  dryRun: true;
  fetchPage: (request: LeadAuditPageRequest) => Promise<LeadAuditPage>;
}

export interface BoundedLeadAuditResult {
  report: LeadIdentifierAuditReport;
  pagesRead: number;
  truncated: boolean;
}

/**
 * Copy a record's audit-relevant fields into a plain snapshot before analysis.
 * Adapter objects may contain getters or proxies; reading a field must not be
 * allowed to escape the coordinator's fail-closed validation boundary.
 */
function snapshotAuditRecord(value: unknown): LegacyLeadRecord {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid record shape");
    }
    const record = value as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("invalid record id");
    }
    return {
      id,
      email: record.email,
      website: record.website,
      dedupeEmailKey: record.dedupeEmailKey,
      dedupeWebsiteKey: record.dedupeWebsiteKey,
    };
  } catch {
    throw new Error("Lead audit page adapter returned a malformed record.");
  }
}

/**
 * Reads a tenant-scoped, explicitly bounded set of pages and audits it in
 * memory. This coordinator has no write callback and cannot backfill records.
 */
export async function runBoundedLeadIdentifierAudit(
  options: BoundedLeadAuditOptions,
): Promise<BoundedLeadAuditResult> {
  if (options.dryRun !== true) throw new Error("Lead identifier audit must run in dry-run mode.");
  if (typeof options.tenantId !== "string" || !options.tenantId.trim()) {
    throw new Error("A tenant scope is required for lead identifier audit.");
  }
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 500) {
    throw new Error("pageSize must be an integer between 1 and 500.");
  }
  if (!Number.isSafeInteger(options.maxRecords) || options.maxRecords < 1) {
    throw new Error("maxRecords must be a positive integer.");
  }

  const records: LegacyLeadRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pagesRead = 0;
  let hasMore = false;

  while (records.length < options.maxRecords) {
    const remaining = options.maxRecords - records.length;
    const page = await options.fetchPage({
      tenantId: options.tenantId,
      pageSize: Math.min(options.pageSize, remaining),
      ...(cursor ? { cursor } : {}),
    });
    pagesRead += 1;

    let rawRecords: unknown[];
    let rawNextCursor: unknown;
    let recordCount: number;
    try {
      if (!page || typeof page !== "object" || Array.isArray(page)) {
        throw new Error("invalid page shape");
      }
      const envelope = page as Record<string, unknown>;
      const candidateRecords = envelope.records;
      if (!Array.isArray(candidateRecords)) throw new Error("invalid records collection");
      rawRecords = candidateRecords;
      recordCount = candidateRecords.length;
      rawNextCursor = envelope.nextCursor;
    } catch {
      throw new Error("Lead audit page adapter returned an invalid page or records collection.");
    }
    if (rawNextCursor !== undefined && rawNextCursor !== null && typeof rawNextCursor !== "string") {
      throw new Error("Lead audit page adapter returned an invalid continuation cursor.");
    }
    if (recordCount > Math.min(options.pageSize, remaining)) {
      throw new Error("Lead audit page exceeded the requested page limit.");
    }

    let pageRecords: LegacyLeadRecord[];
    try {
      // Snapshot envelope fields once and copy records by index. This rejects
      // sparse arrays and prevents hostile getters from changing values between
      // validation and analysis.
      pageRecords = [];
      for (let index = 0; index < recordCount; index += 1) {
        pageRecords.push(snapshotAuditRecord(rawRecords[index]));
      }
    } catch {
      throw new Error("Lead audit page adapter returned a malformed record.");
    }
    records.push(...pageRecords);

    const nextCursor = typeof rawNextCursor === "string" && rawNextCursor ? rawNextCursor : undefined;
    if (recordCount === 0 && nextCursor) {
      throw new Error("Lead audit pagination returned an empty page with a continuation cursor.");
    }
    hasMore = Boolean(nextCursor);
    if (!hasMore || records.length >= options.maxRecords) break;
    if (seenCursors.has(nextCursor!)) {
      throw new Error("Lead audit pagination returned a repeated cursor.");
    }
    seenCursors.add(nextCursor!);
    cursor = nextCursor;
  }

  return {
    report: auditLeadIdentifierRecords(records),
    pagesRead,
    truncated: records.length >= options.maxRecords && hasMore,
  };
}
