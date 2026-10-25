import { describe, expect, it, vi } from "vitest";
import { runBoundedLeadIdentifierAudit } from "./bounded-lead-identifier-audit";

describe("bounded read-only lead identifier audit coordinator", () => {
  it("passes tenant scope and page limits and reports a complete scan", async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ records: [{ id: "a", email: "a@example.com" }], nextCursor: "next" })
      .mockResolvedValueOnce({ records: [{ id: "b", email: "b@example.com" }] });

    const result = await runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: 20, dryRun: true, fetchPage,
    });

    expect(fetchPage).toHaveBeenNthCalledWith(1, { tenantId: "tenant-1", pageSize: 10 });
    expect(fetchPage).toHaveBeenNthCalledWith(2, { tenantId: "tenant-1", pageSize: 10, cursor: "next" });
    expect(result.pagesRead).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.report.scannedRecords).toBe(2);
  });

  it("caps the final page to the remaining record budget and marks truncation", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      records: [{ id: "a" }, { id: "b" }],
      nextCursor: "more",
    });

    const result = await runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 50, maxRecords: 2, dryRun: true, fetchPage,
    });

    expect(fetchPage).toHaveBeenCalledWith({ tenantId: "tenant-1", pageSize: 2 });
    expect(result.report.scannedRecords).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("rejects missing tenant scope and invalid limits before reading", async () => {
    const fetchPage = vi.fn();
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: " ", pageSize: 10, maxRecords: 10, dryRun: true, fetchPage,
    })).rejects.toThrow("tenant scope");
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 501, maxRecords: 10, dryRun: true, fetchPage,
    })).rejects.toThrow("pageSize");
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("rejects non-string tenant scope and unsafe record budgets before reading", async () => {
    const fetchPage = vi.fn();
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: 42 as unknown as string, pageSize: 10, maxRecords: 10, dryRun: true, fetchPage,
    })).rejects.toThrow("tenant scope");
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: Number.MAX_SAFE_INTEGER + 1, dryRun: true, fetchPage,
    })).rejects.toThrow("maxRecords");
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("rejects repeated cursors rather than looping forever", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      records: [{ id: "a" }],
      nextCursor: "same",
    });
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 1, maxRecords: 5, dryRun: true, fetchPage,
    })).rejects.toThrow("repeated cursor");
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("rejects empty continuation pages to prevent unbounded cursor-only loops", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ records: [], nextCursor: "another-cursor" });
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: 5, dryRun: true, fetchPage,
    })).rejects.toThrow("empty page with a continuation cursor");
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed page objects and continuation cursors", async () => {
    const fetchNullPage = vi.fn().mockResolvedValue(null);
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: 5, dryRun: true,
      fetchPage: fetchNullPage,
    })).rejects.toThrow("invalid page or records collection");

    const fetchInvalidCursor = vi.fn().mockResolvedValue({
      records: [{ id: "a" }], nextCursor: 123,
    });
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: 5, dryRun: true,
      fetchPage: fetchInvalidCursor,
    })).rejects.toThrow("invalid continuation cursor");

    const fetchNullRecord = vi.fn().mockResolvedValue({ records: [null] });
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: 5, dryRun: true,
      fetchPage: fetchNullRecord,
    })).rejects.toThrow("malformed record");

    const fetchMissingRecordId = vi.fn().mockResolvedValue({ records: [{ email: "orphan@example.test" }] });
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: 5, dryRun: true,
      fetchPage: fetchMissingRecordId,
    })).rejects.toThrow("malformed record");
  });

  it("rejects throwing record accessors and snapshots each field only once", async () => {
    const throwingEmail = Object.defineProperty({ id: "lead-a" }, "email", {
      get() {
        throw new Error("adapter detail must not escape");
      },
    });
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: 5, dryRun: true,
      fetchPage: vi.fn().mockResolvedValue({ records: [throwingEmail] }),
    })).rejects.toThrow("malformed record");

    let emailReads = 0;
    const unstableEmail = {
      id: "lead-b",
      get email() {
        emailReads += 1;
        if (emailReads > 1) throw new Error("field changed between reads");
        return "person@example.test";
      },
    };
    const result = await runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: 5, dryRun: true,
      fetchPage: vi.fn().mockResolvedValue({ records: [unstableEmail] }),
    });

    expect(emailReads).toBe(1);
    expect(result.report.scannedRecords).toBe(1);
    expect(result.report.missingEmailKeys).toEqual(["lead-b"]);
  });

  it("snapshots page envelope accessors once and rejects throwing page getters", async () => {
    const throwingRecords = Object.defineProperty({}, "records", {
      get() {
        throw new Error("adapter detail must not escape");
      },
    });
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: 5, dryRun: true,
      fetchPage: vi.fn().mockResolvedValue(throwingRecords),
    })).rejects.toThrow("invalid page or records collection");

    let cursorReads = 0;
    const changingCursor = {
      records: [{ id: "lead-a" }],
      get nextCursor() {
        cursorReads += 1;
        if (cursorReads > 1) throw new Error("cursor changed between reads");
        return undefined;
      },
    };
    const result = await runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 10, maxRecords: 5, dryRun: true,
      fetchPage: vi.fn().mockResolvedValue(changingCursor),
    });

    expect(cursorReads).toBe(1);
    expect(result.report.scannedRecords).toBe(1);
    expect(result.pagesRead).toBe(1);
  });

  it("rejects adapters that violate the requested page size", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      records: [{ id: "a" }, { id: "b" }],
    });
    await expect(runBoundedLeadIdentifierAudit({
      tenantId: "tenant-1", pageSize: 1, maxRecords: 5, dryRun: true, fetchPage,
    })).rejects.toThrow("exceeded the requested page limit");
  });
});
