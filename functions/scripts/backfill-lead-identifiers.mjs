import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { canonicalLeadBusinessLocationKey, canonicalLeadEmailKey, canonicalLeadWebsiteKey } from "../lib/lead-identifiers.js";
import { isSafeWebsiteAddress, isValidEmailAddress } from "../lib/authorization.js";

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--confirm-apply");
const organisationId = readOption("--organisation-id", "");
const pageSize = Number(readOption("--page-size", "100"));
const maxRecords = Number(readOption("--max-records", "5000"));
const projectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
if (projectId !== "demo-growth-engine-test" || !/^(127\.0\.0\.1:8080|localhost:8080)$/.test(emulatorHost)) {
  throw new Error("This backfill harness is emulator-only and refuses all cloud Firestore projects.");
}
if (!/^[A-Za-z0-9_-]{1,128}$/.test(organisationId)) {
  throw new Error("Usage: node functions/scripts/backfill-lead-identifiers.mjs --organisation-id <id> [--page-size 100] [--max-records 5000] [--apply --confirm-apply]");
}
if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 200) {
  throw new Error("--page-size must be an integer from 1 to 200.");
}
if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 20000) {
  throw new Error("--max-records must be an integer from 1 to 20000.");
}
if (apply && !confirmed) {
  throw new Error("Writes require both --apply and --confirm-apply.");
}

initializeApp({ projectId });
const db = getFirestore();
const organisationRef = db.collection("organisations").doc(organisationId);
const organisation = await organisationRef.get();
if (!organisation.exists) throw new Error("Organisation was not found; refusing to scan an orphaned tenant subcollection.");

const leadsRef = organisationRef.collection("leads");
const records = [];
let cursor;
let truncated = false;
while (records.length < maxRecords) {
  const requested = Math.min(pageSize, maxRecords - records.length);
  let query = leadsRef.orderBy(FieldPath.documentId()).limit(requested);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  records.push(...page.docs);
  if (page.size < requested) break;
  cursor = page.docs[page.docs.length - 1];
  if (records.length >= maxRecords) {
    // If the budget is exhausted on a full page, conservatively treat the scan
    // as incomplete. A dry run with a larger budget is required before writes.
    truncated = true;
    break;
  }
}

const computed = [];
const malformedRecordIds = [];
const groups = new Map();
function addGroup(type, key, id) {
  if (!key) return;
  const groupKey = JSON.stringify([type, key]);
  const ids = groups.get(groupKey) ?? { type, key, ids: [] };
  ids.ids.push(id);
  groups.set(groupKey, ids);
}
for (const snapshot of records) {
  const data = snapshot.data();
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const website = typeof data.website === "string" ? data.website.trim() : "";
  const businessName = typeof data.businessName === "string" ? data.businessName.trim() : "";
  const location = typeof data.location === "string" ? data.location.trim() : "";
  if (!businessName || (email && !isValidEmailAddress(email)) || (website && !isSafeWebsiteAddress(website))) {
    malformedRecordIds.push(snapshot.id);
    continue;
  }
  let websiteKey = "";
  try {
    websiteKey = website ? canonicalLeadWebsiteKey(website) : "";
  } catch {
    malformedRecordIds.push(snapshot.id);
    continue;
  }
  const emailKey = email ? canonicalLeadEmailKey(email) : "";
  const businessKey = canonicalLeadBusinessLocationKey(businessName, location);
  const expected = {
    dedupeEmailKey: emailKey,
    dedupeWebsiteKey: websiteKey,
    dedupeBusinessLocationKey: businessKey,
  };
  const staleFields = Object.keys(expected).filter((field) => {
    const existing = data[field];
    return existing !== undefined && existing !== null && existing !== "" && existing !== expected[field];
  });
  const missingFields = Object.keys(expected).filter((field) => data[field] === undefined || data[field] === null || data[field] === "");
  computed.push({ ref: snapshot.ref, id: snapshot.id, expected, staleFields, missingFields });
  addGroup("email", emailKey, snapshot.id);
  addGroup("website", websiteKey, snapshot.id);
  addGroup("business-location", businessKey, snapshot.id);
}
const collisions = [...groups.values()]
  .filter((group) => group.ids.length > 1)
  .map((group) => ({
    identifierType: group.type,
    canonicalKeyFingerprint: createHash("sha256").update(group.key).digest("hex"),
    leadIds: [...group.ids].sort(),
  }))
  .sort((a, b) => a.identifierType.localeCompare(b.identifierType) || a.canonicalKeyFingerprint.localeCompare(b.canonicalKeyFingerprint));
const missingCount = computed.reduce((total, row) => total + row.missingFields.length, 0);
const staleCount = computed.reduce((total, row) => total + row.staleFields.length, 0);
const report = {
  mode: apply ? "apply" : "dry-run",
  projectId,
  organisationId,
  scannedRecords: records.length,
  truncated,
  missingKeyFieldCount: missingCount,
  staleKeyFieldCount: staleCount,
  malformedRecordIds: malformedRecordIds.slice(0, 100),
  malformedRecordCount: malformedRecordIds.length,
  collisionGroups: collisions.slice(0, 100),
  collisionGroupCount: collisions.length,
  candidateRecords: computed.filter((row) => row.missingFields.length || row.staleFields.length).length,
  updatedRecords: 0,
};
if (apply && (truncated || malformedRecordIds.length > 0 || collisions.length > 0)) {
  console.log(JSON.stringify(report, null, 2));
  throw new Error("Backfill blocked: scan must be complete and malformed records/canonical collisions must be reviewed first.");
}
if (apply) {
  const candidates = computed.filter((row) => row.missingFields.length || row.staleFields.length);
  for (let offset = 0; offset < candidates.length; offset += 400) {
    const batch = db.batch();
    for (const row of candidates.slice(offset, offset + 400)) batch.update(row.ref, row.expected);
    await batch.commit();
  }
  report.updatedRecords = candidates.length;
}
console.log(JSON.stringify(report, null, 2));
