import type { PlanPolicy, PlanUsageMetric } from "./entitlements";

/**
 * Versioned, server-maintained usage snapshot stored on an organisation record.
 * This helper only validates and calculates a reservation; callers must read and
 * write the organisation document in the same Firestore transaction as the
 * resource mutation. Never accept this state from a client.
 */
export interface PlanUsageState {
  schemaVersion: 1;
  campaigns: number;
  leads: number;
  members: number;
  monthlyAiSuggestions: number;
  aiUsagePeriod: string;
}

export type UsageStateResolution =
  | { ok: true; state: PlanUsageState; source: "stored" | "initial" }
  | { ok: false; reason: "invalid_state" | "period_mismatch" };

const METRICS: readonly PlanUsageMetric[] = ["campaigns", "leads", "members", "monthlyAiSuggestions"];
const USAGE_STATE_KEYS = ["schemaVersion", "campaigns", "leads", "members", "monthlyAiSuggestions", "aiUsagePeriod"] as const;

/** UTC calendar month, stable across time zones and safe for monthly AI reset logic. */
export function currentAiUsagePeriod(now: Date): string | null {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function isValidCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Missing state is explicitly marked as initial; callers must reconcile legacy data before enforcing it. */
export function resolvePlanUsageState(value: unknown, now: Date): UsageStateResolution {
  const period = currentAiUsagePeriod(now);
  if (!period) return { ok: false, reason: "invalid_state" };
  if (value === undefined || value === null) {
    return {
      ok: true,
      source: "initial",
      state: { schemaVersion: 1, campaigns: 0, leads: 0, members: 0, monthlyAiSuggestions: 0, aiUsagePeriod: period },
    };
  }
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "invalid_state" };
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== USAGE_STATE_KEYS.length ||
    !USAGE_STATE_KEYS.every((key) => Object.prototype.hasOwnProperty.call(candidate, key)) ||
    candidate.schemaVersion !== 1 ||
    !METRICS.every((metric) => isValidCounter(candidate[metric]))
  ) {
    return { ok: false, reason: "invalid_state" };
  }
  if (typeof candidate.aiUsagePeriod !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(candidate.aiUsagePeriod)) {
    return { ok: false, reason: "invalid_state" };
  }
  const state = candidate as unknown as PlanUsageState;
  if (state.aiUsagePeriod !== period) {
    // Only the monthly AI counter resets. Lifetime totals are retained.
    return {
      ok: true,
      source: "stored",
      state: { schemaVersion: 1, campaigns: state.campaigns, leads: state.leads, members: state.members, monthlyAiSuggestions: 0, aiUsagePeriod: period },
    };
  }
  return { ok: true, source: "stored", state: { ...state } };
}

export type UsageReservation =
  | { allowed: true; state: PlanUsageState; metric: PlanUsageMetric; requested: number; remaining: number }
  | { allowed: false; reason: "limit_exceeded" | "invalid_usage"; metric: PlanUsageMetric; requested: number; used: number; limit: number };

/** Pure reservation decision. Persist the returned state atomically with the resource write. */
export function reservePlanUsage(
  plan: PlanPolicy,
  state: PlanUsageState,
  metric: PlanUsageMetric,
  requested = 1,
): UsageReservation {
  const used = state[metric];
  const limit = plan.limits[metric];
  if (!isValidCounter(used) || !Number.isSafeInteger(requested) || requested < 1) {
    return { allowed: false, reason: "invalid_usage", metric, requested, used, limit };
  }
  if (used + requested > limit) {
    return { allowed: false, reason: "limit_exceeded", metric, requested, used, limit };
  }
  return {
    allowed: true,
    metric,
    requested,
    remaining: limit - used - requested,
    state: { ...state, [metric]: used + requested },
  };
}
