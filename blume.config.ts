import { defineConfig } from 'blume';

export default defineConfig({
  title: 'Reflex',
  description: 'A browse-fast Plex client for a 2018 LG OLED, and the record of how it is built.',
  deployment: {
    /* GitHub Pages serves a project repo from a subdirectory. Without `base`
       every internal link resolves to the domain root and 404s. */
    site: 'https://stucm.github.io',
    base: '/Reflex',
  },
});
