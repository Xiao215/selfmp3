import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useFocusEffect } from 'expo-router'
import {
  artistOr,
  formatDuration,
  type ImportPreviewItem,
  type ImportSource,
} from '@selfmp3/shared'
import { HIT_TARGET, radius, type, withAlpha, type Review } from '@selfmp3/client'
import { canListenHere } from '../../ports/listen'
import { label as groupLabel } from '../../ui/surfaces'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { Cover } from '../../ui/components/Cover'
import type { ValueStore } from '../../state/valueStore.model'
import { useValueStore } from '../../state/useValueStore'
import { useToneColors } from '../../ui/useSongColor'
import { ListenBar, ListenCover, type useListen } from './ImportListen'
import { chooseSourceIn, lookAgainIn, renameIn, toggleChosenIn } from './importDraft'
import type { DraftList, DraftSource } from './importDraft.model'
import {
  canListen,
  listenDetail,
  listeningLeftReview,
  waitingRowNext,
  type Listening,
} from './listen.model'
import { chosenState, rowState, sourceWords, type Rename, type RowState } from './review.model'

/**
 * A review's rows (docs/ui-mock `P30` and `C14`): the review's own page
 * (ImportReview.tsx), and a search's songs under Import's box
 * (ImportScreen.tsx), which are review rows too.
 *
 * Every song can be ticked and unticked by the box at the left of its row. A
 * song the library already has says "In library", has no box, and is
 * skipped. On a phone a tap plays the song and opens the row in place once it
 * is playing — its cover shows the wait meanwhile — to hear it, fix its name
 * and choose where it comes from, and a tap anywhere else closes it
 * (`closeRow`, which the page puts on its ground). On a computer every row
 * sits on one grid; play waits under the pointer, and the playing row turns
 * its title, artist and album into fields with its bar opening under it.
 *
 * The rows are memoised and every handler they are given keeps its identity,
 * because the preview reports where it is four times a second and a hundred
 * rows redrawn at that rate made a phone stutter. Where it is is not even the
 * page's: only the playing row's bar and times read it (`AtPosition`), so the
 * page and its rows are drawn again when the preview starts, pauses or ends.
 */
