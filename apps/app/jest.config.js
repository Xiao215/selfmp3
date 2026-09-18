// Component tests, which vitest cannot run.
//
// docs/UNIVERSAL.md foundation 8: tests at the layer that can run them. Pure
// logic and model files are vitest's, and they are the fast ones — no React at
// all. Anything that renders needs a React Native renderer, and vitest has no
// way to be one yet, so jest-expo and React Native Testing Library take the
// primitives and (later) the screens.
//
// It deliberately does NOT pick up `*.model.test.ts`: those are vitest's, they
// run in milliseconds, and running them twice under two runners would make the
// model rule meaningless.
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Reanimated in a test: the worklets package resolves to its JavaScript
  // half rather than the `.native` one that installs a native runtime, so a
  // shared value and `useAnimatedStyle` run in-process (the song visual).
  resolver: require.resolve('react-native-worklets/jest/resolver'),
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@shopify/flash-list|react-native-unistyles|react-native-nitro-modules)',
  ],
}
