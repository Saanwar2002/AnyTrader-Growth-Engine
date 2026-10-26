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

/** Return a safe external HTTP(S) URL for a user-supplied lead website, or null when it is not safe to link. */
export function safeLeadWebsiteHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 500 || /[\s\u0000-\u001f\u007f]/.test(candidate)) return null;
  const hasHttpScheme = /^https?:\/\//i.test(candidate);
  const looksLikeHostPort = /^[^/:?#]+:\d+(?:[/?#]|$)/.test(candidate);
  if (candidate.includes(":") && !hasHttpScheme && !looksLikeHostPort) return null;
  const urlValue = hasHttpScheme ? candidate : \`https://\${candidate}\`;
  try {
    const parsed = new URL(urlValue);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password) return null;
    if (parsed.hostname.toLocaleLowerCase("en-GB") === "localhost" || parsed.hostname.endsWith(".localhost")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

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

/** Returns the safe UI action for a contact restriction, treating contradictory review metadata as requiring admin review. */
export function getContactRestrictionAction(doNotContact: unknown, contactReviewStatus: unknown): "clear" | "suppress" {
  if (doNotContact === true || contactReviewStatus === "pending" || contactReviewStatus === "blocked") return "clear";
  return "suppress";
}

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
      let hasFutureQuote = false;
      if (inQuotedField) {
        // A quote only closes a quoted field when followed by a delimiter,
        // whitespace, a record boundary, or end-of-input. A quote opening a
        // later record must not make an earlier unmatched quote absorb it.
        for (let j = i + newlineLength; j < source.length; j += 1) {
          if (source[j] !== '"') continue;
          if (source[j + 1] === '"') {
            j += 1;
            continue;
          }
          // A quote at the start of a later physical line followed by ordinary
          // field text is likely a new quoted record, not the missing close for
          // this field. Do not let it make a malformed row absorb valid rows.
          const previousLf = source.lastIndexOf("\n", j - 1);
          const previousCr = source.lastIndexOf("\r", j - 1);
          const lineStart = Math.max(previousLf, previousCr) + 1;
          if (source.slice(lineStart, j).trim() === "") {
            let afterOpeningQuote = j + 1;
            while (afterOpeningQuote < source.length && /[ \t]/.test(source[afterOpeningQuote])) {
              afterOpeningQuote += 1;
            }
            const openingNext = source[afterOpeningQuote];
            if (openingNext !== undefined && openingNext !== "," && openingNext !== "\r" && openingNext !== "\n") {
              while (j < source.length && source[j] !== "\r" && source[j] !== "\n") j += 1;
              continue;
            }
          }
          let afterClosingQuote = j + 1;
          while (afterClosingQuote < source.length && /[ \t]/.test(source[afterClosingQuote])) {
            afterClosingQuote += 1;
          }
          const next = source[afterClosingQuote];
          if (afterClosingQuote === source.length || next === "," || next === "\r" || next === "\n") {
            hasFutureQuote = true;
            break;
          }
        }
      }
      if (inQuotedField && hasFutureQuote) {
        recordText += "\n";
      } else {
        // Recover at a physical line boundary when an unmatched quote has no closing quote.
        inQuotedField = false;
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
        } else if (!/\s/.test(char)) {
          malformed = true;
        }
      } else if (char === ",") {
        values.push(current.trim());
        current = "";
      } else if (char === '"') {
        // Allow harmless whitespace before a quoted field, but not other
        // characters; otherwise malformed quote placement must fail closed.
        if (current.trim().length !== 0) malformed = true;
        else { current = ""; quoted = true; }
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
  const sourceRecordIdHeaderIndexes = headers
    .map((header, index) => (["sourcerecordid", "providerrecordid", "externalrecordid"].includes(header) ? index : -1))
    .filter((index) => index >= 0);
  if (sourceRecordIdHeaderIndexes.length > 1) {
    return { rows: [], errors: ["CSV contains multiple source record ID columns. Keep only one sourceRecordId, providerRecordId, or externalRecordId column."] };
  }
  const sourceRecordIdHeaderIndex = sourceRecordIdHeaderIndexes[0];
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
  // A single source column must not be assigned to multiple fields: doing so
  // can silently copy the same value into unrelated contact fields.
  const mappedIndexes = Object.entries(canonicalMapping);
  const duplicateIndexes = [...new Set(mappedIndexes
    .map(([, index]) => index)
    .filter((index, position, all) => all.indexOf(index) !== position))];
  if (duplicateIndexes.length > 0) {
    const duplicateFields = mappedIndexes
      .filter(([, index]) => duplicateIndexes.includes(index))
      .map(([field]) => field);
    return {
      rows: [],
      errors: [`CSV field mapping assigns the same column to multiple fields (${duplicateFields.join(", ")}); choose a different column for each field.`],
    };
  }

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
    if (sourceRecordIdHeaderIndex !== undefined) {
      const sourceRecordId = (values[sourceRecordIdHeaderIndex] ?? "").trim();
      if (sourceRecordId.length > 200) {
        errors.push(`Row ${rowNumber}: sourceRecordId exceeds the maximum length of 200 characters; row skipped.`);
        return;
      }
      if (sourceRecordId) row.sourcerecordid = sourceRecordId;
    }
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


export interface PlanUsageCsvSummary {
  organisationId: string;
  status: "authoritative" | "reconciliation_required";
  plan: { displayName: string; limits: { campaigns: number; leads: number; members: number; monthlyAiSuggestions: number } };
  usage: { campaigns: number; leads: number; members: number; monthlyAiSuggestions: number } | null;
  remaining: { campaigns: number; leads: number; members: number; monthlyAiSuggestions: number } | null;
  aiUsagePeriod: string | null;
  message: string;
}

export interface PlanUsageReconciliationCsvSummary {
  status: "missing" | "invalid" | "present";
  actual: { campaigns: number; leads: number; members: number };
  stored: ({ campaigns: number; leads: number; members: number; monthlyAiSuggestions: number; aiUsagePeriod: string }) | null;
  mismatchedMetrics: Array<"campaigns" | "leads" | "members">;
  currentAiUsagePeriod: string | null;
  notes: string[];
}

/**
 * Export read-only quota reconciliation without inventing legacy usage or AI history.
 * Every cell is formula-safe; AI usage is always labelled review-required because
 * historical monthly counts cannot be reconstructed from current resource totals.
 */
export function serializePlanUsageReconciliationCsv(
  plan: PlanUsageCsvSummary,
  reconciliation: PlanUsageReconciliationCsvSummary,
): string {
  const headers = [
    "Organisation ID", "Plan", "Plan usage status", "Metric", "Actual count",
    "Stored count", "Limit", "Remaining", "Reconciliation status", "AI usage period", "Notes",
  ];
  const csvCell = (value: string | number | null): string => escapeCsvCell(value === null ? "Unavailable" : value);
  const rows: Array<Array<string | number | null>> = [];
  const metrics = [
    { key: "campaigns" as const, label: "Campaigns (lifetime)" },
    { key: "leads" as const, label: "Leads (lifetime)" },
    { key: "members" as const, label: "Members (current)" },
  ];
  for (const metric of metrics) {
    const status = reconciliation.status !== "present"
      ? "Review required"
      : reconciliation.mismatchedMetrics.includes(metric.key) ? "Mismatch" : "Match";
    rows.push([
      plan.organisationId, plan.plan.displayName, plan.status, metric.label,
      reconciliation.actual[metric.key], reconciliation.stored?.[metric.key] ?? null,
      plan.plan.limits[metric.key], plan.remaining?.[metric.key] ?? null,
      status, reconciliation.currentAiUsagePeriod,
      reconciliation.notes.join(" | ") || plan.message,
    ]);
  }
  rows.push([
    plan.organisationId, plan.plan.displayName, plan.status, "Monthly AI suggestions",
    "Review required — historical usage is not inferred",
    reconciliation.stored?.monthlyAiSuggestions ?? null,
    plan.plan.limits.monthlyAiSuggestions,
    plan.remaining?.monthlyAiSuggestions ?? null,
    "Review required", reconciliation.stored?.aiUsagePeriod ?? reconciliation.currentAiUsagePeriod,
    "Historical AI usage requires separate review; no usage was reconstructed. " + (reconciliation.notes.join(" | ") || plan.message),
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export interface LeadExportRecord {
  campaignId: string;
  businessName: string;
  category: string;
  location: string;
  website: string;
  email: string;
  phone: string;
  source: string;
  sourceRecordId?: string;
  status: string;
  doNotContact: boolean;
  contactRestrictionVerified: boolean;
  contactReviewStatus?: "pending" | "cleared" | "blocked";
  score?: number;
  scoreReasons?: string[];
}

/**
 * Serialise only the records supplied by the caller. Callers must label partial
 * exports when their source list is paginated. Internal notes are intentionally
 * excluded, and all data cells are protected against spreadsheet formula input.
 */
export function serializeLeadExportCsv(
  leads: LeadExportRecord[],
  campaignNames: Record<string, string>,
): string {
  const headers = [
    "Business name", "Category", "Location", "Website", "Email", "Phone",
    "Campaign", "Status", "Source", "Source record ID", "Contact restriction", "Completeness score", "Completeness reasons",
  ];
  const rows = leads.map((lead) => {
    const restriction = lead.contactReviewStatus === "pending"
      ? "pending review"
      : lead.contactReviewStatus === "blocked"
        ? "blocked - review required"
        : lead.doNotContact
          ? "do not contact"
          : lead.contactReviewStatus === "cleared" && lead.contactRestrictionVerified
            ? "review cleared"
            : lead.contactRestrictionVerified
              ? "review cleared"
              : "review required";
    return [
      lead.businessName, lead.category, lead.location, lead.website, lead.email, lead.phone,
      campaignNames[lead.campaignId] ?? "Unknown campaign", lead.status, lead.source, lead.sourceRecordId ?? "", restriction,
      typeof lead.score === "number" && Number.isFinite(lead.score) ? String(Math.max(0, Math.min(100, Math.round(lead.score)))) : "",
      Array.isArray(lead.scoreReasons) ? lead.scoreReasons.join("; ") : "",
    ].map((value) => escapeCsvCell(value ?? ""));
  });
  return [headers.map((value) => escapeCsvCell(value)).join(","), ...rows.map((row) => row.join(","))].join("\r\n") + "\r\n";
}


/** Human-readable labels for user-declared lead provenance. These labels are not independently verified. */
export function formatLeadSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    manual: "Manual entry",
    csv_import: "CSV import",
    linkedin_csv: "LinkedIn export (user-declared)",
    google_places_manual: "Google Maps/Places research (user-declared)",
    other_approved: "Other approved source (user-declared)",
  };
  return labels[source] ?? source;
}


export type LeadCsvDuplicateField = "email" | "website" | "business/location";
export interface LeadCsvDuplicateCandidate {
  businessName: string;
  location?: string;
  email?: string;
  website?: string;
}
export interface LeadCsvDuplicateExisting extends LeadCsvDuplicateCandidate {
  campaignId: string;
}
export interface LeadCsvDuplicateMatch {
  rowIndex: number;
  duplicateSource: "loaded-lead" | "earlier-upload-row";
  duplicateBusinessName: string;
  matchedOn: LeadCsvDuplicateField;
}
function canonicalCsvEmail(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
function canonicalCsvWebsite(value: string | undefined): string {
  const valueTrimmed = (value ?? "").trim();
  if (!valueTrimmed) return "";
  try {
    const parsed = new URL(valueTrimmed.includes("://") ? valueTrimmed : `https://${valueTrimmed}`);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}
function canonicalCsvBusinessLocation(businessName: string, location: string | undefined): string {
  const name = businessName.trim().toLowerCase();
  const place = (location ?? "").trim().toLowerCase();
  return name && place ? JSON.stringify([name, place]) : "";
}

/**
 * Preview likely import duplicates using the same email, website, and
 * business/location keys as the server. Only supplied existing leads are checked;
 * the server remains authoritative for the complete organisation inventory.
 */
export function findLeadCsvDuplicates(
  candidates: LeadCsvDuplicateCandidate[],
  existingLeads: LeadCsvDuplicateExisting[],
): LeadCsvDuplicateMatch[] {
  const emailKeys = new Map<string, { businessName: string; source: "loaded-lead" | "earlier-upload-row" }>();
  const websiteKeys = new Map<string, { businessName: string; source: "loaded-lead" | "earlier-upload-row" }>();
  const businessLocationKeys = new Map<string, { businessName: string; source: "loaded-lead" | "earlier-upload-row" }>();
  const add = (lead: LeadCsvDuplicateCandidate, source: "loaded-lead" | "earlier-upload-row") => {
    const value = { businessName: lead.businessName, source };
    const email = canonicalCsvEmail(lead.email);
    const website = canonicalCsvWebsite(lead.website);
    const businessLocation = canonicalCsvBusinessLocation(lead.businessName, lead.location);
    if (email && !emailKeys.has(email)) emailKeys.set(email, value);
    if (website && !websiteKeys.has(website)) websiteKeys.set(website, value);
    if (businessLocation && !businessLocationKeys.has(businessLocation)) businessLocationKeys.set(businessLocation, value);
  };
  existingLeads.forEach((lead) => add(lead, "loaded-lead"));
  const matches: LeadCsvDuplicateMatch[] = [];
  candidates.forEach((candidate, rowIndex) => {
    const email = canonicalCsvEmail(candidate.email);
    const website = canonicalCsvWebsite(candidate.website);
    const businessLocation = canonicalCsvBusinessLocation(candidate.businessName, candidate.location);
    const match = (email && emailKeys.get(email))
      ? { value: emailKeys.get(email)!, field: "email" as const }
      : (website && websiteKeys.get(website))
        ? { value: websiteKeys.get(website)!, field: "website" as const }
        : (businessLocation && businessLocationKeys.get(businessLocation))
          ? { value: businessLocationKeys.get(businessLocation)!, field: "business/location" as const }
          : null;
    if (match) {
      matches.push({ rowIndex, duplicateSource: match.value.source, duplicateBusinessName: match.value.businessName, matchedOn: match.field });
      // The server skips duplicate rows before they reserve other identifiers.
      return;
    }
    add(candidate, "earlier-upload-row");
  });
  return matches;
}
