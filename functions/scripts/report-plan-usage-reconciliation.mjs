import { initializeApp, getApps } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

/**
 * Read-only inventory for planning legacy planUsage reconciliation.
 *
 * By default this only permits the local demo Firestore emulator. To inspect a
 * real project, pass --allow-production-read and authenticate with Application
 * Default Credentials. This script never writes or repairs any documents.
 */
const args = new Set(process.argv.slice(2));
const orgIndex = process.argv.indexOf("--org");
const requestedOrgId = orgIndex >= 0 ? process.argv[orgIndex + 1] : undefined;
const jsonOutput = args.has("--json");
const allowProductionRead = args.has("--allow-production-read");
const configuredProjectId = process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT;
const projectId = configuredProjectId ?? "demo-growth-engine-test";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const isLocalDemoEmulator = projectId === "demo-growth-engine-test"
  && !!emulatorHost
  && /^(127\.0\.0\.1|localhost):8080$/.test(emulatorHost);

if (args.has("--org") && !/^[A-Za-z0-9_-]{1,128}$/.test(requestedOrgId ?? "")) {
  throw new Error("Usage: node report-plan-usage-reconciliation.mjs [--org <organisationId>] [--json] [--allow-production-read]");
}
if (allowProductionRead && (!configuredProjectId || configuredProjectId === "demo-growth-engine-test") && !isLocalDemoEmulator) {
  throw new Error("Set GCLOUD_PROJECT or FIREBASE_PROJECT to the exact intended project before enabling production reads.");
}
if (!isLocalDemoEmulator && !allowProductionRead) {
  throw new Error(
    "Refusing to inspect non-emulator Firestore. Use the demo emulator, or explicitly pass --allow-production-read for a read-only production audit.",
  );
}
if (getApps().length === 0) initializeApp({ projectId });
const db = getFirestore();

async function countDocuments(path) {
  const result = await db.collection(path).count().get();
  return result.data().count;
}

function validCounter(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function usageStateStatus(value) {
  if (value === undefined) return "missing";
  if (!value || typeof value !== "object" || Array.isArray(value)) return "invalid";
  const metrics = ["campaigns", "leads", "members", "monthlyAiSuggestions"];
  if (value.schemaVersion !== 1 || !metrics.every((key) => validCounter(value[key]))
      || typeof value.aiUsagePeriod !== "string"
      || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value.aiUsagePeriod)) return "invalid";
  return "present";
}

async function inspectOrganisation(snapshot) {
  const data = snapshot.data() ?? {};
  const orgId = snapshot.id;
  const [campaigns, leads, members] = await Promise.all([
    countDocuments(`organisations/${orgId}/campaigns`),
    countDocuments(`organisations/${orgId}/leads`),
    countDocuments(`organisations/${orgId}/members`),
  ]);
  const stored = data.planUsage;
  const status = usageStateStatus(stored);
  const mismatches = [];
  if (status === "present") {
    if (stored.campaigns !== campaigns) mismatches.push("campaigns");
    if (stored.leads !== leads) mismatches.push("leads");
    if (stored.members !== members) mismatches.push("members");
  }
  return {
    organisationId: orgId,
    planId: typeof data.planId === "string" ? data.planId : null,
    usageStateStatus: status,
    actual: { campaigns, leads, members },
    stored: status === "present"
      ? {
          schemaVersion: stored.schemaVersion,
          campaigns: stored.campaigns,
          leads: stored.leads,
          members: stored.members,
          monthlyAiSuggestions: stored.monthlyAiSuggestions,
          aiUsagePeriod: stored.aiUsagePeriod,
        }
      : null,
    mismatchedMetrics: mismatches,
    aiUsageReviewRequired: true,
    notes: status === "missing"
      ? ["Legacy usage snapshot missing; do not initialise counters to zero without reconciliation."]
      : status === "invalid"
        ? ["Stored usage snapshot is malformed; operator review required."]
        : [
            "Historical AI suggestion usage cannot be inferred from resource counts; verify the stored monthly counter and period separately.",
            ...(mismatches.length ? ["Stored resource counters differ from current document counts."] : []),
          ],
  };
}

const rows = [];
if (requestedOrgId) {
  const snapshot = await db.doc(`organisations/${requestedOrgId}`).get();
  if (!snapshot.exists) throw new Error(`Organisation not found: ${requestedOrgId}`);
  rows.push(await inspectOrganisation(snapshot));
} else {
  let cursor;
  while (true) {
    let query = db.collection("organisations")
      .orderBy(FieldPath.documentId())
      .limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    const inspected = await Promise.all(page.docs.map(inspectOrganisation));
    rows.push(...inspected);
    cursor = page.docs[page.docs.length - 1];
    if (page.size < 100) break;
  }
}

const summary = {
  mode: "read-only",
  projectId,
  emulator: isLocalDemoEmulator,
  organisationsScanned: rows.length,
  missingUsageState: rows.filter((row) => row.usageStateStatus === "missing").length,
  invalidUsageState: rows.filter((row) => row.usageStateStatus === "invalid").length,
  resourceCounterMismatches: rows.filter((row) => row.mismatchedMetrics.length > 0).length,
  aiUsageReviewRequired: rows.filter((row) => row.aiUsageReviewRequired).length,
  organisations: rows,
};

if (jsonOutput) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log("Plan usage reconciliation inventory (READ ONLY)");
  console.log(`Project: ${projectId}${isLocalDemoEmulator ? " (local emulator)" : " (production read explicitly enabled)"}`);
  console.log(`Organisations scanned: ${summary.organisationsScanned}`);
  console.log(`Missing usage snapshots: ${summary.missingUsageState}`);
  console.log(`Invalid usage snapshots: ${summary.invalidUsageState}`);
  console.log(`Resource counter mismatches: ${summary.resourceCounterMismatches}`);
  console.log(`AI usage review required: ${summary.aiUsageReviewRequired}`);
  for (const row of rows) {
    if (row.usageStateStatus !== "present" || row.mismatchedMetrics.length || row.aiUsageReviewRequired) {
      console.log(JSON.stringify(row));
    }
  }
}
