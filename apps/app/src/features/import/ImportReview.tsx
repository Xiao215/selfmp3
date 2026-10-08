import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { Redirect } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import {
  artistOr,
  formatDuration,
  type ImportPreviewItem,
  type ImportSource,
} from '@selfmp3/shared'
import {
  ApiError,
  HIT_TARGET,
  radius,
  withAlpha,
  type Review,
  type ServerConnection,
} from '@selfmp3/client'
import { useFootInset } from '../../shell/bottomInset'
import { useLayout } from '../../shell/useLayout'
import { canListenHere } from '../../ports/listen'
import { label as groupLabel, pageTitle, serif } from '../../ui/surfaces'
import { BackButton } from '../../ui/components/BackButton'
import { Button } from '../../ui/components/Button'
import { useBackTo } from '../../ui/useBackTo'
import { Checkbox } from '../../ui/components/Checkbox'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { X } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import type { ValueStore } from '../../state/valueStore.model'
import { useValueStore } from '../../state/useValueStore'
import { useToneColors } from '../../ui/useSongColor'
import { ListenBar, ListenCover, useListen } from './ImportListen'
import { TagThem } from './ImportTags'
import {
  chooseAllIn,
  chooseSourceIn,
  lookAgainIn,
  renameIn,
  toggleChosenIn,
  useImportDraft,
} from './importDraft'
import { draftSourceFor } from './importDraft.model'
import { useImportSource } from './importSource'
import { reviewUrls, useRefreshReview } from './useRefreshReview'
import { useFindSongs } from './useFindSongs'
import {
  canListen,
  listenDetail,
  listeningLeftReview,
  waitingRowNext,
  type Listening,
} from './listen.model'
import {
  chosenState,
  comingIn,
  countLabel,
  importLabel,
  importRequest,
  mosaicCovers,
  reviewKicker,
  reviewName,
  rowState,
  sourceWords,
  stillFinding,
  type Rename,
  type RowState,
} from './review.model'

/**
 * Reviewing what a link holds, before any of it downloads (`/import/review`,
 * docs/ui-mock `P30` and `C14`).
 *
 * Every song starts ticked, and only ticked songs are imported: the box at the
 * left of a row takes it out and puts it back, and the one in the head does
 * that for every row. A song the library already has says "In library",
 * has no box, and is skipped. On a phone a tap plays the song and opens the
 * row in place once it is playing — its cover shows the wait meanwhile — to
 * hear it and fix its name, and a tap anywhere else closes it. On a computer
 * every row sits on one grid; play waits under the pointer, and the playing
 * row turns its title, artist and album into fields with its bar opening under
 * it.
 *
 * The rows are memoised and every handler they are given keeps its identity,
 * because the preview reports where it is four times a second and a hundred
 * rows redrawn at that rate made a phone stutter. Where it is is not even the
 * page's: only the playing row's bar and times read it (`AtPosition`), so the
 * page and its rows are drawn again when the preview starts, pauses or ends.
 *
 * A page of its own rather than a state of Import, because the review lives in
 * the draft (importDraft.store.ts), which outlives either page and the page's
 * own reload: Back keeps it, and Import offers it again. With no review in the
 * draft — imported, cancelled, never looked up — there is nothing to show, and
 * it goes to Import.
 */
