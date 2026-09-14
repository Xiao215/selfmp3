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

  // Rendered from public/icons/icon.svg, so the phone and the web build
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
      /*
       * The iPad turns; the iPhone does not.
       *
       * `orientation: 'portrait'` above stays as it is. Expo's plugin writes
       * only `UISupportedInterfaceOrientations`, which iOS reads on a phone,
       * and never touches the `~ipad` key — so the two can disagree, which is
       * exactly what is wanted. A phone held sideways gets a layout drawn for a
       * hand; an iPad sideways gets the desktop layout it has the room for.
       *
       * Upside-down is in the list because an iPad has no wrong way up: the
       * home indicator moves and the camera is wherever you left it.
       *
       * `ios.requireFullScreen` stays at its default, false, which is what lets
       * the app be split-screened at all. Apple deprecated `UIRequiresFullScreen`
       * in iPadOS 26 (TN3192), and iPadOS 26 rotates an iPad regardless of this
       * mask when rotation lock is off — so these keys are for older iPads and
       * for the App Store's multitasking rule, not a switch the app relies on.
       *
       * No `expo-screen-orientation`: a static mask needs no module, and
       * react-native-screens 4.23+ conflicts with its lock.
       */
      'UISupportedInterfaceOrientations~ipad': [
        'UIInterfaceOrientationPortrait',
        'UIInterfaceOrientationPortraitUpsideDown',
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
      ],
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
    // Android blocks cleartext HTTP in release builds; the server is a
    // Tailscale host on plain HTTP. See the plugin for the reasoning.
    './plugins/withCleartextTraffic',
  ],

  /**
   * Values the app reads at runtime through `expo-constants`.
   *
   * The doorman is the one thing the phone cannot work out for itself: the web
   * app gets it from a Vite variable and the Mac from its environment, and a
   * binary has neither. Set SELFMP3_DOORMAN_URL when building to point a copy
   * at your own; left alone it is the one in packages/shared/src/cloud.ts.
   */
  extra: {
    // Spread rather than `?? null`: Expo serialises a null in `extra` as `{}`,
    // which is not null, so a `??` fallback downstream never fires and the
    // address becomes the string "[object Object]". Absent is the only way to
    // say absent here.
    ...(process.env.SELFMP3_DOORMAN_URL ? { doormanUrl: process.env.SELFMP3_DOORMAN_URL } : {}),
  },

  /**
   * The web target. `bundler: 'metro'` is what makes this the same bundle the
   * phone runs rather than a second toolchain; `output: 'single'` keeps it a
   * single-page app, because `playlist/[id]` cannot be pre-rendered for ids
   * that only exist at runtime (see docs/UNIVERSAL.md, "does not port").
   */
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/icon.png',
  },

  experiments: {
    typedRoutes: false,
    // GitHub Pages serves the app from /selfmp3/ rather than the root, and the
    // Mac serves the same build from /. One build cannot be both, so the path
    // is a build-time variable: unset for the Mac, /selfmp3 for Pages. This is
    // the replacement for the web app's VITE_BASE.
    ...(process.env.EXPO_PUBLIC_BASE ? { baseUrl: process.env.EXPO_PUBLIC_BASE } : {}),
  },
}

module.exports = config