export function useReviewRows({
  draft,
  list,
  review,
  listen,
  wide,
  finePointer,
  showFrom,
  unticked = 'left-out',
}: {
  /** Whose draft the rows are kept in, and which of its lists they are. */
  draft: DraftSource
  list: DraftList
  review: Review | null
  listen: ReturnType<typeof useListen>
  wide: boolean
  finePointer: boolean
  /** A From column on a computer, for a list whose songs come from more than one place. */
  showFrom: boolean
  /**
   * What an unticked song looks like: left out — dimmed and struck through,
   * on a review, where every song starts ticked — or `picking`, as plain as a
   * ticked one, on a search's songs, where none does.
   */
  unticked?: 'left-out' | 'picking'
}): { rows: ReactNode[]; open: number | null; closeRow: () => void } {
  const [open, setOpen] = useState<number | null>(null)
  /** A phone row tapped and waiting for its song to play before it opens. */
  const [opening, setOpening] = useState<number | null>(null)

  // A preview whose song has left the list stops with it, and what played
  // before it stays paused: you did not ask for music, you asked for songs.
  const leftReview = listeningLeftReview(listen.listening, review?.items ?? null)
  const { toggle, seek, close } = listen
  useEffect(() => {
    if (leftReview) close({ resume: false })
  }, [leftReview, close])
  // Nor does a page left for another: the stack keeps the page drawn
  // underneath (`keepNearTop`), and its preview played on over the page you
  // went to, with nothing on screen to stop it.
  useFocusEffect(
    useCallback(
      () => () => {
        setOpen(null)
        setOpening(null)
        close({ resume: false })
      },
      [close],
    ),
  )

  /*
   * The handlers the rows are given read the list and the preview through a
   * ref, so they can keep their identity while both change (see above).
   */
  const latest = useRef({ review, listening: listen.listening })
  useEffect(() => {
    latest.current = { review, listening: listen.listening }
  })

  /** Play a row's song, opening the row where it is not open yet (a computer's cover). */
  const playRow = useCallback(
    (index: number): void => {
      const item = latest.current.review?.items[index]
      if (!item) return
      // A row waiting on another song is no longer waiting: this one took the player.
      setOpening(null)
      setOpen(current => (current === index ? current : index))
      toggle(item)
    },
    [toggle],
  )
  /**
   * Open a row, and play it where it can be played. A phone's row opens once
   * the song plays (the effect below), showing the wait on its cover until
   * then; a computer's opens now, and its cover shows the wait.
   */
  const openRow = useCallback(
    (index: number): void => {
      const item = latest.current.review?.items[index]
      if (!item) return
      const hearable = canListenHere && canListen(item)
      const heard = latest.current.listening?.track.url === item.url
      if (!hearable || heard) {
        setOpening(null)
        setOpen(index)
        return
      }
      if (wide) {
        setOpen(index)
      } else {
        // The open card, if any, was another song's, and that song stops now.
        setOpen(null)
        setOpening(index)
      }
      toggle(item)
    },
    [toggle, wide],
  )
  const closeRow = useCallback((): void => {
    setOpen(null)
    setOpening(null)
    close()
  }, [close])
  const listeningUrl = listen.listening?.track.url ?? null
  const listeningStatus = listen.listening?.status ?? null
  useEffect(() => {
    if (opening === null) return
    const item = latest.current.review?.items[opening]
    const next = waitingRowNext(item?.url, listen.listening)
    if (next === 'wait') return
    setOpening(null)
    if (next === 'open') setOpen(opening)
    // The preview's url and status are what decide; the object changes every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, listeningUrl, listeningStatus])
  // Ticking is separate from hearing: an unticked song still plays and still
  // opens, so you can listen before deciding, and an open row stays open.
  const toggleChosen = useCallback(
    (index: number): void => toggleChosenIn(draft, index, list),
    [draft, list],
  )
  const rename = useCallback(
    (index: number, change: Rename): void => renameIn(draft, index, change, list),
    [draft, list],
  )
  const chooseSource = useCallback(
    (index: number, from: ImportSource): void => chooseSourceIn(draft, index, from, list),
    [draft, list],
  )
  const lookAgain = useCallback(
    (index: number): void => lookAgainIn(draft, index, list),
    [draft, list],
  )

  if (!review) return { rows: [], open, closeRow }

  const playing = (item: ImportPreviewItem): Listening | null =>
    listen.listening?.track.url === item.url ? listen.listening : null

  const rows = review.items.map((item, index) => {
    const ticked = rowState(review, index)
    // An unticked song being picked from looks as a ticked one does; only its box says.
    const state: ShownState = ticked === 'out' && unticked === 'picking' ? 'picking' : ticked
    const words = sourceWords(review, item)
    const shared = {
      item,
      index,
      state,
      open: open === index,
      opening: opening === index,
      listening: playing(item),
      canPlay: canListenHere && canListen(item),
      words: words?.words ?? null,
      wordsWarn: words?.tone === 'warn',
      position: listen.position,
      onToggleChosen: toggleChosen,
      onRename: rename,
      onSeek: seek,
      onOpen: openRow,
      onPlay: playRow,
      onSource: chooseSource,
      onLookAgain: lookAgain,
    }
    return wide ? (
      <GridRow key={index} {...shared} finePointer={finePointer} showFrom={showFrom} />
    ) : (
      <PhoneRow key={index} {...shared} />
    )
  })
  return { rows, open, closeRow }
}

/** The names over a computer's grid of rows, after what goes over the boxes (`leading`). */
export function ReviewGridHead({
  leading,
  showFrom,
}: {
  leading: ReactNode
  showFrom: boolean
}): ReactNode {
  return (
    <View style={[styles.grid, styles.gridHead]}>
      {leading ?? <View style={styles.selectWide} />}
      <View style={styles.cells} aria-hidden>
        <View style={styles.colCover} />
        <Text style={[styles.headLabel, styles.colTitle]}>Title</Text>
        <Text style={[styles.headLabel, styles.colArtist]}>Artist</Text>
        <Text style={[styles.headLabel, styles.colAlbum]}>Album</Text>
        {showFrom ? <Text style={[styles.headLabel, styles.colFrom]}>From</Text> : null}
        <Text style={[styles.headLabel, styles.colEnd, styles.endText]}>Time</Text>
      </View>
    </View>
  )
}

/** A row's box: ticked, the song is coming in. The same mark the library's rows use. */
function SelectBox({
  item,
  checked,
  onToggle,
  wide,
}: {
  item: ImportPreviewItem
  checked: boolean
  onToggle: () => void
  wide: boolean
}): ReactNode {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      // As ListenBar's value: react-native-web drops `accessibilityState` from the web.
      aria-checked={checked}
      accessibilityLabel={checked ? `Deselect ${item.title}` : `Select ${item.title}`}
      style={wide ? styles.selectWide : styles.select}
    >
      <Checkbox checked={checked} />
    </Pressable>
  )
}

/**
 * The head's box, over the rows' boxes: ticked when every song that can come
 * in is, dashed when only some are, and empty when none. Pressing it ticks
 * everything, or unticks everything once everything is ticked. On a phone it
 * says what it is, since there is no column of boxes under it yet.
 */
export function AllBox({
  review,
  onChange,
  wide,
}: {
  review: Review
  onChange: (on: boolean) => void
  wide: boolean
}): ReactNode {
  const state = chosenState(review)
  const all = state === 'all'
  return (
    <Pressable
      onPress={() => onChange(!all)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: all ? true : state === 'some' ? 'mixed' : false }}
      aria-checked={all ? true : state === 'some' ? 'mixed' : false}
      accessibilityLabel={all ? 'Deselect all' : 'Select all'}
      style={({ pressed }) => [
        wide ? styles.selectWide : styles.allPhone,
        pressed && styles.pressed,
      ]}
    >
      <View style={wide ? null : styles.select}>
        <Checkbox checked={all} mixed={state === 'some'} />
      </View>
      {wide ? null : <Text style={styles.allWords}>All songs</Text>}
    </Pressable>
  )
}

