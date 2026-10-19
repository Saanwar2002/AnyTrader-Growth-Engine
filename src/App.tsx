import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createDemoRepository } from "./repository";
import { LEAD_STATUSES, escapeCsvCell, canCreateOutreachDraft, deduplicateLeads, inspectLeadCsvHeaders, parseLeadCsv, scoreLead, suggestLeadCsvMapping, type Activity, type AppState, type Campaign, type CampaignStatus, type Lead, type LeadStatus, type OutreachDraft, type LeadCsvField, type LeadCsvMapping } from "./domain";
import "./styles.css";

type View = "overview" | "campaigns" | "leads" | "review" | "drafts" | "settings";
const repository = createDemoRepository();
const statusLabels: Record<LeadStatus, string> = { new: "New", reviewing: "In review", qualified: "Qualified", contacted: "Contacted", onboarded: "Onboarded", rejected: "Rejected" };
const campaignStatusLabels: Record<CampaignStatus, string> = { draft: "Draft", active: "Active", paused: "Paused", completed: "Completed" };
const navigation: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "campaigns", label: "Campaigns", icon: "▦" },
  { id: "leads", label: "Lead directory", icon: "◎" },
  { id: "review", label: "Review queue", icon: "✓" },
  { id: "drafts", label: "Outreach drafts", icon: "✉" },
  { id: "settings", label: "Workspace settings", icon: "⚙" },
];

