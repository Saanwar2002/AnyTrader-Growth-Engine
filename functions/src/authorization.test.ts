import { describe, expect, it } from "vitest";
import { calculateLeadCompleteness, canChangeSuppression, canCreateServerOutreachDraft, canTransitionLeadStatus, getOutreachDraftReviewState, hasCampaignWritePermission, hasLeadWritePermission, isValidCampaignStatus, isValidDocumentId, isValidEmailAddress, isValidLeadStatus, isValidOrganisationId, normaliseOptionalText, normaliseRequiredText } from "./authorization";

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


describe("server lead workflow guards", () => {
  it("allows lead edits for owner, admin, and member but not viewer", () => {
    expect(hasLeadWritePermission("owner")).toBe(true);
    expect(hasLeadWritePermission("admin")).toBe(true);
    expect(hasLeadWritePermission("member")).toBe(true);
    expect(hasLeadWritePermission("viewer")).toBe(false);
    expect(hasLeadWritePermission(undefined)).toBe(false);
  });

  it("accepts only known lead statuses and safe document IDs", () => {
    expect(isValidLeadStatus("qualified")).toBe(true);
    expect(isValidLeadStatus("admin")).toBe(false);
    expect(isValidLeadStatus("contacted; delete all")).toBe(false);
    expect(isValidDocumentId("lead_123-abc")).toBe(true);
    expect(isValidDocumentId("../another-tenant")).toBe(false);
    expect(isValidDocumentId("x".repeat(129))).toBe(false);
  });

  it("blocks moving a suppressed lead to contacted", () => {
    expect(canTransitionLeadStatus("qualified", true)).toBe(true);
    expect(canTransitionLeadStatus("contacted", false)).toBe(true);
    expect(canTransitionLeadStatus("contacted", true)).toBe(false);
    expect(canTransitionLeadStatus("unknown", false)).toBe(false);
  });

  it("calculates lead completeness on the server with an explainable score", () => {
    expect(calculateLeadCompleteness({ businessName: "Example Painters", website: "https://example.test", email: "hello@example.test", phone: "01234", location: "Leeds", category: "Painters" })).toEqual({
      score: 100,
      reasons: ["Business name provided (+20)", "Website listed (+20)", "Email listed (+20)", "Phone listed (+15)", "Location provided (+15)", "Service category provided (+10)"],
    });
    expect(calculateLeadCompleteness({ businessName: "X", website: "", email: "", phone: "", location: "", category: "" }).score).toBe(0);
  });
});


describe("server outreach safeguards", () => {
  it("treats do-not-contact as a hard draft-creation gate", () => {
    expect(canCreateServerOutreachDraft(false)).toBe(true);
    expect(canCreateServerOutreachDraft(undefined)).toBe(false);
    expect(canCreateServerOutreachDraft(true)).toBe(false);
    expect(canCreateServerOutreachDraft("false")).toBe(false);
    expect(canCreateServerOutreachDraft("true")).toBe(false);
    expect(canCreateServerOutreachDraft(null)).toBe(false);
  });

  it("rejects malformed email addresses before persistence", () => {
    expect(isValidEmailAddress("hello@example.co.uk")).toBe(true);
    expect(isValidEmailAddress("not-an-email")).toBe(false);
    expect(isValidEmailAddress("a@b")).toBe(false);
    expect(isValidEmailAddress("x @example.com")).toBe(false);
  });
});


describe("suppression permission rules", () => {
  it("allows members to suppress a lead but reserves removing suppression for owner/admin", () => {
    expect(canChangeSuppression("member", true)).toBe(true);
    expect(canChangeSuppression("viewer", true)).toBe(false);
    expect(canChangeSuppression("owner", false)).toBe(true);
    expect(canChangeSuppression("admin", false)).toBe(true);
    expect(canChangeSuppression("member", false)).toBe(false);
    expect(canChangeSuppression("owner", "false")).toBe(false);
  });
});


describe("server campaign status validation", () => {
  it("accepts only known campaign statuses", () => {
    expect(isValidCampaignStatus("draft")).toBe(true);
    expect(isValidCampaignStatus("active")).toBe(true);
    expect(isValidCampaignStatus("paused")).toBe(true);
    expect(isValidCampaignStatus("completed")).toBe(true);
    expect(isValidCampaignStatus("deleted")).toBe(false);
    expect(isValidCampaignStatus(undefined)).toBe(false);
  });
});


describe("existing outreach draft review state", () => {
  it("flags missing leads for human review", () => {
    expect(getOutreachDraftReviewState(false, false)).toEqual({
      leadSuppressed: false,
      requiresReview: true,
      reviewReason: "Lead record is missing; review before use.",
    });
  });

  it("flags suppressed leads and explicitly blocks contact", () => {
    expect(getOutreachDraftReviewState(true, true)).toEqual({
      leadSuppressed: true,
      requiresReview: true,
      reviewReason: "Lead is suppressed; do not contact.",
    });
  });

  it.each([undefined, null, "false", 0])("fails closed when contact permission is unverified (%s)", (value) => {
    expect(getOutreachDraftReviewState(true, value)).toEqual({
      leadSuppressed: false,
      requiresReview: true,
      reviewReason: "Lead contact restriction could not be verified; review before use.",
    });
  });

  it("allows review state only when the lead exists and suppression is explicitly false", () => {
    expect(getOutreachDraftReviewState(true, false)).toEqual({
      leadSuppressed: false,
      requiresReview: false,
      reviewReason: null,
    });
  });
});
