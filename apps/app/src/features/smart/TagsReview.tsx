import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { plural, type TagReview } from '@selfmp3/shared'
import { useLibrary } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { showToast } from '../../ui/toast'
import type { AnswerKeys } from './answerKeys'
import { Review, reviewText, songCount, type ReviewRowState } from './Review'
import { tagChangesHere, tagSection, tagSteps, type TagHere } from './smart.model'
import { useSmartServer } from './useSmartServer'
import { useTagChanges } from './useTagChanges'

/**
 * Tags (docs/features/ai.md): changes to your tags, for a yes or no each —
 * songs given a tag or taken out of one, a tag renamed, merged or deleted. In
 * the two bands a review has (`Review`): what your library's own tagging
 * says, ticked, and the model's guesses, waiting for a yes. An add or a
 * remove opens to its songs, and any can be left out.
 *
 * Drawn by the Search box's Ask and by Tags' Suggest tags sheet.
 */
export function TagsReview({
  review,
  height,
  onClose,
  onKeys,
}: {
  review: TagReview
  /** How tall the list may grow before it scrolls. */
  height: number
  onClose?: () => void
  /** Given the keys while this is drawn, and null when it goes. */
  onKeys?: (keys: AnswerKeys | null) => void
}): ReactNode {
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const change = useTagChanges()
  const songsById = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )
  const here = useMemo(
    () => tagChangesHere(review.changes, server.onDevice, songsById, library?.tags ?? []),
    [review.changes, server.onDevice, songsById, library?.tags],
  )

  const notes: string[] = []
  if (review.note) notes.push(review.note)
  if (review.unsure.length > 0) {
    notes.push(`Left alone: ${review.unsure.map(each => `${each.who} (${each.why})`).join(' · ')}`)
  }

  if (here.length === 0) {
    const line =
      review.asked !== null
        ? 'Nothing to change: your tags already fit that.'
        : review.looked === 0
          ? 'Every song here has a tag.'
          : `Nothing to suggest for your ${songCount(review.looked)} without a tag.`
    return (
      <View style={{ gap: 8 }}>
        <Text style={reviewText.line} testID="tags-nothing">
          {line}
        </Text>
        {notes.map(note => (
          <Text key={note} style={reviewText.note}>
            {note}
          </Text>
        ))}
        {onClose ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button label="Close" onPress={onClose} />
          </View>
        ) : null}
      </View>
    )
  }

  const apply = async (
    approved: readonly TagHere[],
    leftOut: ReadonlySet<string>,
  ): Promise<boolean> => {
    const steps = tagSteps(approved, leftOut, library?.songs ?? [], library?.playlists ?? [])
    if (steps.length === 0) return false
    const done = await change(steps)
    const undo = {
      label: 'Undo',
      onPress: () => {
        done.undo().then(
          () => showToast('Put your tags back', 'info'),
          // The edit that failed said so.
          () => undefined,
        )
      },
    }
    if (!done.ok) {
      showToast('Some of the changes were made', 'warn', { actions: [undo] })
      return false
    }
    showToast(`Made ${plural(approved.length, 'change', 'changes')} to your tags`, 'good', {
      actions: [undo],
    })
    return true
  }

  const meta = (each: TagHere, state: ReviewRowState): string => {
    const { change: c } = each
    const songs =
      state.on && state.kept.length < each.songIds.length
        ? `${state.kept.length} of ${plural(each.songIds.length, 'song', 'songs')}`
        : plural(each.songIds.length, 'song', 'songs')
    switch (c.op) {
      case 'add':
        return `${each.tag ? 'Put on' : 'A new tag for'} ${songs} · ${c.who}`
      case 'remove':
        return `Take off ${songs} · ${c.who}`
      case 'rename':
        return `Rename · ${c.who}`
      case 'merge':
        return `Its songs go into ${c.to} · ${c.who}`
      case 'delete':
        return `Its songs keep their other tags · ${c.who}`
    }
  }

  return (
    <Review
      changes={here}
      sectionOf={each => tagSection(each.change)}
      head={
        review.asked !== null
          ? `${plural(here.length, 'change', 'changes')} to your tags`
          : `${plural(here.length, 'suggestion', 'suggestions')} for ${songCount(review.looked)} without a tag`
      }
      notes={notes}
      bandText={{
        rule: {
          title: 'From your library',
          note: 'Read off how your songs are tagged already, so they start ticked.',
        },
        model: {
          title: 'Worth a look',
          note: 'The model’s guesses. Nothing here changes unless you tick it.',
        },
      }}
      drawChange={(each, state) => {
        const { change: c } = each
        return (
          <>
            <Text style={reviewText.name} numberOfLines={2}>
              {c.op === 'add' ? (
                <Text style={reviewText.new}>
                  + {c.tag}
                  {each.tag ? '' : ' (new)'}
                </Text>
              ) : c.op === 'rename' || c.op === 'merge' ? (
                <>
                  <Text style={reviewText.gone}>{c.tag}</Text>
                  <Text style={reviewText.arrow}>{'  →  '}</Text>
                  <Text style={reviewText.new}>{c.to}</Text>
                </>
              ) : (
                <Text style={reviewText.gone}>{c.tag}</Text>
              )}
            </Text>
            <Text style={reviewText.meta} numberOfLines={1}>
              {meta(each, state)}
            </Text>
            <Text style={reviewText.meta} numberOfLines={2}>
              {c.why}
            </Text>
          </>
        )
      }}
      labelOf={each => {
        const { change: c } = each
        switch (c.op) {
          case 'add':
            return `Put ${c.tag} on ${plural(each.songIds.length, 'song', 'songs')}`
          case 'remove':
            return `Take ${c.tag} off ${plural(each.songIds.length, 'song', 'songs')}`
          case 'rename':
            return `Rename ${c.tag} to ${c.to}`
          case 'merge':
            return `Merge ${c.tag} into ${c.to}`
          case 'delete':
            return `Delete ${c.tag}`
        }
      }}
      songLine={song => song.artist || 'Unknown artist'}
      applyLabel={approved =>
        approved.length === 0 ? 'Apply' : `Apply ${plural(approved.length, 'change', 'changes')}`
      }
      keyWord="apply"
      onApply={apply}
      height={height}
      onClose={onClose}
      onKeys={onKeys}
      testID="tags"
    />
  )
}
