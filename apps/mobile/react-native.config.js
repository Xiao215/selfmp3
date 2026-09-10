/**
 * Autolinking overrides.
 *
 * react-native-carplay ships an Android implementation too, but it targets the
 * Car App Library (the API for navigation, parking and messaging apps).
 * Android Auto does not accept that API for media apps — a music app has to
 * expose a MediaBrowserService, which is react-native-track-player's job here.
 * Its Android module is therefore dead weight, and it still pulls `jcenter()`
 * into the build script, which no longer exists.
 *
 * Linking it on iOS only keeps the Android build clean and loses nothing.
 */
module.exports = {
  dependencies: {
    'react-native-carplay': {
      platforms: {
        android: null,
      },
    },
  },
}
