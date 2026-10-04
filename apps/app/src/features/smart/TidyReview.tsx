import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { plural, type Song, type TidyField, type TidyResult } from '@selfmp3/shared'
import { onMac, radius, space, useBulkEditSongs, useLibrary, withAlpha } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Cover } from '../../ui/components/Cover'
import { ChevronDown, ChevronRight, Sparkle } from '../../ui/components/Icons'
import { label as labelText } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import type { AnswerKeys } from './answerKeys'
import {
  leftOutKey,
  tickedAtFirst,
  tidyBands,
  tidyEdits,
  tidyHere,
  tidyKept,
  tidyParts,
  type TidyHere,
} from './smart.model'
import { useSmartServer } from './useSmartServer'

const FIELD: Record<TidyField, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album artist',
}

/**
 * The steps the list is drawn in. A band's tick, then its title, note and
 * reasons; a change's tick sits under the band's title, and an opened change's
 * songs tick under the change's name.
 */
const BAND_TEXT = 32
const CHANGE_TEXT = BAND_TEXT + 18 + 12

/** How many changes a reason shows before "N more". */
const REASON_SHOWS = 3
/** How many songs an opened change lists before "Show all". */
const SONGS_SHOW = 8

const COMMAND =
  typeof navigator !== 'undefined' && onMac(navigator.userAgent, navigator.maxTouchPoints ?? 0)
    ? '⌘'
    : 'ctrl'

/** Somewhere the keys can stop: a band, a change, a song in one, or a "more". */
type Stop =
  | { readonly id: string; readonly kind: 'band'; readonly by: 'rule' | 'model' }
  | { readonly id: string; readonly kind: 'change'; readonly here: TidyHere }
  | { readonly id: string; readonly kind: 'reason'; readonly why: string }
  | { readonly id: string; readonly kind: 'song'; readonly here: TidyHere; readonly songId: number }
  | { readonly id: string; readonly kind: 'songs'; readonly key: string }

