/* The names src/seam.ts puts on `window` for the smoke suite. Ambient by
   necessity: the consumers are page.evaluate strings, not modules. */

interface Window {
  Art: typeof import('../src/data/art');
  Merge: typeof import('../src/data/merge');
  ShowPage: typeof import('../src/screen/showpage');
  Sidebar: typeof import('../src/view/sidebar');
  Grid: typeof import('../src/view/grid');
  Legend: typeof import('../src/view/legend');
  Menu: typeof import('../src/view/menu');
  Tabs: typeof import('../src/view/tabs');
  Config: typeof import('../src/core/config').default;
}
