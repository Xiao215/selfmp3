import {
  ANDROID_ASSETS,
  ANDROID_DOWNLOAD_URL,
  IOS_INSTALL_LINK,
  fetchAndroidLatest,
  fetchIosLatest,
  type PhoneBuild,
} from '@selfmp3/shared'
import { requireOptionalNativeModule } from 'expo'
import Constants from 'expo-constants'
import { File, Paths } from 'expo-file-system'
import { startActivityAsync } from 'expo-intent-launcher'
import { Linking, Platform } from 'react-native'

/**
 * The phone app, asking whether the shared build is newer than itself, and
 * handing it to the system to install (packages/shared/src/phoneBuilds.ts).
 *
 * Offered in a release build on a phone only: a development build is a shell
 * that fetches its code from Metro, and a newer shared build is not its
 * update. `build` is this app's own build number, the commit count it was
 * built at (app.config.js).
 *
 * `install` calls `handed` once the system has the build, and settles:
 * - on iOS, once it has opened the same install link as the install page;
 *   iOS asks before it replaces the app, then downloads the build but puts it
 *   in only once this app has left the screen, which `leave` does
 *   (`apps/app/modules/home-screen`).
 * - on Android, after downloading the APK and opening the system's installer
 *   with it, once the installer closes with this app still running — which
 *   means it did not go in: putting it in ends this app first. `leave` does
 *   nothing.
 * It fails when the system will not open the link, or the download fails.
 * `downloads` says which of the two it is, and `browser` is what opens the
 * install page, for the words around it.
 */
export interface AppUpdatePort {
  readonly offered: boolean
  readonly build: number
  readonly downloads: boolean
  readonly browser: string
  latest(): Promise<PhoneBuild | null>
  install(handed: () => void): Promise<void>
  leave(): void
}

const homeScreen = requireOptionalNativeModule<{ leave(): void }>('HomeScreen')

/** Intent.FLAG_GRANT_READ_URI_PERMISSION: the installer may read the file it is given. */
const GRANT_READ = 1

const ios: AppUpdatePort = {
  offered: !__DEV__,
  build: Number(Constants.expoConfig?.ios?.buildNumber ?? Number.NaN),
  downloads: false,
  browser: 'Safari',
  latest: () => fetchIosLatest(fetch),
  install: async handed => {
    await Linking.openURL(IOS_INSTALL_LINK)
    handed()
  },
  leave: () => homeScreen?.leave(),
}

const android: AppUpdatePort = {
  offered: !__DEV__,
  build: Number(Constants.expoConfig?.android?.versionCode ?? Number.NaN),
  downloads: true,
  browser: 'your browser',
  latest: () => fetchAndroidLatest(fetch),
  install: async handed => {
    const apk = await File.downloadFileAsync(
      ANDROID_DOWNLOAD_URL,
      new File(Paths.cache, ANDROID_ASSETS.app),
      { idempotent: true },
    )
    handed()
    await startActivityAsync('android.intent.action.VIEW', {
      data: apk.contentUri,
      type: 'application/vnd.android.package-archive',
      flags: GRANT_READ,
    })
  },
  leave: () => {},
}

export const appUpdate: AppUpdatePort = Platform.OS === 'ios' ? ios : android
