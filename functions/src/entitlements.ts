export type PlanId = "pilot";
export type PlanUsageMetric = "campaigns" | "leads" | "members" | "monthlyAiSuggestions";

export interface PlanPolicy {
  id: PlanId;
  displayName: string;
  limits: Readonly<Record<PlanUsageMetric, number>>;
  features: Readonly<{
    csvImport: boolean;
    campaignAnalytics: boolean;
    sourceAttribution: boolean;
    aiDraftSuggestions: boolean;
  }>;
  billingEnabled: false;
}

export const PILOT_PLAN: PlanPolicy = Object.freeze({
  id: "pilot",
  displayName: "Pilot",
  limits: Object.freeze({
    campaigns: 10,
    leads: 500,
    members: 5,
    monthlyAiSuggestions: 50,
  }),
  features: Object.freeze({
    csvImport: true,
    campaignAnalytics: true,
    sourceAttribution: true,
    aiDraftSuggestions: true,
  }),
  billingEnabled: false,
});

export type PlanResolution =
  | { ok: true; plan: PlanPolicy; source: "default" | "stored" }
  | { ok: false; reason: "unknown_plan" };

/**
 * Missing plan metadata is treated as the pre-billing Pilot plan for legacy
 * organisations. An explicitly unknown plan is rejected instead of silently
 * downgrading or granting access.
 */
export function resolvePlanPolicy(value: unknown): PlanResolution {
  if (value === undefined || value === null || value === "") {
    return { ok: true, plan: PILOT_PLAN, source: "default" };
  }
  if (value === PILOT_PLAN.id) return { ok: true, plan: PILOT_PLAN, source: "stored" };
  return { ok: false, reason: "unknown_plan" };
}

export type PlanLimitDecision =
  | { allowed: true; limit: number; used: number; requested: number; remaining: number }
  | { allowed: false; limit: number; used: number; requested: number; remaining: number; reason: "limit_exceeded" | "invalid_usage" };

/** Pure decision helper. Callers must supply authoritative server-side usage. */
export function evaluatePlanLimit(
  plan: PlanPolicy,
  metric: PlanUsageMetric,
  used: number,
  requested = 1,
): PlanLimitDecision {
  const limit = plan.limits[metric];
  if (!Number.isSafeInteger(used) || used < 0 || !Number.isSafeInteger(requested) || requested < 1) {
    return { allowed: false, limit, used, requested, remaining: 0, reason: "invalid_usage" };
  }
  const remaining = Math.max(0, limit - used);
  if (used + requested > limit) {
    return { allowed: false, limit, used, requested, remaining, reason: "limit_exceeded" };
  }
  return { allowed: true, limit, used, requested, remaining: limit - used - requested };
}
