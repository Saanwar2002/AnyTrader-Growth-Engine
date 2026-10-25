import { describe, expect, it } from "vitest";
import { canCreateOutreachDraft, getContactRestrictionAction, deduplicateLeads, escapeCsvCell, serializeLeadExportCsv, serializePlanUsageReconciliationCsv, formatLeadSourceLabel, findLeadCsvDuplicates, inspectLeadCsvHeaders, normalizeBusinessName, parseLeadCsv, scoreLead, suggestLeadCsvMapping } from "./domain";

describe("outreach suppression", () => {
  it("offers a clear/review action for suppressed, pending, or contradictory blocked records", () => {
    expect(getContactRestrictionAction(true, "blocked")).toBe("clear");
    expect(getContactRestrictionAction(true, "cleared")).toBe("clear");
    expect(getContactRestrictionAction(false, "pending")).toBe("clear");
    expect(getContactRestrictionAction(false, "blocked")).toBe("clear");
    expect(getContactRestrictionAction(false, "cleared")).toBe("suppress");
    expect(getContactRestrictionAction(false, undefined)).toBe("suppress");
  });

  it("blocks new outreach drafts for suppressed leads", () => {
    expect(canCreateOutreachDraft({ doNotContact: true })).toBe(false);
    expect(canCreateOutreachDraft({ doNotContact: false })).toBe(true);
    expect(canCreateOutreachDraft({ doNotContact: false, contactReviewStatus: "cleared" })).toBe(true);
    expect(canCreateOutreachDraft({ doNotContact: false, contactReviewStatus: "pending" })).toBe(false);
    expect(canCreateOutreachDraft({ doNotContact: false, contactReviewStatus: "blocked" })).toBe(false);
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

  it("accepts harmless whitespace around quoted CSV fields", () => {
    const result = parseLeadCsv('businessName,category\n  "North Star Decorators"  , "Painters"  ');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{ businessname: "North Star Decorators", category: "Painters" }]);
  });

  it("accepts whitespace after a closing quote but still rejects trailing text", () => {
    const valid = parseLeadCsv('businessName,category\n"North Star Decorators"  , "Painters"  ');
    expect(valid.errors).toEqual([]);
    expect(valid.rows[0]).toEqual({ businessname: "North Star Decorators", category: "Painters" });
    const invalid = parseLeadCsv('businessName,category\n"North Star Decorators"oops,Painters');
    expect(invalid.rows).toEqual([]);
    expect(invalid.errors).toEqual(["Row 2: malformed or unmatched quote; row skipped."]);
  });

  it("supports quoted fields spanning physical lines and preserves later row numbers", () => {
    const result = parseLeadCsv('businessName,location,email\nNorth Star Decorators,"Manchester,\nGreater Manchester",hello@example.com\nExample Decorators,Leeds,invalid-email');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].location).toBe("Manchester,\nGreater Manchester");
    expect(result.errors).toEqual(["Row 4: email address is not valid; row skipped."]);
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

  it("rejects a custom mapping that assigns one source column to multiple fields", () => {
    const result = parseLeadCsv("Provider,Area\nNorth Star Decorators,Manchester", {
      businessName: "Provider", category: "Provider",
    });
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      "CSV field mapping assigns the same column to multiple fields (businessName, category); choose a different column for each field.",
    ]);
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
    expect(result.errors).toEqual(["Row 2: malformed or unmatched quote; row skipped."]);
  });

  it("recovers from an unmatched quote before a later quoted record", () => {
    const result = parseLeadCsv(`businessName,category
"Unclosed Decorators,Painters
"North Star Decorators",Painters
Example Decorators,Painters`);
    expect(result.rows.map((row) => row.businessname)).toEqual(["North Star Decorators", "Example Decorators"]);
    expect(result.errors).toEqual(["Row 2: malformed or unmatched quote; row skipped."]);
  });

  it("preserves a valid multiline field followed by quoted fields in later records", () => {
    const result = parseLeadCsv(`businessName,location,email
North Star Decorators,"Manchester,
Greater Manchester",hello@example.com
"Westside Painting","Leeds, UK",team@example.com`);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].location).toBe("Manchester,\nGreater Manchester");
    expect(result.rows[1].businessname).toBe("Westside Painting");
    expect(result.rows[1].location).toBe("Leeds, UK");
  });


  it.each([
    'Example "Decorators",Painters',
    '"Example Decorators"trailing,Painters',
  ])("rejects malformed quote placement in data rows: %s", (row) => {
    const result = parseLeadCsv(`businessName,category\n${row}\nNorth Star Decorators,Painters`);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].businessname).toBe("North Star Decorators");
    expect(result.errors).toEqual(["Row 2: malformed or unmatched quote; row skipped."]);
  });

  it("rejects a header with an unmatched quote", () => {
    const result = parseLeadCsv(`"businessName,category
Example Decorators,Painters`);
    expect(result.errors[0]).toContain("header contains an unmatched quote");
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

  it("skips imported rows with invalid non-empty email addresses", () => {
    const result = parseLeadCsv("businessName,email\nNorth Star Decorators,not-an-email");
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(["Row 2: email address is not valid; row skipped."]);
  });

  it("skips imported rows with email addresses longer than the server limit", () => {
    const result = parseLeadCsv(`businessName,email\nNorth Star Decorators,${"a".repeat(250)}@example.com`);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(["Row 2: email exceeds the maximum length of 254 characters; row skipped."]);
  });

  it("skips imported rows with business names longer than the server limit", () => {
    const result = parseLeadCsv(`businessName,email\n${"N".repeat(161)},hello@example.com`);
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual(["Row 2: businessname exceeds the maximum length of 160 characters; row skipped."]);
  });
  it("keeps suppression as a hard draft-creation gate", () => {
    const suppressedLead = { doNotContact: true };
    expect(canCreateOutreachDraft(suppressedLead)).toBe(false);
    expect(canCreateOutreachDraft({ doNotContact: false })).toBe(true);
    expect(canCreateOutreachDraft({ doNotContact: undefined as unknown as boolean })).toBe(false);
  });
});


