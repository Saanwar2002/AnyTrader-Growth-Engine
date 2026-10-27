import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { auditLeadIdentifierReservations, type ReservationAuditDocument } from "./lead-identifier-reservation-audit";

function reservationId(type: string, key: string): string {
  return createHash("sha256").update(JSON.stringify([type, key])).digest("hex");
}

function reservation(id: string, identifierType: string, leadId: string): ReservationAuditDocument {
  return { id, schemaVersion: 1, identifierType, leadId };
}

describe("read-only lead identifier reservation audit", () => {
  it("reports a consistent reservation inventory without raw identifier values", () => {
    const leads = [{
      id: "lead-a",
      email: " Sales@Example.com ",
      website: "HTTPS://Example.com/Directory",
      businessName: " North Star Plumbing ",
      location: " Edinburgh ",
    }];
    const records = [
      reservation(reservationId("email", "sales@example.com"), "email", "lead-a"),
      reservation(reservationId("website", "https://example.com/Directory"), "website", "lead-a"),
      reservation(reservationId("businessLocation", '["north star plumbing","edinburgh"]'), "businessLocation", "lead-a"),
    ];

    const report = auditLeadIdentifierReservations(leads, records);

    expect(report).toMatchObject({
      scannedLeadCount: 1,
      scannedReservationCount: 3,
      expectedReservationCount: 3,
      missingReservationIds: [],
      orphanReservationIds: [],
      mismatchedReservationIds: [],
      malformedLeadIds: [],
      malformedReservationIds: [],
      duplicateIdentifierGroups: [],
    });
    expect(JSON.stringify(report)).not.toContain("Sales@Example.com");
    expect(JSON.stringify(report)).not.toContain("https://example.com/Directory");
    expect(JSON.stringify(report)).not.toContain("North Star Plumbing");
    expect(JSON.stringify(report)).not.toContain("Edinburgh");
  });

  it("detects missing, orphaned, mismatched, and malformed reservations", () => {
    const leads = [{ id: "lead-a", email: "a@example.com", businessName: "A Business", location: "Leeds" }];
    const emailId = reservationId("email", "a@example.com");
    const businessId = reservationId("businessLocation", '["a business","leeds"]');
    const report = auditLeadIdentifierReservations(leads, [
      reservation(emailId, "email", "lead-b"),
      reservation("orphan-reservation-id", "website", "deleted-lead"),
      { id: "malformed-reservation", schemaVersion: 1, identifierType: "website" },
    ]);

    expect(report.expectedReservationCount).toBe(2);
    expect(report.missingReservationIds).toEqual([businessId]);
    expect(report.mismatchedReservationIds).toEqual([emailId]);
    expect(report.orphanReservationIds).toEqual(["orphan-reservation-id"]);
    expect(report.malformedReservationIds).toEqual(["malformed-reservation"]);
  });

  it("reports canonical collisions while preserving URL path case", () => {
    const report = auditLeadIdentifierReservations([
      { id: "lead-a", email: "team@example.com", website: "https://example.com/Directory", businessName: "A", location: "Leeds" },
      { id: "lead-b", email: " TEAM@EXAMPLE.COM ", website: "https://example.com/directory", businessName: "B", location: "York" },
    ], [
      reservation(reservationId("email", "team@example.com"), "email", "lead-a"),
      reservation(reservationId("website", "https://example.com/Directory"), "website", "lead-a"),
      reservation(reservationId("website", "https://example.com/directory"), "website", "lead-b"),
      reservation(reservationId("businessLocation", '["a","leeds"]'), "businessLocation", "lead-a"),
      reservation(reservationId("businessLocation", '["b","york"]'), "businessLocation", "lead-b"),
    ]);

    expect(report.duplicateIdentifierGroups).toHaveLength(1);
    expect(report.duplicateIdentifierGroups[0]).toMatchObject({
      identifierType: "email",
      leadIds: ["lead-a", "lead-b"],
    });
    expect(report.duplicateIdentifierGroups[0].canonicalKeyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.missingReservationIds).toEqual([]);
    expect(report.mismatchedReservationIds).toEqual([]);
  });

  it("marks malformed leads and malformed reservation envelopes without throwing", () => {
    const report = auditLeadIdentifierReservations([
      { id: "lead-valid", businessName: "Valid Business", location: "" },
      { id: "lead-malformed", email: "not-an-email", businessName: "Broken Business", location: "Leeds" },
    ], []);
    expect(report.malformedLeadIds).toEqual(["lead-malformed"]);
    expect(report.missingReservationIds).toHaveLength(1);
    expect(() => auditLeadIdentifierReservations([null] as never, [])).toThrow("malformed lead record");
    expect(() => auditLeadIdentifierReservations([{ id: "same" }, { id: "same" }], [])).toThrow("duplicate lead ID");
    expect(() => auditLeadIdentifierReservations([], [{ id: "same" }, { id: "same" }])).toThrow("duplicate reservation ID");
  });

  it("rejects malformed collection inputs before comparing", () => {
    expect(() => auditLeadIdentifierReservations(null as never, [])).toThrow("requires lead and reservation arrays");
    expect(() => auditLeadIdentifierReservations([], [null] as never)).toThrow("malformed reservation record");
  });
});
