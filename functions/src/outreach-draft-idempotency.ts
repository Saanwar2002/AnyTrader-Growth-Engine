export interface ExpectedOutreachDraftReplay {
  actorUid: string;
  requestHash: string;
  leadId: string;
  campaignId: string;
  subject: string;
  body: string;
}

export interface ValidOutreachDraftReplayResult {
  draftId: string;
  leadId: string;
  campaignId: string;
  subject: string;
  body: string;
  status: "draft";
  sent: false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the immutable response saved by the first successful draft-creation
 * attempt. A replay must belong to the same actor and canonical request payload.
 */
export function getValidOutreachDraftReplayResult(
  savedValue: unknown,
  expected: ExpectedOutreachDraftReplay,
): ValidOutreachDraftReplayResult | null {
  if (!isRecord(savedValue)
    || savedValue.actorUid !== expected.actorUid
    || savedValue.requestHash !== expected.requestHash
    || !isRecord(savedValue.result)) {
    return null;
  }

  const result = savedValue.result;
  if (typeof result.draftId !== "string" || result.draftId.length === 0
    || result.draftId.includes("/")
    || result.leadId !== expected.leadId
    || result.campaignId !== expected.campaignId
    || result.subject !== expected.subject
    || result.body !== expected.body
    || result.status !== "draft"
    || result.sent !== false) {
    return null;
  }

  return {
    draftId: result.draftId,
    leadId: expected.leadId,
    campaignId: expected.campaignId,
    subject: expected.subject,
    body: expected.body,
    status: "draft",
    sent: false,
  };
}

/** Ensure the original draft still exists in this tenant and remains unsent. */
export function isPersistedOutreachDraftAvailable(
  draftValue: unknown,
  expected: Pick<ExpectedOutreachDraftReplay, "actorUid" | "leadId" | "campaignId">,
): boolean {
  return isRecord(draftValue)
    && draftValue.leadId === expected.leadId
    && draftValue.campaignId === expected.campaignId
    && draftValue.createdBy === expected.actorUid
    && draftValue.sent === false;
}
