import type { AppState } from "./domain";
import { createInitialState } from "./demoData";

const STORAGE_KEY = "anytrader-growth-engine.demo.v1";

export interface DemoRepository {
  load(): AppState;
  save(state: AppState): void;
  reset(): AppState;
}

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppState>;
  return Array.isArray(candidate.campaigns)
    && Array.isArray(candidate.leads)
    && Array.isArray(candidate.drafts)
    && Array.isArray(candidate.activities);
}

export function createDemoRepository(storage?: Storage | null): DemoRepository {
  const getStorage = (): Storage | null => {
    if (storage !== undefined) return storage;
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  };

  return {
    load() {
      const target = getStorage();
      if (!target) return createInitialState();
      try {
        const raw = target.getItem(STORAGE_KEY);
        if (!raw) return createInitialState();
        const parsed: unknown = JSON.parse(raw);
        return isAppState(parsed) ? parsed : createInitialState();
      } catch {
        return createInitialState();
      }
    },
    save(state) {
      const target = getStorage();
      if (!target) return;
      try {
        target.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Storage may be blocked or full. The in-memory UI still remains usable.
      }
    },
    reset() {
      const state = createInitialState();
      const target = getStorage();
      if (target) {
        try { target.removeItem(STORAGE_KEY); } catch { /* best-effort demo reset */ }
      }
      return state;
    },
  };
}
