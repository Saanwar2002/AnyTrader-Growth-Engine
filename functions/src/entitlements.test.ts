import { describe, expect, it } from "vitest";
import { evaluatePlanLimit, PILOT_PLAN, resolvePlanPolicy } from "./entitlements";

describe("resolvePlanPolicy", () => {
  it("assigns the pre-billing Pilot policy to legacy organisations without plan metadata", () => {
    expect(resolvePlanPolicy(undefined)).toEqual({ ok: true, plan: PILOT_PLAN, source: "default" });
    expect(resolvePlanPolicy(null)).toEqual({ ok: true, plan: PILOT_PLAN, source: "default" });
    expect(resolvePlanPolicy("")).toEqual({ ok: true, plan: PILOT_PLAN, source: "default" });
  });

  it("recognises an explicitly stored Pilot plan", () => {
    expect(resolvePlanPolicy("pilot")).toEqual({ ok: true, plan: PILOT_PLAN, source: "stored" });
  });

  it("fails closed for unknown explicit plan identifiers", () => {
    expect(resolvePlanPolicy("enterprise")).toEqual({ ok: false, reason: "unknown_plan" });
    expect(resolvePlanPolicy({ id: "pilot" })).toEqual({ ok: false, reason: "unknown_plan" });
  });
});

describe("evaluatePlanLimit", () => {
  it("allows usage within the limit and returns remaining capacity", () => {
    expect(evaluatePlanLimit(PILOT_PLAN, "campaigns", 3, 2)).toEqual({
      allowed: true, limit: 10, used: 3, requested: 2, remaining: 5,
    });
  });

  it("rejects requests that would exceed the limit without negative remaining capacity", () => {
    expect(evaluatePlanLimit(PILOT_PLAN, "leads", 499, 2)).toEqual({
      allowed: false, limit: 500, used: 499, requested: 2, remaining: 1, reason: "limit_exceeded",
    });
  });

  it("allows the exact limit but not one additional unit", () => {
    expect(evaluatePlanLimit(PILOT_PLAN, "members", 4, 1).allowed).toBe(true);
    expect(evaluatePlanLimit(PILOT_PLAN, "members", 5, 1)).toMatchObject({
      allowed: false, limit: 5, remaining: 0, reason: "limit_exceeded",
    });
  });

  it("rejects accessor-backed plan limits without invoking getters", () => {
    let getterInvoked = false;
    const limits = {
      leads: 500,
      members: 5,
      monthlyAiSuggestions: 50,
    };
    Object.defineProperty(limits, "campaigns", {
      enumerable: true,
      get: () => { getterInvoked = true; return 10; },
    });
    const plan = Object.defineProperty({}, "limits", { enumerable: true, value: limits });

    expect(evaluatePlanLimit(plan as never, "campaigns", 1))
      .toMatchObject({ allowed: false, reason: "invalid_usage" });
    expect(getterInvoked).toBe(false);
  });

  it("rejects malformed plan limits and unsupported runtime metrics", () => {
    expect(evaluatePlanLimit(PILOT_PLAN, "__proto__" as never, 1))
      .toMatchObject({ allowed: false, reason: "invalid_usage" });
    expect(evaluatePlanLimit({ ...PILOT_PLAN, limits: { campaigns: 10, leads: -1, members: 5, monthlyAiSuggestions: 50 } } as never, "campaigns", 1))
      .toMatchObject({ allowed: false, reason: "invalid_usage" });

    const symbolLimits = { ...PILOT_PLAN.limits, [Symbol("extra")]: 1 };
    expect(evaluatePlanLimit({ ...PILOT_PLAN, limits: symbolLimits } as never, "campaigns", 1))
      .toMatchObject({ allowed: false, reason: "invalid_usage" });
  });

  it("rejects non-integer, negative, or invalid requested usage", () => {
    expect(evaluatePlanLimit(PILOT_PLAN, "campaigns", -1).reason).toBe("invalid_usage");
    expect(evaluatePlanLimit(PILOT_PLAN, "campaigns", 1.5).reason).toBe("invalid_usage");
    expect(evaluatePlanLimit(PILOT_PLAN, "campaigns", 1, 0).reason).toBe("invalid_usage");
    expect(evaluatePlanLimit(PILOT_PLAN, "campaigns", 1, 1.2).reason).toBe("invalid_usage");
  });
});
