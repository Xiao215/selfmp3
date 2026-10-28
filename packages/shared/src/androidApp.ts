import {
  fetchPhoneBuild,
  phoneBuildSchema,
  releaseAssetUrl,
  type PhoneBuild,
} from './phoneBuilds.js'

/**
 * The Android app for friends: one APK, signed with the app's own key
 * (apps/app/plugins/withReleaseSigning.js), downloaded from the install page
 * and installed by the phone's own installer. No list of phones, no expiry:
 * any Android phone takes it once it allows installs from the browser. The
 * release is `android`, built by `apps/app/scripts/android-release.mjs`
 * (phoneBuilds.ts has what both phones share).
 */

export const ANDROID_RELEASE_TAG = 'android'

export const ANDROID_ASSETS = {
  app: 'selfmp3.apk',
  latest: 'android.json',
} as const

export const androidAssetUrl = (name: string): string => releaseAssetUrl(ANDROID_RELEASE_TAG, name)

/** The APK itself: what the install page's Download button and the app's updater fetch. */
export const ANDROID_DOWNLOAD_URL = androidAssetUrl(ANDROID_ASSETS.app)

export const fetchAndroidLatest = (fetchImpl: typeof fetch = fetch): Promise<PhoneBuild | null> =>
  fetchPhoneBuild(androidAssetUrl(ANDROID_ASSETS.latest), phoneBuildSchema, fetchImpl)
