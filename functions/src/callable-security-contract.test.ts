import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const callableSource = readFileSync(
  fileURLToPath(new URL("./index.ts", import.meta.url)),
  "utf8",
);

const expectedRateLimitType: Record<string, "read" | "mutation"> = {
  listMyOrganisations: "read",
  createOrganisation: "mutation",
  createCampaign: "mutation",
  listCampaigns: "read",
  updateCampaignStatus: "mutation",
  listLeads: "read",
  createLead: "mutation",
  importLeads: "mutation",
  updateLeadContact: "mutation",
  updateLeadStatus: "mutation",
  updateLeadNotes: "mutation",
  setLeadSuppression: "mutation",
  createOutreachDraft: "mutation",
  listOutreachDrafts: "read",
  updateOutreachDraft: "mutation",
  deleteOutreachDraft: "mutation",
};

describe("callable security contract", () => {
  it("enforces App Check on every deployed callable and only bypasses it in the Functions emulator", () => {
    expect(callableSource).toContain('const callableOptions = { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true" }');
    expect((callableSource.match(/= onCall\(callableOptions, async \(request\) => \{/g) ?? [])).toHaveLength(16);
    expect(callableSource.includes("= onCall(async (request) => {")).toBe(false);
  });

  it("rejects callable-specific options that omit App Check", () => {
    // Most callables share callableOptions; inline options are allowed only when
    // they explicitly preserve the same App Check requirement.
    expect(callableSource).not.toMatch(/export const \\w+ = onCall\\(\\s*\\{(?![^}]*enforceAppCheck)/s);
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
    expect(auditCalls.length).toBe(12);
    for (const [eventType, resourceType] of [
      ["organisation.created", "organisation"],
      ["lead.csv_import.completed", "campaign"],
      ["lead.contact_updated", "lead"],
      ["lead.contact_restriction_changed", "lead"],
      ["lead.created", "lead"],
      ["campaign.created", "campaign"],
      ["campaign.status_changed", "campaign"],
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
  expect(body).toContain('source: "csv_import"');
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
  expect(body).toContain('JSON.stringify({ organisationId, campaignId, leads: rows.map(({ fields }) => fields) })');
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
