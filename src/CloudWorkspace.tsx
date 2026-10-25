import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createUserWithEmailAndPassword, GoogleAuthProvider, onAuthStateChanged, signInWithEmailAndPassword, signInWithPopup, signOut, type User } from "firebase/auth";
import { createFirebaseCallableInvoker, createGrowthEngineApi, type CampaignFunnelAnalyticsSummary, type ContactReviewQueueAnalytics, type LeadSourceFunnelAnalytics, type CampaignSummary, type CsvImportSourceLabel, type LeadSummary, type LeadActivityTimeline, type OrganisationSummary, type OffboardingPreviewResult, type OnboardingCohortAnalytics, type OnboardingCohortCoverage, type OrganisationMemberRoster, type OrganisationPlanUsageSummary, type PlanUsageReconciliationSummary, type OutreachDraftSummary, type ServerLeadStatus } from "./backendApi";
import { firebaseClient } from "./firebaseClient";
import { findLeadCsvDuplicates, formatLeadSourceLabel, getContactRestrictionAction, parseLeadCsv, serializeLeadExportCsv } from "./domain";
import { serializeCampaignPerformanceCsv, serializeFullCampaignFunnelCsv, serializeFullLeadSourceFunnelCsv, serializeOnboardingCohortCsv, summarizeCampaignPerformance, summarizeCampaignReadiness, summarizeLeadSourcePerformance } from "./analytics";
import "./cloudWorkspace.css";

const leadStatuses: ServerLeadStatus[] = ["new", "reviewing", "qualified", "contacted", "onboarded", "rejected"];
const statusLabel = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);
const readableError = (error: unknown) => error instanceof Error ? error.message : "The request could not be completed. Please try again.";
const getLeadContactReviewStatus = (lead: LeadSummary): "pending" | "cleared" | "blocked" =>
  lead.contactReviewStatus ?? (lead.doNotContact ? "blocked" : lead.contactRestrictionVerified ? "cleared" : "pending");
