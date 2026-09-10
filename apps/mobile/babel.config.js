module.exports = function (api) {
  api.cache(true)
  // babel-preset-expo already covers expo-router, Reanimated (if added later)
  // and the React Native transforms. Nothing else belongs here.
  return { presets: ['babel-preset-expo'] }
}
