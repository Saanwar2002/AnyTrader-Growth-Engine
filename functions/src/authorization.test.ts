import { describe, expect, it } from "vitest";
import { calculateLeadCompleteness, canChangeSuppression, canMarkLeadContacted, canCreateServerOutreachDraft, canTransitionLeadStatus, getOutreachDraftReviewState, hasCampaignWritePermission, hasLeadWritePermission, isValidCampaignStatus, isValidDocumentId, isValidEmailAddress, isValidLeadStatus, isValidOrganisationId, isValidOrganisationPageToken, isValidOrganisationCollectionPageToken, isValidMembershipRecord, normaliseContactReviewStatus, hasConsistentDraftCampaign, normaliseOptionalText, normaliseRequiredText } from "./authorization";

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

  it("requires an explicit verified contact restriction state before marking a lead contacted", () => {
    expect(canMarkLeadContacted(false)).toBe(true);
    expect(canMarkLeadContacted(false, "cleared")).toBe(true);
    expect(canMarkLeadContacted(false, "pending")).toBe(false);
    expect(canMarkLeadContacted(false, "blocked")).toBe(false);
    expect(canMarkLeadContacted(true)).toBe(false);
    expect(canMarkLeadContacted(undefined)).toBe(false);
    expect(canMarkLeadContacted(null)).toBe(false);
    expect(canMarkLeadContacted("false")).toBe(false);
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
    expect(canCreateServerOutreachDraft(false, "cleared")).toBe(true);
    expect(canCreateServerOutreachDraft(false, "pending")).toBe(false);
    expect(canCreateServerOutreachDraft(false, "blocked")).toBe(false);
    expect(canCreateServerOutreachDraft(undefined)).toBe(false);
    expect(canCreateServerOutreachDraft(true)).toBe(false);
    // The boolean restriction must win even when persisted review metadata conflicts.
    expect(canCreateServerOutreachDraft(true, "pending")).toBe(false);
    expect(canCreateServerOutreachDraft(true, "cleared")).toBe(false);
    expect(canCreateServerOutreachDraft(true, "blocked")).toBe(false);
    expect(canMarkLeadContacted(true, "pending")).toBe(false);
    expect(canMarkLeadContacted(true, "cleared")).toBe(false);
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


describe("draft campaign relationship validation", () => {
  it("accepts only matching, valid campaign IDs for a draft and its lead", () => {
    expect(hasConsistentDraftCampaign("campaign_1", "campaign_1")).toBe(true);
    expect(hasConsistentDraftCampaign("campaign_1", "campaign_2")).toBe(false);
    expect(hasConsistentDraftCampaign(undefined, "campaign_1")).toBe(false);
    expect(hasConsistentDraftCampaign("campaign_1", null)).toBe(false);
    expect(hasConsistentDraftCampaign("../campaign", "../campaign")).toBe(false);
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

  it("requires pending contact review to be resolved before a draft is usable", () => {
    expect(getOutreachDraftReviewState(true, true, "pending")).toEqual({
      leadSuppressed: true,
      requiresReview: true,
      reviewReason: "Lead is suppressed; do not contact.",
    });
    expect(getOutreachDraftReviewState(true, false, "pending")).toEqual({
      leadSuppressed: false,
      requiresReview: true,
      reviewReason: "Lead contact review is pending or could not be verified; review before use.",
    });
  });

  it("treats an explicit do-not-contact restriction as suppressed even when review metadata is pending", () => {
    expect(getOutreachDraftReviewState(true, true, "pending")).toEqual({
      leadSuppressed: true,
      requiresReview: true,
      reviewReason: "Lead is suppressed; do not contact.",
    });
    expect(getOutreachDraftReviewState(true, true, "cleared")).toEqual({
      leadSuppressed: true,
      requiresReview: true,
      reviewReason: "Lead is suppressed; do not contact.",
    });
  });

  it("treats a blocked review state as suppressed even if the boolean field conflicts", () => {
    expect(getOutreachDraftReviewState(true, false, "blocked")).toEqual({
      leadSuppressed: true,
      requiresReview: true,
      reviewReason: "Lead is suppressed; do not contact.",
    });
  });

  it("allows legacy and explicitly cleared review states only when suppression is false", () => {
    expect(getOutreachDraftReviewState(true, false)).toEqual({
      leadSuppressed: false,
      requiresReview: false,
      reviewReason: null,
    });
    expect(getOutreachDraftReviewState(true, false, "cleared")).toEqual({
      leadSuppressed: false,
      requiresReview: false,
      reviewReason: null,
    });
  });

  it.each(["unknown", "PENDING", 0, null])("fails closed for an unrecognised review status (%s)", (status) => {
    expect(getOutreachDraftReviewState(true, false, status)).toEqual({
      leadSuppressed: false,
      requiresReview: true,
      reviewReason: "Lead contact restriction could not be verified; review before use.",
    });
  });
});


describe("contact review status normalisation", () => {
  it("preserves recognised statuses", () => {
    expect(normaliseContactReviewStatus(false, "cleared")).toBe("cleared");
    expect(normaliseContactReviewStatus(false, "pending")).toBe("pending");
    expect(normaliseContactReviewStatus(true, "blocked")).toBe("blocked");
    expect(normaliseContactReviewStatus(true, "cleared")).toBe("blocked");
    expect(normaliseContactReviewStatus(false, "blocked")).toBe("blocked");
  });

  it("recognises only the legacy explicitly-unsuppressed record as implicitly cleared", () => {
    expect(normaliseContactReviewStatus(false, undefined)).toBe("cleared");
    expect(normaliseContactReviewStatus(false, "unknown")).toBe("pending");
    expect(normaliseContactReviewStatus(false, null)).toBe("pending");
    expect(normaliseContactReviewStatus(undefined, undefined)).toBe("pending");
    expect(normaliseContactReviewStatus(true, "unknown")).toBe("blocked");
  });
});


describe("organisation pagination token validation", () => {
  it("accepts only a membership cursor belonging to the signed-in user", () => {
    expect(isValidOrganisationPageToken("organisations/org-123/members/user_1", "user_1")).toBe(true);
    expect(isValidOrganisationPageToken("organisations/org-123/members/other-user", "user_1")).toBe(false);
    expect(isValidOrganisationPageToken("organisations/org-123/leads/user_1", "user_1")).toBe(false);
    expect(isValidOrganisationPageToken("organisations/../members/user_1", "user_1")).toBe(false);
    expect(isValidOrganisationPageToken("organisations/org-123/members/user_1/extra", "user_1")).toBe(false);
    expect(isValidOrganisationPageToken("x".repeat(513), "user_1")).toBe(false);
    expect(isValidOrganisationPageToken(undefined, "user_1")).toBe(false);
  });
});


describe("membership record validation", () => {
  it("requires the caller UID and a recognised role", () => {
    expect(isValidMembershipRecord({ uid: "user-1", role: "owner" }, "user-1")).toBe(true);
    expect(isValidMembershipRecord({ uid: "other", role: "owner" }, "user-1")).toBe(false);
    expect(isValidMembershipRecord({ uid: "user-1", role: "superadmin" }, "user-1")).toBe(false);
    expect(isValidMembershipRecord({ role: "member" }, "user-1")).toBe(false);
    expect(isValidMembershipRecord(null, "user-1")).toBe(false);
    expect(isValidMembershipRecord([], "user-1")).toBe(false);
  });
});


describe("tenant-scoped collection pagination token validation", () => {
  it("accepts only safe lead/draft cursors belonging to the selected organisation", () => {
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/campaigns/campaign-1", "org-1", "campaigns")).toBe(true);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/leads/lead-1", "org-1", "leads")).toBe(true);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/outreachDrafts/draft-1", "org-1", "outreachDrafts")).toBe(true);
    expect(isValidOrganisationCollectionPageToken("organisations/org-2/leads/lead-1", "org-1", "leads")).toBe(false);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/leads/lead-1", "org-1", "campaigns")).toBe(false);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/outreachDrafts/draft-1", "org-1", "campaigns")).toBe(false);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/leads/../other", "org-1", "leads")).toBe(false);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/leads/lead-1/extra", "org-1", "leads")).toBe(false);
    expect(isValidOrganisationCollectionPageToken("x".repeat(513), "org-1", "leads")).toBe(false);
  });
});

