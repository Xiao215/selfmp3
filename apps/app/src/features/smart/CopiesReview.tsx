import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { artistOr, formatDuration, plural, type CopiesResult, type Song } from '@selfmp3/shared'
import { space } from '@selfmp3/client'
import { RemoveSongs } from '../../ui/components/ConfirmRemoveSongs'
import { useSongsById } from '../../ui/songsById'
import type { AnswerKeys } from './answerKeys'
import { AnswerLine, AnswerNote } from './AnswerParts'
import { Review, reviewText } from './Review'
import { copiesHere, keptSongs, type CopyHere } from './smart.model'
import { useSmartServer } from './useSmartServer'

/**
 * A4 · songs in the library more than once (docs/features/ai.md, "Copies"):
 * each song with the copy that stays, open to the extra copies to delete, in
 * the review's two bands — copies with nothing between them, ticked, and the
 * model's, waiting. Deleting cannot be undone, so the button asks once more
 * with the dialog every delete asks with (`RemoveSongs`).
 */
export function CopiesReview({
  result,
  height,
  onClose,
  onKeys,
}: {
  result: CopiesResult
  height: number
  onClose?: () => void
  onKeys?: (keys: AnswerKeys | null) => void
}): ReactNode {
  const server = useSmartServer()
  const songsById = useSongsById()
  const here = useMemo(
    () => copiesHere(result.copies, server.onDevice, songsById),
    [result.copies, server.onDevice, songsById],
  )
  /** The delete waiting for its yes, and what to tell the review when it is answered. */
  const [deleting, setDeleting] = useState<{
    songs: Song[]
    answer: (deleted: boolean) => void
  } | null>(null)

  if (here.length === 0) {
    return (
      <View style={{ gap: space.sm }}>
        <AnswerLine testID="copies-nothing">No song is in your library twice.</AnswerLine>
        {result.note ? <AnswerNote>{result.note}</AnswerNote> : null}
      </View>
    )
  }

  const extra = (approved: readonly CopyHere[], leftOut: ReadonlySet<string>): Song[] =>
    approved.flatMap(each => keptSongs(each, leftOut).flatMap(id => songsById.get(id) ?? []))

  return (
    <>
      <Review
        changes={here}
        sectionOf={each => each.change.why}
        head={`${plural(here.length, 'song is', 'songs are')} in your library twice`}
        tickedText={(approved, leftOut) =>
          `${approved.length} ticked, ${plural(extra(approved, leftOut).length, 'copy', 'copies')} to delete.`
        }
        notes={result.note ? [result.note] : []}
        bandText={{
          rule: {
            title: 'Exact copies',
            note: 'The same names, album and length, so they start ticked.',
          },
          model: {
            title: 'Worth a look',
            note: 'The model thinks these are one recording. Nothing is deleted unless you tick it.',
          },
        }}
        drawChange={each => (
          <>
            <Text style={reviewText.name} numberOfLines={2}>
              {each.keep.title}
              <Text style={reviewText.meta}>{`  ${artistOr(each.keep.artist)}`}</Text>
            </Text>
            <Text style={reviewText.meta} numberOfLines={1}>
              {`Keeps one · ${copyWords(each.keep)}`}
            </Text>
          </>
        )}
        labelOf={each =>
          `${each.keep.title}: delete ${plural(each.songIds.length, 'extra copy', 'extra copies')}`
        }
        songLine={copyWords}
        applyLabel={(approved, leftOut) => {
          const count = extra(approved, leftOut).length
          return count === 0 ? 'Delete' : `Delete ${plural(count, 'copy', 'copies')}`
        }}
        keyWord="delete"
        onApply={(approved, leftOut) =>
          new Promise<boolean>(answer => {
            const songs = extra(approved, leftOut)
            if (songs.length === 0) answer(false)
            else setDeleting({ songs, answer })
          })
        }
        height={height}
        onClose={onClose}
        onKeys={onKeys}
        testID="copies"
        openAtFirst={here.map(each => each.change.key)}
      />
      {deleting ? (
        <RemoveSongs
          songs={deleting.songs}
          onCancel={() => {
            deleting.answer(false)
            setDeleting(null)
          }}
          onDone={() => {
            deleting.answer(true)
            setDeleting(null)
          }}
        />
      ) : null}
    </>
  )
}

/** A copy in words, the kept one and each extra alike, so they can be told apart. */
function copyWords(song: Song): string {
  const plays = song.playCount > 0 ? ` · ${plural(song.playCount, 'play', 'plays')}` : ''
  return `${song.album || 'No album'} · ${formatDuration(song.duration)}${plays}`
}
