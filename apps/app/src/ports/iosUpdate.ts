import { IOS_INSTALL_LINK, fetchIosLatest, type IosLatest } from '@selfmp3/shared'
import { requireOptionalNativeModule } from 'expo'
import Constants from 'expo-constants'
import { Linking, Platform } from 'react-native'

/**
 * The iPhone app, asking whether the shared build is newer than itself
 * (packages/shared/src/iosApp.ts).
 *
 * Offered in a release build on iOS only: a development build is a shell that
 * fetches its code from Metro, and a newer shared build is not its update.
 * `build` is this app's own build number, the commit count it was built at
 * (app.config.js). `install` opens the same install link as the install page,
 * and iOS asks before it replaces the app; it fails when iOS will not open
 * the link. iOS then downloads the build but puts it in only once this app
 * has left the screen, which `leave` does (`apps/app/modules/home-screen`).
 */
export interface IosUpdatePort {
  readonly offered: boolean
  readonly build: number
  latest(): Promise<IosLatest | null>
  install(): Promise<void>
  leave(): void
}

const homeScreen = requireOptionalNativeModule<{ leave(): void }>('HomeScreen')

export const iosUpdate: IosUpdatePort = {
  offered: Platform.OS === 'ios' && !__DEV__,
  build: Number(Constants.expoConfig?.ios?.buildNumber ?? Number.NaN),
  latest: () => fetchIosLatest(fetch),
  install: () => Linking.openURL(IOS_INSTALL_LINK),
  leave: () => homeScreen?.leave(),
}
