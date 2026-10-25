import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const callableSource = readFileSync(
  fileURLToPath(new URL("./index.ts", import.meta.url)),
  "utf8",
);

const expectedRateLimitType: Record<string, "read" | "mutation"> = {
  listMyOrganisations: "read",
  previewOrganisationOffboarding: "read",
  createOrganisation: "mutation",
  updateOrganisationSettings: "mutation",
  addOrganisationMember: "mutation",
  removeOrganisationMember: "mutation",
  updateOrganisationMemberRole: "mutation",
  listOrganisationMembers: "read",
  createCampaign: "mutation",
  listCampaigns: "read",
  getCampaignFunnelSummary: "read",
  getLeadSourceFunnelSummary: "read",
  getOnboardingCohortSummary: "read",
  getOrganisationPlanUsage: "read",
  getOrganisationPlanUsageReconciliation: "read",
  updateCampaignStatus: "mutation",
  updateCampaignDetails: "mutation",
  listLeads: "read",
  getLeadActivityTimeline: "read",
  createLead: "mutation",
  importLeads: "mutation",
  updateLeadContact: "mutation",
  updateLeadStatus: "mutation",
  updateLeadNotes: "mutation",
  setLeadSuppression: "mutation",
  suggestOutreachDraft: "read",
  createOutreachDraft: "mutation",
  listOutreachDrafts: "read",
  updateOutreachDraft: "mutation",
  deleteOutreachDraft: "mutation",
};

