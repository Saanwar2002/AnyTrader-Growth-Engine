import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateLeadCompleteness, canChangeSuppression, canMarkLeadContacted, canCreateServerOutreachDraft, canTransitionLeadStatus, getOutreachDraftReviewState, hasCampaignWritePermission, hasLeadWritePermission, isValidCampaignStatus, isValidDocumentId, isValidEmailAddress, isValidLeadStatus, isValidOrganisationId, isValidOrganisationPageToken, isValidOrganisationCollectionPageToken, isValidMembershipRecord, isValidMembershipForOrganisation, isValidFirestoreTimestamp, normaliseContactReviewStatus, hasConsistentDraftCampaign, normaliseOptionalText, normaliseRequiredText, isSafeWebsiteAddress, evaluateRateLimit, createRateLimitDocumentId, safeTimestampToIso } from "./authorization";

describe("safe persisted timestamp serialization", () => {
  it("does not execute accessor-backed timestamp conversion methods", () => {
    let getterInvoked = false;
    const timestamp = Object.defineProperty({}, "toDate", {
      configurable: true,
      get: () => {
        getterInvoked = true;
        return () => new Date("2026-10-20T12:00:00.000Z");
      },
    });
    expect(safeTimestampToIso(timestamp)).toBeNull();
    expect(getterInvoked).toBe(false);

    const prototype = Object.defineProperty({}, "toDate", {
      get: () => {
        getterInvoked = true;
        return () => new Date("2026-10-20T12:00:00.000Z");
      },
    });
    expect(safeTimestampToIso(Object.create(prototype))).toBeNull();
    expect(getterInvoked).toBe(false);
  });

  it("uses intrinsic Date methods rather than overridable instance properties", () => {
    const date = new Date("2026-10-20T12:00:00.000Z");
    Object.defineProperty(date, "getTime", { get: () => { throw new Error("must not run"); } });
    Object.defineProperty(date, "toISOString", { get: () => { throw new Error("must not run"); } });
    expect(safeTimestampToIso({ toDate: () => date })).toBe("2026-10-20T12:00:00.000Z");
  });

  it("serializes valid timestamps and fails closed for malformed legacy values", () => {
    expect(safeTimestampToIso({ toDate: () => new Date("2026-10-20T12:00:00.000Z") })).toBe("2026-10-20T12:00:00.000Z");
    expect(safeTimestampToIso(undefined)).toBeNull();
    expect(safeTimestampToIso(null)).toBeNull();
    expect(safeTimestampToIso("not-a-timestamp")).toBeNull();
    expect(safeTimestampToIso(123)).toBeNull();
    expect(safeTimestampToIso({ toDate: "not-a-function" })).toBeNull();
    expect(safeTimestampToIso({ toDate: () => "not-a-date" })).toBeNull();
    expect(safeTimestampToIso({ toDate: () => new Date(Number.NaN) })).toBeNull();
    expect(safeTimestampToIso({ toDate: () => { throw new Error("corrupt legacy value"); } })).toBeNull();
    const throwingGetter = Object.defineProperty({}, "toDate", { get() { throw new Error("corrupt legacy getter"); } });
    expect(safeTimestampToIso(throwingGetter)).toBeNull();
  });
});

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

  it.each(["https://example.test", "http://example.test/path", "HTTPS://Example.test/path", "https://example.test:8443/path?source=csv", "www.example.test", "example.test", ""])(
    "accepts ordinary website values: %s",
    (value) => expect(isSafeWebsiteAddress(value)).toBe(true),
  );

  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.test",
    "user@example.test",
    "example.test@attacker.test",
    "@example.test",
    "/relative/path",
    "?source=csv",
    "#section",
    "//example.test/path",
    "https://example.test/path with spaces",
    "https://user:password@example.test/path",
    "https://example.test@attacker.test/path",
    "https://example.test/path\u0000suffix",
    "https://example.test/path\nheader",
    "https:\\\\example.test/path",
  ])("rejects unsafe or ambiguous website values: %s", (value) => {
    expect(isSafeWebsiteAddress(value)).toBe(false);
  });

  it("rejects malformed email addresses before persistence", () => {
    expect(isValidEmailAddress("hello@example.co.uk")).toBe(true);
    expect(isValidEmailAddress("First.Last+tag@sub.example.co.uk")).toBe(true);
    expect(isValidEmailAddress("HELLO@EXAMPLE.COM")).toBe(true);
    const maximumLengthDomain = "a".repeat(63) + "." + "b".repeat(63) + "." + "c".repeat(61);
    const overMaximumLengthDomain = "a".repeat(63) + "." + "b".repeat(63) + "." + "c".repeat(62);
    expect(isValidEmailAddress("x".repeat(64) + "@" + maximumLengthDomain)).toBe(true);
    expect(isValidEmailAddress("x".repeat(64) + "@" + overMaximumLengthDomain)).toBe(false);
    expect(isValidEmailAddress("a".repeat(64) + "@example.com")).toBe(true);
    expect(isValidEmailAddress("a".repeat(65) + "@example.com")).toBe(false);
    expect(isValidEmailAddress("hello@" + "a".repeat(64) + ".com")).toBe(false);
    expect(isValidEmailAddress("not-an-email")).toBe(false);
    expect(isValidEmailAddress("a@b")).toBe(false);
    expect(isValidEmailAddress("x @example.com")).toBe(false);
    expect(isValidEmailAddress("@example.com")).toBe(false);
    expect(isValidEmailAddress("hello..world@example.com")).toBe(false);
    expect(isValidEmailAddress("hello@example..com")).toBe(false);
    expect(isValidEmailAddress("hello@example.com\nBcc:other@example.com")).toBe(false);
    expect(isValidEmailAddress("hello@example.com.")).toBe(false);
    expect(isValidEmailAddress("hello@-example.com")).toBe(false);
    expect(isValidEmailAddress("hello@example-.com")).toBe(false);
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


describe("contact review status adversarial matrix", () => {
  it.each([
    [true, undefined, "blocked"],
    [true, null, "blocked"],
    [true, "unknown", "blocked"],
    [true, "pending", "pending"],
    [true, "cleared", "blocked"],
    [false, undefined, "cleared"],
    [false, null, "pending"],
    [false, "unknown", "pending"],
    [false, "pending", "pending"],
    [false, "cleared", "cleared"],
    [false, "blocked", "blocked"],
    [undefined, "cleared", "pending"],
    [undefined, undefined, "pending"],
    [null, "cleared", "pending"],
    ["false", "cleared", "pending"],
  ])("normalises restriction=%s and status=%s to %s", (restriction, status, expected) => {
    expect(normaliseContactReviewStatus(restriction, status)).toBe(expected);
  });

  it.each([
    [undefined, undefined],
    [null, "cleared"],
    ["false", "cleared"],
    [false, null],
    [false, "unknown"],
    [false, 0],
  ])("does not grant draft/contact permission for malformed restriction=%s status=%s", (restriction, status) => {
    expect(canCreateServerOutreachDraft(restriction, status)).toBe(false);
    expect(canMarkLeadContacted(restriction, status)).toBe(false);
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

    const inheritedIdentity = Object.create({ uid: "user-1", role: "owner" }) as Record<string, unknown>;
    expect(isValidMembershipRecord(inheritedIdentity, "user-1")).toBe(false);

    const inheritedUid = Object.create({ uid: "user-1" }) as Record<string, unknown>;
    inheritedUid.role = "admin";
    expect(isValidMembershipRecord(inheritedUid, "user-1")).toBe(false);

    const inheritedRole = Object.create({ role: "owner" }) as Record<string, unknown>;
    inheritedRole.uid = "user-1";
    expect(isValidMembershipRecord(inheritedRole, "user-1")).toBe(false);

    const ownFieldsOnNullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
      uid: "user-1",
      role: "member",
    });
    expect(isValidMembershipRecord(ownFieldsOnNullPrototype, "user-1")).toBe(true);
  });
});