export function ImportReview({
  via,
  onUnreachable,
}: {
  via?: ServerConnection
  /** As ImportScreen's: the server this page was pointed at stopped answering. */
  onUnreachable?: () => void
} = {}): ReactNode {
  const { wide, finePointer } = useLayout()
  const source = useImportSource(via)
  const key = draftSourceFor(via)
  const [draft, patchDraft] = useImportDraft(key)
  const { review, tagIds } = draft
  // A kept review's "In library" is from when the link was looked up.
  useRefreshReview(source.api, key, reviewUrls(review))
  // Songs known only by name — a Spotify list, 网易云's VIP songs — are found as the review shows.
  const finder = useFindSongs(source.api, key, review)
  const listen = useListen(via, source.api)
  const backTo = useBackTo()
  const footInset = useFootInset()
  const [open, setOpen] = useState<number | null>(null)
  /** A phone row tapped and waiting for its song to play before it opens. */
  const [opening, setOpening] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Imported or cancelled: the draft empties as the page leaves, which is not a review to go looking for. */
  const [leaving, setLeaving] = useState(false)

  const failed = (err: Error): void => {
    if (via && err instanceof ApiError && err.isOffline) {
      setError('Your server stopped answering. Looking for it again…')
      onUnreachable?.()
      return
    }
    setError(err.message)
  }

  /**
   * Back to Import with the review done. Imported, the draft starts afresh —
   * the links, and the tags too: the tags were for these songs, and the next
   * link arriving tagged the same way was a surprise found only once it had.
   * Cancelled, the links and the tags stay for another look.
   */
  const leave = ({ imported }: { imported: boolean }): void => {
    setLeaving(true)
    listen.close({ resume: false })
    backTo('/import')
    patchDraft(imported ? { review: null, links: '', tagIds: new Set() } : { review: null })
  }

  const enqueue = useMutation({
    mutationFn: (current: Review) => source.api.importEnqueue(importRequest(current, tagIds)),
    onSuccess: () => {
      // The songs are in the queue now, which Import shows under Currently importing.
      void source.invalidateQueue()
      leave({ imported: true })
    },
    onError: failed,
  })

  // A preview whose song has left the review stops with it, and what played
  // before it stays paused: you did not ask for music, you asked for songs.
  const leftReview = listeningLeftReview(listen.listening, review?.items ?? null)
  const { toggle, seek, close } = listen
  useEffect(() => {
    if (leftReview) close({ resume: false })
  }, [leftReview, close])

  /*
   * The handlers the rows are given read the review and the preview through a
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
  const closeRow = (): void => {
    setOpen(null)
    setOpening(null)
    close()
  }
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
  const toggleChosen = useCallback((index: number): void => toggleChosenIn(key, index), [key])
  const chooseAll = (on: boolean): void => chooseAllIn(key, on)
  const rename = useCallback(
    (index: number, change: Rename): void => renameIn(key, index, change),
    [key],
  )
  const chooseSource = useCallback(
    (index: number, from: ImportSource): void => chooseSourceIn(key, index, from),
    [key],
  )
  const lookAgain = useCallback((index: number): void => lookAgainIn(key, index), [key])

  if (!review) return leaving ? null : <Redirect href="/import" />

  const count = comingIn(review)
  const finding = stillFinding(review)
  const tags = source.library?.tags ?? []
  // A From column only for a list whose songs come from more than where they were linked.
  const showFrom = review.from !== 'youtube'
  const anyToHear = canListenHere && review.items.some(canListen)

  const playing = (item: ImportPreviewItem): Listening | null =>
    listen.listening?.track.url === item.url ? listen.listening : null

  const rows = review.items.map((item, index) => {
    const state = rowState(review, index)
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

  const importButton = (
    <Button
      label={importLabel(count, finding)}
      variant="primary"
      grow={!wide}
      disabled={count === 0 || finding > 0}
      busy={enqueue.isPending}
      onPress={() => enqueue.mutate(review)}
      testID="import-commit"
    />
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {wide ? (
        <View style={styles.headWide}>
          <Mosaic review={review} />
          <View style={styles.names}>
            <Text style={styles.kicker}>{reviewKicker(review)}</Text>
            <Text style={styles.nameWide} numberOfLines={1} accessibilityRole="header">
              {reviewName(review)}
            </Text>
          </View>
          <Text style={styles.count} testID="import-count">
            {countLabel(review, true)}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={open === null ? undefined : closeRow}
          accessible={false}
          style={styles.headPhone}
        >
          {/*
           * The head every page opened from another has on a phone: the round
           * ‹ (`BackButton`, as Import's own head), the name under it on the
           * left as the page's title (J1), and the count under that. The draft keeps the
           * review, and the preview stops with the page.
           */}
          <BackButton to="/import" testID="import-review-back" />
          <View style={styles.namesPhone}>
            <Text style={styles.namePhone} numberOfLines={1} accessibilityRole="header">
              {reviewName(review)}
            </Text>
            <Text style={styles.count} testID="import-count">
              {countLabel(review, false)}
            </Text>
          </View>
        </Pressable>
      )}

      {/*
       * On a phone everything that is not a row is a press that closes the
       * open row: the head and the foot around their own buttons, and the
       * list's ground — the hint, the gap between rows, the space under the
       * last. A tap there puts the card away and stops what it was playing. A
       * scroll is not a tap, and a row's own press takes its tap first. With
       * no row open they have no press, and are never `disabled`: the web
       * writes that as `aria-disabled`, which disables every button inside.
       */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={wide ? styles.listWide : styles.listPhone}
        keyboardShouldPersistTaps="handled"
        testID="import-review"
      >
        <Pressable
          onPress={wide || open === null ? undefined : closeRow}
          accessible={false}
          style={styles.ground}
        >
          {wide ? (
            <View style={[styles.grid, styles.gridHead]}>
              <AllBox review={review} onChange={chooseAll} wide />
              <View style={styles.cells} aria-hidden>
                <View style={styles.colCover} />
                <Text style={[styles.headLabel, styles.colTitle]}>Title</Text>
                <Text style={[styles.headLabel, styles.colArtist]}>Artist</Text>
                <Text style={[styles.headLabel, styles.colAlbum]}>Album</Text>
                {showFrom ? <Text style={[styles.headLabel, styles.colFrom]}>From</Text> : null}
                <Text style={[styles.headLabel, styles.colEnd, styles.endText]}>Time</Text>
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.hint}>
                {anyToHear
                  ? 'Untick a song to leave it out. Tap a song to hear it and to fix its name.'
                  : 'Untick a song to leave it out. Tap a song to fix its name.'}
              </Text>
              <AllBox review={review} onChange={chooseAll} wide={false} />
            </>
          )}
          <View accessibilityRole="list" accessibilityLabel="Songs to import">
            {rows}
          </View>
        </Pressable>
      </ScrollView>

      {/*
       * The foot stays put under the list, the commit always in reach however
       * long the playlist; on a phone it stands clear of the floating chrome,
       * or of the home indicator on this page, which has no chrome.
       */}
      <Pressable
        onPress={wide || open === null ? undefined : closeRow}
        accessible={false}
        style={[wide ? styles.footWide : styles.footPhone, { paddingBottom: footInset + 12 }]}
      >
        {error ? (
          <View style={styles.error} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
            <IconButton onPress={() => setError(null)} label="Dismiss">
              <X size={15} tone="textMuted" />
            </IconButton>
          </View>
        ) : null}
        {finder.error ? (
          <View style={styles.error} accessibilityRole="alert">
            <Text style={styles.errorText}>{finder.error}</Text>
            <Button label="Try again" variant="text" onPress={finder.retry} />
          </View>
        ) : null}
        <View style={wide ? styles.footRow : styles.footColumn}>
          <View style={wide ? styles.tagsWide : null}>
            <TagThem
              tags={tags}
              createTag={source.createTag}
              selected={tagIds}
              onChange={next => patchDraft({ tagIds: next })}
            />
          </View>
          {wide ? (
            <Pressable
              onPress={() => leave({ imported: false })}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          ) : null}
          {importButton}
        </View>
      </Pressable>
    </SafeAreaView>
  )
}

