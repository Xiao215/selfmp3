import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // The web app built for GitHub Pages, when built locally to try it.
      '**/dist-pages/**',
      // Emitted declaration files from `tsc --build`; nothing to lint.
      '**/dist-types/**',
      // Wrangler's bundles and local state, written while `wrangler dev` runs.
      '**/.wrangler/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'library/**',
      '.claude/**',
      'data/**',
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
    rules: {
      // Unused vars are errors, but a leading underscore is an explicit opt-out.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Prefer `import type` so type-only imports are erased at build time.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      // Floating promises are the #1 source of silent failures in async servers.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Config files and scripts run outside the type-checked project graph.
    files: [
      '**/*.config.js',
      '**/*.config.ts',
      'scripts/**/*.js',
      'scripts/**/*.mjs',
      'verify/**/*.mjs',
      // The shell's esbuild build and its development launcher: plain node,
      // outside every tsconfig, like the scripts above.
      'apps/desktop/scripts/**/*.mjs',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      // Plain node scripts: no tsconfig to read globals from, so name them.
      globals: { console: 'readonly', process: 'readonly', fetch: 'readonly', URL: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
  {
    /*
     * Tests and the service worker sit outside the app's tsconfig projects —
     * tests because they should not ship in the build output, sw.ts because it
     * needs the WebWorker lib rather than the DOM one (see tsconfig.sw.json).
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
    files: ['**/*.test.ts', '**/*.test.tsx'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  prettier,
)
