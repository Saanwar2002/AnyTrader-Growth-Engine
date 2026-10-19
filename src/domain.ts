export type LeadStatus = "new" | "review" | "qualified" | "contacted" | "onboarded" | "suppressed";
export type CampaignStatus = "draft" | "active" | "paused" | "completed";
export type NavItem = "Overview" | "Campaigns" | "Leads" | "Review queue" | "Outreach drafts" | "Activity" | "Settings";

export interface Campaign {
  id: string;
  name: string;
  brand: string;
  category: string;
  geography: string;
  goal: string;
  status: CampaignStatus;
  createdAt: string;
}

export interface Lead {
  id: string;
  businessName: string;
  category: string;
  city: string;
  region: string;
  website: string;
  email: string;
  phone: string;
  source: string;
  sourceNote: string;
  campaignId: string;
  score: number;
  scoreReason: string[];
  status: LeadStatus;
  notes: string;
  createdAt: string;
  fictional: true;
}

export interface OutreachDraft {
  id: string;
  leadId: string;
  campaignId: string;
  channel: "email" | "linkedin";
  subject: string;
  body: string;
  status: "draft" | "approved" | "archived";
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  kind: string;
  description: string;
  leadId?: string;
  campaignId?: string;
  createdAt: string;
}

export interface AppState {
  campaigns: Campaign[];
  leads: Lead[];
  drafts: OutreachDraft[];
  activities: ActivityEvent[];
}

export const LEAD_STATUSES: LeadStatus[] = ["new", "review", "qualified", "contacted", "onboarded", "suppressed"];
export const CAMPAIGN_STATUSES: CampaignStatus[] = ["draft", "active", "paused", "completed"];

export function formatStatus(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function scoreLead(lead: Pick<Lead, "website" | "email" | "phone" | "city" | "category">): { score: number; reasons: string[] } {
  let score = 35;
  const reasons: string[] = [];
  if (lead.website.trim()) { score += 20; reasons.push("Website listed"); }
  if (lead.email.trim()) { score += 15; reasons.push("Business email listed"); }
  if (lead.phone.trim()) { score += 10; reasons.push("Phone number listed"); }
  if (lead.city.trim()) { score += 10; reasons.push("Location specified"); }
  if (lead.category.trim()) { score += 10; reasons.push("Service category matched"); }
  return { score: Math.min(100, score), reasons };
}

export function createId(prefix: string): string {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

export function csvCell(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}