/** The head's picture on a computer: four of the list's covers, or its one. */
function Mosaic({ review }: { review: Review }): ReactNode {
  const covers = mosaicCovers(review)
  const name = reviewName(review)
  if (covers.length < 4) {
    return <Cover uri={covers[0] ?? null} title={name} size={64} radius={14} />
  }
  return (
    <View style={styles.mosaic}>
      {covers.map(uri => (
        <Cover key={uri} uri={uri} title={name} size={32} radius={0} />
      ))}
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
function AllBox({
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

/** What every row is given. The handlers take the row's index, so one function serves every row. */
interface RowProps {
  readonly item: ImportPreviewItem
  readonly index: number
  readonly state: RowState
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
 * the server has but the bucket does not yet is "On your server": the library
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
  state: RowState
  /** Where it comes from, said under the length on a phone (`sourceWords`); a computer has a column. */
  words?: string | null
  wordsWarn?: boolean
}): ReactNode {
  if (state === 'yours') {
    return (
      <Text style={styles.endQuiet}>
        {item.alreadyHave
          ? item.waitingToUpload
            ? 'On your server'
            : 'In library'
          : 'In the queue'}
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
      <Text style={styles.fieldLabel}>{label}</Text>
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
        <SelectBox item={item} checked={!out} onToggle={() => onToggleChosen(index)} wide={false} />
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
          state !== 'in' && styles.dim,
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
          <SelectBox item={item} checked={!out} onToggle={() => onToggleChosen(index)} wide />
        )}
        {/* The box keeps its full colour: dimmed, an empty ring would all but vanish. */}
        <View style={[styles.cells, state !== 'in' && !open && styles.dim]}>
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
  // The list's ground fills the scroll so a tap under the last row lands on it too.
  ground: { flexGrow: 1 },
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
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  scroll: { flex: 1 },
  pressed: { opacity: 0.6 },
  // As Import's head: the button, the words under it on the left, room above and below.
  headPhone: {
    alignItems: 'flex-start',
    gap: 12,
    paddingTop: 8,
    paddingBottom: 14,
    paddingHorizontal: 20,
  },
  namesPhone: { alignSelf: 'stretch', gap: 2 },
  namePhone: pageTitle(theme.colors),
  count: { color: theme.colors.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  headWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 14,
  },
  mosaic: {
    width: 64,
    height: 64,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  names: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { ...groupLabel(theme.colors), fontSize: 12, color: theme.colors.textSecondary },
  // The serif has one weight; the name is never bolded.
  nameWide: { ...serif(theme.colors, 34), lineHeight: 38 },
  hint: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    paddingTop: 12,
    paddingBottom: 4,
  },
  listPhone: { paddingHorizontal: 20, flexGrow: 1 },
  listWide: { paddingHorizontal: 28 },
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
  endWords: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600' },
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
  optionName: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '700' },
  optionNameOn: { color: theme.colors.surface0 },
  optionWords: { color: theme.colors.textSecondary, fontSize: 11 },
  optionWordsOn: { color: withAlpha(theme.colors.surface0, 0.7) },
  found: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  foundWords: { flex: 1, minWidth: 0, color: theme.colors.textSecondary, fontSize: 12 },
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
  allWords: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' },
  title: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  artist: { color: theme.colors.textSecondary, fontSize: 13 },
  album: { color: theme.colors.textMuted, fontSize: 12 },
  struck: { textDecorationLine: 'line-through' },
  endTime: {
    color: theme.colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  endQuiet: { color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right' },
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
  fieldLabel: { ...groupLabel(theme.colors), width: 42, fontSize: 10, letterSpacing: 0.7 },
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
  inputTitle: { fontSize: 14, fontWeight: '600' },
  inputArtist: { fontSize: 14 },
  inputAlbum: { fontSize: 14 },
  barBlock: { gap: 4 },
  times: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  time: { color: theme.colors.textSecondary, fontSize: 11, fontVariant: ['tabular-nums'] },
  footPhone: { gap: 10, paddingTop: 8, paddingHorizontal: 20 },
  footWide: { gap: 10, paddingTop: 12, paddingHorizontal: 40 },
  footColumn: { gap: 10 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tagsWide: { flex: 1, minWidth: 0 },
  cancel: { paddingHorizontal: 8, paddingVertical: 8 },
  cancelText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '600' },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 14,
    paddingRight: 4,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface1,
  },
  errorText: { flex: 1, color: theme.colors.danger, fontSize: 13, lineHeight: 19 },
}))
