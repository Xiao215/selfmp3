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
      // The bundled service worker; sw/sw.ts is its source and is linted.
      'public/sw.js',
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
    // Config files run under Node, which gives them Node's globals;
    // eslint-config-expo does not assume those because the app itself has none.
    files: ['*.config.ts'],
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
  {
    // Jest's globals, for the component tests and their setup. The model tests
    // are vitest's and import theirs, which is why this is only `*.test.tsx`
    // and the one setup file.
    files: ['**/*.test.tsx', 'jest.setup.js', 'jest.config.js'],
    languageOptions: {
      globals: {
        jest: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        module: 'writable',
        require: 'readonly',
      },
    },
  },
  {
    // docs/ARCHITECTURE.md foundation 3, enforced.
    //
    // A model file holds a feature's state and behaviour and draws nothing, so
    // vitest can run it in milliseconds with no simulator and no browser. The
    // moment one imports `react-native` or a component that stops being true —
    // silently, because the screen still works. This is the rule that notices.
    files: ['**/*.model.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              message:
                'A model file draws nothing. Keep react-native in the screen; vitest has to be able to run this file.',
            },
          ],
          patterns: [
            {
              group: ['react-native-*', 'expo', 'expo-*', '@expo/*'],
              message:
                'A model file draws nothing and touches no native module. Pass what you need in as an argument.',
            },
            {
              group: ['**/ui/**', '**/components/**', '**/shell/**', '**/ports/**'],
              message: 'A model file imports no UI and no port. The screen wires those to it.',
            },
          ],
        },
      ],
    },
  },
  {
    // docs/ARCHITECTURE.md foundation 2, enforced.
    //
    // Screens read a port's declared capabilities, never the platform. The two
    // places allowed to ask which platform this is are the ports themselves and
    // the shell, because deciding that is their whole job.
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['src/ports/**', 'src/shell/**', '*.config.js', '*.config.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Platform',
          property: 'OS',
          message:
            'Screens do not read the platform. Put the difference behind a port in src/ports, or a width in src/shell.',
        },
        {
          object: 'Platform',
          property: 'select',
          message:
            'Same rule: `Platform.select` is `Platform.OS` with a nicer face. Put the difference behind a port in src/ports.',
        },
      ],
    },
  },
  {
    /*
     * The three style properties that are a browser's alone and do nothing at
     * all on a phone — silently, which is how each of them has already cost a
     * visible bug here: a progress wash with no fade, a tab bar you could read
     * the page through, and a cover glow that drew as three hard discs.
     *
     * `boxShadow`, `transformOrigin` and `cursor` are deliberately not on this
     * list. React Native implements the first two, and `cursor` is inert
     * rather than wrong; the design system uses `boxShadow` on purpose
     * (docs/features/design-system.md).
     */
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/*.web.ts', '**/*.web.tsx', '*.config.js', '*.config.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // A CSS filter is always a string; the library's own `filter` field
          // never is, which is why the value is part of the test.
          selector:
            "Property[key.name='filter'][value.type=/^(Literal|TemplateLiteral)$/], Property[key.name=/^(backdropFilter|WebkitBackdropFilter|WebkitFilter)$/]",
          message:
            "A CSS filter is a browser's and does nothing on a phone. Put it behind a port (src/ports/blurLayer.ts), or draw the effect rather than filtering it.",
        },
      ],
    },
  },
]
