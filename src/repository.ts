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

export function createDemoRepository(storage: Storage | null = typeof window === "undefined" ? null : window.localStorage): DemoRepository {
  return {
    load() {
      if (!storage) return createInitialState();
      try {
        const raw = storage.getItem(STORAGE_KEY);
        if (!raw) return createInitialState();
        const parsed: unknown = JSON.parse(raw);
        return isAppState(parsed) ? parsed : createInitialState();
      } catch {
        // Demo mode should recover gracefully from unavailable storage or invalid data.
        return createInitialState();
      }
    },
    save(state) {
      if (!storage) return;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Storage may be blocked or full. The in-memory UI still remains usable.
      }
    },
    reset() {
      const state = createInitialState();
      if (storage) {
        try { storage.removeItem(STORAGE_KEY); } catch { /* best-effort demo reset */ }
      }
      return state;
    },
  };
}
