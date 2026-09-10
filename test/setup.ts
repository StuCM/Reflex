/* What a module still in js/ expects to find around it.
 *
 * Those files end with `window.X = X`, and several ask the DOM or localStorage
 * a question at load. None of it is what the tests are checking, so it is
 * stubbed rather than emulated — no jsdom, and nothing here grows a feature.
 * Every stub disappears with the last js/ file that needs it.
 */
const store: Record<string, string> = {};

const stubs = {
  /* Pointing window at the global object is what a browser does, so a bare
     `Media` inside a legacy module resolves the same way here. */
  window: globalThis,

  /* js/core/panel.js asks a video element what it can play. In Node it answers
     nothing, and the baseline profile applies — which is what the tests are
     written against. */
  document: {
    getElementById: () => ({ canPlayType: () => '' }),
    createElement: () => ({ canPlayType: () => '' }),
  },

  localStorage: {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  },
};

Object.keys(stubs).forEach((name) => {
  if (name in globalThis) return;
  const value = stubs[name as keyof typeof stubs];
  Object.defineProperty(globalThis, name, { value, writable: true });
});
