import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Keep storage deterministic across supported Node versions. Node 22 can
// otherwise expose an unusable getter unless --localstorage-file is configured.
const storageValues = new Map<string, string>();
const testStorage = {
  get length() {
    return storageValues.size;
  },
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  removeItem: (key: string) => storageValues.delete(key),
  setItem: (key: string, value: string) => storageValues.set(key, value),
};
Object.defineProperty(window, 'localStorage', { configurable: true, value: testStorage });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: testStorage });

afterEach(() => {
  cleanup();
});

// jsdom lacks matchMedia; stub it so components that read it don't crash.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Silence/stub Tauri's invoke in unit tests. Individual tests can override.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
