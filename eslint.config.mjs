/* The rules oxlint does not have yet, and nothing else.
 *
 * oxlint 1.82 implements neither `unicorn/name-replacements` nor
 * `typescript/naming-convention` nor `jsdoc/no-types` — and those are the three
 * this project actually asked for. So ESLint runs alongside it, over `src/`
 * only, configured to exactly these. It deletes itself the day oxlint ships
 * them. Everything else lives in .oxlintrc.json.
 */
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import jsdocPlugin from 'eslint-plugin-jsdoc';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'build/**', 'dist/**', 'design/**', 'js/**', 'dev/**', 'tools/**'],
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
        { selector: 'default', format: ['camelCase'] },
        { selector: 'variable', format: ['camelCase', 'UPPER_CASE'] },
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'typeProperty', format: null },
        { selector: 'objectLiteralProperty', format: null },
        { selector: 'import', format: null },
      ],

      // A `@param {PlexPart}` in a TypeScript file is a second, unchecked copy
      // of the signature. The type is the documentation.
      'jsdoc/no-types': 'error',
    },
  },
  {
    /* The bridge exists to publish `Media`, `Subs` and `Rows` under the exact
       names js/ still calls them by. Renaming them to satisfy a convention
       would break the thing the file is for. */
    files: ['src/legacy.ts'],
    rules: { '@typescript-eslint/naming-convention': 'off' },
  },
);
