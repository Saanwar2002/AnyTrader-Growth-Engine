import { createHash } from "node:crypto";
import {
  canonicalLeadBusinessLocationKey,
  canonicalLeadEmailKey,
  canonicalLeadWebsiteKey,
} from "./lead-identifiers";
import { isSafeWebsiteAddress, isValidEmailAddress } from "./authorization";

export type LeadIdentifierReservationType = "email" | "website" | "businessLocation";

export interface ReservationAuditLead {
  id: string;
  email?: unknown;
  website?: unknown;
  businessName?: unknown;
  location?: unknown;
}

export interface ReservationAuditDocument {
  id: string;
  schemaVersion?: unknown;
  identifierType?: unknown;
  leadId?: unknown;
}

export interface ReservationAuditCollision {
  identifierType: LeadIdentifierReservationType;
  /** Fingerprint only; raw email, website, business name and location are omitted. */
  canonicalKeyFingerprint: string;
  leadIds: string[];
}

export interface LeadIdentifierReservationAuditReport {
  scannedLeadCount: number;
  scannedReservationCount: number;
  expectedReservationCount: number;
  missingReservationIds: string[];
  orphanReservationIds: string[];
  mismatchedReservationIds: string[];
  malformedLeadIds: string[];
  malformedReservationIds: string[];
  duplicateIdentifierGroups: ReservationAuditCollision[];
}

interface ExpectedReservation {
  id: string;
  identifierType: LeadIdentifierReservationType;
  key: string;
  leadIds: string[];
}

const IDENTIFIER_TYPES: readonly LeadIdentifierReservationType[] = [
  "email",
  "website",
  "businessLocation",
];

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function reservationId(identifierType: LeadIdentifierReservationType, key: string): string {
  return fingerprint(JSON.stringify([identifierType, key]));
}

/**
 * Compare a complete, tenant-scoped lead inventory with its reservation
 * inventory. The caller must not invoke this comparison on truncated scans:
 * an incomplete input could otherwise make valid reservations look orphaned.
 *
 * This analyzer is read-only, does not connect to Firestore, and never returns
 * raw canonical identifiers.
 */
export function auditLeadIdentifierReservations(
  leads: readonly ReservationAuditLead[],
  reservations: readonly ReservationAuditDocument[],
): LeadIdentifierReservationAuditReport {
  if (!Array.isArray(leads) || !Array.isArray(reservations)) {
    throw new Error("Reservation audit requires lead and reservation arrays.");
  }

  const leadIds = new Set<string>();
  for (const lead of leads as readonly unknown[]) {
    if (!lead || typeof lead !== "object" || Array.isArray(lead)) {
      throw new Error("Reservation audit received a malformed lead record.");
    }
    const id = (lead as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Reservation audit lead must have a non-empty string ID.");
    }
    if (leadIds.has(id)) throw new Error("Reservation audit received a duplicate lead ID.");
    leadIds.add(id);
  }

  const reservationIds = new Set<string>();
  for (const reservation of reservations as readonly unknown[]) {
    if (!reservation || typeof reservation !== "object" || Array.isArray(reservation)) {
      throw new Error("Reservation audit received a malformed reservation record.");
    }
    const id = (reservation as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("Reservation audit reservation must have a non-empty string ID.");
    }
    if (reservationIds.has(id)) throw new Error("Reservation audit received a duplicate reservation ID.");
    reservationIds.add(id);
  }

  const expected = new Map<string, ExpectedReservation>();
  const malformedLeadIds: string[] = [];
  const addExpected = (identifierType: LeadIdentifierReservationType, key: string, leadId: string): void => {
    if (!key) return;
    const id = reservationId(identifierType, key);
    const current = expected.get(id);
    if (current) {
      if (!current.leadIds.includes(leadId)) current.leadIds.push(leadId);
      return;
    }
    expected.set(id, { id, identifierType, key, leadIds: [leadId] });
  };

  for (const lead of leads) {
    const emailValue = lead.email;
    const websiteValue = lead.website;
    const businessNameValue = lead.businessName;
    const locationValue = lead.location;
    const email = typeof emailValue === "string" ? emailValue.trim() : "";
    const website = typeof websiteValue === "string" ? websiteValue.trim() : "";
    const businessName = typeof businessNameValue === "string" ? businessNameValue.trim() : "";
    const location = typeof locationValue === "string" ? locationValue.trim() : "";

    const malformed = (
      (emailValue !== undefined && emailValue !== null && typeof emailValue !== "string")
      || (websiteValue !== undefined && websiteValue !== null && typeof websiteValue !== "string")
      || !businessName
      || (locationValue !== undefined && locationValue !== null && typeof locationValue !== "string")
      || (email !== "" && !isValidEmailAddress(email))
      || (website !== "" && !isSafeWebsiteAddress(website))
    );
    if (malformed) {
      malformedLeadIds.push(lead.id);
      continue;
    }

    if (email) addExpected("email", canonicalLeadEmailKey(email), lead.id);
    if (website) {
      try {
        addExpected("website", canonicalLeadWebsiteKey(website), lead.id);
      } catch {
        malformedLeadIds.push(lead.id);
        continue;
      }
    }
    addExpected("businessLocation", canonicalLeadBusinessLocationKey(businessName, location), lead.id);
  }

  const actual = new Map(reservations.map((reservation) => [reservation.id, reservation] as const));
  const missingReservationIds = [...expected.keys()].filter((id) => !actual.has(id)).sort();
  const orphanReservationIds: string[] = [];
  const mismatchedReservationIds: string[] = [];
  const malformedReservationIds: string[] = [];

  for (const reservation of reservations) {
    const dataValid = reservation.schemaVersion === 1
      && typeof reservation.identifierType === "string"
      && IDENTIFIER_TYPES.includes(reservation.identifierType as LeadIdentifierReservationType)
      && typeof reservation.leadId === "string"
      && reservation.leadId.length > 0;
    if (!dataValid) {
      malformedReservationIds.push(reservation.id);
      continue;
    }

    const expectedEntry = expected.get(reservation.id);
    if (!expectedEntry) {
      orphanReservationIds.push(reservation.id);
      continue;
    }
    if (reservation.identifierType !== expectedEntry.identifierType
      || !expectedEntry.leadIds.includes(reservation.leadId as string)) {
      mismatchedReservationIds.push(reservation.id);
    }
  }

  const duplicateIdentifierGroups = [...expected.values()]
    .filter((entry) => entry.leadIds.length > 1)
    .map((entry) => ({
      identifierType: entry.identifierType,
      canonicalKeyFingerprint: fingerprint(entry.key),
      leadIds: [...entry.leadIds].sort(),
    }))
    .sort((a, b) => a.identifierType.localeCompare(b.identifierType)
      || a.canonicalKeyFingerprint.localeCompare(b.canonicalKeyFingerprint));

  return {
    scannedLeadCount: leads.length,
    scannedReservationCount: reservations.length,
    expectedReservationCount: expected.size,
    missingReservationIds,
    orphanReservationIds: orphanReservationIds.sort(),
    mismatchedReservationIds: mismatchedReservationIds.sort(),
    malformedLeadIds: [...new Set(malformedLeadIds)].sort(),
    malformedReservationIds: malformedReservationIds.sort(),
    duplicateIdentifierGroups,
  };
}
