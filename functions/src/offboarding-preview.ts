/**
 * Non-destructive tenant offboarding preview.
 *
 * Only explicitly allow-listed organisation subcollections are counted. The
 * reader is injected so the algorithm can be tested without a live database.
 * Document IDs are cursors only and are never included in the returned result.
 */
export const OFFBOARDING_PREVIEW_CATEGORIES = [
  "members",
  "campaigns",
  "leads",
  "leadIdentifierReservations",
  "leadActivities",
  "outreachDrafts",
  "securityAuditEvents",
  "campaignCreationIdempotency",
  "memberAdditionIdempotency",
  "importIdempotency",
  "leadCreationIdempotency",
  "leadBulkStatusIdempotency",
  "outreachDraftCreationIdempotency",
] as const;

export type OffboardingPreviewCategory = typeof OFFBOARDING_PREVIEW_CATEGORIES[number];

export interface OffboardingPreviewPage {
  ids: string[];
}

export interface OffboardingPreviewCategoryResult {
  category: OffboardingPreviewCategory;
  status: "complete" | "limit_reached" | "unavailable";
  exactCount: number | null;
  observedCount: number;
}

export interface OffboardingPreviewResult {
  complete: boolean;
  destructiveActionPerformed: false;
  maxRecordsPerCategory: number;
  categories: OffboardingPreviewCategoryResult[];
}

export type OffboardingPreviewPageReader = (
  category: OffboardingPreviewCategory,
  afterId: string | null,
  limit: number,
) => Promise<OffboardingPreviewPage>;

const DEFAULT_MAX_RECORDS_PER_CATEGORY = 1000;
const DEFAULT_PAGE_SIZE = 100;

/**
 * Snapshot the injected page-reader result using own data descriptors only.
 * The preview must never execute getters or trust a malformed adapter envelope.
 */
function snapshotOffboardingPageIds(value: unknown, requested: number): string[] {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 1 || keys[0] !== "ids") throw new Error();
    const idsDescriptor = Object.getOwnPropertyDescriptor(value, "ids");
    if (!idsDescriptor || !idsDescriptor.enumerable || !("value" in idsDescriptor)) throw new Error();

    const ids = idsDescriptor.value;
    if (!Array.isArray(ids) || Object.getPrototypeOf(ids) !== Array.prototype) throw new Error();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(ids, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
      || lengthDescriptor.value > requested) throw new Error();
    const idsLength = lengthDescriptor.value as number;
    const arrayKeys = Reflect.ownKeys(ids);
    if (arrayKeys.length !== idsLength + 1
      || arrayKeys.some((key) => key !== "length"
        && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= idsLength))) throw new Error();

    const copied: string[] = [];
    for (let index = 0; index < idsLength; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(ids, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)
        || typeof descriptor.value !== "string" || descriptor.value.length === 0 || descriptor.value.length > 1500) {
        throw new Error();
      }
      copied.push(descriptor.value);
    }
    return copied;
  } catch {
    throw new Error("Malformed page result.");
  }
}

export async function createOffboardingPreview(
  readPage: OffboardingPreviewPageReader,
  options: { maxRecordsPerCategory?: number; pageSize?: number } = {},
): Promise<OffboardingPreviewResult> {
  const maxRecords = options.maxRecordsPerCategory ?? DEFAULT_MAX_RECORDS_PER_CATEGORY;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 10000
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("Invalid offboarding preview bounds.");
  }

  const categories: OffboardingPreviewCategoryResult[] = [];
  for (const category of OFFBOARDING_PREVIEW_CATEGORIES) {
    let observedCount = 0;
    let afterId: string | null = null;
    try {
      while (true) {
        // Read at most one item beyond the remaining allowance so truncation is
        // detected rather than falsely reported as an exact count.
        const remaining = maxRecords - observedCount;
        const requested = Math.min(pageSize, remaining + 1);
        const rawPage: unknown = await readPage(category, afterId, requested);
        const pageIds = snapshotOffboardingPageIds(rawPage, requested);
        // The Firestore adapter orders by document ID. Require strictly
        // increasing cursors and no duplicates so a faulty reader cannot loop
        // forever or inflate a count with repeated records.
        for (let index = 1; index < pageIds.length; index += 1) {
          if (pageIds[index] <= pageIds[index - 1]) {
            throw new Error("Page document IDs are not strictly ordered.");
          }
        }
        if (afterId !== null && pageIds.length > 0 && pageIds[0] <= afterId) {
          throw new Error("Pagination cursor did not advance.");
        }
        if (pageIds.length > remaining) {
          categories.push({ category, status: "limit_reached", exactCount: null, observedCount: maxRecords });
          break;
        }
        observedCount += pageIds.length;
        if (pageIds.length < requested) {
          categories.push({ category, status: "complete", exactCount: observedCount, observedCount });
          break;
        }
        if (pageIds.length === 0) {
          categories.push({ category, status: "complete", exactCount: observedCount, observedCount });
          break;
        }
        const lastId = pageIds[pageIds.length - 1];
        if (afterId !== null && lastId === afterId) {
          throw new Error("Pagination cursor did not advance.");
        }
        afterId = lastId;
      }
    } catch {
      categories.push({ category, status: "unavailable", exactCount: null, observedCount });
    }
  }

  return {
    complete: categories.length === OFFBOARDING_PREVIEW_CATEGORIES.length
      && categories.every((item) => item.status === "complete"),
    destructiveActionPerformed: false,
    maxRecordsPerCategory: maxRecords,
    categories,
  };
}
