import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { artistOr, plural, type TagReview } from '@selfmp3/shared'
import { useLibrary, space } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { useSongsById } from '../../ui/songsById'
import { showUndoToast } from '../../ui/toast'
import type { AnswerKeys } from './answerKeys'
import {
  Review,
  ReviewTag,
  reviewText,
  songCount,
  type ReviewRowState,
  type ShortReview,
} from './Review'
import {
  tagChangesHere,
  tagCounter,
  tagsApply,
  tagsTitle,
  tagSection,
  tagSteps,
  type TagHere,
} from './smart.model'
import { useSmartServer } from './useSmartServer'
import { useTagChanges } from './useTagChanges'
import { AnswerLine, AnswerNote, CLOSED } from './AnswerParts'

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
  card = false,
}: {
  review: TagReview
  /** How tall the list may grow before it scrolls. */
  height: number
  /** Done with: what was changed, or that nothing changed. */
  onClose?: (outcome?: string) => void
  /** Ask's card (`Review`). */
  card?: boolean
  /** Given the keys while this is drawn, and null when it goes. */
  onKeys?: (keys: AnswerKeys | null) => void
}): ReactNode {
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const change = useTagChanges()
  const songsById = useSongsById()
  const here = useMemo(
    () => tagChangesHere(review.changes, server.onDevice, songsById, library?.tags ?? []),
    [review.changes, server.onDevice, songsById, library?.tags],
  )
  // One count everywhere on the review: its songs, or its changes when a tag itself changes.
  const count = useMemo(() => tagCounter(here), [here])
  const ops = here.map(each => each.change.op)

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
      <View style={{ gap: space.sm }}>
        <AnswerLine testID="tags-nothing">{line}</AnswerLine>
        {notes.map(note => (
          <AnswerNote key={note}>{note}</AnswerNote>
        ))}
        {onClose ? (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button label="Close" onPress={() => onClose(CLOSED)} />
          </View>
        ) : null}
      </View>
    )
  }

  const apply = async (
    approved: readonly TagHere[],
    leftOut: ReadonlySet<string>,
  ): Promise<boolean | string> => {
    const steps = tagSteps(approved, leftOut, library?.songs ?? [], library?.playlists ?? [])
    if (steps.length === 0) return false
    const done = await change(steps)
    // The edit that failed says so itself.
    const after = 'Put your tags back'
    if (!done.ok) {
      showUndoToast('Some of the changes were made', done.undo, { tone: 'warn', after })
      return false
    }
    const made = ops.every(op => op === 'add' || op === 'remove')
      ? `Changed the tags on ${songCount(count(approved, leftOut))}`
      : `Made ${plural(approved.length, 'change', 'changes')} to your tags`
    showUndoToast(made, done.undo, { tone: 'good', after })
    return made
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
        return `Remove from ${songs} · ${c.who}`
      case 'rename':
        return `Rename · ${c.who}`
      case 'merge':
        return `Its songs go into ${c.to} · ${c.who}`
      case 'delete':
        return `Its songs keep their other tags · ${c.who}`
    }
  }

  // A handful on Ask's card, one line each (AD1): "Glass To Rum Raisin → live".
  const songsOf = (each: TagHere): string => {
    const first = songsById.get(each.songIds[0]!)
    if (!first) return plural(each.songIds.length, 'song', 'songs')
    return each.songIds.length > 1
      ? `${first.title} and ${each.songIds.length - 1} more`
      : first.title
  }
  const short: ShortReview<TagHere> = {
    title: list => tagsTitle(ops, count(list)),
    song: each => songsById.get(each.songIds[0]!),
    why: each => each.change.why,
    apply: (approved, leftOut) => tagsApply(ops, count(approved, leftOut)),
    line: each => {
      const { change: c } = each
      const hue = each.tag?.hue
      const songs =
        each.songIds.length > 0 ? (
          <Text style={[reviewText.name, reviewText.song]} numberOfLines={1}>
            {songsOf(each)}
          </Text>
        ) : null
      const arrow = <Text style={reviewText.arrow}>→</Text>
      switch (c.op) {
        case 'add':
          return (
            <>
              {songs}
              {arrow}
              <ReviewTag name={each.tag ? c.tag : `${c.tag} (new)`} hue={hue} />
            </>
          )
        case 'remove':
          return (
            <>
              {songs}
              {arrow}
              <ReviewTag name={c.tag} hue={hue} gone />
            </>
          )
        case 'rename':
        case 'merge':
          return (
            <>
              <ReviewTag name={c.tag} hue={hue} gone />
              {arrow}
              <ReviewTag name={c.to ?? ''} hue={each.into?.hue ?? hue} />
            </>
          )
        case 'delete':
          return <ReviewTag name={c.tag} hue={hue} gone />
      }
    },
  }

  return (
    <Review
      card={card}
      short={short}
      changes={here}
      // A change on one song has nothing to open, so its song shows from the start.
      openAtFirst={here.filter(each => each.songIds.length === 1).map(each => each.change.key)}
      sectionOf={each => tagSection(each.change)}
      countOf={count}
      head={
        review.asked !== null
          ? tagsTitle(ops, count(here))
          : `Tags for ${count(here)} of your ${songCount(review.looked)} without a tag`
      }
      notes={notes}
      bandText={{
        rule: {
          title: 'From your library',
          note: 'Read off how your songs are tagged already, so they start ticked.',
        },
        model: {
          title: 'Worth a look',
          note: 'Suggestions. Nothing here changes unless you tick it.',
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
        const only = each.songIds.length === 1 ? songsById.get(each.songIds[0]!) : undefined
        const songs = only ? only.title : plural(each.songIds.length, 'song', 'songs')
        switch (c.op) {
          case 'add':
            return `Put ${c.tag} on ${songs}`
          case 'remove':
            return `Take ${c.tag} off ${songs}`
          case 'rename':
            return `Rename ${c.tag} to ${c.to}`
          case 'merge':
            return `Merge ${c.tag} into ${c.to}`
          case 'delete':
            return `Delete ${c.tag}`
        }
      }}
      songLine={song => artistOr(song.artist)}
      applyLabel={(approved, leftOut) => tagsApply(ops, count(approved, leftOut))}
      keyWord="apply"
      onApply={apply}
      height={height}
      onClose={onClose}
      onKeys={onKeys}
      testID="tags"
    />
  )
}
