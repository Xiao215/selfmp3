import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { clamp, plural, artistOr } from '@selfmp3/shared'
import {
  hitSlopFor,
  onMac,
  radius,
  space,
  type,
  withAlpha,
  textStyle,
  iconSize,
  coverSize,
} from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { Button } from '../../ui/components/Button'
import { Checkbox, CheckRow } from '../../ui/components/Checkbox'
import { ChevronDown, ChevronRight, Sparkle } from '../../ui/components/Icons'
import { Cover } from '../../ui/components/Cover'
import { TagDot } from '../../ui/components/TagDot'
import { useSongsById } from '../../ui/songsById'
import { label as labelText, textColumn, rowTitle, hint } from '../../ui/surfaces'
import type { AnswerKeys } from './answerKeys'
import { keptSongs, leftOutKey, reviewBands, tickedAtFirst, type Reviewed } from './smart.model'
import { SongLine } from '../../ui/components/SongLine'
import { ScrollView } from '../../ui/components/Scroll'
import { AnswerActions, AnswerNote, CLOSED } from './AnswerParts'
import { Sheet } from '../../ui/components/Sheet'
import { Press } from '../../ui/components/Press'

/**
 * The steps the list is drawn in. A band's tick, then its title, note and
 * headings; a change's tick sits under the band's title, and an opened
 * change's songs tick under the change's name.
 */
const BAND_TEXT = 32
const CHANGE_TEXT = BAND_TEXT + 18 + 12

/** The round that opens a change's songs. */
const OPEN = 26

/** As a card in Ask, a review this long shows whole; a longer one shows its first few. */
const CARD_WHOLE = 5
const CARD_SHOWS = 3

/** Nothing left out: a count of everything in a list (`countOf`). */
const NONE_LEFT_OUT: ReadonlySet<string> = new Set()

/** How many changes a heading shows before "N more". */
const SECTION_SHOWS = 3
/** How many songs an opened change lists first; Ask's library answer lists as many. */
export const SONGS_SHOW = 8
/**
 * How many more each "Show more" adds. A change can be on a thousand songs,
 * and every one drawn at once is a long wait for a list nobody reads to the end.
 */
export const SONGS_MORE = 50

const COMMAND =
  typeof navigator !== 'undefined' && onMac(navigator.userAgent, navigator.maxTouchPoints ?? 0)
    ? '⌘'
    : 'ctrl'

/** Somewhere the keys can stop: a band, a change, a song in one, or a "more". */
type Stop<T> =
  | { readonly id: string; readonly kind: 'band'; readonly by: 'rule' | 'model' }
  | { readonly id: string; readonly kind: 'change'; readonly here: T }
  | { readonly id: string; readonly kind: 'section'; readonly title: string }
  | { readonly id: string; readonly kind: 'song'; readonly here: T; readonly songId: number }
  | { readonly id: string; readonly kind: 'songs'; readonly here: T }

/**
 * Ask's card for a handful of changes (AD1): what the title calls them, the
 * one line each change is ("Glass To Rum Raisin → live") with its reason
 * under it, the song whose cover leads it, and the button that names the
 * action ("Add it", "Add 3 tags").
 */
export interface ShortReview<T> {
  readonly title: (changes: readonly T[]) => string
  readonly line: (change: T) => ReactNode
  readonly why: (change: T) => string
  readonly song: (change: T) => Song | undefined
  readonly apply: (approved: readonly T[], leftOut: ReadonlySet<string>) => string
}

/** What a change's row is drawn with: whether it is ticked, and which of its songs. */
export interface ReviewRowState {
  readonly on: boolean
  readonly full: boolean
  readonly kept: readonly number[]
}

