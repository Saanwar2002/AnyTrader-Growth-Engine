export type LeadStatus = "new" | "reviewing" | "qualified" | "contacted" | "onboarded" | "rejected";
export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export interface Campaign {
  id: string;
  name: string;
  brand: string;
  category: string;
  location: string;
  goal: string;
  status: CampaignStatus;
  createdAt: string;
}

export interface Lead {
  id: string;
  campaignId: string;
  businessName: string;
  category: string;
  location: string;
  website: string;
  email: string;
  phone: string;
  source: "demo" | "csv";
  status: LeadStatus;
  score: number;
  scoreReasons: string[];
  notes: string;
  createdAt: string;
}

export interface OutreachDraft {
  id: string;
  leadId: string;
  campaignId: string;
  subject: string;
  body: string;
  status: "draft" | "approved";
  createdAt: string;
}

export interface Activity {
  id: string;
  leadId: string;
  message: string;
  createdAt: string;
}

export interface AppState {
  campaigns: Campaign[];
  leads: Lead[];
  drafts: OutreachDraft[];
  activities: Activity[];
}

export const LEAD_STATUSES: LeadStatus[] = [
  "new", "reviewing", "qualified", "contacted", "onboarded", "rejected",
];

export function normalizeBusinessName(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").replace(/\s+/g, " ");
}

export function deduplicateLeads<T extends Pick<Lead, "campaignId" | "businessName">>(
  candidates: T[],
  existing: T[],
): { unique: T[]; duplicateCount: number } {
  const keyFor = (lead: T) => `${lead.campaignId}:${normalizeBusinessName(lead.businessName)}`;
  const knownKeys = new Set(existing.map(keyFor));
  const unique: T[] = [];
  let duplicateCount = 0;
  for (const candidate of candidates) {
    const key = keyFor(candidate);
    if (knownKeys.has(key)) {
      duplicateCount += 1;
      continue;
    }
    knownKeys.add(key);
    unique.push(candidate);
  }
  return { unique, duplicateCount };
}

export function scoreLead(input: Pick<Lead, "businessName" | "website" | "email" | "phone" | "location" | "category">): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (input.businessName.trim().length >= 3) { score += 20; reasons.push("Business name provided (+20)"); }
  if (input.website.trim()) { score += 20; reasons.push("Website listed (+20)"); }
  if (input.email.trim()) { score += 20; reasons.push("Email listed (+20)"); }
  if (input.phone.trim()) { score += 15; reasons.push("Phone listed (+15)"); }
  if (input.location.trim()) { score += 15; reasons.push("Location provided (+15)"); }
  if (input.category.trim()) { score += 10; reasons.push("Service category provided (+10)"); }
  return { score: Math.min(score, 100), reasons };
}

export function parseLeadCsv(csv: string): { rows: Array<Record<string, string>>; errors: string[] } {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLineIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerLineIndex < 0) return { rows: [], errors: ["CSV must contain a header and at least one data row."] };

  const parseLine = (line: string): string[] | null => {
    const values: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"' && quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    if (quoted) return null;
    values.push(current.trim());
    return values;
  };

  const parsedHeaders = parseLine(lines[headerLineIndex]);
  if (!parsedHeaders) return { rows: [], errors: ["CSV header contains an unmatched quote."] };
  const headers = parsedHeaders.map((header) => header.toLocaleLowerCase("en-GB").replace(/\s+/g, ""));
  if (headers.some((header) => !header)) {
    return { rows: [], errors: ["CSV contains an empty column header. Give every column a name."] };
  }
  const seenHeaders = new Set<string>();
  const duplicateHeaders = new Set<string>();
  headers.forEach((header) => {
    if (seenHeaders.has(header)) duplicateHeaders.add(header);
    seenHeaders.add(header);
  });
  if (duplicateHeaders.size > 0) {
    return { rows: [], errors: [`CSV contains duplicate column header(s): ${[...duplicateHeaders].join(", ")}. Rename the duplicate columns and try again.`] };
  }

  const nameIndex = headers.findIndex((h) => ["businessname", "business", "company", "name"].includes(h));
  if (nameIndex < 0) return { rows: [], errors: ["Missing required column: businessName (or business/company/name)."] };

  const rows: Array<Record<string, string>> = [];
  const errors: string[] = [];
  lines.slice(headerLineIndex + 1).forEach((line, offset) => {
    if (!line.trim()) return;
    const rowNumber = headerLineIndex + offset + 2;
    const values = parseLine(line);
    if (!values) {
      errors.push(`Row ${rowNumber}: unmatched quote; row skipped.`);
      return;
    }
    if (values.every((value) => !value.trim())) return;
    if (values.length > headers.length) {
      errors.push(`Row ${rowNumber}: contains more values than the header has columns; row skipped.`);
      return;
    }
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = values[index] ?? ""; });
    if (!values[nameIndex]?.trim()) errors.push(`Row ${rowNumber}: business name is required; row skipped.`);
    else rows.push(row);
  });
  if (rows.length === 0 && errors.length === 0) {
    errors.push("CSV must contain a header and at least one non-empty data row.");
  }
  return { rows, errors };
}
