import { DevSettings } from 'react-native'

/**
 * Start the app again, for a change that only takes effect at launch (the
 * theme).
 *
 * In a development build this reloads the JavaScript. A release build has no
 * way to do that without expo-updates, which the app does not use, so there
 * the change simply applies the next time the app is opened.
 */
export function reloadApp(): void {
  DevSettings.reload()
}