describe("malformed membership accessors", () => {
  it("fails closed when persisted membership identity or role accessors throw", () => {
    const throwingUid = Object.defineProperty({ role: "owner" }, "uid", {
      enumerable: true,
      get() { throw new Error("malformed membership uid"); },
    });
    const throwingRole = Object.defineProperty({ uid: "user-1" }, "role", {
      enumerable: true,
      get() { throw new Error("malformed membership role"); },
    });
    expect(isValidMembershipRecord(throwingUid, "user-1")).toBe(false);
    expect(isValidMembershipRecord(throwingRole, "user-1")).toBe(false);
  });

  it("fails closed when a legacy membership proxy throws during own-field inspection", () => {
    const hostileRecord = new Proxy({ uid: "user-1", role: "owner" }, {
      getOwnPropertyDescriptor() {
        throw new Error("malformed membership proxy");
      },
    });
    expect(isValidMembershipRecord(hostileRecord, "user-1")).toBe(false);
  });
});

describe("organisation membership role integrity", () => {
  it("fails closed if an owner membership role accessor throws on a later read", () => {
    let reads = 0;
    const unstableRole = Object.defineProperty({ uid: "user-1" }, "role", {
      enumerable: true,
      get() {
        reads += 1;
        if (reads > 1) throw new Error("unstable membership role");
        return "owner";
      },
    });
    expect(isValidMembershipForOrganisation(unstableRole, "user-1", "user-1")).toBe(false);
  });

  it("requires owner-role membership to match the parent organisation owner", () => {
    expect(isValidMembershipForOrganisation({ uid: "user-1", role: "owner" }, "user-1", "user-1")).toBe(true);
    expect(isValidMembershipForOrganisation({ uid: "user-1", role: "owner" }, "user-1", "other-owner")).toBe(false);
    expect(isValidMembershipForOrganisation({ uid: "user-1", role: "owner" }, "user-1", undefined)).toBe(false);
  });

  it.each([undefined, null, "", " ", 0, false, {}, []])(
    "rejects owner membership when authoritative ownerUid is malformed (%j)",
    (ownerUid) => {
      expect(isValidMembershipForOrganisation(
        { uid: "user-1", role: "owner" },
        "user-1",
        ownerUid,
      )).toBe(false);
    },
  );

  it("does not require non-owner memberships to match ownerUid", () => {
    expect(isValidMembershipForOrganisation({ uid: "user-1", role: "admin" }, "user-1", "other-owner")).toBe(true);
    expect(isValidMembershipForOrganisation({ uid: "user-1", role: "member" }, "user-1", undefined)).toBe(true);
    expect(isValidMembershipForOrganisation({ uid: "user-1", role: "viewer" }, "user-1", "other-owner")).toBe(true);
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
    "organisations/org-1/members/user-1\n",
  ])("rejects malformed organisation cursor %j", (token) => {
    expect(isValidOrganisationPageToken(token, "user-1")).toBe(false);
  });

  it.each([
    "", "organisations/org-1/campaigns/../lead-1",
    "organisations/org-1/outreachDrafts/draft-1/extra", "organisations/org-2/leads/lead-1",
  ])("rejects malformed or cross-collection lead cursor %j", (token) => {
    expect(isValidOrganisationCollectionPageToken(token, "org-1", "leads")).toBe(false);
  });
});

