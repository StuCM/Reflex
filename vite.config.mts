import { defineConfig, type Plugin } from 'vite';

/* Vite marks the entry `type="module"`, and Chromium 53 ignores a module
   script outright — a blank screen on the panel, with nothing in the console
   to say why. The bundle itself is already a classic IIFE because of
   rollupOptions.output.format below; only the tag is wrong. */
function classicScriptTag(): Plugin {
  return {
    name: 'reflex:classic-script-tag',
    enforce: 'post',
    transformIndexHtml(html) {
      return (
        html
          /* `defer` is not decoration. Vite puts the entry in <head>, and a
           module script is deferred by default while a classic one is not —
           without this the modules run before the DOM exists and every
           getElementById at load time returns null. */
          .replace(/<script type="module" crossorigin/g, '<script defer')
          /* crossorigin on a file:// stylesheet is a CORS failure on the panel. */
          .replace(/<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"')
      );
    },
  };
}

export default defineConfig({
  // The TV loads from file://, so Vite's default absolute /assets/… paths
  // would resolve to the filesystem root.
  base: './',
  plugins: [classicScriptTag()],
  build: {
    // Chromium 53 has no <script type="module"> (Chrome 61), so the output has
    // to be one classic script. Any code-splitting produces a bundle the panel
    // silently cannot load.
    target: 'chrome53',
    cssTarget: 'chrome53',
    outDir: 'build',
    // One stylesheet, linked rather than injected by script: the panel should
    // paint the shell before any JavaScript has run.
    cssCodeSplit: false,
    rollupOptions: {
      // iife implies no code splitting, which is the point: Chromium 53 has no
      // <script type="module"> (Chrome 61), so a second chunk could never load.
      output: { format: 'iife' },
    },
  },
});
