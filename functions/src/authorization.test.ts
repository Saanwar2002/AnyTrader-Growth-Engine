import { describe, expect, it } from "vitest";
import { hasCampaignWritePermission, isValidOrganisationId, normaliseOptionalText, normaliseRequiredText } from "./authorization";

describe("server authorization input guards", () => {
  it("trims required text and rejects missing, non-string, blank, and overlong values", () => {
    expect(normaliseRequiredText("  Leeds pilot  ", 40)).toBe("Leeds pilot");
    expect(normaliseRequiredText("   ", 40)).toBeNull();
    expect(normaliseRequiredText(undefined, 40)).toBeNull();
    expect(normaliseRequiredText(12, 40)).toBeNull();
    expect(normaliseRequiredText("x".repeat(41), 40)).toBeNull();
  });

  it("allows an omitted or blank optional goal but rejects invalid and overlong values", () => {
    expect(normaliseOptionalText(undefined, 500)).toBe("");
    expect(normaliseOptionalText("  ", 500)).toBe("");
    expect(normaliseOptionalText("Recruit local providers", 500)).toBe("Recruit local providers");
    expect(normaliseOptionalText(10, 500)).toBeNull();
    expect(normaliseOptionalText("x".repeat(501), 500)).toBeNull();
  });

  it("allows campaign writes only for owner and admin roles", () => {
    expect(hasCampaignWritePermission("owner")).toBe(true);
    expect(hasCampaignWritePermission("admin")).toBe(true);
    expect(hasCampaignWritePermission("member")).toBe(false);
    expect(hasCampaignWritePermission("viewer")).toBe(false);
    expect(hasCampaignWritePermission("owner;admin")).toBe(false);
    expect(hasCampaignWritePermission(undefined)).toBe(false);
  });

  it("accepts only bounded, path-safe organisation IDs", () => {
    expect(isValidOrganisationId("org_123-abc")).toBe(true);
    expect(isValidOrganisationId("../other-tenant")).toBe(false);
    expect(isValidOrganisationId("a/b")).toBe(false);
    expect(isValidOrganisationId(" ")).toBe(false);
    expect(isValidOrganisationId("x".repeat(129))).toBe(false);
  });
});
