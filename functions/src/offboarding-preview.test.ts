import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createOffboardingPreview,
  OFFBOARDING_PREVIEW_CATEGORIES,
  type OffboardingPreviewCategory,
} from "./offboarding-preview";

function readerWithCounts(counts: Partial<Record<OffboardingPreviewCategory, number>>) {
  return async (category: OffboardingPreviewCategory, afterId: string | null, limit: number) => {
    const total = counts[category] ?? 0;
    const start = afterId === null ? 0 : Number(afterId.slice(1)) + 1;
    const ids = Array.from({ length: Math.max(0, Math.min(limit, total - start)) }, (_, i) => `d${String(start + i).padStart(4, "0")}`);
    return { ids };
  };
}

describe("non-destructive tenant offboarding preview", () => {
  it("counts only the explicit allow-list and returns no document identifiers", async () => {
    const result = await createOffboardingPreview(readerWithCounts({ leads: 3, members: 2 }));
    expect(result.complete).toBe(true);
    expect(result.destructiveActionPerformed).toBe(false);
    expect(result.categories.map((item) => item.category)).toEqual([...OFFBOARDING_PREVIEW_CATEGORIES]);
    expect(result.categories.find((item) => item.category === "leads")).toMatchObject({
      status: "complete", exactCount: 3, observedCount: 3,
    });
    expect(JSON.stringify(result)).not.toContain('"d0"');
    expect(JSON.stringify(result)).not.toContain("email");
    expect(JSON.stringify(result)).not.toContain("phone");
  });

  it("includes all organisation-scoped idempotency collections in the inventory", () => {
    expect(OFFBOARDING_PREVIEW_CATEGORIES).toEqual(expect.arrayContaining([
      "campaignCreationIdempotency",
      "memberAdditionIdempotency",
      "importIdempotency",
      "leadCreationIdempotency",
      "leadBulkStatusIdempotency",
      "outreachDraftCreationIdempotency",
    ]));
  });

  it("keeps every offboarding category in the schema-backed privacy inventory", () => {
    const privacyInventory = readFileSync(
      fileURLToPath(new URL("../../docs/PRIVACY_DATA_RETENTION_AND_OFFBOARDING.md", import.meta.url)),
      "utf8",
    );
    for (const category of OFFBOARDING_PREVIEW_CATEGORIES) {
      expect(privacyInventory, `privacy inventory includes ${category}`)
        .toContain(`organisations/{organisationId}/${category}/`);
    }
  });

  it("includes canonical lead identifier reservations in the explicit tenant inventory", () => {
    expect(OFFBOARDING_PREVIEW_CATEGORIES).toContain("leadIdentifierReservations");
  });

  it("fails closed with an inexact count when a category exceeds the cap", async () => {
    const result = await createOffboardingPreview(readerWithCounts({ leads: 1001 }));
    expect(result.complete).toBe(false);
    expect(result.categories.find((item) => item.category === "leads")).toMatchObject({
      status: "limit_reached", exactCount: null, observedCount: 1000,
    });
  });

  it("marks a failed category unavailable and never claims the preview is complete", async () => {
    const result = await createOffboardingPreview(async (category, afterId, limit) => {
      if (category === "securityAuditEvents") throw new Error("synthetic read failure");
      return readerWithCounts({}) (category, afterId, limit);
    });
    expect(result.complete).toBe(false);
    expect(result.categories.find((item) => item.category === "securityAuditEvents")).toMatchObject({
      status: "unavailable", exactCount: null,
    });
  });

  it("preserves the observed count when a later page read fails", async () => {
    const result = await createOffboardingPreview(async (category, afterId) => {
      if (category !== "members") return { ids: [] };
      if (afterId === null) return { ids: ["d0000"] };
      throw new Error("synthetic second-page read failure");
    }, { maxRecordsPerCategory: 3, pageSize: 1 });

    expect(result.complete).toBe(false);
    expect(result.categories.find((item) => item.category === "members")).toMatchObject({
      status: "unavailable",
      exactCount: null,
      observedCount: 1,
    });
  });

  it("fails closed when a reader repeats a pagination cursor", async () => {
    const result = await createOffboardingPreview(async (category) => ({
      ids: category === "members" ? ["same-id"] : [],
    }), { maxRecordsPerCategory: 2, pageSize: 1 });
    expect(result.complete).toBe(false);
    expect(result.categories.find((item) => item.category === "members")).toMatchObject({
      status: "unavailable", exactCount: null,
    });
  });

  it("fails closed when a page repeats or misorders document IDs", async () => {
    const result = await createOffboardingPreview(async (category) => ({
      ids: category === "members" ? ["z-id", "a-id"] : [],
    }), { maxRecordsPerCategory: 3, pageSize: 2 });
    expect(result.complete).toBe(false);
    expect(result.categories.find((item) => item.category === "members")).toMatchObject({
      status: "unavailable", exactCount: null,
    });
  });

  it("rejects unsafe caller-supplied bounds", async () => {
    await expect(createOffboardingPreview(readerWithCounts({}), { maxRecordsPerCategory: 0 })).rejects.toThrow();
    await expect(createOffboardingPreview(readerWithCounts({}), { pageSize: 101 })).rejects.toThrow();
  });
});
