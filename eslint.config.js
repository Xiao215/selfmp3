import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // Emitted declaration files from `tsc --build`; nothing to lint.
      '**/dist-types/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'library/**',
      '.claude/**',
      'data/**',
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
    files: ['**/*.config.js', '**/*.config.ts', 'scripts/**/*.js', 'scripts/**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { 'no-console': 'off' },
  },
  {
    /*
     * Tests and the service worker sit outside the app's tsconfig projects —
     * tests because they should not ship in the build output, sw.ts because it
     * needs the WebWorker lib rather than the DOM one (see tsconfig.sw.json).
     *
     * typescript-eslint's project service therefore cannot resolve types for
     * them, so type-aware rules are switched off here. Both are still fully
     * type-checked: tests by vitest, sw.ts by `npm run typecheck:sw`.
     */
    files: ['**/*.test.ts', '**/*.test.tsx', 'apps/web/src/sw.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  prettier,
)
