import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from "firebase/auth";
import { createFirebaseCallableInvoker, createGrowthEngineApi, type CampaignFunnelAnalyticsSummary, type LeadSourceFunnelAnalytics, type CampaignSummary, type CsvImportSourceLabel, type LeadSummary, type OrganisationSummary, type OffboardingPreviewResult, type OnboardingCohortAnalytics, type OutreachDraftSummary, type ServerLeadStatus } from "./backendApi";
import { firebaseClient } from "./firebaseClient";
import { findLeadCsvDuplicates, formatLeadSourceLabel, getContactRestrictionAction, parseLeadCsv, serializeLeadExportCsv } from "./domain";
import { serializeCampaignPerformanceCsv, summarizeCampaignPerformance, summarizeLeadSourcePerformance } from "./analytics";
import "./cloudWorkspace.css";

const leadStatuses: ServerLeadStatus[] = ["new", "reviewing", "qualified", "contacted", "onboarded", "rejected"];
const statusLabel = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);
const readableError = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed. Please try again.";
const createIdempotencyKey = (prefix: string) => {
  const randomPart = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomPart}`;
};

export default function CloudWorkspace() {
  const client = firebaseClient;
  const api = useMemo(() => client ? createGrowthEngineApi(createFirebaseCallableInvoker(client.functions)) : null, [client]);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [organisations, setOrganisations] = useState<OrganisationSummary[]>([]);
  const [hasMoreOrganisations, setHasMoreOrganisations] = useState(false);
  const [nextOrganisationPageToken, setNextOrganisationPageToken] = useState<string | null>(null);
  const [loadingMoreOrganisations, setLoadingMoreOrganisations] = useState(false);
  const [organisationId, setOrganisationId] = useState("");
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [hasMoreCampaigns, setHasMoreCampaigns] = useState(false);
  const [nextCampaignPageToken, setNextCampaignPageToken] = useState<string | null>(null);
  const [loadingMoreCampaigns, setLoadingMoreCampaigns] = useState(false);
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [hasMoreLeads, setHasMoreLeads] = useState(false);
  const [nextLeadPageToken, setNextLeadPageToken] = useState<string | null>(null);
  const [loadingMoreLeads, setLoadingMoreLeads] = useState(false);
  const [exportingAllLeads, setExportingAllLeads] = useState(false);
  const [leadNotes, setLeadNotes] = useState<Record<string, string>>({});
  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");
  const [leadCampaignFilter, setLeadCampaignFilter] = useState("all");
  const [drafts, setDrafts] = useState<OutreachDraftSummary[]>([]);
  const [hasMoreDrafts, setHasMoreDrafts] = useState(false);
  const [nextDraftPageToken, setNextDraftPageToken] = useState<string | null>(null);
  const [loadingMoreDrafts, setLoadingMoreDrafts] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftCreationKeys, setDraftCreationKeys] = useState<Record<string, string>>({});
  const [aiDraftBusyLeadId, setAiDraftBusyLeadId] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [organisationSettingsName, setOrganisationSettingsName] = useState("");
  const [offboardingPreview, setOffboardingPreview] = useState<OffboardingPreviewResult | null>(null);
  const [onboardingCohortSummary, setOnboardingCohortSummary] = useState<OnboardingCohortAnalytics | null>(null);
  const [loadingOnboardingCohorts, setLoadingOnboardingCohorts] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"member" | "viewer">("member");
  const [memberAdditionIdempotencyKey, setMemberAdditionIdempotencyKey] = useState("");
  // Preserve the exact organisation request key after an uncertain response.
  const [organisationIdempotencyKey, setOrganisationIdempotencyKey] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignBrand, setCampaignBrand] = useState("AnyTrader");
  const [campaignCategory, setCampaignCategory] = useState("Painters & decorators");
  const [campaignLocation, setCampaignLocation] = useState("Manchester, UK");
  const [campaignGoal, setCampaignGoal] = useState("Recruit reliable providers");
  // Preserve the exact campaign request key and fields after uncertain failures.
  const [campaignIdempotencyKey, setCampaignIdempotencyKey] = useState("");
  const [editingCampaignId, setEditingCampaignId] = useState("");
  const [campaignEditFields, setCampaignEditFields] = useState({ name: "", brand: "", category: "", location: "", goal: "" });
  const [leadCampaignId, setLeadCampaignId] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadCategory, setLeadCategory] = useState("Painters & decorators");
  const [leadLocation, setLeadLocation] = useState("Manchester, UK");
  const [leadWebsite, setLeadWebsite] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  // Keep one key for an uncertain manual-save attempt until success, so a retry is identical.
  const [leadIdempotencyKey, setLeadIdempotencyKey] = useState("");
  const [csvCampaignId, setCsvCampaignId] = useState("");
  const [csvSourceLabel, setCsvSourceLabel] = useState<CsvImportSourceLabel>("csv_import");
  const [csvAttemptSourceLabel, setCsvAttemptSourceLabel] = useState<CsvImportSourceLabel | "">("");
  const [csvFilename, setCsvFilename] = useState("");
  const [csvRows, setCsvRows] = useState<Array<Record<string, string>>>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvIdempotencyKey, setCsvIdempotencyKey] = useState("");
  // Once an import is attempted, preserve its campaign alongside the idempotency key.
  // A timed-out response may still have committed server-side, so retries must be identical.
  const [csvAttemptCampaignId, setCsvAttemptCampaignId] = useState("");
  const [csvImportBusy, setCsvImportBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverCampaignAnalytics, setServerCampaignAnalytics] = useState<Record<string, CampaignFunnelAnalyticsSummary>>({});
  const [loadingCampaignAnalyticsKey, setLoadingCampaignAnalyticsKey] = useState("");
  const [serverSourceAnalytics, setServerSourceAnalytics] = useState<LeadSourceFunnelAnalytics | null>(null);
  const [loadingSourceAnalyticsOrganisationId, setLoadingSourceAnalyticsOrganisationId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const workspaceLoadIdRef = useRef(0);
  const organisationListLoadIdRef = useRef(0);
  const currentOrganisationIdRef = useRef(organisationId);
  currentOrganisationIdRef.current = organisationId;
  useEffect(() => {
    setOrganisationSettingsName(organisations.find((org) => org.organisationId === organisationId)?.name ?? "");
  }, [organisationId, organisations]);

  const selectedOrganisationRole = organisations.find((org) => org.organisationId === organisationId)?.role ?? "";
  const canClearContactRestriction = selectedOrganisationRole === "owner" || selectedOrganisationRole === "admin";

  useEffect(() => {
    if (!client) { setAuthReady(true); return; }
    return onAuthStateChanged(client.auth, (nextUser) => { setUser(nextUser); setAuthReady(true); });
  }, [client]);

  const refreshOrganisations = useCallback(async () => {
    if (!api) return;
    const requestId = ++organisationListLoadIdRef.current;
    setLoadingMoreOrganisations(false);
    const result = await api.listMyOrganisations();
    if (requestId !== organisationListLoadIdRef.current) return;
    setOrganisations(result.organisations);
    setHasMoreOrganisations(result.hasMoreOrganisations === true);
    setNextOrganisationPageToken(result.nextPageToken ?? null);
    setOrganisationId((current) => result.organisations.some((org) => org.organisationId === current) ? current : result.organisations[0]?.organisationId ?? "");
  }, [api]);

  const loadMoreOrganisations = useCallback(async () => {
    if (!api || !nextOrganisationPageToken || loadingMoreOrganisations) return;
    const requestId = organisationListLoadIdRef.current;
    setLoadingMoreOrganisations(true);
    setError("");
    try {
      const result = await api.listMyOrganisations(nextOrganisationPageToken);
      if (requestId !== organisationListLoadIdRef.current) return;
      setOrganisations((current) => {
        const known = new Set(current.map((org) => org.organisationId));
        return [...current, ...result.organisations.filter((org) => !known.has(org.organisationId))];
      });
      setHasMoreOrganisations(result.hasMoreOrganisations === true);
      setNextOrganisationPageToken(result.nextPageToken ?? null);
    } catch (reason) {
      if (requestId === organisationListLoadIdRef.current) setError(readableError(reason));
    } finally {
      if (requestId === organisationListLoadIdRef.current) setLoadingMoreOrganisations(false);
    }
  }, [api, nextOrganisationPageToken, loadingMoreOrganisations]);

  const refreshWorkspace = useCallback(async (orgId: string) => {
    const requestId = ++workspaceLoadIdRef.current;
    if (!api || !orgId) {
      setCampaigns([]); setHasMoreCampaigns(false); setNextCampaignPageToken(null); setLoadingMoreCampaigns(false); setLeads([]); setHasMoreLeads(false); setNextLeadPageToken(null); setLoadingMoreLeads(false); setLeadNotes({}); setDrafts([]); setHasMoreDrafts(false); setNextDraftPageToken(null); setLoadingMoreDrafts(false);
      setEditingDraftId(""); setDraftSubject(""); setDraftBody("");
      return;
    }
    // Clear the previous tenant's visible records immediately while the newly
    // selected organisation is loading; do not leave old data on screen.
    setCampaigns([]); setHasMoreCampaigns(false); setNextCampaignPageToken(null); setLoadingMoreCampaigns(false); setLeads([]); setHasMoreLeads(false); setNextLeadPageToken(null); setLoadingMoreLeads(false); setLeadNotes({}); setDrafts([]); setHasMoreDrafts(false); setNextDraftPageToken(null); setLoadingMoreDrafts(false);
    setEditingDraftId(""); setDraftSubject(""); setDraftBody("");
    const [campaignResult, leadResult, draftResult] = await Promise.all([
      api.listCampaigns({ organisationId: orgId }), api.listLeads({ organisationId: orgId }), api.listOutreachDrafts({ organisationId: orgId }),
    ]);
    // Ignore stale responses so a slow request from a previous tenant cannot replace
    // the currently selected organisation's data after a switch or sign-out.
    if (requestId !== workspaceLoadIdRef.current || orgId !== currentOrganisationIdRef.current) return;
    setCampaigns(campaignResult.campaigns); setHasMoreCampaigns(campaignResult.hasMoreCampaigns === true); setNextCampaignPageToken(campaignResult.nextPageToken ?? null);
    setLeads(leadResult.leads); setHasMoreLeads(leadResult.hasMoreLeads === true); setNextLeadPageToken(leadResult.nextPageToken ?? null);
    setLeadNotes(Object.fromEntries(leadResult.leads.map((lead) => [lead.id, lead.notes ?? ""])));
    setDrafts(draftResult.drafts); setHasMoreDrafts(draftResult.hasMoreDrafts === true); setNextDraftPageToken(draftResult.nextPageToken ?? null);
    setLeadCampaignId((current) => campaignResult.campaigns.some((campaign) => campaign.id === current) ? current : campaignResult.campaigns[0]?.id ?? "");
    setCsvCampaignId((current) => campaignResult.campaigns.some((campaign) => campaign.id === current) ? current : campaignResult.campaigns[0]?.id ?? "");
  }, [api]);

  const loadMoreCampaigns = useCallback(async () => {
    if (!api || !organisationId || !nextCampaignPageToken || loadingMoreCampaigns) return;
    const requestId = workspaceLoadIdRef.current;
    const requestedOrganisationId = organisationId;
    setLoadingMoreCampaigns(true); setError("");
    try {
      const result = await api.listCampaigns({ organisationId: requestedOrganisationId, pageToken: nextCampaignPageToken });
      if (requestId !== workspaceLoadIdRef.current || requestedOrganisationId !== currentOrganisationIdRef.current) return;
      setCampaigns((current) => {
        const known = new Set(current.map((campaign) => campaign.id));
        return [...current, ...result.campaigns.filter((campaign) => !known.has(campaign.id))];
      });
      setHasMoreCampaigns(result.hasMoreCampaigns === true);
      setNextCampaignPageToken(result.nextPageToken ?? null);
    } catch (reason) {
      if (requestId === workspaceLoadIdRef.current) setError(readableError(reason));
    } finally {
      if (requestId === workspaceLoadIdRef.current) setLoadingMoreCampaigns(false);
    }
  }, [api, organisationId, nextCampaignPageToken, loadingMoreCampaigns]);

  const loadMoreLeads = useCallback(async () => {
    if (!api || !organisationId || !nextLeadPageToken || loadingMoreLeads) return;
    const requestId = workspaceLoadIdRef.current;
    const requestedOrganisationId = organisationId;
    setLoadingMoreLeads(true); setError("");
    try {
      const result = await api.listLeads({ organisationId: requestedOrganisationId, pageToken: nextLeadPageToken });
      if (requestId !== workspaceLoadIdRef.current || requestedOrganisationId !== currentOrganisationIdRef.current) return;
      setLeads((current) => {
        const known = new Set(current.map((lead) => lead.id));
        return [...current, ...result.leads.filter((lead) => !known.has(lead.id))];
      });
      setLeadNotes((current) => ({ ...current, ...Object.fromEntries(result.leads.map((lead) => [lead.id, lead.notes ?? ""])) }));
      setHasMoreLeads(result.hasMoreLeads === true); setNextLeadPageToken(result.nextPageToken ?? null);
    } catch (reason) {
      if (requestId === workspaceLoadIdRef.current) setError(readableError(reason));
    } finally {
      if (requestId === workspaceLoadIdRef.current) setLoadingMoreLeads(false);
    }
  }, [api, organisationId, nextLeadPageToken, loadingMoreLeads]);

  const loadMoreDrafts = useCallback(async () => {
    if (!api || !organisationId || !nextDraftPageToken || loadingMoreDrafts) return;
    const requestId = workspaceLoadIdRef.current;
    const requestedOrganisationId = organisationId;
    setLoadingMoreDrafts(true); setError("");
    try {
      const result = await api.listOutreachDrafts({ organisationId: requestedOrganisationId, pageToken: nextDraftPageToken });
      if (requestId !== workspaceLoadIdRef.current || requestedOrganisationId !== currentOrganisationIdRef.current) return;
      setDrafts((current) => {
        const known = new Set(current.map((draft) => draft.id));
        return [...current, ...result.drafts.filter((draft) => !known.has(draft.id))];
      });
      setHasMoreDrafts(result.hasMoreDrafts === true); setNextDraftPageToken(result.nextPageToken ?? null);
    } catch (reason) {
      if (requestId === workspaceLoadIdRef.current) setError(readableError(reason));
    } finally {
      if (requestId === workspaceLoadIdRef.current) setLoadingMoreDrafts(false);
    }
  }, [api, organisationId, nextDraftPageToken, loadingMoreDrafts]);

  useEffect(() => {
    if (!user || !api) {
      workspaceLoadIdRef.current += 1;
      organisationListLoadIdRef.current += 1;
      setOrganisations([]); setHasMoreOrganisations(false); setNextOrganisationPageToken(null); setLoadingMoreOrganisations(false); setOrganisationId("");
      setCampaigns([]); setHasMoreCampaigns(false); setNextCampaignPageToken(null); setLoadingMoreCampaigns(false); setLeads([]); setHasMoreLeads(false); setNextLeadPageToken(null); setLoadingMoreLeads(false); setLeadNotes({}); setDrafts([]); setHasMoreDrafts(false); setNextDraftPageToken(null); setLoadingMoreDrafts(false);
      return;
    }
    void refreshOrganisations().catch((reason: unknown) => setError(readableError(reason)));
  }, [user, api, refreshOrganisations]);

  useEffect(() => {
    if (!organisationId) {
      workspaceLoadIdRef.current += 1;
      setCampaigns([]); setHasMoreCampaigns(false); setNextCampaignPageToken(null); setLoadingMoreCampaigns(false); setLeads([]); setHasMoreLeads(false); setNextLeadPageToken(null); setLoadingMoreLeads(false); setLeadNotes({}); setDrafts([]); setHasMoreDrafts(false); setNextDraftPageToken(null); setLoadingMoreDrafts(false);
      return;
    }
    void refreshWorkspace(organisationId).catch((reason: unknown) => setError(readableError(reason)));
  }, [organisationId, refreshWorkspace]);

  async function runAction(action: () => Promise<unknown>, success: string, refresh = true) {
    setBusy(true); setError(""); setNotice("");
    try {
      await action();
      setNotice(success);
      if (refresh && organisationId) await refreshWorkspace(organisationId);
    } catch (reason) { setError(readableError(reason)); }
    finally { setBusy(false); }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setAuthBusy(true); setError("");
    try {
      if (registerMode) await createUserWithEmailAndPassword(client.auth, email.trim(), password);
      else await signInWithEmailAndPassword(client.auth, email.trim(), password);
    } catch (reason) { setError(readableError(reason)); }
    finally { setAuthBusy(false); }
  }

  async function signInWithGoogle() {
    if (!client) return;
    setAuthBusy(true); setError(""); setNotice("");
    try {
      // Firebase verifies the Google identity; application permissions still come from server-side organisation membership.
      await signInWithPopup(client.auth, new GoogleAuthProvider());
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setAuthBusy(false);
    }
  }

  async function createOrganisation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !organisationName.trim()) return;
    const idempotencyKey = organisationIdempotencyKey || createIdempotencyKey("organisation-create");
    if (!organisationIdempotencyKey) setOrganisationIdempotencyKey(idempotencyKey);
    await runAction(async () => {
      await api.createOrganisation({ name: organisationName.trim(), idempotencyKey });
      // A successful response clears the key; uncertain failures retain it for retry.
      setOrganisationIdempotencyKey("");
      setOrganisationName("");
      await refreshOrganisations();
    }, organisationIdempotencyKey ? "Organisation created after retry." : "Organisation created.", false);
  }

  async function saveOrganisationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !organisationId || !organisationSettingsName.trim()) return;
    await runAction(async () => {
      const result = await api.updateOrganisationSettings({ organisationId, name: organisationSettingsName.trim() });
      setOrganisations((current) => current.map((org) => org.organisationId === result.organisationId ? { ...org, name: result.name } : org));
    }, "Organisation settings saved.");
  }

  async function loadOffboardingPreview() {
    if (!api || !organisationId || selectedOrganisationRole !== "owner") return;
    const requestedOrganisationId = organisationId;
    await runAction(async () => {
      const result = await api.previewOrganisationOffboarding({ organisationId: requestedOrganisationId });
      if (currentOrganisationIdRef.current === requestedOrganisationId) setOffboardingPreview(result);
    }, "Read-only offboarding preview refreshed.", false);
  }

  async function addOrganisationMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !organisationId || !memberEmail.trim()) return;
    const idempotencyKey = memberAdditionIdempotencyKey || createIdempotencyKey("organisation-member-add");
    if (!memberAdditionIdempotencyKey) setMemberAdditionIdempotencyKey(idempotencyKey);
    await runAction(async () => {
      await api.addOrganisationMember({
        organisationId,
        targetEmail: memberEmail.trim().toLowerCase(),
        role: memberRole,
        idempotencyKey,
      });
      setMemberAdditionIdempotencyKey("");
      setMemberEmail("");
      setMemberRole("member");
    }, memberAdditionIdempotencyKey ? "Member added after retry." : "Member added.");
  }

  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !organisationId) return;
    const idempotencyKey = campaignIdempotencyKey || createIdempotencyKey("campaign-create");
    if (!campaignIdempotencyKey) setCampaignIdempotencyKey(idempotencyKey);
    const payload = {
      organisationId,
      idempotencyKey,
      name: campaignName.trim(),
      brand: campaignBrand.trim(),
      category: campaignCategory.trim(),
      location: campaignLocation.trim(),
      goal: campaignGoal.trim(),
    };
    await runAction(async () => {
      await api.createCampaign(payload);
      // Only clear the key after the server confirms success. If the response is
      // lost, the same payload/key can safely be retried.
      setCampaignIdempotencyKey("");
      setCampaignName("");
    }, campaignIdempotencyKey ? "Campaign saved after retry." : "Campaign created.");
  }

  async function changeCampaignStatus(campaign: CampaignSummary, status: "active" | "paused" | "completed") {
    if (!api || !organisationId || campaign.status === status) return;
    await runAction(async () => {
      await api.updateCampaignStatus({ organisationId, campaignId: campaign.id, status });
      setCampaigns((current) => current.map((item) => item.id === campaign.id ? { ...item, status } : item));
    }, status === "paused" ? "Campaign paused." : status === "completed" ? "Campaign marked complete." : "Campaign activated.");
  }

  async function saveCampaignDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !organisationId || !editingCampaignId) return;
    const payload = {
      organisationId, campaignId: editingCampaignId,
      name: campaignEditFields.name.trim(), brand: campaignEditFields.brand.trim(),
      category: campaignEditFields.category.trim(), location: campaignEditFields.location.trim(),
      goal: campaignEditFields.goal.trim(),
    };
    await runAction(async () => {
      const result = await api.updateCampaignDetails(payload);
      setCampaigns((current) => current.map((campaign) => campaign.id === result.campaignId
        ? { ...campaign, name: result.name, brand: result.brand, category: result.category, location: result.location, goal: result.goal }
        : campaign));
      setEditingCampaignId("");
    }, "Campaign details saved.");
  }

  async function createDraftForLead(lead: LeadSummary) {
    if (!api || !organisationId || busy) return;
    const existingKey = draftCreationKeys[lead.id];
    const idempotencyKey = existingKey || createIdempotencyKey("outreach-draft");
    if (!existingKey) setDraftCreationKeys((current) => ({ ...current, [lead.id]: idempotencyKey }));
    const payload = {
      organisationId,
      leadId: lead.id,
      subject: `Provider network opportunity for ${lead.businessName}`,
      body: `Hello ${lead.businessName},

