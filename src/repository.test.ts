import { describe, expect, it } from "vitest";
import { createInitialState } from "./demoData";
import { createDemoRepository } from "./repository";

function makeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
  return { storage: storage as Storage, values };
}

describe("demo repository", () => {
  it("loads initial synthetic data when storage is empty", () => {
    const { storage } = makeStorage();
    const state = createDemoRepository(storage).load();
    expect(state.campaigns).toHaveLength(1);
    expect(state.leads.length).toBeGreaterThan(0);
    expect(state.leads.every((lead) => lead.source === "demo")).toBe(true);
  });

  it("persists and reloads app state", () => {
    const { storage } = makeStorage();
    const repository = createDemoRepository(storage);
    const state = createInitialState();
    state.campaigns[0].name = "Test campaign";
    repository.save(state);
    expect(repository.load().campaigns[0].name).toBe("Test campaign");
  });

  it("migrates older saved leads to an explicit not-suppressed default", () => {
    const { storage } = makeStorage();
    const state = createInitialState();
    const legacy = { ...state, leads: state.leads.map(({ doNotContact: _ignored, ...lead }) => lead) };
    storage.setItem("anytrader-growth-engine.demo.v1", JSON.stringify(legacy));
    const loaded = createDemoRepository(storage).load();
    expect(loaded.leads.every((lead) => lead.doNotContact === false)).toBe(true);
  });

  it("recovers from malformed JSON", () => {
    const { storage } = makeStorage({ "anytrader-growth-engine.demo.v1": "{not-json" });
    expect(createDemoRepository(storage).load().campaigns).toHaveLength(1);
  });

  it("resets the demo storage key", () => {
    const { storage, values } = makeStorage();
    const repository = createDemoRepository(storage);
    repository.save(createInitialState());
    expect(values.has("anytrader-growth-engine.demo.v1")).toBe(true);
    repository.reset();
    expect(values.has("anytrader-growth-engine.demo.v1")).toBe(false);
  });

  it("works when storage is unavailable", () => {
    const repository = createDemoRepository(null);
    expect(repository.load().leads.length).toBeGreaterThan(0);
    expect(() => repository.save(createInitialState())).not.toThrow();
    expect(repository.reset().campaigns).toHaveLength(1);
  });
});
