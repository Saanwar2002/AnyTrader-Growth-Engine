const cards = [
  ["Campaigns", "0", "No campaigns created yet"],
  ["Leads discovered", "0", "Demo data not loaded"],
  ["Needs review", "0", "Nothing waiting for review"],
  ["Outreach drafts", "0", "Nothing is sent automatically"],
];

export default function App() {
  return <main className="shell">
    <header className="topbar"><a className="brand" href="/"><span className="mark">G</span><span><strong>Growth Engine</strong><small>Provider acquisition workspace</small></span></a><span className="badge">DEMO MODE · NO LIVE DATA</span></header>
    <section className="intro"><p className="eyebrow">MULTI-BRAND GROWTH PLATFORM</p><h1>Find the right providers.<br/><span>Grow every marketplace.</span></h1><p className="intro-copy">Discover, qualify, and manage potential service providers across AnyTrader, HandyTrader, and future brands from one workspace.</p><button disabled>Create campaign ↗</button><span className="quiet"> Campaign tools are being set up.</span></section>
    <section className="cards" aria-label="Workspace summary">{cards.map(([label, value, note]) => <article className="card" key={label}><p>{label}</p><strong>{value}</strong><small>{note}</small></article>)}</section>
    <section className="columns"><article className="panel"><p className="eyebrow">GETTING STARTED</p><h2>Your first campaign</h2><div className="step"><b>01</b><div><strong>Choose a brand and service</strong><p>Start with painters and decorators, then expand to other trades and services.</p></div></div><div className="step"><b>02</b><div><strong>Set a target area</strong><p>Choose a UK location and define which providers you want to onboard.</p></div></div><div className="step"><b>03</b><div><strong>Review before contacting</strong><p>Lead records and outreach drafts will require human review.</p></div></div></article><aside className="panel"><p className="eyebrow">BUILT-IN GUARDRAILS</p><h2>Human-led, privacy-aware growth</h2><ul><li>✓ Approved data sources only</li><li>✓ Duplicate detection and lead review</li><li>✓ Draft-only outreach by default</li><li>✓ Brand and campaign separation</li><li>✓ No production connection to AnyTrader</li></ul><div className="notice"><strong>Demo environment</strong><p>No real lead records, credentials, or live integrations are configured.</p></div></aside></section>
    <footer><span>AnyTrader Growth Engine</span><span>Foundation phase · Integrations not configured</span></footer>
  </main>;
}