We are building a trusted local provider network and would like to share details about joining. Please review and personalise this draft before any use.

Kind regards,
${selectedOrganisation?.name ?? "Your local provider network"}

DRAFT ONLY — NOT SENT.`,
      idempotencyKey,
    };
    await runAction(async () => {
      await api.createOutreachDraft(payload);
      setDraftCreationKeys((current) => { const next = { ...current }; delete next[lead.id]; return next; });
    }, existingKey ? "Draft saved after retry. Nothing was sent." : "Draft saved. Nothing was sent.");
  }

  async function suggestAiDraftForLead(lead: LeadSummary) {
    if (!api || !organisationId || busy || editingDraftId || aiDraftBusyLeadId) return;
    setAiDraftBusyLeadId(lead.id); setError(""); setNotice("");
    try {
      const suggestion = await api.suggestOutreachDraft({ organisationId, leadId: lead.id });
      setEditingDraftId(`new:${lead.id}`);
      setDraftSubject(suggestion.subject);
      setDraftBody(suggestion.body);
      setNotice("AI suggestion ready. Review and edit it before saving; nothing has been sent.");
    } catch (reason) { setError(readableError(reason)); }
    finally { setAiDraftBusyLeadId(""); }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !organisationId || !editingDraftId) return;
    if (editingDraftId.startsWith("new:")) {
      const leadId = editingDraftId.slice(4);
      if (!leadId) return;
      const existingKey = draftCreationKeys[leadId];
      const idempotencyKey = existingKey || createIdempotencyKey("outreach-draft");
      if (!existingKey) setDraftCreationKeys((current) => ({ ...current, [leadId]: idempotencyKey }));
      await runAction(async () => {
        await api.createOutreachDraft({ organisationId, leadId, subject: draftSubject.trim(), body: draftBody.trim(), idempotencyKey });
        setDraftCreationKeys((current) => { const next = { ...current }; delete next[leadId]; return next; });
        setEditingDraftId(""); setDraftSubject(""); setDraftBody("");
      }, existingKey ? "Draft saved after retry. Nothing was sent." : "AI-assisted draft saved. Nothing was sent.");
      return;
    }
    await runAction(async () => {
      await api.updateOutreachDraft({ organisationId, draftId: editingDraftId, subject: draftSubject.trim(), body: draftBody.trim() });
      setEditingDraftId(""); setDraftSubject(""); setDraftBody("");
    }, "Draft updated. Nothing was sent.");
  }

  async function previewLeadCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setCsvRows([]); setCsvErrors([]); setCsvFilename(""); setCsvIdempotencyKey(""); setCsvAttemptCampaignId(""); setCsvAttemptSourceLabel("");
    if (!file) return;
    if (file.size > 1024 * 1024) { setCsvErrors(["CSV file must be 1 MB or smaller."]); return; }
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") { setCsvErrors(["Choose a .csv file."]); return; }
    try {
      const parsed = parseLeadCsv(await file.text());
      setCsvFilename(file.name);
      setCsvErrors(parsed.errors);
      if (parsed.rows.length > 25) {
        setCsvRows([]);
        setCsvErrors([...parsed.errors, `This file has ${parsed.rows.length} valid rows. Import is limited to 25 rows at a time; split the file and upload a smaller CSV.`]);
        return;
      }
      const rows = parsed.rows.filter((row) => row.businessname?.trim());
      setCsvRows(rows);
      if (rows.length > 0) {
        const key = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `csv-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
        setCsvIdempotencyKey(key);
      }
    } catch {
      setCsvErrors(["The CSV could not be read. Please choose a valid text CSV file."]);
    }
  }

  async function importReviewedCsv() {
    if (!api || !organisationId || !csvCampaignId || !csvIdempotencyKey || csvRows.length < 1 || csvRows.length > 25 || csvImportBusy) return;
    const importCampaignId = csvAttemptCampaignId || csvCampaignId;
    const importSourceLabel = csvAttemptSourceLabel || csvSourceLabel;
    setCsvAttemptCampaignId(importCampaignId);
    setCsvAttemptSourceLabel(importSourceLabel);
    setCsvImportBusy(true); setError(""); setNotice("");
    try {
      const result = await api.importLeads({
        organisationId, campaignId: importCampaignId, idempotencyKey: csvIdempotencyKey,
        ...(importSourceLabel !== "csv_import" ? { sourceLabel: importSourceLabel } : {}),
        leads: csvRows.map((row) => ({
          businessName: row.businessname.trim(), category: row.category?.trim() ?? "",
          location: row.location?.trim() ?? "", website: row.website?.trim() ?? "",
          email: row.email?.trim() ?? "", phone: row.phone?.trim() ?? "",
        })),
      });
      setNotice(`CSV import complete: ${result.imported} imported, ${result.duplicatesSkipped} duplicates skipped. All imported leads remain suppressed for review; nothing was sent.`);
      setCsvRows([]); setCsvErrors([]); setCsvFilename(""); setCsvIdempotencyKey(""); setCsvAttemptCampaignId("");
      await refreshWorkspace(organisationId);
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setCsvImportBusy(false);
    }
  }

  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!api || !organisationId || !leadCampaignId || busy) return;
    const idempotencyKey = leadIdempotencyKey || createIdempotencyKey("manual-lead");
    if (!leadIdempotencyKey) setLeadIdempotencyKey(idempotencyKey);
    const payload = {
      organisationId,
      campaignId: leadCampaignId,
      idempotencyKey,
      businessName: leadName.trim(),
      category: leadCategory.trim(),
      location: leadLocation.trim(),
      website: leadWebsite.trim(),
      email: leadEmail.trim(),
      phone: leadPhone.trim(),
    };
    setBusy(true); setError(""); setNotice("");
    try {
      await api.createLead(payload);
      // Only a confirmed successful response clears the retry key. Failed/uncertain
      // requests retain both the payload and key for an exact retry.
      setLeadIdempotencyKey("");
      setLeadName(""); setLeadWebsite(""); setLeadEmail(""); setLeadPhone("");
      setNotice("Lead saved securely to the selected organisation. It remains suppressed pending human review.");
      try {
        await refreshWorkspace(organisationId);
      } catch {
        setError("The lead was saved, but the workspace could not refresh. Your lead is retained; reload the workspace to view it.");
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!client || !api) return <main className="cloud-shell"><section className="cloud-card"><h1>Firebase is not configured</h1><p>Cloud mode is disabled. Keep using the clearly labelled synthetic-data demo until a dedicated Growth Engine Firebase project is configured in a local <code>.env.local</code> file.</p></section></main>;
  if (!authReady) return <main className="cloud-shell"><section className="cloud-card"><p>Checking sign-in status…</p></section></main>;
  if (!user) return <main className="cloud-shell"><section className="cloud-card auth-card"><div className="cloud-brand">AT <span>Growth Engine</span></div><p className="cloud-eyebrow">SECURE WORKSPACE</p><h1>{registerMode ? "Create your account" : "Sign in to Growth Engine"}</h1><p className="cloud-muted">This connects to the dedicated Firebase project configured for this app, not production AnyTrader.</p><form className="cloud-form" onSubmit={(event) => void submitAuth(event)}><label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete={registerMode ? "new-password" : "current-password"} minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="cloud-primary" disabled={authBusy}>{authBusy ? "Please wait…" : registerMode ? "Create account" : "Sign in"}</button></form><div className="cloud-auth-divider"><span>or</span></div><button type="button" className="cloud-google-button" disabled={authBusy} onClick={() => void signInWithGoogle()}><span aria-hidden="true" className="cloud-google-mark">G</span>{authBusy ? "Please wait…" : "Continue with Google"}</button><button className="cloud-link" onClick={() => { setRegisterMode((value) => !value); setError(""); }}>{registerMode ? "Already have an account? Sign in" : "Need an account? Create one"}</button>{error && <p className="cloud-error" role="alert">{error}</p>}<p className="cloud-footnote">Use synthetic/test data only until emulator-backed tenant isolation tests have passed.</p></section></main>;

  const selectedOrganisation = organisations.find((org) => org.organisationId === organisationId);
  const csvDuplicateMatches = findLeadCsvDuplicates(csvRows.map((row) => ({ businessName: row.businessname ?? "", location: row.location ?? "", email: row.email ?? "", website: row.website ?? "" })), leads);
  const campaignPerformance = summarizeCampaignPerformance(campaigns, leads, drafts);
  const sourcePerformance = summarizeLeadSourcePerformance(leads);
  const filteredLeads = leads.filter((lead) => {
    const query = leadSearch.trim().toLocaleLowerCase("en-GB");
    const matchesSearch = !query || [lead.businessName, lead.category, lead.location, lead.website, lead.email, lead.phone]
      .some((value) => value.toLocaleLowerCase("en-GB").includes(query));
    return matchesSearch && (leadStatusFilter === "all" || lead.status === leadStatusFilter)
      && (leadCampaignFilter === "all" || lead.campaignId === leadCampaignFilter);
  });

  async function loadLeadSourceFunnelAnalytics() {
    if (!api || !organisationId) return;
    const requestedOrganisationId = organisationId;
    setLoadingSourceAnalyticsOrganisationId(requestedOrganisationId);
    setError("");
    try {
      const summary = await api.getLeadSourceFunnelSummary({ organisationId: requestedOrganisationId });
      if (currentOrganisationIdRef.current !== requestedOrganisationId) return;
      setServerSourceAnalytics(summary);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoadingSourceAnalyticsOrganisationId((current) => current === requestedOrganisationId ? "" : current);
    }
  }

  async function loadOnboardingCohorts() {
    if (!api || !organisationId) return;
    const requestedOrganisationId = organisationId;
    setLoadingOnboardingCohorts(true);
    setError("");
    try {
      const summary = await api.getOnboardingCohortSummary({ organisationId: requestedOrganisationId });
      if (currentOrganisationIdRef.current === requestedOrganisationId) setOnboardingCohortSummary(summary);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoadingOnboardingCohorts(false);
    }
  }

  async function loadCampaignFunnelAnalytics(campaignId: string) {
    if (!api || !organisationId) return;
    const key = `${organisationId}:${campaignId}`;
    setLoadingCampaignAnalyticsKey(key);
    setError("");
    try {
      const summary = await api.getCampaignFunnelSummary({ organisationId, campaignId });
      if (currentOrganisationIdRef.current !== organisationId) return;
      setServerCampaignAnalytics((current) => ({ ...current, [key]: summary }));
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoadingCampaignAnalyticsKey((current) => current === key ? "" : current);
    }
  }

  function exportCampaignPerformance() {
    if (!campaignPerformance.length) return;
    try {
      const csv = serializeCampaignPerformanceCsv(campaignPerformance);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `growth-engine-campaign-performance-loaded-${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${campaignPerformance.length} campaign summary row(s) from currently loaded records only.`);
      setError("");
    } catch { setError("The campaign report could not be prepared in this browser. Please try again."); }
  }

  function exportFilteredLeads() {
    if (filteredLeads.length === 0) return;
    try {
      const campaignNames = Object.fromEntries(campaigns.map((campaign) => [campaign.id, campaign.name]));
      const csv = serializeLeadExportCsv(filteredLeads, campaignNames);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `growth-engine-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${filteredLeads.length} filtered loaded lead(s). Load additional pages before exporting if you need more records.`);
      setError("");
    } catch {
      setError("The CSV export could not be prepared in this browser. Please try again.");
    }
  }

  async function exportAllStoredLeads() {
    if (!api || !organisationId || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || exportingAllLeads) return;
    const requestedOrganisationId = organisationId;
    const requestId = workspaceLoadIdRef.current;
    setExportingAllLeads(true);
    setError("");
    setNotice("");
    try {
      const allLeads: LeadSummary[] = [];
      const seenLeadIds = new Set<string>();
      let pageToken: string | undefined;
      let hasMore = true;
      for (let pageIndex = 0; pageIndex < 20 && hasMore; pageIndex += 1) {
        const result = await api.listLeads({ organisationId: requestedOrganisationId, ...(pageToken ? { pageToken } : {}) });
        if (requestId !== workspaceLoadIdRef.current || currentOrganisationIdRef.current !== requestedOrganisationId) return;
        for (const lead of result.leads) {
          if (!seenLeadIds.has(lead.id)) {
            seenLeadIds.add(lead.id);
            allLeads.push(lead);
          }
        }
        hasMore = result.hasMoreLeads === true;
        if (hasMore && !result.nextPageToken) throw new Error("The server did not provide a safe continuation cursor. No file was downloaded.");
        pageToken = result.nextPageToken ?? undefined;
        if (hasMore && pageIndex === 19) throw new Error("The export exceeds the 1,000-record safety limit. No partial file was downloaded.");
      }

      const allCampaigns: CampaignSummary[] = [];
      const seenCampaignIds = new Set<string>();
      let campaignPageToken: string | undefined;
      let moreCampaigns = true;
      for (let pageIndex = 0; pageIndex < 20 && moreCampaigns; pageIndex += 1) {
        const result = await api.listCampaigns({ organisationId: requestedOrganisationId, ...(campaignPageToken ? { pageToken: campaignPageToken } : {}) });
        if (requestId !== workspaceLoadIdRef.current || currentOrganisationIdRef.current !== requestedOrganisationId) return;
        for (const campaign of result.campaigns) {
          if (!seenCampaignIds.has(campaign.id)) {
            seenCampaignIds.add(campaign.id);
            allCampaigns.push(campaign);
          }
        }
        moreCampaigns = result.hasMoreCampaigns === true;
        if (moreCampaigns && !result.nextPageToken) throw new Error("The server did not provide a safe campaign continuation cursor. No file was downloaded.");
        campaignPageToken = result.nextPageToken ?? undefined;
        if (moreCampaigns && pageIndex === 19) throw new Error("The campaign inventory exceeds the export safety limit. No file was downloaded.");
      }

      if (requestId !== workspaceLoadIdRef.current || currentOrganisationIdRef.current !== requestedOrganisationId) return;
      const campaignNames = Object.fromEntries(allCampaigns.map((campaign) => [campaign.id, campaign.name]));
      const csv = serializeLeadExportCsv(allLeads, campaignNames);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `growth-engine-all-leads-${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Exported all ${allLeads.length} stored lead(s) across ${allCampaigns.length} campaign(s). Current filters were not applied.`);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setExportingAllLeads(false);
    }
  }

  return <main className="cloud-shell cloud-dashboard"><header className="cloud-header"><div><div className="cloud-brand">AT <span>Growth Engine</span></div><p className="cloud-eyebrow">FIREBASE CLOUD MODE</p></div><div className="cloud-user"><span>{user.email}</span><button className="cloud-secondary" onClick={() => void signOut(client.auth)}>Sign out</button></div></header>
    <section className="cloud-card cloud-intro"><div><p className="cloud-eyebrow">PERSISTED WORKSPACE</p><h1>Provider acquisition workspace</h1><p className="cloud-muted">Changes are stored through authenticated server functions. Outreach remains draft-only.</p></div><span className="cloud-safe-badge">NO AUTOMATIC SENDING</span></section>
    {notice && <p className="cloud-notice" role="status">{notice}</p>}{error && <p className="cloud-error" role="alert">{error}</p>}
    <section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">TENANT CONTEXT</p><h2>Organisation</h2></div></div>{hasMoreOrganisations && <div className="cloud-pagination"><p className="cloud-muted">Showing {organisations.length} organisations. More workspaces are available.</p><button className="cloud-secondary" type="button" disabled={loadingMoreOrganisations} onClick={() => void loadMoreOrganisations()}>{loadingMoreOrganisations ? "Loading workspaces…" : "Load more organisations"}</button></div>}{organisations.length > 0 ? <label className="cloud-field">Current organisation<select disabled={Boolean(campaignIdempotencyKey) || editingDraftId.startsWith("new:")} value={organisationId} onChange={(event) => { setOrganisationId(event.target.value); setOffboardingPreview(null); setOnboardingCohortSummary(null); }}>{organisations.map((org) => <option key={org.organisationId} value={org.organisationId}>{org.name} · {org.role}</option>)}</select></label> : <p className="cloud-muted">Create an organisation to begin. Your account cannot read other organisations unless you are a member.</p>}{selectedOrganisation && <form className="cloud-inline-form" onSubmit={(event) => void saveOrganisationSettings(event)}><label className="cloud-field">Organisation display name<input required maxLength={100} disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin")} value={organisationSettingsName} onChange={(event) => setOrganisationSettingsName(event.target.value)} /></label><button className="cloud-secondary" disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || !organisationSettingsName.trim() || organisationSettingsName.trim() === selectedOrganisation.name}>Save workspace settings</button>{selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin" && <p className="cloud-muted">Only organisation owners and admins can change workspace settings.</p>}</form>}{selectedOrganisation && <form className="cloud-inline-form" onSubmit={(event) => void addOrganisationMember(event)}><label className="cloud-field">Add existing account by email<input type="email" required maxLength={254} autoComplete="email" disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || Boolean(memberAdditionIdempotencyKey)} value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="teammate@example.com" /></label><label className="cloud-field">Member role<select disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || Boolean(memberAdditionIdempotencyKey)} value={memberRole} onChange={(event) => setMemberRole(event.target.value as "member" | "viewer")}><option value="member">Member</option><option value="viewer">Viewer</option></select></label>{memberAdditionIdempotencyKey && <p className="cloud-muted" role="status">A member addition is awaiting confirmation. Retry with the same email and role to avoid a duplicate request.</p>}<button className="cloud-secondary" disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || !memberEmail.trim()}>{busy ? "Adding member…" : memberAdditionIdempotencyKey ? "Retry member addition" : "Add member"}</button>{selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin" && <p className="cloud-muted">Only organisation owners and admins can add members.</p>}</form>}
      {selectedOrganisation && selectedOrganisationRole === "owner" && <section className="cloud-card" aria-labelledby="offboarding-preview-title">
        <div className="cloud-section-head"><div><p className="cloud-eyebrow">DATA INVENTORY</p><h2 id="offboarding-preview-title">Organisation offboarding preview</h2><p className="cloud-muted">Read-only inventory of allow-listed organisation subcollections. This does not delete data, close accounts, or configure retention.</p></div>
          <button className="cloud-secondary" type="button" disabled={busy} onClick={() => void loadOffboardingPreview()}>{busy ? "Checking…" : "Preview organisation data"}</button>
        </div>
        <p className="cloud-muted">The preview is capped at 1,000 records per category and does not cover root-level rate limits, organisation-creation idempotency records, Auth accounts, backups, logs, or third-party copies. It is not sufficient by itself to authorise deletion.</p>
        {offboardingPreview && <div className="cloud-analytics-summary" role="status">
          <strong>{offboardingPreview.complete ? "Inventory completed for all listed categories" : "Inventory incomplete — review required"}</strong>
          <span>No destructive action performed: {offboardingPreview.destructiveActionPerformed ? "unexpected result" : "confirmed"}.</span>
          <ul>{offboardingPreview.categories.map((item) => <li key={item.category}>
            <strong>{item.category}</strong>: {item.status === "complete"
              ? `${item.exactCount ?? item.observedCount} records`
              : item.status === "limit_reached"
                ? `at least ${offboardingPreview.maxRecordsPerCategory} records (category cap reached)`
                : `unavailable; ${item.observedCount} records observed before the read failed`}
          </li>)}</ul>
        </div>}
      </section>}
      <form className="cloud-inline-form" onSubmit={(event) => void createOrganisation(event)}><label className="cloud-field">{organisations.length ? "Create another organisation" : "Organisation name"}<input required disabled={Boolean(organisationIdempotencyKey)} maxLength={100} value={organisationName} onChange={(event) => setOrganisationName(event.target.value)} placeholder="e.g. AnyTrader pilot" /></label>{organisationIdempotencyKey && <p className="cloud-muted" role="status">A save attempt is pending. Retry without changing the name so the same request key is reused and duplicate organisations are avoided.</p>}<button className="cloud-primary" disabled={busy || !organisationName.trim()}>{busy ? "Saving…" : organisationIdempotencyKey ? "Retry save (same request)" : "Create organisation"}</button></form></section>
    {selectedOrganisation && <><section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">CAMPAIGN PERFORMANCE</p><h2>Acquisition pipeline overview</h2><p className="cloud-muted">The default table uses loaded records. Use “Load full counts” for server-side aggregate funnel totals across every stored lead in a campaign.</p></div><button className="cloud-secondary" disabled={!campaignPerformance.length} onClick={exportCampaignPerformance}>Export loaded campaign report (CSV)</button></div>{(hasMoreCampaigns || hasMoreLeads || hasMoreDrafts) && <p className="cloud-warning" role="status">Partial view: more pages are available. Load more campaigns, leads and drafts to improve coverage before comparing campaign results.</p>}{campaignPerformance.length ? <div className="cloud-table-wrap"><table className="cloud-table"><caption>Campaign counts from loaded records only</caption><thead><tr><th>Campaign</th><th>Loaded leads</th><th>Qualified</th><th>Contacted</th><th>Onboarded</th><th>Qualified rate (loaded leads)</th><th>Onboarded rate (loaded leads)</th><th>All-records funnel (server)</th><th>Restricted / review needed</th><th>Loaded drafts</th><th>Drafts needing review</th></tr></thead><tbody>{campaignPerformance.map((item) => <tr key={item.campaignId}><td><strong>{item.campaignName}</strong></td><td>{item.loadedLeadCount}</td><td>{item.qualifiedLeadCount}</td><td>{item.contactedLeadCount}</td><td>{item.onboardedLeadCount}</td><td>{item.qualifiedRatePercent.toFixed(1)}%</td><td>{item.onboardedRatePercent.toFixed(1)}%</td><td>{serverCampaignAnalytics[`${organisationId}:${item.campaignId}`] ? <div className="cloud-analytics-summary"><strong>{serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].totalLeadCount} total leads</strong><span>{serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].qualifiedLeadCount} qualified · {serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].contactedLeadCount} contacted · {serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].onboardedLeadCount} onboarded</span><span>{serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].qualifiedRatePercent.toFixed(1)}% qualified · {serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].onboardedRatePercent.toFixed(1)}% onboarded</span><button className="cloud-link" type="button" disabled={loadingCampaignAnalyticsKey === `${organisationId}:${item.campaignId}`} onClick={() => void loadCampaignFunnelAnalytics(item.campaignId)}>{loadingCampaignAnalyticsKey === `${organisationId}:${item.campaignId}` ? "Refreshing…" : "Refresh full counts"}</button></div> : <button className="cloud-secondary" type="button" disabled={loadingCampaignAnalyticsKey === `${organisationId}:${item.campaignId}`} onClick={() => void loadCampaignFunnelAnalytics(item.campaignId)}>{loadingCampaignAnalyticsKey === `${organisationId}:${item.campaignId}` ? "Loading…" : "Load full counts"}</button>}</td><td>{item.restrictedLeadCount}</td><td>{item.loadedDraftCount}</td><td>{item.draftsAwaitingReview}</td></tr>)}</tbody></table></div> : <p className="cloud-empty">Create a campaign to start tracking acquisition activity.</p>}</section><section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">SOURCE ATTRIBUTION</p><h2>Lead source performance</h2><p className="cloud-muted">Source labels are self-declared, not independently verified. The default table uses loaded leads; load full counts for all stored records.</p></div><button className="cloud-secondary" type="button" disabled={loadingSourceAnalyticsOrganisationId === organisationId} onClick={() => void loadLeadSourceFunnelAnalytics()}>{loadingSourceAnalyticsOrganisationId === organisationId ? "Loading full source counts…" : serverSourceAnalytics?.organisationId === organisationId ? "Refresh full source counts" : "Load full source counts"}</button></div>{sourcePerformance.length ? <div className="cloud-table-wrap"><table className="cloud-table"><caption>Self-declared source performance from loaded leads</caption><thead><tr><th>Source (self-declared)</th><th>Loaded leads</th><th>Qualified</th><th>Onboarded</th><th>Qualified rate (loaded source leads)</th><th>Onboarded rate (loaded source leads)</th></tr></thead><tbody>{sourcePerformance.map((item) => <tr key={item.source}><td>{formatLeadSourceLabel(item.source)}</td><td>{item.loadedLeadCount}</td><td>{item.qualifiedLeadCount}</td><td>{item.onboardedLeadCount}</td><td>{item.qualifiedRatePercent.toFixed(1)}%</td><td>{item.onboardedRatePercent.toFixed(1)}%</td></tr>)}</tbody></table></div> : <p className="cloud-empty">Import or add leads to see source attribution. This view will not invent source information for unlabelled records.</p>}{serverSourceAnalytics?.organisationId === organisationId && <div className="cloud-server-analytics"><p className="cloud-muted">Complete server-side totals across all stored leads. {serverSourceAnalytics.attributionNote}</p><div className="cloud-table-wrap"><table className="cloud-table"><caption>All-record source attribution</caption><thead><tr><th>Source (self-declared)</th><th>All stored leads</th><th>Qualified</th><th>Onboarded</th><th>Qualified rate</th><th>Onboarded rate</th></tr></thead><tbody>{serverSourceAnalytics.sourceSummaries.map((item) => <tr key={item.source}><td>{formatLeadSourceLabel(item.source)}</td><td>{item.totalLeadCount}</td><td>{item.qualifiedLeadCount}</td><td>{item.onboardedLeadCount}</td><td>{item.qualifiedRatePercent.toFixed(1)}%</td><td>{item.onboardedRatePercent.toFixed(1)}%</td></tr>)}</tbody></table></div></div>}</section><section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">ONBOARDING COHORTS</p><h2>Monthly first-onboarding trend</h2><p className="cloud-muted">Server-side counts based on each lead’s first recorded onboarding timestamp, across all stored leads.</p></div><button className="cloud-secondary" type="button" disabled={loadingOnboardingCohorts} onClick={() => void loadOnboardingCohorts()}>{loadingOnboardingCohorts ? "Loading cohorts…" : onboardingCohortSummary?.organisationId === organisationId ? "Refresh onboarding cohorts" : "Load onboarding cohorts"}</button></div>{onboardingCohortSummary?.organisationId === organisationId && <><p className="cloud-muted">{onboardingCohortSummary.attributionNote}</p><div className="cloud-table-wrap"><table className="cloud-table"><caption>First-onboarding cohorts by UTC calendar month (last {onboardingCohortSummary.windowMonths} months)</caption><thead><tr><th>UTC month</th><th>First onboardings</th></tr></thead><tbody>{onboardingCohortSummary.cohorts.map((cohort) => <tr key={cohort.month}><td>{cohort.month}</td><td>{cohort.onboardedLeadCount}</td></tr>)}</tbody></table></div></>}</section><section className="cloud-columns"><article className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">CAMPAIGNS</p><h2>Campaign setup</h2></div><span className="cloud-count">{campaigns.length}</span></div><form className="cloud-form" onSubmit={(event) => void createCampaign(event)}><label>Campaign name<input required disabled={Boolean(campaignIdempotencyKey)} maxLength={120} value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Manchester painter pilot" /></label><label>Brand<input required disabled={Boolean(campaignIdempotencyKey)} maxLength={100} value={campaignBrand} onChange={(event) => setCampaignBrand(event.target.value)} /></label><label>Service category<input required disabled={Boolean(campaignIdempotencyKey)} maxLength={100} value={campaignCategory} onChange={(event) => setCampaignCategory(event.target.value)} /></label><label>Target location<input required disabled={Boolean(campaignIdempotencyKey)} maxLength={160} value={campaignLocation} onChange={(event) => setCampaignLocation(event.target.value)} /></label><label>Goal<input disabled={Boolean(campaignIdempotencyKey)} maxLength={500} value={campaignGoal} onChange={(event) => setCampaignGoal(event.target.value)} /></label>{campaignIdempotencyKey && <p className="cloud-muted" role="status">A save attempt is pending. Retry without changing these fields so the same request key is reused and duplicate campaigns are avoided.</p>}<button className="cloud-primary" disabled={busy}>{busy ? "Saving…" : campaignIdempotencyKey ? "Retry save (same request)" : "Create campaign"}</button></form><div className="cloud-list">{campaigns.map((campaign) => <div className="cloud-list-item" key={campaign.id}><div><strong>{campaign.name}</strong><small>{campaign.category} · {campaign.location}</small>{editingCampaignId === campaign.id ? <form className="cloud-form" onSubmit={(event) => void saveCampaignDetails(event)}><label>Campaign name<input required maxLength={120} value={campaignEditFields.name} onChange={(event) => setCampaignEditFields((current) => ({ ...current, name: event.target.value }))} /></label><label>Brand<input required maxLength={100} value={campaignEditFields.brand} onChange={(event) => setCampaignEditFields((current) => ({ ...current, brand: event.target.value }))} /></label><label>Service category<input required maxLength={100} value={campaignEditFields.category} onChange={(event) => setCampaignEditFields((current) => ({ ...current, category: event.target.value }))} /></label><label>Target location<input required maxLength={160} value={campaignEditFields.location} onChange={(event) => setCampaignEditFields((current) => ({ ...current, location: event.target.value }))} /></label><label>Goal<input maxLength={500} value={campaignEditFields.goal} onChange={(event) => setCampaignEditFields((current) => ({ ...current, goal: event.target.value }))} /></label><button className="cloud-primary" disabled={busy}>Save campaign details</button><button className="cloud-secondary" type="button" disabled={busy} onClick={() => setEditingCampaignId("")}>Cancel</button></form> : <button className="cloud-secondary" type="button" disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin")} onClick={() => { setEditingCampaignId(campaign.id); setCampaignEditFields({ name: campaign.name, brand: campaign.brand, category: campaign.category, location: campaign.location, goal: campaign.goal }); }}>Edit details</button>}</div><span className="cloud-status">{statusLabel(campaign.status)}</span>{(selectedOrganisationRole === "owner" || selectedOrganisationRole === "admin") && <div className="cloud-inline-actions"><button className="cloud-secondary" type="button" disabled={busy || campaign.status === "paused"} onClick={() => void changeCampaignStatus(campaign, "paused")}>Pause</button><button className="cloud-secondary" type="button" disabled={busy || campaign.status === "active"} onClick={() => void changeCampaignStatus(campaign, "active")}>Activate</button><button className="cloud-secondary" type="button" disabled={busy || campaign.status === "completed"} onClick={() => void changeCampaignStatus(campaign, "completed")}>Complete</button></div>}</div>)}{!campaigns.length && <p className="cloud-empty">No campaigns yet.</p>}</div>{hasMoreCampaigns && <div className="cloud-pagination"><button className="cloud-secondary" type="button" disabled={loadingMoreCampaigns} onClick={() => void loadMoreCampaigns()}>{loadingMoreCampaigns ? "Loading campaigns…" : "Load more campaigns"}</button></div>}</article>
      <article className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">LEADS</p><h2>Add a provider lead</h2></div><span className="cloud-count">{leads.length}</span></div>{campaigns.length ? <form className="cloud-form" onSubmit={(event) => void createLead(event)}><label>Campaign<select required disabled={Boolean(leadIdempotencyKey)} value={leadCampaignId} onChange={(event) => setLeadCampaignId(event.target.value)}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label>Business name<input required disabled={Boolean(leadIdempotencyKey)} maxLength={160} value={leadName} onChange={(event) => setLeadName(event.target.value)} /></label><label>Service category<input disabled={Boolean(leadIdempotencyKey)} maxLength={100} value={leadCategory} onChange={(event) => setLeadCategory(event.target.value)} /></label><label>Location<input disabled={Boolean(leadIdempotencyKey)} maxLength={160} value={leadLocation} onChange={(event) => setLeadLocation(event.target.value)} /></label><label>Website<input disabled={Boolean(leadIdempotencyKey)} type="url" maxLength={500} value={leadWebsite} onChange={(event) => setLeadWebsite(event.target.value)} placeholder="https://…" /></label><label>Email<input disabled={Boolean(leadIdempotencyKey)} type="email" maxLength={254} value={leadEmail} onChange={(event) => setLeadEmail(event.target.value)} /></label><label>Phone<input disabled={Boolean(leadIdempotencyKey)} maxLength={80} value={leadPhone} onChange={(event) => setLeadPhone(event.target.value)} /></label>{leadIdempotencyKey && <p className="cloud-muted" role="status">A save attempt is pending. Retry without changing these fields so the same request key is reused and duplicate leads are avoided.</p>}<button className="cloud-primary" disabled={busy || !leadCampaignId}>{busy ? "Saving…" : leadIdempotencyKey ? "Retry save (same request)" : "Save lead"}</button></form> : <p className="cloud-empty">Create a campaign before adding leads.</p>}</article></section>
      <section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">CSV IMPORT</p><h2>Import provider leads</h2><p className="cloud-muted">Choose a CSV, review the parsed rows and warnings, then explicitly confirm import. Files are not uploaded automatically. Imports are capped at 25 rows and imported leads remain suppressed for human review.</p></div></div>{campaigns.length ? <div className="cloud-form"><label>Import into campaign<select required value={csvCampaignId} disabled={csvImportBusy || Boolean(csvAttemptCampaignId)} onChange={(event) => setCsvCampaignId(event.target.value)}><option value="">Choose a campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label>Source label (self-declared)<select value={csvSourceLabel} disabled={csvImportBusy || Boolean(csvAttemptCampaignId)} onChange={(event) => setCsvSourceLabel(event.target.value as CsvImportSourceLabel)}><option value="csv_import">Generic CSV import</option><option value="linkedin_csv">LinkedIn export (only if permitted)</option><option value="google_places_manual">Google Maps/Places research (only if permitted)</option><option value="other_approved">Other approved source</option></select></label><label>CSV file<input type="file" accept=".csv,text/csv" disabled={csvImportBusy || Boolean(csvAttemptCampaignId)} onChange={(event) => void previewLeadCsv(event)} /></label></div> : <p className="cloud-empty">Create a campaign before importing leads.</p>}{csvFilename && <p className="cloud-muted">Selected file: {csvFilename}. {csvRows.length} valid row(s) ready to review.</p>}{csvErrors.length > 0 && <ul className="cloud-warning-list" aria-label="CSV import warnings">{csvErrors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>}{csvRows.length > 0 && <>{csvDuplicateMatches.length > 0 && <div className="cloud-warning" role="status"><strong>{csvDuplicateMatches.length} possible duplicate row(s) found.</strong> These rows are flagged for review, not silently removed. The server will make the final duplicate decision. {hasMoreLeads ? "Only currently loaded leads were checked; load more leads for a broader preview." : "All currently loaded leads were checked."}</div>}<div className="cloud-table-wrap"><table className="cloud-table"><caption>Preview — no records have been imported yet</caption><thead><tr><th>Business</th><th>Category</th><th>Location</th><th>Email</th><th>Phone</th><th>Duplicate preview</th></tr></thead><tbody>{csvRows.slice(0, 10).map((row, index) => { const duplicate = csvDuplicateMatches.find((match) => match.rowIndex === index); return <tr key={`${row.businessname}-${index}`}><td>{row.businessname}</td><td>{row.category || "—"}</td><td>{row.location || "—"}</td><td>{row.email || "—"}</td><td>{row.phone || "—"}</td><td>{duplicate ? <span className="cloud-suppressed">Possible duplicate: {duplicate.matchedOn} matches {duplicate.duplicateSource === "loaded-lead" ? "loaded lead" : "earlier CSV row"} “{duplicate.duplicateBusinessName}”</span> : "No match found in loaded records"}</td></tr>; })}</tbody></table></div>{csvRows.length > 10 && <p className="cloud-muted">Showing first 10 of {csvRows.length} rows.</p>}<button className="cloud-primary" type="button" disabled={busy || csvImportBusy || !csvCampaignId || !csvIdempotencyKey} onClick={() => void importReviewedCsv()}>{csvImportBusy ? "Importing reviewed rows…" : `Import ${csvRows.length} reviewed row${csvRows.length === 1 ? "" : "s"}`}</button><p className="cloud-footnote">Confirm only if you have permission to store these business details. Importing does not verify consent or authorise outreach.</p></>}</section>
      <section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">REVIEW AND SUPPRESSION</p><h2>Lead directory</h2><p className="cloud-muted">Clearing this internal review gate does not prove consent or establish a lawful basis for outreach. Check permission and applicable rules separately; all outreach remains draft-only.</p></div>{hasMoreLeads && <button className="cloud-secondary" type="button" disabled={loadingMoreLeads} onClick={() => void loadMoreLeads()}>{loadingMoreLeads ? "Loading leads…" : "Load more leads"}</button>}</div><div className="cloud-form cloud-lead-filters"><label>Search leads<input type="search" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Business, category, location, website, email, or phone" /></label><label>Filter by status<select value={leadStatusFilter} onChange={(event) => setLeadStatusFilter(event.target.value)}><option value="all">All statuses</option>{leadStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><label>Filter by campaign<select value={leadCampaignFilter} onChange={(event) => setLeadCampaignFilter(event.target.value)}><option value="all">All campaigns</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><button className="cloud-secondary" type="button" disabled={!leadSearch && leadStatusFilter === "all" && leadCampaignFilter === "all"} onClick={() => { setLeadSearch(""); setLeadStatusFilter("all"); setLeadCampaignFilter("all"); }}>Clear filters</button><button className="cloud-secondary" type="button" disabled={filteredLeads.length === 0} onClick={exportFilteredLeads}>Export {filteredLeads.length} filtered loaded lead{filteredLeads.length === 1 ? "" : "s"} (CSV)</button>{(selectedOrganisationRole === "owner" || selectedOrganisationRole === "admin") && <button className="cloud-secondary" type="button" disabled={exportingAllLeads} onClick={() => void exportAllStoredLeads()}>{exportingAllLeads ? "Preparing full export…" : "Export all stored leads (CSV)"}</button>}</div><p className="cloud-muted" aria-live="polite">Showing {filteredLeads.length} of {leads.length} loaded leads.</p><p className="cloud-muted">The filtered export above includes only loaded records. Owners and admins can use “Export all stored leads” to export every stored lead (up to 1,000 records) across all pages; current filters are ignored.</p><div className="cloud-table-wrap"><table className="cloud-table"><thead><tr><th>Business</th><th>Status</th><th>Contact restriction</th><th>Actions</th></tr></thead><tbody>{filteredLeads.map((lead) => <tr key={lead.id}><td><strong>{lead.businessName}</strong><small>{lead.category} · {lead.location}</small><small>Source: {formatLeadSourceLabel(lead.source)}</small><label className="cloud-note-label">Internal notes<textarea aria-label={`Notes for ${lead.businessName}`} maxLength={4000} rows={2} value={leadNotes[lead.id] ?? ""} disabled={busy} onChange={(event) => setLeadNotes((current) => ({ ...current, [lead.id]: event.target.value }))} /></label><button className="cloud-link" disabled={busy || (leadNotes[lead.id] ?? "") === (lead.notes ?? "")} onClick={() => void runAction(() => api.updateLeadNotes({ organisationId, leadId: lead.id, notes: leadNotes[lead.id] ?? "" }), "Internal notes saved.")}>Save notes</button></td><td><select aria-label={`Status for ${lead.businessName}`} value={lead.status} disabled={busy} onChange={(event) => void runAction(() => api.updateLeadStatus({ organisationId, leadId: lead.id, status: event.target.value as ServerLeadStatus }), "Lead status updated.")}>{leadStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>{lead.status === "onboarded" && lead.onboardedAt && <small className="cloud-muted">First onboarded: {new Date(lead.onboardedAt).toLocaleDateString("en-GB")}</small>}</td><td>{lead.contactReviewStatus === "pending" ? <span className="cloud-suppressed">PENDING REVIEW</span> : lead.doNotContact ? <span className="cloud-suppressed">DO NOT CONTACT</span> : lead.contactRestrictionVerified ? <span className="cloud-contactable">Contact review cleared</span> : <span className="cloud-suppressed">REVIEW RESTRICTION</span>}<button className="cloud-link" disabled={busy || (getContactRestrictionAction(lead.doNotContact, lead.contactReviewStatus) === "clear" && !canClearContactRestriction)} onClick={() => {
          const action = getContactRestrictionAction(lead.doNotContact, lead.contactReviewStatus);
          void runAction(() => api.setLeadSuppression({ organisationId, leadId: lead.id, doNotContact: action === "suppress", ...(action === "clear" ? { contactReviewRevision: lead.contactReviewRevision } : {}) }), action === "clear" ? "Restriction review/clear requested." : "Lead suppressed.");
        }}>{lead.contactReviewStatus === "pending" || lead.contactReviewStatus === "blocked" ? "Review & clear restriction" : lead.doNotContact ? "Remove restriction" : "Suppress"}</button></td><td><button className="cloud-secondary" disabled={busy || lead.doNotContact || !lead.contactRestrictionVerified} onClick={() => void createDraftForLead(lead)}>{draftCreationKeys[lead.id] ? "Retry draft (same request)" : "Create draft"}</button><button className="cloud-secondary" disabled={busy || Boolean(aiDraftBusyLeadId) || Boolean(editingDraftId) || lead.doNotContact || !lead.contactRestrictionVerified} onClick={() => void suggestAiDraftForLead(lead)}>{aiDraftBusyLeadId === lead.id ? "Generating AI draft…" : "AI draft suggestion"}</button></td></tr>)}</tbody></table>{!leads.length ? <p className="cloud-empty">No leads in this organisation yet.</p> : !filteredLeads.length ? <p className="cloud-empty" role="status">No leads match these filters. Try another search or choose All statuses.</p> : null}</div></section>
      {editingDraftId.startsWith("new:") && <section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">AI-ASSISTED DRAFT</p><h2>Review suggested message</h2><p className="cloud-muted">This is unverified AI text. Check every claim and recipient eligibility, then save it as an unsent draft. Business and campaign context is sent to Google Gemini; email, phone and internal notes are excluded.</p></div></div><form className="cloud-form cloud-draft-editor" onSubmit={(event) => void saveDraft(event)}><label>Draft subject<input required maxLength={200} disabled={busy || Boolean(draftCreationKeys[editingDraftId.slice(4)])} value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} /></label><label>Draft body<textarea required maxLength={10000} rows={7} disabled={busy || Boolean(draftCreationKeys[editingDraftId.slice(4)])} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} /></label>{draftCreationKeys[editingDraftId.slice(4)] && <p className="cloud-muted" role="status">A save attempt is pending. Retry with the same text to avoid duplicate drafts.</p>}<div className="cloud-draft-actions"><button className="cloud-primary" disabled={busy || !draftSubject.trim() || !draftBody.trim()}>{draftCreationKeys[editingDraftId.slice(4)] ? "Retry save (same request)" : "Save as draft"}</button><button type="button" className="cloud-secondary" disabled={busy || Boolean(draftCreationKeys[editingDraftId.slice(4)])} onClick={() => { setEditingDraftId(""); setDraftSubject(""); setDraftBody(""); }}>Discard suggestion</button></div></form></section>}<section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">HUMAN REVIEW REQUIRED</p><h2>Outreach drafts</h2></div><span className="cloud-count">{drafts.length}</span></div>{hasMoreDrafts && <div className="cloud-pagination"><button className="cloud-secondary" type="button" disabled={loadingMoreDrafts} onClick={() => void loadMoreDrafts()}>{loadingMoreDrafts ? "Loading drafts…" : "Load more drafts"}</button></div>}<div className="cloud-list">{drafts.map((draft) => <div className="cloud-draft" key={draft.id}>{editingDraftId === draft.id ? <form className="cloud-form cloud-draft-editor" onSubmit={(event) => void saveDraft(event)}><label>Draft subject<input required maxLength={200} value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} /></label><label>Draft body<textarea required maxLength={10000} rows={6} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} /></label><div className="cloud-draft-actions"><button className="cloud-primary" disabled={busy || !draftSubject.trim() || !draftBody.trim()}>{busy ? "Saving…" : "Save draft"}</button><button type="button" className="cloud-secondary" disabled={busy} onClick={() => { setEditingDraftId(""); setDraftSubject(""); setDraftBody(""); }}>Cancel</button></div></form> : <><div><strong>{draft.subject}</strong>{draft.requiresReview && <p className="cloud-error" role="alert">{draft.reviewReason ?? "Review required before use."}</p>}<p>{draft.body}</p><small>{statusLabel(draft.status)}{draft.status === "draft" ? " · NOT SENT" : " · REVIEW REQUIRED"}</small></div><div className="cloud-draft-actions"><button className="cloud-secondary" disabled={busy || draft.requiresReview} title={draft.requiresReview ? "Resolve the lead restriction before editing this draft." : undefined} onClick={() => { setEditingDraftId(draft.id); setDraftSubject(draft.subject); setDraftBody(draft.body); }}>Edit</button><button className="cloud-secondary" disabled={busy} onClick={() => void runAction(() => api.deleteOutreachDraft({ organisationId, draftId: draft.id }), "Draft deleted.")}>Delete</button></div></>}</div>)}{!drafts.length && <p className="cloud-empty">No outreach drafts yet.</p>}</div></section></>}
    <footer className="cloud-footer">Dedicated Firebase project required · tenant access enforced by server functions · no automated outreach</footer></main>;
}