/** How a row shows its song: as `RowState` says, or `picking`, unticked on a search. */
type ShownState = RowState | 'picking'

/** What every row is given. The handlers take the row's index, so one function serves every row. */
interface RowProps {
  readonly item: ImportPreviewItem
  readonly index: number
  readonly state: ShownState
  readonly open: boolean
  /** Tapped, and waiting for its song to play before it opens (a phone). */
  readonly opening: boolean
  /** This row's preview, when it is the one playing. */
  readonly listening: Listening | null
  readonly canPlay: boolean
  /** Where the song comes from, or how its search went (`sourceWords`); null for nothing to say. */
  readonly words: string | null
  readonly wordsWarn: boolean
  /** Where the preview is in its song: read only by the playing row's bar and times. */
  readonly position: ValueStore<number>
  readonly onToggleChosen: (index: number) => void
  readonly onRename: (index: number, change: Rename) => void
  readonly onSeek: (seconds: number) => void
  readonly onOpen: (index: number) => void
  readonly onPlay: (index: number) => void
  readonly onSource: (index: number, source: ImportSource) => void
  readonly onLookAgain: (index: number) => void
}

/**
 * What a row says at its end: "In library", or how long the song is. A song
 * the server has but the bucket does not yet is "Almost ready": the library
 * this device reads will not show it until the upload goes through, and a
 * second download would only make a copy.
 */