describe("callable security contract", () => {
  it("authorises member additions and reserves member quota in the same transaction", () => {
    const start = callableSource.indexOf("export const addOrganisationMember =");
    const end = callableSource.indexOf("export const createCampaign =", start);
    const callable = callableSource.slice(start, end);
    expect(callable).toContain('requireTransactionalRole(transaction, organisationId, uid, "campaign")');
    expect(callable).toContain('reserveOrganisationPlanUsage(transaction, organisationId, "members", 1)');
    expect(callable).toContain('consumeTransactionalRateLimit(transaction, organisationId, uid, "addOrganisationMember", 30)');
    expect(callable).toContain("transaction.update(organisationRef, { planUsage: reservedPlanUsageState })");
    expect(callable.indexOf("transaction.update(organisationRef, { planUsage: reservedPlanUsageState })"))
      .toBeLessThan(callable.indexOf("transaction.create(targetMembershipRef"));
    expect(callable).toContain('role !== "member" && role !== "viewer"');
    expect(callable).toContain("memberAdditionIdempotency");
    expect(callable).toContain("getUserByEmail(targetEmail)");
    expect(callable).toContain('writeSecurityAuditEvent(transaction, organisationId, uid, "organisation.member_added"');
  });


  it("keeps lead activity history tenant-scoped, bounded, and privacy-minimised", () => {
    const start = callableSource.indexOf("export const getLeadActivityTimeline =");
    const end = callableSource.indexOf("export const getCampaignFunnelSummary =", start);
    const callable = callableSource.slice(start, end);
    expect(callable).toContain("requireMembership(organisationId, uid)");
    expect(callable).toContain('consumeReadRateLimit(organisationId, uid, "getLeadActivityTimeline", 30)');
    expect(callable).toContain('collection("leadActivities")');
    expect(callable).toContain('.where("leadId", "==", leadId)');
    expect(callable).toContain('.orderBy("createdAt", "desc")');
    expect(callable).toContain(".limit(21)");
    expect(callable).toContain("snapshot.docs.slice(0, 20)");
    expect(callable).not.toContain("actorUid:");
    expect(callable).not.toContain("email:");
    expect(callable).not.toContain("phone:");
  });

  it("reserves campaign quota atomically for organisations with authoritative usage state", () => {
    const campaignStart = callableSource.indexOf("export const createCampaign =");
    const campaignEnd = callableSource.indexOf("export const listCampaigns =", campaignStart);
    const campaignCallable = callableSource.slice(campaignStart, campaignEnd);
    expect(campaignCallable).toContain("resolvePlanPolicy(organisationData.planId)");
    expect(campaignCallable).toContain("resolvePlanUsageState(organisationData.planUsage, new Date())");
    expect(campaignCallable).toContain('reservePlanUsage(planResolutionForQuota.plan, usageStateForQuota.state, "campaigns")');
    expect(campaignCallable).toContain('new HttpsError("resource-exhausted"');
    expect(campaignCallable).toContain("transaction.update(organisationRef, { planUsage: reservedPlanUsageState })");
    expect(campaignCallable.indexOf("transaction.update(organisationRef, { planUsage: reservedPlanUsageState })"))
      .toBeLessThan(campaignCallable.indexOf("transaction.create(campaign,"));
    expect(campaignCallable).toContain("Object.prototype.hasOwnProperty.call(organisationData, \"planUsage\")");
    expect(campaignCallable).toContain("Legacy organisations without a usage snapshot remain on the compatibility");
  });

  it("reserves lead quota atomically for manual creation and only newly imported leads", () => {
    const createStart = callableSource.indexOf("export const createLead =");
    const createEnd = callableSource.indexOf("export const listLeads =", createStart);
    const createCallable = callableSource.slice(createStart, createEnd);
    expect(createCallable).toContain('reserveOrganisationPlanUsage(transaction, organisationId, "leads", 1)');
    expect(createCallable).toContain("transaction.update(organisationRef, { planUsage: reservedPlanUsageState })");
    expect(createCallable.indexOf("transaction.update(organisationRef, { planUsage: reservedPlanUsageState })"))
      .toBeLessThan(createCallable.indexOf("transaction.create(lead,"));

    const importStart = callableSource.indexOf("export const importLeads =");
    const importEnd = callableSource.indexOf("export const", importStart + 1);
    const importCallable = callableSource.slice(importStart, importEnd);
    expect(importCallable).toContain("const rowsToImport: typeof prepared = []");
    expect(importCallable).toContain('reserveOrganisationPlanUsage(transaction, organisationId, "leads", rowsToImport.length)');
    expect(importCallable).toContain("transaction.update(organisationRef, { planUsage: reservedPlanUsageState })");
    expect(importCallable.indexOf("transaction.update(organisationRef, { planUsage: reservedPlanUsageState })"))
      .toBeLessThan(importCallable.indexOf("transaction.create(leadRef,"));
    expect(importCallable).toContain("for (const row of rowsToImport)");
  });

  it("reserves monthly AI suggestion quota before calling the external model", () => {
    const start = callableSource.indexOf("export const suggestOutreachDraft =");
    const end = callableSource.indexOf("export const listOutreachDrafts =", start);
    const callable = callableSource.slice(start, end);
    expect(callable).toContain('transaction, organisationId, "monthlyAiSuggestions", 1');
    expect(callable.indexOf("reserveOrganisationPlanUsage("))
      .toBeLessThan(callable.indexOf("generateAiOutreachDraftSuggestion("));
    expect(callable).toContain("transaction.update(organisationRef, { planUsage: reservedPlanUsageState })");
  });

  it("enforces App Check on every deployed callable and only bypasses it in the Functions emulator", () => {
    expect(callableSource).toContain('const callableOptions = { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" }');
    expect((callableSource.match(/= onCall\(callableOptions, async \(request\) => \{/g) ?? [])).toHaveLength(28);
    expect(callableSource.includes("= onCall(async (request) => {")).toBe(false);
  });

  it("requires the same production App Check enforcement for every inline callable options object", () => {
    // Most callables share callableOptions. Any future inline options must keep
    // the exact emulator-only bypass; merely including enforceAppCheck: false
    // must not satisfy this security contract.
    const inlineCallables = [...callableSource.matchAll(
      /export const (\w+) = onCall\(\s*(\{[^}]*\})/gs,
    )];

    for (const [, callableName, options] of inlineCallables) {
      expect(
        options,
        `${callableName} must enforce App Check outside the Functions emulator`,
      ).toContain('enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true"');
    }

    expect(callableSource).not.toMatch(
      /export const \w+ = onCall\(\s*\{(?![^}]*enforceAppCheck)/s,
    );
  });

  it("enforces an event-specific audit metadata allow-list and resource mapping", () => {
    expect(callableSource).toContain("const AUDIT_EVENT_RESOURCE_TYPES:");
    expect(callableSource).toContain("const AUDIT_METADATA_KEYS:");
    expect(callableSource).toContain('"lead.contact_updated": ["contactChannelsChanged", "contactReviewRevision", "contactReviewStatus", "doNotContact"]');
    expect(callableSource).toContain('"lead.contact_restriction_changed": ["doNotContact", "contactReviewRevision", "contactReviewStatus"]');
    expect(callableSource).toContain("function isBoundedAuditMetadata(");
    expect(callableSource).toContain("Object.keys(metadata).some((key) => !allowedKeys.includes");
    expect(callableSource).toContain("Number.isSafeInteger(metadata.importedCount)");
    expect(callableSource).toContain('throw new Error("Invalid security audit event resource or metadata contract.")');
    expect(callableSource).toContain('["new", "reviewing", "qualified", "contacted", "onboarded", "rejected"]');
    expect(callableSource).toContain('["active", "paused", "completed"]');
  });

  it("keeps the audit event catalogue, resource map, metadata map, and callsites aligned", () => {
    const typeStart = callableSource.indexOf("type SecurityAuditEventType =");
    const typeEnd = callableSource.indexOf("type SecurityAuditEventMetadata =", typeStart);
    expect(typeStart).toBeGreaterThanOrEqual(0);
    expect(typeEnd).toBeGreaterThan(typeStart);
    const typeBlock = callableSource.slice(typeStart, typeEnd);
    const eventTypes = [...typeBlock.matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g)]
      .map((match) => match[1]);
    expect(eventTypes.length).toBeGreaterThan(0);
    expect(new Set(eventTypes).size).toBe(eventTypes.length);

    const resourceMapStart = callableSource.indexOf("const AUDIT_EVENT_RESOURCE_TYPES:");
    const metadataMapStart = callableSource.indexOf("const AUDIT_METADATA_KEYS:");
    const validatorStart = callableSource.indexOf("function isBoundedAuditMetadata(");
    expect(resourceMapStart).toBeGreaterThan(typeEnd);
    expect(metadataMapStart).toBeGreaterThan(resourceMapStart);
    expect(validatorStart).toBeGreaterThan(metadataMapStart);
    const resourceMap = callableSource.slice(resourceMapStart, metadataMapStart);
    const metadataMap = callableSource.slice(metadataMapStart, validatorStart);
    const resourceEvents = [...resourceMap.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]);
    const metadataEvents = [...metadataMap.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]);
    expect(resourceEvents.sort()).toEqual([...eventTypes].sort());
    expect(metadataEvents.sort()).toEqual([...eventTypes].sort());

    const auditCalls = [...callableSource.matchAll(/writeSecurityAuditEvent\(transaction,\s*[^,]+,\s*[^,]+,\s*"([^"]+)",\s*"([^"]+)"/g)];
    const callPairs = new Set(auditCalls.map((match) => `${match[1]}|${match[2]}`));
    expect(auditCalls.length).toBe(17);
    for (const [eventType, resourceType] of [
      ["organisation.created", "organisation"],
      ["organisation.settings_updated", "organisation"],
      ["organisation.member_added", "organisation"],
      ["organisation.member_removed", "organisation"],
      ["organisation.member_role_updated", "organisation"],
      ["lead.csv_import.completed", "campaign"],
      ["lead.contact_updated", "lead"],
      ["lead.contact_restriction_changed", "lead"],
      ["lead.created", "lead"],
      ["campaign.created", "campaign"],
      ["campaign.status_changed", "campaign"],
      ["campaign.details_updated", "campaign"],
      ["lead.status_changed", "lead"],
      ["lead.notes_changed", "lead"],
      ["outreach_draft.created", "outreachDraft"],
      ["outreach_draft.updated", "outreachDraft"],
      ["outreach_draft.deleted", "outreachDraft"],
    ]) {
      expect(callPairs.has(`${eventType}|${resourceType}`), `${eventType} resource mapping`).toBe(true);
    }
  });

  it("stores canonical duplicate identifiers and uses bounded lookups without lowercasing URL paths", () => {
    expect(callableSource).toContain("const dedupeEmailKey = canonicalLeadEmailKey(email);");
    expect(callableSource).toContain("canonicalLeadEmailKey, canonicalLeadWebsiteKey");
    expect(callableSource).toContain("const dedupeWebsiteKey = canonicalLeadWebsiteKey(website);");
    expect(callableSource).toContain('leadsRef.where("dedupeEmailKey", "==", email).limit(1)');
    expect(callableSource).toContain('leadsRef.where("dedupeWebsiteKey", "==", website).limit(1)');
    expect(callableSource).toContain('leadsRef.where("email", "==", email).limit(1)');
    expect(callableSource).toContain('leadsRef.where("website", "==", website).limit(1)');
    expect(callableSource).toContain("URL path casing remains significant.");
    expect(callableSource).toContain("never scan an unbounded tenant collection");
    expect(callableSource).toContain("emailKey: fields.dedupeEmailKey,");
    expect(callableSource).toContain("websiteKey: fields.dedupeWebsiteKey,");
    expect(callableSource).not.toContain("duplicateInBatch");
    expect(callableSource).toContain("if (row.emailKey) existingEmails.add(row.emailKey);");
    expect(callableSource).toContain("if (row.websiteKey) existingWebsites.add(row.websiteKey);");
    expect(callableSource).toContain("existingBusinesses.add(row.businessKey);");
  });

  it("keeps emulator unauthenticated coverage aligned with every callable export", () => {
    const smokeSource = readFileSync(
      fileURLToPath(new URL("../../scripts/emulator-smoke-test.mjs", import.meta.url)),
      "utf8",
    );
    const match = smokeSource.match(
      /const unauthenticatedCallableNames = \[([\s\S]*?)\n\s*\];/,
    );
    expect(match, "emulator smoke test must declare unauthenticated callable coverage").not.toBeNull();
    const coveredNames = [...(match?.[1] ?? "").matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)]
      .map((item) => item[1])
      .sort();
    expect(coveredNames).toEqual(Object.keys(expectedRateLimitType).sort());
  });

  it("keeps Firestore client access deny-by-default until narrowly reviewed rules are added", () => {
    const rulesSource = readFileSync(
      fileURLToPath(new URL("../../firestore.rules", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    const allowStatements = [...rulesSource.matchAll(/\ballow\s+[^;]+;/g)]
      .map((match) => match[0].replace(/\s+/g, " ").trim());

    expect(allowStatements).toEqual(["allow read, write: if false;"]);
  });

  it("creates leads with contact restrictions enabled until explicit review", () => {
    const start = callableSource.indexOf("export const createLead = onCall(");
    const nextStart = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

    expect(body).toContain("doNotContact: true");
    expect(body).toContain('contactReviewStatus: "pending"');
    expect(body).toContain("contactReviewRevision: 0");
    expect(body).toContain('status: "new"');
  });

  it("validates the original actor before replaying organisation creation", () => {
    const start = callableSource.indexOf("export const createOrganisation = onCall(");
    const nextStart = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

    expect(body).toContain("saved.actorUid !== uid");
    expect(body).toContain("savedOrganisation.data()?.ownerUid !== uid");
    expect(body).toContain("savedMembership.data()?.role !== \"owner\"");
    expect(body).toContain("isValidMembershipForOrganisation(savedMembership.data(), uid, savedOrganisation.data()?.ownerUid)");
    expect(body.indexOf("saved.actorUid !== uid")).toBeLessThan(body.indexOf("const savedResult = saved.result as Record<string, unknown>;"));
  });

  it("validates the saved campaign and original creator before returning an idempotent replay", () => {
    const start = callableSource.indexOf("export const createCampaign = onCall(");
    const nextStart = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

    expect(body).toContain("const savedResult = saved.result as Record<string, unknown>;");
    expect(body).toContain('saved.actorUid !== uid');
    expect(body).toContain('collection("campaigns").doc(savedResult.campaignId)');
    expect(body).toContain("await transaction.get(savedCampaignRef)");
    expect(body).toContain("savedCampaign.createdBy !== uid");
    expect(body).toContain('new HttpsError("failed-precondition", "The campaign created by this request is no longer available to its original creator.")');
    expect(body.indexOf("await transaction.get(savedCampaignRef)")).toBeLessThan(body.indexOf("return savedResult as typeof result;"));
  });

  it("validates saved CSV import retry ownership, result totals, suppression flags, and campaign existence", () => {
    const start = callableSource.indexOf("export const importLeads = onCall(");
    const nextStart = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

    expect(body).toContain("saved.actorUid !== uid");
    expect(body).toContain("savedResult.organisationId !== organisationId");
    expect(body).toContain("savedResult.campaignId !== campaignId");
    expect(body).toContain("savedResult.received !== prepared.length");
    expect(body).toContain("(savedResult.imported as number) + (savedResult.duplicatesSkipped as number) !== prepared.length");
    expect(body).toContain("savedLeads.length !== savedResult.imported");
    expect(body).toContain("savedResult.sent !== false");
    expect(body).toContain("savedResult.messageSentByThisAction !== false");
    expect(body).toContain("await transaction.get(campaignRef)");
    expect(body).toContain('new HttpsError("failed-precondition", "Saved import retry state is invalid and requires operator review.")');
  });

  it("requires durable idempotency for CSV imports", () => {
    const start = callableSource.indexOf("export const importLeads = onCall(");
    const nextStart = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);
    expect(body).toContain("data.idempotencyKey");
    expect(body).toContain('collection("importIdempotency")');
    expect(body).toContain("saved.requestHash !== requestHash");
    expect(body).toContain('new HttpsError("already-exists"');
    expect(body).toContain("transaction.create(idempotencyRef");
    const smokeSource = readFileSync(
      fileURLToPath(new URL("../../scripts/emulator-smoke-test.mjs", import.meta.url)),
      "utf8",
    );
    expect(smokeSource).toContain("replaying an import returns the original result");
    expect(smokeSource).toContain("rejects reuse of an idempotency key with a different payload");
  });

  it("writes a minimal server-side audit event atomically for a successful CSV import", () => {
    const start = callableSource.indexOf("export const importLeads = onCall(");
    const nextStart = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);
    expect(callableSource).toContain('collection("securityAuditEvents")');
    expect(callableSource).toContain("type SecurityAuditEventType =");
    expect(callableSource).toContain('"lead.csv_import.completed"');
    expect(body).toContain('writeSecurityAuditEvent(transaction, organisationId, uid, "lead.csv_import.completed"');
    expect(body).toContain("importedCount: newLeads.length");
    expect(body).toContain("duplicatesSkipped: duplicateCount");
    expect(body.indexOf("transaction.create(idempotencyRef")).toBeLessThan(
      body.indexOf('writeSecurityAuditEvent(transaction, organisationId, uid, "lead.csv_import.completed"'),
    );
  });

  it("audits contact edits and restriction changes atomically without storing contact details", () => {
    const contactStart = callableSource.indexOf("export const updateLeadContact = onCall(");
    const contactEnd = callableSource.indexOf("export const ", contactStart + 1);
    const contactBody = callableSource.slice(contactStart, contactEnd < 0 ? callableSource.length : contactEnd);
    expect(contactBody).toContain('writeSecurityAuditEvent(transaction, organisationId, uid, "lead.contact_updated", "lead", leadId');
    expect(contactBody).toContain("contactChannelsChanged");
    expect(contactBody).toContain("contactReviewRevision: nextContactReviewRevision");
    expect(contactBody).not.toContain("email: fields.email");
    expect(contactBody).not.toContain("phone: fields.phone");

    const suppressionStart = callableSource.indexOf("export const setLeadSuppression = onCall(");
    const suppressionEnd = callableSource.indexOf("export const ", suppressionStart + 1);
    const suppressionBody = callableSource.slice(suppressionStart, suppressionEnd < 0 ? callableSource.length : suppressionEnd);
    expect(suppressionBody).toContain('writeSecurityAuditEvent(transaction, organisationId, uid, "lead.contact_restriction_changed", "lead", leadId');
    expect(suppressionBody).toContain("doNotContact: data.doNotContact");
    expect(suppressionBody).toContain('contactReviewStatus: data.doNotContact ? "blocked" : "cleared"');
    expect(callableSource).toContain('| "lead.contact_updated"');
    expect(callableSource).toContain('| "lead.contact_restriction_changed"');
  });

  it("audits sensitive campaign, lead-status, notes, and draft mutations without recording note or draft content", () => {
    const expectations = [
      ["createOrganisation", 'writeSecurityAuditEvent(transaction, organisation.id, uid, "organisation.created", "organisation"'],
      ["createLead", 'writeSecurityAuditEvent(transaction, organisationId, uid, "lead.created", "lead"'],
      ["createCampaign", 'writeSecurityAuditEvent(transaction, organisationId, uid, "campaign.created", "campaign"'],
      ["updateCampaignStatus", 'writeSecurityAuditEvent(transaction, organisationId, uid, "campaign.status_changed", "campaign"'],
      ["updateLeadStatus", 'writeSecurityAuditEvent(transaction, organisationId, uid, "lead.status_changed", "lead"'],
      ["updateLeadNotes", 'writeSecurityAuditEvent(transaction, organisationId, uid, "lead.notes_changed", "lead"'],
      ["createOutreachDraft", 'writeSecurityAuditEvent(transaction, organisationId, uid, "outreach_draft.created", "outreachDraft"'],
      ["updateOutreachDraft", 'writeSecurityAuditEvent(transaction, organisationId, uid, "outreach_draft.updated", "outreachDraft"'],
      ["deleteOutreachDraft", 'writeSecurityAuditEvent(transaction, organisationId, uid, "outreach_draft.deleted", "outreachDraft"'],
    ] as const;

    for (const [name, expectedAuditCall] of expectations) {
      const start = callableSource.indexOf(`export const ${name} = onCall(`);
      expect(start, `${name} callable must exist`).toBeGreaterThanOrEqual(0);
      const nextStart = callableSource.indexOf("export const ", start + 1);
      const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);
      expect(body, `${name} audit event`).toContain(expectedAuditCall);
    }

    const notesStart = callableSource.indexOf("export const updateLeadNotes = onCall(");
    const notesEnd = callableSource.indexOf("export const ", notesStart + 1);
    const notesBody = callableSource.slice(notesStart, notesEnd);
    expect(notesBody).toContain("notesCleared: notes.length === 0");
    expect(notesBody).not.toContain("notes: notes");

    const createDraftStart = callableSource.indexOf("export const createOutreachDraft = onCall(");
    const createDraftEnd = callableSource.indexOf("export const ", createDraftStart + 1);
    const createDraftBody = callableSource.slice(createDraftStart, createDraftEnd);
    expect(createDraftBody).toContain('draftAction: "created"');
    expect(createDraftBody).not.toContain("subject: subject, body: body");
    for (const eventType of [
      '"organisation.created"',
      '"lead.created"',
      '"campaign.created"',
      '"campaign.status_changed"',
      '"lead.status_changed"',
      '"lead.notes_changed"',
      '"outreach_draft.created"',
      '"outreach_draft.updated"',
      '"outreach_draft.deleted"',
    ]) {
      expect(callableSource).toContain(eventType);
    }
  });

  it("keeps outreach operations draft-only", () => {
    for (const name of ["createOutreachDraft", "updateOutreachDraft", "deleteOutreachDraft"]) {
      const start = callableSource.indexOf(`export const ${name} = onCall(`);
      expect(start, `${name} must remain an explicit callable export`).toBeGreaterThanOrEqual(0);
      const nextStart = callableSource.indexOf("export const ", start + 1);
      const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);
      expect(body, `${name} must explicitly report that no message was sent`).toContain("sent: false");
    }
    expect(Object.keys(expectedRateLimitType)).not.toContain("sendOutreach");
  });

  it("allows tenant-authorized cleanup of malformed legacy outreach records without implying delivery", () => {
    const start = callableSource.indexOf("export const deleteOutreachDraft = onCall(");
    const nextStart = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

    expect(body).toContain('await requireTransactionalRole(transaction, organisationId, uid, "lead")');
    expect(body).toContain('if (!draftSnapshot.exists) throw new HttpsError("not-found"');
    expect(body).toContain("const rawLeadId = draftSnapshot.data()?.leadId");
    expect(body).toContain("const leadId = isValidDocumentId(rawLeadId) ? rawLeadId : null");
    expect(body).toContain("transaction.delete(draftRef)");
    expect(body).toContain('writeSecurityAuditEvent(transaction, organisationId, uid, "outreach_draft.deleted", "outreachDraft", draftId, { draftAction: "deleted" })');
    expect(body).toContain("Malformed outreach record deleted; this action did not send a message");
    expect(body).toContain("Outreach record deleted; this action did not send a message");
    expect(body).toContain("return { draftId, deleted: true, sent: false, messageSentByThisAction: false }");
    expect(body).not.toContain("transaction.get(leadRef)");
    expect(body).not.toContain("sendOutreach");
  });

  it("keeps manual lead, campaign, and organisation creation retry-safe", () => {
    const creationContracts = [
      ["createOrganisation", 'collection("organisationCreationIdempotency")', "organisation payload"],
      ["createCampaign", 'collection("campaignCreationIdempotency")', "campaign payload"],
      ["createLead", 'collection("leadCreationIdempotency")', "lead payload"],
    ] as const;

    for (const [name, idempotencyCollection, payloadLabel] of creationContracts) {
      const start = callableSource.indexOf(`export const ${name} = onCall(`);
      expect(start, `${name} callable must exist`).toBeGreaterThanOrEqual(0);
      const nextStart = callableSource.indexOf("export const ", start + 1);
      const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

      expect(body, `${name} must require a bounded retry key`).toContain("data.idempotencyKey");
      expect(body, `${name} must bind the key to a payload fingerprint`).toContain("requestHash");
      expect(body, `${name} must store retry state`).toContain(idempotencyCollection);
      expect(body, `${name} must reject key reuse with a changed payload`).toContain("saved.requestHash !== requestHash");
      expect(body, `${name} must commit retry state atomically`).toContain("transaction.create(idempotencyRef");
      expect(body, `${name} must reject conflicting payloads`).toContain('new HttpsError("already-exists"');
    }
  });

  it("keeps every expected callable authenticated and rate-limited", () => {
    const declarations = [...callableSource.matchAll(/export const (\w+) = onCall\(/g)];
    expect(declarations.map((match) => match[1]).sort()).toEqual(
      Object.keys(expectedRateLimitType).sort(),
    );

    for (let index = 0; index < declarations.length; index += 1) {
      const declaration = declarations[index];
      const start = declaration.index ?? 0;
      const end = declarations[index + 1]?.index ?? callableSource.length;
      const body = callableSource.slice(start, end);
      const name = declaration[1];

      expect(body, `${name} must require an authenticated UID`).toContain(
        "requireUid(request.auth?.uid)",
      );

      const expectedHelper = expectedRateLimitType[name] === "read"
        ? "consumeReadRateLimit("
        : "consumeTransactionalRateLimit(";
      expect(body, `${name} must use ${expectedHelper}`).toContain(expectedHelper);
      expect(body, `${name} must pass its own operation name to the limiter`).toContain(
        `"${name}"`,
      );

      if (expectedRateLimitType[name] === "mutation") {
        expect(body, `${name} must commit its protected mutation transactionally`).toContain(
          "db.runTransaction(",
        );
        if (name !== "createOrganisation") {
          expect(body, `${name} must revalidate role inside the transaction`).toContain(
            "requireTransactionalRole(transaction,",
          );
        }
      }
    }
  });
});


  it("authorizes tenant-scoped list calls before consuming quota or reading tenant collections", () => {
    for (const callableName of ["listCampaigns", "listLeads", "listOutreachDrafts"]) {
      const start = callableSource.indexOf(`export const ${callableName} = onCall(`);
      expect(start, `${callableName} callable must exist`).toBeGreaterThanOrEqual(0);
      const nextStart = callableSource.indexOf("export const ", start + 1);
      const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);
      const membershipCheck = body.indexOf("await requireMembership(organisationId, uid)");
      const quotaCheck = body.indexOf("await consumeReadRateLimit(organisationId, uid");
      expect(membershipCheck, `${callableName} must validate tenant membership`).toBeGreaterThanOrEqual(0);
      expect(quotaCheck, `${callableName} must consume a tenant-scoped read quota`).toBeGreaterThan(membershipCheck);
      const collectionRead = body.search(/\.collection\(["'][^"']+["']\)/);
      expect(collectionRead, `${callableName} must read a tenant collection`).toBeGreaterThan(quotaCheck);
    }
  });

  it("rechecks tenant membership and role inside every tenant-scoped mutation transaction", () => {
    for (const callableName of Object.keys(expectedRateLimitType).filter(
      (name) => expectedRateLimitType[name] === "mutation" && name !== "createOrganisation",
    )) {
      const start = callableSource.indexOf(`export const ${callableName} = onCall(`);
      expect(start, `${callableName} callable must exist`).toBeGreaterThanOrEqual(0);
      const nextStart = callableSource.indexOf("export const ", start + 1);
      const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);
      expect(
        body,
        `${callableName} must revalidate authoritative membership inside its transaction`,
      ).toMatch(/requireTransactionalRole\(transaction,\s*organisationId,\s*uid,/);
    }
  });