describe("contact actions fail closed for malformed review metadata", () => {
  it.each([null, "pending", "blocked", "unknown", 0, false, {}])(
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


describe("legacy outreach draft safety regressions", () => {
  it("flags missing leads and malformed or contradictory restriction metadata for review", () => {
    expect(getOutreachDraftReviewState(false, false, "cleared")).toEqual({
      leadSuppressed: false,
      requiresReview: true,
      reviewReason: "Lead record is missing; review before use.",
    });
    expect(getOutreachDraftReviewState(true, true, "cleared")).toEqual({
      leadSuppressed: true,
      requiresReview: true,
      reviewReason: "Lead is suppressed; do not contact.",
    });
    for (const status of [null, "unknown", 1, {}, []]) {
      expect(getOutreachDraftReviewState(true, false, status).requiresReview).toBe(true);
    }
  });

  it("requires both draft and lead campaign references to be valid and identical", () => {
    expect(hasConsistentDraftCampaign("campaign-1", "campaign-1")).toBe(true);
    expect(hasConsistentDraftCampaign("campaign-1", "campaign-2")).toBe(false);
    expect(hasConsistentDraftCampaign(undefined, "campaign-1")).toBe(false);
    expect(hasConsistentDraftCampaign("campaign-1", null)).toBe(false);
    expect(hasConsistentDraftCampaign("../campaign-1", "../campaign-1")).toBe(false);
    expect(hasConsistentDraftCampaign({}, "campaign-1")).toBe(false);
  });
});


describe("lead and campaign lifecycle validation", () => {
  it.each(["new", "reviewing", "qualified", "contacted", "onboarded", "rejected"])(
    "accepts supported lead status %s", (status) => {
      expect(canTransitionLeadStatus(status, false)).toBe(true);
    },
  );

  it.each([undefined, null, "", "sent", "archived", "NEW", 1, {}, []])(
    "rejects unsupported or malformed lead status %j", (status) => {
      expect(canTransitionLeadStatus(status, false)).toBe(false);
    },
  );

  it("blocks contacted status for suppressed leads but does not over-block unrelated lifecycle statuses", () => {
    expect(canTransitionLeadStatus("contacted", true)).toBe(false);
    expect(canTransitionLeadStatus("qualified", true)).toBe(true);
    expect(canTransitionLeadStatus("rejected", true)).toBe(true);
  });

  it.each(["draft", "active", "paused", "completed"])(
    "accepts supported campaign status %s", (status) => {
      expect(isValidCampaignStatus(status)).toBe(true);
    },
  );

  it.each([undefined, null, "", "sent", "archived", "ACTIVE", 1, {}, []])(
    "rejects unsupported or malformed campaign status %j", (status) => {
      expect(isValidCampaignStatus(status)).toBe(false);
    },
  );
});


describe("pagination cursor path validation", () => {
  it("accepts only this user's organisation membership document as an organisation cursor", () => {
    expect(isValidOrganisationPageToken("organisations/org-1/members/user-1", "user-1")).toBe(true);
    expect(isValidOrganisationPageToken("organisations/org-1/members/user-2", "user-1")).toBe(false);
    expect(isValidOrganisationPageToken("organisations/org-1/campaigns/campaign-1", "user-1")).toBe(false);
    expect(isValidOrganisationPageToken("organisations/../members/user-1", "user-1")).toBe(false);
    expect(isValidOrganisationPageToken("organisations/org-1/members/user-1/extra", "user-1")).toBe(false);
    expect(isValidOrganisationPageToken("x".repeat(513), "user-1")).toBe(false);
    expect(isValidOrganisationPageToken(123, "user-1")).toBe(false);
  });

  it("binds collection cursors to the requested organisation and collection", () => {
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/campaigns/campaign-1", "org-1", "campaigns")).toBe(true);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/leads/lead-1", "org-1", "leads")).toBe(true);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/outreachDrafts/draft-1", "org-1", "outreachDrafts")).toBe(true);
    expect(isValidOrganisationCollectionPageToken("organisations/org-2/leads/lead-1", "org-1", "leads")).toBe(false);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/leads/lead-1", "org-1", "campaigns")).toBe(false);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/members/user-1", "org-1", "leads")).toBe(false);
    expect(isValidOrganisationCollectionPageToken("organisations/org-1/leads/../other", "org-1", "leads")).toBe(false);
    expect(isValidOrganisationCollectionPageToken("x".repeat(513), "org-1", "leads")).toBe(false);
    expect(isValidOrganisationCollectionPageToken(null, "org-1", "leads")).toBe(false);
  });
});