/**
 * A4 · Tidy up's changes (docs/features/ai.md), for a yes or no each. Two
 * bands by how far to trust them: what a plain rule found, ticked, and the
 * model's guesses with the sparkle, waiting for a yes. A change that only
 * takes words out is one line with the part that goes struck through; a
 * rename reads old → new. A change on many songs opens to its songs, and any
 * of them can be left out. Fixing is one ordinary edit per song, so it syncs
 * like an edit made by hand, and the toast's Undo writes the old names back.
 *
 * Drawn by the Search box's Ask, which hands it the keys (`onKeys`), and by
 * Library's Tidy up sheet.
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
  const { theme } = useUnistyles()
  const server = useSmartServer()
  const { data: library } = useLibrary()
  const artFor = useArt(ROW_COVER_SIZE)
  const save = useBulkEditSongs()
  const songsById = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )
  const here = useMemo(
    () => tidyHere(result.changes, server.onDevice, songsById),
    [result.changes, server.onDevice, songsById],
  )
  const [ticked, setTicked] = useState<ReadonlySet<string> | null>(null)
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set())
  /** Reasons showing every change, changes open to their songs, and opened ones showing all. */
  const [allOf, setAllOf] = useState<ReadonlySet<string>>(new Set())
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [allSongs, setAllSongs] = useState<ReadonlySet<string>>(new Set())
  /** Where the keys are; none until an arrow is pressed. */
  const [at, setAt] = useState<string | null>(null)

  const chosen = ticked ?? tickedAtFirst(here)
  const bands = tidyBands(here)
  const isOn = (each: TidyHere): boolean =>
    chosen.has(each.change.key) && tidyKept(each, leftOut).length > 0
  const fullyOn = (each: TidyHere): boolean =>
    chosen.has(each.change.key) && tidyKept(each, leftOut).length === each.songIds.length
  const approved = here.filter(isOn)
  const edits = tidyEdits(approved, leftOut)
  const waiting = here.some(each => each.change.by === 'model' && !isOn(each))

  /** Ticks or unticks whole changes, with every song back in. */
  const flip = (changes: readonly TidyHere[], on: boolean): void => {
    const next = new Set(chosen)
    const out = new Set(leftOut)
    for (const each of changes) {
      if (on) next.add(each.change.key)
      else next.delete(each.change.key)
      for (const id of each.songIds) out.delete(leftOutKey(each.change.key, id))
    }
    setTicked(next)
    setLeftOut(out)
  }
  /** Leaves one song out of a change, or puts it back; a change with none left is unticked. */
  const flipSong = (each: TidyHere, songId: number): void => {
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
    if (edits.length === 0 || save.isPending) return
    const undo = tidyEdits(approved, leftOut, true)
    try {
      await save.mutateAsync({ edits })
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
      setTicked(new Set())
      setLeftOut(new Set())
      onClose?.()
    } catch {
      // The mutation says what failed itself.
    }
  }

  // Every place the keys can stop, in the order drawn.
  const stops: Stop[] = []
  for (const band of bands) {
    stops.push({ id: `band:${band.by}`, kind: 'band', by: band.by })
    for (const reason of band.reasons) {
      const shown = allOf.has(reason.why) ? reason.changes : reason.changes.slice(0, REASON_SHOWS)
      for (const each of shown) {
        stops.push({ id: `change:${each.change.key}`, kind: 'change', here: each })
        if (!open.has(each.change.key)) continue
        const songs = allSongs.has(each.change.key)
          ? each.songIds
          : each.songIds.slice(0, SONGS_SHOW)
        for (const songId of songs) {
          stops.push({ id: `song:${each.change.key}:${songId}`, kind: 'song', here: each, songId })
        }
        if (songs.length < each.songIds.length) {
          stops.push({ id: `songs:${each.change.key}`, kind: 'songs', key: each.change.key })
        }
      }
      if (shown.length < reason.changes.length) {
        stops.push({ id: `reason:${reason.why}`, kind: 'reason', why: reason.why })
      }
    }
  }
  const atIndex = stops.findIndex(stop => stop.id === at)
  const atStop = atIndex >= 0 ? stops[atIndex] : undefined

  const press = (stop: Stop): void => {
    switch (stop.kind) {
      case 'band': {
        const changes = here.filter(each => each.change.by === stop.by)
        flip(changes, !changes.every(each => fullyOn(each)))
        return
      }
      case 'change':
        flip([stop.here], !fullyOn(stop.here))
        return
      case 'reason':
        setAllOf(toggle(allOf, stop.why))
        return
      case 'song':
        flipSong(stop.here, stop.songId)
        return
      case 'songs':
        setAllSongs(toggle(allSongs, stop.key))
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
      if (!open.has(key)) return false
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
        [[COMMAND, '↵'], 'fix'],
      ],
    })
    return () => onKeys(null)
  }, [onKeys])

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

  if (here.length === 0) {
    return (
      <View style={styles.body}>
        <Text style={styles.line} testID="tidy-nothing">
          Nothing looks wrong in the names of your {songCount(result.looked)}.
        </Text>
        {result.note ? <Text style={styles.note}>{result.note}</Text> : null}
      </View>
    )
  }

  const meta = (each: TidyHere): string => {
    const kept = tidyKept(each, leftOut)
    const field = FIELD[each.change.field]
    if (each.songIds.length === 1) {
      const song = songsById.get(each.songIds[0]!)
      if (!song) return `${field} · 1 song`
      return each.change.field === 'title'
        ? `${field} · ${song.artist || 'Unknown artist'}`
        : `${field} · on ${song.title}`
    }
    if (chosen.has(each.change.key) && kept.length < each.songIds.length) {
      return `${field} · ${kept.length} of ${plural(each.songIds.length, 'song', 'songs')}`
    }
    return `${field} · ${plural(each.songIds.length, 'song', 'songs')}`
  }

  const drawChange = (each: TidyHere): ReactNode => {
    const { change } = each
    const id = `change:${change.key}`
    const on = isOn(each)
    const full = fullyOn(each)
    const parts = tidyParts(change.from, change.to)
    const many = each.songIds.length > 1
    const opened = open.has(change.key)
    const songs = allSongs.has(change.key) ? each.songIds : each.songIds.slice(0, SONGS_SHOW)
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
          accessibilityLabel={`${FIELD[change.field]}: ${change.from} to ${change.to}`}
          style={({ pressed }) => [
            styles.change,
            at === id && styles.at,
            pressed && styles.pressed,
          ]}
          testID="tidy-change"
        >
          <Checkbox checked={full} mixed={on && !full} />
          <View style={styles.diff}>
            {parts ? (
              <Text style={styles.name} numberOfLines={2}>
                {parts.map((part, index) =>
                  part.kind === 'same' ? (
                    part.text
                  ) : (
                    <Text
                      key={index}
                      style={[
                        styles.gone,
                        { backgroundColor: withAlpha(theme.colors.danger, 0.14) },
                      ]}
                    >
                      {part.text}
                    </Text>
                  ),
                )}
              </Text>
            ) : (
              <Text style={styles.name} numberOfLines={2}>
                <Text
                  style={[styles.gone, { backgroundColor: withAlpha(theme.colors.danger, 0.14) }]}
                >
                  {change.from}
                </Text>
                <Text style={styles.arrow}>{'  →  '}</Text>
                <Text style={[styles.new, { backgroundColor: withAlpha(theme.colors.good, 0.14) }]}>
                  {change.to}
                </Text>
              </Text>
            )}
            <Text style={styles.meta} numberOfLines={1}>
              {meta(each)}
            </Text>
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
              testID="tidy-open"
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
                  testID="tidy-song"
                >
                  <Checkbox checked={kept} />
                  <Cover uri={artFor(song)} title={song.album || song.title} size={26} />
                  <Text style={styles.songTitle} numberOfLines={1}>
                    {song.title}
                    <Text style={styles.songSub}> · {songLine(song, change.field)}</Text>
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
                text={`Show all ${each.songIds.length}`}
                onPress={() => setAllSongs(toggle(allSongs, change.key))}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View style={styles.body} testID="tidy-review">
      <View style={styles.top}>
        <Text style={styles.head}>
          {plural(here.length, 'thing', 'things')} to fix in {songCount(result.looked)}
        </Text>
        <Text style={styles.note}>
          {approved.length === 0
            ? 'Nothing ticked yet.'
            : `${approved.length} ticked, on ${plural(edits.length, 'song', 'songs')}.`}
          {waiting ? ' The ✦ ones wait for you.' : ''}
        </Text>
        {result.note ? <Text style={styles.note}>{result.note}</Text> : null}
      </View>
      <ScrollView
        style={{ maxHeight: height }}
        contentContainerStyle={styles.list}
        testID="tidy-list"
      >
        {bands.map(band => {
          const changes = band.reasons.flatMap(reason => reason.changes)
          const on = changes.filter(isOn).length
          const all = changes.every(fullyOn)
          const id = `band:${band.by}`
          const model = band.by === 'model'
          return (
            <View key={band.by} style={styles.band} testID={`tidy-band-${band.by}`}>
              <Pressable
                ref={place(id)}
                onPress={() => {
                  setAt(null)
                  flip(changes, !all)
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: all ? true : on ? 'mixed' : false }}
                accessibilityLabel={`${model ? 'Worth a look' : 'Sure fixes'}, ${on} of ${changes.length} ticked`}
                style={({ pressed }) => [
                  styles.bandHead,
                  at === id && styles.at,
                  pressed && styles.pressed,
                ]}
                testID="tidy-section"
              >
                <Checkbox checked={all} mixed={on > 0 && !all} />
                {model ? <Sparkle size={14} /> : null}
                <Text style={styles.bandTitle}>{model ? 'Worth a look' : 'Sure fixes'}</Text>
                <Text style={styles.count}>
                  {on} of {changes.length} ticked
                </Text>
              </Pressable>
              <Text style={styles.bandNote}>
                {model
                  ? 'The model’s guesses. Nothing here changes unless you tick it.'
                  : 'Found by plain rules, so they start ticked.'}
              </Text>
              {band.reasons.map(reason => {
                const shown = allOf.has(reason.why)
                  ? reason.changes
                  : reason.changes.slice(0, REASON_SHOWS)
                return (
                  <View key={reason.why}>
                    <View style={styles.reason}>
                      <Text style={styles.reasonText} numberOfLines={1}>
                        {reason.why}
                      </Text>
                      <Text style={[styles.reasonText, styles.reasonCount]}>
                        {reason.changes.length}
                      </Text>
                    </View>
                    {shown.map(drawChange)}
                    {shown.length < reason.changes.length ? (
                      <More
                        stop={`reason:${reason.why}`}
                        indent={CHANGE_TEXT}
                        at={at}
                        place={place}
                        text={`${reason.changes.length - shown.length} more`}
                        onPress={() => setAllOf(toggle(allOf, reason.why))}
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
          label={edits.length === 0 ? 'Fix' : `Fix ${plural(edits.length, 'song', 'songs')}`}
          variant="primary"
          disabled={edits.length === 0}
          busy={save.isPending}
          onPress={() => void apply()}
          testID="tidy-apply"
        />
      </View>
    </View>
  )
}

/** "1,342 songs": a library's size reads better with its thousands marked. */
function songCount(count: number): string {
  return `${count.toLocaleString('en')} ${count === 1 ? 'song' : 'songs'}`
}

/** What tells one song from another in an opened change: what the change does not touch. */
function songLine(song: Song, field: TidyField): string {
  if (field === 'title') return song.artist || 'Unknown artist'
  return song.album || song.artist || 'No album'
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

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  top: { gap: 2 },
  head: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: '600' },
  line: { color: theme.colors.textSecondary, fontSize: 13.5, lineHeight: 19 },
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
  reason: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: space.sm,
    paddingTop: space.sm,
    paddingBottom: 2,
    paddingLeft: BAND_TEXT,
    paddingRight: space.xs,
  },
  reasonText: { ...labelText(theme.colors), flexShrink: 1 },
  reasonCount: { marginLeft: 'auto', letterSpacing: 0, fontVariant: ['tabular-nums'] },
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
  diff: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: theme.colors.textPrimary, fontSize: 13.5, lineHeight: 19 },
  gone: {
    color: theme.colors.danger,
    textDecorationLine: 'line-through',
    borderRadius: 3,
  },
  new: { color: theme.colors.good, borderRadius: 3 },
  arrow: { color: theme.colors.textMuted },
  meta: { color: theme.colors.textMuted, fontSize: 12 },
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
