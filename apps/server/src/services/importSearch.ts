import { cleanTitle, type ImportPreviewItem } from '@selfmp3/shared'
import { HttpError } from '../http/errors.js'
import { alreadyHave, libraryIndex } from './alreadyHave.js'
import { have, inQueue, waitingToUpload } from './importPreview.js'
import type { SongRepository } from '../repositories/songs.js'
import type { CloudRepository } from '../repositories/cloud.js'
import type { ImportRepository } from '../repositories/imports.js'
import type { CloudSyncService } from './cloudSync.js'
import type { NeteaseMusic, NeteaseTrack } from './netease.js'
import type { ProbedTrack } from './ytdlp.js'
import type { YouTubeMusicLists } from './youtubeMusicLists.js'
import { bestMatch, durationScore, matchSimilarity } from './youtubeMatch.js'

/**
 * Searching for songs from Import's box (docs/features/import-sources.md,
 * "Searching"): YouTube Music and 网易云 asked at once, their answers one
 * list.
 *
 * A song both places have is one row, from where a 网易云 list's review
 * would take it: from 网易云 when it gives the whole song out, from YouTube
 * when it would give a preview. Which answers are the same song is decided
 * carefully, because a wrong pairing is a song that downloads as someone
 * else's: the covers of a hit share its name and very nearly its length, and
 * the original's artist is often spelt in another script on YouTube (陈奕迅,
 * Eason Chan), so names and lengths alone cannot tell them apart. So:
 *
 * - a 网易云 song it gives out whole is paired only with a YouTube answer by
 *   the same artist, of the same name and length. Unpaired, it is still a
 *   row of its own, from 网易云.
 * - a 网易云 song it will not give out needs YouTube anyway, so it is paired
 *   by the matcher's own judgement (youtubeMatch.ts), the one a 网易云 list's
 *   VIP songs are found by, over YouTube Music's answers to the same words.
 *   Short of sure, it is a row looking for itself on YouTube, as on a list's
 *   review (`/import/find`).
 *
 * The two lists take turns, best first, YouTube Music's first: it ranks the
 * song people mean higher, where 网易云's first answers for a song it has no
 * rights to are other people's covers of it.
 */

type SearchDeps = {
  songs: Pick<SongRepository, 'all'>
  cloudRepo: Pick<CloudRepository, 'states'>
  cloudSync: Pick<CloudSyncService, 'connected'>
  imports: Pick<ImportRepository, 'pendingUrls'>
  youtubeMusicLists: Pick<YouTubeMusicLists, 'songs'>
  netease: Pick<NeteaseMusic, 'search'>
}

/** Answers asked of each place. */
const PER_SOURCE = 10
/** How alike two names must be to be the same song's, artist or title. */
const SAME_NAME = 0.8
/** How close in length, at most, two answers that are the same recording are. */
const SAME_LENGTH = 0.9
/** A matcher's answer as sure as the matcher's own "sure" (youtubeMatch.ts). */
const SURE = 0.7

/** A search's row before the library is asked about it. */
type Row = Omit<ImportPreviewItem, 'alreadyHave' | 'waitingToUpload' | 'inQueue'>

export async function searchSongs(deps: SearchDeps, query: string): Promise<ImportPreviewItem[]> {
  const [youtube, netease] = await Promise.all([
    deps.youtubeMusicLists.songs(query),
    deps.netease.search(query, PER_SOURCE),
  ])
  // 网易云 says nothing for no answer and for no songs alike; YouTube Music tells them apart.
  if (youtube === null && netease.length === 0) {
    throw HttpError.unprocessable(
      'Neither YouTube Music nor 网易云 answered that search. Try again in a moment.',
    )
  }
  const library = libraryIndex(deps.songs.all())
  const waiting = waitingToUpload(deps)
  const queued = inQueue(deps)
  return searchRows((youtube ?? []).slice(0, PER_SOURCE), netease).map(row => ({
    ...row,
    ...have(alreadyHave(row, library), waiting),
    inQueue: row.url !== '' && queued(row.url),
  }))
}