it("revalidates organisation-list cursors and filters stale or mismatched memberships", () => {
  const start = callableSource.indexOf("export const listMyOrganisations = onCall(");
  const nextStart = callableSource.indexOf("export const ", start + 1);
  const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

  expect(body).toContain("isValidOrganisationPageToken(data.pageToken, uid)");
  expect(body).toContain('cursor.id !== uid');
  expect(body).toContain("cursorMembership.uid !== uid");
  expect(body).toContain("const cursorOrganisation = await cursorOrganisationRef.get()");
  expect(body).toContain("isValidMembershipForOrganisation(cursorMembership, uid, cursorOrganisation.data()?.ownerUid)");
  expect(body).toContain("const memberships = await membershipQuery.limit(101).get()");
  expect(body).toContain("memberships.docs.slice(0, 100)");
  expect(body).toContain("membershipDoc.id !== uid || !isValidMembershipForOrganisation(membership, uid, organisation.data()?.ownerUid)");
  expect(body).toContain("organisations.filter((item): item is NonNullable<typeof item> => item !== null)");
  expect(body).toContain("nextPageToken: hasMoreOrganisations ? page[page.length - 1]?.ref.path ?? null : null");
});

it("validates tenant list pagination tokens against the requested organisation and collection", () => {
  const listCallables = [
    ["listCampaigns", "campaigns", "Campaign"],
    ["listLeads", "leads", "Lead"],
    ["listOutreachDrafts", "outreachDrafts", "Outreach draft"],
  ] as const;

  for (const [callableName, collectionName, label] of listCallables) {
    const start = callableSource.indexOf(`export const ${callableName} = onCall(`);
    expect(start, `${callableName} callable must exist`).toBeGreaterThanOrEqual(0);
    const nextStart = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

    expect(body).toContain(
      `isValidOrganisationCollectionPageToken(data.pageToken, organisationId, "${collectionName}")`,
    );
    expect(body).toContain(`"${label} page token is invalid for this organisation."`);
    expect(body).toContain("const cursor = await db.doc(data.pageToken).get()");
    expect(body).toContain("!cursor.exists || !isValidFirestoreTimestamp(cursor.data()?.createdAt)");
    expect(body).toContain(`"${label} page token is no longer valid."`);
    expect(body).toContain("cursorSnapshot = cursor as QueryDocumentSnapshot");
    expect(body).toContain(".startAfter(cursorSnapshot)");
    expect(body).toContain(".limit(101).get()");
    expect(body).toContain("snapshot.docs.slice(0, 100)");
    expect(body).toContain(`nextPageToken: snapshot.size > 100 ? page[page.length - 1]?.ref.path ?? null : null`);
  }
});



