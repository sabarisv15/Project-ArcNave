import '@testing-library/jest-dom/vitest';

// jsdom does not implement matchMedia; Radix and reduced-motion checks need it.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// This environment's jsdom does not expose the Storage API at all
// (verified directly: both `window.localStorage` and the bare global are
// undefined, even with a real non-opaque origin configured in
// vite.config.js). Node 22's own experimental `localStorage` global is
// also unavailable unless the process was started with
// --localstorage-file. So any test doing a bare
// `localStorage.removeItem(...)` crashed with "Cannot read properties of
// undefined" — one of the two root causes behind this project's
// long-standing pre-existing frontend test failures.
//
// A small in-memory Storage implementation is enough: the app only ever
// uses get/set/remove for UI preferences, and per-test isolation comes
// from each file getting a fresh module registry.
function createMemoryStorage() {
  let store = new Map();
  return {
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => store.set(String(key), String(value)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => {
      store = new Map();
    },
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
}

for (const name of ['localStorage', 'sessionStorage']) {
  if (!globalThis[name]) {
    const storage = createMemoryStorage();
    Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true });
    if (globalThis !== window) {
      Object.defineProperty(window, name, { value: storage, configurable: true, writable: true });
    }
  }
}

window.ResizeObserver =
  window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