const getQuotaUsageState = (remaining: number, limit: number): { label: "Within limit" | "Near limit" | "Limit reached" | "Review required"; className: string } => {
  if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0) {
    return { label: "Review required", className: "cloud-quota-review" };
  }
  if (remaining <= 0) return { label: "Limit reached", className: "cloud-quota-reached" };
  if (remaining / limit <= 0.2) return { label: "Near limit", className: "cloud-quota-near" };
  return { label: "Within limit", className: "cloud-quota-ok" };
};
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
  const [leadActivityTimeline, setLeadActivityTimeline] = useState<LeadActivityTimeline | null>(null);
  const [selectedLeadActivityId, setSelectedLeadActivityId] = useState("");
  const [loadingLeadActivityId, setLoadingLeadActivityId] = useState("");
  const [hasMoreLeads, setHasMoreLeads] = useState(false);
  const [nextLeadPageToken, setNextLeadPageToken] = useState<string | null>(null);
  const [loadingMoreLeads, setLoadingMoreLeads] = useState(false);
  const [exportingAllLeads, setExportingAllLeads] = useState(false);
  const [exportingFullCampaignAnalytics, setExportingFullCampaignAnalytics] = useState(false);
  const [showCampaignReadiness, setShowCampaignReadiness] = useState(false);
  const [leadNotes, setLeadNotes] = useState<Record<string, string>>({});
  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");
  const [leadCampaignFilter, setLeadCampaignFilter] = useState("all");
  const [leadSourceFilter, setLeadSourceFilter] = useState("all");
  const [contactReviewFilter, setContactReviewFilter] = useState("all");
  const [leadCompletenessFilter, setLeadCompletenessFilter] = useState<"all" | "low" | "medium" | "high">("all");
  const [leadSort, setLeadSort] = useState<"score" | "newest" | "business">("score");
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
  const [onboardingCohortCoverage, setOnboardingCohortCoverage] = useState<OnboardingCohortCoverage | null>(null);
  const [loadingOnboardingCohortCoverage, setLoadingOnboardingCohortCoverage] = useState(false);
  const [contactReviewQueueSummary, setContactReviewQueueSummary] = useState<ContactReviewQueueAnalytics | null>(null);
  const [loadingContactReviewQueueSummary, setLoadingContactReviewQueueSummary] = useState(false);
  const [organisationPlanUsage, setOrganisationPlanUsage] = useState<OrganisationPlanUsageSummary | null>(null);
  const [loadingPlanUsage, setLoadingPlanUsage] = useState(false);
  const [planUsageReconciliation, setPlanUsageReconciliation] = useState<PlanUsageReconciliationSummary | null>(null);
  const [loadingPlanUsageReconciliation, setLoadingPlanUsageReconciliation] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<"member" | "viewer">("member");
  const [memberRoleSelections, setMemberRoleSelections] = useState<Record<string, "admin" | "member" | "viewer">>({});
  const [memberAdditionIdempotencyKey, setMemberAdditionIdempotencyKey] = useState("");
  const [memberRoster, setMemberRoster] = useState<OrganisationMemberRoster | null>(null);
  const [loadingMemberRoster, setLoadingMemberRoster] = useState(false);
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
  const [fullCampaignAnalytics, setFullCampaignAnalytics] = useState<{ organisationId: string; campaigns: Array<{ campaignName: string; summary: CampaignFunnelAnalyticsSummary }> } | null>(null);
  const [loadingFullCampaignAnalytics, setLoadingFullCampaignAnalytics] = useState(false);
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

  async function loadOrganisationMembers(pageToken?: string) {
    if (!api || !organisationId || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || loadingMemberRoster) return;
    const requestedOrganisationId = organisationId;
    setLoadingMemberRoster(true);
    setError("");
    try {
      const result = await api.listOrganisationMembers({ organisationId: requestedOrganisationId, ...(pageToken ? { pageToken } : {}) });
      if (currentOrganisationIdRef.current === requestedOrganisationId) {
        if (!pageToken) {
          setMemberRoster(result);
        } else {
          setMemberRoster((current) => {
            if (!current || current.organisationId !== requestedOrganisationId) return result;
            const seen = new Set(current.members.map((member) => member.uid));
            return {
              ...result,
              members: [...current.members, ...result.members.filter((member) => !seen.has(member.uid))],
            };
          });
        }
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoadingMemberRoster(false);
    }
  }

  async function removeOrganisationMember(targetUid: string, targetRole: string) {
    if (!api || !organisationId || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || targetUid === user?.uid || targetRole === "owner") return;
    if (selectedOrganisationRole === "admin" && targetRole !== "member" && targetRole !== "viewer") return;
    if (!window.confirm("Remove this account from the organisation? This revokes its organisation access but does not delete the Firebase Auth account or its data outside this organisation.")) return;
    const requestedOrganisationId = organisationId;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.removeOrganisationMember({ organisationId: requestedOrganisationId, targetUid });
      if (currentOrganisationIdRef.current !== requestedOrganisationId) return;
      if (result.removed) {
        setMemberRoster((current) => current?.organisationId === requestedOrganisationId
          ? { ...current, members: current.members.filter((member) => member.uid !== targetUid) }
          : current);
        setNotice("Organisation membership removed. The account and its data outside this organisation were not deleted.");
        await refreshWorkspace(requestedOrganisationId);
      } else {
        setNotice("That account is no longer a member of this organisation.");
        await loadOrganisationMembers();
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function updateOrganisationMemberRole(targetUid: string, targetRole: "admin" | "member" | "viewer", currentRole: string) {
    if (!api || !organisationId || selectedOrganisationRole !== "owner" || targetUid === user?.uid || currentRole === "owner" || targetRole === currentRole) return;
    if (!window.confirm(`Change this member's role from ${currentRole} to ${targetRole}? This changes their permissions in this organisation.`)) return;
    const requestedOrganisationId = organisationId;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.updateOrganisationMemberRole({ organisationId: requestedOrganisationId, targetUid, role: targetRole });
      if (currentOrganisationIdRef.current !== requestedOrganisationId) return;
      setMemberRoster((current) => current?.organisationId === requestedOrganisationId
        ? { ...current, members: current.members.map((member) => member.uid === targetUid ? { ...member, role: result.role } : member) }
        : current);
      setMemberRoleSelections((current) => ({ ...current, [targetUid]: result.role }));
      setNotice(result.changed ? `Member role updated to ${result.role}.` : "That member already has the selected role.");
      await refreshWorkspace(requestedOrganisationId);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setBusy(false);
    }
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


  async function toggleLeadActivity(lead: LeadSummary) {
    if (!api || !organisationId || busy || loadingLeadActivityId) return;
    if (selectedLeadActivityId === lead.id) {
      setSelectedLeadActivityId("");
      return;
    }
    const requestedOrganisationId = organisationId;
    setLoadingLeadActivityId(lead.id);
    setError("");
    try {
      const timeline = await api.getLeadActivityTimeline({ organisationId: requestedOrganisationId, leadId: lead.id });
      if (currentOrganisationIdRef.current !== requestedOrganisationId) return;
      setLeadActivityTimeline(timeline);
      setSelectedLeadActivityId(lead.id);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoadingLeadActivityId("");
    }
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
  const campaignReadiness = summarizeCampaignReadiness(campaigns, leads, drafts, { hasMoreCampaigns, hasMoreLeads, hasMoreDrafts });
  const sourcePerformance = summarizeLeadSourcePerformance(leads);
  const filteredLeads = leads.filter((lead) => {
    const query = leadSearch.trim().toLocaleLowerCase("en-GB");
    const matchesSearch = !query || [lead.businessName, lead.category, lead.location, lead.website, lead.email, lead.phone]
      .some((value) => value.toLocaleLowerCase("en-GB").includes(query));
    const reviewStatus = getLeadContactReviewStatus(lead);
    const matchesCompleteness = leadCompletenessFilter === "all"
      || (leadCompletenessFilter === "low" && lead.score < 40)
      || (leadCompletenessFilter === "medium" && lead.score >= 40 && lead.score < 70)
      || (leadCompletenessFilter === "high" && lead.score >= 70);
    return matchesSearch && matchesCompleteness && (leadStatusFilter === "all" || lead.status === leadStatusFilter)
      && (leadCampaignFilter === "all" || lead.campaignId === leadCampaignFilter)
      && (leadSourceFilter === "all" || lead.source === leadSourceFilter)
      && (contactReviewFilter === "all" || reviewStatus === contactReviewFilter);
  }).sort((left, right) => {
    if (leadSort === "score") return right.score - left.score || left.businessName.localeCompare(right.businessName, "en-GB");
    if (leadSort === "business") return left.businessName.localeCompare(right.businessName, "en-GB");
    return (right.createdAt ?? "").localeCompare(left.createdAt ?? "") || left.businessName.localeCompare(right.businessName, "en-GB");
  });
  const contactReviewCounts = leads.reduce((counts, lead) => {
    counts[getLeadContactReviewStatus(lead)] += 1;
    return counts;
  }, { pending: 0, cleared: 0, blocked: 0 });

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

  function exportFullLeadSourceAnalytics() {
    if (!organisationId || serverSourceAnalytics?.organisationId !== organisationId) return;
    try {
      const csv = serializeFullLeadSourceFunnelCsv(serverSourceAnalytics.sourceSummaries, serverSourceAnalytics.attributionNote);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `growth-engine-source-funnel-all-stored-${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Exported full stored-lead source counts for ${serverSourceAnalytics.sourceSummaries.length} source category(s). Source labels are self-declared.`);
      setError("");
    } catch (exportError) {
      setError(readableError(exportError));
    }
  }

  async function loadPlanUsageReconciliation() {
    if (!api || !organisationId || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin")) return;
    const requestedOrganisationId = organisationId;
    setLoadingPlanUsageReconciliation(true);
    setError("");
    try {
      const result = await api.getOrganisationPlanUsageReconciliation({ organisationId: requestedOrganisationId });
      if (currentOrganisationIdRef.current === requestedOrganisationId) setPlanUsageReconciliation(result);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoadingPlanUsageReconciliation(false);
    }
  }

  async function loadOrganisationPlanUsage() {
    if (!api || !organisationId || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin")) return;
    const requestedOrganisationId = organisationId;
    setLoadingPlanUsage(true);
    setError("");
    try {
      const summary = await api.getOrganisationPlanUsage({ organisationId: requestedOrganisationId });
      if (currentOrganisationIdRef.current === requestedOrganisationId) setOrganisationPlanUsage(summary);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoadingPlanUsage(false);
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

  async function loadOnboardingCohortCoverage() {
    if (!api || !organisationId || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || loadingOnboardingCohortCoverage) return;
    const requestedOrganisationId = organisationId;
    setLoadingOnboardingCohortCoverage(true);
    setError("");
    try {
      const coverage = await api.getOnboardingCohortCoverage({ organisationId: requestedOrganisationId });
      if (currentOrganisationIdRef.current === requestedOrganisationId) setOnboardingCohortCoverage(coverage);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoadingOnboardingCohortCoverage(false);
    }
  }

  async function loadContactReviewQueueSummary() {
    if (!api || !organisationId || loadingContactReviewQueueSummary) return;
    const requestedOrganisationId = organisationId;
    setLoadingContactReviewQueueSummary(true);
    setError("");
    try {
      const summary = await api.getContactReviewQueueSummary({ organisationId: requestedOrganisationId });
      if (currentOrganisationIdRef.current === requestedOrganisationId) setContactReviewQueueSummary(summary);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoadingContactReviewQueueSummary(false);
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

  function exportOnboardingCohorts() {
    const summary = onboardingCohortSummary;
    if (!summary || summary.organisationId !== organisationId || summary.cohorts.length === 0) return;
    try {
      const csv = serializeOnboardingCohortCsv(summary.cohorts, summary.attributionNote);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `growth-engine-onboarding-cohorts-${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${summary.cohorts.length} monthly onboarding cohort row(s). Legacy timestamp limitations are included in the CSV.`);
      setError("");
    } catch {
      setError("The onboarding cohort CSV could not be prepared in this browser. Please try again.");
    }
  }

  async function loadFullCampaignAnalytics() {
    if (!api || !organisationId || loadingFullCampaignAnalytics) return;
    const requestedOrganisationId = organisationId;
    setLoadingFullCampaignAnalytics(true);
    setError("");
    try {
      const allCampaigns: CampaignSummary[] = [];
      const seenCampaignIds = new Set<string>();
      let pageToken: string | undefined;
      let hasMoreCampaigns = true;
      for (let pageIndex = 0; pageIndex < 2 && hasMoreCampaigns; pageIndex += 1) {
        const result = await api.listCampaigns({ organisationId: requestedOrganisationId, ...(pageToken ? { pageToken } : {}) });
        if (currentOrganisationIdRef.current !== requestedOrganisationId) return;
        for (const campaign of result.campaigns) {
          if (!seenCampaignIds.has(campaign.id)) {
            seenCampaignIds.add(campaign.id);
            allCampaigns.push(campaign);
          }
        }
        if (allCampaigns.length > 20) throw new Error("The full campaign chart is capped at 20 campaigns to stay within safe analytics rate limits.");
        hasMoreCampaigns = result.hasMoreCampaigns === true;
        if (hasMoreCampaigns && !result.nextPageToken) throw new Error("The server did not provide a safe campaign continuation cursor. No chart was displayed.");
        pageToken = result.nextPageToken ?? undefined;
      }
      if (hasMoreCampaigns) throw new Error("The campaign inventory exceeds the 20-campaign chart limit. No partial chart was displayed.");
      if (allCampaigns.length === 0) throw new Error("There are no campaigns to chart yet.");
      const campaigns: Array<{ campaignName: string; summary: CampaignFunnelAnalyticsSummary }> = [];
      for (const campaign of allCampaigns) {
        const summary = await api.getCampaignFunnelSummary({ organisationId: requestedOrganisationId, campaignId: campaign.id });
        if (currentOrganisationIdRef.current !== requestedOrganisationId) return;
        campaigns.push({ campaignName: campaign.name, summary });
      }
      if (currentOrganisationIdRef.current === requestedOrganisationId) {
        setFullCampaignAnalytics({ organisationId: requestedOrganisationId, campaigns });
        setNotice(`Loaded complete server-side funnel counts for ${campaigns.length} campaign(s).`);
      }
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setLoadingFullCampaignAnalytics(false);
    }
  }

  async function exportFullCampaignAnalytics() {
    if (!api || !organisationId || exportingFullCampaignAnalytics) return;
    const requestedOrganisationId = organisationId;
    setExportingFullCampaignAnalytics(true);
    setError("");
    setNotice("");
    try {
      const allCampaigns: CampaignSummary[] = [];
      const seenCampaignIds = new Set<string>();
      let pageToken: string | undefined;
      let hasMoreCampaigns = true;
      for (let pageIndex = 0; pageIndex < 2 && hasMoreCampaigns; pageIndex += 1) {
        const result = await api.listCampaigns({ organisationId: requestedOrganisationId, ...(pageToken ? { pageToken } : {}) });
        if (currentOrganisationIdRef.current !== requestedOrganisationId) return;
        for (const campaign of result.campaigns) {
          if (!seenCampaignIds.has(campaign.id)) {
            seenCampaignIds.add(campaign.id);
            allCampaigns.push(campaign);
          }
        }
        if (allCampaigns.length > 20) throw new Error("The full campaign report is capped at 20 campaigns to stay within safe analytics rate limits. No file was downloaded.");
        hasMoreCampaigns = result.hasMoreCampaigns === true;
        if (hasMoreCampaigns && !result.nextPageToken) throw new Error("The server did not provide a safe campaign continuation cursor. No file was downloaded.");
        pageToken = result.nextPageToken ?? undefined;
      }
      if (hasMoreCampaigns) throw new Error("The full campaign report exceeds the 20-campaign safety limit. No partial file was downloaded.");
      if (allCampaigns.length === 0) throw new Error("There are no campaigns to include in the full report yet.");
      const summaries: CampaignFunnelAnalyticsSummary[] = [];
      for (const campaign of allCampaigns) {
        const summary = await api.getCampaignFunnelSummary({ organisationId: requestedOrganisationId, campaignId: campaign.id });
        if (currentOrganisationIdRef.current !== requestedOrganisationId) return;
        summaries.push(summary);
      }
      const names = new Map(allCampaigns.map((campaign) => [campaign.id, campaign.name]));
      const csv = serializeFullCampaignFunnelCsv(summaries.map((summary) => ({
        campaignName: names.get(summary.campaignId) ?? summary.campaignId,
        totalLeadCount: summary.totalLeadCount,
        qualifiedLeadCount: summary.qualifiedLeadCount,
        contactedLeadCount: summary.contactedLeadCount,
        onboardedLeadCount: summary.onboardedLeadCount,
        qualifiedRatePercent: summary.qualifiedRatePercent,
        onboardedRatePercent: summary.onboardedRatePercent,
      })));
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `growth-engine-campaign-funnel-all-stored-${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Exported full stored-lead funnel counts for ${summaries.length} campaign(s). This report is not limited to loaded lead pages.`);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setExportingFullCampaignAnalytics(false);
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

  async function exportAllStoredLeads(applyCurrentFilters = false) {
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
      const query = leadSearch.trim().toLocaleLowerCase("en-GB");
      const exportLeads = applyCurrentFilters ? allLeads.filter((lead) => {
        const matchesSearch = !query || [lead.businessName, lead.category, lead.location, lead.website, lead.email, lead.phone]
          .some((value) => value.toLocaleLowerCase("en-GB").includes(query));
        const reviewStatus = getLeadContactReviewStatus(lead);
        const matchesCompleteness = leadCompletenessFilter === "all"
          || (leadCompletenessFilter === "low" && lead.score < 40)
          || (leadCompletenessFilter === "medium" && lead.score >= 40 && lead.score < 70)
          || (leadCompletenessFilter === "high" && lead.score >= 70);
        return matchesSearch && matchesCompleteness
          && (leadStatusFilter === "all" || lead.status === leadStatusFilter)
          && (leadCampaignFilter === "all" || lead.campaignId === leadCampaignFilter)
          && (leadSourceFilter === "all" || lead.source === leadSourceFilter)
          && (contactReviewFilter === "all" || reviewStatus === contactReviewFilter);
      }) : allLeads;
      const csv = serializeLeadExportCsv(exportLeads, campaignNames);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `growth-engine-${applyCurrentFilters ? "filtered-leads" : "all-leads"}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(applyCurrentFilters
        ? `Exported ${exportLeads.length} lead(s) matching current filters from ${allLeads.length} stored lead(s) across ${allCampaigns.length} campaign(s).`
        : `Exported all ${allLeads.length} stored lead(s) across ${allCampaigns.length} campaign(s). Current filters were not applied.`);
    } catch (reason) {
      setError(readableError(reason));
    } finally {
      setExportingAllLeads(false);
    }
  }

  return <main className="cloud-shell cloud-dashboard"><header className="cloud-header"><div><div className="cloud-brand">AT <span>Growth Engine</span></div><p className="cloud-eyebrow">FIREBASE CLOUD MODE</p></div><div className="cloud-user"><span>{user.email}</span><button className="cloud-secondary" onClick={() => void signOut(client.auth)}>Sign out</button></div></header>
    <section className="cloud-card cloud-intro"><div><p className="cloud-eyebrow">PERSISTED WORKSPACE</p><h1>Provider acquisition workspace</h1><p className="cloud-muted">Changes are stored through authenticated server functions. Outreach remains draft-only.</p></div><span className="cloud-safe-badge">NO AUTOMATIC SENDING</span></section>
    {notice && <p className="cloud-notice" role="status">{notice}</p>}{error && <p className="cloud-error" role="alert">{error}</p>}
    <section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">TENANT CONTEXT</p><h2>Organisation</h2></div></div>{hasMoreOrganisations && <div className="cloud-pagination"><p className="cloud-muted">Showing {organisations.length} organisations. More workspaces are available.</p><button className="cloud-secondary" type="button" disabled={loadingMoreOrganisations} onClick={() => void loadMoreOrganisations()}>{loadingMoreOrganisations ? "Loading workspaces…" : "Load more organisations"}</button></div>}{organisations.length > 0 ? <label className="cloud-field">Current organisation<select disabled={Boolean(campaignIdempotencyKey) || editingDraftId.startsWith("new:")} value={organisationId} onChange={(event) => { setOrganisationId(event.target.value); setOffboardingPreview(null); setOnboardingCohortSummary(null); setOrganisationPlanUsage(null); setPlanUsageReconciliation(null); setMemberRoster(null); }}>{organisations.map((org) => <option key={org.organisationId} value={org.organisationId}>{org.name} · {org.role}</option>)}</select></label> : <p className="cloud-muted">Create an organisation to begin. Your account cannot read other organisations unless you are a member.</p>}{selectedOrganisation && <form className="cloud-inline-form" onSubmit={(event) => void saveOrganisationSettings(event)}><label className="cloud-field">Organisation display name<input required maxLength={100} disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin")} value={organisationSettingsName} onChange={(event) => setOrganisationSettingsName(event.target.value)} /></label><button className="cloud-secondary" disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || !organisationSettingsName.trim() || organisationSettingsName.trim() === selectedOrganisation.name}>Save workspace settings</button>{selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin" && <p className="cloud-muted">Only organisation owners and admins can change workspace settings.</p>}</form>}{selectedOrganisation && <form className="cloud-inline-form" onSubmit={(event) => void addOrganisationMember(event)}><label className="cloud-field">Add existing account by email<input type="email" required maxLength={254} autoComplete="email" disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || Boolean(memberAdditionIdempotencyKey)} value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="teammate@example.com" /></label><label className="cloud-field">Member role<select disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || Boolean(memberAdditionIdempotencyKey)} value={memberRole} onChange={(event) => setMemberRole(event.target.value as "member" | "viewer")}><option value="member">Member</option><option value="viewer">Viewer</option></select></label>{memberAdditionIdempotencyKey && <p className="cloud-muted" role="status">A member addition is awaiting confirmation. Retry with the same email and role to avoid a duplicate request.</p>}<button className="cloud-secondary" disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin") || !memberEmail.trim()}>{busy ? "Adding member…" : memberAdditionIdempotencyKey ? "Retry member addition" : "Add member"}</button>{selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin" && <p className="cloud-muted">Only organisation owners and admins can add members.</p>}</form>}
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
      {selectedOrganisation && (selectedOrganisationRole === "owner" || selectedOrganisationRole === "admin") && <section className="cloud-card" aria-labelledby="member-roster-title">
        <div className="cloud-section-head"><div><p className="cloud-eyebrow">TEAM ACCESS</p><h2 id="member-roster-title">Organisation members</h2><p className="cloud-muted">View current member roles and the email address on each Firebase Auth account. Owners can change roles or remove non-owner members; admins can remove members/viewers only. Removing access does not delete the account.</p></div>
          <button className="cloud-secondary" type="button" disabled={loadingMemberRoster} onClick={() => void loadOrganisationMembers()}>{loadingMemberRoster ? "Loading members…" : memberRoster?.organisationId === organisationId ? "Refresh member roster" : "Load member roster"}</button>
        </div>
        {memberRoster?.organisationId === organisationId && <><p className="cloud-muted">{memberRoster.members.length} member(s) loaded. {memberRoster.hasMoreMembers ? "More members are available." : "Roster complete."}</p>
          <div className="cloud-table-wrap"><table className="cloud-table"><caption>Organisation member roster</caption><thead><tr><th>Account email</th><th>Role</th><th>Joined</th><th>Actions</th></tr></thead><tbody>{memberRoster.members.map((member) => <tr key={member.uid}><td>{member.email ?? "Email unavailable"}<small>Account ID: {member.uid}</small></td><td>{member.role}</td><td>{member.createdAt ? new Date(member.createdAt).toLocaleDateString("en-GB") : "Date unavailable"}</td><td>{selectedOrganisationRole === "owner" && member.role !== "owner" && member.uid !== user?.uid ? <div className="cloud-inline-form"><label className="cloud-field">Role<select aria-label={`Role for ${member.email ?? member.uid}`} disabled={busy} value={memberRoleSelections[member.uid] ?? member.role} onChange={(event) => setMemberRoleSelections((current) => ({ ...current, [member.uid]: event.target.value as "admin" | "member" | "viewer" }))}><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option></select></label><button className="cloud-secondary" type="button" disabled={busy || (memberRoleSelections[member.uid] ?? member.role) === member.role} onClick={() => void updateOrganisationMemberRole(member.uid, memberRoleSelections[member.uid] ?? (member.role as "admin" | "member" | "viewer"), member.role)}>Save role</button><button className="cloud-secondary" type="button" disabled={busy} onClick={() => void removeOrganisationMember(member.uid, member.role)}>Remove access</button></div> : member.role !== "owner" && member.uid !== user?.uid && selectedOrganisationRole === "admin" && (member.role === "member" || member.role === "viewer") ? <button className="cloud-secondary" type="button" disabled={busy} onClick={() => void removeOrganisationMember(member.uid, member.role)}>Remove access</button> : <span className="cloud-muted">—</span>}</td></tr>)}</tbody></table></div>
          {memberRoster.hasMoreMembers && memberRoster.nextPageToken && <button className="cloud-secondary" type="button" disabled={loadingMemberRoster} onClick={() => void loadOrganisationMembers(memberRoster.nextPageToken ?? undefined)}>{loadingMemberRoster ? "Loading more members…" : "Load more members"}</button>}
        </>}
      </section>}
      <form className="cloud-inline-form" onSubmit={(event) => void createOrganisation(event)}><label className="cloud-field">{organisations.length ? "Create another organisation" : "Organisation name"}<input required disabled={Boolean(organisationIdempotencyKey)} maxLength={100} value={organisationName} onChange={(event) => setOrganisationName(event.target.value)} placeholder="e.g. AnyTrader pilot" /></label>{organisationIdempotencyKey && <p className="cloud-muted" role="status">A save attempt is pending. Retry without changing the name so the same request key is reused and duplicate organisations are avoided.</p>}<button className="cloud-primary" disabled={busy || !organisationName.trim()}>{busy ? "Saving…" : organisationIdempotencyKey ? "Retry save (same request)" : "Create organisation"}</button></form></section>
    {selectedOrganisation && <><section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">CAMPAIGN PERFORMANCE</p><h2>Acquisition pipeline overview</h2><p className="cloud-muted">The default table uses loaded records. Use “Load full counts” for per-campaign server aggregates. Export full campaign report downloads server-counted totals across all stored leads (up to 20 campaigns); the loaded report remains page-limited.</p></div><button className="cloud-secondary" disabled={!campaignPerformance.length} onClick={exportCampaignPerformance}>Export loaded campaign report (CSV)</button><button className="cloud-secondary" type="button" disabled={!campaigns.length || exportingFullCampaignAnalytics} onClick={() => void exportFullCampaignAnalytics()}>{exportingFullCampaignAnalytics ? "Preparing full report…" : "Export full campaign report (CSV)"}</button><button className="cloud-secondary" type="button" onClick={() => setShowCampaignReadiness((current) => !current)}>{showCampaignReadiness ? "Hide readiness preflight" : "Show readiness preflight"}</button></div>{(hasMoreCampaigns || hasMoreLeads || hasMoreDrafts) && <p className="cloud-warning" role="status">Partial view: more pages are available. Load more campaigns, leads and drafts to improve coverage before comparing campaign results.</p>}{campaignPerformance.length > 0 && <div className="cloud-campaign-chart" role="group" aria-label="Loaded campaign funnel chart"><p className="cloud-muted">Visual comparison of the currently loaded lead records only; use full server counts for complete campaign totals.</p><div className="cloud-campaign-chart-head"><span>Campaign</span><span>Leads</span><span>Qualified</span><span>Contacted</span><span>Onboarded</span></div>{(() => { const maxLeads = Math.max(1, ...campaignPerformance.map((item) => item.loadedLeadCount)); return campaignPerformance.map((item) => <div className="cloud-campaign-chart-row" key={item.campaignId}><strong>{item.campaignName}</strong><div><small>{item.loadedLeadCount}</small><progress aria-label={`${item.campaignName} loaded leads`} max={maxLeads} value={item.loadedLeadCount} /></div><div><small>{item.qualifiedLeadCount}</small><progress aria-label={`${item.campaignName} qualified leads`} max={maxLeads} value={item.qualifiedLeadCount} /></div><div><small>{item.contactedLeadCount}</small><progress aria-label={`${item.campaignName} contacted leads`} max={maxLeads} value={item.contactedLeadCount} /></div><div><small>{item.onboardedLeadCount}</small><progress aria-label={`${item.campaignName} onboarded leads`} max={maxLeads} value={item.onboardedLeadCount} /></div></div>); })()}</div>}{campaignPerformance.length ? <div className="cloud-table-wrap"><table className="cloud-table"><caption>Campaign counts from loaded records only</caption><thead><tr><th>Campaign</th><th>Loaded leads</th><th>Qualified</th><th>Contacted</th><th>Onboarded</th><th>Qualified rate (loaded leads)</th><th>Onboarded rate (loaded leads)</th><th>All-records funnel (server)</th><th>Restricted / review needed</th><th>Loaded drafts</th><th>Drafts needing review</th></tr></thead><tbody>{campaignPerformance.map((item) => <tr key={item.campaignId}><td><strong>{item.campaignName}</strong></td><td>{item.loadedLeadCount}</td><td>{item.qualifiedLeadCount}</td><td>{item.contactedLeadCount}</td><td>{item.onboardedLeadCount}</td><td>{item.qualifiedRatePercent.toFixed(1)}%</td><td>{item.onboardedRatePercent.toFixed(1)}%</td><td>{serverCampaignAnalytics[`${organisationId}:${item.campaignId}`] ? <div className="cloud-analytics-summary"><strong>{serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].totalLeadCount} total leads</strong><span>{serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].qualifiedLeadCount} qualified · {serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].contactedLeadCount} contacted · {serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].onboardedLeadCount} onboarded</span><span>{serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].qualifiedRatePercent.toFixed(1)}% qualified · {serverCampaignAnalytics[`${organisationId}:${item.campaignId}`].onboardedRatePercent.toFixed(1)}% onboarded</span><button className="cloud-link" type="button" disabled={loadingCampaignAnalyticsKey === `${organisationId}:${item.campaignId}`} onClick={() => void loadCampaignFunnelAnalytics(item.campaignId)}>{loadingCampaignAnalyticsKey === `${organisationId}:${item.campaignId}` ? "Refreshing…" : "Refresh full counts"}</button></div> : <button className="cloud-secondary" type="button" disabled={loadingCampaignAnalyticsKey === `${organisationId}:${item.campaignId}`} onClick={() => void loadCampaignFunnelAnalytics(item.campaignId)}>{loadingCampaignAnalyticsKey === `${organisationId}:${item.campaignId}` ? "Loading…" : "Load full counts"}</button>}</td><td>{item.restrictedLeadCount}</td><td>{item.loadedDraftCount}</td><td>{item.draftsAwaitingReview}</td></tr>)}</tbody></table></div> : <p className="cloud-empty">Create a campaign to start tracking acquisition activity.</p>}{fullCampaignAnalytics?.organisationId === organisationId && <div className="cloud-campaign-chart cloud-campaign-chart-full" role="group" aria-label="Full campaign funnel chart"><p className="cloud-muted">Server-counted totals across all stored leads. Up to 20 campaigns are shown; this chart is independent of loaded lead pages.</p><div className="cloud-campaign-chart-head"><span>Campaign</span><span>All leads</span><span>Qualified</span><span>Contacted</span><span>Onboarded</span></div>{(() => { const maxLeads = Math.max(1, ...fullCampaignAnalytics.campaigns.map((item) => item.summary.totalLeadCount)); return fullCampaignAnalytics.campaigns.map((item) => <div className="cloud-campaign-chart-row" key={item.summary.campaignId}><strong>{item.campaignName}</strong><div><small>{item.summary.totalLeadCount}</small><progress aria-label={`${item.campaignName} all stored leads`} max={maxLeads} value={item.summary.totalLeadCount} /></div><div><small>{item.summary.qualifiedLeadCount}</small><progress aria-label={`${item.campaignName} qualified leads (all stored)`} max={maxLeads} value={item.summary.qualifiedLeadCount} /></div><div><small>{item.summary.contactedLeadCount}</small><progress aria-label={`${item.campaignName} contacted leads (all stored)`} max={maxLeads} value={item.summary.contactedLeadCount} /></div><div><small>{item.summary.onboardedLeadCount}</small><progress aria-label={`${item.campaignName} onboarded leads (all stored)`} max={maxLeads} value={item.summary.onboardedLeadCount} /></div></div>); })()}</div>}</section>{showCampaignReadiness && <section className="cloud-card" aria-labelledby="campaign-readiness-title"><div className="cloud-section-head"><div><p className="cloud-eyebrow">READ-ONLY PRE-FLIGHT</p><h2 id="campaign-readiness-title">Campaign readiness preflight</h2><p className="cloud-muted">This is a conservative check of loaded records only, not approval to contact prospects. It never sends outreach. If more pages are available, every result is marked incomplete.</p></div></div>{campaignReadiness.length ? <div className="cloud-table-wrap"><table className="cloud-table" aria-label="Campaign readiness preflight"><thead><tr><th>Campaign</th><th>Status</th><th>Loaded leads</th><th>Contact restrictions / review</th><th>Drafts needing review</th><th>Missing source labels</th><th>Missing setup fields</th><th>Coverage</th></tr></thead><tbody>{campaignReadiness.map((item) => <tr key={item.campaignId}><td><strong>{item.campaignName}</strong></td><td>{item.status === "ready_for_manual_review" ? "Ready for manual review" : item.status.replace(/_/g, " ")}</td><td>{item.loadedLeadCount}</td><td>{item.contactRestrictedLeadCount}</td><td>{item.draftsAwaitingReview}</td><td>{item.sourceAttributionMissingCount}</td><td>{item.missingConfigurationFields.length ? item.missingConfigurationFields.join(", ") : "None"}</td><td>{item.hasMoreData ? "Incomplete — more pages available" : "Complete for currently loaded data"}</td></tr>)}</tbody></table></div> : <p className="cloud-empty">Create a campaign to run a readiness preflight.</p>}</section>}<section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">SOURCE ATTRIBUTION</p><h2>Lead source performance</h2><p className="cloud-muted">Source labels are self-declared, not independently verified. The default table uses loaded leads; load full counts for all stored records, then export the server-counted source report. The export contains aggregate counts only.</p></div><button className="cloud-secondary" type="button" disabled={loadingSourceAnalyticsOrganisationId === organisationId} onClick={() => void loadLeadSourceFunnelAnalytics()}>{loadingSourceAnalyticsOrganisationId === organisationId ? "Loading full source counts…" : serverSourceAnalytics?.organisationId === organisationId ? "Refresh full source counts" : "Load full source counts"}</button><button className="cloud-secondary" type="button" disabled={serverSourceAnalytics?.organisationId !== organisationId} onClick={exportFullLeadSourceAnalytics}>Export full source report (CSV)</button></div>{sourcePerformance.length ? <div className="cloud-table-wrap"><table className="cloud-table"><caption>Self-declared source performance from loaded leads</caption><thead><tr><th>Source (self-declared)</th><th>Loaded leads</th><th>Qualified</th><th>Onboarded</th><th>Qualified rate (loaded source leads)</th><th>Onboarded rate (loaded source leads)</th></tr></thead><tbody>{sourcePerformance.map((item) => <tr key={item.source}><td>{formatLeadSourceLabel(item.source)}</td><td>{item.loadedLeadCount}</td><td>{item.qualifiedLeadCount}</td><td>{item.onboardedLeadCount}</td><td>{item.qualifiedRatePercent.toFixed(1)}%</td><td>{item.onboardedRatePercent.toFixed(1)}%</td></tr>)}</tbody></table></div> : <p className="cloud-empty">Import or add leads to see source attribution. This view will not invent source information for unlabelled records.</p>}{serverSourceAnalytics?.organisationId === organisationId && <div className="cloud-server-analytics"><p className="cloud-muted">Complete server-side totals across all stored leads. {serverSourceAnalytics.attributionNote}</p><div className="cloud-source-chart" role="group" aria-label="All-record lead source funnel chart"><div className="cloud-source-chart-head"><span>Source</span><span>All leads</span><span>Qualified</span><span>Onboarded</span></div>{(() => { const maxLeads = Math.max(1, ...serverSourceAnalytics.sourceSummaries.map((item) => item.totalLeadCount)); return serverSourceAnalytics.sourceSummaries.map((item) => { const label = formatLeadSourceLabel(item.source); return <div className="cloud-source-chart-row" key={item.source}><strong>{label}</strong><div><small>{item.totalLeadCount}</small><progress aria-label={`${label} all stored leads`} max={maxLeads} value={item.totalLeadCount} /></div><div><small>{item.qualifiedLeadCount}</small><progress aria-label={`${label} qualified leads`} max={maxLeads} value={item.qualifiedLeadCount} /></div><div><small>{item.onboardedLeadCount}</small><progress aria-label={`${label} onboarded leads`} max={maxLeads} value={item.onboardedLeadCount} /></div></div>; }); })()}</div><div className="cloud-table-wrap"><table className="cloud-table"><caption>All-record source attribution</caption><thead><tr><th>Source (self-declared)</th><th>All stored leads</th><th>Qualified</th><th>Onboarded</th><th>Qualified rate</th><th>Onboarded rate</th></tr></thead><tbody>{serverSourceAnalytics.sourceSummaries.map((item) => <tr key={item.source}><td>{formatLeadSourceLabel(item.source)}</td><td>{item.totalLeadCount}</td><td>{item.qualifiedLeadCount}</td><td>{item.onboardedLeadCount}</td><td>{item.qualifiedRatePercent.toFixed(1)}%</td><td>{item.onboardedRatePercent.toFixed(1)}%</td></tr>)}</tbody></table></div></div>}</section>{(selectedOrganisationRole === "owner" || selectedOrganisationRole === "admin") && <section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">PLAN USAGE</p><h2>Plan limits and usage</h2><p className="cloud-muted">Read-only, server-maintained counters for the selected organisation.</p></div><button className="cloud-secondary" type="button" disabled={loadingPlanUsage} onClick={() => void loadOrganisationPlanUsage()}>{loadingPlanUsage ? "Loading plan usage…" : organisationPlanUsage?.organisationId === organisationId ? "Refresh plan usage" : "Load plan usage"}</button>{organisationPlanUsage?.organisationId === organisationId && <button className="cloud-secondary" type="button" disabled={loadingPlanUsageReconciliation} onClick={() => void loadPlanUsageReconciliation()}>{loadingPlanUsageReconciliation ? "Inspecting…" : planUsageReconciliation?.organisationId === organisationId ? "Refresh reconciliation" : "Inspect reconciliation"}</button>}</div>{organisationPlanUsage?.organisationId === organisationId && <><p className="cloud-muted">{organisationPlanUsage.plan.displayName} plan · {organisationPlanUsage.message}</p>{organisationPlanUsage.status === "reconciliation_required" || !organisationPlanUsage.usage || !organisationPlanUsage.remaining ? <p className="cloud-warning" role="status">Usage reconciliation required. Numeric usage is intentionally hidden until existing resources can be reconciled safely.</p> : <div className="cloud-table-wrap"><table className="cloud-table"><caption>Server-maintained plan usage for {organisationPlanUsage.aiUsagePeriod}</caption><thead><tr><th>Metric</th><th>Used</th><th>Limit</th><th>Remaining</th><th>Status</th></tr></thead><tbody><tr><td>Campaigns (lifetime)</td><td>{organisationPlanUsage.usage.campaigns}</td><td>{organisationPlanUsage.plan.limits.campaigns}</td><td>{organisationPlanUsage.remaining.campaigns}</td><td><span aria-label="Quota status for Campaigns (lifetime)" className={getQuotaUsageState(organisationPlanUsage.remaining.campaigns, organisationPlanUsage.plan.limits.campaigns).className}>{getQuotaUsageState(organisationPlanUsage.remaining.campaigns, organisationPlanUsage.plan.limits.campaigns).label}</span></td></tr><tr><td>Leads (lifetime)</td><td>{organisationPlanUsage.usage.leads}</td><td>{organisationPlanUsage.plan.limits.leads}</td><td>{organisationPlanUsage.remaining.leads}</td><td><span aria-label="Quota status for Leads (lifetime)" className={getQuotaUsageState(organisationPlanUsage.remaining.leads, organisationPlanUsage.plan.limits.leads).className}>{getQuotaUsageState(organisationPlanUsage.remaining.leads, organisationPlanUsage.plan.limits.leads).label}</span></td></tr><tr><td>Organisation members (current counter)</td><td>{organisationPlanUsage.usage.members}</td><td>{organisationPlanUsage.plan.limits.members}</td><td>{organisationPlanUsage.remaining.members}</td><td><span aria-label="Quota status for Organisation members (current counter)" className={getQuotaUsageState(organisationPlanUsage.remaining.members, organisationPlanUsage.plan.limits.members).className}>{getQuotaUsageState(organisationPlanUsage.remaining.members, organisationPlanUsage.plan.limits.members).label}</span></td></tr><tr><td>AI suggestions (UTC month)</td><td>{organisationPlanUsage.usage.monthlyAiSuggestions}</td><td>{organisationPlanUsage.plan.limits.monthlyAiSuggestions}</td><td>{organisationPlanUsage.remaining.monthlyAiSuggestions}</td><td><span aria-label="Quota status for AI suggestions (UTC month)" className={getQuotaUsageState(organisationPlanUsage.remaining.monthlyAiSuggestions, organisationPlanUsage.plan.limits.monthlyAiSuggestions).className}>{getQuotaUsageState(organisationPlanUsage.remaining.monthlyAiSuggestions, organisationPlanUsage.plan.limits.monthlyAiSuggestions).label}</span></td></tr></tbody></table></div>}</>}{planUsageReconciliation?.organisationId === organisationId && <div className="cloud-server-analytics"><p className="cloud-muted">Read-only reconciliation preview · {planUsageReconciliation.status} usage snapshot · no counters were changed.</p><div className="cloud-table-wrap"><table className="cloud-table"><caption>Actual resource counts versus stored plan counters</caption><thead><tr><th>Metric</th><th>Actual documents</th><th>Stored counter</th><th>Result</th></tr></thead><tbody>{(["campaigns", "leads", "members"] as const).map((metric) => <tr key={metric}><td>{metric}</td><td>{planUsageReconciliation.actual[metric]}</td><td>{planUsageReconciliation.stored ? planUsageReconciliation.stored[metric] : "Unavailable"}</td><td>{planUsageReconciliation.status !== "present" ? "Review required" : planUsageReconciliation.mismatchedMetrics.includes(metric) ? "Mismatch" : "Match"}</td></tr>)}</tbody></table></div><p className="cloud-muted">AI usage review required: {planUsageReconciliation.aiUsageReviewRequired ? "yes" : "no"} · Stored AI period: {planUsageReconciliation.stored?.aiUsagePeriod ?? "unavailable"} · Current UTC period: {planUsageReconciliation.currentAiUsagePeriod ?? "unavailable"}</p><ul>{planUsageReconciliation.notes.map((note) => <li key={note}>{note}</li>)}</ul></div>}</section>}<section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">ONBOARDING COHORTS</p><h2>Monthly first-onboarding trend</h2><p className="cloud-muted">Server-side counts based on each lead’s first recorded onboarding timestamp, across all stored leads.</p></div><button className="cloud-secondary" type="button" disabled={loadingOnboardingCohorts} onClick={() => void loadOnboardingCohorts()}>{loadingOnboardingCohorts ? "Loading cohorts…" : onboardingCohortSummary?.organisationId === organisationId ? "Refresh onboarding cohorts" : "Load onboarding cohorts"}</button>{onboardingCohortSummary?.organisationId === organisationId && <button className="cloud-secondary" type="button" disabled={onboardingCohortSummary.cohorts.length === 0} onClick={exportOnboardingCohorts}>Export cohort CSV</button>}{(selectedOrganisationRole === "owner" || selectedOrganisationRole === "admin") && <button className="cloud-secondary" type="button" disabled={loadingOnboardingCohortCoverage} onClick={() => void loadOnboardingCohortCoverage()}>{loadingOnboardingCohortCoverage ? "Checking history…" : onboardingCohortCoverage?.organisationId === organisationId ? "Refresh history coverage" : "Preview legacy timestamp coverage"}</button>}</div>{onboardingCohortSummary?.organisationId === organisationId && <><p className="cloud-muted">{onboardingCohortSummary.attributionNote}</p><div className="cloud-cohort-chart" role="group" aria-label="Monthly first-onboarding counts chart">{(() => { const maxCount = Math.max(1, ...onboardingCohortSummary.cohorts.map((cohort) => cohort.onboardedLeadCount)); return onboardingCohortSummary.cohorts.map((cohort) => <div className="cloud-cohort-chart-row" key={cohort.month}><span>{cohort.month}</span><progress aria-label={`${cohort.month} first onboardings`} max={maxCount} value={cohort.onboardedLeadCount} /><strong>{cohort.onboardedLeadCount}</strong></div>); })()}</div><div className="cloud-table-wrap"><table className="cloud-table"><caption>First-onboarding cohorts by UTC calendar month (last {onboardingCohortSummary.windowMonths} months)</caption><thead><tr><th>UTC month</th><th>First onboardings</th></tr></thead><tbody>{onboardingCohortSummary.cohorts.map((cohort) => <tr key={cohort.month}><td>{cohort.month}</td><td>{cohort.onboardedLeadCount}</td></tr>)}</tbody></table></div></>}{onboardingCohortCoverage?.organisationId === organisationId && <div className="cloud-server-analytics"><p className="cloud-muted">{onboardingCohortCoverage.note}</p>{(() => { const total = onboardingCohortCoverage.totalOnboardedLeadCount; const timestamped = onboardingCohortCoverage.timestampedOnboardedLeadCount; const coveragePercent = total > 0 ? Math.round((timestamped / total) * 100) : 0; return <div className="cloud-coverage-meter"><div className="cloud-section-head"><strong>First-onboarding timestamp coverage</strong><strong>{coveragePercent}%</strong></div><progress aria-label="First-onboarding timestamp coverage" max={Math.max(total, 1)} value={timestamped} /><p className="cloud-muted">{timestamped} of {total} currently onboarded lead(s) have a valid first-onboarding timestamp. {total === 0 ? "No onboarded leads were found in this scan." : coveragePercent === 100 ? "All scanned onboarded leads have valid timestamps." : "Missing timestamps need a reviewed backfill plan; no dates are inferred automatically."}</p></div>; })()}<div className="cloud-table-wrap"><table className="cloud-table" aria-label="Onboarding timestamp coverage"><caption>Read-only onboarding timestamp coverage</caption><thead><tr><th>Currently onboarded leads</th><th>Valid first-onboarding timestamp</th><th>Missing or invalid timestamp</th><th>Scan limit</th></tr></thead><tbody><tr><td>{onboardingCohortCoverage.totalOnboardedLeadCount}</td><td>{onboardingCohortCoverage.timestampedOnboardedLeadCount}</td><td>{onboardingCohortCoverage.missingOrInvalidOnboardedTimestampCount}</td><td>{onboardingCohortCoverage.scanLimit}</td></tr></tbody></table></div>{onboardingCohortCoverage.totalOnboardedLeadCount >= onboardingCohortCoverage.scanLimit && <p className="cloud-warning" role="status">The 1,000-record scan cap was reached. Review the inventory before drawing conclusions about any larger dataset.</p>}</div>}</section><section className="cloud-columns"><article className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">CAMPAIGNS</p><h2>Campaign setup</h2></div><span className="cloud-count">{campaigns.length}</span></div><form className="cloud-form" onSubmit={(event) => void createCampaign(event)}><label>Campaign name<input required disabled={Boolean(campaignIdempotencyKey)} maxLength={120} value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder="Manchester painter pilot" /></label><label>Brand<input required disabled={Boolean(campaignIdempotencyKey)} maxLength={100} value={campaignBrand} onChange={(event) => setCampaignBrand(event.target.value)} /></label><label>Service category<input required disabled={Boolean(campaignIdempotencyKey)} maxLength={100} value={campaignCategory} onChange={(event) => setCampaignCategory(event.target.value)} /></label><label>Target location<input required disabled={Boolean(campaignIdempotencyKey)} maxLength={160} value={campaignLocation} onChange={(event) => setCampaignLocation(event.target.value)} /></label><label>Goal<input disabled={Boolean(campaignIdempotencyKey)} maxLength={500} value={campaignGoal} onChange={(event) => setCampaignGoal(event.target.value)} /></label>{campaignIdempotencyKey && <p className="cloud-muted" role="status">A save attempt is pending. Retry without changing these fields so the same request key is reused and duplicate campaigns are avoided.</p>}<button className="cloud-primary" disabled={busy}>{busy ? "Saving…" : campaignIdempotencyKey ? "Retry save (same request)" : "Create campaign"}</button></form><div className="cloud-list">{campaigns.map((campaign) => <div className="cloud-list-item" key={campaign.id}><div><strong>{campaign.name}</strong><small>{campaign.category} · {campaign.location}</small>{editingCampaignId === campaign.id ? <form className="cloud-form" onSubmit={(event) => void saveCampaignDetails(event)}><label>Campaign name<input required maxLength={120} value={campaignEditFields.name} onChange={(event) => setCampaignEditFields((current) => ({ ...current, name: event.target.value }))} /></label><label>Brand<input required maxLength={100} value={campaignEditFields.brand} onChange={(event) => setCampaignEditFields((current) => ({ ...current, brand: event.target.value }))} /></label><label>Service category<input required maxLength={100} value={campaignEditFields.category} onChange={(event) => setCampaignEditFields((current) => ({ ...current, category: event.target.value }))} /></label><label>Target location<input required maxLength={160} value={campaignEditFields.location} onChange={(event) => setCampaignEditFields((current) => ({ ...current, location: event.target.value }))} /></label><label>Goal<input maxLength={500} value={campaignEditFields.goal} onChange={(event) => setCampaignEditFields((current) => ({ ...current, goal: event.target.value }))} /></label><button className="cloud-primary" disabled={busy}>Save campaign details</button><button className="cloud-secondary" type="button" disabled={busy} onClick={() => setEditingCampaignId("")}>Cancel</button></form> : <button className="cloud-secondary" type="button" disabled={busy || (selectedOrganisationRole !== "owner" && selectedOrganisationRole !== "admin")} onClick={() => { setEditingCampaignId(campaign.id); setCampaignEditFields({ name: campaign.name, brand: campaign.brand, category: campaign.category, location: campaign.location, goal: campaign.goal }); }}>Edit details</button>}</div><span className="cloud-status">{statusLabel(campaign.status)}</span>{(selectedOrganisationRole === "owner" || selectedOrganisationRole === "admin") && <div className="cloud-inline-actions"><button className="cloud-secondary" type="button" disabled={busy || campaign.status === "paused"} onClick={() => void changeCampaignStatus(campaign, "paused")}>Pause</button><button className="cloud-secondary" type="button" disabled={busy || campaign.status === "active"} onClick={() => void changeCampaignStatus(campaign, "active")}>Activate</button><button className="cloud-secondary" type="button" disabled={busy || campaign.status === "completed"} onClick={() => void changeCampaignStatus(campaign, "completed")}>Complete</button></div>}</div>)}{!campaigns.length && <p className="cloud-empty">No campaigns yet.</p>}</div>{hasMoreCampaigns && <div className="cloud-pagination"><button className="cloud-secondary" type="button" disabled={loadingMoreCampaigns} onClick={() => void loadMoreCampaigns()}>{loadingMoreCampaigns ? "Loading campaigns…" : "Load more campaigns"}</button></div>}</article>
      <article className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">LEADS</p><h2>Add a provider lead</h2></div><span className="cloud-count">{leads.length}</span></div>{campaigns.length ? <form className="cloud-form" onSubmit={(event) => void createLead(event)}><label>Campaign<select required disabled={Boolean(leadIdempotencyKey)} value={leadCampaignId} onChange={(event) => setLeadCampaignId(event.target.value)}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label>Business name<input required disabled={Boolean(leadIdempotencyKey)} maxLength={160} value={leadName} onChange={(event) => setLeadName(event.target.value)} /></label><label>Service category<input disabled={Boolean(leadIdempotencyKey)} maxLength={100} value={leadCategory} onChange={(event) => setLeadCategory(event.target.value)} /></label><label>Location<input disabled={Boolean(leadIdempotencyKey)} maxLength={160} value={leadLocation} onChange={(event) => setLeadLocation(event.target.value)} /></label><label>Website<input disabled={Boolean(leadIdempotencyKey)} type="url" maxLength={500} value={leadWebsite} onChange={(event) => setLeadWebsite(event.target.value)} placeholder="https://…" /></label><label>Email<input disabled={Boolean(leadIdempotencyKey)} type="email" maxLength={254} value={leadEmail} onChange={(event) => setLeadEmail(event.target.value)} /></label><label>Phone<input disabled={Boolean(leadIdempotencyKey)} maxLength={80} value={leadPhone} onChange={(event) => setLeadPhone(event.target.value)} /></label>{leadIdempotencyKey && <p className="cloud-muted" role="status">A save attempt is pending. Retry without changing these fields so the same request key is reused and duplicate leads are avoided.</p>}<button className="cloud-primary" disabled={busy || !leadCampaignId}>{busy ? "Saving…" : leadIdempotencyKey ? "Retry save (same request)" : "Save lead"}</button></form> : <p className="cloud-empty">Create a campaign before adding leads.</p>}</article></section>
      <section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">CSV IMPORT</p><h2>Import provider leads</h2><p className="cloud-muted">Choose a CSV, review the parsed rows and warnings, then explicitly confirm import. Files are not uploaded automatically. Imports are capped at 25 rows and imported leads remain suppressed for human review.</p></div></div>{campaigns.length ? <div className="cloud-form"><label>Import into campaign<select required value={csvCampaignId} disabled={csvImportBusy || Boolean(csvAttemptCampaignId)} onChange={(event) => setCsvCampaignId(event.target.value)}><option value="">Choose a campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label>Source label (self-declared)<select value={csvSourceLabel} disabled={csvImportBusy || Boolean(csvAttemptCampaignId)} onChange={(event) => setCsvSourceLabel(event.target.value as CsvImportSourceLabel)}><option value="csv_import">Generic CSV import</option><option value="linkedin_csv">LinkedIn export (only if permitted)</option><option value="google_places_manual">Google Maps/Places research (only if permitted)</option><option value="other_approved">Other approved source</option></select></label><label>CSV file<input type="file" accept=".csv,text/csv" disabled={csvImportBusy || Boolean(csvAttemptCampaignId)} onChange={(event) => void previewLeadCsv(event)} /></label></div> : <p className="cloud-empty">Create a campaign before importing leads.</p>}{csvFilename && <p className="cloud-muted">Selected file: {csvFilename}. {csvRows.length} valid row(s) ready to review.</p>}{csvErrors.length > 0 && <ul className="cloud-warning-list" aria-label="CSV import warnings">{csvErrors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul>}{csvRows.length > 0 && <>{csvDuplicateMatches.length > 0 && <div className="cloud-warning" role="status"><strong>{csvDuplicateMatches.length} possible duplicate row(s) found.</strong> These rows are flagged for review, not silently removed. The server will make the final duplicate decision. {hasMoreLeads ? "Only currently loaded leads were checked; load more leads for a broader preview." : "All currently loaded leads were checked."}</div>}<div className="cloud-table-wrap"><table className="cloud-table"><caption>Preview — no records have been imported yet</caption><thead><tr><th>Business</th><th>Category</th><th>Location</th><th>Email</th><th>Phone</th><th>Duplicate preview</th></tr></thead><tbody>{csvRows.slice(0, 10).map((row, index) => { const duplicate = csvDuplicateMatches.find((match) => match.rowIndex === index); return <tr key={`${row.businessname}-${index}`}><td>{row.businessname}</td><td>{row.category || "—"}</td><td>{row.location || "—"}</td><td>{row.email || "—"}</td><td>{row.phone || "—"}</td><td>{duplicate ? <span className="cloud-suppressed">Possible duplicate: {duplicate.matchedOn} matches {duplicate.duplicateSource === "loaded-lead" ? "loaded lead" : "earlier CSV row"} “{duplicate.duplicateBusinessName}”</span> : "No match found in loaded records"}</td></tr>; })}</tbody></table></div>{csvRows.length > 10 && <p className="cloud-muted">Showing first 10 of {csvRows.length} rows.</p>}<button className="cloud-primary" type="button" disabled={busy || csvImportBusy || !csvCampaignId || !csvIdempotencyKey} onClick={() => void importReviewedCsv()}>{csvImportBusy ? "Importing reviewed rows…" : `Import ${csvRows.length} reviewed row${csvRows.length === 1 ? "" : "s"}`}</button><p className="cloud-footnote">Confirm only if you have permission to store these business details. Importing does not verify consent or authorise outreach.</p></>}</section>
      <section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">REVIEW AND SUPPRESSION</p><h2>Lead directory</h2><p className="cloud-muted">Clearing this internal review gate does not prove consent or establish a lawful basis for outreach. Check permission and applicable rules separately; all outreach remains draft-only.</p></div>{hasMoreLeads && <button className="cloud-secondary" type="button" disabled={loadingMoreLeads} onClick={() => void loadMoreLeads()}>{loadingMoreLeads ? "Loading leads…" : "Load more leads"}</button>}</div><div className="cloud-form cloud-lead-filters"><label>Search leads<input type="search" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Business, category, location, website, email, or phone" /></label><label>Filter by status<select value={leadStatusFilter} onChange={(event) => setLeadStatusFilter(event.target.value)}><option value="all">All statuses</option>{leadStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><label>Filter by campaign<select value={leadCampaignFilter} onChange={(event) => setLeadCampaignFilter(event.target.value)}><option value="all">All campaigns</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></label><label>Filter by source<select aria-label="Filter by source" value={leadSourceFilter} onChange={(event) => setLeadSourceFilter(event.target.value)}><option value="all">All sources</option>{[...new Set(leads.map((lead) => lead.source))].sort((left, right) => left.localeCompare(right, "en-GB")).map((source) => <option key={source} value={source}>{formatLeadSourceLabel(source)}</option>)}</select></label><label>Filter by contact review<select aria-label="Filter by contact review" value={contactReviewFilter} onChange={(event) => setContactReviewFilter(event.target.value)}><option value="all">All reviews</option><option value="pending">Pending review</option><option value="cleared">Review cleared</option><option value="blocked">Blocked / do not contact</option></select></label><label>Filter by completeness<select aria-label="Filter by completeness" value={leadCompletenessFilter} onChange={(event) => setLeadCompletenessFilter(event.target.value as "all" | "low" | "medium" | "high")}><option value="all">All completeness scores</option><option value="low">Low (0–39)</option><option value="medium">Medium (40–69)</option><option value="high">High (70–100)</option></select></label><label>Sort leads by<select aria-label="Sort leads by" value={leadSort} onChange={(event) => setLeadSort(event.target.value as "score" | "newest" | "business")}><option value="score">Completeness score (highest first)</option><option value="newest">Newest first</option><option value="business">Business name (A–Z)</option></select></label><button className="cloud-secondary" type="button" disabled={!leadSearch && leadStatusFilter === "all" && leadCampaignFilter === "all" && leadSourceFilter === "all" && contactReviewFilter === "all" && leadCompletenessFilter === "all" && leadSort === "score"} onClick={() => { setLeadSearch(""); setLeadStatusFilter("all"); setLeadCampaignFilter("all"); setLeadSourceFilter("all"); setContactReviewFilter("all"); setLeadCompletenessFilter("all"); setLeadSort("score"); }}>Clear filters</button><button className="cloud-secondary" type="button" disabled={filteredLeads.length === 0} onClick={exportFilteredLeads}>Export {filteredLeads.length} filtered loaded lead{filteredLeads.length === 1 ? "" : "s"} (CSV)</button>{(selectedOrganisationRole === "owner" || selectedOrganisationRole === "admin") && <><button className="cloud-secondary" type="button" disabled={exportingAllLeads} onClick={() => void exportAllStoredLeads()}>{exportingAllLeads ? "Preparing full export…" : "Export all stored leads (CSV)"}</button><button className="cloud-secondary" type="button" disabled={exportingAllLeads} onClick={() => void exportAllStoredLeads(true)}>{exportingAllLeads ? "Preparing filtered export…" : "Export all matching filtered leads (CSV)"}</button></>}</div><p className="cloud-muted" aria-live="polite">Showing {filteredLeads.length} of {leads.length} loaded leads.</p><div className="cloud-review-queue" aria-label="Contact review queue summary"><p className="cloud-muted">Quick filters below count loaded leads only. Load the server-side inventory for counts across all stored organisation leads.</p><div><button className="cloud-secondary" type="button" disabled={loadingContactReviewQueueSummary} onClick={() => void loadContactReviewQueueSummary()}>{loadingContactReviewQueueSummary ? "Loading server counts…" : contactReviewQueueSummary?.organisationId === organisationId ? "Refresh all-stored counts" : "Load all-stored counts"}</button><button className="cloud-secondary" type="button" aria-pressed={contactReviewFilter === "pending"} onClick={() => setContactReviewFilter(contactReviewFilter === "pending" ? "all" : "pending")}>Pending review ({contactReviewCounts.pending})</button><button className="cloud-secondary" type="button" aria-pressed={contactReviewFilter === "cleared"} onClick={() => setContactReviewFilter(contactReviewFilter === "cleared" ? "all" : "cleared")}>Review cleared ({contactReviewCounts.cleared})</button><button className="cloud-secondary" type="button" aria-pressed={contactReviewFilter === "blocked"} onClick={() => setContactReviewFilter(contactReviewFilter === "blocked" ? "all" : "blocked")}>Blocked / do not contact ({contactReviewCounts.blocked})</button></div>{contactReviewQueueSummary?.organisationId === organisationId && <div className="cloud-analytics-summary" role="status" aria-label="All stored contact-review counts"><strong>All stored leads: {contactReviewQueueSummary.totalLeadCount}</strong><span>Explicitly pending: {contactReviewQueueSummary.pendingCount}</span><span>Review cleared: {contactReviewQueueSummary.clearedCount}</span><span>Blocked / do not contact: {contactReviewQueueSummary.blockedCount}</span><span>Legacy or unclassified: {contactReviewQueueSummary.legacyOrUnclassifiedCount}</span><p className="cloud-muted">{contactReviewQueueSummary.attributionNote}</p></div>}</div><p className="cloud-muted">The filtered export above includes only loaded records. Owners and admins can export every stored lead or export all records matching the current search, status, campaign, contact-review and completeness filters (up to 1,000 records); filtered export applies filters across all pages, not just loaded rows.</p><div className="cloud-table-wrap"><table className="cloud-table"><thead><tr><th>Business</th><th>Completeness</th><th>Status</th><th>Contact restriction</th><th>Actions</th></tr></thead><tbody>{filteredLeads.map((lead) => <tr key={lead.id}><td><strong>{lead.businessName}</strong><small>{lead.category} · {lead.location}</small><small>Source: {formatLeadSourceLabel(lead.source)}</small><label className="cloud-note-label">Internal notes<textarea aria-label={`Notes for ${lead.businessName}`} maxLength={4000} rows={2} value={leadNotes[lead.id] ?? ""} disabled={busy} onChange={(event) => setLeadNotes((current) => ({ ...current, [lead.id]: event.target.value }))} /></label><button className="cloud-link" disabled={busy || (leadNotes[lead.id] ?? "") === (lead.notes ?? "")} onClick={() => void runAction(() => api.updateLeadNotes({ organisationId, leadId: lead.id, notes: leadNotes[lead.id] ?? "" }), "Internal notes saved.")}>Save notes</button></td><td><strong className="cloud-quality-score">{lead.score}/100</strong>{lead.scoreReasons.length > 0 && <small>{lead.scoreReasons.join(" · ")}</small>}<small className="cloud-muted">Completeness heuristic only; not a quality, consent, or contactability guarantee.</small></td><td><select aria-label={`Status for ${lead.businessName}`} value={lead.status} disabled={busy} onChange={(event) => void runAction(() => api.updateLeadStatus({ organisationId, leadId: lead.id, status: event.target.value as ServerLeadStatus }), "Lead status updated.")}>{leadStatuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>{lead.status === "onboarded" && lead.onboardedAt && <small className="cloud-muted">First onboarded: {new Date(lead.onboardedAt).toLocaleDateString("en-GB")}</small>}</td><td>{lead.contactReviewStatus === "pending" ? <span className="cloud-suppressed">PENDING REVIEW</span> : lead.doNotContact ? <span className="cloud-suppressed">DO NOT CONTACT</span> : lead.contactRestrictionVerified ? <span className="cloud-contactable">Contact review cleared</span> : <span className="cloud-suppressed">REVIEW RESTRICTION</span>}<button className="cloud-link" disabled={busy || (getContactRestrictionAction(lead.doNotContact, lead.contactReviewStatus) === "clear" && !canClearContactRestriction)} onClick={() => {
          const action = getContactRestrictionAction(lead.doNotContact, lead.contactReviewStatus);
          void runAction(() => api.setLeadSuppression({ organisationId, leadId: lead.id, doNotContact: action === "suppress", ...(action === "clear" ? { contactReviewRevision: lead.contactReviewRevision } : {}) }), action === "clear" ? "Restriction review/clear requested." : "Lead suppressed.");
        }}>{lead.contactReviewStatus === "pending" || lead.contactReviewStatus === "blocked" ? "Review & clear restriction" : lead.doNotContact ? "Remove restriction" : "Suppress"}</button></td><td><button className="cloud-secondary" type="button" disabled={busy || Boolean(loadingLeadActivityId)} onClick={() => void toggleLeadActivity(lead)}>{loadingLeadActivityId === lead.id ? "Loading history…" : selectedLeadActivityId === lead.id ? "Hide history" : "View history"}</button><button className="cloud-secondary" disabled={busy || lead.doNotContact || !lead.contactRestrictionVerified} onClick={() => void createDraftForLead(lead)}>{draftCreationKeys[lead.id] ? "Retry draft (same request)" : "Create draft"}</button><button className="cloud-secondary" disabled={busy || Boolean(aiDraftBusyLeadId) || Boolean(editingDraftId) || lead.doNotContact || !lead.contactRestrictionVerified} onClick={() => void suggestAiDraftForLead(lead)}>{aiDraftBusyLeadId === lead.id ? "Generating AI draft…" : "AI draft suggestion"}</button></td></tr>)}</tbody></table>{!leads.length ? <p className="cloud-empty">No leads in this organisation yet.</p> : !filteredLeads.length ? <p className="cloud-empty" role="status">No leads match these filters. Try another search or choose All statuses.</p> : null}</div></section>
      {selectedLeadActivityId && leadActivityTimeline?.leadId === selectedLeadActivityId && <section className="cloud-card" aria-labelledby="lead-activity-title">
        <div className="cloud-section-head"><div><p className="cloud-eyebrow">LEAD HISTORY</p><h2 id="lead-activity-title">Activity for {leads.find((lead) => lead.id === selectedLeadActivityId)?.businessName ?? "selected lead"}</h2><p className="cloud-muted">Latest 20 events only. Internal note contents, contact values, and actor account identifiers are not included.</p></div></div>
        {leadActivityTimeline.activities.length ? <ol className="cloud-activity-timeline">{leadActivityTimeline.activities.map((activity) => <li key={activity.id}><span>{activity.message}</span><time>{activity.createdAt ? new Date(activity.createdAt).toLocaleString("en-GB") : "Time unavailable"}</time></li>)}</ol> : <p className="cloud-empty">No activity history is available for this lead.</p>}
        {leadActivityTimeline.hasMoreHistory && <p className="cloud-muted">Additional older events exist but are not shown in this view.</p>}
      </section>}
      {editingDraftId.startsWith("new:") && <section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">AI-ASSISTED DRAFT</p><h2>Review suggested message</h2><p className="cloud-muted">This is unverified AI text. Check every claim and recipient eligibility, then save it as an unsent draft. Business and campaign context is sent to Google Gemini; email, phone and internal notes are excluded.</p></div></div><form className="cloud-form cloud-draft-editor" onSubmit={(event) => void saveDraft(event)}><label>Draft subject<input required maxLength={200} disabled={busy || Boolean(draftCreationKeys[editingDraftId.slice(4)])} value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} /></label><label>Draft body<textarea required maxLength={10000} rows={7} disabled={busy || Boolean(draftCreationKeys[editingDraftId.slice(4)])} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} /></label>{draftCreationKeys[editingDraftId.slice(4)] && <p className="cloud-muted" role="status">A save attempt is pending. Retry with the same text to avoid duplicate drafts.</p>}<div className="cloud-draft-actions"><button className="cloud-primary" disabled={busy || !draftSubject.trim() || !draftBody.trim()}>{draftCreationKeys[editingDraftId.slice(4)] ? "Retry save (same request)" : "Save as draft"}</button><button type="button" className="cloud-secondary" disabled={busy || Boolean(draftCreationKeys[editingDraftId.slice(4)])} onClick={() => { setEditingDraftId(""); setDraftSubject(""); setDraftBody(""); }}>Discard suggestion</button></div></form></section>}<section className="cloud-card"><div className="cloud-section-head"><div><p className="cloud-eyebrow">HUMAN REVIEW REQUIRED</p><h2>Outreach drafts</h2></div><span className="cloud-count">{drafts.length}</span></div>{hasMoreDrafts && <div className="cloud-pagination"><button className="cloud-secondary" type="button" disabled={loadingMoreDrafts} onClick={() => void loadMoreDrafts()}>{loadingMoreDrafts ? "Loading drafts…" : "Load more drafts"}</button></div>}<div className="cloud-list">{drafts.map((draft) => <div className="cloud-draft" key={draft.id}>{editingDraftId === draft.id ? <form className="cloud-form cloud-draft-editor" onSubmit={(event) => void saveDraft(event)}><label>Draft subject<input required maxLength={200} value={draftSubject} onChange={(event) => setDraftSubject(event.target.value)} /></label><label>Draft body<textarea required maxLength={10000} rows={6} value={draftBody} onChange={(event) => setDraftBody(event.target.value)} /></label><div className="cloud-draft-actions"><button className="cloud-primary" disabled={busy || !draftSubject.trim() || !draftBody.trim()}>{busy ? "Saving…" : "Save draft"}</button><button type="button" className="cloud-secondary" disabled={busy} onClick={() => { setEditingDraftId(""); setDraftSubject(""); setDraftBody(""); }}>Cancel</button></div></form> : <><div><strong>{draft.subject}</strong>{draft.requiresReview && <p className="cloud-error" role="alert">{draft.reviewReason ?? "Review required before use."}</p>}<p>{draft.body}</p><small>{statusLabel(draft.status)}{draft.status === "draft" ? " · NOT SENT" : " · REVIEW REQUIRED"}</small></div><div className="cloud-draft-actions"><button className="cloud-secondary" disabled={busy || draft.requiresReview} title={draft.requiresReview ? "Resolve the lead restriction before editing this draft." : undefined} onClick={() => { setEditingDraftId(draft.id); setDraftSubject(draft.subject); setDraftBody(draft.body); }}>Edit</button><button className="cloud-secondary" disabled={busy} onClick={() => void runAction(() => api.deleteOutreachDraft({ organisationId, draftId: draft.id }), "Draft deleted.")}>Delete</button></div></>}</div>)}{!drafts.length && <p className="cloud-empty">No outreach drafts yet.</p>}</div></section></>}
    <footer className="cloud-footer">Dedicated Firebase project required · tenant access enforced by server functions · no automated outreach</footer></main>;
}
