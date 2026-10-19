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
  doNotContact: boolean;
  contactReviewStatus?: "pending" | "cleared" | "blocked";
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

export type LeadCsvField = "businessName" | "category" | "location" | "website" | "email" | "phone";
export type LeadCsvMapping = Partial<Record<LeadCsvField, string>>;

const csvAliases: Record<LeadCsvField, string[]> = {
  businessName: ["businessname", "business", "company", "name", "companyname", "tradingname", "organisation", "organization", "business_name", "company_name"],
  category: ["category", "servicecategory", "service", "trade", "tradetype", "industry", "speciality", "specialty"],
  location: ["location", "city", "area", "town", "postcode", "postalcode", "address", "servicearea", "region"],
  website: ["website", "url", "web", "webaddress", "domain"],
  email: ["email", "emailaddress", "contactemail", "e-mail"],
  phone: ["phone", "telephone", "mobile", "phonenumber", "contactnumber", "tel"],
};

export function normalizeCsvHeader(value: string): string {
  return value.toLocaleLowerCase("en-GB").replace(/[\s_-]+/g, "").replace(/[^\p{L}\p{N}]/gu, "");
}

export function suggestLeadCsvMapping(headers: string[]): LeadCsvMapping {
  const mapping: LeadCsvMapping = {};
  const normalized = headers.map(normalizeCsvHeader);
  (Object.keys(csvAliases) as LeadCsvField[]).forEach((field) => {
    const index = normalized.findIndex((header) => csvAliases[field].some((alias) => normalizeCsvHeader(alias) === header));
    if (index >= 0) mapping[field] = headers[index];
  });
  return mapping;
}

export function inspectLeadCsvHeaders(csv: string): { headers: string[]; errors: string[] } {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/);
  const headerLine = lines.find((line) => line.trim().length > 0);
  if (!headerLine) return { headers: [], errors: ["CSV must contain a header and at least one data row."] };
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < headerLine.length; i += 1) {
    const char = headerLine[i];
    if (char === '"' && quoted && headerLine[i + 1] === '"') { current += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(current.trim()); current = ""; }
    else current += char;
  }
  if (quoted) return { headers: [], errors: ["CSV header contains an unmatched quote."] };
  values.push(current.trim());
  if (values.some((header) => !header)) return { headers: [], errors: ["CSV contains an empty column header. Give every column a name."] };
  const headers = values.map(normalizeCsvHeader);
  const duplicates = [...new Set(headers.filter((header, index) => headers.indexOf(header) !== index))];
  if (duplicates.length) return { headers: [], errors: [`CSV contains duplicate column header(s): ${duplicates.join(", ")}. Rename the duplicate columns and try again.`] };
  return { headers: values, errors: [] };
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

export function canCreateOutreachDraft(lead: Pick<Lead, "doNotContact" | "contactReviewStatus">): boolean {
  return lead.doNotContact === false && (lead.contactReviewStatus === undefined || lead.contactReviewStatus === "cleared");
}

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