it("revalidates lead suppression and campaign integrity inside outreach draft transactions", () => {
  const createStart = callableSource.indexOf("export const createOutreachDraft = onCall(");
  const createEnd = callableSource.indexOf("export const ", createStart + 1);
  const createBody = callableSource.slice(createStart, createEnd < 0 ? callableSource.length : createEnd);
  expect(createBody).toContain("await requireTransactionalRole(transaction, organisationId, uid, \"lead\")");
  expect(createBody).toContain("const leadSnapshot = await transaction.get(leadRef)");
  expect(createBody).toContain("canCreateServerOutreachDraft(lead.doNotContact, lead.contactReviewStatus)");
  expect(createBody).toContain("const campaignSnapshot = await transaction.get(campaignRef)");
  expect(createBody).toContain("if (!campaignSnapshot.exists)");
  expect(createBody).toContain("transaction.create(draft,");
  expect(createBody).toContain('status: "draft", sent: false, createdBy: uid');
  expect(createBody).toContain("sent: false");

  const updateStart = callableSource.indexOf("export const updateOutreachDraft = onCall(");
  const updateEnd = callableSource.indexOf("export const ", updateStart + 1);
  const updateBody = callableSource.slice(updateStart, updateEnd < 0 ? callableSource.length : updateEnd);
  expect(updateBody).toContain("await requireTransactionalRole(transaction, organisationId, uid, \"lead\")");
  expect(updateBody).toContain('if (draft.status !== "draft" || draft.sent !== false)');
  expect(updateBody).toContain("hasConsistentDraftCampaign(draft.campaignId, lead.campaignId)");
  expect(updateBody).toContain("canCreateServerOutreachDraft(lead.doNotContact, lead.contactReviewStatus)");
  expect(updateBody).toContain("const campaignSnapshot = await transaction.get(campaignRef)");
  expect(updateBody).toContain("if (!campaignSnapshot.exists)");
  expect(updateBody).toContain("transaction.update(draftRef,");
  expect(updateBody).toContain("sent: false");

  const listStart = callableSource.indexOf("export const listOutreachDrafts = onCall(");
  const listEnd = callableSource.indexOf("export const ", listStart + 1);
  const listBody = callableSource.slice(listStart, listEnd < 0 ? callableSource.length : listEnd);
  expect(listBody).toContain('const draftStatusValid = draft.status === "draft" && draft.sent === false');
  expect(listBody).toContain("Draft status or sent flag is inconsistent; review the record before use.");
  expect(listBody).toContain("leadSuppressed: leadExists && (lead?.doNotContact === true || lead?.contactReviewStatus === \"blocked\")");
  expect(listBody).toContain("Lead is suppressed and the draft integrity check failed; do not contact.");
  expect(listBody).toContain("Integrity warnings must never mask suppression.");
  expect(listBody).toContain("const review = relationshipValid");

});


