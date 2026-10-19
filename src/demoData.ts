import type { AppState, Campaign, Lead } from "./domain";
import { scoreLead } from "./domain";

const createdAt = "2026-10-19T09:00:00.000Z";

const campaign: Campaign = {
  id: "campaign-demo-painters",
  name: "Manchester painter pilot",
  brand: "AnyTrader",
  category: "Painters & decorators",
  location: "Manchester, UK",
  goal: "Recruit reliable providers",
  status: "active",
  createdAt,
};

const syntheticLeads = [
  { id: "lead-demo-1", businessName: "Fictional Northside Painting Co", location: "Manchester, UK", website: "https://example.com/northside", email: "hello@example.com", phone: "0161 555 0101", status: "new" as const },
  { id: "lead-demo-2", businessName: "Sample BrightBrush Decorators", location: "Salford, UK", website: "", email: "team@example.com", phone: "0161 555 0102", status: "reviewing" as const },
  { id: "lead-demo-3", businessName: "Demo Oak & Colour Ltd", location: "Stockport, UK", website: "https://example.com/oak-colour", email: "", phone: "", status: "qualified" as const },
  { id: "lead-demo-4", businessName: "Example FreshCoat Services", location: "Bolton, UK", website: "https://example.com/freshcoat", email: "contact@example.com", phone: "01204 555 0103", status: "contacted" as const },
  { id: "lead-demo-5", businessName: "Fictional Cityline Decorating", location: "Manchester, UK", website: "", email: "", phone: "", status: "new" as const },
];

const leads: Lead[] = syntheticLeads.map((item) => {
  const scored = scoreLead({ ...item, category: "Painters & decorators" });
  return {
    ...item,
    campaignId: campaign.id,
    category: "Painters & decorators",
    source: "demo",
    score: scored.score,
    scoreReasons: scored.reasons,
    notes: "",
    createdAt,
  };
});

export function createInitialState(): AppState {
  return {
    campaigns: [campaign],
    leads,
    drafts: [],
    activities: [
      { id: "activity-demo-1", leadId: "lead-demo-2", message: "Synthetic demo lead added to the review queue.", createdAt },
      { id: "activity-demo-2", leadId: "lead-demo-3", message: "Synthetic demo lead marked as qualified.", createdAt },
    ],
  };
}
