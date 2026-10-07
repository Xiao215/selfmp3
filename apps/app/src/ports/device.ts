import * as Crypto from 'expo-crypto'
import { Platform } from 'react-native'
import type { DeviceKind } from '@selfmp3/shared'

import { keepDeviceName, storedDeviceId, storedDeviceName, type DeviceWord } from './deviceIdentity'

/**
 * Who this device says it is.
 *
 * Knows what it is running on directly instead of sniffing the user agent.
 * The id and the name are kept as every device keeps them (`deviceIdentity.ts`).
 *
 * A port, and `Platform.OS` is read here because this is the one question that
 * genuinely is about the platform: what kind of thing am I, and what should I
 * be called in somebody else's device list. Everywhere else asks this file
 * rather than the operating system.
 */

export function getDeviceId(): string {
  // Hermes has no `crypto.getRandomValues`; expo-crypto asks the platform, as
  // `cloudPlatform.randomBytes` does for the sign-in attempt id.
  return storedDeviceId(length => Crypto.getRandomBytes(length))
}

export function getDeviceName(): string {
  return storedDeviceName() ?? defaultName()
}

export function setDeviceName(name: string): string {
  return keepDeviceName(name) ?? defaultName()
}

export function deviceKind(): DeviceKind {
  return Platform.OS === 'ios' || Platform.OS === 'android' ? 'phone' : 'desktop'
}

/** "iPhone" rather than a user agent: this app knows what it is running on. */
function defaultName(): string {
  // In another device's list an iPad is an iPad (docs/ui-mock `T09`: "except the words").
  if (Platform.OS === 'ios') return Platform.isPad ? 'iPad' : 'iPhone'
  if (Platform.OS === 'android') return 'Android'
  return 'self.mp3'
}

/**
 * What to call this device in a sentence: "on this iPad", "tells this phone".
 * The layout does not decide it: an iPad is wide enough for a computer's
 * layout and is still not a computer.
 */
export function deviceWord(_layout: { wide: boolean; finePointer: boolean }): DeviceWord {
  return Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'phone'
}
