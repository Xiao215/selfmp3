import type { Song, Tag } from '@selfmp3/shared'

/**
 * What a model is shown of the library (docs/features/ai.md, "the context
 * ladder"): its shape in a few hundred lines at most, and the songs themselves
 * only as a numbered table of the few that are in question.
 *
 * Everything here is plain text built the same way every time, so the same
 * library gives the same prompt and a cached answer can be found again.
 */

/**
 * The people a credit names, once each, in order.
 *
 * Credits arrive as "薛之谦, 薛之谦, 薛之谦", "Yu-Peng Chen, HOYO-MiX" or
 * "A feat. B"; the first name is who the song is mostly by.
 */
export function creditNames(artist: string): string[] {
  const names: string[] = []
  for (const part of artist.split(/\s*(?:,|、|;|\/|\s&\s|\sfeat\.?\s|\sft\.?\s)\s*/i)) {
    const name = part.trim()
    if (name && !names.some(other => other.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  return names
}

export function mainArtist(artist: string): string {
  return creditNames(artist)[0] ?? 'Unknown artist'
}

/** With words: lyrics were found and nobody said it has none. */
export function hasWords(song: Song): boolean {
  return song.lyricsKind !== 'none' && !song.instrumental
}

function tally(values: Iterable<string>): [string, number][] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function top(entries: [string, number][], n: number): string {
  const shown = entries.slice(0, n).map(([name, count]) => `${name} ${count}`)
  const rest = entries.length - n
  return rest > 0 ? `${shown.join(', ')}, +${rest} more` : shown.join(', ')
}

/** "Mostly by … · albums …": what a tag holds, which is what its name means here. */
export function tagCatalog(songs: readonly Song[], tags: readonly Tag[]): string {
  const lines: string[] = []
  for (const tag of [...tags].sort((a, b) => b.songCount - a.songCount)) {
    const inTag = songs.filter(song => song.tagIds.includes(tag.id))
    if (inTag.length === 0) continue
    const artists = tally(inTag.map(song => mainArtist(song.artist)))
    const albums = tally(inTag.map(song => song.album).filter(Boolean))
    lines.push(
      `- ${tag.name} · ${inTag.length} songs · by ${top(artists, 3)}` +
        (albums.length ? ` · albums ${top(albums, 2)}` : ''),
    )
  }
  return lines.join('\n') || '(no tags yet)'
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}

/** Rung two: the library's size and spread, its tags, and who is in it most. */
export function libraryShape(songs: readonly Song[], tags: readonly Tag[]): string {
  const energies = songs
    .map(song => song.audioFeatures?.energy)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b)
  const bpms = songs
    .map(song => song.audioFeatures?.bpm)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b)
  const withWords = songs.filter(hasWords).length
  const artists = tally(songs.map(song => mainArtist(song.artist)))

  return [
    `The library: ${songs.length} songs. ${withWords} have words, ${songs.length - withWords} have none.`,
    energies.length
      ? `Energy is known for ${energies.length}: lowest ${energies[0]!.toFixed(2)}, a quarter below ${quantile(energies, 0.25).toFixed(2)}, half below ${quantile(energies, 0.5).toFixed(2)}, a quarter above ${quantile(energies, 0.75).toFixed(2)}, highest ${energies.at(-1)!.toFixed(2)}.`
      : 'No song has been analysed for energy yet.',
    bpms.length
      ? `Tempo runs ${Math.round(bpms[0]!)}–${Math.round(bpms.at(-1)!)} bpm.`
      : 'No song has a tempo yet.',
    '',
    'Tags, with what each one holds:',
    tagCatalog(songs, tags),
    '',
    `Artists, most songs first: ${top(artists, 40)}`,
  ].join('\n')
}

function minutes(seconds: number): string {
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function daysAgo(iso: string | null, now: number): string {
  if (!iso) return 'never played'
  const days = Math.floor(
    (now - Date.parse(iso.replace(' ', 'T') + (iso.endsWith('Z') ? '' : 'Z'))) / 86_400_000,
  )
  return days <= 0 ? 'played today' : `played ${days}d ago`
}

/**
 * Rung three: one line per song, numbered for this call.
 *
 * Numbers rather than ids: shorter, and a number outside the table is caught
 * as an invention by the check that reads the answer.
 */
export function songTable(
  songs: readonly Song[],
  tags: readonly Tag[],
  now: number = Date.now(),
): string {
  const names = new Map(tags.map(tag => [tag.id, tag.name]))
  return songs
    .map((song, index) => {
      const features = song.audioFeatures
      return [
        `#${index + 1}`,
        song.title,
        song.artist || 'Unknown artist',
        song.album || '-',
        song.tagIds
          .map(id => names.get(id))
          .filter(Boolean)
          .join(', ') || 'no tags',
        features?.energy != null ? `energy ${features.energy.toFixed(2)}` : 'energy ?',
        features?.bpm != null ? `${Math.round(features.bpm)} bpm` : 'bpm ?',
        minutes(song.duration),
        hasWords(song) ? 'words' : 'no words',
        `${song.playCount} plays, ${daysAgo(song.lastPlayedAt, now)}`,
      ].join(' | ')
    })
    .join('\n')
}
