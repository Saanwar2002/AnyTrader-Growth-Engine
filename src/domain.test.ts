import { describe, expect, it } from "vitest";
import { canCreateOutreachDraft, deduplicateLeads, escapeCsvCell, inspectLeadCsvHeaders, normalizeBusinessName, parseLeadCsv, scoreLead, suggestLeadCsvMapping } from "./domain";

describe("outreach suppression", () => {
  it("blocks new outreach drafts for suppressed leads", () => {
    expect(canCreateOutreachDraft({ doNotContact: true })).toBe(false);
    expect(canCreateOutreachDraft({ doNotContact: false })).toBe(true);
  });
});

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

  it("suggests mappings for common alternative column names", () => {
    const inspected = inspectLeadCsvHeaders("Trading Name,Trade Type,Postcode,Contact Email,Mobile");
    expect(inspected.errors).toEqual([]);
    expect(suggestLeadCsvMapping(inspected.headers)).toEqual({
      businessName: "Trading Name", category: "Trade Type", location: "Postcode", email: "Contact Email", phone: "Mobile",
    });
  });

  it("parses using a user-selected mapping for unfamiliar headers", () => {
    const csv = "Provider,Specialism,Service Area,Contact\nNorth Star Decorators,Painting,Manchester,hello@example.com";
    const result = parseLeadCsv(csv, {
      businessName: "Provider", category: "Specialism", location: "Service Area", email: "Contact",
    });
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{
      businessname: "North Star Decorators", category: "Painting", location: "Manchester", email: "hello@example.com",
    }]);
  });

  it("requires a business-name mapping when custom mappings are supplied", () => {
    const result = parseLeadCsv("Provider,Area\nNorth Star Decorators,Manchester", { location: "Area" });
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("Map a CSV column");
  });

  it("skips nameless rows and reports the row number", () => {
    const result = parseLeadCsv(`businessName,category
,Painting
Example Decorators,Painters`);
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual(["Row 2: business name is required; row skipped."]);
  });

  it("rejects a header-only or empty CSV", () => {
    expect(parseLeadCsv("businessName").errors[0]).toContain("header and at least one data row");
    expect(parseLeadCsv("").errors[0]).toContain("header and at least one data row");
  });

  it("reports an unmatched quote and skips the malformed row", () => {
    const result = parseLeadCsv(`businessName,category
"Unclosed Decorators,Painters
Example Decorators,Painters`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].businessname).toBe("Example Decorators");
    expect(result.errors).toEqual(["Row 2: unmatched quote; row skipped."]);
  });

  it("rejects a header with an unmatched quote", () => {
    const result = parseLeadCsv(`"businessName,category
Example Decorators,Painters`);
    expect(result.errors[0]).toContain("header contains an unmatched quote");
  });
});

  it("removes a UTF-8 BOM and handles escaped quotes", () => {
    const result = parseLeadCsv('\uFEFFbusinessName,notes\n"North ""Star"" Decorators",Approved');
    expect(result.errors).toEqual([]);
    expect(result.rows[0].businessname).toBe('North "Star" Decorators');
  });

  it("rejects duplicate headers after normalisation", () => {
    const result = parseLeadCsv("businessName,Business Name\nExample Decorators,Other");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("duplicate column header");
  });

  it("rejects empty column headers", () => {
    const result = parseLeadCsv("businessName,,email\nExample Decorators,Painters,hello@example.com");
    expect(result.rows).toEqual([]);
    expect(result.errors[0]).toContain("empty column header");
  });

  it("skips rows with more values than headers and preserves source line numbers", () => {
    const result = parseLeadCsv("\nbusinessName,category\n\nExample Decorators,Painters,unexpected\nNorth Star Decorators,Painters");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].businessname).toBe("North Star Decorators");
    expect(result.errors).toEqual(["Row 4: contains more values than the header has columns; row skipped."]);
  });

  it("fills missing optional cells with empty strings", () => {
    const result = parseLeadCsv("businessName,category,email\nExample Decorators,Painters");
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toEqual({ businessname: "Example Decorators", category: "Painters", email: "" });
  });



describe("deduplicateLeads", () => {
  const lead = (businessName: string, campaignId = "campaign-a") => ({ businessName, campaignId });

  it("deduplicates case and whitespace variations within the same campaign", () => {
    const result = deduplicateLeads(
      [lead(" NORTH  STAR DECORATORS "), lead("Fresh Paint Co"), lead("fresh paint co")],
      [lead("North Star Decorators")],
    );
    expect(result.unique).toEqual([lead("Fresh Paint Co")]);
    expect(result.duplicateCount).toBe(2);
  });

  it("keeps the same business name when it belongs to a different campaign", () => {
    const result = deduplicateLeads([lead("North Star Decorators", "campaign-b")], [lead("North Star Decorators", "campaign-a")]);
    expect(result.unique).toHaveLength(1);
    expect(result.duplicateCount).toBe(0);
  });
});


describe("CSV import safety edge cases", () => {
  it("does not treat an email or category column as the required business name", () => {
    const result = parseLeadCsv("category,email\nPainters,hello@example.com");
    expect(result.rows).toEqual([]);
    expect(result.errors.join(" ")).toContain("Missing required column");
  });

  it("does not silently accept a row with extra columns", () => {
    const result = parseLeadCsv("businessName,category\nExample Decorators,Painters,unexpected");
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      "Row 2: contains more values than the header has columns; row skipped.",
    ]);
  });

  it("keeps suppression as a hard draft-creation gate", () => {
    const suppressedLead = { doNotContact: true };
    expect(canCreateOutreachDraft(suppressedLead)).toBe(false);
    expect(canCreateOutreachDraft({ doNotContact: false })).toBe(true);
  });
});


describe("CSV export safety", () => {
  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@SUM(A1)", "  =1+1", "\\t=1+1", "\\r@formula"])(
    "prefixes formula-like cell content with a text marker",
    (value) => {
      expect(escapeCsvCell(value)).toBe('"' + "'" + value.replace(/"/g, '""') + '"');
    },
  );

  it("quotes ordinary text and escapes embedded quotes", () => {
    expect(escapeCsvCell('North "Star", Decorators')).toBe('"North ""Star"", Decorators"');
    expect(escapeCsvCell(42)).toBe('"42"');
    expect(escapeCsvCell("hello@example.com")).toBe('"hello@example.com"');
  });
});
