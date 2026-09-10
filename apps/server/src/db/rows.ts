import type { LyricsKind, Song, Tag } from '@selfmp3/shared'

/**
 * The shape of rows as SQLite actually returns them, and the mappers that turn
 * them into API objects.
 *
 * SQLite has no boolean type, so flags come back as 0 or 1 and every one of
 * them has to be converted deliberately. Keeping these row types separate from
 * the API types is what makes that conversion impossible to forget: the
 * compiler will not let a `0 | 1` reach a field typed `boolean`.
 */

export interface SongRow {
  id: number
  path: string
  title: string
  artist: string
  album: string
  album_artist: string
  track_no: number | null
  year: number | null
  duration: number
  size_bytes: number
  mime: string
  mtime_ms: number
  has_art: number
  art_ext: string | null
  lyrics_kind: string
  play_count: number
  skip_count: number
  loved: number
  source_url: string | null
  last_played_at: string | null
  added_at: string
  updated_at: string
  missing: number
  /** Present only on the joined library query: "1,4,7" or null. */
  tag_ids?: string | null
}

export interface TagRow {
  id: number
  name: string
  hue: number
  created_at: string
  song_count?: number
}

export interface PlaylistRow {
  id: number
  name: string
  description: string
  kind: string
  rules: string | null
  pinned: number
  created_at: string
  updated_at: string
  song_count?: number
  total_duration?: number
}

const LYRICS_KINDS = new Set<LyricsKind>(['none', 'plain', 'synced'])

function toLyricsKind(value: string): LyricsKind {
  return LYRICS_KINDS.has(value as LyricsKind) ? (value as LyricsKind) : 'none'
}

/** SQLite's GROUP_CONCAT gives "1,4,7"; empty and null both mean no tags. */
export function parseIdList(value: string | null | undefined): number[] {
  if (!value) return []
  const out: number[] = []
  for (const part of value.split(',')) {
    const n = Number(part)
    if (Number.isInteger(n) && n > 0) out.push(n)
  }
  return out
}

export function toSong(row: SongRow): Song {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumArtist: row.album_artist,
    trackNo: row.track_no,
    year: row.year,
    duration: row.duration,
    sizeBytes: row.size_bytes,
    mime: row.mime,
    hasArt: row.has_art === 1,
    lyricsKind: toLyricsKind(row.lyrics_kind),
    playCount: row.play_count,
    skipCount: row.skip_count,
    loved: row.loved === 1,
    sourceUrl: row.source_url,
    lastPlayedAt: row.last_played_at,
    addedAt: row.added_at,
    missing: row.missing === 1,
    tagIds: parseIdList(row.tag_ids),
  }
}

export function toTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    hue: row.hue,
    songCount: row.song_count ?? 0,
  }
}
