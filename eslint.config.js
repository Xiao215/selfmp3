import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import base from './eslint.base.cjs'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // Emitted declaration files from `tsc --build`; nothing to lint.
      '**/dist-types/**',
      // Wrangler's bundles and local state, written while `wrangler dev` runs.
      '**/.wrangler/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      '.claude/**',
      /*
       * The app lints itself with eslint-config-expo (apps/app/eslint.config.js).
       * This config is type-aware and resolves types through the root tsconfig
       * project graph, which deliberately does not include apps/app: React
       * Native's globals and JSX types would leak into the server's.
       */
      'apps/app/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Shared with the app's config (eslint.base.cjs).
    rules: { ...base.rules, ...base.typeAwareRules },
  },
  {
    // Config files and scripts run outside the type-checked project graph.
    files: [
      '**/*.config.js',
      '**/*.config.ts',
      'eslint.base.cjs',
      'scripts/**/*.js',
      'scripts/**/*.mjs',
      // The shell's esbuild build and its development launcher: plain node,
      // outside every tsconfig, like the scripts above.
      'apps/desktop/scripts/**/*.mjs',
      // The extension's esbuild build, likewise.
      'apps/extension/scripts/**/*.mjs',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      // Plain node scripts: no tsconfig to read globals from, so name them.
      globals: { console: 'readonly', process: 'readonly', fetch: 'readonly', URL: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
  {
    // The rules shared with the app's config, in CommonJS because that config is.
    files: ['eslint.base.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable' } },
  },
  {
    /*
     * The owner's admin page (apps/server/src/admin/app.ts serves it).
     *
     * Plain browser JavaScript with no build step, which is the point of it —
     * the page you reach for when nothing else works should not be the thing
     * most likely to be broken. So it is in no tsconfig, and the type-aware
     * rules cannot run on it; the ordinary ones still do.
     */
    files: ['apps/server/admin/**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        crypto: 'readonly',
        document: 'readonly',
        Element: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        history: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLInputElement: 'readonly',
        localStorage: 'readonly',
        location: 'readonly',
        sessionStorage: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URLSearchParams: 'readonly',
        window: 'readonly',
      },
    },
  },
  {
    /*
     * Tests, and the fixtures they hand each other, sit outside every
     * workspace's tsconfig project, so that they do not ship in its build
     * output.
     *
     * typescript-eslint's project service therefore cannot resolve types for
     * them, so type-aware rules are switched off here.
     *
     * The tests are not type-checked: vitest transpiles them with esbuild and never checks their
     * types, so a test that does not compile fails when it runs rather than
     * when it is written. Checking them would want a tsconfig per workspace —
     * they cannot share one, for the same reason the workspaces cannot (see
     * the note in the root tsconfig.json).
     */
    files: base.testFiles,
    extends: [tseslint.configs.disableTypeChecked],
    rules: base.testRules,
  },
  prettier,
)
