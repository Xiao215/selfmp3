import { prefs } from '../../ports/prefs'
import { createValueStore } from '../../state/valueStore.model'
import { useValueStore } from '../../state/useValueStore'

/**
 * This browser's two switches for downloading songs itself
 * (docs/features/client-download.md), each a preference of the device, as
 * crossfade is (`crossfadePref.ts`): it is this browser that downloads, and
 * the answer is wanted before any server is asked.
 *
 * - **Downloads here**: YouTube songs are looked up, heard and downloaded in
 *   this browser when the extension answers. On by default.
 * - **Hand back when refused**: when YouTube refuses this browser for rate,
 *   what it has not downloaded yet goes to the server, and so does what is
 *   imported while the refusal lasts. Off, this browser waits the refusal out
 *   and downloads them itself. On by default.
 */

const DOWNLOADS_KEY = 'deviceDownloads'
const HAND_BACK_KEY = 'deviceHandBack'

/** Stored as `on`/`off`; anything else is the default, on. */
const readOn = (key: string): boolean => prefs.get(key) !== 'off'

const downloads = createValueStore(readOn(DOWNLOADS_KEY))
const handBack = createValueStore(readOn(HAND_BACK_KEY))

export function setDeviceDownloads(on: boolean): void {
  prefs.set(DOWNLOADS_KEY, on ? 'on' : 'off')
  downloads.set(on)
}

export function setDeviceHandBack(on: boolean): void {
  prefs.set(HAND_BACK_KEY, on ? 'on' : 'off')
  handBack.set(on)
}

/** Whether this browser downloads songs itself; read where no component is. */
export const deviceDownloadsOn = (): boolean => downloads.get()

/** Call `listener` whenever "Download songs here" is switched; the returned function stops it. */
export const watchDeviceDownloads = (listener: () => void): (() => void) =>
  downloads.subscribe(listener)

/** Whether a refusal for rate hands what is left to the server. */
export const deviceHandBackOn = (): boolean => handBack.get()

export function useDeviceDownloads(): boolean {
  return useValueStore(downloads)
}

export function useDeviceHandBack(): boolean {
  return useValueStore(handBack)
}
