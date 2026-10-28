/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  googleSignIn: vi.fn(),
  register: vi.fn(),
  signOut: vi.fn(),
  authListener: vi.fn(),
  currentUser: null as unknown,
  api: {
    listMyOrganisations: vi.fn(), createOrganisation: vi.fn(), updateOrganisationSettings: vi.fn(), previewOrganisationOffboarding: vi.fn(), addOrganisationMember: vi.fn(), removeOrganisationMember: vi.fn(), updateOrganisationMemberRole: vi.fn(), listOrganisationMembers: vi.fn(), listOrganisationSecurityAuditEvents: vi.fn(), createCampaign: vi.fn(), updateCampaignStatus: vi.fn(), updateCampaignDetails: vi.fn(),
    listCampaigns: vi.fn(), getCampaignFunnelSummary: vi.fn(), getLeadSourceFunnelSummary: vi.fn(), getOnboardingCohortSummary: vi.fn(), getOnboardingCohortCoverage: vi.fn(), getContactReviewQueueSummary: vi.fn(), getLeadCompletenessSummary: vi.fn(), getFullCampaignReadinessSummary: vi.fn(), getOpenLeadAgingSummary: vi.fn(), getLeadActivityTimeline: vi.fn(), getOrganisationPlanUsage: vi.fn(), getOrganisationPlanUsageReconciliation: vi.fn(), listLeads: vi.fn(), createLead: vi.fn(), importLeads: vi.fn(), updateLeadContact: vi.fn(), updateLeadStatus: vi.fn(), bulkUpdateLeadStatus: vi.fn(),
    updateLeadNotes: vi.fn(), updateLeadFollowUpDate: vi.fn(), setLeadSuppression: vi.fn(), createOutreachDraft: vi.fn(), suggestOutreachDraft: vi.fn(), listOutreachDrafts: vi.fn(),
    updateOutreachDraft: vi.fn(), deleteOutreachDraft: vi.fn(),
  },
}));

vi.mock("./firebaseClient", () => ({ firebaseClient: { auth: {}, functions: {} } }));
vi.mock("./backendApi", () => ({
  createFirebaseCallableInvoker: vi.fn(() => vi.fn()),
  createGrowthEngineApi: vi.fn(() => mocks.api),
}));
vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: mocks.register,
  GoogleAuthProvider: class { providerId = "google.com"; },
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => { mocks.authListener(); callback(mocks.currentUser); return () => undefined; },
  signInWithEmailAndPassword: mocks.signIn,
  signInWithPopup: mocks.googleSignIn,
  signOut: mocks.signOut,
}));
import CloudWorkspace from "./CloudWorkspace";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.currentUser = null;
  mocks.signIn.mockResolvedValue({}); mocks.googleSignIn.mockResolvedValue({}); mocks.register.mockResolvedValue({});
  mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [] });
  mocks.api.listOrganisationMembers.mockResolvedValue({
    organisationId: "org-1",
    members: [{ uid: "owner-uid", email: "owner@example.test", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" }],
    hasMoreMembers: false,
    nextPageToken: null,
    scope: "organisation_member_roster",
  });
  mocks.api.listOrganisationSecurityAuditEvents.mockResolvedValue({
    organisationId: "org-1",
    events: [],
    hasMoreEvents: false,
    nextPageToken: null,
    scope: "organisation_security_audit",
  });
  mocks.api.previewOrganisationOffboarding.mockResolvedValue({
    complete: true,
    destructiveActionPerformed: false,
    maxRecordsPerCategory: 1000,
    categories: [
      { category: "leads", status: "complete", exactCount: 12, observedCount: 12 },
      { category: "securityAuditEvents", status: "complete", exactCount: 4, observedCount: 4 },
    ],
  });
  mocks.api.listCampaigns.mockResolvedValue({ campaigns: [], hasMoreCampaigns: false, nextPageToken: null });
  mocks.api.getCampaignFunnelSummary.mockResolvedValue({
    organisationId: "org-1", campaignId: "campaign-1", totalLeadCount: 120,
    qualifiedLeadCount: 30, contactedLeadCount: 12, onboardedLeadCount: 4,
    qualifiedRatePercent: 25, onboardedRatePercent: 3.3, scope: "all_stored_campaign_leads",
  });
  mocks.api.getOrganisationPlanUsageReconciliation.mockResolvedValue({
    organisationId: "org-1",
    status: "present",
    actual: { campaigns: 2, leads: 42, members: 3 },
    stored: { campaigns: 2, leads: 40, members: 3, monthlyAiSuggestions: 7, aiUsagePeriod: "2026-10" },
    mismatchedMetrics: ["leads"],
    aiUsageReviewRequired: true,
    currentAiUsagePeriod: "2026-10",
    notes: ["Stored resource counters differ from current document counts.", "Historical AI suggestion usage cannot be inferred from resource counts."],
    destructiveActionPerformed: false,
  });
  mocks.api.getOrganisationPlanUsage.mockResolvedValue({
    organisationId: "org-1",
    status: "authoritative",
    plan: { id: "pilot", displayName: "Pilot", limits: { campaigns: 10, leads: 500, members: 5, monthlyAiSuggestions: 50 } },
    usage: { campaigns: 2, leads: 42, members: 3, monthlyAiSuggestions: 7 },
    remaining: { campaigns: 8, leads: 458, members: 2, monthlyAiSuggestions: 43 },
    aiUsagePeriod: "2026-10",
    message: "Usage is server-maintained. Monthly AI suggestions reset by UTC calendar month; other counters are lifetime totals.",
  });
  mocks.api.getOnboardingCohortSummary.mockResolvedValue({
    organisationId: "org-1",
    cohorts: Array.from({ length: 12 }, (_, index) => ({ month: `2025-${String(index + 1).padStart(2, "0")}`, onboardedLeadCount: index })),
    scope: "first_onboarding_timestamp",
    windowMonths: 12,
    attributionNote: "Counts use the first server-recorded onboarding timestamp. Legacy leads already onboarded before timestamp capture may be excluded; source labels remain self-declared.",
  });
  mocks.api.getLeadSourceFunnelSummary.mockResolvedValue({
    organisationId: "org-1",
    sourceSummaries: [
      { source: "linkedin_csv", totalLeadCount: 10, qualifiedLeadCount: 3, onboardedLeadCount: 1, qualifiedRatePercent: 30, onboardedRatePercent: 10 },
      { source: "unknown", totalLeadCount: 2, qualifiedLeadCount: 0, onboardedLeadCount: 0, qualifiedRatePercent: 0, onboardedRatePercent: 0 },
    ],
    scope: "all_stored_organisation_leads",
    attributionNote: "Source values are self-declared; unknown includes missing and unrecognised legacy values.",
  });
  mocks.api.listLeads.mockResolvedValue({ leads: [], hasMoreLeads: false, nextPageToken: null });
  mocks.api.getLeadActivityTimeline.mockResolvedValue({
    organisationId: "org-1", leadId: "lead-history",
    activities: [
      { id: "activity-2", message: "Lead status changed to qualified", createdAt: "2026-10-24T10:00:00.000Z" },
      { id: "activity-1", message: "Lead created: History Painter", createdAt: "2026-10-23T10:00:00.000Z" },
    ],
    scope: "latest_20_lead_activity_events",
    hasMoreHistory: false,
  });
  mocks.api.listOutreachDrafts.mockResolvedValue({ drafts: [] });
  mocks.api.createOrganisation.mockResolvedValue({ organisationId: "org-new", name: "New Org", role: "owner" });
  mocks.api.updateOrganisationSettings.mockImplementation(async ({ organisationId, name }) => ({ organisationId, name }));
  mocks.api.addOrganisationMember.mockResolvedValue({ organisationId: "org-1", uid: "member-1", role: "member", added: true });
  mocks.api.updateCampaignDetails.mockImplementation(async ({ campaignId, name, brand, category, location, goal }) => ({ campaignId, name, brand, category, location, goal }));
  mocks.api.createCampaign.mockResolvedValue({ campaignId: "campaign-new", status: "active" });
  mocks.api.updateCampaignStatus.mockImplementation(async ({ campaignId, status }) => ({ campaignId, status }));
  mocks.api.updateCampaignDetails.mockImplementation(async (payload) => payload);
  mocks.api.createLead.mockResolvedValue({ leadId: "lead-new", status: "new" });
  mocks.api.importLeads.mockResolvedValue({ organisationId: "org-1", campaignId: "campaign-1", received: 2, imported: 2, duplicatesSkipped: 0, leads: [{ leadId: "lead-csv-1", businessName: "Northside Painting" }, { leadId: "lead-csv-2", businessName: "City Decorators" }], sent: false, messageSentByThisAction: false });
  mocks.api.setLeadSuppression.mockResolvedValue({ leadId: "lead-1", doNotContact: true });
  mocks.api.updateLeadFollowUpDate.mockImplementation(async ({ leadId, followUpDate }) => ({ leadId, followUpDate }));
  mocks.api.createOutreachDraft.mockResolvedValue({ draftId: "draft-new", leadId: "lead-1", status: "draft", sent: false });
  mocks.api.suggestOutreachDraft.mockResolvedValue({ subject: "Would you like to join our provider network?", body: "May we share details about joining?\\n\\nDRAFT ONLY — NOT SENT.", sent: false });
});

