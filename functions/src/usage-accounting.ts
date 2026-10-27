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
  if (value === undefined) {
    return {
      ok: true,
      source: "initial",
      state: { schemaVersion: 1, campaigns: 0, leads: 0, members: 0, monthlyAiSuggestions: 0, aiUsagePeriod: period },
    };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "invalid_state" };
  let candidate: Record<string, unknown>;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return { ok: false, reason: "invalid_state" };
    candidate = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !USAGE_STATE_KEYS.includes(key as (typeof USAGE_STATE_KEYS)[number])) {
        return { ok: false, reason: "invalid_state" };
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return { ok: false, reason: "invalid_state" };
      }
      candidate[key] = descriptor.value;
    }
  } catch {
    return { ok: false, reason: "invalid_state" };
  }
  if (
    Object.keys(candidate).length !== USAGE_STATE_KEYS.length ||
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
  // A future period is malformed persisted state, not evidence of a new month.
  // Resetting it would permit an unexpected monthly quota reset.
  if (state.aiUsagePeriod > period) return { ok: false, reason: "invalid_state" };
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

function snapshotUsageStateForReservation(value: unknown): PlanUsageState | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== USAGE_STATE_KEYS.length
      || keys.some((key) => typeof key !== "string" || !USAGE_STATE_KEYS.includes(key as (typeof USAGE_STATE_KEYS)[number]))) return null;
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of USAGE_STATE_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      snapshot[key] = descriptor.value;
    }
    if (snapshot.schemaVersion !== 1 || !METRICS.every((key) => isValidCounter(snapshot[key]))) return null;
    if (typeof snapshot.aiUsagePeriod !== "string" || !/^\\d{4}-(0[1-9]|1[0-2])$/.test(snapshot.aiUsagePeriod)) return null;
    return {
      schemaVersion: 1,
      campaigns: snapshot.campaigns as number,
      leads: snapshot.leads as number,
      members: snapshot.members as number,
      monthlyAiSuggestions: snapshot.monthlyAiSuggestions as number,
      aiUsagePeriod: snapshot.aiUsagePeriod,
    };
  } catch {
    return null;
  }
}

function readPlanLimit(plan: unknown, metric: PlanUsageMetric): number | null {
  try {
    if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
    const planDescriptor = Object.getOwnPropertyDescriptor(plan, "limits");
    if (!planDescriptor || !("value" in planDescriptor) || !planDescriptor.value
      || typeof planDescriptor.value !== "object" || Array.isArray(planDescriptor.value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(planDescriptor.value, metric);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)
      || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) return null;
    return descriptor.value as number;
  } catch {
    return null;
  }
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
  const normalizedMetric = (METRICS as readonly string[]).includes(metric) ? metric : null;
  const normalizedState = snapshotUsageStateForReservation(state);
  const limit = normalizedMetric ? readPlanLimit(plan, normalizedMetric) : null;
  const used = normalizedMetric && normalizedState ? normalizedState[normalizedMetric] : Number.NaN;
  if (!normalizedMetric || !normalizedState || limit === null
    || !isValidCounter(used) || !Number.isSafeInteger(requested) || requested < 1) {
    return { allowed: false, reason: "invalid_usage", metric, requested, used, limit: limit ?? Number.NaN };
  }
  if (used + requested > limit) {
    return { allowed: false, reason: "limit_exceeded", metric, requested, used, limit };
  }
  return {
    allowed: true,
    metric: normalizedMetric,
    requested,
    remaining: limit - used - requested,
    state: { ...normalizedState, [normalizedMetric]: used + requested },
  };
}