describe("ordered pagination cursor timestamp validation", () => {
  it("accepts finite Firestore-like timestamp values", () => {
    expect(isValidFirestoreTimestamp({ toMillis: () => 1234 })).toBe(true);
    expect(isValidFirestoreTimestamp({ toMillis: () => 0 })).toBe(true);
  });

  it.each([undefined, null, "", "2026-01-01", 1234, new Date(), {}, { toMillis: () => Number.NaN }, { toMillis: () => Infinity }, { toMillis: () => { throw new Error("malformed timestamp"); } }])(
    "rejects malformed stored cursor timestamps %#", (value) => {
      expect(isValidFirestoreTimestamp(value)).toBe(false);
    },
  );
});


describe("server-side rate-limit evaluation", () => {
  it("starts a new fixed window and counts the first request", () => {
    expect(evaluateRateLimit(undefined, 1000, 3, 60000)).toEqual({ allowed: true, invalidState: false, nextState: { windowStartedAtMs: 1000, count: 1 }, retryAfterMs: 0 });
  });
  it("allows requests up to the limit and rejects the next request", () => {
    expect(evaluateRateLimit({ windowStartedAtMs: 1000, count: 1 }, 2000, 2, 60000).nextState).toEqual({ windowStartedAtMs: 1000, count: 2 });
    expect(evaluateRateLimit({ windowStartedAtMs: 1000, count: 2 }, 2000, 2, 60000)).toEqual({ allowed: false, invalidState: false, nextState: null, retryAfterMs: 59000 });
  });
  it("resets after the window expires", () => {
    expect(evaluateRateLimit({ windowStartedAtMs: 1000, count: 2 }, 61000, 2, 60000).nextState).toEqual({ windowStartedAtMs: 61000, count: 1 });
  });
  it("fails closed when malformed persisted quota accessors throw", () => {
    const throwingStart = Object.defineProperty({ count: 1 }, "windowStartedAtMs", {
      enumerable: true,
      get() { throw new Error("malformed legacy quota start"); },
    });
    const throwingCount = Object.defineProperty({ windowStartedAtMs: 1000 }, "count", {
      enumerable: true,
      get() { throw new Error("malformed legacy quota count"); },
    });
    for (const state of [throwingStart, throwingCount]) {
      expect(evaluateRateLimit(state, 2000, 3, 60000)).toEqual({
        allowed: false,
        invalidState: true,
        nextState: null,
        retryAfterMs: 0,
      });
    }
  });
  it("does not reset early when the local clock moves backwards", () => {
    expect(evaluateRateLimit({ windowStartedAtMs: 10000, count: 2 }, 9000, 2, 60000)).toEqual({ allowed: false, invalidState: false, nextState: null, retryAfterMs: 61000 });
  });
  it("bounds retry duration when a large clock rollback would exceed the safe-integer range", () => {
    expect(evaluateRateLimit(
      { windowStartedAtMs: Number.MAX_SAFE_INTEGER, count: 2 },
      0,
      2,
      Number.MAX_SAFE_INTEGER,
    )).toEqual({
      allowed: false,
      invalidState: false,
      nextState: null,
      retryAfterMs: Number.MAX_SAFE_INTEGER,
    });
  });
  it("keeps the original window and increments the existing counter when the clock moves backwards below the quota", () => {
    expect(evaluateRateLimit({ windowStartedAtMs: 10000, count: 1 }, 9000, 3, 60000)).toEqual({
      allowed: true,
      invalidState: false,
      nextState: { windowStartedAtMs: 10000, count: 2 },
      retryAfterMs: 0,
    });
  });
  it("starts a fresh window exactly at the prior window boundary", () => {
    expect(evaluateRateLimit({ windowStartedAtMs: 1000, count: 3 }, 61000, 3, 60000).nextState).toEqual({
      windowStartedAtMs: 61000,
      count: 1,
    });
  });
  it.each([
    [Number.NaN, 3, 60000],
    [-1, 3, 60000],
    [1000, 0, 60000],
    [1000, 1.5, 60000],
    [1000, Number.MAX_SAFE_INTEGER + 1, 60000],
    [1000, 3, 0],
    [1000, 3, 1.5],
    [1000, 3, Number.POSITIVE_INFINITY],
    [1000.5, 3, 60000],
  ])("fails closed on invalid evaluator configuration (now=%j, max=%j, window=%j)", (now, max, window) => {
    const result = evaluateRateLimit(undefined, now, max, window);
    expect(result).toEqual({ allowed: false, invalidState: true, nextState: null, retryAfterMs: 0 });
  });
  it.each([{ windowStartedAtMs: "1000", count: 1 }, { windowStartedAtMs: 1000, count: 0 }, { windowStartedAtMs: 1000, count: -1 }, { windowStartedAtMs: 1000, count: 1.5 }, { windowStartedAtMs: 1000, count: Number.POSITIVE_INFINITY }, { windowStartedAtMs: 1000, count: Number.MAX_SAFE_INTEGER + 1 }, { windowStartedAtMs: 1000, count: 4 }, { windowStartedAtMs: Number.NaN, count: 1 }, { windowStartedAtMs: -1, count: 1 }, { windowStartedAtMs: Number.MAX_SAFE_INTEGER + 1, count: 1 }, { windowStartedAtMs: 1000.5, count: 1 }, []])("fails closed on malformed persisted state", (state) => {
    expect(evaluateRateLimit(state, 2000, 3, 60000).invalidState).toBe(true);
    expect(evaluateRateLimit(state, 2000, 3, 60000).allowed).toBe(false);
  });

  it("rejects inherited quota fields while accepting explicit own fields", () => {
    const inheritedBoth = Object.create({ windowStartedAtMs: 1000, count: 1 }) as Record<string, unknown>;
    const inheritedCount = Object.assign(Object.create({ count: 1 }), { windowStartedAtMs: 1000 });
    const inheritedStart = Object.assign(Object.create({ windowStartedAtMs: 1000 }), { count: 1 });
    const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
      windowStartedAtMs: 1000,
      count: 1,
    });

    for (const state of [inheritedBoth, inheritedCount, inheritedStart]) {
      expect(evaluateRateLimit(state, 2000, 3, 60000)).toEqual({
        allowed: false,
        invalidState: true,
        nextState: null,
        retryAfterMs: 0,
      });
    }
    expect(evaluateRateLimit(nullPrototype, 2000, 3, 60000)).toEqual({
      allowed: true,
      invalidState: false,
      nextState: { windowStartedAtMs: 1000, count: 2 },
      retryAfterMs: 0,
    });
  });
});


