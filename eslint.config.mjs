/* The rules oxlint does not have yet, and the layering.
 *
 * oxlint 1.82 implements neither `unicorn/name-replacements` nor
 * `typescript/naming-convention` nor `jsdoc/no-types` — and those are the three
 * this project actually asked for. So ESLint runs alongside it, over `src/`
 * only. Everything else lives in .oxlintrc.json.
 *
 * It also carries the layer rules, which replaced tools/check-layers.js in 030.
 * They want a resolved import rather than a line of text, which is why they are
 * here and not in a scan: the old one read `indexedDB` in a comment as a use of
 * it, and never saw `rules/rows.ts` importing `data/merge` at all.
 */
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import jsdocPlugin from 'eslint-plugin-jsdoc';

/* Settled 2026-09-13. `view/` may read what is already held but may not open a
   request: a cache read is free and the drawing code is what knows which tile is
   on screen, whereas a fetch from here is how you get calls nobody asked for.
   `core/` may reach `api/` for the debug beacon. `import/no-cycle` still guards
   the core/api pair, which this makes mutually permitted at layer granularity. */
const LAYERS = {
  core: ['api'],
  rules: ['core'],
  api: ['core', 'rules'],
  data: ['core', 'api', 'rules'],
  view: ['core', 'rules', 'data'],
  screen: ['core', 'api', 'data', 'rules', 'view'],
};
const ALL = Object.keys(LAYERS);

/* The crossings that were already there when the rule arrived, one line each,
   and the only imports the rule forgives. Removing one is a diff here; adding a
   sixteenth is a red build. docs/layering-debt.md is the same list as prose. */
const DEBT = [
  { file: 'src/api/plex/auth.ts', target: 'data', pulls: 'servers.forget' },
  { file: 'src/api/plex/client.ts', target: 'data', pulls: 'servers.load' },
  { file: 'src/api/plex/discovery.ts', target: 'data', pulls: 'servers.all/set/forget' },
  { file: 'src/api/plex/images.ts', target: 'data', pulls: 'servers.of' },
  { file: 'src/api/plex/library.ts', target: 'data', pulls: 'servers.stamp' },
  { file: 'src/data/devices.ts', target: 'view', pulls: 'dom.fill, dom.put' },
  { file: 'src/rules/rows.ts', target: 'data', pulls: 'merge.items, merge.stream' },
  /* Both of these are `library.tmdbId`, which parses a guid string and opens
     nothing. It is in api/ by misplacement; moving it to rules/ removes both
     entries rather than forgiving them. */
  { file: 'src/view/masthead.ts', target: 'api', pulls: 'library.tmdbId' },
  { file: 'src/view/rail.ts', target: 'api', pulls: 'library.tmdbId' },
  { file: 'src/view/sidebar.ts', target: 'screen', pulls: 'player.autoplayLabel' },
  { file: 'src/view/sidebar.ts', target: 'screen', pulls: 'showpage.themeLabel' },
];

const NO_XHR = { name: 'XMLHttpRequest', message: 'api/ opens requests. Go through api/http.' };
const NO_IDB = { name: 'indexedDB', message: 'data/ holds. Go through data/cached.' };
const NO_DOM = { name: 'document', message: 'no DOM here — draw it in view/.' };

const banBlock = (layer, alsoAllowed) => {
  const allowed = [layer].concat(LAYERS[layer], alsoAllowed);
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: ALL.filter((l) => allowed.indexOf(l) < 0).map((l) => ({
          group: [`**/${l}/*`, `**/${l}/**`],
          message: `${layer}/ must not import ${l}/ — the layering only goes downward.`,
        })),
      },
    ],
  };
};

const layerBlocks = ALL.map((layer) => ({
  files: [`src/${layer}/**/*.ts`],
  rules: banBlock(layer, []),
}));

const debtBlocks = [...new Set(DEBT.map((d) => d.file))].map((file) => ({
  files: [file],
  rules: banBlock(
    file.split('/')[1],
    DEBT.filter((d) => d.file === file).map((d) => d.target),
  ),
}));

