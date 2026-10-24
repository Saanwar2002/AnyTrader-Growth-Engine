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
 * Reads a tenant-scoped, explicitly bounded set of pages and audits it in
 * memory. This coordinator has no write callback and cannot backfill records.
 */
export async function runBoundedLeadIdentifierAudit(
  options: BoundedLeadAuditOptions,
): Promise<BoundedLeadAuditResult> {
  if (options.dryRun !== true) throw new Error("Lead identifier audit must run in dry-run mode.");
  if (!options.tenantId.trim()) throw new Error("A tenant scope is required for lead identifier audit.");
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 500) {
    throw new Error("pageSize must be an integer between 1 and 500.");
  }
  if (!Number.isInteger(options.maxRecords) || options.maxRecords < 1) {
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

    if (!Array.isArray(page.records)) {
      throw new Error("Lead audit page adapter returned an invalid records collection.");
    }
    if (page.records.length > Math.min(options.pageSize, remaining)) {
      throw new Error("Lead audit page exceeded the requested page limit.");
    }
    records.push(...page.records);

    const nextCursor = page.nextCursor || undefined;
    if (page.records.length === 0 && nextCursor) {
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
