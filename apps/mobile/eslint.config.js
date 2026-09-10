// The mobile app lints itself.
//
// The root config is type-aware and points at the Node/DOM tsconfig projects;
// running it over React Native source would either fail to resolve types or
// drag RN's globals into the web app's type graph. eslint-config-expo already
// knows about the RN globals, JSX and the import resolver, so the mobile
// workspace uses that instead and the root config ignores apps/mobile.

const expoConfig = require('eslint-config-expo/flat')
const typescript = require('@typescript-eslint/eslint-plugin')

module.exports = [
  ...expoConfig,
  {
    ignores: ['node_modules/**', 'ios/**', 'android/**', '.expo/**', 'expo-env.d.ts'],
  },
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
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
