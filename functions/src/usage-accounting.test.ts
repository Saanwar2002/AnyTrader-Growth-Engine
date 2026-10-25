import { describe, expect, it } from "vitest";
import { PILOT_PLAN } from "./entitlements";
import { currentAiUsagePeriod, reservePlanUsage, resolvePlanUsageState } from "./usage-accounting";

const now = new Date("2026-10-25T12:00:00.000Z");

describe("plan usage state", () => {
  it("initialises an explicit zero state but marks it as unreconciled", () => {
    expect(resolvePlanUsageState(undefined, now)).toEqual({
      ok: true,
      source: "initial",
      state: { schemaVersion: 1, campaigns: 0, leads: 0, members: 0, monthlyAiSuggestions: 0, aiUsagePeriod: "2026-10" },
    });
  });

  it("uses UTC calendar months and rejects invalid dates", () => {
    expect(currentAiUsagePeriod(new Date("2026-11-01T00:30:00+02:00"))).toBe("2026-10");
    expect(currentAiUsagePeriod(new Date(Number.NaN))).toBeNull();
  });

  it("fails closed for malformed counters and schema versions", () => {
    expect(resolvePlanUsageState({ schemaVersion: 2 }, now)).toEqual({ ok: false, reason: "invalid_state" });
    expect(resolvePlanUsageState({ schemaVersion: 1, campaigns: -1, leads: 0, members: 0, monthlyAiSuggestions: 0, aiUsagePeriod: "2026-10" }, now))
      .toEqual({ ok: false, reason: "invalid_state" });
    expect(resolvePlanUsageState({ schemaVersion: 1, campaigns: 0, leads: 0, members: 0, monthlyAiSuggestions: 0, aiUsagePeriod: "bad" }, now))
      .toEqual({ ok: false, reason: "invalid_state" });
  });

  it("resets only the monthly AI counter when the UTC month changes", () => {
    const previous = { schemaVersion: 1, campaigns: 4, leads: 40, members: 2, monthlyAiSuggestions: 50, aiUsagePeriod: "2026-09" };
    expect(resolvePlanUsageState(previous, now)).toEqual({
      ok: true,
      source: "stored",
      state: { ...previous, monthlyAiSuggestions: 0, aiUsagePeriod: "2026-10" },
    });
  });
});

describe("transaction-ready usage reservation decision", () => {
  const state = { schemaVersion: 1 as const, campaigns: 9, leads: 499, members: 4, monthlyAiSuggestions: 49, aiUsagePeriod: "2026-10" };

  it("reserves exactly up to the plan boundary without mutating the input", () => {
    expect(reservePlanUsage(PILOT_PLAN, state, "campaigns")).toMatchObject({ allowed: true, remaining: 0, state: { campaigns: 10 } });
    expect(state.campaigns).toBe(9);
  });

  it("rejects over-limit reservations without increasing usage", () => {
    expect(reservePlanUsage(PILOT_PLAN, state, "leads", 2)).toEqual({
      allowed: false, reason: "limit_exceeded", metric: "leads", requested: 2, used: 499, limit: 500,
    });
  });

  it("rejects malformed requests", () => {
    expect(reservePlanUsage(PILOT_PLAN, state, "members", 0).reason).toBe("invalid_usage");
    expect(reservePlanUsage(PILOT_PLAN, state, "members", 1.5).reason).toBe("invalid_usage");
  });
});
