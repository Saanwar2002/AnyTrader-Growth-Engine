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
  /** A truncated scan must never be treated as a complete inventory. */
  scanCompleteness: "complete" | "truncated";
  /** This helper never authorizes a backfill; complete scans still require human review. */
  backfillDecision: "blocked-incomplete-scan" | "blocked-pending-operator-review";
}

const PAGE_KEYS = new Set(["records", "nextCursor"]);
const RECORD_KEYS = new Set([
  "id", "email", "website", "businessName", "location",
  "dedupeEmailKey", "dedupeWebsiteKey", "dedupeBusinessLocationKey",
]);

/** Snapshot a plain data record without executing getters or trusting proxy traps. */
function snapshotPlainRecord(value: unknown, allowedKeys: Set<string>): Record<string, unknown> | null {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    const snapshot: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string" || !allowedKeys.has(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return null;
  }
}

/** Snapshot a dense, ordinary array using descriptors rather than iterators/index getters. */
function snapshotRecordArray(value: unknown, maxLength: number): LegacyLeadRecord[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const keys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0 || lengthDescriptor.value > maxLength) return null;
    const length = lengthDescriptor.value as number;
    if (keys.length !== length + 1 || !keys.includes("length")) return null;

    const records: LegacyLeadRecord[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!keys.includes(String(index))) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      const record = snapshotPlainRecord(descriptor.value, RECORD_KEYS);
      if (!record || typeof record.id !== "string" || !record.id.trim()) return null;
      records.push(record as unknown as LegacyLeadRecord);
    }
    return records;
  } catch {
    return null;
  }
}

/**
 * Reads a tenant-scoped, explicitly bounded set of pages and audits it in
 * memory. Adapter data is snapshotted as plain own data properties so getters
 * and hostile proxy inspection traps cannot execute during validation.
 * This coordinator has no write callback and cannot backfill records.
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
  const seenRecordIds = new Set<string>();
  let cursor: string | undefined;
  let pagesRead = 0;
  let hasMore = false;

  while (records.length < options.maxRecords) {
    const remaining = options.maxRecords - records.length;
    const rawPage: unknown = await options.fetchPage({
      tenantId: options.tenantId,
      pageSize: Math.min(options.pageSize, remaining),
      ...(cursor ? { cursor } : {}),
    });
    pagesRead += 1;

    const page = snapshotPlainRecord(rawPage, PAGE_KEYS);
    if (!page) throw new Error("Lead audit page adapter returned an invalid page or records collection.");
    const pageRecords = snapshotRecordArray(page.records, Math.min(options.pageSize, remaining));
    if (!pageRecords) throw new Error("Lead audit page adapter returned an invalid page or records collection.");
    if (page.nextCursor !== undefined && page.nextCursor !== null && typeof page.nextCursor !== "string") {
      throw new Error("Lead audit page adapter returned an invalid continuation cursor.");
    }

    for (const record of pageRecords) {
      if (seenRecordIds.has(record.id)) {
        throw new Error("Lead audit pagination returned a duplicate record ID.");
      }
      seenRecordIds.add(record.id);
    }
    records.push(...pageRecords);

    const nextCursor = page.nextCursor || undefined;
    if (pageRecords.length === 0 && nextCursor) {
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

  const truncated = records.length >= options.maxRecords && hasMore;

  return {
    report: auditLeadIdentifierRecords(records),
    pagesRead,
    truncated,
    scanCompleteness: truncated ? "truncated" : "complete",
    // Deliberately fail closed: this read-only coordinator has no migration
    // approval, collision resolution, or write capability.
    backfillDecision: truncated ? "blocked-incomplete-scan" : "blocked-pending-operator-review",
  };
}
