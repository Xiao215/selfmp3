const path = require('node:path')

module.exports = function (api) {
  api.cache(true)
  // babel-preset-expo already covers expo-router, Reanimated (if added later)
  // and the React Native transforms. Nothing else belongs here.
  //
  // Except Unistyles, which is not optional: its plugin rewrites every
  // `StyleSheet.create` call site so a theme or breakpoint change updates the
  // component without a re-render. Without it the styles simply do not react.
  // `root` is where it looks for components to process, relative to this file.
  // The router's screens live outside it, in app/, so that folder is named
  // too. Named by its whole path: the plugin takes any file whose path merely
  // *contains* an entry, and a bare 'app' took in every file under a checkout
  // whose folder name had "app" in it, node_modules included, rewriting
  // Unistyles' own imports of react-native into a cycle it could not load.
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'react-native-unistyles/plugin',
        {
          root: 'src',
          autoProcessPaths: [path.join(__dirname, 'app') + path.sep],
        },
      ],
    ],
  }
}
