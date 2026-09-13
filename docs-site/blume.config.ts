import { defineConfig } from 'blume';

/* The content root is the repository's own `docs/`, not a copy inside this
   directory. A docs site that holds its own duplicate of the backlog is a
   second backlog, and the two drift the week they are written. */
export default defineConfig({
  title: 'Reflex',
  description: 'A browse-fast Plex client for a 2018 LG OLED, and the record of how it is built.',
  content: { root: '../docs' },
  deployment: {
    /* GitHub Pages serves a project repo from a subdirectory, so `base` is not
       optional here: without it every internal link resolves to the domain root
       and 404s. */
    site: 'https://stucm.github.io',
    base: '/Reflex',
  },
});