describe("complete organisation role permission matrix", () => {
  it.each([
    ["owner", true, true],
    ["admin", true, true],
    ["member", false, true],
    ["viewer", false, false],
    ["unknown", false, false],
    [null, false, false],
  ])("applies least-privilege permissions for role %s", (role, canWriteCampaign, canWriteLead) => {
    expect(hasCampaignWritePermission(role)).toBe(canWriteCampaign);
    expect(hasLeadWritePermission(role)).toBe(canWriteLead);
  });
});

describe("suppression permission matrix regression", () => {
  it.each([
    ["owner", true, true], ["admin", true, true], ["member", true, false], ["viewer", false, false],
  ])("role %s can suppress=%s and clear=%s", (role, canSuppress, canClear) => {
    expect(canChangeSuppression(role, true)).toBe(canSuppress);
    expect(canChangeSuppression(role, false)).toBe(canClear);
  });
  it.each([undefined, null, "true", 1, {}, []])("rejects non-boolean suppression requests (%s)", (value) => {
    expect(canChangeSuppression("owner", value)).toBe(false);
  });
});

describe("malformed membership records fail closed", () => {
  it.each([
    [{ uid: "user-1", role: "owner", extra: true }, true],
    [{ uid: "user-1", role: "OWNER" }, false],
    [{ uid: "user-1", role: "owner" }, true],
    [{ uid: " user-1", role: "owner" }, false],
    [{ uid: "user-1", role: "" }, false],
    [{ uid: "user-1", role: ["owner"] }, false],
    [true, false],
    ["owner", false],
    [new Date(), false],
  ])("validates membership record shape %#", (record, expected) => {
    expect(isValidMembershipRecord(record, "user-1")).toBe(expected);
  });
});

