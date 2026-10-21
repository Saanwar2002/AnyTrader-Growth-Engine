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
  it("keeps every expected callable authenticated and rate-limited", () => {
    const declarations = [...callableSource.matchAll(/export const (\\w+) = onCall\\(/g)];
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
    }
  });
});
