/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
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
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => { mocks.authListener(); callback(mocks.currentUser); return () => undefined; },
  signInWithEmailAndPassword: mocks.signIn,
  signOut: mocks.signOut,
}));
import CloudWorkspace from "./CloudWorkspace";

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentUser = null;
  mocks.signIn.mockResolvedValue({}); mocks.register.mockResolvedValue({});
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

  it("loads only the selected organisation's cloud data after authentication", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listCampaigns.mockResolvedValue({ campaigns: [{ id: "campaign-1", name: "Painter pilot", brand: "AnyTrader", category: "Painters", location: "Manchester", goal: "Recruit providers", status: "active", createdAt: null }] });
    mocks.api.listLeads.mockResolvedValue({ leads: [{ id: "lead-1", campaignId: "campaign-1", businessName: "Synthetic Painting Co", category: "Painters", location: "Manchester", website: "", email: "", phone: "", source: "manual", status: "new", score: 40, scoreReasons: [], notes: "", doNotContact: false, createdAt: null }] });
    render(<CloudWorkspace />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Provider acquisition workspace" })).toBeTruthy());
    expect(await screen.findByText("Pilot Workspace · owner")).toBeTruthy();
    expect(await screen.findByText("Synthetic Painting Co")).toBeTruthy();
    expect(mocks.api.listLeads).toHaveBeenCalledWith({ organisationId: "org-1" });
    fireEvent.change(screen.getByLabelText("Notes for Synthetic Painting Co"), { target: { value: "Call after reviewing provider requirements." } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() => expect(mocks.api.updateLeadNotes).toHaveBeenCalledWith({ organisationId: "org-1", leadId: "lead-1", notes: "Call after reviewing provider requirements." }));
  });

  it("allows an authenticated user to edit a draft without sending it", async () => {
    mocks.currentUser = { email: "pilot@example.test" };
    mocks.api.listMyOrganisations.mockResolvedValue({ organisations: [{ organisationId: "org-1", name: "Pilot Workspace", role: "owner" }] });
    mocks.api.listOutreachDrafts.mockResolvedValue({ drafts: [{ id: "draft-1", leadId: "lead-1", campaignId: "campaign-1", subject: "Initial subject", body: "Initial body", status: "draft", createdAt: null }] });
    render(<CloudWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Draft subject"), { target: { value: "Updated subject" } });
    fireEvent.change(screen.getByLabelText("Draft body"), { target: { value: "Updated body for human review." } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.api.updateOutreachDraft).toHaveBeenCalledWith({ organisationId: "org-1", draftId: "draft-1", subject: "Updated subject", body: "Updated body for human review." }));
    expect(mocks.api.updateOutreachDraft).toHaveBeenCalledTimes(1);
  });

  it("offers account creation without weakening the required password length", () => {
    render(<CloudWorkspace />);
    fireEvent.click(screen.getByRole("button", { name: /Need an account/i }));
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement).minLength).toBe(6);
  });
});
