import { describe, expect, it } from "vitest";
import { createRateLimitDocumentId, evaluateRateLimit } from "./authorization";

describe("rate-limit persistence hardening", () => {
  it("keeps delimiter-containing quota dimensions in distinct buckets", () => {
    // These tuples would collide if identifiers were concatenated with a delimiter.
    expect(createRateLimitDocumentId("org:a", "user", "read")).not.toBe(createRateLimitDocumentId("org", "a:user", "read"));
    expect(createRateLimitDocumentId("org", "user:a", "read")).not.toBe(createRateLimitDocumentId("org:a:user", "", "read"));
  });

  it.each([
    ["primitive", "corrupt"],
    ["array", []],
    ["missing timestamp", { count: 1 }],
    ["missing count", { windowStartedAtMs: 10 }],
    ["negative timestamp", { windowStartedAtMs: -1, count: 1 }],
    ["fractional count", { windowStartedAtMs: 10, count: 1.5 }],
    ["zero count", { windowStartedAtMs: 10, count: 0 }],
    ["count above limit", { windowStartedAtMs: 10, count: 4 }],
  ])("fails closed for malformed persisted quota state: %s", (_label, state) => {
    expect(evaluateRateLimit(state, 20, 3, 100)).toEqual({
      allowed: false,
      invalidState: true,
      nextState: null,
      retryAfterMs: 0,
    });
  });

  it("accepts known Firestore persistence metadata without using it for quota math", () => {
    expect(evaluateRateLimit({
      windowStartedAtMs: 10,
      count: 1,
      updatedAt: { toDate: "ignored metadata" },
      expireAt: { toMillis: "ignored metadata" },
    }, 20, 3, 100)).toEqual({
      allowed: true,
      invalidState: false,
      nextState: { windowStartedAtMs: 10, count: 2 },
      retryAfterMs: 0,
    });
  });

  it("rejects quota accessors without invoking getters", () => {
    let getterInvoked = false;
    const accessorState = Object.defineProperties({}, {
      windowStartedAtMs: { enumerable: true, get: () => { getterInvoked = true; return 10; } },
      count: { enumerable: true, value: 1 },
    });
    expect(evaluateRateLimit(accessorState, 20, 3, 100)).toEqual({
      allowed: false, invalidState: true, nextState: null, retryAfterMs: 0,
    });
    expect(getterInvoked).toBe(false);
  });

  it("rejects symbol, hidden, extra, class-instance and hostile-proxy state shapes", () => {
    const symbolState = { windowStartedAtMs: 10, count: 1, [Symbol("extra")]: true };
    const hiddenState = { windowStartedAtMs: 10, count: 1 };
    Object.defineProperty(hiddenState, "hidden", { value: true, enumerable: false });
    const extraState = { windowStartedAtMs: 10, count: 1, other: true };
    class QuotaState {
      windowStartedAtMs = 10;
      count = 1;
    }
    const hostileState = new Proxy({ windowStartedAtMs: 10, count: 1 }, {
      ownKeys: () => { throw new Error("sensitive proxy detail"); },
    });

    for (const state of [symbolState, hiddenState, extraState, new QuotaState(), hostileState]) {
      expect(evaluateRateLimit(state, 20, 3, 100)).toEqual({
        allowed: false, invalidState: true, nextState: null, retryAfterMs: 0,
      });
    }
  });

  it("does not trust inherited quota fields", () => {
    const inherited = Object.create({ windowStartedAtMs: 10, count: 1 });
    expect(evaluateRateLimit(inherited, 20, 3, 100)).toEqual({
      allowed: false,
      invalidState: true,
      nextState: null,
      retryAfterMs: 0,
    });
  });

  it("keeps the original window and denies at the quota boundary", () => {
    expect(evaluateRateLimit({ windowStartedAtMs: 10, count: 3 }, 20, 3, 100)).toEqual({
      allowed: false,
      invalidState: false,
      nextState: null,
      retryAfterMs: 90,
    });
  });

  it("starts a new window only once the prior window has elapsed", () => {
    expect(evaluateRateLimit({ windowStartedAtMs: 10, count: 3 }, 110, 3, 100)).toEqual({
      allowed: true,
      invalidState: false,
      nextState: { windowStartedAtMs: 110, count: 1 },
      retryAfterMs: 0,
    });
  });
});