it("keeps CSV imports bounded, atomic, tenant-authorized, idempotent, and suppressed by default", () => {
  const start = callableSource.indexOf("export const importLeads = onCall(");
  const nextStart = callableSource.indexOf("export const ", start + 1);
  const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

  expect(body).toContain("data.leads.length < 1 || data.leads.length > 25");
  expect(body).toContain("data.leads.map((value, index) =>");
  expect(body).toContain("Validate the complete payload before any writes");
  expect(body).toContain("await requireLeadEditor(organisationId, uid)");
  expect(body).toContain("await requireTransactionalRole(transaction, organisationId, uid, \"lead\")");
  expect(body).toContain("const campaignSnapshot = await transaction.get(campaignRef)");
  expect(body).toContain('new HttpsError("not-found", "Campaign was not found in this organisation.")');
  expect(body).toContain("const idempotencySnapshot = await transaction.get(idempotencyRef)");
  expect(body).toContain("saved.requestHash !== requestHash");
  expect(body).toContain("await consumeTransactionalRateLimit(transaction, organisationId, uid, \"importLeads\", 10)");
  expect(body).toContain("transaction.create(leadRef,");
  expect(body).toContain("transaction.create(idempotencyRef,");
  expect(body).toContain("doNotContact: true");
  expect(body).toContain('contactReviewStatus: "pending"');
  expect(body).toContain("contactReviewRevision: 0");
  expect(body).toContain("source: sourceLabel");
  expect(body).toContain("sent: false as const");
  expect(body).toContain("messageSentByThisAction: false as const");
  expect(body).toContain('writeSecurityAuditEvent(transaction, organisationId, uid, "lead.csv_import.completed"');

  const writesIndex = body.indexOf("transaction.create(leadRef,");
  const validationIndex = body.indexOf("const rows = data.leads.map");
  expect(validationIndex).toBeGreaterThanOrEqual(0);
  expect(writesIndex).toBeGreaterThan(validationIndex);
  expect(body.indexOf("transaction.create(idempotencyRef,")).toBeLessThan(
    body.indexOf('writeSecurityAuditEvent(transaction, organisationId, uid, "lead.csv_import.completed"'),
  );
});