export function parseLeadCsv(csv: string, fieldMapping?: LeadCsvMapping): { rows: Array<Record<string, string>>; errors: string[] } {
  const source = csv.replace(/^\uFEFF/, "");
  const records: Array<{ text: string; lineNumber: number }> = [];
  let recordText = "";
  let recordStartLine = 1;
  let physicalLine = 1;
  let inQuotedField = false;
  let atFieldStart = true;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\r" || char === "\n") {
      const newlineLength = char === "\r" && source[i + 1] === "\n" ? 2 : 1;
      if (inQuotedField) {
        recordText += "\n";
      } else {
        records.push({ text: recordText, lineNumber: recordStartLine });
        recordText = "";
        recordStartLine = physicalLine + 1;
        atFieldStart = true;
      }
      if (newlineLength === 2) i += 1;
      physicalLine += 1;
      continue;
    }
    recordText += char;
    if (char === '"') {
      if (inQuotedField && source[i + 1] === '"') {
        recordText += source[i + 1];
        i += 1;
      } else if (inQuotedField) {
        inQuotedField = false;
      } else if (atFieldStart) {
        inQuotedField = true;
      }
      atFieldStart = false;
    } else if (char === "," && !inQuotedField) {
      atFieldStart = true;
    } else if (!/\s/.test(char)) {
      atFieldStart = false;
    }
  }
  if (recordText.length > 0 || source.endsWith(",") || source.endsWith('"')) {
    records.push({ text: recordText, lineNumber: recordStartLine });
  }
  const headerRecordIndex = records.findIndex((record) => record.text.trim().length > 0);
  if (headerRecordIndex < 0) return { rows: [], errors: ["CSV must contain a header and at least one data row."] };

  const parseLine = (line: string): string[] | null => {
    const values: string[] = [];
    let current = "";
    let quoted = false;
    let afterQuote = false;
    let malformed = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
          afterQuote = true;
        } else {
          current += char;
        }
      } else if (afterQuote) {
        if (char === ",") {
          values.push(current.trim());
          current = "";
          afterQuote = false;
        } else if (!/\\s/.test(char)) {
          malformed = true;
        }
      } else if (char === ",") {
        values.push(current.trim());
        current = "";
      } else if (char === '"') {
        if (current.length !== 0) malformed = true;
        else quoted = true;
      } else {
        current += char;
      }
    }
    if (quoted || malformed) return null;
    values.push(current.trim());
    return values;
  };

  const parsedHeaders = parseLine(records[headerRecordIndex].text);
  if (!parsedHeaders) return { rows: [], errors: ["CSV header contains an unmatched quote."] };
  const headers = parsedHeaders.map(normalizeCsvHeader);
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

  const originalHeaders = parsedHeaders.map((header) => header.trim());
  const automaticMapping = suggestLeadCsvMapping(originalHeaders);
  const mapping = fieldMapping ?? automaticMapping;
  const canonicalMapping: Partial<Record<LeadCsvField, number>> = {};
  (Object.keys(csvAliases) as LeadCsvField[]).forEach((field) => {
    const selected = mapping[field];
    if (selected) {
      const index = originalHeaders.findIndex((header) => header === selected);
      if (index >= 0) canonicalMapping[field] = index;
    }
  });
  const nameIndex = canonicalMapping.businessName;
  if (nameIndex === undefined) {
    return { rows: [], errors: [fieldMapping ? "Map a CSV column to the required Business name field before previewing the import." : "Missing required column: businessName (or business/company/name)."] };
  }

  const rows: Array<Record<string, string>> = [];
  const errors: string[] = [];
  records.slice(headerRecordIndex + 1).forEach((record) => {
    const line = record.text;
    if (!line.trim()) return;
    const rowNumber = record.lineNumber;
    const values = parseLine(line);
    if (!values) {
      errors.push(`Row ${rowNumber}: malformed or unmatched quote; row skipped.`);
      return;
    }
    if (values.every((value) => !value.trim())) return;
    if (values.length > headers.length) {
      errors.push(`Row ${rowNumber}: contains more values than the header has columns; row skipped.`);
      return;
    }
    const row: Record<string, string> = {};
    (Object.keys(canonicalMapping) as LeadCsvField[]).forEach((field) => {
      row[normalizeCsvHeader(field)] = values[canonicalMapping[field]!] ?? "";
    });
    if (!values[nameIndex]?.trim()) {
      errors.push(`Row ${rowNumber}: business name is required; row skipped.`);
      return;
    }
    const fieldLimits: Record<string, number> = { businessname: 160, category: 100, location: 160, website: 500, email: 254, phone: 80 };
    const oversizedField = Object.entries(row).find(([field, value]) => value.length > (fieldLimits[field] ?? Number.MAX_SAFE_INTEGER));
    if (oversizedField) {
      errors.push(`Row ${rowNumber}: ${oversizedField[0]} exceeds the maximum length of ${fieldLimits[oversizedField[0]]} characters; row skipped.`);
      return;
    }
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push(`Row ${rowNumber}: email address is not valid; row skipped.`);
      return;
    }
    rows.push(row);
  });
  if (rows.length === 0 && errors.length === 0) {
    errors.push("CSV must contain a header and at least one data row.");
  }
  return { rows, errors };
}


export function escapeCsvCell(value: string | number): string {
  let text = String(value);
  const first = text.trimStart().charAt(0);
  const riskyPrefixes = ["=", "+", String.fromCharCode(45), String.fromCharCode(64)];
  if (riskyPrefixes.includes(first) || text.startsWith("\t") || text.startsWith("\r") || text.startsWith("\n")) {
    text = "'" + text;
  }
  return '"' + text.replace(/"/g, '""') + '"';
}
