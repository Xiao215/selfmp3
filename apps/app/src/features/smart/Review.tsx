import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Song } from '@selfmp3/shared'
import { onMac, radius, space, withAlpha } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Cover } from '../../ui/components/Cover'
import { ChevronDown, ChevronRight, Sparkle } from '../../ui/components/Icons'
import { useSongsById } from '../../ui/songsById'
import { label as labelText } from '../../ui/surfaces'
import type { AnswerKeys } from './answerKeys'
import { keptSongs, leftOutKey, reviewBands, tickedAtFirst, type Reviewed } from './smart.model'

/**
 * The steps the list is drawn in. A band's tick, then its title, note and
 * headings; a change's tick sits under the band's title, and an opened
 * change's songs tick under the change's name.
 */
const BAND_TEXT = 32
const CHANGE_TEXT = BAND_TEXT + 18 + 12

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
 * Drawn by the Search box's Ask, which hands it the keys (`onKeys`), and in
 * sheets. What a change looks like and what applying does are the caller's.
 */
export function Review<T extends Reviewed>({
  changes,
  sectionOf,
  head,
  tickedText = approved => `${approved.length} ticked.`,
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
}: {
  changes: readonly T[]
  /** The heading a change is listed under in its band. */
  sectionOf: (change: T) => string
  head: string
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
  /** Makes the ticked changes; true when they were made. */
  onApply: (approved: readonly T[], leftOut: ReadonlySet<string>) => Promise<boolean>
  /** How tall the list may grow before it scrolls. */
  height: number
  onClose?: () => void
  /** Given the keys while this is drawn, and null when it goes. */
  onKeys?: (keys: AnswerKeys | null) => void
  /** The start of each part's test id: `${testID}-change`, `${testID}-apply`, … */
  testID: string
  /** Changes drawn open to their songs from the start, by key. */
  openAtFirst?: readonly string[]
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
      if (await onApply(approved, leftOut)) {
        setTicked(new Set())
        setLeftOut(new Set())
        onClose?.()
      }
    } finally {
      setApplying(false)
    }
  }

  // Every place the keys can stop, in the order drawn.
  const stops: Stop<T>[] = []
  for (const band of bands) {
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
      const to = Math.max(0, Math.min(stops.length - 1, from + (key === 'ArrowDown' ? 1 : -1)))
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
        [['→'], 'songs'],
        [[COMMAND, '↵'], keyWord],
      ],
    })
    return () => onKeys(null)
  }, [onKeys, keyWord])

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

  const drawRow = (each: T): ReactNode => {
    const { change } = each
    const id = `change:${change.key}`
    const on = isOn(each)
    const full = fullyOn(each)
    const many = each.songIds.length > 1
    const opened = open.has(change.key)
    const songs = shownOf(each)
    return (
      <View key={change.key}>
        <Pressable
          ref={place(id)}
          onPress={() => {
            setAt(null)
            flip([each], !full)
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: full ? true : on ? 'mixed' : false }}
          accessibilityLabel={labelOf(each)}
          style={({ pressed }) => [
            styles.change,
            at === id && styles.at,
            pressed && styles.pressed,
          ]}
          testID={`${testID}-change`}
        >
          <Checkbox checked={full} mixed={on && !full} />
          <View style={styles.words}>
            {drawChange(each, { on, full, kept: keptSongs(each, leftOut) })}
          </View>
          {many ? (
            <Pressable
              onPress={() => {
                setAt(null)
                setOpen(toggle(open, change.key))
              }}
              accessibilityRole="button"
              accessibilityLabel={
                opened ? 'Hide the songs' : `Show the ${each.songIds.length} songs`
              }
              hitSlop={8}
              style={({ pressed }) => [styles.open, pressed && styles.pressed]}
              testID={`${testID}-open`}
            >
              {opened ? (
                <ChevronDown size={15} tone="textMuted" />
              ) : (
                <ChevronRight size={15} tone="textMuted" />
              )}
            </Pressable>
          ) : null}
        </Pressable>
        {opened ? (
          <View style={styles.songs}>
            {songs.map(songId => {
              const song = songsById.get(songId)
              if (!song) return null
              const songStop = `song:${change.key}:${songId}`
              const kept = on && !leftOut.has(leftOutKey(change.key, songId))
              return (
                <Pressable
                  key={songId}
                  ref={place(songStop)}
                  onPress={() => {
                    setAt(null)
                    flipSong(each, songId)
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: kept }}
                  accessibilityLabel={`${song.title}, ${song.artist || 'Unknown artist'}`}
                  style={({ pressed }) => [
                    styles.song,
                    at === songStop && styles.at,
                    pressed && styles.pressed,
                  ]}
                  testID={`${testID}-song`}
                >
                  <Checkbox checked={kept} />
                  <Cover uri={artFor(song)} title={song.album || song.title} size={26} />
                  <Text style={styles.songTitle} numberOfLines={1}>
                    {song.title}
                    <Text style={styles.songSub}> · {songLine(song, each)}</Text>
                  </Text>
                </Pressable>
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

  return (
    <View style={styles.body} testID={`${testID}-review`}>
      <View style={styles.top}>
        <Text style={styles.head}>{head}</Text>
        <Text style={styles.note}>
          {approved.length === 0 ? 'Nothing ticked yet.' : tickedText(approved, leftOut)}
          {waiting ? ' The ✦ ones wait for you.' : ''}
        </Text>
        {(notes ?? []).map(note => (
          <Text key={note} style={styles.note}>
            {note}
          </Text>
        ))}
      </View>
      <ScrollView
        style={{ maxHeight: height }}
        contentContainerStyle={styles.list}
        testID={`${testID}-list`}
      >
        {bands.map(band => {
          const list = band.sections.flatMap(section => section.changes)
          const on = list.filter(isOn).length
          const all = list.every(fullyOn)
          const id = `band:${band.by}`
          const model = band.by === 'model'
          const text = bandText[band.by]
          return (
            <View key={band.by} style={styles.band} testID={`${testID}-band-${band.by}`}>
              <Pressable
                ref={place(id)}
                onPress={() => {
                  setAt(null)
                  flip(list, !all)
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: all ? true : on ? 'mixed' : false }}
                accessibilityLabel={`${text.title}, ${on} of ${list.length} ticked`}
                style={({ pressed }) => [
                  styles.bandHead,
                  at === id && styles.at,
                  pressed && styles.pressed,
                ]}
                testID={`${testID}-section`}
              >
                <Checkbox checked={all} mixed={on > 0 && !all} />
                {model ? <Sparkle size={14} /> : null}
                <Text style={styles.bandTitle}>{text.title}</Text>
                <Text style={styles.count}>
                  {on} of {list.length} ticked
                </Text>
              </Pressable>
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
                        {section.changes.length}
                      </Text>
                    </View>
                    {shown.map(drawRow)}
                    {shown.length < section.changes.length ? (
                      <More
                        stop={`section:${section.title}`}
                        indent={CHANGE_TEXT}
                        at={at}
                        place={place}
                        text={`${section.changes.length - shown.length} more`}
                        onPress={() => setAllOf(toggle(allOf, section.title))}
                      />
                    ) : null}
                  </View>
                )
              })}
            </View>
          )
        })}
      </ScrollView>
      <View style={styles.actions}>
        {onClose ? <Button label="Close" onPress={onClose} /> : null}
        <Button
          label={applyLabel(approved, leftOut)}
          variant="primary"
          disabled={approved.length === 0}
          busy={applying}
          onPress={() => void apply()}
          testID={`${testID}-apply`}
        />
      </View>
    </View>
  )
}

/** "1,342 songs": a library's size reads better with its thousands marked. */
export function songCount(count: number): string {
  return `${count.toLocaleString('en')} ${count === 1 ? 'song' : 'songs'}`
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
    <Pressable
      ref={place(stop)}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.more,
        { marginLeft: indent - space.sm },
        at === stop && styles.at,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.moreText}>{text}</Text>
    </Pressable>
  )
}

/** The words of a change: a name line and a quiet line under it, as both reviews draw them. */
export const reviewText = StyleSheet.create(theme => ({
  name: { color: theme.colors.textPrimary, fontSize: 13.5, lineHeight: 19 },
  gone: {
    color: theme.colors.danger,
    textDecorationLine: 'line-through',
    borderRadius: 3,
    backgroundColor: withAlpha(theme.colors.danger, 0.14),
  },
  new: {
    color: theme.colors.good,
    borderRadius: 3,
    backgroundColor: withAlpha(theme.colors.good, 0.14),
  },
  arrow: { color: theme.colors.textMuted },
  meta: { color: theme.colors.textMuted, fontSize: 12 },
  line: { color: theme.colors.textSecondary, fontSize: 13.5, lineHeight: 19 },
  note: { color: theme.colors.textMuted, fontSize: 12.5, lineHeight: 18 },
}))

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  top: { gap: 2 },
  head: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: '600' },
  note: { color: theme.colors.textMuted, fontSize: 12.5, lineHeight: 18 },
  list: { gap: space.sm },
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
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  bandTitle: { flex: 1, color: theme.colors.textPrimary, fontSize: 14.5, fontWeight: '600' },
  count: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  bandNote: {
    color: theme.colors.textMuted,
    fontSize: 12.5,
    lineHeight: 17,
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
    gap: 12,
    paddingVertical: 7,
    paddingLeft: BAND_TEXT,
    paddingRight: space.xs,
    borderRadius: radius.coverSm,
  },
  at: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.07) },
  words: { flex: 1, minWidth: 0, gap: 2 },
  open: {
    width: 26,
    height: 26,
    marginTop: -3,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  songs: { gap: 2, paddingLeft: CHANGE_TEXT - space.xs, paddingBottom: space.xs },
  song: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  songTitle: { flex: 1, minWidth: 0, color: theme.colors.textPrimary, fontSize: 12.5 },
  songSub: { color: theme.colors.textMuted },
  more: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: space.sm,
    borderRadius: radius.coverSm,
  },
  moreText: { color: theme.colors.accent, fontSize: 12.5, fontWeight: '500' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
  pressed: { opacity: 0.7 },
}))