describe("adversarial pagination cursor regression cases", () => {
  it.each([
    "", "/", "organisations//members/user-1", "organisations/org-1/members/",
    "organisations/org-1/members/user-1/", "organisations/org-1/members/user-1?x=1",
    "organisations/org-1/members/user-1\\n",
  ])("rejects malformed organisation cursor %j", (token) => {
    expect(isValidOrganisationPageToken(token, "user-1")).toBe(false);
  });

  it.each([
    "", "organisations/org-1/leads/lead-1", "organisations/org-1/campaigns/../lead-1",
    "organisations/org-1/outreachDrafts/draft-1/extra", "organisations/org-2/leads/lead-1",
  ])("rejects malformed or cross-collection lead cursor %j", (token) => {
    expect(isValidOrganisationCollectionPageToken(token, "org-1", "leads")).toBe(false);
  });
});

describe("contact actions fail closed for malformed review metadata", () => {
  it.each([undefined, null, "pending", "blocked", "unknown", 0, false, {}])(
    "does not allow contact actions when review state is %j", (status) => {
      expect(canCreateServerOutreachDraft(false, status)).toBe(false);
      expect(canMarkLeadContacted(false, status)).toBe(false);
    },
  );
  it("allows the legacy path only when suppression is explicitly false and status is absent", () => {
    expect(canCreateServerOutreachDraft(false, undefined)).toBe(true);
    expect(canMarkLeadContacted(false, undefined)).toBe(true);
    expect(canCreateServerOutreachDraft(undefined, undefined)).toBe(false);
    expect(canMarkLeadContacted(undefined, undefined)).toBe(false);
  });
});
