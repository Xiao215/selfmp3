/**
 * Allow cleartext HTTP on Android, in release builds too.
 *
 * The server is a Mac on a Tailscale network, reached over plain HTTP at a
 * `*.ts.net` name. Android blocks cleartext traffic by default from API 28
 * onwards, and Expo's template only relaxes it in the *debug* manifest — so
 * without this the app works in development and then silently fails to load
 * anything in a release build, which is a miserable way to find out.
 *
 * Tailscale is the encryption boundary here; there is no public exposure to
 * protect. The iOS equivalent is `NSAllowsArbitraryLoads` in app.config.js.
 */
const { withAndroidManifest } = require('expo/config-plugins')

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, mod => {
    const application = mod.modResults.manifest.application?.[0]
    if (application) application.$['android:usesCleartextTraffic'] = 'true'
    return mod
  })
}
