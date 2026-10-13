// The rules the root config and the app's share, written once.
//
// The two configs cannot be one: the root is type-aware through the root
// tsconfig graph, which leaves apps/app out, and the app lints itself with
// eslint-config-expo (apps/app/eslint.config.js). They differed by copy: the
// app had no `consistent-type-imports`, no `no-import-type-side-effects` and
// no test override. Each now takes these from here. CommonJS, because the
// app's config is; the root's ESM imports it all the same.

/** Every file, either config. The `@typescript-eslint` ones need its plugin registered. */
const rules = {
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
  'no-console': ['warn', { allow: ['warn', 'error'] }],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
}

/** The type-aware two, for wherever a tsconfig project can place the file. */
const typeAwareRules = {
  // Floating promises are the #1 source of silent failures in async servers.
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
}

/** Tests, and the fixtures they hand each other. */
const testFiles = ['**/*.test.ts', '**/*.test.tsx', '**/src/**/fixtures/**/*.ts']

/** What a test may do that the code under test may not. */
const testRules = {
  '@typescript-eslint/no-non-null-assertion': 'off',
  'no-console': 'off',
  // A `jest.mock` factory is hoisted above every import and may not reach one,
  // so a test names a module's type as `typeof import('…')` in place.
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
  ],
}

module.exports = { rules, typeAwareRules, testFiles, testRules }
