import type { AppState, Campaign, Lead } from "./domain";
import { scoreLead } from "./domain";

const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();

const campaign: Campaign = {
  id: "campaign_painters_north",
  name: "North West painter recruitment",
  brand: "AnyTrader",
  category: "Painters & decorators",
  geography: "Greater Manchester",
  goal: "Recruit reliable local service providers",
  status: "active",
  createdAt: daysAgo(8),
};

const rawLeads = [
  ["Fictional Oak & Brush Decorating", "Manchester", "Greater Manchester", "https://example.com/oak-brush", "hello@example.com", "0161 555 0101", "Website, synthetic fixture", "review", "Example record for product demonstration."],
  ["Fictional Northline Painting Co.", "Salford", "Greater Manchester", "https://example.com/northline", "", "0161 555 0102", "Synthetic fixture", "new", ""],
  ["Fictional Brightwall Decorators", "Stockport", "Greater Manchester", "", "contact@example.com", "0161 555 0103", "Synthetic fixture", "qualified", "Strong category match; verify details before use."],
  ["Fictional Fresh Coat Services", "Bolton", "Greater Manchester", "https://example.com/fresh-coat", "team@example.com", "", "Synthetic fixture", "review", ""],
  ["Fictional City Edge Painting", "Manchester", "Greater Manchester", "https://example.com/city-edge", "info@example.com", "0161 555 0105", "Synthetic fixture", "contacted", "Draft prepared; not sent."],
  ["Fictional Willow Home Finishes", "Bury", "Greater Manchester", "", "", "0161 555 0106", "Synthetic fixture", "new", ""],
  ["Fictional Cornerstone Decor", "Rochdale", "Greater Manchester", "https://example.com/cornerstone", "hello@example.com", "01706 555 0107", "Synthetic fixture", "qualified", ""],
  ["Fictional TrueHue Painters", "Oldham", "Greater Manchester", "https://example.com/truehue", "", "", "Synthetic fixture", "review", ""],
  ["Fictional Urban Finish Studio", "Trafford", "Greater Manchester", "https://example.com/urban-finish", "studio@example.com", "0161 555 0109", "Synthetic fixture", "new", ""],
  ["Fictional Redbrick Decorating", "Wigan", "Greater Manchester", "", "hello@example.com", "01942 555 0110", "Synthetic fixture", "suppressed", "Suppressed demo record; do not contact."],
  ["Fictional Peak & Plain Decor", "Manchester", "Greater Manchester", "https://example.com/peak-plain", "team@example.com", "0161 555 0111", "Synthetic fixture", "onboarded", "Demo conversion for analytics preview."],
  ["Fictional Northern Brushworks", "Altrincham", "Greater Manchester", "https://example.com/brushworks", "", "0161 555 0112", "Synthetic fixture", "new", ""],
  ["Fictional Alder & Lime Painting", "Sale", "Greater Manchester", "https://example.com/alder-lime", "contact@example.com", "", "Synthetic fixture", "review", ""],
  ["Fictional Detail Decor Group", "Prestwich", "Greater Manchester", "", "hello@example.com", "0161 555 0114", "Synthetic fixture", "qualified", ""],
  ["Fictional Blue Door Finishes", "Eccles", "Greater Manchester", "https://example.com/blue-door", "info@example.com", "0161 555 0115", "Synthetic fixture", "new", ""],
  ["Fictional Goodgrain Home Decor", "Didsbury", "Greater Manchester", "https://example.com/goodgrain", "", "", "Synthetic fixture", "review", ""],
] as const;

const leads: Lead[] = rawLeads.map((row, index) => {
  const [businessName, city, region, website, email, phone, sourceNote, status, notes] = row;
  const scored = scoreLead({ website, email, phone, city, category: campaign.category });
  return {
    id: "lead_demo_" + String(index + 1).padStart(3, "0"),
    businessName, category: campaign.category, city, region, website, email, phone,
    source: "Synthetic demo data", sourceNote, campaignId: campaign.id,
    score: scored.score, scoreReason: scored.reasons,
    status, notes, createdAt: daysAgo(index % 8), fictional: true,
  };
});

export const initialDemoState: AppState = {
  campaigns: [campaign],
  leads,
  drafts: [{
    id: "draft_demo_001",
    leadId: "lead_demo_005",
    campaignId: campaign.id,
    channel: "email",
    subject: "An invitation to join AnyTrader",
    body: "Hello City Edge Painting team,\n\nI’m reaching out from AnyTrader. We’re building our network of trusted local service providers and would welcome the chance to tell you how it works.\n\nIf you’re interested, you can review the platform and decide whether it may suit your business.\n\nKind regards,\nThe AnyTrader team\n\n[Demo draft — review all details before use]",
    status: "draft",
    createdAt: daysAgo(1),
  }],
  activities: [
    { id: "activity_001", kind: "campaign", description: "Created North West painter recruitment campaign", campaignId: campaign.id, createdAt: daysAgo(8) },
    { id: "activity_002", kind: "import", description: "Loaded 16 fictional leads for the demo workspace", campaignId: campaign.id, createdAt: daysAgo(7) },
    { id: "activity_003", kind: "review", description: "Qualified Brightwall Decorators (fictional demo record)", leadId: "lead_demo_003", campaignId: campaign.id, createdAt: daysAgo(3) },
    { id: "activity_004", kind: "draft", description: "Prepared an outreach draft; no message was sent", leadId: "lead_demo_005", campaignId: campaign.id, createdAt: daysAgo(1) },
  ],
};