describe("cloud authentication gate", () => {
  it("shows email/password sign-in and explains the dedicated project boundary", () => {
    render(<CloudWorkspace />);
    expect(screen.getByRole("heading", { name: "Sign in to Growth Engine" })).toBeTruthy();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByText(/not production AnyTrader/i)).toBeTruthy();
  });

  it("submits sign-in credentials through Firebase Auth", async () => {
    render(<CloudWorkspace />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "pilot@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "testing-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith({}, "pilot@example.test", "testing-password"));
  });

  it("starts Google sign-in through Firebase Auth", async () => {
    render(<CloudWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(mocks.googleSignIn).toHaveBeenCalledWith({}, { providerId: "google.com" }));
  });

  it("loads only the selected organisation's cloud data after authentication", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null }] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{ id: "lead-1", campaignId: "campaign-1", businessName: "Synthetic Painting Co", category: "Painters", location: "Manchester", website: "", email: "", phone: "", source: "manual", status: "new", score: 40, scoreReasons: [], notes: "", doNotContact: false, contactRestrictionVerified: true, createdAt: null }] });
    render(<CloudWorkspace />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Provider acquisition workspace" })).toBeTruthy());
    expect(await screen.findByText("Pilot Workspace · owner")).toBeTruthy();
    expect(await screen.findByText("Synthetic Painting Co")).toBeTruthy();
    expect(mocks.api.listLeads).toHaveBeenCalledWith({ organisationId: "org-1" });
    fireEvent.change(screen.getByLabelText("Notes for Synthetic Painting Co"), { target: { value: "Call after reviewing provider requirements." } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() => expect(mocks.api.updateLeadNotes).toHaveBeenCalledWith({ organisationId: "org-1", leadId: "lead-1", notes: "Call after reviewing provider requirements." }));
  });


  it("does not let a stale tenant response replace the newly selected organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "First Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "member" },
      ],
      hasMoreOrganisations: false,
    });

    let resolveFirstTenant!: (value: { leads: any[] }) => void;
    const firstTenantLeads = new Promise<{ leads: any[] }>((resolve) => { resolveFirstTenant = resolve; });
    const lead = (id: string, businessName: string) => ({
      id, campaignId: "campaign-1", businessName, category: "Painters", location: "Manchester",
      website: "", email: "", phone: "", source: "manual", status: "new", score: 20,
      scoreReasons: [], notes: "", doNotContact: false, contactRestrictionVerified: true, createdAt: null,
    });
    mocks.api.listLeads.mockImplementation(({ organisationId }: { organisationId: string }) =>
      organisationId === "org-1" ? firstTenantLeads : Promise.resolve({ leads: [lead("lead-2", "Second Tenant Lead")] })
    );

    render(<CloudWorkspace />);
    await waitFor(() => expect(mocks.api.listLeads).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    expect(await screen.findByText("Second Tenant Lead")).toBeTruthy();

    resolveFirstTenant({ leads: [lead("lead-1", "First Tenant Secret Lead")] });
    await waitFor(() => expect(screen.queryByText("First Tenant Secret Lead")).toBeNull());
    expect(screen.getByText("Second Tenant Lead")).toBeTruthy();
  });


  it("clears the previous organisation's records immediately when switching workspaces", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "First Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "member" },
      ],
      hasMoreOrganisations: false,
    });
    const firstLead = {
      id: "lead-1", campaignId: "campaign-1", businessName: "First Tenant Private Lead",
      category: "Painters", location: "Manchester", website: "", email: "", phone: "",
      source: "manual", status: "new", score: 20, scoreReasons: [], notes: "First tenant saved note",
      doNotContact: false, contactRestrictionVerified: true, createdAt: null,
    };
    let resolveSecondTenant!: (value: { leads: typeof firstLead[] }) => void;
    const secondTenantLead = { ...firstLead, businessName: "Second Tenant Private Lead", notes: "Second tenant saved note" };
    const secondTenantLeads = new Promise<{ leads: typeof firstLead[] }>((resolve) => { resolveSecondTenant = resolve; });
    mocks.api.listLeads.mockImplementation(({ organisationId }: { organisationId: string }) =>
      organisationId === "org-1" ? Promise.resolve({ leads: [firstLead] }) : secondTenantLeads
    );
    mocks.api.listCampaigns
      .mockResolvedValueOnce({ campaigns: [{
        id: "campaign-private", name: "First Tenant Private Campaign", brand: "AnyTrader",
        category: "Painters", location: "Manchester", goal: "Recruit", status: "active", createdAt: null,
      }] })
      .mockResolvedValueOnce({ campaigns: [] });

    render(<CloudWorkspace />);
    expect(await screen.findByText("First Tenant Private Lead")).toBeTruthy();
    expect((await screen.findAllByText("First Tenant Private Campaign")).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Notes for First Tenant Private Lead"), { target: { value: "Unsaved first tenant note" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select First Tenant Private Lead for bulk status update" }));
    expect(screen.getByText("1/25 selected; 1 match current filters. Bulk updates are all-or-nothing; selecting “contacted” is blocked if any selected lead has an unresolved contact restriction.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    expect(screen.getByText("0/25 selected; 0 match current filters. Bulk updates are all-or-nothing; selecting “contacted” is blocked if any selected lead has an unresolved contact restriction.")).toBeTruthy();
    expect(screen.queryByText("First Tenant Private Lead")).toBeNull();
    expect(screen.queryByText("First Tenant Private Campaign")).toBeNull();

    resolveSecondTenant({ leads: [secondTenantLead] });
    expect(await screen.findByText("Second Tenant Private Lead")).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("Notes for Second Tenant Private Lead") as HTMLTextAreaElement).value).toBe("Second tenant saved note"));
  });


  it("loads additional campaign pages without replacing the first page", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    const campaign = (id: string, name: string) => ({
      id, name, brand: "AnyTrader", category: "Painters", location: "Manchester",
      goal: "Recruit providers", status: "active", createdAt: null,
    });
    mocks.api.listCampaigns
      .mockResolvedValueOnce({
        campaigns: [campaign("campaign-1", "First Campaign")],
        hasMoreCampaigns: true,
        nextPageToken: "organisations/org-1/campaigns/campaign-1",
      })
      .mockResolvedValueOnce({
        campaigns: [campaign("campaign-2", "Second Campaign")],
        hasMoreCampaigns: false,
        nextPageToken: null,
      });
    render(<CloudWorkspace />);
    expect((await screen.findAllByText("First Campaign")).length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByRole("button", { name: "Load more campaigns" }));
    expect((await screen.findAllByText("Second Campaign")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("First Campaign").length).toBeGreaterThan(0);
    await waitFor(() => expect(mocks.api.listCampaigns).toHaveBeenLastCalledWith({
      organisationId: "org-1",
      pageToken: "organisations/org-1/campaigns/campaign-1",
    }));
    expect(screen.queryByRole("button", { name: "Load more campaigns" })).toBeNull();
  });

  it("loads additional lead pages without replacing or duplicating the first page", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    const lead = (id: string, businessName: string) => ({
      id, campaignId: "campaign-1", businessName, category: "Painters", location: "Manchester",
      website: "", email: "", phone: "", source: "manual", status: "new", score: 20,
      scoreReasons: [], notes: "", doNotContact: false, contactRestrictionVerified: true, createdAt: null,
    });
    mocks.api.listLeads
      .mockResolvedValueOnce({ leads: [lead("lead-1", "First Page Painter")], hasMoreLeads: true, nextPageToken: "organisations/org-1/leads/lead-1" })
      .mockResolvedValueOnce({ leads: [lead("lead-1", "First Page Painter"), lead("lead-2", "Second Page Painter")], hasMoreLeads: false, nextPageToken: null });
    render(<CloudWorkspace />);
    expect(await screen.findByText("First Page Painter")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Load more leads" }));
    expect(await screen.findByText("Second Page Painter")).toBeTruthy();
    expect(screen.getAllByText("First Page Painter")).toHaveLength(1);
    await waitFor(() => expect(mocks.api.listLeads).toHaveBeenLastCalledWith({
      organisationId: "org-1", pageToken: "organisations/org-1/leads/lead-1",
    }));
    expect(screen.queryByRole("button", { name: "Load more leads" })).toBeNull();
  });

  it("loads additional draft pages without replacing or duplicating the first page", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    const draft = (id: string, subject: string) => ({
      id, leadId: "lead-1", campaignId: "campaign-1", subject, body: "Draft body", status: "draft",
      leadSuppressed: false, requiresReview: false, reviewReason: null, createdAt: null,
    });
    mocks.api.listOutreachDrafts
      .mockResolvedValueOnce({ drafts: [draft("draft-1", "First Page Draft")], hasMoreDrafts: true, nextPageToken: "organisations/org-1/outreachDrafts/draft-1" })
      .mockResolvedValueOnce({ drafts: [draft("draft-1", "First Page Draft"), draft("draft-2", "Second Page Draft")], hasMoreDrafts: false, nextPageToken: null });
    render(<CloudWorkspace />);
    expect(await screen.findByText("First Page Draft")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Load more drafts" }));
    expect(await screen.findByText("Second Page Draft")).toBeTruthy();
    expect(screen.getAllByText("First Page Draft")).toHaveLength(1);
    await waitFor(() => expect(mocks.api.listOutreachDrafts).toHaveBeenLastCalledWith({
      organisationId: "org-1", pageToken: "organisations/org-1/outreachDrafts/draft-1",
    }));
    expect(screen.queryByRole("button", { name: "Load more drafts" })).toBeNull();
  });

  it("allows an authenticated user to edit a draft without sending it", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [
      { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
      { organisationId: "org-2", name: "Second Workspace", role: "owner" },
    ] });
    mocks.api.listOutreachDrafts.mockResolvedValue({ drafts: [{ id: "draft-1", leadId: "lead-1", campaignId: "campaign-1", subject: "Initial subject", body: "Initial body", status: "draft", leadSuppressed: false, requiresReview: false, reviewReason: null, createdAt: null }] });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Draft subject"), { target: { value: "Updated subject" } });
    fireEvent.change(screen.getByLabelText("Draft body"), { target: { value: "Updated body for human review." } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.api.updateOutreachDraft).toHaveBeenCalledWith({ organisationId: "org-1", draftId: "draft-1", subject: "Updated subject", body: "Updated body for human review." }));
    expect(mocks.api.updateOutreachDraft).toHaveBeenCalledTimes(1);
  });

  it("labels newly created leads as pending review rather than a confirmed opt-out", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-pending", campaignId: "campaign-1", businessName: "Pending Painter", category: "Painters",
      location: "Manchester", website: "", email: "", phone: "", source: "manual", status: "new",
      score: 40, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false,
      contactReviewStatus: "pending", createdAt: null,
    }] });
    render(<CloudWorkspace />);
    await screen.findByText("Pending Painter");
    expect(screen.getByText("PENDING REVIEW")).toBeTruthy();
    expect(screen.queryByText("DO NOT CONTACT")).toBeNull();
    expect(screen.getByRole("button", { name: "Review & clear restriction" })).toBeTruthy();
    expect((screen.getByRole("button", { name: /create draft/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reuses the same manual lead idempotency key and payload after an uncertain failure", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{
      id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters",
      location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null,
    }] });
    mocks.api.createLead
      .mockRejectedValueOnce(new Error("Network request timed out"))
      .mockResolvedValueOnce({ leadId: "lead-retry", status: "new" });

    render(<CloudWorkspace />);
    const businessName = await screen.findByLabelText("Business name");
    fireEvent.change(businessName, { target: { value: "Retry-safe Painting Ltd" } });
    fireEvent.change(screen.getByLabelText("Source record ID (optional)"), { target: { value: "manual-directory-42" } });
    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));

    const retryButton = await screen.findByRole("button", { name: "Retry save (same request)" });
    expect((screen.getByLabelText("Business name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Campaign") as HTMLSelectElement).disabled).toBe(true);
    expect(retryButton).toBeTruthy();
    const firstPayload = mocks.api.createLead.mock.calls[0][0];
    expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(true);
    expect(firstPayload.idempotencyKey).toMatch(/^manual-lead-[A-Za-z0-9-]+$/);
    expect(firstPayload.businessName).toBe("Retry-safe Painting Ltd");
    expect(firstPayload.sourceRecordId).toBe("manual-directory-42");

    fireEvent.click(retryButton);
    await waitFor(() => expect(mocks.api.createLead).toHaveBeenCalledTimes(2));
    expect(mocks.api.createLead.mock.calls[1][0]).toEqual(firstPayload);
    await screen.findByText(/Lead saved securely to the selected organisation/);
    expect((screen.getByLabelText("Business name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Business name") as HTMLInputElement).disabled).toBe(false);
  });

  it("disables clearing a pending restriction for non-admin organisation roles", async () => {
    mocks.currentUser = { email: "member@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "member" }] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-pending-member", campaignId: "campaign-1", businessName: "Member Pending Painter", category: "Painters",
      location: "Manchester", website: "", email: "", phone: "", source: "manual", status: "new",
      score: 40, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false,
      contactReviewStatus: "pending", createdAt: null,
    }] });
    render(<CloudWorkspace />);
    await screen.findByText("Member Pending Painter");
    expect((screen.getByRole("button", { name: "Review & clear restriction" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("fails closed when a lead contact restriction cannot be verified", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-unverified", campaignId: "campaign-1", businessName: "Unverified Painter", category: "Painters",
      location: "Manchester", website: "", email: "", phone: "", source: "manual", status: "new",
      score: 40, scoreReasons: [], notes: "", doNotContact: false, contactRestrictionVerified: false, createdAt: null,
    }] });
    render(<CloudWorkspace />);
    await screen.findByText("Unverified Painter");
    expect(screen.getByText("REVIEW RESTRICTION")).toBeTruthy();
    expect((screen.getByRole("button", { name: /create draft/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Suppress" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("flags and locks an existing draft when its lead is suppressed", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listOutreachDrafts.mockResolvedValue({ drafts: [{ id: "draft-suppressed", leadId: "lead-1", campaignId: "campaign-1", subject: "Review me", body: "Draft body", status: "draft", leadSuppressed: true, requiresReview: true, reviewReason: "Lead is suppressed; do not contact.", createdAt: null }] });
    render(<CloudWorkspace />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Lead is suppressed; do not contact.");
    expect((screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(false);
  });


  it("loads additional organisation pages without replacing the first page", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations
      .mockResolvedValueOnce({
        organisations: [{ organisationId: "org-1", name: "First Workspace", role: "owner" }],
        hasMoreOrganisations: true,
        nextPageToken: "organisations/org-2/members/user-1",
      })
      .mockResolvedValueOnce({
        organisations: [{ organisationId: "org-2", name: "Second Workspace", role: "member" }],
        hasMoreOrganisations: false,
        nextPageToken: null,
      });
    render(<CloudWorkspace />);
    expect(await screen.findByText("First Workspace · owner")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Load more organisations" }));
    expect(await screen.findByText("Second Workspace · member")).toBeTruthy();
    expect(screen.getByText("First Workspace · owner")).toBeTruthy();
    await waitFor(() => expect(mocks.api.listMyOrganisations).toHaveBeenCalledWith("organisations/org-2/members/user-1"));
    expect(screen.queryByRole("button", { name: "Load more organisations" })).toBeNull();
  });

  it("downloads a blank CSV template with the optional source record ID column", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }], hasMoreOrganisations: false });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [
      { id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null },
    ], hasMoreCampaigns: false });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:csv-template");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });
    await screen.findAllByText("Painter pilot");
    fireEvent.click(screen.getByRole("button", { name: "Download CSV template" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toContain("text/csv");
    expect(await blob.text()).toContain("businessName,category,location,website,email,phone,sourceRecordId");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv-template");
  });

  it("previews a CSV and imports only after explicit confirmation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null }],
      hasMoreCampaigns: false,
    });

    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });
    await screen.findAllByText("Painter pilot");
    const file = new File([
      "businessName,category,location,email,phone,sourceRecordId\nNorthside Painting,Painters,Manchester,hello@northside.example,01610000001,linkedin-record-001\nCity Decorators,Decorators,Salford,team@citydecorators.example,01610000002,",
    ], "providers.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Source label (self-declared)"), { target: { value: "linkedin_csv" } });
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });

    expect(await screen.findByText("Northside Painting")).toBeTruthy();
    expect(screen.getByText("Preview — no records have been imported yet")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Source record ID" })).toBeTruthy();
    expect(screen.getByText("linkedin-record-001")).toBeTruthy();
    expect(mocks.api.importLeads).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Import 2 reviewed rows" }));
    await waitFor(() => expect(mocks.api.importLeads).toHaveBeenCalledTimes(1));
    const payload = mocks.api.importLeads.mock.calls[0][0];
    expect(payload.organisationId).toBe("org-1");
    expect(payload.campaignId).toBe("campaign-1");
    expect(payload.sourceLabel).toBe("linkedin_csv");
    expect(payload.idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(payload.leads).toEqual([
      { businessName: "Northside Painting", category: "Painters", location: "Manchester", website: "", email: "hello@northside.example", phone: "01610000001", sourceRecordId: "linkedin-record-001" },
      { businessName: "City Decorators", category: "Decorators", location: "Salford", website: "", email: "team@citydecorators.example", phone: "01610000002" },
    ]);
    expect(await screen.findByText(/2 imported, 0 duplicates skipped/i)).toBeTruthy();
    expect(screen.getByText(/nothing was sent/i)).toBeTruthy();
  });

  it("clears an unsubmitted CSV preview when switching organisations", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "First Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockImplementation(({ organisationId }: { organisationId: string }) => Promise.resolve({
      campaigns: organisationId === "org-1"
        ? [{ id: "campaign-1", name: "First Campaign", brand: "AnyTrader", category: "Painters", location: "Leeds", goal: "Recruit", status: "active", createdAt: null }]
        : [{ id: "campaign-2", name: "Second Campaign", brand: "AnyTrader", category: "Decorators", location: "York", goal: "Recruit", status: "active", createdAt: null }],
    }));
    mocks.api.listLeads.mockResolvedValue({ leads: [], hasMoreLeads: false, nextPageToken: null });

    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });
    await waitFor(() => expect((screen.getByLabelText("Import into campaign") as HTMLSelectElement).value).toBe("campaign-1"));
    const file = new File(["businessName,category\nPrivate CSV Lead,Painters"], "staged.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });
    expect(await screen.findByText("Private CSV Lead")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import 1 reviewed row" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    await waitFor(() => expect(screen.queryByText("Private CSV Lead")).toBeNull());
    expect(screen.queryByRole("button", { name: "Import 1 reviewed row" })).toBeNull();
    expect((screen.getByLabelText("Import into campaign") as HTMLSelectElement).value).toBe("campaign-2");
  });

  it("keeps a CSV retry bound to the original campaign and idempotency key after an uncertain failure", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
    });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [
        { id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null },
        { id: "campaign-2", name: "Decorator pilot", brand: "AnyTrader", category: "Decorators", location: "Salford", goal: "Recruit providers", status: "active", createdAt: null },
      ],
    });
    mocks.api.importLeads
      .mockRejectedValueOnce(new Error("Network request timed out"))
      .mockResolvedValueOnce({
        organisationId: "org-1",
        campaignId: "campaign-1",
        received: 1,
        imported: 1,
        duplicatesSkipped: 0,
        leads: [{ leadId: "lead-csv-retry-1", businessName: "Northside Painting" }],
        sent: false,
        messageSentByThisAction: false,
      });

    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });
    await screen.findAllByText("Painter pilot");
    const file = new File([
      "businessName,category\nNorthside Painting,Painters",
    ], "retry-providers.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText(/CSV file/i), { target: { files: [file] } });
    await screen.findByText("Northside Painting");

    const campaignSelect = screen.getByLabelText("Import into campaign") as HTMLSelectElement;
    expect(campaignSelect.value).toBe("campaign-1");
    const importButton = screen.getByRole("button", { name: "Import 1 reviewed row" });
    fireEvent.click(importButton);
    await screen.findByText("Network request timed out");
    const firstPayload = mocks.api.importLeads.mock.calls[0][0];

    expect(campaignSelect.disabled).toBe(true);
    expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(importButton);
    await waitFor(() => expect(mocks.api.importLeads).toHaveBeenCalledTimes(2));
    const retryPayload = mocks.api.importLeads.mock.calls[1][0];
    expect(retryPayload.campaignId).toBe(firstPayload.campaignId);
    expect(retryPayload.idempotencyKey).toBe(firstPayload.idempotencyKey);
    expect(retryPayload.leads).toEqual(firstPayload.leads);
    expect(await screen.findByText(/1 imported, 0 duplicates skipped/i)).toBeTruthy();
  });

  it("filters the lead directory by business details and status", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
    });
    const lead = (id: string, businessName: string, category: string, location: string, status: string) => ({
      id, campaignId: "campaign-1", businessName, category, location, website: "",
      email: "", phone: "", source: "manual", status, score: 20, scoreReasons: [],
      notes: "", doNotContact: true, contactRestrictionVerified: false,
      contactReviewStatus: "pending", createdAt: null,
    });
    const campaign = (id: string, name: string) => ({
      id, name, brand: "AnyTrader", category: "Painters", location: "Manchester",
      goal: "Recruit providers", status: "active", createdAt: null,
    });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [
      campaign("campaign-1", "Painter campaign"),
      campaign("campaign-2", "Decorator campaign"),
    ] });
    mocks.api.listLeads.mockResolvedValue({
      leads: [
        { ...lead("lead-1", "Northside Painting", "Painters", "Manchester", "new"), website: "https://northside.example", sourceRecordId: "provider-record-42", notes: "Urgent callback next week" },
        { ...lead("lead-2", "City Decorators", "Decorators", "Salford", "qualified"), campaignId: "campaign-2" },
      ],
    });

    render(<CloudWorkspace />);
    expect(await screen.findByText("Northside Painting")).toBeTruthy();
    expect(screen.getByText("City Decorators")).toBeTruthy();
    expect(screen.getByText("Showing 2 of 2 loaded leads.")).toBeTruthy();
    expect(screen.getByText("0 active filters")).toBeTruthy();
    expect(screen.getByLabelText("Search leads").getAttribute("placeholder")).toBe("Business, campaign, category, location, website, email, phone, source record ID, or internal notes");
    expect(screen.getByText("Source record ID: provider-record-42")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "northside.example" } });
    expect(screen.getByText("1 active filter")).toBeTruthy();
    expect(screen.getByText("Northside Painting")).toBeTruthy();
    expect(screen.queryByText("City Decorators")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "" } });

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "provider-record-42" } });
    expect(screen.getByText("Northside Painting")).toBeTruthy();
    expect(screen.queryByText("City Decorators")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "" } });

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "urgent callback" } });
    expect(screen.getByText("Northside Painting")).toBeTruthy();
    expect(screen.queryByText("City Decorators")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "" } });

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "salford" } });
    expect(screen.getByText("Showing 1 of 2 loaded leads.")).toBeTruthy();
    expect(screen.getByText("City Decorators")).toBeTruthy();
    expect(screen.queryByText("Northside Painting")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "" } });

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "Decorator campaign" } });
    expect(screen.getByText("City Decorators")).toBeTruthy();
    expect(screen.queryByText("Northside Painting")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter by category"), { target: { value: "Decorators" } });
    expect(screen.getByText("1 active filter")).toBeTruthy();
    expect(screen.getByText("City Decorators")).toBeTruthy();
    expect(screen.queryByText("Northside Painting")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((screen.getByLabelText("Filter by category") as HTMLSelectElement).value).toBe("all");
    expect(screen.getByText("0 active filters")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "qualified" } });
    expect(screen.getByText("City Decorators")).toBeTruthy();
    expect(screen.queryByText("Northside Painting")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "no-such-provider" } });
    expect(screen.getByText("2 active filters")).toBeTruthy();
    expect(screen.queryByText("City Decorators")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("No leads match these filters");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("0 active filters")).toBeTruthy();
    expect((screen.getByLabelText("Search leads") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Filter by status") as HTMLSelectElement).value).toBe("all");
    expect((screen.getByLabelText("Filter by campaign") as HTMLSelectElement).value).toBe("all");
    expect(screen.getByText("Showing 2 of 2 loaded leads.")).toBeTruthy();
    expect(screen.getByText("Northside Painting")).toBeTruthy();
    expect(screen.getByText("City Decorators")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter by campaign"), { target: { value: "campaign-2" } });
    expect(screen.getByText("City Decorators")).toBeTruthy();
    expect(screen.queryByText("Northside Painting")).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter by campaign"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "new" } });
    fireEvent.change(screen.getByLabelText("Filter by campaign"), { target: { value: "campaign-2" } });
    expect(screen.queryByText("Northside Painting")).toBeNull();
    expect(screen.queryByText("City Decorators")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("No leads match these filters");
  });

  it("offers account creation without weakening the required password length", () => {
    render(<CloudWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: /Need an account/i }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement).minLength).toBe(6);
  });

  it("retries uncertain organisation creation with the same key and unchanged name", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.createOrganisation.mockRejectedValueOnce(new Error("temporary network failure"));
    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });

    const nameInput = screen.getByPlaceholderText("e.g. AnyTrader pilot");
    fireEvent.change(nameInput, { target: { value: "Retry-safe workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Create organisation" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("temporary network failure"));
    expect((nameInput as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry save (same request)" }));
    await waitFor(() => expect(mocks.api.createOrganisation).toHaveBeenCalledTimes(2));
    expect(mocks.api.createOrganisation.mock.calls[1][0]).toEqual(mocks.api.createOrganisation.mock.calls[0][0]);
    expect(mocks.api.createOrganisation.mock.calls[0][0].idempotencyKey).toMatch(/^organisation-create-/);
  });

  it("retries uncertain campaign creation with the same key and unchanged campaign fields", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.createCampaign.mockRejectedValueOnce(new Error("temporary network failure"));
    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });

    fireEvent.change(screen.getAllByLabelText("Campaign name").at(-1)!, { target: { value: "Retry-safe campaign" } });
    fireEvent.click(screen.getByRole("button", { name: "Create campaign" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("temporary network failure"));
    expect((screen.getByLabelText("Campaign name") as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry save (same request)" }));
    await waitFor(() => expect(mocks.api.createCampaign).toHaveBeenCalledTimes(2));
    expect(mocks.api.createCampaign.mock.calls[1][0]).toEqual(mocks.api.createCampaign.mock.calls[0][0]);
    expect(mocks.api.createCampaign.mock.calls[0][0].idempotencyKey).toMatch(/^campaign-create-/);
  });

  it("retries uncertain draft creation with the same key and unchanged content", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [
      { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
      { organisationId: "org-2", name: "Second Workspace", role: "owner" },
    ] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-1", campaignId: "campaign-1", businessName: "Synthetic Painting Co", category: "Painters",
      location: "Manchester", website: "", email: "", phone: "", source: "manual", status: "new",
      score: 40, scoreReasons: [], notes: "", doNotContact: false, contactRestrictionVerified: true,
      contactReviewStatus: "cleared", createdAt: null,
    }] });
    mocks.api.createOutreachDraft
      .mockRejectedValueOnce(new Error("Network request timed out"))
      .mockResolvedValueOnce({ draftId: "draft-retry", leadId: "lead-1", status: "draft", sent: false });

    render(<CloudWorkspace />);
    const createButton = await screen.findByRole("button", { name: "Create draft" });
    fireEvent.click(createButton);
    const retryButton = await screen.findByRole("button", { name: "Retry draft (same request)" });
    expect(retryButton).toBeTruthy();
    expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(true);

    fireEvent.click(retryButton);
    await waitFor(() => expect(mocks.api.createOutreachDraft).toHaveBeenCalledTimes(2));
    expect(mocks.api.createOutreachDraft.mock.calls[1][0]).toEqual(mocks.api.createOutreachDraft.mock.calls[0][0]);
    expect(mocks.api.createOutreachDraft.mock.calls[0][0].idempotencyKey).toMatch(/^outreach-draft-/);
    expect(mocks.api.createOutreachDraft.mock.calls[0][0].body).toContain("DRAFT ONLY — NOT SENT.");
  });


  it("exports only the filtered loaded leads as a CSV download", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [
      { id: "campaign-1", name: "Painter campaign", brand: "AnyTrader", category: "Painters", location: "Edinburgh", goal: "Recruit", status: "active", createdAt: null },
    ] });
    mocks.api.listLeads.mockResolvedValue({ leads: [
      { id: "lead-1", campaignId: "campaign-1", businessName: "North Star Painters", category: "Painters", location: "Edinburgh", website: "", email: "hello@northstar.example", phone: "+44 131 555 0100", source: "csv", status: "new", score: 20, scoreReasons: [], notes: "private internal note", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending", contactReviewRevision: 0, createdAt: null },
      { id: "lead-2", campaignId: "campaign-1", businessName: "Southside Decorators", category: "Decorators", location: "Glasgow", website: "", email: "", phone: "", source: "manual", status: "qualified", score: 20, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending", contactReviewRevision: 0, createdAt: null },
    ] });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:test-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<CloudWorkspace />);
    expect(await screen.findByText("North Star Painters")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "north star" } });
    fireEvent.click(screen.getByRole("button", { name: "Export 1 filtered loaded lead (CSV)" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-export");
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByText(/Exported 1 filtered loaded lead/)).toBeTruthy();
  });


  it("provides safe manual research links for each campaign category and location", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }], hasMoreOrganisations: false });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [
      { id: "campaign-1", name: "Edinburgh painters", brand: "AnyTrader", category: "Painters", location: "Edinburgh", goal: "Recruit providers", status: "active", createdAt: null },
    ], hasMoreCampaigns: false });

    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });
    const maps = await screen.findByRole("link", { name: "Search Google Maps" });
    const linkedin = screen.getByRole("link", { name: "Search LinkedIn companies" });
    expect(maps.getAttribute("href")).toBe("https://www.google.com/maps/search/?api=1&query=Painters%20Edinburgh");
    expect(linkedin.getAttribute("href")).toBe("https://www.linkedin.com/search/results/companies/?keywords=Painters%20Edinburgh");
    expect(maps.getAttribute("target")).toBe("_blank");
    expect(maps.getAttribute("rel")).toContain("noopener");
    expect(linkedin.getAttribute("target")).toBe("_blank");
    expect(linkedin.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByText(/do not scrape, import, or contact results automatically/i)).toBeTruthy();
  });

  it("exports only selected loaded leads to a separate CSV", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }], hasMoreOrganisations: false });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null }], hasMoreCampaigns: false });
    mocks.api.listLeads.mockResolvedValue({ leads: [
      { id: "lead-1", campaignId: "campaign-1", businessName: "Selected Painting", category: "Painters", location: "Manchester", website: "", email: "selected@example.test", phone: "", source: "csv_import", sourceRecordId: "src-1", status: "new", score: 50, scoreReasons: [], notes: "", doNotContact: true, contactReviewStatus: "pending", contactRestrictionVerified: false, contactReviewRevision: 0, onboardedAt: null, createdAt: null },
      { id: "lead-2", campaignId: "campaign-1", businessName: "Unselected Painting", category: "Painters", location: "Manchester", website: "", email: "unselected@example.test", phone: "", source: "csv_import", status: "new", score: 50, scoreReasons: [], notes: "", doNotContact: true, contactReviewStatus: "pending", contactRestrictionVerified: false, contactReviewRevision: 0, onboardedAt: null, createdAt: null },
    ], hasMoreLeads: false });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:selected-leads");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });
    const checkbox = await screen.findByRole("checkbox", { name: "Select Selected Painting for bulk status update" });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Export selected (CSV)" }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain("Selected Painting");
    expect(csv).toContain("src-1");
    expect(csv).not.toContain("Unselected Painting");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:selected-leads");
    expect(await screen.findByText(/Exported 1 selected lead/i)).toBeTruthy();
  });


  it("exports only selected cloud leads that still match the active filters", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }], hasMoreOrganisations: false });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null }], hasMoreCampaigns: false });
    mocks.api.listLeads.mockResolvedValue({ leads: [
      { id: "lead-visible", campaignId: "campaign-1", businessName: "Visible Bulk Painter", category: "Painters", location: "Manchester", website: "", email: "visible@example.test", phone: "", source: "csv_import", status: "new", score: 50, scoreReasons: [], notes: "", doNotContact: true, contactReviewStatus: "pending", contactRestrictionVerified: false, contactReviewRevision: 0, createdAt: null },
      { id: "lead-hidden", campaignId: "campaign-1", businessName: "Hidden Bulk Decorator", category: "Decorators", location: "York", website: "", email: "hidden@example.test", phone: "", source: "csv_import", status: "new", score: 50, scoreReasons: [], notes: "", doNotContact: true, contactReviewStatus: "pending", contactReviewRevision: 0, createdAt: null },
    ], hasMoreLeads: false });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:filtered-selected-leads");
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Visible Bulk Painter for bulk status update" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Hidden Bulk Decorator for bulk status update" }));
    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "Visible Bulk Painter" } });
    fireEvent.click(screen.getByRole("button", { name: "Export selected (CSV)" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const csv = await (createObjectURL.mock.calls[0][0] as Blob).text();
    expect(csv).toContain("Visible Bulk Painter");
    expect(csv).not.toContain("Hidden Bulk Decorator");
    expect(screen.getByText(/Exported 1 selected lead\(s\) matching current filters/)).toBeTruthy();
  });

  it("opens a safe lead website in a protected new tab and suppresses unsafe URLs", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }], hasMoreOrganisations: false });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null }], hasMoreCampaigns: false });
    mocks.api.listLeads.mockResolvedValue({ leads: [
      { id: "lead-safe", campaignId: "campaign-1", businessName: "Safe Painting", category: "Painters", location: "Manchester", website: "safe-painting.example", email: "", phone: "", source: "csv_import", sourceRecordId: "src-1", status: "new", score: 50, scoreReasons: [], notes: "", doNotContact: true, contactReviewStatus: "pending", contactRestrictionVerified: false, contactReviewRevision: 0, onboardedAt: null, createdAt: null },
      { id: "lead-unsafe", campaignId: "campaign-1", businessName: "Unsafe Painting", category: "Painters", location: "Manchester", website: "javascript:alert(1)", email: "", phone: "", source: "csv_import", status: "new", score: 50, scoreReasons: [], notes: "", doNotContact: true, contactReviewStatus: "pending", contactRestrictionVerified: false, contactReviewRevision: 0, onboardedAt: null, createdAt: null },
    ], hasMoreLeads: false });
    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });
    const link = await screen.findByRole("link", { name: "Open website" });
    expect(link.getAttribute("href")).toBe("https://safe-painting.example/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getAllByText("Unsafe Painting").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Open website" })).toBe(link);
  });

  it("shows campaign performance metrics and marks paginated counts as partial", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [{ id: "campaign-1", name: "Edinburgh painter campaign", brand: "AnyTrader", category: "Painters", location: "Edinburgh", goal: "Recruit", status: "active", createdAt: null }],
      hasMoreCampaigns: true, nextPageToken: "next-campaign-page",
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [
        { id: "lead-1", campaignId: "campaign-1", businessName: "Qualified Painter", category: "Painters", location: "Edinburgh", website: "", email: "", phone: "", source: "manual", status: "qualified", score: 40, scoreReasons: [], notes: "", doNotContact: false, contactRestrictionVerified: true, contactReviewStatus: "cleared", contactReviewRevision: 0, createdAt: null },
        { id: "lead-2", campaignId: "campaign-1", businessName: "Pending Painter", category: "Painters", location: "Edinburgh", website: "", email: "", phone: "", source: "csv", status: "new", score: 20, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending", contactReviewRevision: 0, createdAt: null },
      ],
      hasMoreLeads: false, nextPageToken: null,
    });
    mocks.api.listOutreachDrafts.mockResolvedValue({
      drafts: [{ id: "draft-1", leadId: "lead-1", campaignId: "campaign-1", subject: "Review me", body: "Draft", status: "draft", leadSuppressed: false, requiresReview: true, reviewReason: "human review", createdAt: null }],
      hasMoreDrafts: false, nextPageToken: null,
    });
    render(<CloudWorkspace />);
    expect(await screen.findByRole("heading", { name: "Acquisition pipeline overview" })).toBeTruthy();
    expect(await screen.findByText("Partial view: more pages are available. Load more campaigns, leads and drafts to improve coverage before comparing campaign results.")).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Campaign counts from loaded records only" });
    expect(table.textContent).toContain("Edinburgh painter campaign");
    expect(table.textContent).toContain("2");
    expect(table.textContent).toContain("1");
    expect(table.textContent).toContain("Qualified");
    expect(table.textContent).toContain("Drafts needing review");
    const campaignChart = screen.getByRole("group", { name: "Loaded campaign funnel chart" });
    expect(campaignChart.textContent).toContain("currently loaded lead records only");
    expect(screen.getByRole("progressbar", { name: "Edinburgh painter campaign loaded leads" }).getAttribute("value")).toBe("2");
    expect(screen.getByRole("progressbar", { name: "Edinburgh painter campaign qualified leads" }).getAttribute("value")).toBe("1");
  });


  it("does not show a failed AI suggestion from a previous organisation in the active workspace", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [
      { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
      { organisationId: "org-2", name: "Second Workspace", role: "owner" },
    ] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-1", campaignId: "campaign-1", businessName: "North Star Painters", category: "Painters", location: "Edinburgh",
      website: "", email: "", phone: "", source: "manual", status: "new", score: 40,
      scoreReasons: [], notes: "", doNotContact: false, contactRestrictionVerified: true, createdAt: null,
    }] });
    let rejectSuggestion!: (reason: Error) => void;
    mocks.api.suggestOutreachDraft.mockImplementation(() => new Promise((_resolve, reject) => { rejectSuggestion = reject; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "AI draft suggestion" }));
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(true));

    // Simulate a workspace switch occurring outside the normal selector path
    // (for example, future navigation state restoration) before the request rejects.
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectSuggestion(new Error("stale organisation suggestion failed"));
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(false));
    expect(screen.queryByText(/stale organisation suggestion failed/i)).toBeNull();
  });

  it("silently discards a successful AI suggestion from a previous organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [
      { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
      { organisationId: "org-2", name: "Second Workspace", role: "owner" },
    ] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-1", campaignId: "campaign-1", businessName: "North Star Painters", category: "Painters", location: "Edinburgh",
      website: "", email: "", phone: "", source: "manual", status: "new", score: 40,
      scoreReasons: [], notes: "", doNotContact: false, contactRestrictionVerified: true, createdAt: null,
    }] });
    let resolveSuggestion!: (value: { subject: string; body: string; sent: false }) => void;
    mocks.api.suggestOutreachDraft.mockImplementation(() => new Promise((resolve) => { resolveSuggestion = resolve; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "AI draft suggestion" }));
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(true));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    resolveSuggestion({ subject: "Stale suggestion", body: "Must not be shown in another workspace. DRAFT ONLY — NOT SENT.", sent: false });
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(false));
    expect(screen.queryByDisplayValue("Stale suggestion")).toBeNull();
    expect(screen.queryByText(/active organisation changed while the AI suggestion was loading/i)).toBeNull();
  });

  it("generates an AI suggestion for an eligible lead and requires review before saving", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [
      { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
      { organisationId: "org-2", name: "Second Workspace", role: "owner" },
    ] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Painter campaign", brand: "AnyTrader", category: "Painters", location: "Edinburgh", goal: "Recruit providers", status: "active", createdAt: null }] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-1", campaignId: "campaign-1", businessName: "North Star Painters", category: "Painters", location: "Edinburgh",
      website: "", email: "private@example.test", phone: "+44 131 555 0100", source: "manual", status: "new", score: 40,
      scoreReasons: [], notes: "private internal note", doNotContact: false, contactRestrictionVerified: true,
      contactReviewStatus: "cleared", contactReviewRevision: 1, createdAt: null,
    }] });
    let resolveSuggestion!: (value: { subject: string; body: string; sent: false }) => void;
    mocks.api.suggestOutreachDraft.mockImplementation(() => new Promise((resolve) => { resolveSuggestion = resolve; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "AI draft suggestion" }));
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(true));
    resolveSuggestion({ subject: "Would you like to join our provider network?", body: "May we share details about joining?\\n\\nDRAFT ONLY — NOT SENT.", sent: false });
    expect(await screen.findByDisplayValue("Would you like to join our provider network?")).toBeTruthy();
    expect(mocks.api.suggestOutreachDraft).toHaveBeenCalledWith({ organisationId: "org-1", leadId: "lead-1" });
    expect(screen.getByText(/Check every claim and recipient eligibility/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(mocks.api.createOutreachDraft).toHaveBeenCalledTimes(1));
    const payload = mocks.api.createOutreachDraft.mock.calls[0][0];
    expect(payload.subject).toBe("Would you like to join our provider network?");
    expect(payload.body).toContain("DRAFT ONLY — NOT SENT.");
    expect(payload.idempotencyKey).toMatch(/^outreach-draft-/);
    expect(await screen.findByText("AI-assisted draft saved. Nothing was sent.")).toBeTruthy();
  });


  it("shows potential duplicate matches in the CSV preview without silently removing rows", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null }] });
    mocks.api.listLeads
      .mockResolvedValueOnce({ leads: [{
        id: "existing-1", campaignId: "campaign-1", businessName: "Northside Painting", category: "Painters", location: "Manchester",
        website: "", email: "hello@northside.example", phone: "", source: "manual", status: "new", score: 20,
        scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending",
        contactReviewRevision: 0, createdAt: null,
      }], hasMoreLeads: true, nextPageToken: "leads/org-1/lead-1" })
      .mockResolvedValueOnce({ leads: [], hasMoreLeads: false, nextPageToken: null });
    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });
    await screen.findByLabelText("Notes for Northside Painting");
    const file = new File([
      "businessName,category,location,email,phone\nNorthside Painting,Painters,Manchester,hello@northside.example,01610000001\nFresh Decorators,Decorators,Salford,team@fresh.example,01610000002",
    ], "providers.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });
    expect(await screen.findByText(/1 possible duplicate row/)).toBeTruthy();
    expect(screen.getByText("Duplicate preview is partial.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more leads for preview" }));
    await waitFor(() => expect(mocks.api.listLeads).toHaveBeenLastCalledWith({
      organisationId: "org-1",
      pageToken: "leads/org-1/lead-1",
    }));
    await waitFor(() => expect(screen.queryByText("Duplicate preview is partial.")).toBeNull());
    expect(screen.getByText(/Possible duplicate: email matches loaded lead/)).toBeTruthy();
    expect(screen.getByText("Fresh Decorators")).toBeTruthy();
    expect(mocks.api.importLeads).not.toHaveBeenCalled();
  });


  it("lets an owner rename the selected workspace through the server API", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    render(<CloudWorkspace />);
    // Wait for the asynchronous organisation load before editing the controlled form,
    // otherwise a late initial-load state update can overwrite the user's test input.
    await screen.findByRole("option", { name: "Pilot Workspace · owner" });
    const nameInput = await screen.findByLabelText("Organisation display name");
    fireEvent.change(nameInput, { target: { value: "Renamed Workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Save workspace settings" }));
    await waitFor(() => expect(mocks.api.updateOrganisationSettings).toHaveBeenCalledWith({ organisationId: "org-1", name: "Renamed Workspace" }));
    expect(await screen.findByText("Organisation settings saved.")).toBeTruthy();
    expect(await screen.findByRole("option", { name: "Renamed Workspace · owner" })).toBeTruthy();
  });


  it("lets an owner add an existing account by email with a selected role", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    render(<CloudWorkspace />);
    await screen.findByRole("option", { name: "Pilot Workspace · owner" });
    fireEvent.change(screen.getByLabelText("Add existing account by email"), { target: { value: "teammate@example.test" } });
    fireEvent.change(screen.getByLabelText("Member role"), { target: { value: "viewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    await waitFor(() => expect(mocks.api.addOrganisationMember).toHaveBeenCalledWith(expect.objectContaining({
      organisationId: "org-1",
      targetEmail: "teammate@example.test",
      role: "viewer",
      idempotencyKey: expect.stringMatching(/^organisation-member-add-/),
    })));
    expect(await screen.findByText("Member added.")).toBeTruthy();
  });

  it("keeps an uncertain member addition bound to the original organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "First Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    mocks.api.addOrganisationMember
      .mockRejectedValueOnce(new Error("Network request timed out"))
      .mockResolvedValueOnce({ organisationId: "org-1", uid: "member-1", role: "member", added: true });
    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });
    const email = screen.getByLabelText("Add existing account by email");
    fireEvent.change(email, { target: { value: "teammate@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add member" }));
    await screen.findByText("Network request timed out");
    const firstPayload = mocks.api.addOrganisationMember.mock.calls[0][0];
    expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry member addition" }));
    await waitFor(() => expect(mocks.api.addOrganisationMember).toHaveBeenCalledTimes(2));
    expect(mocks.api.addOrganisationMember.mock.calls[1][0]).toEqual(firstPayload);
  });

  it("disables member addition for non-admin organisation roles", async () => {
    mocks.currentUser = { email: "member@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "member" }] });
    render(<CloudWorkspace />);
    await screen.findByRole("option", { name: "Pilot Workspace · member" });
    expect((screen.getByLabelText("Add existing account by email") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Member role") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add member" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets an owner edit campaign details through the server API", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painting", location: "Manchester", goal: "Recruit painters", status: "active", createdAt: null }], hasMoreCampaigns: false, nextPageToken: null });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit details" }));
    fireEvent.change(screen.getAllByLabelText("Campaign name")[1], { target: { value: "Roofing pilot" } });
    fireEvent.change(screen.getByDisplayValue("Painting"), { target: { value: "Roofing" } });
    fireEvent.click(screen.getByRole("button", { name: "Save campaign details" }));
    await waitFor(() => expect(mocks.api.updateCampaignDetails).toHaveBeenCalledWith({
      organisationId: "org-1", campaignId: "campaign-1", name: "Roofing pilot", brand: "AnyTrader",
      category: "Roofing", location: "Manchester", goal: "Recruit painters",
    }));
    expect(await screen.findByText("Campaign details saved.")).toBeTruthy();
  });


  it("lets an organisation owner pause and reactivate campaigns through the server API", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Roofing pilot", brand: "AnyTrader", category: "Roofing", location: "Leeds, UK", goal: "Recruit roofers", status: "active", createdAt: null }], hasMoreCampaigns: false, nextPageToken: null });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(mocks.api.updateCampaignStatus).toHaveBeenCalledWith({ organisationId: "org-1", campaignId: "campaign-1", status: "paused" }));
    expect(await screen.findByText("Campaign paused.")).toBeTruthy();

  });

  it("does not show campaign lifecycle controls to a non-admin member", async () => {
    mocks.currentUser = { email: "member@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "member" }] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Roofing pilot", brand: "AnyTrader", category: "Roofing", location: "Leeds, UK", goal: "Recruit roofers", status: "active", createdAt: null }], hasMoreCampaigns: false, nextPageToken: null });
    render(<CloudWorkspace />);
    expect((await screen.findAllByText("Roofing pilot")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Complete" })).toBeNull();
  });

  it("loads full server-side campaign funnel counts on demand", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null }],
      hasMoreCampaigns: false,
      nextPageToken: null,
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load full counts" }));
    await waitFor(() => expect(mocks.api.getCampaignFunnelSummary).toHaveBeenCalledWith({
      organisationId: "org-1",
      campaignId: "campaign-1",
    }));
    expect(await screen.findByText("120 total leads")).toBeTruthy();
    expect(screen.getByText("30 qualified · 12 contacted · 4 onboarded")).toBeTruthy();
    expect(screen.getByText("25.0% qualified · 3.3% onboarded")).toBeTruthy();
  });

  it("does not show a failed source analytics request from a previous organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    let rejectAnalytics!: (reason: Error) => void;
    mocks.api.getLeadSourceFunnelSummary.mockImplementation(() => new Promise((_resolve, reject) => { rejectAnalytics = reject; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load full source counts" }));
    await waitFor(() => expect(mocks.api.getLeadSourceFunnelSummary).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectAnalytics(new Error("stale source analytics failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale source analytics failed/i)).toBeNull();
  });

  it("loads complete server-side source attribution counts on demand", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load full source counts" }));
    await waitFor(() => expect(mocks.api.getLeadSourceFunnelSummary).toHaveBeenCalledWith({ organisationId: "org-1" }));
    expect(await screen.findByRole("table", { name: "All-record source attribution" })).toBeTruthy();
    expect(screen.getByText("10", { selector: "td" })).toBeTruthy();
    const sourceChart = screen.getByRole("group", { name: "All-record lead source funnel chart" });
    expect(sourceChart.querySelectorAll("progress")).toHaveLength(6);
    expect(screen.getByRole("progressbar", { name: "LinkedIn export (user-declared) all stored leads" }).getAttribute("value")).toBe("10");
    expect(screen.getByRole("progressbar", { name: "LinkedIn export (user-declared) qualified leads" }).getAttribute("value")).toBe("3");
    expect(screen.getByRole("progressbar", { name: "LinkedIn export (user-declared) onboarded leads" }).getAttribute("value")).toBe("1");
    expect(screen.getByText(/unknown includes missing and unrecognised legacy values/i)).toBeTruthy();
  });

  it("shows a conservative read-only campaign readiness preflight and discloses partial pages", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [{ id: "campaign-1", name: "Roofers Leeds", brand: "AnyTrader", category: "Roofers", location: "Leeds", goal: "Pilot", status: "active", createdAt: null }],
      hasMoreCampaigns: false,
      nextPageToken: null,
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [{
        id: "lead-1", campaignId: "campaign-1", businessName: "Roofing Example",
        category: "Roofers", location: "Leeds", website: "", email: "", phone: "", source: "unknown",
        status: "new", score: 10, scoreReasons: [], notes: "", doNotContact: true,
        contactRestrictionVerified: false, contactReviewStatus: "pending", contactReviewRevision: 0, createdAt: null,
      }],
      hasMoreLeads: true,
      nextPageToken: "lead-page-2",
    });
    mocks.api.listOutreachDrafts.mockResolvedValue({ drafts: [], hasMoreDrafts: false, nextPageToken: null });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:readiness-report");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Show readiness preflight" }));
    const table = await screen.findByRole("table", { name: "Campaign readiness preflight" });
    expect(table.textContent).toContain("Roofers Leeds");
    expect(table.textContent).toContain("incomplete");
    expect(table.textContent).toContain("Incomplete — more pages available");
    expect(screen.getByText(/not approval to contact prospects/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send outreach/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export readiness preflight (CSV)" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const exportedBlob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob);
    });
    expect(csv).toContain("Loaded records only");
    expect(csv).toContain("Roofers Leeds");
    expect(csv).toContain("Incomplete — more pages available");
    expect(csv).toContain("does not authorise outreach");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:readiness-report");
    expect(await screen.findByText(/This report does not authorise outreach/)).toBeTruthy();
  });

  it("exports full server-counted source aggregates only after loading the selected organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    const createObjectURL = vi.fn(() => "blob:source-report");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<CloudWorkspace />);
    const exportButton = await screen.findByRole("button", { name: "Export full source report (CSV)" }) as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "Load full source counts" }));
    await waitFor(() => expect(exportButton.disabled).toBe(false));
    fireEvent.click(exportButton);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:source-report");
    expect(await screen.findByText(/Exported full stored-lead source counts for 2 source category/i)).toBeTruthy();
  });

  it("shows the first onboarding date for an onboarded lead", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [], hasMoreCampaigns: false, nextPageToken: null });
    mocks.api.listLeads.mockResolvedValue({
      leads: [{
        id: "lead-onboarded", campaignId: "campaign-1", businessName: "Onboarded Provider",
        category: "Painters", location: "Leeds", website: "", email: "", phone: "", source: "manual",
        status: "onboarded", score: 20, scoreReasons: [], notes: "", doNotContact: false,
        contactRestrictionVerified: true, contactReviewStatus: "cleared", contactReviewRevision: 1,
        onboardedAt: "2026-01-05T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z",
      }],
      hasMoreLeads: false,
      nextPageToken: null,
    });
    render(<CloudWorkspace />);
    expect(await screen.findByText(/First onboarded:/)).toBeTruthy();
  });

  it("lets only the owner run a read-only offboarding preview and displays category counts", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview organisation data" }));
    await waitFor(() => expect(mocks.api.previewOrganisationOffboarding).toHaveBeenCalledWith({ organisationId: "org-1" }));
    expect(await screen.findByText("Inventory completed for all listed categories")).toBeTruthy();
    expect(screen.getByText("leads", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText(/12 records/)).toBeTruthy();
    expect(screen.getByText("No destructive action performed: confirmed.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delete|remove|close account/i })).toBeNull();
  });

  it("does not expose the owner-only offboarding preview to admins", async () => {
    mocks.currentUser = { email: "admin@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "admin" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    await screen.findByRole("option", { name: /Pilot Workspace.*admin/ });
    expect(screen.queryByRole("button", { name: "Preview organisation data" })).toBeNull();
    expect(mocks.api.previewOrganisationOffboarding).not.toHaveBeenCalled();
  });

  it("labels a capped or failed offboarding preview as incomplete instead of inventing exact counts", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.previewOrganisationOffboarding.mockResolvedValue({
      complete: false,
      destructiveActionPerformed: false,
      maxRecordsPerCategory: 1000,
      categories: [
        { category: "leads", status: "limit_reached", exactCount: null, observedCount: 1000 },
        { category: "securityAuditEvents", status: "unavailable", exactCount: null, observedCount: 3 },
      ],
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview organisation data" }));
    expect(await screen.findByText("Inventory incomplete — review required")).toBeTruthy();
    expect(screen.getByText(/at least 1000 records \(category cap reached\)/)).toBeTruthy();
    expect(screen.getByText(/unavailable; 3 records observed before the read failed/)).toBeTruthy();
  });

  it("loads monthly first-onboarding cohorts and discloses excluded legacy history", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load onboarding cohorts" }));
    await waitFor(() => expect(mocks.api.getOnboardingCohortSummary).toHaveBeenCalledWith({ organisationId: "org-1" }));
    expect(await screen.findByRole("table", { name: /First-onboarding cohorts by UTC calendar month/ })).toBeTruthy();
    expect(screen.getAllByText("2025-01")).toHaveLength(2);
    expect(screen.getAllByText("2025-12")).toHaveLength(2);
    const cohortChart = screen.getByRole("group", { name: "Monthly first-onboarding counts chart" });
    expect(cohortChart.querySelectorAll("progress")).toHaveLength(12);
    expect(screen.getByRole("progressbar", { name: "2025-01 first onboardings" }).getAttribute("value")).toBe("0");
    expect(screen.getByRole("progressbar", { name: "2025-12 first onboardings" }).getAttribute("value")).toBe("11");
    expect(screen.getByText(/legacy leads already onboarded before timestamp capture may be excluded/i)).toBeTruthy();
  });

  it("previews missing onboarding timestamps without exposing lead records", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.getOnboardingCohortCoverage.mockResolvedValue({
      organisationId: "org-1",
      totalOnboardedLeadCount: 4,
      timestampedOnboardedLeadCount: 2,
      missingOrInvalidOnboardedTimestampCount: 2,
      scanLimit: 1000,
      scope: "onboarded_leads_only",
      note: "Read-only estimate. Missing or invalid timestamps are counted but never assigned an inferred date; review records and policy before any backfill.",
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview legacy timestamp coverage" }));
    await waitFor(() => expect(mocks.api.getOnboardingCohortCoverage).toHaveBeenCalledWith({ organisationId: "org-1" }));
    const coverageTable = await screen.findByRole("table", { name: "Onboarding timestamp coverage" });
    expect(coverageTable.textContent).toContain("4");
    expect(coverageTable.textContent).toContain("2");
    expect(coverageTable.textContent).toContain("1000");
    expect(screen.getByRole("progressbar", { name: "First-onboarding timestamp coverage" }).getAttribute("value")).toBe("2");
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText(/2 of 4 currently onboarded lead\(s\) have a valid first-onboarding timestamp/)).toBeTruthy();
    expect(screen.getByText(/Missing timestamps need a reviewed backfill plan/)).toBeTruthy();
    expect(screen.getByText(/Read-only estimate/)).toBeTruthy();
    expect(screen.getByText(/never assigned an inferred date/i)).toBeTruthy();
  });

  it("does not show a failed onboarding cohort request from a previous organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    let rejectCohorts!: (reason: Error) => void;
    mocks.api.getOnboardingCohortSummary.mockImplementation(() => new Promise((_resolve, reject) => { rejectCohorts = reject; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load onboarding cohorts" }));
    await waitFor(() => expect(mocks.api.getOnboardingCohortSummary).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectCohorts(new Error("stale onboarding cohorts request failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale onboarding cohorts request failed/i)).toBeNull();
  });

  it("does not show a failed onboarding coverage request from a previous organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    let rejectCoverage!: (reason: Error) => void;
    mocks.api.getOnboardingCohortCoverage.mockImplementation(() => new Promise((_resolve, reject) => { rejectCoverage = reject; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview legacy timestamp coverage" }));
    await waitFor(() => expect(mocks.api.getOnboardingCohortCoverage).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectCoverage(new Error("stale onboarding coverage request failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale onboarding coverage request failed/i)).toBeNull();
  });

  it("does not show a failed lead completeness request from a previous organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    let rejectSummary!: (reason: Error) => void;
    mocks.api.getLeadCompletenessSummary.mockImplementation(() => new Promise((_resolve, reject) => { rejectSummary = reject; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load completeness report" }));
    await waitFor(() => expect(mocks.api.getLeadCompletenessSummary).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectSummary(new Error("stale lead completeness request failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale lead completeness request failed/i)).toBeNull();
  });

  it("does not expose onboarding timestamp coverage preview to viewer roles", async () => {
    mocks.currentUser = { email: "viewer@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "viewer" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    await screen.findByRole("option", { name: /Pilot Workspace.*viewer/ });
    expect(screen.queryByRole("button", { name: "Preview legacy timestamp coverage" })).toBeNull();
    expect(mocks.api.getOnboardingCohortCoverage).not.toHaveBeenCalled();
  });

  it("shows server-maintained plan usage and remaining limits to organisation owners", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load plan usage" }));
    await waitFor(() => expect(mocks.api.getOrganisationPlanUsage).toHaveBeenCalledWith({ organisationId: "org-1" }));
    expect(await screen.findByRole("table", { name: "Server-maintained plan usage for 2026-10" })).toBeTruthy();
    expect(screen.getByText("Campaigns (lifetime)")).toBeTruthy();
    expect(screen.getByText("AI suggestions (UTC month)")).toBeTruthy();
    expect(screen.getByText("458")).toBeTruthy();
    expect(screen.getByText("43")).toBeTruthy();
  });

  it("warns when quotas are near their limit and marks exhausted quotas", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.getOrganisationPlanUsage.mockResolvedValue({
      organisationId: "org-1",
      status: "authoritative",
      plan: { id: "pilot", displayName: "Pilot", limits: { campaigns: 10, leads: 50, members: 5, monthlyAiSuggestions: 10 } },
      usage: { campaigns: 9, leads: 50, members: 5, monthlyAiSuggestions: 8 },
      remaining: { campaigns: 1, leads: 0, members: 0, monthlyAiSuggestions: 2 },
      aiUsagePeriod: "2026-10",
      message: "Usage is server-maintained.",
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load plan usage" }));
    await waitFor(() => expect(mocks.api.getOrganisationPlanUsage).toHaveBeenCalledWith({ organisationId: "org-1" }));
    expect((await screen.findByLabelText("Quota status for Campaigns (lifetime)")).textContent).toBe("Near limit");
    expect((await screen.findByLabelText("Quota status for Leads (lifetime)")).textContent).toBe("Limit reached");
    expect((await screen.findByLabelText("Quota status for Organisation members (current counter)")).textContent).toBe("Limit reached");
    expect((await screen.findByLabelText("Quota status for AI suggestions (UTC month)")).textContent).toBe("Near limit");
  });

  it("does not display invented numeric usage for legacy organisations awaiting reconciliation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.getOrganisationPlanUsage.mockResolvedValueOnce({
      organisationId: "org-1",
      status: "reconciliation_required",
      plan: { id: "pilot", displayName: "Pilot", limits: { campaigns: 10, leads: 500, members: 5, monthlyAiSuggestions: 50 } },
      usage: null,
      remaining: null,
      aiUsagePeriod: null,
      message: "Usage counters are not authoritative for this legacy organisation.",
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load plan usage" }));
    expect(await screen.findByText(/Usage reconciliation required/)).toBeTruthy();
    expect(screen.queryByRole("table", { name: /Server-maintained plan usage/ })).toBeNull();
  });

  it("exports the loaded monthly onboarding cohorts with their timestamp caveat", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:cohort-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load onboarding cohorts" }));
    await screen.findByRole("table", { name: /First-onboarding cohorts by UTC calendar month/ });
    fireEvent.click(screen.getByRole("button", { name: "Export cohort CSV" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const exportedBlob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob);
    });
    expect(csv).toContain("Scope,UTC month,First onboardings,Attribution note");
    expect(csv).toContain("2025-01,0");
    expect(csv).toContain("2025-12,11");
    expect(csv).toContain("Legacy leads already onboarded before timestamp capture may be excluded");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:cohort-export");
    expect(await screen.findByText(/Exported 12 monthly onboarding cohort row\(s\)/)).toBeTruthy();
  });

  it("exports every stored lead across pages for owners even when UI filters hide records", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [{
        id: "loaded-lead", campaignId: "campaign-1", businessName: "Loaded Example",
        category: "Painters", location: "Leeds", website: "", email: "", phone: "", source: "manual",
        status: "new", score: 20, scoreReasons: [], notes: "", doNotContact: true,
        contactRestrictionVerified: false, contactReviewStatus: "pending", contactReviewRevision: 0, createdAt: null,
      }],
      hasMoreLeads: false,
      nextPageToken: null,
    });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [{ id: "campaign-1", name: "Full export campaign", brand: "AnyTrader", category: "Painters", location: "Leeds", goal: "Pilot", status: "active", createdAt: null }],
      hasMoreCampaigns: false,
      nextPageToken: null,
    });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:full-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<CloudWorkspace />);
    expect(await screen.findByText("Loaded Example")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "no matching lead" } });
    mocks.api.listLeads
      .mockResolvedValueOnce({
        leads: [{
          id: "lead-1", campaignId: "campaign-1", businessName: "First Provider",
          category: "Painters", location: "Leeds", website: "", email: "first@example.test", phone: "", source: "manual",
          status: "qualified", score: 20, scoreReasons: [], notes: "", doNotContact: false,
          contactRestrictionVerified: true, contactReviewStatus: "cleared", contactReviewRevision: 1, createdAt: null,
        }],
        hasMoreLeads: true,
        nextPageToken: "lead-cursor-1",
      })
      .mockResolvedValueOnce({
        leads: [{
          id: "lead-2", campaignId: "campaign-1", businessName: "Second Provider",
          category: "Roofers", location: "Glasgow", website: "", email: "second@example.test", phone: "", source: "csv_import",
          status: "onboarded", score: 20, scoreReasons: [], notes: "", doNotContact: false,
          contactRestrictionVerified: true, contactReviewStatus: "cleared", contactReviewRevision: 1, createdAt: null,
        }],
        hasMoreLeads: false,
        nextPageToken: null,
      });
    mocks.api.listCampaigns.mockResolvedValueOnce({
      campaigns: [{ id: "campaign-1", name: "Full export campaign", brand: "AnyTrader", category: "Painters", location: "Leeds", goal: "Pilot", status: "active", createdAt: null }],
      hasMoreCampaigns: false,
      nextPageToken: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Export all stored leads (CSV)" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const exportedBlob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob);
    });
    expect(csv).toContain("First Provider");
    expect(csv).toContain("Second Provider");
    expect(csv).toContain("Full export campaign");
    expect(csv).not.toContain("Loaded Example");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:full-export");
    expect(await screen.findByText(/Exported all 2 stored lead\(s\).*Current filters were not applied/)).toBeTruthy();
  });

  it("exports all matching filtered leads across stored pages, not just currently loaded rows", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [{
        id: "loaded-lead", campaignId: "campaign-1", businessName: "Loaded Example",
        category: "Painters", location: "Leeds", website: "", email: "", phone: "", source: "csv_import",
        status: "new", score: 20, scoreReasons: [], notes: "", doNotContact: true,
        contactRestrictionVerified: false, contactReviewStatus: "pending", contactReviewRevision: 0, createdAt: null,
      }],
      hasMoreLeads: false,
      nextPageToken: null,
    });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [{ id: "campaign-1", name: "Filtered export campaign", brand: "AnyTrader", category: "Painters", location: "Leeds", goal: "Pilot", status: "active", createdAt: null }],
      hasMoreCampaigns: false,
      nextPageToken: null,
    });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:filtered-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<CloudWorkspace />);
    expect(await screen.findByText("Loaded Example")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "Provider" } });
    fireEvent.change(screen.getByLabelText("Filter by category"), { target: { value: "Decorators" } });
    mocks.api.listLeads.mockResolvedValueOnce({
      leads: [
        {
          id: "target-lead", campaignId: "campaign-1", businessName: "Target Provider",
          category: "Decorators", location: "Leeds", website: "", email: "", phone: "", source: "csv_import",
          status: "qualified", score: 80, scoreReasons: ["Business name provided (+20)"], notes: "",
          doNotContact: false, contactRestrictionVerified: true, contactReviewStatus: "cleared", contactReviewRevision: 1, createdAt: null,
        },
        {
          id: "other-lead", campaignId: "campaign-1", businessName: "Other Provider",
          category: "Painters", location: "Glasgow", website: "", email: "", phone: "", source: "csv_import",
          status: "new", score: 20, scoreReasons: [], notes: "",
          doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending", contactReviewRevision: 0, createdAt: null,
        },
      ],
      hasMoreLeads: false,
      nextPageToken: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Export all matching filtered leads (CSV)" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const exportedBlob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob);
    });
    expect(csv).toContain("Target Provider");
    expect(csv).not.toContain("Other Provider");
    expect(csv).not.toContain("Loaded Example");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:filtered-export");
    expect(await screen.findByText(/Exported 1 lead\(s\) matching current filters from 2 stored lead\(s\)/)).toBeTruthy();
  });

  it("does not show full lead export to viewer roles", async () => {
    mocks.currentUser = { email: "viewer@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "viewer" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    await screen.findByRole("option", { name: /Pilot Workspace.*viewer/ });
    expect(screen.queryByRole("button", { name: "Export all stored leads (CSV)" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Load plan usage" })).toBeNull();
  });

  it("loads the owner/admin member roster and shows current Auth emails and roles", async () => {
    mocks.currentUser = { email: "owner@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-1"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    await waitFor(() => expect(mocks.api.listOrganisationMembers).toHaveBeenCalledWith({ organisationId: "org-1" }));
    const rosterTable = await screen.findByRole("table", { name: "Organisation member roster" });
    expect(rosterTable.textContent).toContain("owner@example.test");
    expect(screen.getByText("owner", { selector: "td" })).toBeTruthy();
    expect(screen.getByText(/Account ID: owner-uid/)).toBeTruthy();
  });

  it("does not expose the member roster to viewer roles", async () => {
    mocks.currentUser = { email: "viewer@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "viewer" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    await screen.findByRole("option", { name: /Pilot Workspace.*viewer/ });
    expect(screen.queryByRole("button", { name: "Load member roster" })).toBeNull();
    expect(mocks.api.listOrganisationMembers).not.toHaveBeenCalled();
  });

  it("does not show a failed plan usage request from a previous organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    let rejectPlanUsage!: (reason: Error) => void;
    mocks.api.getOrganisationPlanUsage.mockImplementation(() => new Promise((_resolve, reject) => { rejectPlanUsage = reject; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load plan usage" }));
    await waitFor(() => expect(mocks.api.getOrganisationPlanUsage).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectPlanUsage(new Error("stale plan usage request failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale plan usage request failed/i)).toBeNull();
  });

  it("does not show a failed plan usage reconciliation request from a previous organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    let rejectReconciliation!: (reason: Error) => void;
    mocks.api.getOrganisationPlanUsageReconciliation.mockImplementation(() => new Promise((_resolve, reject) => { rejectReconciliation = reject; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load plan usage" }));
    await waitFor(() => expect(mocks.api.getOrganisationPlanUsage).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.click(screen.getByRole("button", { name: "Inspect reconciliation" }));
    await waitFor(() => expect(mocks.api.getOrganisationPlanUsageReconciliation).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectReconciliation(new Error("stale plan usage reconciliation failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale plan usage reconciliation failed/i)).toBeNull();
  });

  it("shows read-only plan usage reconciliation mismatches and AI review caveat", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load plan usage" }));
    await screen.findByRole("table", { name: "Server-maintained plan usage for 2026-10" });
    fireEvent.click(screen.getByRole("button", { name: "Inspect reconciliation" }));
    await waitFor(() => expect(mocks.api.getOrganisationPlanUsageReconciliation).toHaveBeenCalledWith({ organisationId: "org-1" }));
    expect(await screen.findByRole("table", { name: "Actual resource counts versus stored plan counters" })).toBeTruthy();
    expect(screen.getByText("Mismatch")).toBeTruthy();
    expect(screen.getByText(/Historical AI suggestion usage cannot be inferred/)).toBeTruthy();
    expect(screen.getByText(/no counters were changed/i)).toBeTruthy();
  });

 
  it("exports read-only quota reconciliation after both summaries load", async () => {
    mocks.currentUser = { email: "owner@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:quota-reconciliation");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load plan usage" }));
    await screen.findByRole("table", { name: "Server-maintained plan usage for 2026-10" });
    fireEvent.click(screen.getByRole("button", { name: "Inspect reconciliation" }));
    await screen.findByRole("table", { name: "Actual resource counts versus stored plan counters" });
    fireEvent.click(screen.getByRole("button", { name: "Export quota reconciliation (CSV)" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:quota-reconciliation");
    expect(await screen.findByText(/historical AI usage remains review-required/i)).toBeTruthy();
  });

  it("lets an owner remove a non-owner member after confirmation", async () => {
    mocks.currentUser = { email: "owner@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listOrganisationMembers.mockResolvedValue({
      organisationId: "org-1",
      members: [
        { uid: "owner-uid", email: "owner@example.test", role: "owner", createdAt: null },
        { uid: "member-uid", email: "member@example.test", role: "member", createdAt: null },
      ],
      hasMoreMembers: false,
      nextPageToken: null,
      scope: "organisation_member_roster",
    });
    mocks.api.removeOrganisationMember.mockResolvedValue({ organisationId: "org-1", targetUid: "member-uid", removed: true });
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    render(<CloudWorkspace />);
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-1"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    await screen.findByText("member@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
    await waitFor(() => expect(mocks.api.removeOrganisationMember).toHaveBeenCalledWith({ organisationId: "org-1", targetUid: "member-uid" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/membership removed/i)).toBeTruthy();
    expect(screen.queryByText(/Account ID: member-uid/)).toBeNull();
  });

 
  it("appends the next member roster page without duplicating existing accounts", async () => {
    mocks.currentUser = { email: "owner@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listOrganisationMembers
      .mockResolvedValueOnce({
        organisationId: "org-1",
        members: [
          { uid: "owner-uid", email: "owner@example.test", role: "owner", createdAt: null },
          { uid: "member-uid", email: "member@example.test", role: "member", createdAt: null },
        ],
        hasMoreMembers: true,
        nextPageToken: "cursor-page-2",
        scope: "organisation_member_roster",
      })
      .mockResolvedValueOnce({
        organisationId: "org-1",
        members: [
          { uid: "member-uid", email: "member@example.test", role: "member", createdAt: null },
          { uid: "viewer-uid", email: "viewer@example.test", role: "viewer", createdAt: null },
        ],
        hasMoreMembers: false,
        nextPageToken: null,
        scope: "organisation_member_roster",
      });
    render(<CloudWorkspace />);
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-1"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    await screen.findByText("member@example.test");
    fireEvent.click(screen.getByRole("button", { name: "Load more members" }));
    await waitFor(() => expect(mocks.api.listOrganisationMembers).toHaveBeenNthCalledWith(2, { organisationId: "org-1", pageToken: "cursor-page-2" }));
    expect(await screen.findByText("viewer@example.test")).toBeTruthy();
    expect(screen.getAllByText("member@example.test")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more members" })).toBeNull();
  });

 
  it("lets only the owner promote a member and updates the displayed role", async () => {
    mocks.currentUser = { email: "owner@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listOrganisationMembers.mockResolvedValue({
      organisationId: "org-1",
      members: [
        { uid: "owner-uid", email: "owner@example.test", role: "owner", createdAt: null },
        { uid: "member-uid", email: "member@example.test", role: "member", createdAt: null },
      ],
      hasMoreMembers: false,
      nextPageToken: null,
      scope: "organisation_member_roster",
    });
    mocks.api.updateOrganisationMemberRole.mockResolvedValue({ organisationId: "org-1", targetUid: "member-uid", role: "admin", changed: true });
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<CloudWorkspace />);
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-1"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    await screen.findByText("member@example.test");
    fireEvent.change(screen.getByRole("combobox", { name: "Role for member@example.test" }), { target: { value: "admin" } });
    fireEvent.click(screen.getByRole("button", { name: "Save role" }));
    await waitFor(() => expect(mocks.api.updateOrganisationMemberRole).toHaveBeenCalledWith({ organisationId: "org-1", targetUid: "member-uid", role: "admin" }));
    expect(await screen.findByText("Member role updated to admin.")).toBeTruthy();
    expect(screen.getByText("admin", { selector: "td" })).toBeTruthy();
  });

 
  it("exports server-counted funnel totals for all stored campaign leads", async () => {
    mocks.currentUser = { email: "pilot@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [{ id: "campaign-1", name: 'Roofers, "North"', brand: "AnyTrader", category: "Roofers", location: "Leeds", goal: "Pilot", status: "active", createdAt: null }],
      hasMoreCampaigns: false,
      nextPageToken: null,
    });
    mocks.api.getCampaignFunnelSummary.mockResolvedValue({
      organisationId: "org-1", campaignId: "campaign-1", totalLeadCount: 120,
      qualifiedLeadCount: 30, contactedLeadCount: 20, onboardedLeadCount: 8,
      qualifiedRatePercent: 25, onboardedRatePercent: 6.7, scope: "all_stored_campaign_leads",
    });
    const createObjectURL = vi.fn(() => "blob:campaign-report");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<CloudWorkspace />);
    const fullReportButton = await screen.findByRole("button", { name: "Export full campaign report (CSV)" }) as HTMLButtonElement;
    // The action is intentionally disabled until the initial campaign page has loaded.
    await waitFor(() => expect(fullReportButton.disabled).toBe(false));
    fireEvent.click(fullReportButton);
    await waitFor(() => expect(mocks.api.getCampaignFunnelSummary).toHaveBeenCalledWith({ organisationId: "org-1", campaignId: "campaign-1" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:campaign-report");
    expect(await screen.findByText(/full stored-lead funnel counts for 1 campaign/)).toBeTruthy();
  });

  it("does not show a failed full campaign export from a previous organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [
      { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
      { organisationId: "org-2", name: "Second Workspace", role: "owner" },
    ] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null }], hasMoreCampaigns: false, nextPageToken: null });
    mocks.api.getCampaignFunnelSummary.mockResolvedValue({
      organisationId: "org-1", campaignId: "campaign-1", totalLeadCount: 1,
      qualifiedLeadCount: 0, contactedLeadCount: 0, onboardedLeadCount: 0,
      qualifiedRatePercent: 0, onboardedRatePercent: 0, scope: "all_stored_campaign_leads",
    });
    render(<CloudWorkspace />);
    const button = await screen.findByRole("button", { name: "Export full campaign report (CSV)" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    let rejectCampaigns!: (reason: Error) => void;
    mocks.api.listCampaigns.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCampaigns = reject; }));
    fireEvent.click(button);
    await waitFor(() => expect(mocks.api.listCampaigns).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectCampaigns(new Error("stale full campaign export failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale full campaign export failed/i)).toBeNull();
  });

  it("does not show a failed lead activity request from a previous organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [
      { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
      { organisationId: "org-2", name: "Second Workspace", role: "owner" },
    ] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-history", campaignId: "campaign-1", businessName: "History Painter", category: "Painters",
      location: "Leeds", website: "", email: "", phone: "", source: "manual", status: "qualified",
      score: 40, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false,
      contactReviewStatus: "pending", createdAt: null,
    }] });
    let rejectTimeline!: (reason: Error) => void;
    mocks.api.getLeadActivityTimeline.mockImplementation(() => new Promise((_resolve, reject) => { rejectTimeline = reject; }));
    render(<CloudWorkspace />);
    await screen.findByText("History Painter");
    fireEvent.click(screen.getByRole("button", { name: "View history" }));
    await waitFor(() => expect(mocks.api.getLeadActivityTimeline).toHaveBeenCalledWith({ organisationId: "org-1", leadId: "lead-history" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectTimeline(new Error("stale activity request failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale activity request failed/i)).toBeNull();
  });

  it("loads a privacy-minimised activity timeline on demand for the selected lead", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-history", campaignId: "campaign-1", businessName: "History Painter", category: "Painters",
      location: "Leeds", website: "", email: "", phone: "", source: "manual", status: "qualified",
      score: 40, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false,
      contactReviewStatus: "pending", contactReviewRevision: 0, onboardedAt: null, createdAt: null,
    }], hasMoreLeads: false, nextPageToken: null });
    render(<CloudWorkspace />);
    await screen.findByText("History Painter");
    fireEvent.click(screen.getByRole("button", { name: "View history" }));
    expect(await screen.findByText("Lead status changed to qualified")).toBeTruthy();
    expect(screen.getByText("Lead created: History Painter")).toBeTruthy();
    expect(screen.getByText(/Internal note contents, contact values, and actor account identifiers are not included/i)).toBeTruthy();
    expect(mocks.api.getLeadActivityTimeline).toHaveBeenCalledWith({ organisationId: "org-1", leadId: "lead-history" });
    fireEvent.click(screen.getByRole("button", { name: "Hide history" }));
    expect(screen.queryByText("Lead status changed to qualified")).toBeNull();
  });

  it("filters the loaded lead list by contact-review state and clears the filter", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    const lead = (id: string, businessName: string, review: "pending" | "cleared" | "blocked") => ({
      id, campaignId: "campaign-1", businessName, category: "Painters", location: "Leeds",
      website: "", email: "", phone: "", source: "manual", status: "new", score: 40,
      scoreReasons: [], notes: "", doNotContact: review !== "cleared",
      contactRestrictionVerified: review === "cleared", contactReviewStatus: review,
      contactReviewRevision: 0, onboardedAt: null, createdAt: null,
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [
        lead("pending-1", "Pending Painter", "pending"),
        lead("cleared-1", "Cleared Painter", "cleared"),
        lead("blocked-1", "Blocked Painter", "blocked"),
      ],
      hasMoreLeads: false,
      nextPageToken: null,
    });
    render(<CloudWorkspace />);
    await screen.findByText("Pending Painter");
    expect(screen.getByRole("row", { name: /Cleared Painter/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter by contact review"), { target: { value: "pending" } });
    expect(screen.getByRole("row", { name: /Pending Painter/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /Cleared Painter/ })).toBeNull();
    expect(screen.queryByRole("row", { name: /Blocked Painter/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("row", { name: /Cleared Painter/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /Blocked Painter/ })).toBeTruthy();
  });

  it("shows loaded contact-review counts and quick-filters the pending queue", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    const lead = (id: string, businessName: string, review: "pending" | "cleared" | "blocked") => ({
      id, campaignId: "campaign-1", businessName, category: "Painters", location: "Leeds",
      website: "", email: "", phone: "", source: "manual", status: "new", score: 40,
      scoreReasons: [], notes: "", doNotContact: review !== "cleared",
      contactRestrictionVerified: review === "cleared", contactReviewStatus: review,
      contactReviewRevision: 0, onboardedAt: null, createdAt: null,
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [
        lead("pending-1", "Pending Painter", "pending"),
        lead("cleared-1", "Cleared Painter", "cleared"),
        lead("blocked-1", "Blocked Painter", "blocked"),
      ],
      hasMoreLeads: true,
      nextPageToken: "lead-next-page",
    });
    render(<CloudWorkspace />);
    await screen.findByText("Pending Painter");
    expect(screen.getByText(/Quick filters below count loaded leads only.*server-side inventory/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pending review (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Review cleared (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Blocked / do not contact (1)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pending review (1)" }));
    expect(screen.getByRole("row", { name: /Pending Painter/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /Cleared Painter/ })).toBeNull();
    expect(screen.queryByRole("row", { name: /Blocked Painter/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Pending review (1)" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("loads full-organisation contact-review counts and labels legacy records as unclassified", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.getContactReviewQueueSummary.mockResolvedValue({
      organisationId: "org-1",
      totalLeadCount: 17,
      pendingCount: 4,
      clearedCount: 7,
      blockedCount: 3,
      legacyOrUnclassifiedCount: 3,
      scope: "all_stored_organisation_leads",
      attributionNote: "Counts use the stored contactReviewStatus field. Older records without an explicit status are reported as legacy or unclassified rather than guessed from partial fields.",
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load all-stored counts" }));
    await waitFor(() => expect(mocks.api.getContactReviewQueueSummary).toHaveBeenCalledWith({ organisationId: "org-1" }));
    expect(await screen.findByText("All stored leads: 17")).toBeTruthy();
    expect(screen.getByText("Explicitly pending: 4")).toBeTruthy();
    expect(screen.getByText("Review cleared: 7")).toBeTruthy();
    expect(screen.getByText("Blocked / do not contact: 3")).toBeTruthy();
    expect(screen.getByText("Legacy or unclassified: 3")).toBeTruthy();
    expect(screen.getByText(/older records without an explicit status are reported as legacy or unclassified/i)).toBeTruthy();
  });

  it("shows lead completeness reasons and sorts the loaded lead list", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    const lead = (id: string, businessName: string, score: number, scoreReasons: string[]) => ({
      id, campaignId: "campaign-1", businessName, category: "Painters", location: "Leeds",
      website: "", email: "", phone: "", source: id === "zulu" ? "linkedin_csv" : "manual", status: "new", score, scoreReasons,
      notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending",
      contactReviewRevision: 0, onboardedAt: null,
      createdAt: id === "zulu" ? "2026-10-25T10:00:00.000Z" : "2026-10-24T10:00:00.000Z",
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [
        lead("alpha", "Alpha Provider", 25, ["Business name present"]),
        lead("zulu", "Zulu Provider", 90, ["Business name present", "Website present"]),
      ],
      hasMoreLeads: false,
      nextPageToken: null,
    });
    render(<CloudWorkspace />);
    await screen.findByText("Zulu Provider");
    const leadRows = () => screen.getAllByRole("row").filter((row) => /Alpha Provider|Zulu Provider/.test(row.textContent ?? ""));
    expect(leadRows()[0].textContent).toContain("Zulu Provider");
    expect(screen.getByText("90/100")).toBeTruthy();
    expect(screen.getByText(/Website present/)).toBeTruthy();
    expect(screen.getAllByText(/not a quality, consent, or contactability guarantee/i)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Sort leads by"), { target: { value: "business" } });
    expect(leadRows()[0].textContent).toContain("Alpha Provider");
    fireEvent.change(screen.getByLabelText("Sort leads by"), { target: { value: "newest" } });
    expect(leadRows()[0].textContent).toContain("Zulu Provider");

    fireEvent.change(screen.getByLabelText("Filter by completeness"), { target: { value: "high" } });
    expect(screen.getByText("Zulu Provider")).toBeTruthy();
    expect(screen.queryByText("Alpha Provider")).toBeNull();
    expect(screen.getByText(/Showing 1 of 2/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter by completeness"), { target: { value: "medium" } });
    expect(screen.getByText(/No leads match these filters/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter by completeness"), { target: { value: "low" } });
    expect(screen.getByText("Alpha Provider")).toBeTruthy();
    expect(screen.queryByText("Zulu Provider")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((screen.getByLabelText("Filter by completeness") as HTMLSelectElement).value).toBe("all");
    expect(screen.getByText("Alpha Provider")).toBeTruthy();
    expect(screen.getByText("Zulu Provider")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter by source"), { target: { value: "linkedin_csv" } });
    expect(screen.getByText("Zulu Provider")).toBeTruthy();
    expect(screen.queryByText("Alpha Provider")).toBeNull();
    expect(screen.getByText(/Showing 1 of 2/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter by source"), { target: { value: "manual" } });
    expect(screen.getByText("Alpha Provider")).toBeTruthy();
    expect(screen.queryByText("Zulu Provider")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect((screen.getByLabelText("Filter by source") as HTMLSelectElement).value).toBe("all");
    expect(screen.getByText("Alpha Provider")).toBeTruthy();
    expect(screen.getByText("Zulu Provider")).toBeTruthy();
  });

  it("loads a paginated, read-only security audit log for organisation owners", async () => {
    mocks.currentUser = { email: "pilot@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listOrganisationSecurityAuditEvents
      .mockResolvedValueOnce({
        organisationId: "org-1",
        events: [{
          id: "audit-2", eventType: "lead.status_changed", actorUid: "owner-uid",
          resourceType: "lead", resourceId: "lead-2", outcome: "success",
          metadata: { leadStatus: "qualified" }, createdAt: "2026-10-25T12:00:00.000Z",
        }],
        hasMoreEvents: true, nextPageToken: "cursor-2", scope: "organisation_security_audit",
      })
      .mockResolvedValueOnce({
        organisationId: "org-1",
        events: [{
          id: "audit-1", eventType: "organisation.member_added", actorUid: "owner-uid",
          resourceType: "organisation", resourceId: "member-2", outcome: "success",
          metadata: { memberRole: "viewer" }, createdAt: "2026-10-24T12:00:00.000Z",
        }],
        hasMoreEvents: false, nextPageToken: null, scope: "organisation_security_audit",
      });

    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load audit log" }));
    expect(await screen.findByRole("table", { name: "Organisation security audit events" })).toBeTruthy();
    expect(screen.getByRole("row", { name: /lead status changed/ })).toBeTruthy();
    expect(screen.getByText("leadStatus: qualified")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load more audit events" }));
    await waitFor(() => expect(mocks.api.listOrganisationSecurityAuditEvents).toHaveBeenLastCalledWith({ organisationId: "org-1", pageToken: "cursor-2" }));
    expect(await screen.findByRole("row", { name: /organisation member added/ })).toBeTruthy();
    expect(screen.getByText("memberRole: viewer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load more audit events" })).toBeNull();
  });

  it("does not show a failed security audit request from a previous organisation", async () => {
    mocks.currentUser = { email: "owner@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    let rejectAudit!: (reason: Error) => void;
    mocks.api.listOrganisationSecurityAuditEvents.mockImplementation(() => new Promise((_resolve, reject) => { rejectAudit = reject; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load audit log" }));
    await waitFor(() => expect(mocks.api.listOrganisationSecurityAuditEvents).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectAudit(new Error("stale security audit request failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale security audit request failed/i)).toBeNull();
  });

  it("does not let an older member removal clear the active organisation action state", async () => {
    mocks.currentUser = { email: "owner@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    mocks.api.listOrganisationMembers.mockImplementation(async ({ organisationId }: { organisationId: string }) => ({
      organisationId,
      members: [
        { uid: "owner-uid", email: "owner@example.test", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" },
        { uid: `member-${organisationId}`, email: `${organisationId}@example.test`, role: "member", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      hasMoreMembers: false,
      nextPageToken: null,
      scope: "organisation_member_roster" as const,
    }));
    let resolveFirst!: (value: { removed: boolean }) => void;
    let resolveSecond!: (value: { removed: boolean }) => void;
    mocks.api.removeOrganisationMember
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    vi.stubGlobal("confirm", vi.fn(() => true));

    render(<CloudWorkspace />);
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-1"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
    await waitFor(() => expect(mocks.api.removeOrganisationMember).toHaveBeenCalledWith({ organisationId: "org-1", targetUid: "member-org-1" }));

    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
    await waitFor(() => expect(mocks.api.removeOrganisationMember).toHaveBeenCalledWith({ organisationId: "org-2", targetUid: "member-org-2" }));

    resolveFirst({ removed: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove access" })).toHaveProperty("disabled", true));
    resolveSecond({ removed: true });
    await waitFor(() => expect(screen.getByText(/Organisation membership removed/i)).toBeTruthy());
  });

  it("resets unsaved member role selections when switching organisations", async () => {
    mocks.currentUser = { email: "owner@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    mocks.api.listOrganisationMembers.mockImplementation(async ({ organisationId }: { organisationId: string }) => ({
      organisationId,
      members: [
        { uid: "owner-uid", email: "owner@example.test", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" },
        { uid: "shared-uid", email: "shared@example.test", role: organisationId === "org-1" ? "member" : "viewer", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      hasMoreMembers: false,
      nextPageToken: null,
      scope: "organisation_member_roster" as const,
    }));

    render(<CloudWorkspace />);
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-1"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    const roleSelect = await screen.findByRole("combobox", { name: "Role for shared@example.test" });
    fireEvent.change(roleSelect, { target: { value: "admin" } });
    expect((roleSelect as HTMLSelectElement).value).toBe("admin");

    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-2"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Role for shared@example.test" }) as HTMLSelectElement).value).toBe("viewer"));
  });

  it("does not show a failed member roster request from a previous organisation", async () => {
    mocks.currentUser = { email: "owner@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    let rejectRoster!: (reason: Error) => void;
    mocks.api.listOrganisationMembers.mockImplementation(() => new Promise((_resolve, reject) => { rejectRoster = reject; }));
    render(<CloudWorkspace />);
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-1"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    await waitFor(() => expect(mocks.api.listOrganisationMembers).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectRoster(new Error("stale member roster request failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale member roster request failed/i)).toBeNull();
  });

  it("does not expose the security audit log controls to viewer roles", async () => {
    mocks.currentUser = { email: "viewer@example.test", uid: "viewer-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "viewer" }],
      hasMoreOrganisations: false,
    });
    render(<CloudWorkspace />);
    await screen.findByRole("option", { name: /Pilot Workspace.*viewer/ });
    expect(screen.queryByRole("button", { name: "Load audit log" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Security audit log" })).toBeNull();
  });

  it("exports the loaded security audit page as a scoped CSV", async () => {
    mocks.currentUser = { email: "pilot@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listOrganisationSecurityAuditEvents.mockResolvedValue({
      organisationId: "org-1",
      events: [{
        id: "audit-1", eventType: "lead.status_changed", actorUid: "owner-uid",
        resourceType: "lead", resourceId: "lead-1", outcome: "success",
        metadata: { leadStatus: "qualified" }, createdAt: "2026-10-25T12:00:00.000Z",
      }],
      hasMoreEvents: true, nextPageToken: "older-page", scope: "organisation_security_audit",
    });
    const createObjectURL = vi.fn((_blob: Blob) => "blob:audit-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load audit log" }));
    await screen.findByRole("table", { name: "Organisation security audit events" });
    fireEvent.click(screen.getByRole("button", { name: "Export loaded audit events (CSV)" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const exportedBlob = createObjectURL.mock.calls[0][0] as Blob;
    const csv = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(exportedBlob);
    });
    expect(csv).toContain("Loaded audit events only");
    expect(csv).toContain("lead.status_changed");
    expect(csv).toContain("owner-uid");
    expect(csv).toContain("leadStatus");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:audit-export");
    expect(await screen.findByText(/Older pages were not included unless loaded first/)).toBeTruthy();
  });


  it("keeps the active member roster loading state when an older organisation request fails", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    let rejectFirst!: (reason: Error) => void;
    let resolveSecond!: (value: {
      organisationId: string;
      members: Array<{ uid: string; email: string; role: string; createdAt: string }>;
      hasMoreMembers: boolean;
      nextPageToken: null;
      scope: "organisation_member_roster";
    }) => void;
    mocks.api.listOrganisationMembers
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    render(<CloudWorkspace />);
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-1"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    await waitFor(() => expect(mocks.api.listOrganisationMembers).toHaveBeenCalledWith({ organisationId: "org-1" }));

    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-2"));
    fireEvent.click(await screen.findByRole("button", { name: "Load member roster" }));
    await waitFor(() => expect(mocks.api.listOrganisationMembers).toHaveBeenCalledWith({ organisationId: "org-2" }));

    rejectFirst(new Error("stale member roster failure"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Loading members…" })).toBeTruthy());
    expect(screen.queryByText("stale member roster failure")).toBeNull();

    resolveSecond({
      organisationId: "org-2",
      members: [{ uid: "owner-2", email: "second@example.test", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" }],
      hasMoreMembers: false,
      nextPageToken: null,
      scope: "organisation_member_roster",
    });
    await waitFor(() => expect(screen.getByText("second@example.test")).toBeTruthy());
  });

  it("does not show a failed per-campaign funnel request from a previous organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Edinburgh", goal: "Recruit providers", status: "active", createdAt: null }],
      hasMoreCampaigns: false,
      nextPageToken: null,
    });
    let rejectSummary!: (reason: Error) => void;
    mocks.api.getCampaignFunnelSummary.mockImplementation(() => new Promise((_resolve, reject) => { rejectSummary = reject; }));
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load full counts" }));
    await waitFor(() => expect(mocks.api.getCampaignFunnelSummary).toHaveBeenCalledWith({
      organisationId: "org-1", campaignId: "campaign-1",
    }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectSummary(new Error("stale organisation analytics failure"));
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).value).toBe("org-2"));
    expect(screen.queryByText("stale organisation analytics failure")).toBeNull();
  });

  it("loads a bounded all-record campaign funnel chart independent of loaded lead pages", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [{ id: "campaign-1", name: "Roofers Leeds", brand: "AnyTrader", category: "Roofers", location: "Leeds", goal: "Pilot", status: "active", createdAt: null }],
      hasMoreCampaigns: false,
      nextPageToken: null,
    });
    mocks.api.getCampaignFunnelSummary.mockResolvedValue({
      organisationId: "org-1", campaignId: "campaign-1", totalLeadCount: 120,
      qualifiedLeadCount: 30, contactedLeadCount: 12, onboardedLeadCount: 4,
      qualifiedRatePercent: 25, onboardedRatePercent: 3.3, scope: "all_stored_campaign_leads",
    });

    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load full campaign chart" }));
    await waitFor(() => expect(mocks.api.getCampaignFunnelSummary).toHaveBeenCalledWith({
      organisationId: "org-1", campaignId: "campaign-1",
    }));
    const chart = await screen.findByRole("group", { name: "Full campaign funnel chart" });
    expect(chart.textContent).toContain("independent of loaded lead pages");
    expect(screen.getByRole("progressbar", { name: "Roofers Leeds all stored leads" }).getAttribute("value")).toBe("120");
    expect(screen.getByRole("progressbar", { name: "Roofers Leeds qualified leads (all stored)" }).getAttribute("value")).toBe("30");
    expect(screen.getByRole("progressbar", { name: "Roofers Leeds contacted leads (all stored)" }).getAttribute("value")).toBe("12");
    expect(screen.getByRole("progressbar", { name: "Roofers Leeds onboarded leads (all stored)" }).getAttribute("value")).toBe("4");
  });

  it("does not show a failed full campaign chart request from a previous organisation", async () => {
    mocks.currentUser = { email: "owner@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockResolvedValue({
      campaigns: [],
      hasMoreCampaigns: false,
      nextPageToken: null,
    });
    let rejectCampaigns!: (reason: Error) => void;
    render(<CloudWorkspace />);
    await screen.findByLabelText("Current organisation");
    mocks.api.listCampaigns.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCampaigns = reject; }));
    fireEvent.click(screen.getByRole("button", { name: "Load full campaign chart" }));
    await waitFor(() => expect(mocks.api.listCampaigns).toHaveBeenCalledWith({ organisationId: "org-1" }));
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    rejectCampaigns(new Error("stale full campaign chart request failed"));
    await waitFor(() => expect(screen.getByLabelText("Current organisation")).toHaveProperty("value", "org-2"));
    expect(screen.queryByText(/stale full campaign chart request failed/i)).toBeNull();
  });


  it("filters loaded security audit events by action and searchable identifiers", async () => {
    mocks.currentUser = { email: "pilot@example.test", uid: "owner-uid" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listOrganisationSecurityAuditEvents.mockResolvedValue({
      organisationId: "org-1",
      events: [
        {
          id: "audit-2", eventType: "lead.status_changed", actorUid: "owner-uid",
          resourceType: "lead", resourceId: "lead-2", outcome: "success",
          metadata: { leadStatus: "qualified" }, createdAt: "2026-10-25T12:00:00.000Z",
        },
        {
          id: "audit-1", eventType: "organisation.member_added", actorUid: "owner-uid",
          resourceType: "organisation", resourceId: "member-2", outcome: "success",
          metadata: { memberRole: "viewer" }, createdAt: "2026-10-24T12:00:00.000Z",
        },
      ],
      hasMoreEvents: false, nextPageToken: null, scope: "organisation_security_audit",
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load audit log" }));
    await screen.findByRole("table", { name: "Organisation security audit events" });
    expect(screen.getByRole("row", { name: /lead status changed/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /organisation member added/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter by action"), { target: { value: "organisation.member_added" } });
    expect(screen.queryByRole("row", { name: /lead status changed/ })).toBeNull();
    expect(screen.getByRole("row", { name: /organisation member added/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search loaded audit events"), { target: { value: "member-2" } });
    expect(screen.getByText(/1 matching event\(s\) from 2 loaded/)).toBeTruthy();
    expect(screen.getByText("memberRole: viewer")).toBeTruthy();
    expect(screen.queryByRole("row", { name: /lead status changed/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear audit filters" }));
    expect(screen.getByRole("row", { name: /lead status changed/ })).toBeTruthy();
    expect(screen.getByRole("row", { name: /organisation member added/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("From date (UTC)"), { target: { value: "2026-10-25" } });
    fireEvent.change(screen.getByLabelText("To date (UTC)"), { target: { value: "2026-10-25" } });
    expect(screen.getByText(/1 matching event\(s\) from 2 loaded/)).toBeTruthy();
    expect(screen.getByRole("row", { name: /lead status changed/ })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /organisation member added/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear audit filters" }));
    expect(screen.getByRole("row", { name: /organisation member added/ })).toBeTruthy();
  });

  it("shows and exports all-tenant lead completeness bands with a clear scope note", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.getLeadCompletenessSummary.mockResolvedValue({
      organisationId: "org-1",
      totalLeadCount: 9,
      lowCount: 2,
      mediumCount: 3,
      highCount: 3,
      unclassifiedCount: 1,
      scope: "all_stored_leads",
      note: "Completeness is not a quality, consent, or contactability guarantee.",
    });
    const createObjectURL = vi.fn(() => "blob:completeness");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load completeness report" }));
    await waitFor(() => expect(mocks.api.getLeadCompletenessSummary).toHaveBeenCalledWith({ organisationId: "org-1" }));
    expect(await screen.findByRole("table", { name: "All stored lead completeness bands" })).toBeTruthy();
    expect(screen.getAllByText("Low (0–39)").length).toBeGreaterThan(0);
    expect(screen.getByText(/not a quality, consent, or contactability guarantee/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Export completeness CSV" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:completeness");
  });

  it("loads all-tenant open lead aging counts and explains timestamp scope", async () => {
    mocks.currentUser = { uid: "owner-uid", email: "owner@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.getOpenLeadAgingSummary.mockResolvedValue({
      organisationId: "org-1",
      totalOpenLeadCount: 9,
      createdWithinSevenDays: 2,
      createdEightToThirtyDaysAgo: 3,
      createdThirtyOneToNinetyDaysAgo: 1,
      createdOverNinetyDaysAgo: 2,
      missingOrUnclassifiedCreatedAtCount: 1,
      scope: "all_stored_open_leads",
      note: "Includes new, reviewing, qualified, and contacted leads across all stored pages. Age is measured from createdAt, not last activity or last status change. Missing or invalid creation timestamps are unclassified. This report does not authorise contact.",
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load open lead aging report" }));
    await waitFor(() => expect(mocks.api.getOpenLeadAgingSummary).toHaveBeenCalledWith({ organisationId: "org-1" }));
    expect(await screen.findByRole("table", { name: "Open lead aging counts" })).toBeTruthy();
    expect(screen.getAllByText("0–7 days")).toHaveLength(2);
    expect(screen.getAllByText("8–30 days")).toHaveLength(2);
    expect(screen.getAllByText("31–90 days")).toHaveLength(2);
    expect(screen.getAllByText("Over 90 days")).toHaveLength(2);
    expect(screen.getByText(/age is measured from createdAt, not last activity or last status change/i)).toBeTruthy();
    expect(screen.getByText("Total open leads")).toBeTruthy();
  });

  it("selects the first 25 filtered loaded leads when more than 25 match", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: Array.from({ length: 26 }, (_, index) => ({
        id: `lead-${index + 1}`, campaignId: "campaign-1", businessName: `Bulk Candidate ${String(index + 1).padStart(2, "0")}`,
        category: "Painters", location: "Leeds", website: "", email: "", phone: "", source: "manual",
        status: "new", score: 40, scoreReasons: [], notes: "", doNotContact: true,
        contactRestrictionVerified: false, contactReviewStatus: "pending", createdAt: null,
      })),
      hasMoreLeads: false,
      nextPageToken: null,
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Select first 25 filtered loaded leads" }));
    expect(screen.getByText(/25.*selected; 25 match current filters/)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Select Bulk Candidate 01 for bulk status update" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Select Bulk Candidate 25 for bulk status update" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: "Select Bulk Candidate 26 for bulk status update" }) as HTMLInputElement).checked).toBe(false);
  });

  it("updates multiple selected leads with one idempotent request", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [
        { id: "bulk-1", campaignId: "campaign-1", businessName: "Bulk Painter A", category: "Painters", location: "Leeds", website: "", email: "", phone: "", source: "manual", status: "new", score: 40, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending", createdAt: null },
        { id: "bulk-2", campaignId: "campaign-1", businessName: "Bulk Painter B", category: "Painters", location: "York", website: "", email: "", phone: "", source: "manual", status: "new", score: 55, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending", createdAt: null },
      ],
      hasMoreLeads: false,
      nextPageToken: null,
    });
    mocks.api.bulkUpdateLeadStatus.mockResolvedValue({
      organisationId: "org-1", status: "qualified", updatedCount: 2, unchangedCount: 0, leadIds: ["bulk-1", "bulk-2"],
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Bulk Painter A for bulk status update" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bulk Painter B for bulk status update" }));
    expect(screen.getByText(/2.*selected; 2 match current filters/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update 2 selected lead(s)" }));
    await waitFor(() => expect(mocks.api.bulkUpdateLeadStatus).toHaveBeenCalledTimes(1));
    const payload = mocks.api.bulkUpdateLeadStatus.mock.calls[0][0];
    expect(payload.organisationId).toBe("org-1");
    expect(payload.leadIds).toEqual(["bulk-1", "bulk-2"]);
    expect(payload.status).toBe("qualified");
    expect(payload.idempotencyKey).toMatch(/^bulk-lead-status/);
  });


  it("bulk-updates only selected leads that still match the current filters", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [
        { id: "bulk-visible-1", campaignId: "campaign-1", businessName: "Visible Bulk Painter", category: "Painters", location: "Leeds", website: "", email: "", phone: "", source: "manual", status: "new", score: 40, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending", createdAt: null },
        { id: "bulk-hidden-2", campaignId: "campaign-1", businessName: "Hidden Bulk Decorator", category: "Decorators", location: "York", website: "", email: "", phone: "", source: "manual", status: "new", score: 55, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending", createdAt: null },
      ],
      hasMoreLeads: false,
      nextPageToken: null,
    });
    mocks.api.bulkUpdateLeadStatus.mockResolvedValue({
      organisationId: "org-1", status: "qualified", updatedCount: 1, unchangedCount: 0, leadIds: ["bulk-visible-1"],
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Visible Bulk Painter for bulk status update" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Hidden Bulk Decorator for bulk status update" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search leads" }), { target: { value: "Visible Bulk Painter" } });

    expect(screen.getByText(/2\/25 selected; 1 match current filters/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update 1 selected lead(s)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update 1 selected lead(s)" }));
    await waitFor(() => expect(mocks.api.bulkUpdateLeadStatus).toHaveBeenCalledTimes(1));
    expect(mocks.api.bulkUpdateLeadStatus.mock.calls[0][0].leadIds).toEqual(["bulk-visible-1"]);
  });

  it("keeps an uncertain bulk lead status retry bound to its organisation", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [
        { id: "bulk-retry-1", campaignId: "campaign-1", businessName: "Bulk Retry Painter A", category: "Painters", location: "Leeds", website: "", email: "", phone: "", source: "manual", status: "new", score: 40, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending", createdAt: null },
        { id: "bulk-retry-2", campaignId: "campaign-1", businessName: "Bulk Retry Painter B", category: "Painters", location: "York", website: "", email: "", phone: "", source: "manual", status: "new", score: 55, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending", createdAt: null },
      ],
      hasMoreLeads: false,
      nextPageToken: null,
    });
    mocks.api.bulkUpdateLeadStatus
      .mockRejectedValueOnce(new Error("Network request timed out"))
      .mockResolvedValueOnce({ organisationId: "org-1", status: "qualified", updatedCount: 2, unchangedCount: 0, leadIds: ["bulk-retry-1", "bulk-retry-2"] });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Bulk Retry Painter A for bulk status update" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bulk Retry Painter B for bulk status update" }));
    fireEvent.click(screen.getByRole("button", { name: "Update 2 selected lead(s)" }));
    await screen.findByText("Network request timed out");
    const firstPayload = mocks.api.bulkUpdateLeadStatus.mock.calls[0][0];
    expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Retry bulk update" }));
    await waitFor(() => expect(mocks.api.bulkUpdateLeadStatus).toHaveBeenCalledTimes(2));
    expect(mocks.api.bulkUpdateLeadStatus.mock.calls[1][0]).toEqual(firstPayload);
  });

  it("saves a tenant-scoped lead follow-up date", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [
        { organisationId: "org-1", name: "Pilot Workspace", role: "owner" },
        { organisationId: "org-2", name: "Second Workspace", role: "owner" },
      ],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [] });
    let currentFollowUpDate: string | null = null;
    const followUpLead = () => ({
      id: "lead-follow-up", campaignId: "campaign-1", businessName: "Follow-up Painter",
      category: "Painters", location: "Edinburgh", website: "", email: "", phone: "", source: "manual",
      status: "qualified", score: 30, scoreReasons: [], notes: "", doNotContact: true,
      contactRestrictionVerified: false, contactReviewStatus: "pending" as const, contactReviewRevision: 0,
      onboardedAt: null, followUpDate: currentFollowUpDate, createdAt: null,
    });
    mocks.api.listLeads.mockImplementation(async () => ({
      leads: [followUpLead()],
      hasMoreLeads: false,
      nextPageToken: null,
    }));
    let finishFollowUpSave: (() => void) | undefined;
    mocks.api.updateLeadFollowUpDate.mockImplementation(async ({ leadId, followUpDate }) => {
      await new Promise<void>((resolve) => { finishFollowUpSave = resolve; });
      currentFollowUpDate = followUpDate;
      return { leadId, followUpDate };
    });
    render(<CloudWorkspace />);
    const dateInput = await screen.findByLabelText("Follow-up date for Follow-up Painter");
    fireEvent.change(dateInput, { target: { value: "2026-11-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Save follow-up date" }));
    await waitFor(() => expect((screen.getByLabelText("Current organisation") as HTMLSelectElement).disabled).toBe(true));
    finishFollowUpSave?.();
    await waitFor(() => expect(mocks.api.updateLeadFollowUpDate).toHaveBeenCalledWith({
      organisationId: "org-1", leadId: "lead-follow-up", followUpDate: "2026-11-04",
    }));
    expect(await screen.findByText("Lead follow-up date saved.")).toBeTruthy();
    expect(await screen.findByText("Follow-up due 2026-11-04")).toBeTruthy();
  });



  it("filters the loaded lead directory into a follow-up queue with UTC day boundaries", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [] });
    const today = new Date().toISOString().slice(0, 10);
    const shiftUtcDay = (offset: number) => {
      const date = new Date(`${today}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const makeLead = (id: string, businessName: string, followUpDate: string | null) => ({
      id, campaignId: "campaign-1", businessName, category: "Painters", location: "Edinburgh",
      website: "", email: "", phone: "", source: "manual", status: "qualified" as const,
      score: 30, scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false,
      contactReviewStatus: "pending" as const, contactReviewRevision: 0, onboardedAt: null,
      followUpDate, createdAt: null,
    });
    mocks.api.listLeads.mockResolvedValue({
      leads: [
        makeLead("overdue", "Overdue Painter", shiftUtcDay(-1)),
        makeLead("today", "Today Painter", today),
        makeLead("upcoming", "Upcoming Painter", shiftUtcDay(1)),
        makeLead("unscheduled", "Unscheduled Painter", null),
      ],
      hasMoreLeads: false,
      nextPageToken: null,
    });
    render(<CloudWorkspace />);
    expect(await screen.findByText("Showing 4 of 4 loaded leads.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by follow-up" }), { target: { value: "overdue" } });
    expect(await screen.findByText("Showing 1 of 4 loaded leads.")).toBeTruthy();
    expect(screen.getByText("Overdue Painter")).toBeTruthy();
    expect(screen.queryByText("Today Painter")).toBeNull();
    expect(screen.queryByText("Upcoming Painter")).toBeNull();
    expect(screen.queryByText("Unscheduled Painter")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Showing 4 of 4 loaded leads.")).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort leads by" }), { target: { value: "follow-up" } });
    const businessRows = screen.getAllByRole("row").map((row) => row.textContent ?? "").filter((row) => row.includes("Painter"));
    expect(businessRows.map((row) => row.match(/Overdue Painter|Today Painter|Upcoming Painter|Unscheduled Painter/)?.[0])).toEqual([
      "Overdue Painter", "Today Painter", "Upcoming Painter", "Unscheduled Painter",
    ]);
  });

  it("loads server-counted campaign readiness and discloses the bounded campaign scope", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({
      organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }],
      hasMoreOrganisations: false,
    });
    mocks.api.getFullCampaignReadinessSummary.mockResolvedValue({
      organisationId: "org-1",
      campaigns: [{
        campaignId: "campaign-1",
        campaignName: "Painter pilot",
        campaignStatus: "active",
        status: "review_required",
        totalLeadCount: 12,
        pendingOrBlockedLeadCount: 2,
        suppressedLeadCount: 1,
        legacyReviewStatusLeadCount: 3,
        draftsAwaitingReview: 4,
        sourceAttributionMissingCount: 2,
        missingConfigurationFields: [],
      }],
      hasMoreCampaigns: true,
      campaignLimit: 20,
      scope: "server_counted_campaign_readiness",
      note: "Lead and draft counts are server-side for each returned campaign. At most 20 campaigns are included; if more exist, every row is marked incomplete. Missing or empty source labels are counted, but source labels remain self-declared and unverified. Pending, blocked, suppressed, and legacy/unclassified contact-review records require human review. This report never authorises or sends outreach.",
    });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Load server readiness" }));
    await waitFor(() => expect(mocks.api.getFullCampaignReadinessSummary).toHaveBeenCalledWith({ organisationId: "org-1" }));
    expect(await screen.findByRole("table", { name: "Server-counted campaign readiness" })).toBeTruthy();
    expect(screen.getByText("Painter pilot")).toBeTruthy();
    expect(screen.getByText("review required")).toBeTruthy();
    expect(screen.getByText(/first 20 campaigns; rows are marked incomplete/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export full readiness CSV" })).toBeTruthy();
  });


});
