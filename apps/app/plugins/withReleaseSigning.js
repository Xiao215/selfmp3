/**
 * Sign Android release builds with the app's own key, when one is given.
 *
 * Android installs an update only over an app signed with the same key, so
 * every build shared with friends must carry the one key, for good: a build
 * signed with another means uninstalling first, and with it everything kept on
 * the phone. Expo's template signs a release build with the debug keystore it
 * generates, which is different on every machine that runs prebuild.
 *
 * The key is never in this public repository. The build is handed it as
 * Gradle properties, by apps/app/scripts/android-release.mjs from
 * ~/.android-signing/release.json, or in CI from the repository's secrets
 * (docs/MOBILE.md, "Sharing the Android app"). Without them a release build
 * keeps the debug keystore, which is fine for a phone of your own.
 */
const { withAppBuildGradle } = require('expo/config-plugins')

const RELEASE_CONFIG = `
        release {
            if (findProperty('selfmp3StoreFile')) {
                storeFile file(findProperty('selfmp3StoreFile'))
                storePassword findProperty('selfmp3StorePassword')
                keyAlias findProperty('selfmp3KeyAlias')
                keyPassword findProperty('selfmp3KeyPassword')
            }
        }`

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, mod => {
    let gradle = mod.modResults.contents
    if (gradle.includes('selfmp3StoreFile')) return mod
    const debugConfig = /(signingConfigs \{\s*debug \{[^}]*\})/
    const releaseSigning = /(release \{[^{}]*?)signingConfig signingConfigs\.debug/
    if (!debugConfig.test(gradle) || !releaseSigning.test(gradle)) {
      throw new Error('withReleaseSigning: app/build.gradle is not shaped as expected.')
    }
    gradle = gradle.replace(debugConfig, `$1${RELEASE_CONFIG}`)
    gradle = gradle.replace(
      releaseSigning,
      "$1signingConfig findProperty('selfmp3StoreFile') ? signingConfigs.release : signingConfigs.debug",
    )
    mod.modResults.contents = gradle
    return mod
  })
}
