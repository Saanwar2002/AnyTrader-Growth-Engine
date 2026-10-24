import { describe, expect, it } from "vitest";
import { evaluateRateLimit } from "./authorization";

describe("rate-limit evaluation boundary inputs", () => {
  it.each([
    ["negative clock", -1, 3, 100],
    ["fractional clock", 1.5, 3, 100],
    ["unsafe clock", Number.MAX_SAFE_INTEGER + 1, 3, 100],
    ["zero request limit", 20, 0, 100],
    ["fractional request limit", 20, 1.5, 100],
    ["negative window", 20, 3, -1],
    ["zero window", 20, 3, 0],
    ["fractional window", 20, 3, 1.5],
  ])("fails closed for invalid configuration: %s", (_label, now, max, window) => {
    expect(evaluateRateLimit(undefined, now, max, window)).toEqual({
      allowed: false,
      invalidState: true,
      nextState: null,
      retryAfterMs: 0,
    });
  });

  it("does not reset a quota window when the clock moves backwards", () => {
    expect(evaluateRateLimit({ windowStartedAtMs: 100, count: 3 }, 90, 3, 60)).toEqual({
      allowed: false,
      invalidState: false,
      nextState: null,
      retryAfterMs: 70,
    });
  });

  it("preserves the existing window when quota remains below the limit", () => {
    expect(evaluateRateLimit({ windowStartedAtMs: 100, count: 1 }, 120, 3, 60)).toEqual({
      allowed: true,
      invalidState: false,
      nextState: { windowStartedAtMs: 100, count: 2 },
      retryAfterMs: 0,
    });
  });
});
