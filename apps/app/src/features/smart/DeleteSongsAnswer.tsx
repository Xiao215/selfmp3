import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text } from 'react-native'
import { artistOr, plural, type AskCard, type Song } from '@selfmp3/shared'
import { RemoveSongs } from '../../ui/components/ConfirmRemoveSongs'
import { useSongsById } from '../../ui/songsById'
import type { AnswerKeys } from './answerKeys'
import { AnswerLine } from './AnswerParts'
import { Review, reviewText, type ShortReview } from './Review'
import { deleteSongsHere, keptSongs, playlistsAfterDelete, type Reviewed } from './smart.model'
import { useSmartServer } from './useSmartServer'

type Answer = Extract<AskCard, { kind: 'deleteSongs' }>

/**
 * Ask's answer to "delete these songs" (docs/features/ai.md, "Deleting
 * songs"): one review of the songs, all ticked and open, so any can be left
 * out, and under it what the delete does to their playlists — the ones left
 * with nothing go too, as the library's own delete takes them, which is why a
 * playlist they empty is not a second card to answer on its own.
 *
 * Delete asks the question every delete of songs asks (`RemoveSongs`, the
 * selection bar's and a song menu's): it cannot be undone.
 */
export function DeleteSongsAnswer({
  answer,
  height,
  onDone,
  onKeys,
}: {
  answer: Answer
  height: number
  /** Done with: what was deleted, or that nothing changed. */
  onDone: (outcome?: string) => void
  onKeys?: (keys: AnswerKeys | null) => void
}): ReactNode {
  const server = useSmartServer()
  const songsById = useSongsById()
  const here = useMemo(() => deleteSongsHere(answer, server.onDevice), [answer, server.onDevice])
  /** The delete waiting for its yes, and what to tell the review when it is answered. */
  const [asking, setAsking] = useState<{
    songs: readonly Song[]
    answer: (done: boolean) => void
  } | null>(null)

  if (here.songIds.length === 0) {
    return <AnswerLine testID="delete-songs-gone">Those songs are gone already.</AnswerLine>
  }

  const edit: Reviewed = { change: { key: 'delete', by: 'rule' }, songIds: here.songIds }
  const ticked = (approved: readonly Reviewed[], leftOut: ReadonlySet<string>): number[] =>
    approved.flatMap(each => keptSongs(each, leftOut))

  /** What the delete does to their playlists, for the ticked songs. */
  const playlistWords = (deleting: readonly number[]): string => {
    const { emptied, thinned } = playlistsAfterDelete(
      answer.playlists,
      server.onDevice,
      new Set(deleting),
    )
    const named = (names: readonly string[]): string => names.map(name => `“${name}”`).join(', ')
    return [
      emptied.length === 1
        ? `${named(emptied)} goes too: nothing would be left in it.`
        : emptied.length > 1
          ? `${named(emptied)} go too: nothing would be left in them.`
          : null,
      thinned.length === 1 && thinned[0]
        ? `Also takes ${plural(thinned[0].losing, 'song', 'songs')} out of ${named([thinned[0].name])}.`
        : thinned.length > 1
          ? `Also takes songs out of ${thinned
              .map(each => `${named([each.name])} (${each.losing})`)
              .join(', ')}.`
          : null,
    ]
      .filter(Boolean)
      .join(' ')
  }

  const applyLabel = (approved: readonly Reviewed[], leftOut: ReadonlySet<string>): string => {
    const count = ticked(approved, leftOut).length
    return count === 0 ? 'Delete' : `Delete ${plural(count, 'song', 'songs')}`
  }
  // One change, so one line (AD1): its songs by name, open below to leave any out.
  const short: ShortReview<Reviewed> = {
    title: () => (here.songIds.length === 1 ? 'Delete this song?' : 'Delete these songs?'),
    song: each => songsById.get(each.songIds[0]!),
    line: each => (
      <Text style={[reviewText.name, reviewText.song]} numberOfLines={1}>
        {songNames(each.songIds.flatMap(id => songsById.get(id)?.title ?? []))}
      </Text>
    ),
    why: () => 'From every device, with their tags and plays',
    apply: applyLabel,
    after: (approved, leftOut) => playlistWords(ticked(approved, leftOut)),
    danger: true,
  }

  return (
    <>
      <Review
        card
        short={short}
        changes={[edit]}
        sectionOf={() => 'Songs'}
        head={here.songIds.length === 1 ? 'Delete this song?' : 'Delete these songs?'}
        tickedText={(approved, leftOut) => {
          const deleting = ticked(approved, leftOut)
          return [`${plural(deleting.length, 'song', 'songs')} ticked.`, playlistWords(deleting)]
            .filter(Boolean)
            .join(' ')
        }}
        bandText={{
          rule: { title: 'What you asked to delete', note: 'They start ticked.' },
          model: { title: 'Worth a look', note: 'Nothing here is deleted unless you tick it.' },
        }}
        drawChange={(each, state) => (
          <>
            <Text style={reviewText.name}>
              <Text style={reviewText.gone}>
                − {plural(state.on ? state.kept.length : each.songIds.length, 'song', 'songs')}
              </Text>
            </Text>
            <Text style={reviewText.meta} numberOfLines={2}>
              From every device, with their tags and plays
            </Text>
          </>
        )}
        labelOf={each => `Delete ${plural(each.songIds.length, 'song', 'songs')}`}
        songLine={song => {
          const why = here.why.get(song.id)
          return `${artistOr(song.artist)}${why ? ` · ${why}` : song.album ? ` · ${song.album}` : ''}`
        }}
        applyLabel={applyLabel}
        keyWord="delete"
        onApply={(approved, leftOut) =>
          new Promise<boolean | string>(done => {
            const songs = ticked(approved, leftOut).flatMap(id => songsById.get(id) ?? [])
            if (songs.length === 0) done(false)
            else
              setAsking({
                songs,
                answer: yes => done(yes && `Deleted ${plural(songs.length, 'song', 'songs')}`),
              })
          })
        }
        height={height}
        onClose={onDone}
        onKeys={onKeys}
        testID="delete-songs"
        openAtFirst={['delete']}
      />
      {asking ? (
        <RemoveSongs
          songs={asking.songs}
          onCancel={() => {
            asking.answer(false)
            setAsking(null)
          }}
          onDone={() => {
            asking.answer(true)
            setAsking(null)
          }}
        />
      ) : null}
    </>
  )
}

/** "群青", "群青 and たぶん", "群青, たぶん and 4 more". */
function songNames(titles: readonly string[]): string {
  if (titles.length <= 2) return titles.join(' and ')
  return `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`
}
