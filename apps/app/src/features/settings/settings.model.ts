import type { DeviceKind, Health, ScanResult } from '@selfmp3/shared'

/**
 * Settings' rules, with nothing drawn: which sections a device shows, which one
 * the reader is looking at, and the short phrases the rows are made of.
 */

/** Which destructive action is waiting to be confirmed, if any. */
export type Confirming = 'remove-downloads' | 'redo-analysis' | 'sign-out' | 'forget-storage' | null

export type SectionId =
  | 'playback'
  | 'offline'
  | 'importing'
  | 'library'
  | 'cloud'
  | 'account'
  | 'lyrics'
  | 'devices'
  | 'desktop'
  | 'appearance'
  | 'shortcuts'
  | 'about'

/**
 * The groups, in page order (`P38`, `C17`): who you are and the look first,
 * then what this device keeps, then the rest. `server`: the section acts on
 * the server, so a cloud library has none.
 *
 * Devices is not one of those any more: a cloud library finds its server the way
 * Import does, and with no server in reach it still shows the last list it had.
 */
export const ALL_SECTIONS: readonly { id: SectionId; label: string; server?: boolean }[] = [
  // Which library this is, and signing out of it.
  { id: 'account', label: 'Account' },
  { id: 'appearance', label: 'Appearance' },
  // Named for the device it is on; see `sectionsFor`.
  { id: 'offline', label: 'On this phone' },
  { id: 'devices', label: 'Devices' },
  { id: 'playback', label: 'Playback' },
  { id: 'library', label: 'Library', server: true },
  { id: 'importing', label: 'Importing', server: true },
  { id: 'cloud', label: 'Cloud', server: true },
  // Not the server's: romaji is kept with the words in the cloud too, and the switch is this device's.
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'desktop', label: 'Desktop app' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'about', label: 'About' },
]

/**
 * What this device is, as the words for it: a phone, or a computer. From the
 * device port's own answer (`ports/device`), which the Devices list uses too,
 * so this device is called the same thing in both places. The desktop app
 * and a browser on a computer are computers; everything native is a phone, an
 * iPad included, since it keeps songs the same way.
 */
export type DevicePlace = 'phone' | 'computer'

export function devicePlace(kind: DeviceKind): DevicePlace {
  return kind === 'phone' ? 'phone' : 'computer'
}

/** "On this phone", "On this computer": the group of what this device keeps. */
export function onThisDevice(place: DevicePlace): string {
  return `On this ${place}`
}

/**
 * `installed`: a browser streams and keeps no songs, so it has nothing on it.
 * `keyboard`: a finger has no keys to press, so a phone has no Keyboard shortcuts.
 * `shell`: only the installed desktop app can open at login, and a section with
 * nothing in it is worse than one that is not there — so it defaults to absent.
 * It is also the only place with keyboard shortcuts to list: its menu has them,
 * and a browser tab has only Space, for play and pause.
 * `place`: names the group of what this device keeps.
 */
export function sectionsFor(
  fromCloud: boolean,
  installed = true,
  keyboard = true,
  shell = false,
  place: DevicePlace = 'phone',
): readonly { id: SectionId; label: string }[] {
  return ALL_SECTIONS.filter(
    section =>
      (!fromCloud || !section.server) &&
      (installed || section.id !== 'offline') &&
      ((keyboard && shell) || section.id !== 'shortcuts') &&
      (shell || section.id !== 'desktop'),
  ).map(section =>
    section.id === 'offline'
      ? { id: section.id, label: onThisDevice(place) }
      : { id: section.id, label: section.label },
  )
}

/** How far below the top of the page a section counts as the one being read. */
const READING_LINE = 96

/**
 * Where to scroll so a section chosen from the index lands at the top of what
 * can be read.
 *
 * `top` is the section's top in the scroll content, measured as it is now: a
 * panel above it that has since loaded its data has pushed it down, and an
 * offset kept from the first layout would stop a panel or two short.
 * `clearance` is what covers the top of the scroll area — the page's top
 * padding beside the index column, the sticky chips and their gap on a narrow
 * screen — so the heading sits where the first panel sits unscrolled. Never
 * above the start of the page; the end of the page is the scroll view's to clamp.
 */
export function landingOffset(top: number, clearance: number): number {
  return Math.max(0, Math.round(top - clearance))
}

/**
 * Which section the reader is looking at.
 *
 * Normally the last section whose top has passed a line near the top. The last
 * few sections are short and the page runs out before their tops reach that
 * line, so over the final screenful the line slides down to the bottom edge,
 * and each gets its turn on the way down.
 */
export function activeSection<T extends string>(
  sections: readonly { id: T; top: number }[],
  scrollY: number,
  viewHeight: number,
  contentHeight: number,
): T | null {
  const first = sections[0]
  if (!first || viewHeight <= 0) return null
  const remaining = contentHeight - viewHeight - scrollY
  const approach = Math.max(0, Math.min(1, 1 - remaining / viewHeight))
  const line = scrollY + READING_LINE + (viewHeight - READING_LINE) * approach
  let current = first.id
  for (const section of sections) {
    if (section.top <= line) current = section.id
  }
  return current
}

export const crossfadeLabel = (seconds: number): string => (seconds === 0 ? 'off' : `${seconds}s`)

/** The accent's name when it is a preset, else its hue. */
export function accentName(hue: number, presets: readonly { hue: number; name: string }[]): string {
  return presets.find(preset => preset.hue === hue)?.name ?? `Hue ${hue}°`
}

/**
 * The line under the title.
 *
 * While the check is out it says so, rather than "not connected": the phone
 * said that for the second it took to ask, with a song playing from the very
 * server it claimed not to reach.
 */
export function healthLine(
  health: Health | undefined,
  asking: {
    readonly loading?: boolean
    readonly error?: boolean
    readonly fromCloud?: boolean
  } = {},
): string {
  if (health) {
    const songs = health.songCount === undefined ? '' : ` · ${health.songCount} songs`
    return `self.mp3 ${health.version}${songs} · ${health.storageDriver} storage`
  }
  if (asking.loading) return 'Checking your library…'
  if (asking.error) return asking.fromCloud ? 'Can’t reach the cloud' : 'Can’t reach your server'
  return 'Not connected to your library right now'
}

/** How long a device counts as one you still use: a week. */
export const RECENT_DEVICE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Settings' device rows, split: this device, anything online, and anything
 * seen in the last week first; the rest behind "Show N older".
 *
 * Takes the rows already folded by name (`deviceListView`) and in their order,
 * which is this device, then online, then most recently seen — so the split
 * keeps that order on both sides.
 */
export function splitDevices<
  T extends {
    readonly device: { readonly id: string; readonly online: boolean; readonly lastSeenAt: number }
  },
>(
  rows: readonly T[],
  thisDeviceId: string | null,
  now: number,
  windowMs: number = RECENT_DEVICE_WINDOW_MS,
): { recent: T[]; older: T[] } {
  const recent: T[] = []
  const older: T[] = []
  for (const row of rows) {
    const { device } = row
    if (device.id === thisDeviceId || device.online || now - device.lastSeenAt <= windowMs) {
      recent.push(row)
    } else older.push(row)
  }
  return { recent, older }
}

export function scanHint(result: ScanResult | undefined): string {
  if (!result) return 'Import any audio files dropped into the folder outside self.mp3.'
  return `Last sweep found ${result.added} new and ${result.updated} updated; ${result.total} songs in the library.`
}
