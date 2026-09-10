import { defineConfig } from 'vite';

export default defineConfig({
  // The TV loads from file://, so Vite's default absolute /assets/… paths
  // would resolve to the filesystem root.
  base: './',
  build: {
    // Chromium 53 has no <script type="module"> (Chrome 61), so the output has
    // to be one classic script. Any code-splitting produces a bundle the panel
    // silently cannot load.
    target: 'chrome53',
    cssTarget: 'chrome53',
    outDir: 'build',
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true },
    },
  },
});
