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
    listMyOrganisations: vi.fn(), createOrganisation: vi.fn(), updateOrganisationSettings: vi.fn(), createCampaign: vi.fn(), updateCampaignStatus: vi.fn(), updateCampaignDetails: vi.fn(),
    listCampaigns: vi.fn(), listLeads: vi.fn(), createLead: vi.fn(), importLeads: vi.fn(), updateLeadContact: vi.fn(), updateLeadStatus: vi.fn(),
    updateLeadNotes: vi.fn(), setLeadSuppression: vi.fn(), createOutreachDraft: vi.fn(), suggestOutreachDraft: vi.fn(), listOutreachDrafts: vi.fn(),
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
  mocks.api.listCampaigns.mockResolvedValue({ campaigns: [] });
  mocks.api.listLeads.mockResolvedValue({ leads: [] });
  mocks.api.listOutreachDrafts.mockResolvedValue({ drafts: [] });
  mocks.api.createOrganisation.mockResolvedValue({ organisationId: "org-new", name: "New Org", role: "owner" });
  mocks.api.updateOrganisationSettings.mockImplementation(async ({ organisationId, name }) => ({ organisationId, name }));
  mocks.api.updateCampaignDetails.mockImplementation(async ({ campaignId, name, brand, category, location, goal }) => ({ campaignId, name, brand, category, location, goal }));
  mocks.api.createCampaign.mockResolvedValue({ campaignId: "campaign-new", status: "active" });
  mocks.api.updateCampaignStatus.mockImplementation(async ({ campaignId, status }) => ({ campaignId, status }));
  mocks.api.updateCampaignDetails.mockImplementation(async (payload) => payload);
  mocks.api.createLead.mockResolvedValue({ leadId: "lead-new", status: "new" });
  mocks.api.importLeads.mockResolvedValue({ organisationId: "org-1", campaignId: "campaign-1", received: 2, imported: 2, duplicatesSkipped: 0, leads: [{ leadId: "lead-csv-1", businessName: "Northside Painting" }, { leadId: "lead-csv-2", businessName: "City Decorators" }], sent: false, messageSentByThisAction: false });
  mocks.api.setLeadSuppression.mockResolvedValue({ leadId: "lead-1", doNotContact: true });
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
      source: "manual", status: "new", score: 20, scoreReasons: [], notes: "",
      doNotContact: false, contactRestrictionVerified: true, createdAt: null,
    };
    let resolveSecondTenant!: (value: { leads: typeof firstLead[] }) => void;
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
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    expect(screen.queryByText("First Tenant Private Lead")).toBeNull();
    expect(screen.queryByText("First Tenant Private Campaign")).toBeNull();

    resolveSecondTenant({ leads: [] });
    await waitFor(() => expect(screen.queryByText("First Tenant Private Lead")).toBeNull());
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
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listOutreachDrafts.mockResolvedValue({ drafts: [{ id: "draft-1", leadId: "lead-1", campaignId: "campaign-1", subject: "Initial subject", body: "Initial body", status: "draft", leadSuppressed: false, requiresReview: false, reviewReason: null, createdAt: null }] });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Save lead" }));

    const retryButton = await screen.findByRole("button", { name: "Retry save (same request)" });
    expect((screen.getByLabelText("Business name") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Campaign") as HTMLSelectElement).disabled).toBe(true);
    expect(retryButton).toBeTruthy();
    const firstPayload = mocks.api.createLead.mock.calls[0][0];
    expect(firstPayload.idempotencyKey).toMatch(/^manual-lead-[A-Za-z0-9-]+$/);
    expect(firstPayload.businessName).toBe("Retry-safe Painting Ltd");

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
      "businessName,category,location,email,phone\nNorthside Painting,Painters,Manchester,hello@northside.example,01610000001\nCity Decorators,Decorators,Salford,team@citydecorators.example,01610000002",
    ], "providers.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Source label (self-declared)"), { target: { value: "linkedin_csv" } });
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });

    expect(await screen.findByText("Northside Painting")).toBeTruthy();
    expect(screen.getByText("Preview — no records have been imported yet")).toBeTruthy();
    expect(mocks.api.importLeads).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Import 2 reviewed rows" }));
    await waitFor(() => expect(mocks.api.importLeads).toHaveBeenCalledTimes(1));
    const payload = mocks.api.importLeads.mock.calls[0][0];
    expect(payload.organisationId).toBe("org-1");
    expect(payload.campaignId).toBe("campaign-1");
    expect(payload.sourceLabel).toBe("linkedin_csv");
    expect(payload.idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(payload.leads).toEqual([
      { businessName: "Northside Painting", category: "Painters", location: "Manchester", website: "", email: "hello@northside.example", phone: "01610000001" },
      { businessName: "City Decorators", category: "Decorators", location: "Salford", website: "", email: "team@citydecorators.example", phone: "01610000002" },
    ]);
    expect(await screen.findByText(/2 imported, 0 duplicates skipped/i)).toBeTruthy();
    expect(screen.getByText(/nothing was sent/i)).toBeTruthy();
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
        { ...lead("lead-1", "Northside Painting", "Painters", "Manchester", "new"), website: "https://northside.example" },
        { ...lead("lead-2", "City Decorators", "Decorators", "Salford", "qualified"), campaignId: "campaign-2" },
      ],
    });

    render(<CloudWorkspace />);
    expect(await screen.findByText("Northside Painting")).toBeTruthy();
    expect(screen.getByText("City Decorators")).toBeTruthy();
    expect(screen.getByText("Showing 2 of 2 loaded leads.")).toBeTruthy();
    expect(screen.getByLabelText("Search leads").getAttribute("placeholder")).toBe("Business, category, location, website, email, or phone");

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "northside.example" } });
    expect(screen.getByText("Northside Painting")).toBeTruthy();
    expect(screen.queryByText("City Decorators")).toBeNull();
    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "" } });

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "salford" } });
    expect(screen.getByText("Showing 1 of 2 loaded leads.")).toBeTruthy();
    expect(screen.getByText("City Decorators")).toBeTruthy();
    expect(screen.queryByText("Northside Painting")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "qualified" } });
    expect(screen.getByText("City Decorators")).toBeTruthy();
    expect(screen.queryByText("Northside Painting")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search leads"), { target: { value: "no-such-provider" } });
    expect(screen.queryByText("City Decorators")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("No leads match these filters");

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
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
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
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
  });


  it("generates an AI suggestion for an eligible lead and requires review before saving", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Painter campaign", brand: "AnyTrader", category: "Painters", location: "Edinburgh", goal: "Recruit providers", status: "active", createdAt: null }] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-1", campaignId: "campaign-1", businessName: "North Star Painters", category: "Painters", location: "Edinburgh",
      website: "", email: "private@example.test", phone: "+44 131 555 0100", source: "manual", status: "new", score: 40,
      scoreReasons: [], notes: "private internal note", doNotContact: false, contactRestrictionVerified: true,
      contactReviewStatus: "cleared", contactReviewRevision: 1, createdAt: null,
    }] });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "AI draft suggestion" }));
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
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "existing-1", campaignId: "campaign-1", businessName: "Northside Painting", category: "Painters", location: "Manchester",
      website: "", email: "hello@northside.example", phone: "", source: "manual", status: "new", score: 20,
      scoreReasons: [], notes: "", doNotContact: true, contactRestrictionVerified: false, contactReviewStatus: "pending",
      contactReviewRevision: 0, createdAt: null,
    }] });
    render(<CloudWorkspace />);
    await screen.findByRole("heading", { name: "Provider acquisition workspace" });
    await screen.findByLabelText("Notes for Northside Painting");
    const file = new File([
      "businessName,category,location,email,phone\nNorthside Painting,Painters,Manchester,hello@northside.example,01610000001\nFresh Decorators,Decorators,Salford,team@fresh.example,01610000002",
    ], "providers.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } });
    expect(await screen.findByText(/1 possible duplicate row/)).toBeTruthy();
    expect(screen.getByText(/Possible duplicate: email matches loaded lead/)).toBeTruthy();
    expect(screen.getByText("Fresh Decorators")).toBeTruthy();
    expect(mocks.api.importLeads).not.toHaveBeenCalled();
  });


  it("lets an owner rename the selected workspace through the server API", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    render(<CloudWorkspace />);
    const nameInput = await screen.findByLabelText("Organisation display name");
    fireEvent.change(nameInput, { target: { value: "Renamed Workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Save workspace settings" }));
    await waitFor(() => expect(mocks.api.updateOrganisationSettings).toHaveBeenCalledWith({ organisationId: "org-1", name: "Renamed Workspace" }));
    expect(await screen.findByText("Organisation settings saved.")).toBeTruthy();
    expect(await screen.findByRole("option", { name: "Renamed Workspace · owner" })).toBeTruthy();
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

});
