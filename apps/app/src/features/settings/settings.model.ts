import type { AnalysisStatus, DeviceKind, Health, ScanResult } from '@selfmp3/shared'
import { clamp01, plural } from '@selfmp3/shared'
import { bucketCapped, unreachableLabel, untilCapResets } from '../library/library.model'

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
  | 'smart'
  | 'model'
  | 'devices'
  | 'desktop'
  | 'getApp'
  | 'appearance'
  | 'shortcuts'
  | 'about'
  | 'advanced'

/**
 * The groups, in page order (`P38`, `C17`): who you are and the look first,
 * then what this device keeps, then the rest. `server`: the section acts on
 * the server, so a cloud library has none. `advanced`: it is about running
 * the server or the Mac app rather than using self.mp3, so it sits under
 * Advanced at the end, behind one chip (O1).
 *
 * Devices is not one of those any more: a cloud library finds its server the way
 * Import does, and with no server in reach it still shows the last list it had.
 */
export const ALL_SECTIONS: readonly {
  id: SectionId
  label: string
  server?: boolean
  advanced?: boolean
}[] = [
  // Which library this is, and signing out of it.
  { id: 'account', label: 'Account' },
  { id: 'appearance', label: 'Appearance' },
  // Named for the device it is on; see `sectionsFor`.
  { id: 'offline', label: 'On this phone' },
  { id: 'devices', label: 'Devices' },
  { id: 'playback', label: 'Playback' },
  // Not `server`: a cloud library reaches the server for it, the way Ask does.
  { id: 'smart', label: 'Smart features' },
  // Not the server's: romaji is kept with the words in the cloud too, and the switches are this device's.
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
  { id: 'about', label: 'About' },
  { id: 'library', label: 'Library', server: true, advanced: true },
  { id: 'importing', label: 'Importing', server: true, advanced: true },
  { id: 'cloud', label: 'Cloud', server: true, advanced: true },
  // Where the server asks a model, and the Test: Smart features' switches stay above.
  { id: 'model', label: 'Model', advanced: true },
  { id: 'desktop', label: 'Desktop app', advanced: true },
  // The same place in the page as Desktop app, for the tab that could become it.
  { id: 'getApp', label: 'Mac app', advanced: true },
]

/** One shown section: where the page can land, and whether it is under Advanced. */
export interface Section {
  readonly id: SectionId
  readonly label: string
  readonly advanced: boolean
}

/** The chip, or the index link, a section is read under: Advanced for its own. */
export function indexIdFor(id: SectionId, sections: readonly Section[]): SectionId {
  return sections.find(section => section.id === id)?.advanced ? 'advanced' : id
}

/**
 * The page's index: every section that is not under Advanced, then Advanced
 * itself when anything is under it. The sections under it are still places a
 * link can land (`/settings?section=cloud`); they share its chip.
 */
export function settingsIndex(sections: readonly Section[]): readonly Section[] {
  const index = sections.filter(section => !section.advanced)
  return sections.some(section => section.advanced)
    ? [...index, { id: 'advanced', label: 'Advanced', advanced: false }]
    : index
}

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
 * `offered`: a browser tab on a Mac is offered the desktop app to install
 * (`ports/macApp`); the app itself, a phone and a Windows browser are not.
 */
export function sectionsFor({
  fromCloud,
  installed = true,
  keyboard = true,
  shell = false,
  place = 'phone',
  offered = false,
}: {
  readonly fromCloud: boolean
  readonly installed?: boolean
  readonly keyboard?: boolean
  readonly shell?: boolean
  readonly place?: DevicePlace
  readonly offered?: boolean
}): readonly Section[] {
  return ALL_SECTIONS.filter(
    section =>
      (!fromCloud || !section.server) &&
      (installed || section.id !== 'offline') &&
      ((keyboard && shell) || section.id !== 'shortcuts') &&
      (shell || section.id !== 'desktop') &&
      (offered || section.id !== 'getApp'),
  ).map(section => ({
    id: section.id,
    label: section.id === 'offline' ? onThisDevice(place) : section.label,
    advanced: section.advanced ?? false,
  }))
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
  const approach = clamp01(1 - remaining / viewHeight)
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
    /** What the check failed with; any truthy value counts as failed. */
    readonly error?: unknown
    readonly fromCloud?: boolean
    /**
     * The bucket refusing for the day. Said over a health that answered: in the
     * cloud the health is the doorman's, and the doorman answers while the
     * bucket behind it will not.
     */
    readonly capped?: boolean
    /** A phone's line, right-aligned under the title, with less room. */
    readonly compact?: boolean
    readonly now?: Date
  } = {},
): string {
  if (asking.capped || bucketCapped(asking.error)) {
    const now = asking.now ?? new Date()
    return asking.compact
      ? `Storage allowance used up · ${untilCapResets(now, true)} left`
      : `Storage allowance used up · resets in about ${untilCapResets(now)}`
  }
  if (health) {
    const songs =
      health.songCount === undefined ? '' : ` · ${plural(health.songCount, 'song', 'songs')}`
    return `self.mp3 ${health.version}${songs}`
  }
  if (asking.loading) return 'Checking your library…'
  if (asking.error) return unreachableLabel(asking.error)
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
  if (!result) return 'Picks up files added to the folder by hand.'
  return `Last scan: ${result.added} new, ${result.updated} updated.`
}

/**
 * The line under "self.mp3 for Mac" in a browser tab: what is on offer and,
 * where the browser could not say which Mac this is, how to tell — the two
 * dmgs are named for the chip, and the Intel one runs on an M1 under Rosetta
 * without a word.
 */
export function downloadHint(state: {
  readonly loading: boolean
  readonly error: boolean
  readonly version: string | null
  readonly offers: number
  readonly chip: 'arm64' | 'x64' | null
}): string {
  if (state.loading) return 'Finding the latest version…'
  if (state.error) return 'Couldn’t reach GitHub. Try the releases page.'
  if (state.offers === 0) return 'No release yet.'
  const version = state.version ? `Version ${state.version}. ` : ''
  // Which dmg is this Mac's, where the browser could not tell.
  const which = state.chip ? 'Media keys and a Dock icon.' : 'About This Mac names your chip.'
  return `${version}${which}`
}

/** What the listening model is doing, in the words Settings shows under its row. */
export function soundHint(sound: AnalysisStatus['sound'], songs: number): string {
  switch (sound.state) {
    case 'off':
      return 'Switched off on this server.'
    case 'waiting':
      return 'Starts once every song has tempo and key.'
    case 'fetching':
      return 'Downloading the listening model (about 750 MB).'
    case 'failed':
      return `Couldn’t get the model${sound.message ? `: ${sound.message}` : ''}. Tries again hourly.`
    case 'ready':
      return `${sound.heard} of ${plural(songs, 'song', 'songs')} heard${sound.pending > 0 ? ` · ${sound.pending} to go` : ''}`
  }
}

/**
 * The line under Audio analysis while it runs: measuring tempo and key, or,
 * once every song has those, listening, which on a big library takes days.
 */
export function analysisProgress(status: AnalysisStatus | undefined): string {
  const listening = status?.pending === 0 && status.sound.pending > 0
  const toGo = listening ? status.sound.pending : (status?.pending ?? 0)
  return [
    listening ? 'Listening' : 'Analysing',
    status?.current ? ` — ${status.current.title}` : '…',
    toGo > 0 ? ` · ${toGo} to go` : '',
  ].join('')
}
