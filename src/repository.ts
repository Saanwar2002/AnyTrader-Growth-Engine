import { initialDemoState } from "./demoData";
import { createId, scoreLead, type AppState, type Campaign, type Lead, type LeadStatus } from "./domain";

const STORAGE_KEY = "anytrader-growth-engine.demo.v1";

export function loadState(): AppState {
  if (typeof window === "undefined") return structuredClone(initialDemoState);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(initialDemoState);
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || !Array.isArray(parsed.campaigns) || !Array.isArray(parsed.leads) || !Array.isArray(parsed.drafts) || !Array.isArray(parsed.activities)) {
      return structuredClone(initialDemoState);
    }
    return parsed;
  } catch {
    return structuredClone(initialDemoState);
  }
}

export function saveState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep the current session usable if browser storage is disabled or full.
  }
}

export function makeCampaign(input: Omit<Campaign, "id" | "createdAt">): Campaign {
  return { ...input, id: createId("campaign"), createdAt: new Date().toISOString() };
}

export function addCsvLeads(csvText: string, campaignId: string, existing: Lead[]): { leads: Lead[]; skipped: number; errors: string[] } {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { leads: [], skipped: 0, errors: ["CSV must include a header row and at least one data row."] };
  const headers = parseCsvLine(lines[0]).map((header) => header.trim().toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const aliases: Record<string, string[]> = {
    businessname: ["businessname", "business", "company", "name"],
    category: ["category", "service", "servicecategory"],
    city: ["city", "town", "location"],
    region: ["region", "county", "state"],
    website: ["website", "url", "web"],
    email: ["email", "businessemail"],
    phone: ["phone", "telephone", "phonenumber"],
    notes: ["notes", "note", "description"],
  };
  const indexFor = (field: string) => headers.findIndex((header) => aliases[field].includes(header));
  const nameIndex = indexFor("businessname");
  if (nameIndex < 0) return { leads: [], skipped: 0, errors: ["A business name column is required (for example, Business Name or Company)."] };
  const existingKeys = new Set(existing.map((lead) => normalizeKey(lead.businessName + "|" + lead.city)));
  const added: Lead[] = [];
  let skipped = 0;
  const errors: string[] = [];
  lines.slice(1).forEach((line, rowIndex) => {
    const cells = parseCsvLine(line);
    const get = (field: string) => { const index = indexFor(field); return index >= 0 ? (cells[index] ?? "").trim() : ""; };
    const businessName = (cells[nameIndex] ?? "").trim();
    if (!businessName) { skipped += 1; errors.push("Row " + (rowIndex + 2) + ": business name is blank."); return; }
    const city = get("city");
    const key = normalizeKey(businessName + "|" + city);
    if (existingKeys.has(key)) { skipped += 1; return; }
    existingKeys.add(key);
    const category = get("category") || "Uncategorised";
    const website = get("website");
    const email = get("email");
    const phone = get("phone");
    const scored = scoreLead({ website, email, phone, city, category });
    added.push({
      id: createId("lead"), businessName, category, city, region: get("region"), website, email, phone,
      source: "CSV import", sourceNote: "Imported by a workspace user", campaignId,
      score: scored.score, scoreReason: scored.reasons, status: "new", notes: get("notes"),
      createdAt: new Date().toISOString(), fictional: true,
    });
  });
  return { leads: added, skipped, errors };
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (character === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(value); value = ""; }
    else value += character;
  }
  cells.push(value);
  return cells;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function updateLeadStatus(state: AppState, leadId: string, status: LeadStatus): AppState {
  const lead = state.leads.find((item) => item.id === leadId);
  if (!lead || lead.status === status) return state;
  const updatedLead = { ...lead, status };
  return {
    ...state,
    leads: state.leads.map((item) => item.id === leadId ? updatedLead : item),
    activities: [{
      id: createId("activity"),
      kind: "status",
      description: "Changed " + lead.businessName + " from " + lead.status + " to " + status,
      leadId, campaignId: lead.campaignId, createdAt: new Date().toISOString(),
    }, ...state.activities],
  };
}