describe("adversarial timestamp method failures", () => {
  it("fails closed when timestamp conversion methods throw or return unsafe values", () => {
    expect(isValidFirestoreTimestamp({ toMillis: () => { throw new Error("corrupt timestamp"); } })).toBe(false);
    expect(isValidFirestoreTimestamp({ toMillis: () => Number.NaN })).toBe(false);
    expect(isValidFirestoreTimestamp({ toMillis: () => Number.POSITIVE_INFINITY })).toBe(false);
    expect(isValidFirestoreTimestamp({ toMillis: () => Number.MAX_SAFE_INTEGER + 1 })).toBe(false);
    expect(safeTimestampToIso({ toDate: () => { throw new Error("corrupt timestamp"); } })).toBeNull();
    expect(safeTimestampToIso({ toDate: () => new Date(Number.NaN) })).toBeNull();
  });
});

describe("Firestore timestamp cursor validation", () => {
  it("accepts finite safe-range millisecond timestamps including sub-millisecond precision", () => {
    expect(isValidFirestoreTimestamp({ toMillis: () => 1_700_000_000_000 })).toBe(true);
    expect(isValidFirestoreTimestamp({ toMillis: () => 0 })).toBe(true);
    expect(isValidFirestoreTimestamp({ toMillis: () => 1_700_000_000_000.123 })).toBe(true);
  });

  it.each([
    undefined,
    null,
    {},
    { toMillis: 1 },
    Object.defineProperty({}, "toMillis", { get() { throw new Error("invalid timestamp getter"); } }),
    { toMillis: () => Number.NaN },
    { toMillis: () => Number.POSITIVE_INFINITY },
    { toMillis: () => Number.NEGATIVE_INFINITY },
    { toMillis: () => Number.MAX_SAFE_INTEGER + 1 },
    { toMillis: () => { throw new Error("invalid timestamp"); } },
  ])("rejects malformed timestamp-like values: %j", (value) => {
    expect(isValidFirestoreTimestamp(value)).toBe(false);
  });
});