it("forces renewed contact review whenever contact channels change and preserves blocked leads", () => {
  const start = callableSource.indexOf("export const updateLeadContact = onCall(");
  const nextStart = callableSource.indexOf("export const ", start + 1);
  const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

  expect(body).toContain("const contactChannelsChanged = fields.email !== existingLead.email");
  expect(body).toContain("|| fields.phone !== existingLead.phone");
  expect(body).toContain("|| fields.website !== existingLead.website");
  expect(body).toContain("currentContactReviewRevision >= Number.MAX_SAFE_INTEGER");
  expect(body).toContain("const nextContactReviewRevision = currentContactReviewRevision + (contactChannelsChanged ? 1 : 0)");
  expect(body).toContain('existingReviewStatus === "blocked"');
  expect(body).toContain('{ doNotContact: true, contactReviewStatus: "blocked" as const }');
  expect(body).toContain('{ doNotContact: true, contactReviewStatus: "pending" as const }');
  expect(body).toContain("const nextDoNotContact = contactChannelsChanged");
  expect(body).toContain(": existingLead.doNotContact === true || existingReviewStatus === \"blocked\"");
  expect(body).toContain("contactChannelsChanged ? nextDoNotContact : existingLead.doNotContact");
  expect(body).toContain("contactChannelsChanged ? restrictionUpdate.contactReviewStatus : existingLead.contactReviewStatus");
  expect(body).toContain("contactRestrictionVerified: !contactChannelsChanged");
  expect(body).toContain("contactReviewRevision: nextContactReviewRevision");
  expect(body).toContain("transaction.update(leadRef, { ...fields, ...restrictionUpdate, contactReviewRevision: nextContactReviewRevision");
});

it("requires a current contact-review revision before clearing lead suppression", () => {
  const start = callableSource.indexOf("export const setLeadSuppression = onCall(");
  const nextStart = callableSource.indexOf("export const ", start + 1);
  const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

  expect(body).toContain("if (typeof data.doNotContact !== \"boolean\")");
  expect(body).toContain("!data.doNotContact && (typeof data.contactReviewRevision !== \"number\" || !Number.isSafeInteger(data.contactReviewRevision) || data.contactReviewRevision < 0)");
  expect(body).toContain("await requireTransactionalRole(transaction, organisationId, uid, \"lead\")");
  expect(body).toContain("const storedRevision = lead.contactReviewRevision");
  expect(body).toContain("storedRevision !== undefined");
  expect(body).toContain("data.contactReviewRevision !== currentRevision");
  expect(body).toContain("Contact details changed after review began. Refresh the lead and review the current contact details before clearing the restriction.");
  expect(body).toContain("contactReviewStatus: data.doNotContact ? \"blocked\" : \"cleared\"");
  expect(body).toContain('writeSecurityAuditEvent(transaction, organisationId, uid, "lead.contact_restriction_changed", "lead", leadId');
});

