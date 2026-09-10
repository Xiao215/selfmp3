import { z } from 'zod'
import type { MetadataCandidate } from '@selfmp3/shared'
import { scoreCandidate, type LookupQuery } from './lookupScore.js'

/**
 * Turning raw provider JSON into `MetadataCandidate`s.
 *
 * Both APIs return far more than we need and neither is under our control, so
 * every item is parsed with a loose schema and anything that does not fit is
 * skipped rather than failing the whole response. Pure: given saved fixture
 * JSON these run identically offline.
 */

// --- iTunes ---------------------------------------------------------------

const ItunesItemSchema = z
  .object({
    wrapperType: z.string().optional(),
    kind: z.string().optional(),
    trackName: z.string(),
    artistName: z.string().default(''),
    collectionName: z.string().optional(),
    collectionArtistName: z.string().optional(),
    releaseDate: z.string().optional(),
    trackNumber: z.number().int().optional(),
    trackTimeMillis: z.number().optional(),
    artworkUrl100: z.string().optional(),
  })
  .passthrough()

const ItunesResponseSchema = z.object({ results: z.array(z.unknown()) }).passthrough()

/** The 100px thumbnail URL is a template; larger sizes are served on request. */
export function upsizeItunesArtwork(url: string): string {
  return url.replace(/\/\d+x\d+bb\./, '/600x600bb.')
}

export function parseItunes(payload: unknown, query: LookupQuery): MetadataCandidate[] {
  const response = ItunesResponseSchema.safeParse(payload)
  if (!response.success) return []

  const candidates: MetadataCandidate[] = []
  for (const raw of response.data.results) {
    const item = ItunesItemSchema.safeParse(raw)
    if (!item.success) continue
    const track = item.data
    if (track.kind && track.kind !== 'song') continue

    const yearMatch = /^(\d{4})/.exec(track.releaseDate ?? '')
    const year = yearMatch ? Number(yearMatch[1]) : undefined
    const durationSec =
      track.trackTimeMillis && track.trackTimeMillis > 0
        ? Math.round(track.trackTimeMillis / 1000)
        : undefined

    const candidate: MetadataCandidate = {
      source: 'itunes',
      title: track.trackName.trim(),
      artist: track.artistName.trim(),
      album: track.collectionName?.trim() ?? '',
      ...(track.collectionArtistName?.trim()
        ? { albumArtist: track.collectionArtistName.trim() }
        : {}),
      ...(year ? { year } : {}),
      ...(track.trackNumber ? { trackNo: track.trackNumber } : {}),
      ...(durationSec ? { durationSec } : {}),
      ...(track.artworkUrl100 ? { artworkUrl: upsizeItunesArtwork(track.artworkUrl100) } : {}),
      score: 0,
    }
    candidate.score = scoreCandidate(candidate, query)
    candidates.push(candidate)
  }
  return candidates
}

// --- MusicBrainz ------------------------------------------------------------

const ArtistCreditSchema = z.array(
  z
    .object({
      name: z.string().optional(),
      joinphrase: z.string().optional(),
      artist: z.object({ name: z.string().optional() }).passthrough().optional(),
    })
    .passthrough(),
)

const ReleaseSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    date: z.string().optional(),
    status: z.string().optional(),
    'artist-credit': ArtistCreditSchema.optional(),
    media: z
      .array(
        z
          .object({
            track: z.array(z.object({ number: z.string().optional() }).passthrough()).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

const RecordingSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    length: z.number().optional(),
    'artist-credit': ArtistCreditSchema.optional(),
    releases: z.array(ReleaseSchema).optional(),
  })
  .passthrough()

const MusicBrainzResponseSchema = z.object({ recordings: z.array(z.unknown()) }).passthrough()

/** "Artist A feat. Artist B" — MusicBrainz splits credits, we join them back. */
function joinCredit(credit: z.infer<typeof ArtistCreditSchema> | undefined): string {
  if (!credit) return ''
  return credit
    .map(part => (part.name ?? part.artist?.name ?? '') + (part.joinphrase ?? ''))
    .join('')
    .trim()
}

export interface MusicBrainzMatch {
  readonly candidate: MetadataCandidate
  /** Release MBIDs, best first, for the Cover Art Archive lookup. */
  readonly releaseIds: string[]
}

export function coverArtArchiveUrl(releaseId: string): string {
  return `https://coverartarchive.org/release/${releaseId}/front-500`
}

/**
 * One candidate per recording, described by its most "official" release.
 *
 * The recording's cover art is not known until the Cover Art Archive is asked,
 * so the release ids are returned alongside for the provider to check.
 */
export function parseMusicBrainz(payload: unknown, query: LookupQuery): MusicBrainzMatch[] {
  const response = MusicBrainzResponseSchema.safeParse(payload)
  if (!response.success) return []

  const matches: MusicBrainzMatch[] = []
  for (const raw of response.data.recordings) {
    const parsed = RecordingSchema.safeParse(raw)
    if (!parsed.success) continue
    const recording = parsed.data

    // Official releases first, then anything with a date, so the album we name
    // is the one a listener would recognise rather than a bootleg or promo.
    const releases = [...(recording.releases ?? [])].sort((a, b) => {
      const official = (r: typeof a) => (r.status === 'Official' ? 0 : 1)
      return official(a) - official(b) || (a.date ?? '9999').localeCompare(b.date ?? '9999')
    })
    const release = releases[0]

    const yearMatch = /^(\d{4})/.exec(release?.date ?? '')
    const year = yearMatch ? Number(yearMatch[1]) : undefined
    const trackNumber = Number(release?.media?.[0]?.track?.[0]?.number)
    const albumArtist = joinCredit(release?.['artist-credit'])
    const durationSec =
      recording.length && recording.length > 0 ? Math.round(recording.length / 1000) : undefined

    const candidate: MetadataCandidate = {
      source: 'musicbrainz',
      title: recording.title.trim(),
      artist: joinCredit(recording['artist-credit']),
      album: release?.title?.trim() ?? '',
      ...(albumArtist ? { albumArtist } : {}),
      ...(year ? { year } : {}),
      ...(Number.isInteger(trackNumber) && trackNumber > 0 ? { trackNo: trackNumber } : {}),
      ...(durationSec ? { durationSec } : {}),
      score: 0,
    }
    candidate.score = scoreCandidate(candidate, query)
    matches.push({ candidate, releaseIds: releases.map(r => r.id) })
  }
  return matches
}