describe("rate-limit document key isolation", () => {
  it("uses stable 64-character SHA-256 keys", () => {
    const key = createRateLimitDocumentId("org-1", "user-1", "updateLeadNotes");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(createRateLimitDocumentId("org-1", "user-1", "updateLeadNotes")).toBe(key);
  });

  it("isolates organisation, user, and operation dimensions without delimiter ambiguity", () => {
    const baseline = createRateLimitDocumentId("org-1", "user:part", "updateLeadNotes");
    expect(createRateLimitDocumentId("org-2", "user:part", "updateLeadNotes")).not.toBe(baseline);
    expect(createRateLimitDocumentId("org-1", "other-user", "updateLeadNotes")).not.toBe(baseline);
    expect(createRateLimitDocumentId("org-1", "user:part", "createLead")).not.toBe(baseline);
    expect(createRateLimitDocumentId("org-1", "user", "part:updateLeadNotes")).not.toBe(baseline);
  });
});


describe("callable rate-limit coverage guard", () => {
  it("requires every exported callable to consume a server-side rate limit", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const callableStarts = [...source.matchAll(/export const ([A-Za-z][A-Za-z0-9]*) = onCall\(/g)];
    expect(callableStarts.length).toBeGreaterThan(0);

    for (let index = 0; index < callableStarts.length; index += 1) {
      const start = callableStarts[index].index ?? 0;
      const end = callableStarts[index + 1]?.index ?? source.length;
      const name = callableStarts[index][1];
      const handlerSource = source.slice(start, end);
      const uidGuardIndex = handlerSource.indexOf("requireUid(request.auth?.uid)");
      const limiterCallIndex = handlerSource.search(/consume(?:Transactional|Read)RateLimit/);
      expect(
        uidGuardIndex,
        `callable ${name} must require an authenticated UID`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        uidGuardIndex,
        `callable ${name} must authenticate before consuming quota`,
      ).toBeLessThan(limiterCallIndex);
      const limiterCall = handlerSource.match(/consume(?:Transactional|Read)RateLimit[^;]+;/s)?.[0] ?? "";
      expect(
        limiterCall,
        `callable ${name} must enforce a server-side rate limit`,
      ).not.toBe("");
      expect(
        limiterCall,
        `callable ${name} must use its own operation key`,
      ).toContain(`"${name}"`);
    }
  });
});