export default tseslint.config(
  {
    /* `.blume/` is the runtime blume generates from docs/ on every build, and
       `dist/` is its output — neither is ours to lint. crew/ is a separate
       package carrying its own lint and formatter config. */
    ignores: [
      'node_modules/**',
      'build/**',
      'dist/**',
      'design/**',
      'js/**',
      'dev/**',
      'tools/**',
      '.blume/**',
      'crew/**',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true },
    },
    plugins: { unicorn, jsdoc: jsdocPlugin, '@typescript-eslint': tseslint.plugin },
    rules: {
      'unicorn/name-replacements': [
        'error',
        {
          checkFilenames: false,
          // A `for` header is the one place a single letter reads as itself.
          allowList: { i: true, j: true },
          replacements: {
            // Domain shorthand this codebase grew. The replacement is the word
            // the rest of the app already uses for the thing.
            st: { stream: true },
            md: { metadata: true },
            sec: { section: true },
            ep: { episode: true },
            gen: { generation: true },

            // Ordinary abbreviations, with somewhere to go.
            el: { element: true },
            elem: { element: true },
            fn: { callback: true },
            idx: { index: true },
            msg: { message: true },
            req: { request: true },
            res: { response: true },
            err: { error: true },
            val: { value: true },
            str: { text: true },

            // Words, not abbreviations. The rule flags them by default.
            id: false,
            src: false,
            args: false,
            props: false,
            ref: false,
            temp: false,
          },
        },
      ],

      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'typeProperty', format: null },
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'import', format: null },
      ],

      // A `@param {PlexPart}` in a TypeScript file is a second, unchecked copy
      // of the signature. The type is the documentation.
      'jsdoc/no-types': 'error',

      /* The DOM is built, not spelled. innerHTML with a value in it is an
         escaping bug waiting to happen and reparses the subtree; a style
         written from JavaScript is a design decision that has escaped the
         stylesheet. Both have an answer: createElement/textContent, and a
         class. Where a value really is computed per frame — a scroll offset, a
         progress width — set a custom property and let CSS use it. */
      /* Chromium 53 has neither. They read so much like ordinary DOM that
         nothing catches them: `lib` governs ES built-ins, and the DOM lib is
         one unversioned blob. src/view/dom.ts is the way through. */
      'no-restricted-properties': [
        'error',
        { property: 'replaceChildren', message: 'Chrome 86. Use fill() from view/dom.' },
        { property: 'append', message: 'Chrome 54. Use put() from view/dom.' },
        { property: 'prepend', message: 'Chrome 54. Use insertBefore.' },
      ],

      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message:
            'Build nodes: createElement and textContent. innerHTML re-parses and cannot escape.',
        },
        {
          selector:
            "AssignmentExpression[left.object.property.name='style'][left.property.name!='cssText']",
          message:
            'Use a class. For a per-frame value, style.setProperty("--name", …) and let CSS read it.',
        },
      ],
    },
  },
  {
    /* The one file allowed to say `appendChild` and friends. */
    files: ['src/view/dom.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },

  {
    /* The half of the layering that is a global rather than an import, so the
       layer blocks below cannot see it: api/ is the only place an XHR is
       opened, data/ the only place the store is addressed. */
    files: ['src/**/*.ts'],
    rules: { 'no-restricted-globals': ['error', NO_XHR, NO_IDB] },
  },
  {
    /* rules/ is the pure half, and api/ speaks to servers, not to the screen. */
    files: ['src/rules/**/*.ts', 'src/api/**/*.ts'],
    rules: { 'no-restricted-globals': ['error', NO_XHR, NO_IDB, NO_DOM] },
  },
  {
    /* The two files whose whole job is the thing their layer owns. */
    files: ['src/api/http.ts'],
    rules: { 'no-restricted-globals': ['error', NO_IDB, NO_DOM] },
  },
  {
    files: ['src/data/store.ts'],
    rules: { 'no-restricted-globals': ['error', NO_XHR] },
  },

  ...layerBlocks,
  ...debtBlocks,
);
