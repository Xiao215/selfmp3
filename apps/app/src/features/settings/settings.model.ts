import type { Health, ScanResult } from '@selfmp3/shared'

/**
 * Settings' rules, with nothing drawn: which sections a device shows, which one
 * the reader is looking at, and the short phrases the rows are made of.
 */

export type SectionId =
  | 'playback'
  | 'offline'
  | 'importing'
  | 'library'
  | 'cloud'
  | 'connection'
  | 'lyrics'
  | 'devices'
  | 'appearance'
  | 'shortcuts'
  | 'about'

/** The index, in page order. `mac`: the section acts on the Mac, so a cloud library has none. */
export const ALL_SECTIONS: readonly { id: SectionId; label: string; mac?: boolean }[] = [
  { id: 'playback', label: 'Playback' },
  { id: 'offline', label: 'Offline music' },
  { id: 'importing', label: 'Importing', mac: true },
  { id: 'library', label: 'Library', mac: true },
  { id: 'cloud', label: 'Cloud', mac: true },
  { id: 'connection', label: 'Connection' },
  { id: 'lyrics', label: 'Lyrics', mac: true },
  { id: 'devices', label: 'Devices', mac: true },
  { id: 'appearance', label: 'Appearance' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'about', label: 'About' },
]

/** `installed`: a browser streams and keeps no songs, so it has no Offline music. */
export function sectionsFor(
  fromCloud: boolean,
  installed = true,
): readonly { id: SectionId; label: string }[] {
  return ALL_SECTIONS.filter(
    section => (!fromCloud || !section.mac) && (installed || section.id !== 'offline'),
  )
}

/** How far below the top of the page a section counts as the one being read. */
export const READING_LINE = 96

/**
 * Which section the reader is looking at: the web's rule.
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

export const percentLabel = (fraction: number): string => `${Math.round(fraction * 100)}%`

/** The accent's name when it is a preset, else its hue. */
export function accentName(hue: number, presets: readonly { hue: number; name: string }[]): string {
  return presets.find(preset => preset.hue === hue)?.name ?? `Hue ${hue}°`
}

/** The line under the title. */
export function healthLine(health: Health | undefined): string {
  if (!health) return 'Not connected to your library right now'
  const songs = health.songCount === undefined ? '' : ` · ${health.songCount} songs`
  return `self.mp3 ${health.version}${songs} · ${health.storageDriver} storage`
}

export function scanHint(result: ScanResult | undefined): string {
  if (!result) return 'Pick up files you added, renamed or deleted outside self.mp3.'
  return `Last scan found ${result.total} songs — ${result.added} new, ${result.updated} updated, ${result.removed} now missing.`
}