function EndWords({
  item,
  state,
  words,
  wordsWarn,
}: {
  item: ImportPreviewItem
  state: ShownState
  /** Where it comes from, said under the length on a phone (`sourceWords`); a computer has a column. */
  words?: string | null
  wordsWarn?: boolean
}): ReactNode {
  if (state === 'yours') {
    return (
      <Text style={styles.endQuiet}>
        {item.alreadyHave ? (item.waitingToUpload ? 'Almost ready' : 'In library') : 'Importing'}
      </Text>
    )
  }
  const time = item.duration > 0 ? formatDuration(item.duration) : null
  if (!words) return time ? <Text style={styles.endTime}>{time}</Text> : null
  return (
    <View style={styles.endStack}>
      {time && state !== 'missing' ? <Text style={styles.endTime}>{time}</Text> : null}
      <Text style={[styles.endWords, wordsWarn && styles.warn]} numberOfLines={1}>
        {words}
      </Text>
    </View>
  )
}

/** A row's From column on a computer: where it comes from, or how its search went. */
function FromWords({ words, warn }: { words: string | null; warn: boolean }): ReactNode {
  return (
    <View style={styles.colFrom}>
      {words ? (
        <Text style={[styles.endWords, warn && styles.warn]} numberOfLines={1}>
          {words}
        </Text>
      ) : null}
    </View>
  )
}

/**
 * Where an open row's song comes from, to change (docs/features/import-sources.md).
 *
 * A song listed by 网易云 has both: 网易云's own file, when it gives the
 * whole song out, or the same song found on YouTube. A song known only by
 * its name — a Spotify list, a list of names — has YouTube's match, which is
 * looked for again by its name as it stands, for a match that was not the
 * song or a name fixed by hand. A pasted YouTube link has nothing to choose.
 */
function SourceChoice({
  item,
  index,
  onSource,
  onLookAgain,
}: {
  item: ImportPreviewItem
  index: number
  onSource: (index: number, source: ImportSource) => void
  onLookAgain: (index: number) => void
}): ReactNode {
  const match = item.youtube?.match ?? null
  const youtubeWords =
    match === 'looking'
      ? 'Looking…'
      : match === 'none'
        ? 'Not found'
        : match === 'unsure'
          ? 'Not sure it’s the song'
          : match === 'sure'
            ? 'Found'
            : 'Find it there'
  if (item.netease) {
    const free = item.netease.free
    return (
      <View style={styles.choice} accessibilityRole="radiogroup" accessibilityLabel="Download from">
        <SourceOption
          name="网易云"
          words={free ? 'The whole song' : 'Only a preview there (VIP)'}
          on={item.source === 'netease'}
          disabled={!free}
          onPress={() => onSource(index, 'netease')}
        />
        <SourceOption
          name="YouTube"
          words={youtubeWords}
          on={item.source === 'youtube'}
          disabled={false}
          onPress={() => onSource(index, 'youtube')}
        />
        {item.source === 'youtube' && (match === 'none' || match === 'unsure') ? (
          <Button label="Look again" variant="text" onPress={() => onLookAgain(index)} />
        ) : null}
      </View>
    )
  }
  if (!item.youtube) return null
  return (
    <View style={styles.found}>
      <Text style={[styles.foundWords, match === 'unsure' && styles.warn]} numberOfLines={1}>
        {match === 'looking'
          ? 'Looking for it on YouTube…'
          : match === 'none'
            ? 'Not found on YouTube. Fix its name, then look again.'
            : match === 'unsure'
              ? 'Found on YouTube, but not sure it’s the song: have a listen.'
              : 'Found on YouTube.'}
      </Text>
      {match === 'looking' ? null : (
        <Button label="Look again" variant="text" onPress={() => onLookAgain(index)} />
      )}
    </View>
  )
}

/** One place a song can come from, in `SourceChoice`. */
function SourceOption({
  name,
  words,
  on,
  disabled,
  onPress,
}: {
  name: string
  words: string
  on: boolean
  disabled: boolean
  onPress: () => void
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={`${name}: ${words}`}
      style={({ pressed }) => [
        styles.option,
        on && styles.optionOn,
        disabled && styles.dim,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.optionName, on && styles.optionNameOn]}>{name}</Text>
      <Text style={[styles.optionWords, on && styles.optionWordsOn]} numberOfLines={1}>
        {words}
      </Text>
    </Pressable>
  )
}

