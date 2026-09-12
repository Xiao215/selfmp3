module.exports = function (api) {
  api.cache(true)
  // babel-preset-expo already covers expo-router, Reanimated (if added later)
  // and the React Native transforms. Nothing else belongs here.
  //
  // Except Unistyles, which is not optional: its plugin rewrites every
  // `StyleSheet.create` call site so a theme or breakpoint change updates the
  // component without a re-render. Without it the styles simply do not react.
  // `root` is where it looks for components to process, relative to this file.
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'react-native-unistyles/plugin',
        {
          root: 'src',
          autoProcessPaths: ['app'],
        },
      ],
    ],
  }
}
