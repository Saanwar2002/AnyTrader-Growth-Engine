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

    expect(body).toContain('doNotContact: true');
    expect(body).toContain('contactReviewStatus: "pending"');
    expect(body).toContain('contactReviewRevision: 0');
    expect(body).toContain('status: "new"');
  });

  it("requires durable idempotency for CSV imports", () => {
    const start = callableSource.indexOf("export const importLeads = onCall(");
    const nextStart = callableSource.indexOf("export const ", start + 1);
    const body = callableSource.slice(start, nextStart < 0 ? callableSource.length : nextStart);
    expect(body).toContain('data.idempotencyKey');
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
    expect(callableSource).toContain('type SecurityAuditEventType = "lead.csv_import.completed"');
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
