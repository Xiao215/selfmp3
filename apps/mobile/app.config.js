/**
 * Expo config for the self.mp3 native app.
 *
 * Written as JS rather than JSON so the non-obvious entries can carry the
 * reason they exist. Everything here feeds `expo prebuild`, which is what
 * generates ios/ and android/ — those folders are not committed.
 *
 * @type {import('@expo/config-types').ExpoConfig}
 */
const config = {
  name: 'self.mp3',
  slug: 'selfmp3',
  scheme: 'selfmp3',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  backgroundColor: '#14121a',

  ios: {
    bundleIdentifier: 'com.selfmp3.app',
    supportsTablet: true,
    infoPlist: {
      // Background audio. Without this the player stops the moment the screen
      // locks, which is most of what this app is for.
      UIBackgroundModes: ['audio'],
      // The server is a Tailscale hostname on a private network over plain
      // HTTP. ATS has to allow that or every request fails silently.
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
    },
  },

  android: {
    package: 'com.selfmp3.app',
    // FOREGROUND_SERVICE* come from react-native-track-player's own manifest;
    // these two are ours: network access and the wake lock the player holds
    // while the screen is off.
    permissions: ['android.permission.INTERNET', 'android.permission.WAKE_LOCK'],
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#14121a',
        imageWidth: 160,
      },
    ],
    // Adds the CarPlay entitlement, the CarPlay scene manifest and the scene
    // delegate that hands control to react-native-carplay. See
    // plugins/withCarPlay.js and docs/MOBILE.md — Apple must grant the
    // entitlement before a build using it will install on a real device.
    './plugins/withCarPlay',
    // Android blocks cleartext HTTP in release builds; the server is a
    // Tailscale host on plain HTTP. See the plugin for the reasoning.
    './plugins/withCleartextTraffic',
  ],

  experiments: {
    typedRoutes: false,
  },
}

module.exports = config
