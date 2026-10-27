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

const PLAN_USAGE_METRICS: readonly PlanUsageMetric[] = ["campaigns", "leads", "members", "monthlyAiSuggestions"];

function snapshotPlanLimits(value: unknown): Record<PlanUsageMetric, number> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== PLAN_USAGE_METRICS.length
      || keys.some((key) => typeof key !== "string" || !PLAN_USAGE_METRICS.includes(key as PlanUsageMetric))) return null;
    const limits = Object.create(null) as Record<PlanUsageMetric, number>;
    for (const metric of PLAN_USAGE_METRICS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, metric);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)
        || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) return null;
      limits[metric] = descriptor.value as number;
    }
    return limits;
  } catch {
    return null;
  }
}

function readPlanLimits(plan: unknown): Record<PlanUsageMetric, number> | null {
  try {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(plan, "limits");
    if (!descriptor || !("value" in descriptor)) return null;
    return snapshotPlanLimits(descriptor.value);
  } catch {
    return null;
  }
}

/** Pure decision helper. Callers must supply authoritative server-side usage. */
export function evaluatePlanLimit(
  plan: PlanPolicy,
  metric: PlanUsageMetric,
  used: number,
  requested = 1,
): PlanLimitDecision {
  const limits = readPlanLimits(plan);
  const validMetric = (PLAN_USAGE_METRICS as readonly string[]).includes(metric);
  const limit = validMetric && limits ? limits[metric] : Number.NaN;
  if (!validMetric || !limits || !Number.isSafeInteger(used) || used < 0
    || !Number.isSafeInteger(requested) || requested < 1) {
    return { allowed: false, limit, used, requested, remaining: 0, reason: "invalid_usage" };
  }
  const remaining = Math.max(0, limit - used);
  if (used + requested > limit) {
    return { allowed: false, limit, used, requested, remaining, reason: "limit_exceeded" };
  }
  return { allowed: true, limit, used, requested, remaining: limit - used - requested };
}