interface CsvPending { fileName: string; campaignId: string; csv: string; headers: string[]; }
const csvFields: Array<{ key: LeadCsvField; label: string; required?: boolean }> = [
  { key: "businessName", label: "Business name", required: true },
  { key: "category", label: "Service category" },
  { key: "location", label: "Location" },
  { key: "website", label: "Website" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
];

interface CsvImportPreview {
  fileName: string;
  campaignId: string;
  candidates: Lead[];
  selectedCandidateIds: string[];
  duplicates: number;
  errors: string[];
}
const newId = (prefix: string) => `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function addActivity(state: AppState, leadId: string, message: string): AppState {
  const activity: Activity = { id: newId("activity"), leadId, message, createdAt: new Date().toISOString() };
  return { ...state, activities: [activity, ...state.activities].slice(0, 250) };
}

function makeLead(row: Record<string, string>, campaignId: string, source: Lead["source"]): Lead {
  const businessName = row.businessname || row.business || row.company || row.name || "";
  const category = row.category || row.servicecategory || "Unspecified";
  const location = row.location || row.city || row.area || "";
  const website = row.website || row.url || "";
  const email = row.email || row.emailaddress || "";
  const phone = row.phone || row.telephone || "";
  const scored = scoreLead({ businessName, website, email, phone, location, category });
  return { id: newId("lead"), campaignId, businessName: businessName.trim(), category, location, website, email, phone, source, status: "new", score: scored.score, scoreReasons: scored.reasons, notes: "", doNotContact: true, contactReviewStatus: "pending", createdAt: new Date().toISOString() };
}

export default function App() {
  const [state, setState] = useState<AppState>(() => repository.load());
  const [view, setView] = useState<View>("overview");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | LeadStatus>("all");
  const [contactFilter, setContactFilter] = useState<"all" | "review" | "contactable" | "suppressed">("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignBrand, setCampaignBrand] = useState("AnyTrader");
  const [campaignCategory, setCampaignCategory] = useState("Painters & decorators");
  const [campaignLocation, setCampaignLocation] = useState("Manchester, UK");
  const [campaignGoal, setCampaignGoal] = useState("Recruit reliable providers");
  const [notice, setNotice] = useState("");
  const [editingDraft, setEditingDraft] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<CsvImportPreview | null>(null);
  const [csvPending, setCsvPending] = useState<CsvPending | null>(null);
  const [csvMapping, setCsvMapping] = useState<LeadCsvMapping>({});
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadNotes, setLeadNotes] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { repository.save(state); }, [state]);

  const visibleLeads = useMemo(() => state.leads.filter((lead) => {
    const matchesQuery = [lead.businessName, lead.category, lead.location, lead.email].some((value) => value.toLocaleLowerCase("en-GB").includes(query.toLocaleLowerCase("en-GB")));
    const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
    const matchesCampaign = campaignFilter === "all" || lead.campaignId === campaignFilter;
    const matchesContact = contactFilter === "all" || (contactFilter === "review" ? lead.contactReviewStatus === "pending" || (!lead.doNotContact && !canCreateOutreachDraft(lead)) : contactFilter === "suppressed" ? lead.contactReviewStatus === "blocked" || (lead.doNotContact === true && lead.contactReviewStatus !== "pending") : canCreateOutreachDraft(lead));
    const matchesReview = view !== "review" || ["new", "reviewing"].includes(lead.status);
    return matchesQuery && matchesStatus && matchesCampaign && matchesContact && matchesReview;
  }), [state.leads, query, statusFilter, campaignFilter, contactFilter, view]);

  const reviewCount = state.leads.filter((lead) => lead.status === "new" || lead.status === "reviewing").length;
  const activeCampaigns = state.campaigns.filter((campaign) => campaign.status === "active").length;
  const currentView = navigation.find((item) => item.id === view)?.label ?? "Overview";
  const selectedLead = state.leads.find((lead) => lead.id === selectedLeadId) ?? null;

  function changeLeadStatus(leadId: string, status: LeadStatus) {
    const lead = state.leads.find((item) => item.id === leadId);
    if (!lead) return;
    if (status === "contacted" && !canCreateOutreachDraft(lead)) { setNotice("This lead must pass contact review and have its restriction cleared before it can be marked contacted."); return; }
    const next = { ...state, leads: state.leads.map((item) => item.id === leadId ? { ...item, status } : item) };
    setState(addActivity(next, leadId, `Status changed to ${statusLabels[status]}.`));
    setNotice(`${lead.businessName}: moved to ${statusLabels[status].toLowerCase()}.`);
  }

  function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!campaignName.trim() || !campaignCategory.trim() || !campaignLocation.trim()) return;
    const campaign: Campaign = { id: newId("campaign"), name: campaignName.trim(), brand: campaignBrand, category: campaignCategory.trim(), location: campaignLocation.trim(), goal: campaignGoal.trim(), status: "active", createdAt: new Date().toISOString() };
    setState((previous) => ({ ...previous, campaigns: [campaign, ...previous.campaigns] }));
    setShowCampaignForm(false);
    setCampaignName("");
    setView("campaigns");
    setNotice(`Campaign “${campaign.name}” created in this browser's demo workspace.`);
  }

  function createDraft(lead: Lead) {
    if (!canCreateOutreachDraft(lead)) { setNotice(lead.contactReviewStatus === "pending" ? "Outreach is blocked until contact review is completed." : "Outreach is blocked because this lead is marked Do not contact or its contact review is not cleared."); return; }
    const campaign = state.campaigns.find((item) => item.id === lead.campaignId);
    const brand = campaign?.brand || "our marketplace";
    const draft: OutreachDraft = {
      id: newId("draft"), leadId: lead.id, campaignId: lead.campaignId, status: "draft", createdAt: new Date().toISOString(),
      subject: `An opportunity to grow your ${lead.category.toLocaleLowerCase("en-GB")} business`,
      body: `Hello ${lead.businessName},\n\nI'm reaching out on behalf of ${brand}. We're exploring ways to connect customers with trusted local ${lead.category.toLocaleLowerCase("en-GB")} providers in ${lead.location || "your area"}.\n\nWould you be interested in learning more about joining our provider network? I can share further details if this is relevant to your business.\n\nKind regards,\nThe ${brand} team\n\n[Please review and personalise this draft before use.]`,
    };
    const next = { ...state, drafts: [draft, ...state.drafts] };
    setState(addActivity(next, lead.id, "Outreach draft created for human review; no message was sent."));
    setView("drafts");
    setNotice("Draft created. Nothing has been sent.");
  }

  function saveDraft(draftId: string, field: "subject" | "body", value: string) {
    setState((previous) => ({ ...previous, drafts: previous.drafts.map((draft) => draft.id === draftId ? { ...draft, [field]: value, status: "draft" } : draft) }));
  }

  function handleCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const selectedCampaign = campaignFilter !== "all" ? campaignFilter : state.campaigns[0]?.id;
    if (!selectedCampaign) { setNotice("Create a campaign before importing leads."); event.target.value = ""; return; }
    if (file.size > 2 * 1024 * 1024) { setNotice("CSV is larger than the 2 MB demo import limit."); event.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const csv = String(reader.result ?? "");
      const inspected = inspectLeadCsvHeaders(csv);
      if (inspected.errors.length) { setNotice(inspected.errors.join(" ")); return; }
      const mapping = suggestLeadCsvMapping(inspected.headers);
      setCsvPending({ fileName: file.name, campaignId: selectedCampaign, csv, headers: inspected.headers });
      setCsvMapping(mapping);
      setImportPreview(null);
      setView("leads");
      setNotice("Confirm the column mapping, then preview the rows before importing.");
      event.target.value = "";
    };
    reader.onerror = () => setNotice("Could not read that file. Please try a UTF-8 CSV.");
    reader.readAsText(file);
  }

  function previewMappedCsv() {
    if (!csvPending) return;
    if (!csvMapping.businessName) { setNotice("Choose a column for the required Business name field."); return; }
    const parsed = parseLeadCsv(csvPending.csv, csvMapping);
    if (parsed.errors.length && parsed.rows.length === 0) { setNotice(parsed.errors.join(" ")); return; }
    const parsedCandidates = parsed.rows.map((row) => makeLead(row, csvPending.campaignId, "csv"));
    const deduplicated = deduplicateLeads(parsedCandidates, state.leads);
    const candidates = deduplicated.unique;
    setImportPreview({ fileName: csvPending.fileName, campaignId: csvPending.campaignId, candidates, selectedCandidateIds: candidates.map((lead) => lead.id), duplicates: deduplicated.duplicateCount, errors: parsed.errors });
    setCsvPending(null);
    setNotice("Review the import summary before adding any records.");
  }

  function confirmCsvImport() {
    if (!importPreview) return;
    const { candidates, selectedCandidateIds, duplicates, errors, fileName } = importPreview;
    const selectedCandidates = candidates.filter((lead) => selectedCandidateIds.includes(lead.id));
    const deselected = candidates.length - selectedCandidates.length;
    if (selectedCandidates.length) {
      const next = { ...state, leads: [...selectedCandidates, ...state.leads] };
      setState({ ...next, activities: [{ id: newId("activity"), leadId: selectedCandidates[0].id, message: `CSV import (${fileName}): ${selectedCandidates.length} lead(s) added; ${duplicates} duplicate(s) skipped; ${deselected} row(s) excluded by review.`, createdAt: new Date().toISOString() }, ...next.activities] });
    }
    const errorText = errors.length ? ` ${errors.length} row warning(s).` : "";
    setNotice(`Import complete: ${selectedCandidates.length} added, ${duplicates} duplicates skipped, ${deselected} rows excluded.${errorText} Review all imported records before contact.`);
    setImportPreview(null);
  }

  function setLeadSuppression(leadId: string, doNotContact: boolean) {
    const lead = state.leads.find((item) => item.id === leadId);
    if (!lead) return;
    const next = { ...state, leads: state.leads.map((item) => item.id === leadId ? { ...item, doNotContact, contactReviewStatus: doNotContact ? "blocked" as const : "cleared" as const } : item) };
    setState(addActivity(next, leadId, doNotContact ? "Marked Do not contact; new outreach drafts are blocked." : "Do not contact restriction removed by a workspace user."));
    setNotice(doNotContact ? `${lead.businessName} marked Do not contact. Existing drafts are retained but flagged for review.` : `${lead.businessName} can be considered for outreach again; review permissions and consent before contact.`);
  }

  function saveLeadNotes() {
    if (!selectedLeadId) return;
    const lead = state.leads.find((item) => item.id === selectedLeadId);
    if (!lead) return;
    const next = { ...state, leads: state.leads.map((item) => item.id === selectedLeadId ? { ...item, notes: leadNotes } : item) };
    setState(addActivity(next, selectedLeadId, "Lead notes updated."));
    setNotice("Lead notes saved in this browser's demo workspace.");
  }

  function exportCsv() {
    const header = ["businessName", "category", "location", "website", "email", "phone", "status", "score", "source", "doNotContact"];
    const rows = [header.join(","), ...visibleLeads.map((lead) => [lead.businessName, lead.category, lead.location, lead.website, lead.email, lead.phone, lead.status, lead.score, lead.source, lead.doNotContact ? "yes" : "no"].map(escapeCsvCell).join(","))];
    const blob = new Blob(["\uFEFF", rows.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = "growth-engine-leads-demo.csv"; anchor.click(); URL.revokeObjectURL(url);
    setNotice(`Exported ${visibleLeads.length} visible lead(s).`);
  }

  function resetDemo() {
    const confirmed = window.confirm("Reset this browser's Growth Engine demo data? Campaigns, imported demo leads, drafts and activity history will be reset.");
    if (!confirmed) return;
    setState(repository.reset()); setQuery(""); setStatusFilter("all"); setContactFilter("all"); setCampaignFilter("all"); setView("overview");
    setNotice("Demo workspace reset to the original synthetic records.");
  }

  return <div className="app-frame">
    <aside className="sidebar">
      <a className="brand sidebar-brand" href="#" onClick={(event) => { event.preventDefault(); setView("overview"); }}>
        <span className="mark">G</span><span><strong>Growth Engine</strong><small>Provider acquisition</small></span>
      </a>
      <p className="nav-heading">WORKSPACE</p>
      <nav aria-label="Main navigation">{navigation.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => { setView(item.id); setNotice(""); }}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === "review" && reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><span className="demo-dot" /> Demo workspace <small>Local browser data only</small></div>
    </aside>
    <main className="main-area">
      <header className="main-topbar"><div><p className="eyebrow">ANYTRADER · GROWTH WORKSPACE</p><h2>{currentView}</h2></div><div className="topbar-actions"><span className="badge"><span className="demo-dot" /> DEMO MODE</span><button className="primary-button" onClick={() => { setShowCampaignForm(true); setNotice(""); }}>＋ New campaign</button></div></header>
      <div className="content">
        {notice && <div className="notice-banner" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
        {showCampaignForm && <section className="form-panel"><div className="section-heading"><div><p className="eyebrow">CAMPAIGN SETUP</p><h3>Create a campaign</h3></div><button className="icon-button" onClick={() => setShowCampaignForm(false)} aria-label="Close campaign form">×</button></div>
          <form onSubmit={createCampaign} className="campaign-form">
            <label>Campaign name<input required value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. Leeds roofing provider pilot" /></label>
            <label>Brand<select value={campaignBrand} onChange={(e) => setCampaignBrand(e.target.value)}><option>AnyTrader</option><option>HandyTrader</option><option>My business</option><option>Other brand</option></select></label>
            <label>Service category<input required value={campaignCategory} onChange={(e) => setCampaignCategory(e.target.value)} placeholder="e.g. Roofers" /></label>
            <label>Target location<input required value={campaignLocation} onChange={(e) => setCampaignLocation(e.target.value)} placeholder="e.g. Leeds, UK" /></label>
            <label className="wide-field">Acquisition goal<input value={campaignGoal} onChange={(e) => setCampaignGoal(e.target.value)} placeholder="Recruit reliable providers" /></label>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowCampaignForm(false)}>Cancel</button><button className="primary-button" type="submit">Create campaign</button></div>
          </form>
        </section>}

        {csvPending && <section className="panel-card import-preview-panel">
          <div className="section-heading"><div><p className="eyebrow">CSV COLUMN MAPPING</p><h3>Match your spreadsheet columns</h3><p className="section-description">File: {csvPending.fileName}. We suggest matches automatically; review them before previewing any records.</p></div><button className="icon-button" aria-label="Cancel CSV mapping" onClick={() => { setCsvPending(null); setNotice("CSV import cancelled. No records were added."); }}>×</button></div>
          <div className="mapping-grid">{csvFields.map((field) => <label className="mapping-field" key={field.key}>{field.label}{field.required ? " *" : ""}<select aria-label={field.label} value={csvMapping[field.key] ?? ""} onChange={(event) => setCsvMapping((previous) => ({ ...previous, [field.key]: event.target.value || undefined }))}><option value="">— Not mapped —</option>{csvPending.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>
          <p className="mapping-help">Only map fields that match the data in your file. Business name is required; other fields can be left unmapped.</p>
          <div className="form-actions"><button className="secondary-button" onClick={() => { setCsvPending(null); setNotice("CSV import cancelled. No records were added."); }}>Cancel import</button><button className="primary-button" onClick={previewMappedCsv} disabled={!csvMapping.businessName}>Preview rows</button></div>
        </section>}

        {importPreview && <section className="panel-card import-preview-panel">
          <div className="section-heading"><div><p className="eyebrow">IMPORT REVIEW</p><h3>Review CSV before importing</h3><p className="section-description">File: {importPreview.fileName} · Campaign: {state.campaigns.find((campaign) => campaign.id === importPreview.campaignId)?.name ?? "Campaign unavailable"}</p></div><button className="icon-button" aria-label="Cancel import preview" onClick={() => setImportPreview(null)}>×</button></div>
          <div className="import-summary"><span><strong>{importPreview.selectedCandidateIds.length}</strong><small>Selected to add</small></span><span><strong>{importPreview.candidates.length - importPreview.selectedCandidateIds.length}</strong><small>Excluded by you</small></span><span><strong>{importPreview.duplicates}</strong><small>Duplicates skipped</small></span><span><strong>{importPreview.errors.length}</strong><small>Row warnings</small></span></div>
          {importPreview.errors.length > 0 && <div className="import-warnings"><strong>Warnings</strong><ul>{importPreview.errors.slice(0, 6).map((error, index) => <li key={index}>{error}</li>)}</ul>{importPreview.errors.length > 6 && <small>And {importPreview.errors.length - 6} more warning(s).</small>}</div>}
          {importPreview.candidates.length > 0 ? <div className="table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select all import candidates" checked={importPreview.candidates.length > 0 && importPreview.selectedCandidateIds.length === importPreview.candidates.length} onChange={(event) => setImportPreview({ ...importPreview, selectedCandidateIds: event.target.checked ? importPreview.candidates.map((lead) => lead.id) : [] })} /></th><th>BUSINESS</th><th>CATEGORY</th><th>LOCATION</th><th>CONTACT</th><th>SCORE</th></tr></thead><tbody>{importPreview.candidates.slice(0, 8).map((lead) => <tr key={lead.id}><td><input type="checkbox" aria-label={`Include ${lead.businessName} in import`} checked={importPreview.selectedCandidateIds.includes(lead.id)} onChange={(event) => setImportPreview({ ...importPreview, selectedCandidateIds: event.target.checked ? [...importPreview.selectedCandidateIds, lead.id] : importPreview.selectedCandidateIds.filter((id) => id !== lead.id) })} /></td><td><strong>{lead.businessName}</strong></td><td>{lead.category}</td><td>{lead.location || "—"}</td><td>{lead.email || lead.phone || "—"}</td><td>{lead.score}/100</td></tr>)}</tbody></table>{importPreview.candidates.length > 8 && <div className="table-footer">Showing first 8 of {importPreview.candidates.length} records. Selection applies to all valid candidates, including those not shown in this preview.</div>}</div> : <EmptyState title="No new records to import" detail="All valid rows were duplicates, or the file contained only invalid rows." />}
          <div className="form-actions"><button className="secondary-button" onClick={() => { setImportPreview(null); setNotice("CSV import cancelled. No records were added."); }}>Cancel import</button><button className="primary-button" disabled={importPreview.selectedCandidateIds.length === 0} onClick={confirmCsvImport}>Confirm import ({importPreview.selectedCandidateIds.length})</button></div>
        </section>}

        {view === "overview" && <Overview state={state} activeCampaigns={activeCampaigns} reviewCount={reviewCount} onNavigate={setView} onCreateCampaign={() => setShowCampaignForm(true)} />}
        {view === "campaigns" && <Campaigns campaigns={state.campaigns} leads={state.leads} onCreate={() => setShowCampaignForm(true)} onSelect={(id) => { setCampaignFilter(id); setView("leads"); }} onStatus={(id, status) => setState((previous) => ({ ...previous, campaigns: previous.campaigns.map((item) => item.id === id ? { ...item, status } : item) }))} />}
        {(view === "leads" || view === "review") && <section className="panel-card">
          <div className="section-heading"><div><p className="eyebrow">{view === "review" ? "HUMAN REVIEW REQUIRED" : "LEAD MANAGEMENT"}</p><h3>{view === "review" ? "Leads waiting for review" : "Lead directory"} <span className="muted-count">{visibleLeads.length}</span></h3></div><div className="button-row"><button className="secondary-button" onClick={exportCsv}>Export CSV ↓</button><button className="primary-button" onClick={() => fileInput.current?.click()}>Import CSV ↑</button><input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={handleCsv} /></div></div>
          <div className="filter-bar"><label className="search-box"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search business, category or area…" /></label><select aria-label="Filter by lead status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | LeadStatus)}><option value="all">All statuses</option>{LEAD_STATUSES.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select><select aria-label="Filter by contact permission" value={contactFilter} onChange={(e) => setContactFilter(e.target.value as "all" | "review" | "contactable" | "suppressed")}><option value="all">All contact preferences</option><option value="review">Needs contact review</option><option value="contactable">Review cleared</option><option value="suppressed">Do not contact</option></select><select aria-label="Filter by campaign" onChange={(e) => setCampaignFilter(e.target.value)}><option value="all">All campaigns</option>{state.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></div>
          <div className="table-wrap"><table><thead><tr><th>BUSINESS</th><th>CAMPAIGN / AREA</th><th>SCORE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>{visibleLeads.map((lead) => <tr key={lead.id}><td><div className="business-cell"><span className="business-avatar">{lead.businessName.slice(0, 1).toUpperCase()}</span><span><strong>{lead.businessName} {lead.contactReviewStatus === "pending" ? <span className="suppression-badge">PENDING REVIEW</span> : (lead.doNotContact || lead.contactReviewStatus === "blocked") ? <span className="suppression-badge">DO NOT CONTACT</span> : null}</strong><small>{lead.category} · {lead.source === "demo" ? "Synthetic demo" : "CSV import"}</small></span></div></td><td><strong>{state.campaigns.find((item) => item.id === lead.campaignId)?.name ?? "Campaign unavailable"}</strong><small className="cell-subline">{lead.location || "Location not supplied"}</small></td><td><button className="score-pill" title={lead.scoreReasons.join("\n")}>{lead.score}<small>/100</small></button></td><td><span className={`status-pill status-${lead.status}`}>{statusLabels[lead.status]}</span></td><td><div className="row-actions"><select aria-label={`Change status for ${lead.businessName}`} value={lead.status} onChange={(e) => changeLeadStatus(lead.id, e.target.value as LeadStatus)}>{LEAD_STATUSES.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select><button className="text-button" onClick={() => { setSelectedLeadId(lead.id); setLeadNotes(lead.notes); }}>Details</button><button className="text-button" title={!canCreateOutreachDraft(lead) ? (lead.contactReviewStatus === "pending" ? "Blocked: contact review is pending" : "Blocked: contact restriction is not cleared") : "Create a draft for human review"} onClick={() => createDraft(lead)} disabled={!canCreateOutreachDraft(lead) || state.drafts.some((draft) => draft.leadId === lead.id)}>＋ Draft</button></div></td></tr>)}</tbody></table>{visibleLeads.length === 0 && <EmptyState title="No leads match these filters" detail="Try another search, status or campaign, or import a CSV file." />}</div>
          <div className="table-footer">Demo records only · Scores are transparent completeness indicators, not a judgement of business quality.</div>
          {selectedLead && <section className="lead-detail-panel"><div className="section-heading"><div><p className="eyebrow">LEAD DETAILS</p><h3>{selectedLead.businessName}</h3><p className="section-description">{selectedLead.category} · {selectedLead.location || "Location not supplied"}</p></div><button className="icon-button" aria-label="Close lead details" onClick={() => setSelectedLeadId(null)}>×</button></div>
            <div className="lead-contact-grid"><span><small>Email</small><strong>{selectedLead.email || "Not provided"}</strong></span><span><small>Phone</small><strong>{selectedLead.phone || "Not provided"}</strong></span><span><small>Website</small><strong>{selectedLead.website || "Not provided"}</strong></span><span><small>Source</small><strong>{selectedLead.source === "demo" ? "Synthetic demo" : "CSV import"}</strong></span></div>
            <div className="lead-score-reasons"><strong>Completeness score: {selectedLead.score}/100</strong><ul>{selectedLead.scoreReasons.length ? selectedLead.scoreReasons.map((reason) => <li key={reason}>{reason}</li>) : <li>No completeness points yet.</li>}</ul></div>
            <div className={`suppression-control ${selectedLead.doNotContact ? "is-suppressed" : ""}`}><div><strong>{selectedLead.contactReviewStatus === "pending" ? "Contact review is pending" : (selectedLead.doNotContact || selectedLead.contactReviewStatus === "blocked") ? "Do not contact is enabled" : "Contact review cleared"}</strong><small>{selectedLead.contactReviewStatus === "pending" ? "Review the contact restrictions and applicable marketing rules before clearing this review gate." : (selectedLead.doNotContact || selectedLead.contactReviewStatus === "blocked") ? "New outreach drafts are blocked for this lead." : "This review status alone is not proof of consent or a lawful basis for marketing."}</small></div><button className={selectedLead.doNotContact ? "secondary-button" : "danger-button"} onClick={() => setLeadSuppression(selectedLead.id, !selectedLead.doNotContact)}>{selectedLead.contactReviewStatus === "pending" ? "Review & clear restriction" : selectedLead.doNotContact ? "Remove restriction" : "Mark do not contact"}</button></div>
            <label className="notes-field">Internal notes<textarea rows={4} value={leadNotes} onChange={(event) => setLeadNotes(event.target.value)} placeholder="Add review notes for this demo lead…" /></label>
            <div className="form-actions"><button className="primary-button" onClick={saveLeadNotes}>Save notes</button></div>
          </section>}
        </section>}
        {view === "drafts" && <section className="panel-card"><div className="section-heading"><div><p className="eyebrow">HUMAN APPROVAL REQUIRED</p><h3>Outreach drafts <span className="muted-count">{state.drafts.length}</span></h3><p className="section-description">Drafts are saved locally. This app does not send emails or messages.</p></div></div>{state.drafts.length === 0 ? <EmptyState title="No drafts yet" detail="Create a draft from a lead record when you are ready to review an introduction." actionLabel="Browse leads" onAction={() => setView("leads")} /> : <div className="draft-list">{state.drafts.map((draft) => { const lead = state.leads.find((item) => item.id === draft.leadId); const campaign = state.campaigns.find((item) => item.id === draft.campaignId); return <article className="draft-card" key={draft.id}><div className="draft-card-head"><div><span className="status-pill status-new">DRAFT · NOT SENT</span><h4>{lead?.businessName ?? "Lead record unavailable"} {lead?.contactReviewStatus === "pending" ? <span className="suppression-badge">PENDING REVIEW</span> : lead?.doNotContact ? <span className="suppression-badge">DO NOT CONTACT</span> : null}</h4><p>{campaign?.brand ?? "Brand"} · Created {dateLabel(draft.createdAt)}</p></div><button className="secondary-button" onClick={() => setEditingDraft(editingDraft === draft.id ? null : draft.id)}>{editingDraft === draft.id ? "Close editor" : "Edit draft"}</button></div>{lead?.contactReviewStatus === "pending" && <div className="suppression-warning" role="alert">Contact review is pending. Do not use this saved draft for outreach until an authorised review is completed.</div>}{lead?.doNotContact && lead.contactReviewStatus !== "pending" && <div className="suppression-warning" role="alert">This lead is marked Do not contact. Do not use this saved draft for outreach; delete it if no longer needed.</div>}{editingDraft === draft.id ? <div className="draft-editor"><label>Subject<input value={draft.subject} onChange={(e) => saveDraft(draft.id, "subject", e.target.value)} /></label><label>Message<textarea rows={8} value={draft.body} onChange={(e) => saveDraft(draft.id, "body", e.target.value)} /></label><p>Saving changes keeps this draft in draft status. No send action is available.</p></div> : <><h5>{draft.subject}</h5><p className="draft-body">{draft.body}</p></>}<div className="draft-footer"><span>Review all claims and personalise before use.</span><button className="text-button danger-text" onClick={() => { setState((previous) => ({ ...previous, drafts: previous.drafts.filter((item) => item.id !== draft.id) })); setNotice("Draft deleted."); }}>Delete draft</button></div></article>; })}</div>}</section>}
        {view === "settings" && <Settings state={state} onReset={resetDemo} />}
      </div>
      <footer className="app-footer"><span>AnyTrader Growth Engine</span><span>Standalone demo · No live data sources · No messages sent</span></footer>
    </main>
  </div>;
}

function Overview({ state, activeCampaigns, reviewCount, onNavigate, onCreateCampaign }: { state: AppState; activeCampaigns: number; reviewCount: number; onNavigate: (view: View) => void; onCreateCampaign: () => void }) {
  const qualified = state.leads.filter((lead) => lead.status === "qualified" || lead.status === "onboarded").length;
  return <>
    <section className="welcome-row"><div><p className="eyebrow">YOUR PROVIDER PIPELINE</p><h1>Good work starts with <span>good leads.</span></h1><p>Organise provider acquisition across brands, campaigns and local markets.</p></div><button className="primary-button" onClick={onCreateCampaign}>＋ Create campaign</button></section>
    <div className="demo-callout"><span className="callout-icon">i</span><div><strong>You're exploring with synthetic data</strong><p>These example businesses are fictional. Import your own permitted data using CSV to explore the workflow. Nothing is sent automatically.</p></div></div>
    <section className="metric-grid" aria-label="Workspace metrics"><Metric label="Total leads" value={state.leads.length} hint="In this browser workspace" icon="◎" /><Metric label="Active campaigns" value={activeCampaigns} hint={`${state.campaigns.length} total campaigns`} icon="▦" /><Metric label="Needs review" value={reviewCount} hint="Awaiting a decision" icon="✓" /><Metric label="Qualified providers" value={qualified} hint="Qualified or onboarded" icon="↗" /></section>
    <div className="overview-grid"><section className="panel-card"><div className="section-heading"><div><p className="eyebrow">YOUR WORK</p><h3>Campaigns <span className="muted-count">{state.campaigns.length}</span></h3></div><button className="text-button" onClick={() => onNavigate("campaigns")}>View all →</button></div>{state.campaigns.length ? <div className="campaign-list">{state.campaigns.slice(0, 4).map((campaign) => { const count = state.leads.filter((lead) => lead.campaignId === campaign.id).length; return <button className="campaign-list-item" key={campaign.id} onClick={() => onNavigate("campaigns")}><span className="campaign-icon">▦</span><span className="campaign-list-text"><strong>{campaign.name}</strong><small>{campaign.brand} · {campaign.category} · {campaign.location}</small></span><span className="campaign-lead-count">{count} leads</span><span className={`status-pill status-${campaign.status}`}>{campaignStatusLabels[campaign.status]}</span></button>; })}</div> : <EmptyState title="Create your first campaign" detail="Define the brand, service category and location you want to target." actionLabel="Create campaign" onAction={onCreateCampaign} />}</section>
      <section className="panel-card"><div className="section-heading"><div><p className="eyebrow">NEXT ACTIONS</p><h3>Keep momentum</h3></div></div><div className="action-stack"><button onClick={() => onNavigate("review")}><span className="action-icon">✓</span><span><strong>Review new leads</strong><small>{reviewCount} waiting for review</small></span><b>→</b></button><button onClick={() => onNavigate("leads")}><span className="action-icon">↑</span><span><strong>Import a lead list</strong><small>Bring in a permitted CSV file</small></span><b>→</b></button><button onClick={() => onNavigate("drafts")}><span className="action-icon">✉</span><span><strong>Review outreach drafts</strong><small>{state.drafts.length} saved · none sent</small></span><b>→</b></button></div></section></div>
    <section className="panel-card activity-panel"><div className="section-heading"><div><p className="eyebrow">RECENT CHANGES</p><h3>Activity history</h3></div><span className="subtle-label">Latest 6 events</span></div>{state.activities.length ? <div className="activity-list">{state.activities.slice(0, 6).map((activity) => <div className="activity-item" key={activity.id}><span className="activity-dot" /><span><strong>{state.leads.find((lead) => lead.id === activity.leadId)?.businessName ?? "Workspace event"}</strong><small>{activity.message}</small></span><time>{dateLabel(activity.createdAt)}</time></div>)}</div> : <EmptyState title="No activity yet" detail="Lead status changes and draft creation will appear here." />}</section>
  </>;
}

function Metric({ label, value, hint, icon }: { label: string; value: number; hint: string; icon: string }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon">{icon}</span></div><strong>{value.toLocaleString("en-GB")}</strong><small>{hint}</small></article>;
}

function Campaigns({ campaigns, leads, onCreate, onSelect, onStatus }: { campaigns: Campaign[]; leads: Lead[]; onCreate: () => void; onSelect: (id: string) => void; onStatus: (id: string, status: CampaignStatus) => void }) {
  return <section className="panel-card"><div className="section-heading"><div><p className="eyebrow">CAMPAIGN MANAGEMENT</p><h3>All campaigns <span className="muted-count">{campaigns.length}</span></h3><p className="section-description">Campaigns organise provider research by brand, category and target area.</p></div><button className="primary-button" onClick={onCreate}>＋ New campaign</button></div>{campaigns.length ? <div className="campaign-grid">{campaigns.map((campaign) => { const count = leads.filter((lead) => lead.campaignId === campaign.id).length; const qualified = leads.filter((lead) => lead.campaignId === campaign.id && ["qualified", "onboarded"].includes(lead.status)).length; return <article className="campaign-card" key={campaign.id}><div className="campaign-card-top"><span className="campaign-icon">▦</span><span className={`status-pill status-${campaign.status}`}>{campaignStatusLabels[campaign.status]}</span></div><p className="eyebrow">{campaign.brand}</p><h4>{campaign.name}</h4><p className="campaign-description">{campaign.category} · {campaign.location}</p><div className="campaign-stats"><span><strong>{count}</strong><small>Leads</small></span><span><strong>{qualified}</strong><small>Qualified</small></span><span><strong>{campaign.goal ? "Set" : "—"}</strong><small>Goal</small></span></div><div className="campaign-card-actions"><button className="secondary-button" onClick={() => onSelect(campaign.id)}>View leads →</button><select aria-label={`Status for ${campaign.name}`} value={campaign.status} onChange={(e) => onStatus(campaign.id, e.target.value as CampaignStatus)}>{(["draft", "active", "paused", "completed"] as CampaignStatus[]).map((status) => <option key={status} value={status}>{campaignStatusLabels[status]}</option>)}</select></div></article>; })}</div> : <EmptyState title="No campaigns created yet" detail="Create a campaign to define which providers you want to find." actionLabel="Create campaign" onAction={onCreate} />}</section>;
}

function Settings({ state, onReset }: { state: AppState; onReset: () => void }) {
  return <div className="settings-grid"><section className="panel-card"><p className="eyebrow">WORKSPACE CONFIGURATION</p><h3>Demo workspace settings</h3><div className="settings-row"><span><strong>Data storage</strong><small>Browser localStorage; data stays in this browser profile.</small></span><span className="settings-value">Local demo</span></div><div className="settings-row"><span><strong>Authentication</strong><small>Not configured. This demo must not be used for real customer data.</small></span><span className="settings-value warning-value">Not enabled</span></div><div className="settings-row"><span><strong>Database</strong><small>No cloud database or server API is connected.</small></span><span className="settings-value">Not connected</span></div><div className="settings-row"><span><strong>Lead sources</strong><small>Synthetic examples and manual CSV import only.</small></span><span className="settings-value">Demo / CSV</span></div><div className="settings-row"><span><strong>Outbound messaging</strong><small>Draft creation only; no sending provider is configured.</small></span><span className="settings-value">Disabled</span></div></section><section className="panel-card"><p className="eyebrow">LOCAL DATA MANAGEMENT</p><h3>Reset demo data</h3><p className="section-description">Reset this browser's demo data to the original synthetic examples. This removes campaigns, imported records, drafts and activity history stored under this app's demo key.</p><div className="reset-summary"><span>{state.campaigns.length} campaigns</span><span>{state.leads.length} leads</span><span>{state.drafts.length} drafts</span></div><button className="danger-button" onClick={onReset}>Reset demo workspace</button></section><section className="panel-card security-panel"><p className="eyebrow">BEFORE REAL USE</p><h3>Production readiness checklist</h3><ul className="checklist"><li><span>○</span> Configure dedicated Firebase project and authentication</li><li><span>○</span> Implement server-verified organisation membership and roles</li><li><span>○</span> Add deny-by-default database rules and tenant-isolation tests</li><li><span>○</span> Review data-source permissions, retention and opt-out handling</li><li><span>○</span> Add server-side audit, quotas, and approved integrations</li></ul></section></div>;
}

function EmptyState({ title, detail, actionLabel, onAction }: { title: string; detail: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="empty-state"><span className="empty-icon">◎</span><h4>{title}</h4><p>{detail}</p>{actionLabel && onAction && <button className="secondary-button" onClick={onAction}>{actionLabel}</button>}</div>;
}
