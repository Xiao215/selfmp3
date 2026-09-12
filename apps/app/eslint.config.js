// The universal app lints itself.
//
// The root config is type-aware and points at the Node/DOM tsconfig projects;
// running it over React Native source would either fail to resolve types or
// drag RN's globals into the web app's type graph. eslint-config-expo already
// knows about the RN globals, JSX and the import resolver, so this workspace
// uses that instead and the root config ignores apps/app.

const expoConfig = require('eslint-config-expo/flat')
const typescript = require('@typescript-eslint/eslint-plugin')

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'node_modules/**',
      'ios/**',
      'android/**',
      '.expo/**',
      'expo-env.d.ts',
      // `expo export` output. Linting a 1.6MB Metro bundle finds thousands of
      // problems in other people's code and none in ours.
      'dist/**',
      // Playwright's traces and screenshots from a failed run.
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Node scripts under verify/ run outside the app: Playwright's runner and
    // plain `node` both give them Node's globals, which eslint-config-expo does
    // not assume because the app itself has none of them.
    files: ['verify/**/*.ts', 'verify/**/*.mjs', 'verify/**/*.js', '*.config.ts'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Same unused-variable convention as the root config: an error, with a
    // leading underscore as the explicit opt-out.
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': typescript },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
]
