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
        const page = await readPage(category, afterId, requested);
        if (!Array.isArray(page.ids) || page.ids.some((id) => typeof id !== "string" || id.length === 0)) {
          throw new Error("Malformed page result.");
        }
        if (page.ids.length > requested) throw new Error("Reader exceeded requested page bound.");
        // The Firestore adapter orders by document ID. Require strictly
        // increasing cursors and no duplicates so a faulty reader cannot loop
        // forever or inflate a count with repeated records.
        for (let index = 1; index < page.ids.length; index += 1) {
          if (page.ids[index] <= page.ids[index - 1]) {
            throw new Error("Page document IDs are not strictly ordered.");
          }
        }
        if (afterId !== null && page.ids.length > 0 && page.ids[0] <= afterId) {
          throw new Error("Pagination cursor did not advance.");
        }
        if (page.ids.length > remaining) {
          categories.push({ category, status: "limit_reached", exactCount: null, observedCount: maxRecords });
          break;
        }
        observedCount += page.ids.length;
        if (page.ids.length < requested) {
          categories.push({ category, status: "complete", exactCount: observedCount, observedCount });
          break;
        }
        if (page.ids.length === 0) {
          categories.push({ category, status: "complete", exactCount: observedCount, observedCount });
          break;
        }
        const lastId = page.ids[page.ids.length - 1];
        if (afterId !== null && lastId === afterId) {
          throw new Error("Pagination cursor did not advance.");
        }
        afterId = lastId;
      }
    } catch {
      categories.push({ category, status: "unavailable", exactCount: null, observedCount: 0 });
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
