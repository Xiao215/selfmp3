/**
 * The home-screen widget's Xcode target (docs/ui-mock `P28`), made by
 * `@bacons/apple-targets` on `expo prebuild`. Everything in this folder is the
 * target's; nothing in the generated `ios/` needs editing by hand.
 *
 * The App Group is how the app hands the widget its snapshot
 * (`src/ports/widget.ios.ts`); it must match `ios.entitlements` in
 * `app.config.js`, and be registered for both bundle ids before a signed build.
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
// The colours from @selfmp3/shared, as app.config.js takes the window's.
const {
  NATIVE_ACCENT,
  NATIVE_BACKGROUND,
  NATIVE_CARD,
  NATIVE_RAISED,
  NATIVE_TEXT_PRIMARY,
  NATIVE_TEXT_SECONDARY,
} = require('@selfmp3/shared')

module.exports = {
  type: 'widget',
  name: 'SelfMp3Widget',
  displayName: 'self.mp3',
  bundleIdentifier: '.widget',
  // `containerBackground` and a counting-down `Text(timerInterval:)` are iOS 17.
  deploymentTarget: '17.0',
  entitlements: {
    'com.apple.security.application-groups': ['group.com.selfmp3.app'],
  },
  colors: {
    // `S2`: the accent at its default hue, and a card's tone.
    $accent: NATIVE_ACCENT,
    $widgetBackground: NATIVE_CARD,
    // The words, the Play glyph on its white round, and a missing cover's square.
    inkPrimary: NATIVE_TEXT_PRIMARY,
    inkSecondary: NATIVE_TEXT_SECONDARY,
    ground: NATIVE_BACKGROUND,
    raised: NATIVE_RAISED,
  },
}