it("binds CSV import idempotency to tenant, actor, and normalized payload", () => {
  const start = callableSource.indexOf("export const importLeads = onCall(");
  const nextStart = callableSource.indexOf("export const ", start + 1);
  const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

  expect(body).toContain('JSON.stringify([organisationId, uid, idempotencyKey])');
  expect(body).toContain("const requestHashPayload: Record<string, unknown> = {");
  expect(body).toContain('if (sourceLabel !== "csv_import") requestHashPayload.sourceLabel = sourceLabel');
  expect(body).toContain('const sourceLabel = data.sourceLabel === undefined ? "csv_import" : data.sourceLabel');
  expect(body).toContain('saved.requestHash !== requestHash');
  expect(body).toContain('new HttpsError("already-exists", "This idempotencyKey was already used with a different import payload.")');

  const replayCheck = body.indexOf("if (idempotencySnapshot.exists)");
  const campaignRead = body.indexOf("const campaignSnapshot = await transaction.get(campaignRef)");
  const quotaConsume = body.indexOf('await consumeTransactionalRateLimit(transaction, organisationId, uid, "importLeads", 10)');
  const leadWrite = body.indexOf("transaction.create(leadRef,");
  expect(replayCheck).toBeGreaterThanOrEqual(0);
  expect(campaignRead).toBeGreaterThan(replayCheck);
  expect(quotaConsume).toBeGreaterThan(campaignRead);
  expect(leadWrite).toBeGreaterThan(quotaConsume);
});


describe("manual lead creation idempotency replay integrity", () => {
  it("validates the saved response and authoritative lead and campaign before replay", () => {
    const start = callableSource.indexOf("export const createLead = onCall(");
    const end = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, end < 0 ? callableSource.length : end);
    const replayCheck = body.indexOf("if (idempotencySnapshot.exists)");
    const savedValidation = body.indexOf("Saved lead retry state is invalid");
    const leadRead = body.indexOf("transaction.get(replayLeadRef)");
    const campaignRead = body.indexOf("transaction.get(campaignRef)", replayCheck);
    const replayReturn = body.indexOf("return savedResult as {", replayCheck);

    expect(replayCheck).toBeGreaterThanOrEqual(0);
    expect(body).toContain("saved.actorUid !== uid");
    expect(body).toContain("isValidDocumentId(savedLeadId)");
    expect(body).toContain("Saved lead retry state no longer matches its authoritative records");
    expect(savedValidation).toBeGreaterThan(replayCheck);
    expect(leadRead).toBeGreaterThan(savedValidation);
    expect(campaignRead).toBeGreaterThan(replayCheck);
    expect(replayReturn).toBeGreaterThan(leadRead);
    expect(body).toContain('replayLead.createdBy !== uid');
    expect(body).toContain('replayLead.campaignId !== campaignId');
  });
});

describe("server-side business/location duplicate protection", () => {
  it("persists canonical business/location keys and checks bounded existing-record queries", () => {
    expect(callableSource).toContain("canonicalLeadBusinessLocationKey(businessName, location)");
    expect(callableSource).toContain("dedupeBusinessLocationKey");
    const start = callableSource.indexOf("export const importLeads = onCall(");
    const end = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, end < 0 ? callableSource.length : end);
    expect(body).toContain('where("dedupeBusinessLocationKey", "==", row.businessKey).limit(1)');
    expect(body).toContain('where("businessName", "==", row.fields.businessName)');
    expect(body).toContain('existingBusinesses.has(row.businessKey)');
    expect(body).toContain("existingBusinesses.add(row.businessKey)");
  });
});

it("keeps the offboarding preview protected by App Check even when merged independently", () => {
  const start = callableSource.indexOf("export const previewOrganisationOffboarding = onCall(");
  const end = callableSource.indexOf("export const ", start + 1);
  const body = callableSource.slice(start, end < 0 ? callableSource.length : end);
  expect(body).toContain('{ enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" }');
});

it("keeps offboarding preview owner-only, bounded, tenant-scoped, and non-destructive", () => {
  const start = callableSource.indexOf("export const previewOrganisationOffboarding = onCall(");
  expect(start).toBeGreaterThanOrEqual(0);
  const nextStart = callableSource.indexOf("export const ", start + 1);
  const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);

  expect(body).toContain("requireUid(request.auth?.uid)");
  expect(body).toContain("await requireMembership(organisationId, uid)");
  expect(body).toContain('membership.role !== "owner"');
  expect(body).toContain('consumeReadRateLimit(organisationId, uid, "previewOrganisationOffboarding", 10)');
  expect(body).toContain("createOffboardingPreview(async (category, afterId, limit)");
  expect(body).toContain("const finalMembership = await requireMembership(organisationId, uid)");
  expect(body).toContain("if (finalMembership.role !== \"owner\")");
  expect(body).toContain("OFFBOARDING_PREVIEW_CATEGORIES");
  expect(body).toContain('db.collection("organisations").doc(organisationId)');
  expect(body).toContain(".orderBy(FieldPath.documentId())");
  expect(body).toContain(".limit(limit)");
  expect(body).toContain("destructiveActionPerformed: false");
  expect(body).not.toContain("batch.delete(");
  expect(body).not.toContain("transaction.delete(");
});


describe("server-side campaign funnel analytics", () => {
  it("requires tenant membership, rate-limits reads, validates campaign ownership, and uses bounded aggregation queries", () => {
    const start = callableSource.indexOf("export const getCampaignFunnelSummary = onCall(");
    const end = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, end < 0 ? callableSource.length : end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain("requireUid(request.auth?.uid)");
    expect(body).toContain("requireOrganisationId(data.organisationId)");
    expect(body).toContain('requireDocumentId(data.campaignId, "campaignId")');
    expect(body).toContain("await requireMembership(organisationId, uid)");
    expect(body).toContain('consumeReadRateLimit(organisationId, uid, "getCampaignFunnelSummary", 30)');
    expect(body).toContain('organisationRef.collection("campaigns").doc(campaignId)');
    expect(body).toContain('organisationRef.collection("leads")');
    expect(body).toContain('leadsRef.where("campaignId", "==", campaignId)');
    expect(body).toContain("query.count().get()");
    expect(body).toContain('scope: "all_stored_campaign_leads"');
    expect(body).not.toContain(".get()\n    .docs");
  });
});


describe("server-side source attribution analytics", () => {
  it("aggregates source counts within the authenticated organisation and preserves unknown legacy attribution", () => {
    const start = callableSource.indexOf("export const getLeadSourceFunnelSummary = onCall(");
    const end = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, end < 0 ? callableSource.length : end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain("requireUid(request.auth?.uid)");
    expect(body).toContain("await requireMembership(organisationId, uid)");
    expect(body).toContain('consumeReadRateLimit(organisationId, uid, "getLeadSourceFunnelSummary", 10)');
    expect(body).toContain('db.collection("organisations").doc(organisationId).collection("leads")');
    expect(body).toContain('const knownSources = ["manual", "csv_import", "linkedin_csv", "google_places_manual", "other_approved"]');
    expect(body).toContain('source: "unknown"');
    expect(body).toContain("query.count().get()");
    expect(body).toContain('scope: "all_stored_organisation_leads"');
    expect(body).toContain("attributionNote:");
  });
});