/**
 * A list of changes to say yes or no to, each a tick (Tidy up's names, the
 * tags' changes). Two bands by how far to trust them: what a plain rule found,
 * ticked, and the model's guesses with the sparkle, waiting for a yes. A
 * change on many songs opens to its songs, and any of them can be left out.
 *
 * Drawn by Ask, which hands it the keys (`onKeys`), and in sheets. What a
 * change looks like and what applying does are the caller's.
 *
 * In Ask it is a `card` (R3, Xiao 2026-10-24): nothing in it scrolls on its
 * own. Up to five changes show whole; a longer review shows its first three
 * and "Review all", which opens the whole list on a sheet with the buttons at
 * its foot. Card and sheet are one review, ticked alike. The small print
 * comes under the rows, after what the review is.
 *
 * Five or fewer, given `short`, are not a review in bands at all (AD1): one
 * line per change under a title saying what they are, as a person would list
 * them. The bands, their notes and the ticked count are for a review big
 * enough to need sorting.
 *
 * Closing says what happened, for the conversation to keep: what applying
 * did (the words `onApply` gives back), or that nothing changed.
 */
export function Review<T extends Reviewed>({
  changes,
  sectionOf,
  head,
  countOf = list => list.length,
  tickedText = (approved, leftOut) => `${countOf(approved, leftOut)} ticked.`,
  notes,
  bandText,
  drawChange,
  labelOf,
  songLine,
  applyLabel,
  keyWord,
  onApply,
  height,
  onClose,
  onKeys,
  testID,
  openAtFirst = [],
  foot,
  card = false,
  short,
}: {
  changes: readonly T[]
  /** The heading a change is listed under in its band. */
  sectionOf: (change: T) => string
  head: string
  /**
   * What the review counts, the one count all its numbers are in — what is
   * ticked, each band and section, "Review all": its changes, or a caller's
   * own unit (the tags' songs, `tagCounter`). Its head and button count the
   * same way.
   */
  countOf?: (list: readonly T[], leftOut: ReadonlySet<string>) => number
  /** What is ticked, in words, under the head. */
  tickedText?: (approved: readonly T[], leftOut: ReadonlySet<string>) => string
  /** Lines under the head, after the ticked count. */
  notes?: readonly string[]
  bandText: Record<'rule' | 'model', { title: string; note: string }>
  /** The change's words, beside its tick. */
  drawChange: (change: T, state: ReviewRowState) => ReactNode
  /** The change as one sentence, for a screen reader. */
  labelOf: (change: T) => string
  /** What tells one song from another in an opened change. */
  songLine: (song: Song, change: T) => string
  /** The apply button's words for what is ticked, with the songs left out. */
  applyLabel: (approved: readonly T[], leftOut: ReadonlySet<string>) => string
  /** The key hint's word for applying: "fix", "apply". */
  keyWord: string
  /**
   * Makes the ticked changes: false when they were not made, else true or,
   * better, what was done in words ("Fixed 31 songs").
   */
  onApply: (approved: readonly T[], leftOut: ReadonlySet<string>) => Promise<boolean | string>
  /** How tall the list may grow before it scrolls: the sheet's, or the whole review's. */
  height: number
  /** Done with: what applying did, or `CLOSED` from Close. */
  onClose?: (outcome?: string) => void
  /** Given the keys while this is drawn, and null when it goes. */
  onKeys?: (keys: AnswerKeys | null) => void
  /** The start of each part's test id: `${testID}-change`, `${testID}-apply`, … */
  testID: string
  /** Changes drawn open to their songs from the start, by key. */
  openAtFirst?: readonly string[]
  /** Drawn under the list, above the buttons. */
  foot?: ReactNode
  /** Ask's card: no list scrolling within it, a long one whole on a sheet. */
  card?: boolean
  /** The card's shape for five or fewer changes; without it they show in bands. */
  short?: ShortReview<T>
}): ReactNode {
  const songsById = useSongsById()
  const artFor = useArt(ROW_COVER_SIZE)
  const [ticked, setTicked] = useState<ReadonlySet<string> | null>(null)
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set())
  /** Headings showing every change, changes open to their songs, and how many songs opened ones show. */
  const [allOf, setAllOf] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(openAtFirst))
  const [songsShown, setSongsShown] = useState<ReadonlyMap<string, number>>(new Map())
  const shownOf = (each: T): readonly number[] =>
    each.songIds.slice(0, songsShown.get(each.change.key) ?? SONGS_SHOW)
  const showMore = (each: T): void => {
    const key = each.change.key
    setSongsShown(new Map(songsShown).set(key, shownOf(each).length + SONGS_MORE))
  }
  /** Where the keys are; none until an arrow is pressed. */
  const [at, setAt] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  /** The card's whole list, on its sheet. */
  const [whole, setWhole] = useState(false)

  const chosen = ticked ?? tickedAtFirst(changes)
  const bands = reviewBands(changes, sectionOf)
  // A change with no songs (a rename, a merge) is on or off as a whole.
  const isOn = (each: T): boolean =>
    chosen.has(each.change.key) &&
    (each.songIds.length === 0 || keptSongs(each, leftOut).length > 0)
  const fullyOn = (each: T): boolean =>
    chosen.has(each.change.key) && keptSongs(each, leftOut).length === each.songIds.length
  const approved = changes.filter(isOn)
  const waiting = changes.some(each => each.change.by === 'model' && !isOn(each))

  /** Ticks or unticks whole changes, with every song back in. */
  const flip = (list: readonly T[], on: boolean): void => {
    const next = new Set(chosen)
    const out = new Set(leftOut)
    for (const each of list) {
      if (on) next.add(each.change.key)
      else next.delete(each.change.key)
      for (const id of each.songIds) out.delete(leftOutKey(each.change.key, id))
    }
    setTicked(next)
    setLeftOut(out)
  }
  /** Leaves one song out of a change, or puts it back; a change with none left is unticked. */
  const flipSong = (each: T, songId: number): void => {
    const key = each.change.key
    const out = new Set(leftOut)
    const next = new Set(chosen)
    if (!isOn(each)) {
      // Ticking one song of an unticked change takes that song alone.
      next.add(key)
      for (const id of each.songIds) {
        if (id === songId) out.delete(leftOutKey(key, id))
        else out.add(leftOutKey(key, id))
      }
    } else if (out.has(leftOutKey(key, songId))) out.delete(leftOutKey(key, songId))
    else {
      out.add(leftOutKey(key, songId))
      if (each.songIds.every(id => out.has(leftOutKey(key, id)))) {
        next.delete(key)
        for (const id of each.songIds) out.delete(leftOutKey(key, id))
      }
    }
    setTicked(next)
    setLeftOut(out)
  }
  const toggle = (set: ReadonlySet<string>, key: string): Set<string> => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }

  const apply = async (): Promise<void> => {
    if (approved.length === 0 || applying) return
    setApplying(true)
    try {
      const done = await onApply(approved, leftOut)
      if (done !== false) {
        setTicked(new Set())
        setLeftOut(new Set())
        setWhole(false)
        onClose?.(typeof done === 'string' ? done : undefined)
      }
    } finally {
      setApplying(false)
    }
  }

  // A handful of changes on Ask's card are one line each, and the keys stop on each.
  const shortCard = card && short && changes.length <= CARD_WHOLE ? short : null
  // Every place the keys can stop, in the order drawn.
  const stops: Stop<T>[] = shortCard
    ? changes.map((each): Stop<T> => ({
        id: `change:${each.change.key}`,
        kind: 'change',
        here: each,
      }))
    : []
  for (const band of shortCard ? [] : bands) {
    stops.push({ id: `band:${band.by}`, kind: 'band', by: band.by })
    for (const section of band.sections) {
      const shown = allOf.has(section.title)
        ? section.changes
        : section.changes.slice(0, SECTION_SHOWS)
      for (const each of shown) {
        stops.push({ id: `change:${each.change.key}`, kind: 'change', here: each })
        if (!open.has(each.change.key)) continue
        const songs = shownOf(each)
        for (const songId of songs) {
          stops.push({ id: `song:${each.change.key}:${songId}`, kind: 'song', here: each, songId })
        }
        if (songs.length < each.songIds.length) {
          stops.push({ id: `songs:${each.change.key}`, kind: 'songs', here: each })
        }
      }
      if (shown.length < section.changes.length) {
        stops.push({ id: `section:${section.title}`, kind: 'section', title: section.title })
      }
    }
  }
  const atIndex = stops.findIndex(stop => stop.id === at)
  const atStop = atIndex >= 0 ? stops[atIndex] : undefined

  const press = (stop: Stop<T>): void => {
    switch (stop.kind) {
      case 'band': {
        const list = changes.filter(each => each.change.by === stop.by)
        flip(list, !list.every(each => fullyOn(each)))
        return
      }
      case 'change':
        flip([stop.here], !fullyOn(stop.here))
        return
      case 'section':
        setAllOf(toggle(allOf, stop.title))
        return
      case 'song':
        flipSong(stop.here, stop.songId)
        return
      case 'songs':
        showMore(stop.here)
        return
    }
  }

  // The Search box keeps the focus, so it hands its keys here.
  const onKey = (key: string, command: boolean): boolean => {
    if (key === 'Enter' && command) {
      void apply()
      return true
    }
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (stops.length === 0) return true
      const from = atIndex < 0 ? (key === 'ArrowDown' ? -1 : stops.length) : atIndex
      const to = clamp(from + (key === 'ArrowDown' ? 1 : -1), 0, stops.length - 1)
      setAt(stops[to]!.id)
      return true
    }
    if (!atStop) return key === 'Enter'
    if (key === ' ' || key === 'Enter') {
      press(atStop)
      return true
    }
    if (key === 'ArrowRight' && atStop.kind === 'change' && atStop.here.songIds.length > 1) {
      setOpen(new Set([...open, atStop.here.change.key]))
      return true
    }
    if (key === 'ArrowLeft' && (atStop.kind === 'change' || atStop.kind === 'song')) {
      const key = atStop.here.change.key
      // One song shown from the start has no chevron to bring it back.
      if (!open.has(key) || atStop.here.songIds.length < 2) return false
      const next = new Set(open)
      next.delete(key)
      setOpen(next)
      setAt(`change:${key}`)
      return true
    }
    return false
  }
  const lineByLine = shortCard !== null
  // Read through a ref, so the handler given once always sees the last draw's state.
  const keyRef = useRef(onKey)
  useEffect(() => {
    keyRef.current = onKey
  })
  useEffect(() => {
    if (!onKeys) return
    onKeys({
      press: (key, command) => keyRef.current(key, command),
      hints: [
        [['↑', '↓'], 'move'],
        [['space'], 'tick'],
        // A short card's lines do not open to their songs.
        ...(lineByLine ? [] : [[['→'], 'songs'] as const]),
        [[COMMAND, '↵'], keyWord],
      ],
    })
    return () => onKeys(null)
  }, [onKeys, keyWord, lineByLine])

  // Keep the stop the keys are on in view.
  const nodes = useRef(new Map<string, unknown>())
  useEffect(() => {
    if (at === null) return
    const node = nodes.current.get(at) as
      { scrollIntoView?: (options: { block: 'nearest' }) => void } | undefined
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [at])
  const place = (id: string) => (node: unknown) => {
    if (node) nodes.current.set(id, node)
    else nodes.current.delete(id)
  }

  const drawRow = (each: T, flat = false): ReactNode => {
    const { change } = each
    const id = `change:${change.key}`
    const on = isOn(each)
    const full = fullyOn(each)
    const many = each.songIds.length > 1
    const opened = open.has(change.key)
    const songs = shownOf(each)
    return (
      <View key={change.key}>
        <CheckRow
          ref={place(id)}
          checked={full}
          mixed={on}
          label={labelOf(each)}
          onPress={() => {
            setAt(null)
            flip([each], !full)
          }}
          feedback="dim"
          style={[styles.change, flat && styles.flatChange, at === id && styles.at]}
          testID={`${testID}-change`}
        >
          <Checkbox checked={full} mixed={on && !full} />
          <View style={styles.words}>
            {drawChange(each, { on, full, kept: keptSongs(each, leftOut) })}
          </View>
          {many ? (
            <Press
              feedback="dim"
              onPress={() => {
                setAt(null)
                setOpen(toggle(open, change.key))
              }}
              accessibilityRole="button"
              accessibilityLabel={
                opened
                  ? 'Hide the songs'
                  : `Show the ${plural(each.songIds.length, 'song', 'songs')}`
              }
              hitSlop={hitSlopFor(OPEN)}
              style={styles.open}
              testID={`${testID}-open`}
            >
              {opened ? (
                <ChevronDown size={iconSize.button} tone="textMuted" />
              ) : (
                <ChevronRight size={iconSize.button} tone="textMuted" />
              )}
            </Press>
          ) : null}
        </CheckRow>
        {opened ? (
          <View style={[styles.songs, flat && styles.flatSongs]}>
            {songs.map(songId => {
              const song = songsById.get(songId)
              if (!song) return null
              const songStop = `song:${change.key}:${songId}`
              const kept = on && !leftOut.has(leftOutKey(change.key, songId))
              return (
                <CheckRow
                  key={songId}
                  ref={place(songStop)}
                  checked={kept}
                  label={`${song.title}, ${artistOr(song.artist)}`}
                  onPress={() => {
                    setAt(null)
                    flipSong(each, songId)
                  }}
                  feedback="dim"
                  style={[styles.song, at === songStop && styles.at]}
                  testID={`${testID}-song`}
                >
                  <SongLine
                    style={styles.songLine}
                    leading={<Checkbox checked={kept} />}
                    artUri={artFor(song)}
                    coverTitle={song.album || song.title}
                    title={song.title}
                    sub={songLine(song, each)}
                  />
                </CheckRow>
              )
            })}
            {songs.length < each.songIds.length ? (
              <More
                stop={`songs:${change.key}`}
                indent={space.xs}
                at={at}
                place={place}
                text={`Show ${Math.min(SONGS_MORE, each.songIds.length - songs.length)} more`}
                onPress={() => showMore(each)}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    )
  }

  const ticks = (
    <AnswerNote>
      {approved.length === 0 ? 'Nothing ticked yet.' : tickedText(approved, leftOut)}
      {waiting ? ' The ✦ ones wait for you.' : ''}
    </AnswerNote>
  )
  const small = (notes ?? []).map(note => <AnswerNote key={note}>{note}</AnswerNote>)
  const bandsDrawn = bands.map(band => {
    const list = band.sections.flatMap(section => section.changes)
    const on = countOf(list.filter(isOn), leftOut)
    const total = countOf(list, NONE_LEFT_OUT)
    const all = list.every(fullyOn)
    const id = `band:${band.by}`
    const model = band.by === 'model'
    const text = bandText[band.by]
    return (
      <View key={band.by} style={styles.band} testID={`${testID}-band-${band.by}`}>
        <CheckRow
          ref={place(id)}
          checked={all}
          mixed={on > 0}
          label={`${text.title}, ${on} of ${total} ticked`}
          onPress={() => {
            setAt(null)
            flip(list, !all)
          }}
          feedback="dim"
          style={[styles.bandHead, at === id && styles.at]}
          testID={`${testID}-section`}
        >
          <Checkbox checked={all} mixed={on > 0 && !all} />
          {model ? <Sparkle size={iconSize.field} /> : null}
          <Text style={styles.bandTitle}>{text.title}</Text>
          <Text style={styles.count}>
            {on} of {total} ticked
          </Text>
        </CheckRow>
        <Text style={styles.bandNote}>{text.note}</Text>
        {band.sections.map(section => {
          const shown = allOf.has(section.title)
            ? section.changes
            : section.changes.slice(0, SECTION_SHOWS)
          return (
            <View key={section.title}>
              <View style={styles.section}>
                <Text style={styles.sectionText} numberOfLines={1}>
                  {section.title}
                </Text>
                <Text style={[styles.sectionText, styles.sectionCount]}>
                  {countOf(section.changes, NONE_LEFT_OUT)}
                </Text>
              </View>
              {shown.map(each => drawRow(each))}
              {shown.length < section.changes.length ? (
                <More
                  stop={`section:${section.title}`}
                  indent={CHANGE_TEXT}
                  at={at}
                  place={place}
                  text={`${countOf(section.changes.slice(shown.length), NONE_LEFT_OUT)} more`}
                  onPress={() => setAllOf(toggle(allOf, section.title))}
                />
              ) : null}
            </View>
          )
        })}
      </View>
    )
  })
  // Scrolls within itself only up to `height`: on a sheet, or a review that is one.
  const scrolling = (
    <ScrollView
      style={{ maxHeight: height }}
      contentContainerStyle={styles.list}
      testID={`${testID}-list`}
    >
      {bandsDrawn}
    </ScrollView>
  )
  const buttons = (
    <>
      {onClose ? <Button label="Close" onPress={() => onClose(CLOSED)} /> : null}
      <Button
        label={applyLabel(approved, leftOut)}
        variant="primary"
        disabled={approved.length === 0}
        busy={applying}
        onPress={() => void apply()}
        testID={`${testID}-apply`}
      />
    </>
  )

  if (shortCard) {
    return (
      <View style={[styles.body, styles.card]} testID={`${testID}-review`}>
        <Text style={styles.head}>{shortCard.title(changes)}</Text>
        <View testID={`${testID}-list`}>
          {changes.map(each => {
            const id = `change:${each.change.key}`
            const full = fullyOn(each)
            const song = shortCard.song(each)
            return (
              <CheckRow
                key={each.change.key}
                ref={place(id)}
                checked={full}
                mixed={isOn(each)}
                label={labelOf(each)}
                onPress={() => {
                  setAt(null)
                  flip([each], !full)
                }}
                feedback="dim"
                style={[styles.shortRow, at === id && styles.at]}
                testID={`${testID}-change`}
              >
                <Checkbox checked={full} mixed={isOn(each) && !full} />
                {song ? (
                  <Cover
                    uri={artFor(song)}
                    title={song.album || song.title}
                    size={coverSize.line}
                  />
                ) : null}
                <View style={styles.words}>
                  <View style={styles.shortLine}>
                    {each.change.by === 'model' ? <Sparkle size={iconSize.tiny} /> : null}
                    {shortCard.line(each)}
                  </View>
                  <Text style={reviewText.meta} numberOfLines={2}>
                    {shortCard.why(each)}
                  </Text>
                </View>
              </CheckRow>
            )
          })}
        </View>
        {small}
        {foot}
        <AnswerActions>
          {onClose ? <Button label="Close" onPress={() => onClose(CLOSED)} /> : null}
          <Button
            label={shortCard.apply(approved, leftOut)}
            variant="primary"
            disabled={approved.length === 0}
            busy={applying}
            onPress={() => void apply()}
            testID={`${testID}-apply`}
          />
        </AnswerActions>
      </View>
    )
  }

  if (card) {
    const first =
      changes.length > CARD_WHOLE
        ? bands
            .flatMap(band => band.sections.flatMap(section => section.changes))
            .slice(0, CARD_SHOWS)
        : null
    return (
      <View style={[styles.body, styles.card]} testID={`${testID}-review`}>
        <View style={styles.top}>
          <Text style={styles.head}>{head}</Text>
          {ticks}
        </View>
        {first ? (
          <View testID={`${testID}-list`}>{first.map(each => drawRow(each, true))}</View>
        ) : (
          <View style={styles.list} testID={`${testID}-list`}>
            {bandsDrawn}
          </View>
        )}
        {small}
        {foot}
        <View style={styles.cardFoot}>
          {first ? (
            <Button
              label={`Review all ${countOf(changes, NONE_LEFT_OUT)}`}
              variant="text"
              size="small"
              onPress={() => setWhole(true)}
              testID={`${testID}-all`}
            />
          ) : (
            <View />
          )}
          <View style={styles.cardButtons}>{buttons}</View>
        </View>
        {first ? (
          <Sheet
            open={whole}
            onClose={() => setWhole(false)}
            title={head}
            width={760}
            testID={`${testID}-sheet`}
          >
            <View style={styles.sheetBody}>
              {ticks}
              {scrolling}
              {small}
              <AnswerActions>{buttons}</AnswerActions>
            </View>
          </Sheet>
        ) : null}
      </View>
    )
  }

  return (
    <View style={styles.body} testID={`${testID}-review`}>
      <View style={styles.top}>
        <Text style={styles.head}>{head}</Text>
        {ticks}
        {small}
      </View>
      {scrolling}
      {foot}
      <AnswerActions>{buttons}</AnswerActions>
    </View>
  )
}

/** "1,342 songs": a library's size reads better with its thousands marked. */
export function songCount(count: number): string {
  return plural(count, 'song', 'songs')
}

function More({
  stop,
  at,
  place,
  text,
  indent,
  onPress,
}: {
  /** Where its words start, from the edge of what it sits in. */
  indent: number
  stop: string
  at: string | null
  place: (id: string) => (node: unknown) => void
  text: string
  onPress: () => void
}): ReactNode {
  return (
    <Press
      feedback="dim"
      ref={place(stop)}
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.more, { marginLeft: indent - space.sm }, at === stop && styles.at]}
    >
      <Text style={styles.moreText}>{text}</Text>
    </Press>
  )
}

/**
 * A tag named in a short review's line: its dot and its name on a quiet
 * pill, as a song row's tag chips are; struck through when it goes.
 */
export function ReviewTag({
  name,
  hue,
  gone = false,
}: {
  name: string
  hue: number | undefined
  gone?: boolean
}): ReactNode {
  return (
    <View style={styles.tag}>
      <TagDot hue={hue} size={7} />
      <Text style={[styles.tagName, gone && styles.tagGone]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  )
}

/** The words of a change: a name line and a quiet line under it, as both reviews draw them. */
export const reviewText = StyleSheet.create(theme => ({
  name: { color: theme.colors.textPrimary, ...textStyle('sub') },
  gone: {
    color: theme.colors.danger,
    textDecorationLine: 'line-through',
    borderRadius: 3,
    backgroundColor: theme.colors.dangerWash,
  },
  new: {
    color: theme.colors.good,
    borderRadius: 3,
    backgroundColor: theme.colors.goodWash,
  },
  arrow: { color: theme.colors.textMuted },
  /** A song named in a short review's line. */
  song: { fontWeight: '600', flexShrink: 1 },
  meta: { color: theme.colors.textMuted, fontSize: type.small },
  /** The model's own words about what was asked. */
  reply: { color: theme.colors.textPrimary, ...textStyle('body') },
}))

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  top: { gap: 2 },
  head: { color: theme.colors.textPrimary, fontSize: type.title, fontWeight: '600' },
  list: { gap: space.sm },
  // Ask's card: the band's tint around the whole review, so it reads as one thing.
  card: {
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.035),
    borderRadius: radius.cardLg,
    padding: space.md,
  },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.xs,
  },
  cardButtons: { flexDirection: 'row', gap: space.sm },
  sheetBody: { gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  // Tints rather than surfaces: the palette is surface1 and the sheet surface2.
  band: {
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.035),
    borderRadius: radius.mini,
    paddingHorizontal: space.sm,
    paddingTop: space.xs,
    paddingBottom: space.sm,
  },
  bandHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  bandTitle: { flex: 1, ...rowTitle(theme.colors) },
  count: { color: theme.colors.textMuted, fontSize: type.small, fontVariant: ['tabular-nums'] },
  bandNote: {
    ...hint(theme.colors),
    paddingLeft: BAND_TEXT,
    paddingBottom: space.xs,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    paddingTop: space.sm,
    paddingBottom: 2,
    paddingLeft: BAND_TEXT,
    paddingRight: space.xs,
  },
  sectionText: { ...labelText(theme.colors), flexShrink: 1 },
  sectionCount: { marginLeft: 'auto', letterSpacing: 0, fontVariant: ['tabular-nums'] },
  change: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: 7,
    paddingLeft: BAND_TEXT,
    paddingRight: space.xs,
    borderRadius: radius.coverSm,
  },
  // A handful on the card: the tick at its edge, the song's cover, then the line.
  shortRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.snug,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  shortLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.tight },
  // A card's first few, under no band: the tick at the card's own edge.
  flatChange: { paddingLeft: space.xs },
  flatSongs: { paddingLeft: BAND_TEXT },
  at: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.07) },
  words: textColumn,
  open: {
    width: OPEN,
    height: OPEN,
    marginTop: -3,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  songs: { gap: 2, paddingLeft: CHANGE_TEXT - space.xs, paddingBottom: space.xs },
  song: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  // The row around it has the room and the press; the line is its face.
  songLine: { flex: 1, minWidth: 0, paddingVertical: 0, paddingHorizontal: 0 },
  more: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    borderRadius: radius.coverSm,
  },
  moreText: { color: theme.colors.accent, fontSize: type.sub, fontWeight: '500' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    flexShrink: 1,
  },
  tagName: { color: theme.colors.textPrimary, fontSize: type.small, fontWeight: '500' },
  tagGone: { textDecorationLine: 'line-through', color: theme.colors.textSecondary },
}))
