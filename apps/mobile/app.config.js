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

  // Rendered from apps/web/public/icons/icon.svg, so the phone and the web app
  // wear the same mark. Square and opaque, because iOS rounds and masks it
  // itself and rejects an icon with an alpha channel.
  icon: './assets/icon.png',

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
    // The same mark with its background dropped: Android masks the foreground
    // to whatever shape the launcher uses and paints this colour behind it.
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#14121a',
    },
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
    // plugins/withCarPlay.js and docs/MOBILE.md.
    //
    // Off unless SELFMP3_CARPLAY is set, because `carplay-audio` is an
    // entitlement Apple grants on request and only to a paid team. Left on,
    // the first build signed for a device fails on a provisioning error about
    // an entitlement the developer never asked for — a confusing way to
    // discover a policy. src/car/carplay.ts already does nothing when the
    // native module is absent, so the app is unaffected either way.
    ...(process.env.SELFMP3_CARPLAY ? ['./plugins/withCarPlay'] : []),
    // Android blocks cleartext HTTP in release builds; the server is a
    // Tailscale host on plain HTTP. See the plugin for the reasoning.
    './plugins/withCleartextTraffic',
  ],

  experiments: {
    typedRoutes: false,
  },
}

module.exports = config
