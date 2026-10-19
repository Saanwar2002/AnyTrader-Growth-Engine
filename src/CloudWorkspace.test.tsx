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
    listMyOrganisations: vi.fn(), createOrganisation: vi.fn(), createCampaign: vi.fn(), updateCampaignStatus: vi.fn(),
    listCampaigns: vi.fn(), listLeads: vi.fn(), createLead: vi.fn(), updateLeadContact: vi.fn(), updateLeadStatus: vi.fn(),
    updateLeadNotes: vi.fn(), setLeadSuppression: vi.fn(), createOutreachDraft: vi.fn(), listOutreachDrafts: vi.fn(),
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

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser = null;
  mocks.signIn.mockResolvedValue({}); mocks.googleSignIn.mockResolvedValue({}); mocks.register.mockResolvedValue({});
  mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [] });
  mocks.api.listCampaigns.mockResolvedValue({ campaigns: [] });
  mocks.api.listLeads.mockResolvedValue({ leads: [] });
  mocks.api.listOutreachDrafts.mockResolvedValue({ drafts: [] });
  mocks.api.createOrganisation.mockResolvedValue({ organisationId: "org-new", name: "New Org", role: "owner" });
  mocks.api.createCampaign.mockResolvedValue({ campaignId: "campaign-new", status: "active" });
  mocks.api.createLead.mockResolvedValue({ leadId: "lead-new", status: "new" });
  mocks.api.setLeadSuppression.mockResolvedValue({ leadId: "lead-1", doNotContact: true });
  mocks.api.createOutreachDraft.mockResolvedValue({ draftId: "draft-new", leadId: "lead-1", status: "draft", sent: false });
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

    render(<CloudWorkspace />);
    expect(await screen.findByText("First Tenant Private Lead")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Current organisation"), { target: { value: "org-2" } });
    expect(screen.queryByText("First Tenant Private Lead")).toBeNull();

    resolveSecondTenant({ leads: [] });
    await waitFor(() => expect(screen.queryByText("First Tenant Private Lead")).toBeNull());
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

  it("fails closed when a lead contact restriction cannot be verified", async () => {
    mocks.api.listLeads.mockResolvedValue({ leads: [{
      id: "lead-unverified", campaignId: "campaign-1", businessName: "Unverified Painter", category: "Painters",
      location: "Manchester", website: "", email: "", phone: "", source: "manual", status: "new",
      score: 40, scoreReasons: [], notes: "", doNotContact: false, contactRestrictionVerified: false, createdAt: null,
    }] });
    render(<CloudWorkspace api={mocks.api} />);
    await screen.findByText("Unverified Painter");
    expect(screen.getByText("REVIEW RESTRICTION")).toBeTruthy();
    expect(screen.getByRole("button", { name: /create draft/i })).toBeDisabled();
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

  it("offers account creation without weakening the required password length", () => {
    render(<CloudWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: /Need an account/i }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement).minLength).toBe(6);
  });
});