/** The two places' answers as one list of rows: see the top of this file. */
export function searchRows(
  youtube: readonly ProbedTrack[],
  netease: readonly NeteaseTrack[],
): Row[] {
  const paired = new Map<NeteaseTrack, ProbedTrack>()
  const taken = new Set<ProbedTrack>()
  for (const song of netease) {
    const free = youtube.filter(answer => !taken.has(answer))
    const match = song.free ? sameRecording(song, free) : surely(song, free)
    if (match) {
      paired.set(song, match)
      taken.add(match)
    }
  }
  const pairedWith = new Map([...paired].map(([song, answer]) => [answer, song]))

  const rows: Row[] = []
  const longest = Math.max(youtube.length, netease.length)
  for (let rank = 0; rank < longest; rank++) {
    const answer = youtube[rank]
    if (answer) {
      const song = pairedWith.get(answer)
      // A pair is drawn where its better-placed half is: here, unless 网易云's half came first.
      if (!song) rows.push(fromYouTube(answer))
      else if (netease.indexOf(song) >= rank) rows.push(fromBoth(song, answer))
    }
    const song = netease[rank]
    if (song) {
      const match = paired.get(song)
      if (!match) rows.push(fromNetease(song))
      else if (youtube.indexOf(match) > rank) rows.push(fromBoth(song, match))
    }
  }
  return rows
}

/** The YouTube answer that is this very recording: the same artist, name and length. */
function sameRecording(
  song: NeteaseTrack,
  answers: readonly ProbedTrack[],
): ProbedTrack | undefined {
  return answers.find(
    answer =>
      matchSimilarity(song.artist, answer.artist) >= SAME_NAME &&
      matchSimilarity(cleanTitle(song.title), cleanTitle(answer.title)) >= SAME_NAME &&
      (durationScore(song.duration, answer.duration) ?? 0) >= SAME_LENGTH,
  )
}

/** The YouTube answer the matcher is sure is this song, as it would be for a 网易云 list. */
function surely(song: NeteaseTrack, answers: readonly ProbedTrack[]): ProbedTrack | undefined {
  const best = bestMatch(song, answers)
  return best && best.confidence >= SURE ? best.track : undefined
}

/** Only on YouTube: downloaded from there, with nothing else to choose. */
const fromYouTube = (track: ProbedTrack): Row => ({
  ...track,
  source: 'youtube',
  netease: null,
  youtube: null,
})

/**
 * Only on 网易云: from there when it gives the whole song, and otherwise
 * looked for on YouTube by its name, as a 网易云 list's VIP songs are.
 */
const fromNetease = (song: NeteaseTrack): Row =>
  song.free
    ? {
        ...named(song),
        url: song.url,
        source: 'netease',
        netease: { url: song.url, free: true },
        youtube: null,
      }
    : {
        ...named(song),
        url: '',
        source: 'youtube',
        netease: { url: song.url, free: false },
        youtube: { url: null, match: 'looking' },
      }

/**
 * On both: named as 网易云 names it, as a 网易云 list's songs are, and from
 * 网易云 when it gives the whole song, else from YouTube. The other stays a
 * choice on the open row.
 */
const fromBoth = (song: NeteaseTrack, answer: ProbedTrack): Row => ({
  ...named(song),
  thumbnail: song.thumbnail ?? answer.thumbnail,
  url: song.free ? song.url : answer.url,
  source: song.free ? 'netease' : 'youtube',
  netease: { url: song.url, free: song.free },
  youtube: { url: answer.url, match: 'sure' },
})

const named = (song: NeteaseTrack) => ({
  title: song.title,
  artist: song.artist,
  album: song.album,
  duration: song.duration,
  thumbnail: song.thumbnail,
})
