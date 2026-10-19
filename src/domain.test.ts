import { describe, expect, it } from "vitest";
import { normalizeBusinessName, parseLeadCsv, scoreLead } from "./domain";

describe("normalizeBusinessName", () => {
  it("trims whitespace, collapses spaces and ignores case", () => {
    expect(normalizeBusinessName("  NORTH   Star Decorators  ")).toBe("north star decorators");
  });
});

describe("scoreLead", () => {
  it("returns an explainable maximum score when all fields are present", () => {
    const result = scoreLead({
      businessName: "Example Decorators",
      website: "https://example.com",
      email: "hello@example.com",
      phone: "01615550100",
      location: "Manchester",
      category: "Painters",
    });
    expect(result.score).toBe(100);
    expect(result.reasons).toHaveLength(6);
    expect(result.reasons.join(" ")).toContain("Website listed (+20)");
  });

  it("does not award points for blank fields", () => {
    expect(scoreLead({ businessName: "", website: "", email: "", phone: "", location: "", category: "" }))
      .toEqual({ score: 0, reasons: [] });
  });
});

describe("parseLeadCsv", () => {
  it("parses normal rows and quoted commas", () => {
    const result = parseLeadCsv('businessName,category,location,email\n"North, Star Decorators",Painters,"Manchester, UK",hello@example.com');
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].businessname).toBe("North, Star Decorators");
    expect(result.rows[0].location).toBe("Manchester, UK");
  });

  it("reports a missing business name header", () => {
    const result = parseLeadCsv("category,location\nPainters,Manchester");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("Missing required column");
  });

  it("skips nameless rows and reports the row number", () => {
    const result = parseLeadCsv("businessName,category\n,Painting\nExample Decorators,Painters");
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual(["Row 2: business name is required; row skipped."]);
  });

  it("rejects a header-only or empty CSV", () => {
    expect(parseLeadCsv("businessName").errors[0]).toContain("header and at least one data row");
    expect(parseLeadCsv("").errors[0]).toContain("header and at least one data row");
  });

  it("reports an unmatched quote and skips the malformed row", () => {
    const result = parseLeadCsv('businessName,category\\n"Unclosed Decorators,Painters\\nExample Decorators,Painters');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].businessname).toBe("Example Decorators");
    expect(result.errors).toEqual(["Row 2: unmatched quote; row skipped."]);
  });

  it("rejects a header with an unmatched quote", () => {
    const result = parseLeadCsv('"businessName,category\\nExample Decorators,Painters');
    expect(result.errors[0]).toContain("header contains an unmatched quote");
  });
});
