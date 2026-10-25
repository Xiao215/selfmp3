import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { artistOr, plural, type Song, type TidyField, type TidyResult } from '@selfmp3/shared'
import { useBulkEditSongs, coverSize, space, iconSize } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { Sparkle } from '../../ui/components/Icons'
import { useSongsById } from '../../ui/songsById'
import { showToast, showUndoToast } from '../../ui/toast'
import type { AnswerKeys } from './answerKeys'
import { Review, reviewText, songCount, type ReviewRowState } from './Review'
import { gapWords, tidyCovers, tidyEdits, tidyHere, tidyParts, type TidyHere } from './smart.model'
import { useSmartServer } from './useSmartServer'
import { useTakeCovers } from './useTakeCovers'
import { AnswerLine, AnswerNote } from './AnswerParts'

const FIELD: Record<TidyField, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album artist',
  year: 'Year',
  cover: 'Cover',
}

/** What the checkup's "Fill them in" asks, in the box that asked for the checkup. */
const FILL_WORDS = 'Fill in what’s missing'

/**
 * A4 · Tidy up's changes (docs/features/ai.md), for a yes or no each, in the
 * two bands a review has (`Review`): what a plain rule found, ticked, and the
 * model's guesses, each under its reason. A change that only takes words out
 * is one line with the part that goes struck through; a rename reads old →
 * new. Fixing is one ordinary edit per song, so it syncs like an edit made by
 * hand, and the toast's Undo writes the old names back.
 *
 * What is missing filled in — an album, a year, a cover from a catalogue — is
 * a change like the others, drawn as what it adds. A cover is the one thing
 * the server takes in rather than an edit of the song (`useTakeCovers`); Undo
 * has the server take it off again, since a fill only fills a cover that was
 * missing. A checkup says how many songs lack something, with a press
 * that asks for them to be filled in.
 */
