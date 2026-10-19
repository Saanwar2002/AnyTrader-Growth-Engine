import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { initialDemoState } from "./demoData";
import { CAMPAIGN_STATUSES, LEAD_STATUSES, createId, csvCell, formatStatus, type AppState, type Campaign, type CampaignStatus, type Lead, type LeadStatus, type NavItem } from "./domain";
import { addCsvLeads, loadState, makeCampaign, saveState, updateLeadStatus } from "./repository";

const navigation: { label: NavItem; icon: string }[] = [
  { label: "Overview", icon: "⌂" },
  { label: "Campaigns", icon: "◫" },
  { label: "Leads", icon: "◎" },
  { label: "Review queue", icon: "☷" },
  { label: "Outreach drafts", icon: "✉" },
  { label: "Activity", icon: "↻" },
  { label: "Settings", icon: "⚙" },
];

const moneySafeDate = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
const relativeDate = (value: string) => {
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return days + " days ago";
};

function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [activeNav, setActiveNav] = useState<NavItem>("Overview");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [draftLeadId, setDraftLeadId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { saveState(state); }, [state]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeCampaigns = state.campaigns.filter((campaign) => campaign.status === "active").length;
  const reviewCount = state.leads.filter((lead) => lead.status === "review" || lead.status === "new").length;
  const selectedLead = state.leads.find((lead) => lead.id === selectedLeadId) ?? null;
  const visibleLeads = useMemo(() => state.leads.filter((lead) => {
    const matchesQuery = [lead.businessName, lead.category, lead.city, lead.email].some((field) => field.toLowerCase().includes(query.toLowerCase()));
    const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
    const matchesCampaign = campaignFilter === "all" || lead.campaignId === campaignFilter;
    const inView = activeNav !== "Review queue" || lead.status === "new" || lead.status === "review";
    return matchesQuery && matchesStatus && matchesCampaign && inView;
  }), [state.leads, query, statusFilter, campaignFilter, activeNav]);

  function notify(message: string) { setToast(message); }
  function patchState(updater: (current: AppState) => AppState) { setState((current) => updater(current)); }

  function handleCampaignCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const campaign = makeCampaign({
      name: String(form.get("name") || "").trim(),
      brand: String(form.get("brand") || "AnyTrader"),
      category: String(form.get("category") || "").trim(),
      geography: String(form.get("geography") || "").trim(),
      goal: String(form.get("goal") || "").trim(),
      status: "active",
    });
    if (!campaign.name || !campaign.category || !campaign.geography) return;
    patchState((current) => ({
      ...current,
      campaigns: [campaign, ...current.campaigns],
      activities: [{ id: createId("activity"), kind: "campaign", description: "Created campaign " + campaign.name, campaignId: campaign.id, createdAt: new Date().toISOString() }, ...current.activities],
    }));
    setShowCampaignForm(false);
    setActiveNav("Campaigns");
    notify("Campaign created in this demo workspace.");
  }

  async function handleImportFile(file?: File) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify("CSV is too large. Maximum size is 2 MB."); return; }
    const text = await file.text();
    const targetCampaign = state.campaigns.find((campaign) => campaign.id === campaignFilter) ?? state.campaigns[0];
    if (!targetCampaign) { notify("Create a campaign before importing leads."); return; }
    const result = addCsvLeads(text, targetCampaign.id, state.leads);
    if (result.errors.length && result.leads.length === 0) { notify(result.errors[0]); return; }
    if (!result.leads.length) { notify("No new rows imported. " + result.skipped + " rows skipped."); return; }
    patchState((current) => ({
      ...current,
      leads: [...result.leads, ...current.leads],
      activities: [{ id: createId("activity"), kind: "import", description: "Imported " + result.leads.length + " CSV leads; skipped " + result.skipped + " rows", campaignId: targetCampaign.id, createdAt: new Date().toISOString() }, ...current.activities],
    }));
    setShowImport(false);
    setActiveNav("Leads");
    notify("Imported " + result.leads.length + " leads. Review records before use.");
  }

  function changeLeadStatus(lead: Lead, status: LeadStatus) {
    patchState((current) => updateLeadStatus(current, lead.id, status));
    notify("Lead status updated.");
  }

  function createDraft(lead: Lead, channel: "email" | "linkedin" = "email") {
    const campaign = state.campaigns.find((item) => item.id === lead.campaignId);
    const brand = campaign?.brand || "our platform";
    const draft = {
      id: createId("draft"), leadId: lead.id, campaignId: lead.campaignId, channel,
      subject: channel === "email" ? "An invitation to join " + brand : "Connect with " + brand,
      body: "Hello " + lead.businessName + " team,\n\nI’m reaching out from " + brand + ". We’re building our network of service providers in " + (lead.city || campaign?.geography || "your area") + " and would welcome the chance to tell you how the platform works.\n\nIf you’re interested, we can share more information so you can decide whether it may suit your business.\n\nKind regards,\nThe " + brand + " team\n\n[Draft only — verify details and permissions before use. No message has been sent.]",
      status: "draft" as const, createdAt: new Date().toISOString(),
    };
    patchState((current) => ({
      ...current,
      drafts: [draft, ...current.drafts],
      activities: [{ id: createId("activity"), kind: "draft", description: "Created a draft for " + lead.businessName + "; no message sent", leadId: lead.id, campaignId: lead.campaignId, createdAt: new Date().toISOString() }, ...current.activities],
    }));
    setDraftLeadId(null);
    setActiveNav("Outreach drafts");
    notify("Draft created for human review. Nothing was sent.");
  }

  function updateCampaignStatus(campaign: Campaign, status: CampaignStatus) {
    patchState((current) => ({
      ...current,
      campaigns: current.campaigns.map((item) => item.id === campaign.id ? { ...item, status } : item),
      activities: [{ id: createId("activity"), kind: "campaign", description: "Changed campaign " + campaign.name + " to " + status, campaignId: campaign.id, createdAt: new Date().toISOString() }, ...current.activities],
    }));
    notify("Campaign status updated.");
  }

  function exportLeads() {
    const headers = ["Business Name", "Category", "City", "Region", "Website", "Email", "Phone", "Source", "Score", "Status", "Campaign"];
    const rows = visibleLeads.map((lead) => [lead.businessName, lead.category, lead.city, lead.region, lead.website, lead.email, lead.phone, lead.source, String(lead.score), lead.status, state.campaigns.find((campaign) => campaign.id === lead.campaignId)?.name ?? "" ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url; link.download = "growth-engine-leads-demo.csv"; link.click(); URL.revokeObjectURL(url);
    notify("Export prepared for the currently visible leads.");
  }

  function resetDemo() {
    setState(structuredClone(initialDemoState));
    setActiveNav("Overview"); setQuery(""); setStatusFilter("all"); setCampaignFilter("all");
    notify("Demo data reset to the original fictional records.");
  }

  const heading = activeNav === "Overview" ? "Workspace overview" : activeNav;
  const description: Record<NavItem, string> = {
    Overview: "A clear view of your provider acquisition pipeline.",
    Campaigns: "Create and manage provider recruitment campaigns.",
    Leads: "Search, qualify, and manage your provider prospects.",
    "Review queue": "Check new and unreviewed records before taking action.",
    "Outreach drafts": "Prepare thoughtful outreach. Sending is disabled in demo mode.",
    Activity: "A trace of the changes made in this demo workspace.",
    Settings: "Demo workspace preferences and product guardrails.",
  };

  return <div className="app-shell">
    <aside className={"sidebar " + (mobileNavOpen ? "sidebar-open" : "")}>
      <div className="sidebar-brand"><span className="brand-mark">G</span><span><strong>Growth Engine</strong><small>Provider acquisition</small></span></div>
      <div className="workspace-switcher"><span className="workspace-avatar">A</span><span><b>AnyTrader workspace</b><small>Demo organisation</small></span><span className="chevron">⌄</span></div>
      <p className="nav-caption">WORKSPACE</p>
      <nav aria-label="Main navigation">{navigation.map((item) => <button key={item.label} className={"nav-item " + (activeNav === item.label ? "nav-active" : "")} onClick={() => { setActiveNav(item.label); setMobileNavOpen(false); setSelectedLeadId(null); }}><span className="nav-icon">{item.icon}</span>{item.label}{item.label === "Review queue" && reviewCount > 0 && <span className="nav-count">{reviewCount}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="safe-card"><span className="safe-dot" /><div><strong>Demo mode is on</strong><p>Fictional data only. No messages sent.</p></div></div><div className="user-row"><span className="user-avatar">D</span><span><b>Demo user</b><small>Local workspace</small></span><span className="more-icon">•••</span></div></div>
    </aside>

    <main className="main-area">
      <header className="app-topbar"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen((open) => !open)}>☰</button><div className="breadcrumb">Workspace <span>/</span> <b>{activeNav}</b></div><div className="topbar-actions"><span className="demo-pill"><i /> DEMO ENVIRONMENT</span><button className="icon-button" title="Notifications" aria-label="Notifications" onClick={() => notify("No new notifications in this demo.")}>♧</button><span className="top-avatar">D</span></div></header>
      <div className="page-content">
        <div className="page-heading"><div><p className="eyebrow">ANYTRADER GROWTH ENGINE</p><h1>{heading}</h1><p className="page-subtitle">{description[activeNav]}</p></div><div className="heading-actions">{(activeNav === "Overview" || activeNav === "Campaigns") && <button className="button-primary" onClick={() => setShowCampaignForm(true)}>＋ New campaign</button>}{(activeNav === "Leads" || activeNav === "Review queue") && <><button className="button-secondary" onClick={() => setShowImport(true)}>↑ Import CSV</button><button className="button-primary" onClick={exportLeads}>↓ Export</button></>}</div></div>
        <div className="demo-banner"><span className="banner-icon">i</span><p><strong>Safe demo workspace</strong> All leads shown are fictional examples. Imports are labelled as demo data. No external lead source is connected and outreach is never sent.</p><button onClick={() => setActiveNav("Settings")}>View safeguards <span>→</span></button></div>

        {activeNav === "Overview" && <Overview state={state} activeCampaigns={activeCampaigns} reviewCount={reviewCount} onNavigate={setActiveNav} onSelectLead={setSelectedLeadId} onNewCampaign={() => setShowCampaignForm(true)} />}
        {activeNav === "Campaigns" && <CampaignsView campaigns={state.campaigns} leads={state.leads} onStatus={updateCampaignStatus} onNew={() => setShowCampaignForm(true)} />}
        {(activeNav === "Leads" || activeNav === "Review queue") && <LeadsView leads={visibleLeads} allLeads={state.leads} campaigns={state.campaigns} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} campaignFilter={campaignFilter} setCampaignFilter={setCampaignFilter} onSelect={setSelectedLeadId} onStatus={changeLeadStatus} onDraft={setDraftLeadId} onImport={() => setShowImport(true)} />}
        {activeNav === "Outreach drafts" && <DraftsView state={state} onStatus={(id, status) => patchState((current) => ({ ...current, drafts: current.drafts.map((draft) => draft.id === id ? { ...draft, status } : draft) }))} onOpenLead={setSelectedLeadId} />}
        {activeNav === "Activity" && <ActivityView activities={state.activities} />}
        {activeNav === "Settings" && <SettingsView onReset={resetDemo} state={state} />}

        <footer className="app-footer"><span>© 2026 AnyTrader Growth Engine</span><span><i className="footer-dot" /> Demo workspace · Changes stored in this browser</span></footer>
      </div>
    </main>

    {showCampaignForm && <Modal title="Create campaign" subtitle="Set up a provider acquisition campaign." onClose={() => setShowCampaignForm(false)}><form className="form-grid" onSubmit={handleCampaignCreate}><label>Campaign name<input name="name" required placeholder="e.g. North West roofers" /></label><label>Brand<select name="brand" defaultValue="AnyTrader"><option>AnyTrader</option><option>HandyTrader</option><option>My business</option><option>Other brand</option></select></label><label>Service category<input name="category" required placeholder="e.g. Roofers" /></label><label>Target geography<input name="geography" required placeholder="e.g. Leeds, West Yorkshire" /></label><label className="field-wide">Acquisition goal<textarea name="goal" rows={3} placeholder="What kind of providers are you hoping to recruit?" /></label><div className="modal-actions"><button type="button" className="button-secondary" onClick={() => setShowCampaignForm(false)}>Cancel</button><button className="button-primary" type="submit">Create campaign</button></div></form></Modal>}
    {showImport && <Modal title="Import leads from CSV" subtitle="Import a file you are authorised to use. Imported rows remain demo-only in this local prototype." onClose={() => setShowImport(false)}><div className="import-help"><strong>Required column</strong><p>Business Name (or Company/Name). Optional: Category, City, Region, Website, Email, Phone, Notes.</p><p>Maximum file size: 2 MB. Existing business + city combinations are skipped.</p><div className="sample-csv">Business Name,Category,City,Website,Email<br/>Example Decorators,Painters,Manchester,https://example.com,hello@example.com</div></div><label className="file-drop"><span>↑</span><strong>Choose a CSV file</strong><small>CSV format · up to 2 MB</small><input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={(event) => void handleImportFile(event.target.files?.[0])} /></label><div className="modal-actions"><button className="button-secondary" onClick={() => setShowImport(false)}>Close</button></div></Modal>}
    {selectedLead && <LeadDrawer lead={selectedLead} campaign={state.campaigns.find((item) => item.id === selectedLead.campaignId)} onClose={() => setSelectedLeadId(null)} onStatus={(status) => changeLeadStatus(selectedLead, status)} onDraft={() => createDraft(selectedLead)} />}
    {draftLeadId && state.leads.find((lead) => lead.id === draftLeadId) && <Modal title="Create outreach draft" subtitle="This creates editable draft text only. It will not send a message." onClose={() => setDraftLeadId(null)}><div className="draft-confirm"><span className="draft-large-icon">✉</span><div><strong>{state.leads.find((lead) => lead.id === draftLeadId)?.businessName}</strong><p>Generate a brand-aware email draft for human review. Check the source, lawful basis, recipient details, and message before any use.</p></div></div><div className="modal-actions"><button className="button-secondary" onClick={() => setDraftLeadId(null)}>Cancel</button><button className="button-primary" onClick={() => { const lead = state.leads.find((item) => item.id === draftLeadId); if (lead) createDraft(lead); }}>Generate draft</button></div></Modal>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}

function Overview({ state, activeCampaigns, reviewCount, onNavigate, onSelectLead, onNewCampaign }: { state: AppState; activeCampaigns: number; reviewCount: number; onNavigate: (nav: NavItem) => void; onSelectLead: (id: string) => void; onNewCampaign: () => void }) {
  const qualified = state.leads.filter((lead) => lead.status === "qualified" || lead.status === "onboarded").length;
  const onboarded = state.leads.filter((lead) => lead.status === "onboarded").length;
  const maxCount = Math.max(1, state.leads.length);
  const recentLeads = [...state.leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  return <div className="content-stack">
    <section className="metric-grid">
      <Metric title="Total leads" value={state.leads.length} change="Fictional + imported demo rows" icon="◎" tone="blue" />
      <Metric title="Active campaigns" value={activeCampaigns} change={state.campaigns.length + " campaigns in workspace"} icon="◫" tone="purple" />
      <Metric title="Needs review" value={reviewCount} change="New or awaiting review" icon="☷" tone="amber" />
      <Metric title="Onboarded" value={onboarded} change="Demo conversions only" icon="↗" tone="green" />
    </section>
    <section className="overview-grid">
      <article className="surface pipeline-panel"><div className="section-heading"><div><h2>Lead pipeline</h2><p>Current status across all campaigns</p></div><button className="text-button" onClick={() => onNavigate("Leads")}>View leads →</button></div><div className="pipeline-total"><strong>{state.leads.length}</strong><span>total records</span></div><div className="pipeline-bars">{LEAD_STATUSES.map((status) => { const count = state.leads.filter((lead) => lead.status === status).length; return <div className="pipeline-row" key={status}><span>{formatStatus(status)}</span><div className="bar-track"><div className={"bar-fill status-fill-" + status} style={{ width: (count / maxCount * 100) + "%" }} /></div><b>{count}</b></div>; })}</div><div className="pipeline-foot"><span><i className="legend-dot" />Demo records only</span><span>{qualified} qualified / onboarded</span></div></article>
      <article className="surface campaign-summary"><div className="section-heading"><div><h2>Campaigns</h2><p>Monitor recruitment activity</p></div><button className="text-button" onClick={() => onNavigate("Campaigns")}>See all →</button></div>{state.campaigns.slice(0, 3).map((campaign) => { const count = state.leads.filter((lead) => lead.campaignId === campaign.id).length; return <div className="campaign-mini" key={campaign.id}><span className="campaign-icon">◫</span><div className="campaign-mini-main"><strong>{campaign.name}</strong><small>{campaign.category} · {campaign.geography}</small><div className="mini-progress"><span style={{ width: (count ? Math.min(100, count * 5) : 0) + "%" }} /></div></div><span className={"status-chip campaign-" + campaign.status}>{formatStatus(campaign.status)}</span></div>; })}{state.campaigns.length === 0 && <EmptyState title="No campaigns yet" text="Create your first campaign to organise your provider search." action="Create campaign" onAction={onNewCampaign} />}</article>
    </section>
    <section className="surface table-surface"><div className="section-heading"><div><h2>Recently added leads</h2><p>Review new prospects and keep your pipeline moving.</p></div><button className="text-button" onClick={() => onNavigate("Leads")}>All leads →</button></div><LeadTable leads={recentLeads} onSelect={onSelectLead} /></section>
    <section className="bottom-grid"><article className="surface getting-started"><div className="section-heading"><div><h2>Next steps</h2><p>Build a repeatable acquisition workflow</p></div></div><div className="check-row"><span className="check-complete">✓</span><div><strong>Explore your demo data</strong><p>Use fictional examples to learn the workflow.</p></div><span className="step-label">Ready</span></div><div className="check-row"><span className="check-complete">✓</span><div><strong>Create a campaign</strong><p>Set a service category and target area.</p></div><button className="text-button" onClick={onNewCampaign}>Start →</button></div><div className="check-row"><span className="check-pending">3</span><div><strong>Import a permitted lead list</strong><p>Preview and validate your own authorised CSV.</p></div><button className="text-button" onClick={() => onNavigate("Leads")}>Open leads →</button></div></article><article className="surface guardrails"><div className="guardrail-heading"><span>✓</span><div><h2>Built-in guardrails</h2><p>Safety is part of the workflow</p></div></div>{["Human review before outreach","Source provenance kept with leads","Suppressed records excluded from draft flow","No live provider integrations configured"].map((text) => <div className="guardrail-line" key={text}><span>✓</span>{text}</div>)}<button className="button-secondary full-width" onClick={() => onNavigate("Settings")}>Review workspace settings</button></article></section>
  </div>;
}

function Metric({ title, value, change, icon, tone }: { title: string; value: number; change: string; icon: string; tone: string }) {
  return <article className="surface metric-card"><div className={"metric-icon tone-" + tone}>{icon}</div><div className="metric-title">{title}</div><strong className="metric-value">{value}</strong><div className="metric-change">{change}</div></article>;
}

function CampaignsView({ campaigns, leads, onStatus, onNew }: { campaigns: Campaign[]; leads: Lead[]; onStatus: (campaign: Campaign, status: CampaignStatus) => void; onNew: () => void }) {
  if (!campaigns.length) return <EmptyState title="No campaigns yet" text="Create a campaign to group leads by brand, service, and geography." action="Create campaign" onAction={onNew} />;
  return <div className="campaign-card-grid">{campaigns.map((campaign) => { const campaignLeads = leads.filter((lead) => lead.campaignId === campaign.id); const qualified = campaignLeads.filter((lead) => lead.status === "qualified" || lead.status === "onboarded").length; return <article className="surface campaign-card" key={campaign.id}><div className="campaign-card-top"><span className="campaign-icon large">◫</span><span className={"status-chip campaign-" + campaign.status}>{formatStatus(campaign.status)}</span></div><h2>{campaign.name}</h2><p className="campaign-meta">{campaign.brand} · Created {moneySafeDate(campaign.createdAt)}</p><div className="campaign-tags"><span>{campaign.category}</span><span>⌖ {campaign.geography}</span></div><p className="campaign-goal">{campaign.goal || "No acquisition goal specified yet."}</p><div className="campaign-stats"><div><strong>{campaignLeads.length}</strong><small>Leads</small></div><div><strong>{qualified}</strong><small>Qualified</small></div><div><strong>{campaignLeads.filter((lead) => lead.status === "onboarded").length}</strong><small>Onboarded</small></div></div><div className="campaign-card-actions"><label className="status-select-label">Campaign status<select aria-label={"Status for " + campaign.name} value={campaign.status} onChange={(event) => onStatus(campaign, event.target.value as CampaignStatus)}>{CAMPAIGN_STATUSES.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}</select></label><span className="tiny-note">Local demo only</span></div></article>; })}</div>;
}

function LeadsView({ leads, allLeads, campaigns, query, setQuery, statusFilter, setStatusFilter, campaignFilter, setCampaignFilter, onSelect, onStatus, onDraft, onImport }: { leads: Lead[]; allLeads: Lead[]; campaigns: Campaign[]; query: string; setQuery: (value: string) => void; statusFilter: string; setStatusFilter: (value: string) => void; campaignFilter: string; setCampaignFilter: (value: string) => void; onSelect: (id: string) => void; onStatus: (lead: Lead, status: LeadStatus) => void; onDraft: (id: string) => void; onImport: () => void }) {
  return <div className="surface table-surface lead-list-surface"><div className="list-toolbar"><div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search business, category, city…" aria-label="Search leads" /><kbd>⌘ K</kbd></div><select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{LEAD_STATUSES.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}</select><select aria-label="Filter by campaign" value={campaignFilter} onChange={(event) => setCampaignFilter(event.target.value)}><option value="all">All campaigns</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select><button className="button-secondary" onClick={onImport}>↑ CSV</button></div><div className="list-result-line"><span><strong>{leads.length}</strong> of {allLeads.length} records</span><span>All sample records are fictional</span></div>{leads.length ? <LeadTable leads={leads} onSelect={onSelect} onStatus={onStatus} onDraft={onDraft} /> : <EmptyState title="No matching leads" text="Try a different search or remove one of the filters." action="Clear filters" onAction={() => { setQuery(""); setStatusFilter("all"); setCampaignFilter("all"); }} />}</div>;
}

function LeadTable({ leads, onSelect, onStatus, onDraft }: { leads: Lead[]; onSelect: (id: string) => void; onStatus?: (lead: Lead, status: LeadStatus) => void; onDraft?: (id: string) => void }) {
  return <div className="table-wrap"><table className="leads-table"><thead><tr><th>Business</th><th>Category / location</th><th>Lead score</th><th>Status</th><th>Source</th><th aria-label="Actions" /></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><button className="business-cell" onClick={() => onSelect(lead.id)}><span className="business-avatar">{lead.businessName.replace("Fictional ", "").slice(0, 1).toUpperCase()}</span><span><strong>{lead.businessName}</strong><small>{lead.email || "No email provided"}</small></span></button></td><td><span className="category-cell">{lead.category}</span><small className="location-cell">⌖ {lead.city || lead.region || "Location not set"}</small></td><td><div className="score-cell"><span className={"score-ring score-" + (lead.score >= 75 ? "high" : lead.score >= 55 ? "medium" : "low")}>{lead.score}</span><span><strong>{lead.score >= 75 ? "Strong" : lead.score >= 55 ? "Good" : "Early"}</strong><small>of 100</small></span></div></td><td>{onStatus ? <select className={"table-status status-" + lead.status} aria-label={"Change status for " + lead.businessName} value={lead.status} onChange={(event) => onStatus(lead, event.target.value as LeadStatus)}>{LEAD_STATUSES.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}</select> : <span className={"status-chip status-" + lead.status}>{formatStatus(lead.status)}</span>}</td><td><span className="source-label"><i />{lead.source}</span></td><td><div className="row-actions"><button title="View lead" aria-label={"View " + lead.businessName} onClick={() => onSelect(lead.id)}>↗</button>{onDraft && lead.status !== "suppressed" && <button title="Prepare outreach draft" aria-label={"Draft outreach for " + lead.businessName} onClick={() => onDraft(lead.id)}>✉</button>}</div></td></tr>)}</tbody></table></div>;
}

function DraftsView({ state, onStatus, onOpenLead }: { state: AppState; onStatus: (id: string, status: "draft" | "approved" | "archived") => void; onOpenLead: (id: string) => void }) {
  if (!state.drafts.length) return <EmptyState title="No outreach drafts yet" text="Open a lead and create a draft. Messages are never sent from this prototype." action="Browse leads" onAction={() => { /* navigation is intentionally handled by the parent view action below */ window.dispatchEvent(new CustomEvent("growth-engine:navigate", { detail: "Leads" })); }} />;
  return <div className="draft-grid">{state.drafts.map((draft) => { const lead = state.leads.find((item) => item.id === draft.leadId); const campaign = state.campaigns.find((item) => item.id === draft.campaignId); return <article className="surface draft-card" key={draft.id}><div className="draft-card-head"><span className="draft-type-icon">✉</span><span className={"status-chip draft-" + draft.status}>{formatStatus(draft.status)}</span></div><p className="draft-label">{draft.channel === "email" ? "EMAIL DRAFT" : "LINKEDIN DRAFT"} · {relativeDate(draft.createdAt)}</p><h2>{draft.subject}</h2><p className="draft-recipient">To: {lead?.businessName ?? "Unknown lead"} <span>·</span> {campaign?.brand ?? "Brand"}</p><div className="draft-preview">{draft.body}</div><div className="draft-safety-note">ⓘ Draft only. Approval here records a review decision; it does not send anything.</div><div className="draft-actions">{lead && <button className="button-secondary" onClick={() => onOpenLead(lead.id)}>View lead</button>}{draft.status === "draft" && <button className="button-primary" onClick={() => onStatus(draft.id, "approved")}>Mark reviewed</button>}{draft.status !== "archived" && <button className="text-button danger-text" onClick={() => onStatus(draft.id, "archived")}>Archive</button>}{draft.status === "archived" && <button className="text-button" onClick={() => onStatus(draft.id, "draft")}>Restore draft</button>}</div></article>; })}</div>;
}

function ActivityView({ activities }: { activities: AppState["activities"] }) {
  return <div className="surface activity-surface"><div className="section-heading"><div><h2>Workspace activity</h2><p>Local demo history. This is not a production audit log.</p></div><span className="status-chip status-review">{activities.length} events</span></div>{activities.length ? <div className="timeline">{activities.map((event) => <div className="timeline-event" key={event.id}><span className={"timeline-icon timeline-" + event.kind}>{event.kind === "campaign" ? "◫" : event.kind === "draft" ? "✉" : event.kind === "import" ? "↑" : "↻"}</span><div><strong>{event.description}</strong><small>{moneySafeDate(event.createdAt)} · {new Date(event.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</small></div></div>)}</div> : <EmptyState title="No activity yet" text="Campaign, import, and lead status changes will appear here." />}</div>;
}

function SettingsView({ onReset, state }: { onReset: () => void; state: AppState }) {
  const settings = [
    ["Data mode", "Synthetic demo + local CSV import", "No external provider is connected."],
    ["Persistence", "Browser local storage", "Data stays in this browser profile; it is not synced to a server."],
    ["Authentication", "Not configured", "Do not use this prototype to store confidential customer data."],
    ["Tenant isolation", "Not implemented in the demo", "Server-side membership checks and security rules are required before multi-user use."],
    ["Outreach", "Draft-only", "Marking a draft reviewed does not send any message."],
    ["Integrations", "None connected", "Live APIs, AI calls, billing, and AnyTrader production services are not enabled."],
  ];
  return <div className="settings-layout"><div className="settings-main surface"><div className="section-heading"><div><h2>Workspace configuration</h2><p>Current prototype capabilities and boundaries.</p></div><span className="status-chip status-review">Development</span></div>{settings.map(([title, value, note]) => <div className="setting-row" key={title}><div><strong>{title}</strong><p>{note}</p></div><span>{value}</span></div>)}</div><aside className="surface reset-card"><span className="reset-icon">↻</span><h2>Reset demo workspace</h2><p>Restore the original fictional campaigns, leads, drafts, and activity. This will discard changes stored in this browser.</p><button className="button-danger" onClick={onReset}>Reset demo data</button><hr/><h3>Prototype coverage</h3><div className="coverage-row"><span>Campaign management</span><b>Demo ready</b></div><div className="coverage-row"><span>Lead workflow</span><b>Demo ready</b></div><div className="coverage-row"><span>Secure authentication</span><b className="not-ready">Not built</b></div><div className="coverage-row"><span>Live data sources</span><b className="not-ready">Not connected</b></div></aside></div>;
}

function LeadDrawer({ lead, campaign, onClose, onStatus, onDraft }: { lead: Lead; campaign?: Campaign; onClose: () => void; onStatus: (status: LeadStatus) => void; onDraft: () => void }) {
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="lead-drawer" role="dialog" aria-modal="true" aria-labelledby="lead-drawer-title"><div className="drawer-top"><span className="eyebrow">LEAD PROFILE</span><button className="close-button" aria-label="Close lead profile" onClick={onClose}>×</button></div><div className="drawer-profile"><span className="business-avatar large-avatar">{lead.businessName.replace("Fictional ", "").slice(0, 1).toUpperCase()}</span><h2 id="lead-drawer-title">{lead.businessName}</h2><p>{lead.category} · {lead.city || "Location not set"}</p><span className="fictional-label">FICTIONAL DEMO RECORD</span></div><div className="drawer-score"><div><small>LEAD SCORE</small><strong>{lead.score}<span>/100</span></strong></div><div className="score-explanation">{lead.scoreReason.map((reason) => <span key={reason}>✓ {reason}</span>)}</div></div><div className="drawer-section"><h3>Contact information</h3><InfoRow label="Email" value={lead.email || "Not provided"} /><InfoRow label="Phone" value={lead.phone || "Not provided"} /><InfoRow label="Website" value={lead.website || "Not provided"} /><InfoRow label="Location" value={[lead.city, lead.region].filter(Boolean).join(", ") || "Not provided"} /></div><div className="drawer-section"><h3>Source & campaign</h3><InfoRow label="Source" value={lead.source} /><InfoRow label="Campaign" value={campaign?.name ?? "Unassigned"} /><InfoRow label="Added" value={moneySafeDate(lead.createdAt)} /><InfoRow label="Source note" value={lead.sourceNote || "No additional source note"} /></div><div className="drawer-section"><h3>Notes</h3><p className="lead-notes">{lead.notes || "No notes added yet."}</p></div><div className="drawer-section"><label className="drawer-status-label">Lead status<select value={lead.status} onChange={(event) => onStatus(event.target.value as LeadStatus)}>{LEAD_STATUSES.map((status) => <option key={status} value={status}>{formatStatus(status)}</option>)}</select></label></div><div className="drawer-actions"><button className="button-secondary" onClick={onClose}>Close</button>{lead.status !== "suppressed" && <button className="button-primary" onClick={onDraft}>＋ Create draft</button>}</div></aside></div>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span className="empty-icon">◎</span><h2>{title}</h2><p>{text}</p>{action && onAction && <button className="button-secondary" onClick={onAction}>{action}</button>}</div>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button className="close-button" aria-label="Close dialog" onClick={onClose}>×</button></div>{children}</section></div>;
}

export default App;
