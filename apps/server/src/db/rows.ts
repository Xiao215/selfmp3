import { CoverSwatchSchema, LyricsKindSchema } from '@selfmp3/shared'
import type { CoverSwatch, LyricsKind, Song, AudioFeatures, Tag } from '@selfmp3/shared'

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
  art_rev: number
  cover_hue: number | null
  cover_chroma: number | null
  cover_tone_rev: number | null
  /** JSON: the cover's palette, `CoverSwatch[]`, or null before it was read. */
  cover_palette: string | null
  lyrics_kind: string
  instrumental: number
  play_count: number
  skip_count: number
  loved: number
  source_url: string | null
  last_played_at: string | null
  added_at: string
  updated_at: string
  /** Present only on the joined library query: "1,4,7" or null. */
  tag_ids?: string | null
  /** From the LEFT JOIN on song_audio_features; all null when not analysed yet. */
  feat_bpm?: number | null
  feat_energy?: number | null
  feat_loudness_lufs?: number | null
  feat_key?: string | null
  feat_camelot?: string | null
  feat_danceability?: number | null
  feat_analyzed_at?: string | null
  feat_version?: number | null
}

export interface AudioFeaturesRow {
  song_id: number
  bpm: number | null
  energy: number | null
  loudness_lufs: number | null
  key: string | null
  camelot: string | null
  danceability: number | null
  analyzed_at: string
  version: number
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
  last_played_at?: string | null
  song_count?: number
  total_duration?: number
}

function toLyricsKind(value: string): LyricsKind {
  return LyricsKindSchema.catch('none').parse(value)
}

/**
 * A stored palette, when there is a sound one. A column written by hand or cut
 * short reads as no palette rather than failing the whole library.
 */
function paletteOf(value: string | null): { palette?: CoverSwatch[] } {
  if (!value) return {}
  try {
    const parsed = CoverSwatchSchema.array().max(8).safeParse(JSON.parse(value))
    return parsed.success && parsed.data.length > 0 ? { palette: parsed.data } : {}
  } catch {
    return {}
  }
}

/** SQLite's GROUP_CONCAT gives "1,4,7"; empty and null both mean no tags. */
function parseIdList(value: string | null | undefined): number[] {
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
    rev: songRev(row),
    // Only the colour of the cover the song has now: one read from a cover
    // since replaced is not sent while the new one waits to be read.
    coverTone:
      row.cover_hue !== null && row.cover_tone_rev === row.art_rev
        ? { hue: row.cover_hue, chroma: row.cover_chroma ?? 0, ...paletteOf(row.cover_palette) }
        : null,
    lyricsKind: toLyricsKind(row.lyrics_kind),
    instrumental: row.instrumental === 1,
    playCount: row.play_count,
    skipCount: row.skip_count,
    loved: row.loved === 1,
    sourceUrl: row.source_url,
    lastPlayedAt: row.last_played_at,
    addedAt: row.added_at,
    tagIds: parseIdList(row.tag_ids),
    audioFeatures: audioFeaturesFromSongRow(row),
  }
}

/**
 * A token that changes whenever the song's audio or cover changes.
 *
 * Media URLs carry it because song ids are not forever: SQLite hands a
 * deleted row's id to the next insert, and a reset library starts again at 1.
 * Without it, a browser that cached `/api/stream/1` as immutable keeps playing
 * whatever song 1 was before.
 */
function songRev(row: Pick<SongRow, 'size_bytes' | 'mtime_ms' | 'art_rev'>): string {
  return `${row.size_bytes.toString(36)}.${Math.floor(row.mtime_ms).toString(36)}.${row.art_rev}`
}

/** The joined feature columns, or null when the song has no features row. */
function audioFeaturesFromSongRow(row: SongRow): AudioFeatures | null {
  if (row.feat_analyzed_at == null) return null
  return {
    bpm: row.feat_bpm ?? null,
    energy: row.feat_energy ?? null,
    loudnessLufs: row.feat_loudness_lufs ?? null,
    key: row.feat_key ?? null,
    camelot: row.feat_camelot ?? null,
    danceability: row.feat_danceability ?? null,
    analyzedAt: row.feat_analyzed_at,
    version: row.feat_version ?? 0,
  }
}

export function toAudioFeatures(row: AudioFeaturesRow): AudioFeatures {
  return {
    bpm: row.bpm,
    energy: row.energy,
    loudnessLufs: row.loudness_lufs,
    key: row.key,
    camelot: row.camelot,
    danceability: row.danceability,
    analyzedAt: row.analyzed_at,
    version: row.version,
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