describe("durable onboarding attribution", () => {
  it("stamps first onboarding transition once and exposes only the timestamp in lead summaries", () => {
    const statusStart = callableSource.indexOf("export const updateLeadStatus = onCall(");
    const statusEnd = callableSource.indexOf("export const ", statusStart + 1);
    const statusBody = callableSource.slice(statusStart, statusEnd < 0 ? callableSource.length : statusEnd);
    expect(statusBody).toContain('if (status === "onboarded" && lead.status !== "onboarded" && !isValidFirestoreTimestamp(lead.onboardedAt))');
    expect(statusBody).toContain("leadUpdate.onboardedAt = now");
    expect(statusBody).toContain("transaction.update(leadRef, leadUpdate)");

    const listStart = callableSource.indexOf("export const listLeads = onCall(");
    const listEnd = callableSource.indexOf("export const ", listStart + 1);
    const listBody = callableSource.slice(listStart, listEnd < 0 ? callableSource.length : listEnd);
    expect(listBody).toContain("onboardedAt: safeTimestampToIso(lead.onboardedAt)");
  });
});


describe("server-side onboarding cohort analytics", () => {
  it("counts first-onboarding timestamps by UTC month within the authenticated organisation", () => {
    const start = callableSource.indexOf("export const getOnboardingCohortSummary = onCall(");
    const end = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, end < 0 ? callableSource.length : end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain("requireUid(request.auth?.uid)");
    expect(body).toContain("await requireMembership(organisationId, uid)");
    expect(body).toContain('consumeReadRateLimit(organisationId, uid, "getOnboardingCohortSummary", 5)');
    expect(body).toContain('where("onboardedAt", ">=", Timestamp.fromDate(start))');
    expect(body).toContain('where("onboardedAt", "<", Timestamp.fromDate(end))');
    expect(body).toContain(".count()");
    expect(body).toContain("windowMonths: 12 as const");
    expect(body).toContain('scope: "first_onboarding_timestamp"');
    expect(body).toContain("Legacy leads already onboarded before timestamp capture may be excluded");
  });
});


describe("organisation plan usage dashboard callable", () => {
  it("restricts plan usage details to owners/admins and never fabricates legacy zero usage", () => {
    const start = callableSource.indexOf("export const getOrganisationPlanUsage = onCall(");
    const end = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, end < 0 ? callableSource.length : end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain("await requireMembership(organisationId, uid)");
    expect(body).toContain("hasCampaignWritePermission(membership.role)");
    expect(body).toContain('consumeReadRateLimit(organisationId, uid, "getOrganisationPlanUsage", 5)');
    expect(body).toContain("resolvePlanPolicy(organisationData.planId)");
    expect(body).toContain("resolvePlanUsageState(organisationData.planUsage, new Date())");
    expect(body).toContain('status: "reconciliation_required" as const');
    expect(body).toContain("usage: null");
    expect(body).toContain("remaining: null");
    expect(body).toContain("plan.limits.monthlyAiSuggestions - usage.monthlyAiSuggestions");
  });
});


describe("organisation member roster", () => {
  it("limits roster reads to owners/admins, validates member records, and resolves current emails", () => {
    const start = callableSource.indexOf("export const listOrganisationMembers = onCall(");
    const end = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, end < 0 ? callableSource.length : end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain("await requireMembership(organisationId, uid)");
    expect(body).toContain('callerMembership.role !== "owner" && callerMembership.role !== "admin"');
    expect(body).toContain('consumeReadRateLimit(organisationId, uid, "listOrganisationMembers", 10)');
    expect(body).toContain('.collection("members")');
    expect(body).toContain(".limit(21)");
    expect(body).toContain("isValidMembershipForOrganisation(member, document.id, ownerUid)");
    expect(body).toContain("getAuth().getUser(document.id)");
    expect(body).toContain("const hasMoreMembers = page.docs.length > 20");
    expect(body).toContain('scope: "organisation_member_roster"');
    expect(body).toContain('decoded.scope !== "organisation_member_roster"');
    expect(body).toContain("decoded.organisationId !== organisationId");
    expect(body).toContain("membersQuery.startAfter(cursorUid)");
    expect(body).toContain("nextPageToken: hasMoreMembers");
  });
});


describe("organisation plan usage reconciliation preview", () => {
  it("restricts reconciliation diagnostics to owners/admins and never writes or invents usage", () => {
    const start = callableSource.indexOf("export const getOrganisationPlanUsageReconciliation = onCall(");
    const end = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, end < 0 ? callableSource.length : end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain("await requireMembership(organisationId, uid)");
    expect(body).toContain("hasCampaignWritePermission(membership.role)");
    expect(body).toContain('consumeReadRateLimit(organisationId, uid, "getOrganisationPlanUsageReconciliation", 3)');
    expect(body).toContain('.collection(`organisations/${organisationId}/campaigns`).count().get()');
    expect(body).toContain('.collection(`organisations/${organisationId}/leads`).count().get()');
    expect(body).toContain('.collection(`organisations/${organisationId}/members`).count().get()');
    expect(body).toContain("mismatchedMetrics");
    expect(body).toContain("Historical AI suggestion usage cannot be inferred from resource counts");
    expect(body).toContain("destructiveActionPerformed: false as const");
    expect(body).not.toContain("transaction.set(");
    expect(body).not.toContain("transaction.update(");
  });
 
describe("organisation member removal", () => {
  it("protects the owner, enforces role hierarchy, updates usage atomically, and audits removal", () => {
    const start = callableSource.indexOf("export const removeOrganisationMember = onCall(");
    const end = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, end < 0 ? callableSource.length : end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain("requireTransactionalRole(transaction, organisationId, uid, \"campaign\")");
    expect(body).toContain('callerMembership.role !== "owner" && callerMembership.role !== "admin"');
    expect(body).toContain("The organisation owner cannot be removed.");
    expect(body).toContain("Admins may remove members and viewers, but only the owner may remove admins.");
    expect(body).toContain("resolvePlanUsageState(organisationData.planUsage, new Date())");
    expect(body).toContain('transaction.update(organisationRef, {');
    expect(body).toContain('"organisation.member_removed"');
    expect(body).toContain("transaction.delete(targetMembershipRef)");
    expect(body).not.toContain("getAuth().deleteUser");
  });
});

 
describe("organisation member role management", () => {
  it("allows only the owner to change non-owner roles and audits the change", () => {
    const start = callableSource.indexOf("export const updateOrganisationMemberRole = onCall(");
    const end = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, end < 0 ? callableSource.length : end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(body).toContain('callerMembership.role !== "owner"');
    expect(body).toContain("The organisation owner's role cannot be changed.");
    expect(body).toContain('role !== "admin" && role !== "member" && role !== "viewer"');
    expect(body).toContain("isValidMembershipForOrganisation(target, targetUid, ownerUid)");
    expect(body).toContain('"organisation.member_role_updated"');
    expect(body).toContain("transaction.update(targetMembershipRef, { role,");
  });
});

});