describe("CSV export safety", () => {
  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@SUM(A1)", "  =1+1", "\t=1+1", "\r@formula"])(
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


describe("lead CSV export", () => {
  const lead = {
    campaignId: "campaign-1", businessName: "North Star Decorators", category: "Decorators",
    location: "Edinburgh", website: "https://northstar.example", email: "hello@northstar.example",
    phone: "+44 131 555 0100", source: "csv", status: "new", doNotContact: true,
    contactRestrictionVerified: false, contactReviewStatus: "pending" as const,
    score: 85, scoreReasons: ["Business name provided (+20)", "Website listed (+20)", "Email listed (+20)"],
  };

  it("exports selected lead fields, campaign names, and contact restrictions without internal notes", () => {
    const csv = serializeLeadExportCsv([lead], { "campaign-1": "Edinburgh decorators" });
    expect(csv).toContain('"North Star Decorators"');
    expect(csv).toContain('"Edinburgh decorators"');
    expect(csv).toContain('"pending review"');
    expect(csv).toContain('"hello@northstar.example"');
    expect(csv).toContain('"Completeness score"');
    expect(csv).toContain('"Completeness reasons"');
    expect(csv).toContain('"85"');
    expect(csv).toContain('"Business name provided (+20); Website listed (+20); Email listed (+20)"');
    expect(csv).not.toContain("Internal notes");
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("protects spreadsheet formula injection in lead fields", () => {
    const csv = serializeLeadExportCsv([{ ...lead, businessName: "  =HYPERLINK(\"https://evil.test\")" }], { "campaign-1": "Campaign" });
    expect(csv).toContain('"\'  =HYPERLINK(""https://evil.test"")"');
  });

  it("exports bounded score values and formula-safe completeness reasons", () => {
    const csv = serializeLeadExportCsv([{
      ...lead,
      score: 150,
      scoreReasons: ["=1+1"],
    }], {});
    expect(csv).toContain('"100"');
    expect(csv).toContain('"\'=1+1"');
  });

  it("marks incomplete restriction metadata as requiring review", () => {
    const csv = serializeLeadExportCsv([{ ...lead, doNotContact: false, contactReviewStatus: undefined, contactRestrictionVerified: false }], {});
    expect(csv).toContain('"review required"');
    expect(csv).toContain('"Unknown campaign"');
  });
});


describe("lead source labels", () => {
  it("renders user-declared source attribution clearly without implying verification", () => {
    expect(formatLeadSourceLabel("linkedin_csv")).toBe("LinkedIn export (user-declared)");
    expect(formatLeadSourceLabel("google_places_manual")).toBe("Google Maps/Places research (user-declared)");
    expect(formatLeadSourceLabel("unknown-source")).toBe("unknown-source");
  });
});


describe("CSV duplicate preview", () => {
  it("flags duplicates by email, canonical website, or business/location", () => {
    const matches = findLeadCsvDuplicates([
      { businessName: "New name", email: "EXISTING@example.test" },
      { businessName: "Another name", website: "example.test/" },
      { businessName: "North Star Decorators", location: "Edinburgh" },
    ], [
      { campaignId: "c1", businessName: "Original", location: "Leeds", email: "existing@example.test", website: "" },
      { campaignId: "c2", businessName: "Website business", location: "Glasgow", email: "", website: "https://example.test" },
      { campaignId: "c3", businessName: "North Star Decorators", location: "Edinburgh", email: "", website: "" },
    ]);
    expect(matches).toEqual([
      { rowIndex: 0, duplicateSource: "loaded-lead", duplicateBusinessName: "Original", matchedOn: "email" },
      { rowIndex: 1, duplicateSource: "loaded-lead", duplicateBusinessName: "Website business", matchedOn: "website" },
      { rowIndex: 2, duplicateSource: "loaded-lead", duplicateBusinessName: "North Star Decorators", matchedOn: "business/location" },
    ]);
  });
  it("flags later upload rows but does not let skipped duplicates reserve extra identifiers", () => {
    const matches = findLeadCsvDuplicates([
      { businessName: "First business", location: "Leeds", email: "same@example.test" },
      { businessName: "Duplicate business", location: "York", email: "same@example.test", website: "new.example.test" },
      { businessName: "Later website row", location: "Bristol", website: "new.example.test" },
    ], []);
    expect(matches).toEqual([
      { rowIndex: 1, duplicateSource: "earlier-upload-row", duplicateBusinessName: "First business", matchedOn: "email" },
    ]);
  });
  it("does not treat different locations or case-sensitive non-root URL paths as duplicates", () => {
    expect(findLeadCsvDuplicates([
      { businessName: "North Star Decorators", location: "Glasgow" },
      { businessName: "Same website", website: "https://example.test/CasePath" },
    ], [
      { campaignId: "c1", businessName: "North Star Decorators", location: "Edinburgh" },
      { campaignId: "c2", businessName: "Same website", website: "https://example.test/casepath" },
    ])).toEqual([]);
  });
  it("exports quota reconciliation without inventing legacy or AI usage and protects formula cells", () => {
    const csv = serializePlanUsageReconciliationCsv({
      organisationId: "org-1",
      status: "reconciliation_required",
      plan: { displayName: "=Pilot", limits: { campaigns: 10, leads: 500, members: 5, monthlyAiSuggestions: 100 } },
      usage: null,
      remaining: null,
      aiUsagePeriod: null,
      message: "Reconciliation required",
    }, {
      status: "missing",
      actual: { campaigns: 3, leads: 42, members: 2 },
      stored: null,
      mismatchedMetrics: [],
      currentAiUsagePeriod: "2026-10",
      notes: ["Stored counters are missing", "=Review before use"],
    });
    expect(csv).toContain('"\'=Pilot"');
    expect(csv).toContain('"3"');
    expect(csv).toContain('"42"');
    expect(csv).toContain('"Unavailable"');
    expect(csv).toContain('"Review required — historical usage is not inferred"');
    expect(csv).toContain("\"'=Review before use\"");
    expect(csv).toContain('"Review required"');
    expect(csv.split("\r\n")).toHaveLength(5);
  });

  it("labels authoritative quota mismatches while retaining the stored values", () => {
    const csv = serializePlanUsageReconciliationCsv({
      organisationId: "org-2",
      status: "authoritative",
      plan: { displayName: "Pilot", limits: { campaigns: 10, leads: 500, members: 5, monthlyAiSuggestions: 100 } },
      usage: { campaigns: 3, leads: 42, members: 2, monthlyAiSuggestions: 7 },
      remaining: { campaigns: 7, leads: 458, members: 3, monthlyAiSuggestions: 93 },
      aiUsagePeriod: "2026-10",
      message: "Authoritative counters available",
    }, {
      status: "present",
      actual: { campaigns: 4, leads: 42, members: 2 },
      stored: { campaigns: 3, leads: 42, members: 2, monthlyAiSuggestions: 7, aiUsagePeriod: "2026-10" },
      mismatchedMetrics: ["campaigns"],
      currentAiUsagePeriod: "2026-10",
      notes: ["Campaign count differs"],
    });
    expect(csv).toContain('"Mismatch"');
    expect(csv).toContain('"3"');
    expect(csv).toContain('"4"');
    expect(csv).toContain('"Monthly AI suggestions"');
    expect(csv).toContain('"2026-10"');
  });

});
