import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { plural, type Song, type TidyField, type TidyResult } from '@selfmp3/shared'
import { useBulkEditSongs, useLibrary } from '@selfmp3/client'
import { showToast } from '../../ui/toast'
import type { AnswerKeys } from './answerKeys'
import { Review, reviewText, songCount, type ReviewRowState } from './Review'
import { tidyEdits, tidyHere, tidyParts, type TidyHere } from './smart.model'
import { useSmartServer } from './useSmartServer'

const FIELD: Record<TidyField, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album artist',
}

/**
 * A4 · Tidy up's changes (docs/features/ai.md), for a yes or no each, in the
 * two bands a review has (`Review`): what a plain rule found, ticked, and the
 * model's guesses, each under its reason. A change that only takes words out
 * is one line with the part that goes struck through; a rename reads old →
 * new. Fixing is one ordinary edit per song, so it syncs like an edit made by
 * hand, and the toast's Undo writes the old names back.
 */
export function TidyReview({
  result,
  height,
  onClose,
  onKeys,
}: {
  result: TidyResult
  /** How tall the list may grow before it scrolls. */
  height: number
  onClose?: () => void
  /** Given the keys while this is drawn, and null when it goes. */
  onKeys?: (keys: AnswerKeys | null) => void
}): ReactNode {
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const save = useBulkEditSongs()
  const songsById = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )
  const here = useMemo(
    () => tidyHere(result.changes, server.onDevice, songsById),
    [result.changes, server.onDevice, songsById],
  )

  if (here.length === 0) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={reviewText.line} testID="tidy-nothing">
          Nothing looks wrong in the names of your {songCount(result.looked)}.
        </Text>
        {result.note ? <Text style={reviewText.note}>{result.note}</Text> : null}
      </View>
    )
  }

  const apply = async (
    approved: readonly TidyHere[],
    leftOut: ReadonlySet<string>,
  ): Promise<boolean> => {
    const edits = tidyEdits(approved, leftOut)
    if (edits.length === 0) return false
    const undo = tidyEdits(approved, leftOut, true)
    try {
      await save.mutateAsync({ edits })
    } catch {
      // The mutation says what failed itself.
      return false
    }
    showToast(`Fixed ${plural(edits.length, 'song', 'songs')}`, 'good', {
      actions: [
        {
          label: 'Undo',
          onPress: () => {
            save.mutateAsync({ edits: undo }).then(
              () => showToast(`Put back ${plural(undo.length, 'song', 'songs')}`, 'info'),
              // The mutation says what failed itself.
              () => undefined,
            )
          },
        },
      ],
    })
    return true
  }

  const meta = (each: TidyHere, state: ReviewRowState): string => {
    const field = FIELD[each.change.field]
    if (each.songIds.length === 1) {
      const song = songsById.get(each.songIds[0]!)
      if (!song) return `${field} · 1 song`
      return each.change.field === 'title'
        ? `${field} · ${song.artist || 'Unknown artist'}`
        : `${field} · on ${song.title}`
    }
    if (state.on && state.kept.length < each.songIds.length) {
      return `${field} · ${state.kept.length} of ${plural(each.songIds.length, 'song', 'songs')}`
    }
    return `${field} · ${plural(each.songIds.length, 'song', 'songs')}`
  }

  return (
    <Review
      changes={here}
      sectionOf={each => each.change.why}
      head={`${plural(here.length, 'thing', 'things')} to fix in ${songCount(result.looked)}`}
      tickedText={(approved, leftOut) =>
        `${approved.length} ticked, on ${plural(tidyEdits(approved, leftOut).length, 'song', 'songs')}.`
      }
      notes={result.note ? [result.note] : []}
      bandText={{
        rule: { title: 'Sure fixes', note: 'Found by plain rules, so they start ticked.' },
        model: {
          title: 'Worth a look',
          note: 'The model’s guesses. Nothing here changes unless you tick it.',
        },
      }}
      drawChange={(each, state) => {
        const { change } = each
        const parts = tidyParts(change.from, change.to)
        return (
          <>
            {parts ? (
              <Text style={reviewText.name} numberOfLines={2}>
                {parts.map((part, index) =>
                  part.kind === 'same' ? (
                    part.text
                  ) : (
                    <Text key={index} style={reviewText.gone}>
                      {part.text}
                    </Text>
                  ),
                )}
              </Text>
            ) : (
              <Text style={reviewText.name} numberOfLines={2}>
                <Text style={reviewText.gone}>{change.from}</Text>
                <Text style={reviewText.arrow}>{'  →  '}</Text>
                <Text style={reviewText.new}>{change.to}</Text>
              </Text>
            )}
            <Text style={reviewText.meta} numberOfLines={1}>
              {meta(each, state)}
            </Text>
          </>
        )
      }}
      labelOf={each => `${FIELD[each.change.field]}: ${each.change.from} to ${each.change.to}`}
      songLine={(song, each) => songLine(song, each.change.field)}
      applyLabel={(approved, leftOut) => {
        const count = tidyEdits(approved, leftOut).length
        return count === 0 ? 'Fix' : `Fix ${plural(count, 'song', 'songs')}`
      }}
      keyWord="fix"
      onApply={apply}
      height={height}
      onClose={onClose}
      onKeys={onKeys}
      testID="tidy"
    />
  )
}

/** What tells one song from another in an opened change: what the change does not touch. */
function songLine(song: Song, field: TidyField): string {
  if (field === 'title') return song.artist || 'Unknown artist'
  return song.album || song.artist || 'No album'
}
