import { devicePlace, type DevicePlace } from '../features/settings/settings.model'
import { deviceKind } from './device'
import { installedApp } from './install'

/**
 * Where this device keeps songs, as the words for it ("isn't on this
 * browser", "Remove from this phone"): `devicePlace` for the device as it is.
 */
export function thisPlace(): DevicePlace {
  return devicePlace(deviceKind(), installedApp)
}