/** A field on an open row: a title or an artist, named the way `P30` names it. */
function NameField({
  label,
  value,
  onChange,
  index,
  wide,
}: {
  label: 'Title' | 'Artist' | 'Album'
  value: string
  onChange: (value: string) => void
  index: number
  wide: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const [focused, setFocused] = useState(false)
  const input = (
    <TextInput
      style={[
        styles.input,
        label === 'Title'
          ? styles.inputTitle
          : label === 'Artist'
            ? styles.inputArtist
            : styles.inputAlbum,
        wide ? styles.fieldWide : styles.inputPhone,
        wide && focused && styles.fieldFocused,
      ]}
      value={value}
      onChangeText={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={label}
      placeholderTextColor={theme.colors.textMuted}
      autoCorrect={false}
      accessibilityLabel={`${label} of track ${index + 1}`}
    />
  )
  if (wide) return input
  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      <Text style={styles.fieldLabel} numberOfLines={1}>
        {label}
      </Text>
      {input}
    </View>
  )
}

/** "1:24" and "4:08" either side of the bar, or why it will not play. */
function barTimes(item: ImportPreviewItem, listening: Listening | null, at: number) {
  return {
    at: formatDuration(at),
    length: formatDuration(listening?.duration || item.duration),
    trouble: listening?.status === 'error' ? listenDetail(listening) : null,
  }
}

/**
 * The open row's bar and the times beside it: the one part of the review that
 * moves with the song, so the one part that reads where it is. `children`
 * draws them, given that place, where the row's layout puts them.
 */
function AtPosition({
  position,
  children,
}: {
  position: ValueStore<number>
  children: (at: number) => ReactNode
}): ReactNode {
  return children(useValueStore(position))
}

/**
 * A row on a phone (`P30`). Closed, it is a song with its box at the left,
 * its cover showing the wait while its song is fetched. Open, it is a card
 * with Title, Artist and Album and the bar to drag, in the cover's colour; its
 * cover pauses and resumes the song, as a computer's does, and a tap anywhere
 * off the card closes it (the list's ground, above). The card itself takes
 * its own taps, so a finger on its blank parts does not put it away.
 */
const PhoneRow = memo(function PhoneRow({
  item,
  index,
  state,
  open,
  opening,
  listening,
  canPlay,
  words,
  wordsWarn,
  position,
  onToggleChosen,
  onRename,
  onSeek,
  onOpen,
  onPlay,
  onSource,
  onLookAgain,
}: RowProps): ReactNode {
  const { theme } = useUnistyles()
  const colors = useToneColors(listening?.tone ?? null)
  if (open) {
    const bar = (at: number): ReactNode => {
      const times = barTimes(item, listening, at)
      return (
        <View style={styles.barBlock}>
          <ListenBar
            position={at}
            duration={listening?.duration || item.duration}
            onSeek={onSeek}
            color={colors.tint}
          />
          <View style={styles.times}>
            <Text style={styles.time}>{times.at}</Text>
            <Text style={[styles.time, times.trouble ? styles.trouble : null]} numberOfLines={1}>
              {times.trouble ?? 'Drag to move · tap away to close'}
            </Text>
            <Text style={styles.time}>{times.length}</Text>
          </View>
        </View>
      )
    }
    return (
      <Pressable
        onPress={() => undefined}
        accessible={false}
        style={styles.openCard}
        testID={`import-row-${index}`}
      >
        <View style={styles.openTop}>
          {/* The row's box stays where it was, so a song liked while hearing it is ticked from here. */}
          <View style={styles.selectOpen}>
            {state === 'missing' ? (
              <View style={styles.select} />
            ) : (
              <SelectBox
                item={item}
                checked={state === 'in'}
                onToggle={() => onToggleChosen(index)}
                wide={false}
              />
            )}
          </View>
          <ListenCover
            item={item}
            listening={listening}
            onPress={() => onPlay(index)}
            shown={canPlay}
            size={56}
          />
          <View style={styles.fields}>
            <NameField
              label="Title"
              value={item.title}
              onChange={title => onRename(index, { title })}
              index={index}
              wide={false}
            />
            <NameField
              label="Artist"
              value={item.artist}
              onChange={artist => onRename(index, { artist })}
              index={index}
              wide={false}
            />
            <NameField
              label="Album"
              value={item.album}
              onChange={album => onRename(index, { album })}
              index={index}
              wide={false}
            />
          </View>
        </View>
        <SourceChoice item={item} index={index} onSource={onSource} onLookAgain={onLookAgain} />
        {/* Ticking only while this row's song is the one playing; before, at the start. */}
        {!canPlay ? null : listening ? <AtPosition position={position}>{bar}</AtPosition> : bar(0)}
      </Pressable>
    )
  }

  const out = state === 'out'
  return (
    <View style={styles.phoneRow} testID={`import-row-${index}`}>
      {state === 'yours' || state === 'missing' ? (
        <View style={styles.select} />
      ) : (
        <SelectBox
          item={item}
          checked={state === 'in'}
          onToggle={() => onToggleChosen(index)}
          wide={false}
        />
      )}
      <Pressable
        onPress={state === 'yours' ? undefined : () => onOpen(index)}
        disabled={state === 'yours'}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${artistOr(item.artist)}`}
        accessibilityHint={state === 'yours' ? undefined : 'Opens it to hear it and fix its name'}
        accessibilityState={{ disabled: state === 'yours', busy: opening }}
        style={({ pressed }) => [
          styles.phoneRowBody,
          state !== 'in' && state !== 'picking' && styles.dim,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.coverWrap}>
          <Cover uri={item.thumbnail} title={item.title} size={44} />
          {opening ? (
            <View style={styles.coverWait} pointerEvents="none">
              <ActivityIndicator size="small" color={theme.colors.textPrimary} />
            </View>
          ) : null}
        </View>
        <View style={styles.texts}>
          <Text style={[styles.title, out && styles.struck]} numberOfLines={1}>
            {item.title || 'Untitled'}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {artistOr(item.artist)}
          </Text>
        </View>
        <EndWords item={item} state={state} words={words} wordsWarn={wordsWarn} />
      </Pressable>
    </View>
  )
})

/**
 * A row on a computer (`C14`), on the one grid every row shares so nothing
 * ever moves sideways: box, cover, title, artist, and a fixed end. Under the
 * pointer the cover shows play; it is there for a keyboard either way, only
 * unseen. The open row's title, artist and album are fields, and its bar opens
 * under it across those three columns.
 */
const GridRow = memo(function GridRow({
  item,
  index,
  state,
  open,
  listening,
  canPlay,
  finePointer,
  showFrom,
  words,
  wordsWarn,
  position,
  onToggleChosen,
  onRename,
  onSeek,
  onPlay,
  onOpen,
  onSource,
  onLookAgain,
}: RowProps & { finePointer: boolean; showFrom: boolean }): ReactNode {
  const [hovered, setHovered] = useState(false)
  const colors = useToneColors(listening?.tone ?? null)
  // With no pointer to wait for (a tablet at this width), what hover shows is always shown.
  const reveal = hovered || !finePointer
  const out = state === 'out'
  const lit = open || (hovered && state !== 'yours')
  const showBar = open && canPlay && listening !== null

  return (
    // Pointer enter and leave on a View, not a Pressable's hover: react-native-web
    // ends a Pressable's hover the moment the pointer reaches a Pressable inside
    // it, so the row went dark as soon as the pointer crossed its cover or names.
    <View
      testID={`import-row-${index}`}
      style={[styles.gridRowWrap, lit && styles.lit]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <View style={[styles.grid, styles.gridRow]}>
        {state === 'yours' || state === 'missing' ? (
          <View style={styles.selectWide} />
        ) : (
          <SelectBox
            item={item}
            checked={state === 'in'}
            onToggle={() => onToggleChosen(index)}
            wide
          />
        )}
        {/* The box keeps its full colour: dimmed, an empty ring would all but vanish. */}
        <View style={[styles.cells, state !== 'in' && state !== 'picking' && !open && styles.dim]}>
          <View style={styles.colCover}>
            {canPlay && state !== 'yours' ? (
              <ListenCover
                item={item}
                listening={listening}
                onPress={() => onPlay(index)}
                shown={reveal}
              />
            ) : (
              <Cover uri={item.thumbnail} title={item.title} size={40} />
            )}
          </View>
          {open ? (
            <>
              <View style={styles.colTitle}>
                <NameField
                  label="Title"
                  value={item.title}
                  onChange={title => onRename(index, { title })}
                  index={index}
                  wide
                />
              </View>
              <View style={styles.colArtist}>
                <NameField
                  label="Artist"
                  value={item.artist}
                  onChange={artist => onRename(index, { artist })}
                  index={index}
                  wide
                />
              </View>
              <View style={styles.colAlbum}>
                <NameField
                  label="Album"
                  value={item.album}
                  onChange={album => onRename(index, { album })}
                  index={index}
                  wide
                />
              </View>
            </>
          ) : (
            <Pressable
              onPress={state === 'yours' ? undefined : () => onOpen(index)}
              disabled={state === 'yours'}
              accessibilityRole="button"
              accessibilityLabel={`Edit ${item.title || 'this song'}`}
              style={styles.names2}
            >
              <Text style={[styles.title, styles.colTitle, out && styles.struck]} numberOfLines={1}>
                {item.title || 'Untitled'}
              </Text>
              <Text style={[styles.artist, styles.colArtist]} numberOfLines={1}>
                {artistOr(item.artist)}
              </Text>
              <Text style={[styles.album, styles.colAlbum]} numberOfLines={1}>
                {item.album}
              </Text>
            </Pressable>
          )}
          {showFrom ? <FromWords words={words} warn={wordsWarn} /> : null}
          <View style={styles.colEnd}>
            <EndWords item={item} state={state} />
          </View>
        </View>
      </View>
      {showBar ? (
        <AtPosition position={position}>
          {at => {
            const times = barTimes(item, listening, at)
            return (
              <View style={[styles.grid, styles.barRow]}>
                <View style={styles.selectWide} />
                <View style={styles.cells}>
                  <View style={styles.colCover} />
                  <View style={styles.colSpan}>
                    <ListenBar
                      position={at}
                      duration={listening.duration || item.duration}
                      onSeek={onSeek}
                      color={colors.tint}
                      height={30}
                    />
                  </View>
                  {showFrom ? <View style={styles.colFrom} /> : null}
                  <View style={styles.colEnd}>
                    <Text
                      style={[styles.endTime, times.trouble ? styles.trouble : null]}
                      numberOfLines={2}
                    >
                      {times.trouble ?? `${times.at} / ${times.length}`}
                    </Text>
                  </View>
                </View>
              </View>
            )
          }}
        </AtPosition>
      ) : null}
      {open && (item.netease || item.youtube) ? (
        <View style={[styles.grid, styles.barRow]}>
          <View style={styles.selectWide} />
          <View style={styles.cells}>
            <View style={styles.colCover} />
            <View style={styles.colSpan}>
              <SourceChoice
                item={item}
                index={index}
                onSource={onSource}
                onLookAgain={onLookAgain}
              />
            </View>
            {showFrom ? <View style={styles.colFrom} /> : null}
            <View style={styles.colEnd} />
          </View>
        </View>
      ) : null}
    </View>
  )
})

/** The grid's columns (`C14` with a box before and an album after: `24px 40px 1.2fr 1fr 1fr 90px`), as flex. */
const GAP = 14

const styles = StyleSheet.create(theme => ({
  // A closed row's cover, and the wait drawn over it while its song is fetched (as ListenCover's).
  coverWrap: { width: 44, height: 44, borderRadius: radius.coverSm, overflow: 'hidden' },
  coverWait: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(theme.colors.surface0, 0.55),
  },
  pressed: { opacity: 0.6 },
  // The box, then the cells: the cells dim together when the song is not coming in.
  grid: { flexDirection: 'row', alignItems: 'center', gap: GAP, paddingHorizontal: 12 },
  cells: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: GAP },
  gridHead: { paddingBottom: 6 },
  headLabel: groupLabel(theme.colors),
  colCover: { width: 40 },
  colTitle: { flex: 1.2, minWidth: 0 },
  colArtist: { flex: 1, minWidth: 0 },
  colAlbum: { flex: 1, minWidth: 0 },
  // Title, artist and album together, and the gaps between them: where the bar goes.
  colSpan: { flex: 3.2, minWidth: 0 },
  colEnd: { width: 90, alignItems: 'flex-end', justifyContent: 'center' },
  colFrom: { width: 130, justifyContent: 'center' },
  endStack: { alignItems: 'flex-end', gap: 3, maxWidth: 130 },
  endWords: { color: theme.colors.textMuted, fontSize: type.tiny, fontWeight: '600' },
  warn: { color: theme.colors.warning },
  // The open row's choice of where the song comes from: two options side by side.
  choice: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  option: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 120,
    maxWidth: 260,
    gap: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: theme.colors.surface0,
  },
  optionOn: { backgroundColor: theme.colors.textPrimary },
  optionName: { color: theme.colors.textPrimary, fontSize: type.sub, fontWeight: '700' },
  optionNameOn: { color: theme.colors.surface0 },
  optionWords: { color: theme.colors.textSecondary, fontSize: type.tiny },
  optionWordsOn: { color: withAlpha(theme.colors.surface0, 0.7) },
  found: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  foundWords: { flex: 1, minWidth: 0, color: theme.colors.textSecondary, fontSize: type.small },
  endText: { textAlign: 'right' },
  names2: { flex: 3.2, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: GAP },
  gridRowWrap: { borderRadius: 10, marginBottom: 2 },
  gridRow: { height: 52 },
  lit: { backgroundColor: theme.colors.surface1 },
  barRow: { paddingTop: 4, paddingBottom: 14 },
  dim: { opacity: 0.38 },
  // The boxes, sized as the library's rows size theirs (`SongRow`).
  select: {
    width: 34,
    height: HIT_TARGET,
    marginLeft: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectWide: {
    width: 24,
    height: 24,
    marginLeft: -4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allPhone: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  allWords: { color: theme.colors.textSecondary, fontSize: type.sub, fontWeight: '600' },
  title: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  artist: { color: theme.colors.textSecondary, fontSize: type.sub },
  album: { color: theme.colors.textMuted, fontSize: type.small },
  struck: { textDecorationLine: 'line-through' },
  endTime: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  endQuiet: { color: theme.colors.textSecondary, fontSize: type.small, textAlign: 'right' },
  trouble: { color: theme.colors.danger },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 60 },
  phoneRowBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  // The open row: a card a step up, reaching a little past the list's edges.
  openCard: {
    gap: 10,
    padding: 12,
    marginVertical: 4,
    marginHorizontal: -8,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface1,
  },
  openTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // The card's padding less its reach past the list: the box lines up with the closed rows' boxes.
  selectOpen: { marginLeft: -4, marginRight: -4 },
  fields: { flex: 1, minWidth: 0, gap: 6 },
  // A field on the card is sunk to the ground's tone; the focused one carries the accent ring.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: theme.colors.surface0,
  },
  fieldFocused: { boxShadow: `0 0 0 1.5px ${theme.colors.accent}` },
  // Wide enough for ARTIST on one line, with the box beside the cover.
  fieldLabel: { ...groupLabel(theme.colors), width: 52, fontSize: type.tiny, letterSpacing: 0.7 },
  fieldWide: {
    height: 32,
    marginLeft: -8,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.surface0,
  },
  input: {
    color: theme.colors.textPrimary,
    _web: { outlineStyle: 'none' },
  },
  inputPhone: { flex: 1, minWidth: 0 },
  inputTitle: { fontSize: type.body, fontWeight: '600' },
  inputArtist: { fontSize: type.body },
  inputAlbum: { fontSize: type.body },
  barBlock: { gap: 4 },
  times: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  time: { color: theme.colors.textSecondary, fontSize: type.tiny, fontVariant: ['tabular-nums'] },
}))