export function TidyReview({
  result,
  height,
  onClose,
  onKeys,
  onAsk,
}: {
  result: TidyResult
  /** How tall the list may grow before it scrolls. */
  height: number
  onClose?: () => void
  /** Given the keys while this is drawn, and null when it goes. */
  onKeys?: (keys: AnswerKeys | null) => void
  /** Asks something else in the same box: the checkup's "Fill them in". */
  onAsk?: (text: string) => void
}): ReactNode {
  const server = useSmartServer()
  const save = useBulkEditSongs()
  const takeCovers = useTakeCovers()
  const songsById = useSongsById()
  const artFor = useArt(ROW_COVER_SIZE)
  const here = useMemo(
    () => tidyHere(result.changes, server.onDevice, songsById),
    [result.changes, server.onDevice, songsById],
  )

  // What a checkup found missing, and the press that asks for it to be filled in.
  const gaps = result.gaps && result.gaps.songs > 0 ? result.gaps : null
  const fill =
    gaps && onAsk ? (
      <View style={{ gap: space.xs, alignItems: 'flex-start' }} testID="tidy-gaps">
        <AnswerNote>{gapWords(gaps)}</AnswerNote>
        <Button
          label="Fill them in"
          variant="text"
          icon={<Sparkle size={iconSize.sub} />}
          onPress={() => onAsk(FILL_WORDS)}
          testID="tidy-fill"
        />
      </View>
    ) : null

  // Nothing to change is still an answer: what the model said about it comes first.
  if (here.length === 0) {
    return (
      <View style={{ gap: space.sm }}>
        {result.reply ? (
          <Text style={reviewText.reply} selectable testID="tidy-reply">
            {result.reply}
          </Text>
        ) : null}
        <AnswerLine testID="tidy-nothing">
          {result.asked !== null
            ? `Nothing to change in ${songCount(result.looked)}.`
            : `Nothing looks wrong in the names of your ${songCount(result.looked)}.`}
        </AnswerLine>
        {result.note ? <AnswerNote>{result.note}</AnswerNote> : null}
        {fill}
      </View>
    )
  }

  const apply = async (
    approved: readonly TidyHere[],
    leftOut: ReadonlySet<string>,
  ): Promise<boolean> => {
    const edits = tidyEdits(approved, leftOut)
    const covers = tidyCovers(approved, leftOut)
    if (edits.length === 0 && covers.length === 0) return false
    const undo = tidyEdits(approved, leftOut, true)
    try {
      if (edits.length > 0) await save.mutateAsync({ edits })
    } catch {
      // The mutation says what failed itself.
      return false
    }
    const { taken, missed } =
      covers.length > 0 ? await takeCovers.take(covers) : { taken: [], missed: 0 }
    const fixed = new Set([...edits.map(each => each.songId), ...covers.map(each => each.songId)])
    const said = `Fixed ${plural(fixed.size, 'song', 'songs')}${missed > 0 ? `; ${plural(missed, 'cover', 'covers')} couldn’t be fetched` : ''}`
    if (edits.length === 0 && taken.length === 0) showToast(said, 'warn')
    else {
      // Undo puts back exactly what was there: the old names, and no cover
      // where a cover was filled in.
      const back = new Set([...undo.map(each => each.songId), ...taken]).size
      showUndoToast(
        said,
        async () => {
          // Covers first: taking one off never throws, and the names' edit
          // says itself when it fails.
          const left = taken.length > 0 ? await takeCovers.takeBack(taken) : 0
          if (undo.length > 0) await save.mutateAsync({ edits: undo })
          showToast(
            `Put back ${plural(back, 'song', 'songs')}${left > 0 ? `; ${plural(left, 'cover', 'covers')} couldn’t be taken off` : ''}`,
            left > 0 ? 'warn' : 'info',
          )
        },
        { tone: missed > 0 ? 'warn' : 'good' },
      )
    }
    return true
  }

  const meta = (each: TidyHere, state: ReviewRowState): string => {
    const field = FIELD[each.change.field]
    if (each.songIds.length === 1) {
      const song = songsById.get(each.songIds[0]!)
      if (!song) return `${field} · 1 song`
      return each.change.field === 'title'
        ? `${field} · ${artistOr(song.artist)}`
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
      head={
        result.asked !== null
          ? `${plural(here.length, 'change', 'changes')} to ${songCount(result.looked)}`
          : `${plural(here.length, 'thing', 'things')} to fix in ${songCount(result.looked)}`
      }
      tickedText={(approved, leftOut) =>
        `${approved.length} ticked, on ${plural(songsIn(approved, leftOut), 'song', 'songs')}.`
      }
      notes={[result.reply, result.note].filter(note => note !== null)}
      foot={fill}
      bandText={{
        rule:
          result.asked !== null
            ? {
                title: 'From the catalogues',
                note: 'What a catalogue lists for the same recording (same artist, same length), so they start ticked.',
              }
            : { title: 'Sure fixes', note: 'Found by plain rules, so they start ticked.' },
        model: {
          title: 'Worth a look',
          note: 'Suggestions. Nothing here changes unless you tick it.',
        },
      }}
      drawChange={(each, state) => {
        const { change } = each
        const parts = tidyParts(change.from, change.to)
        // Filled in where there was nothing: only what it adds.
        const words =
          change.from === '' ? (
            change.field === 'cover' ? null : (
              <Text style={reviewText.name} numberOfLines={2}>
                <Text style={reviewText.new}>{change.to}</Text>
              </Text>
            )
          ) : parts ? (
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
          )
        // A cover to be taken is the picture it adds; a change on one song
        // shows that song, as an opened change shows each of its songs.
        const one = each.songIds.length === 1 ? songsById.get(each.songIds[0]!) : undefined
        const cover =
          change.field === 'cover' && change.from === '' ? (
            <Cover uri={change.to} title={change.why} size={COVER_SHOWN} />
          ) : one ? (
            <Cover uri={artFor(one)} title={one.album || one.title} size={coverSize.line} />
          ) : null
        const text = (
          <>
            {words}
            <Text style={reviewText.meta} numberOfLines={1}>
              {meta(each, state)}
            </Text>
          </>
        )
        if (!cover) return text
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {cover}
            <View style={{ flex: 1, minWidth: 0 }}>{text}</View>
          </View>
        )
      }}
      labelOf={each =>
        each.change.from === ''
          ? `${FIELD[each.change.field]}: add ${each.change.field === 'cover' ? `the cover ${each.change.why.toLowerCase()}` : each.change.to}`
          : `${FIELD[each.change.field]}: ${each.change.from} to ${each.change.to}`
      }
      songLine={(song, each) => songLine(song, each.change.field)}
      applyLabel={(approved, leftOut) => {
        const count = songsIn(approved, leftOut)
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

/** How big a cover to be taken is drawn beside its change. */
const COVER_SHOWN = 40

/** How many songs the ticked changes touch, a song with two of them once. */
function songsIn(approved: readonly TidyHere[], leftOut: ReadonlySet<string>): number {
  return new Set([
    ...tidyEdits(approved, leftOut).map(each => each.songId),
    ...tidyCovers(approved, leftOut).map(each => each.songId),
  ]).size
}

/** What tells one song from another in an opened change: what the change does not touch. */
function songLine(song: Song, field: TidyField): string {
  if (field === 'title') return artistOr(song.artist)
  return song.album || song.artist || 'No album'
}