describe("contact-review lifecycle truth table", () => {
  it.each([
    [false, undefined, true],
    [false, "cleared", true],
    [false, "pending", false],
    [false, "blocked", false],
    [false, null, false],
    [false, "unknown", false],
    [false, 0, false],
    [true, undefined, false],
    [true, "cleared", false],
    [true, "pending", false],
    [true, "blocked", false],
    [undefined, "cleared", false],
    [null, undefined, false],
    ["false", "cleared", false],
    [0, "cleared", false],
  ])("allows contact only for an explicit cleared state (restriction=%j, review=%j)", (doNotContact, reviewStatus, expected) => {
    expect(canMarkLeadContacted(doNotContact, reviewStatus)).toBe(expected);
    expect(canCreateServerOutreachDraft(doNotContact, reviewStatus)).toBe(expected);
  });

  it("never normalises malformed or contradictory legacy restrictions to cleared", () => {
    for (const malformedRestriction of [undefined, null, "false", 0, 1, {}, []]) {
      expect(normaliseContactReviewStatus(malformedRestriction, "cleared")).toBe("pending");
    }
    expect(normaliseContactReviewStatus(true, "cleared")).toBe("blocked");
    expect(normaliseContactReviewStatus(false, "pending")).toBe("pending");
    expect(normaliseContactReviewStatus(false, "blocked")).toBe("blocked");
    expect(normaliseContactReviewStatus(false, "cleared")).toBe("cleared");
    expect(normaliseContactReviewStatus(false, undefined)).toBe("cleared");
  });
});
