import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, PanResponder, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { Redirect } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { formatDuration, type ImportPreviewItem } from '@selfmp3/shared'
import { ApiError, fonts, radius, type Review, type ServerConnection } from '@selfmp3/client'
import { useBottomInset } from '../../shell/bottomInset'
import { useLayout } from '../../shell/useLayout'
import { canListenHere } from '../../ports/listen'
import { spring } from '../../ui/motion'
import { label as groupLabel, serif } from '../../ui/surfaces'
import { Button } from '../../ui/components/Button'
import { useBackTo } from '../../ui/components/BackRow'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { X } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ListenCover, PatternBar, useListen } from './ImportListen'
import { TagThem } from './ImportTags'
import { leaveOutIn, renameIn, useImportDraft } from './importDraft'
import { useImportSource } from './importSource'
import { canListen, listenDetail, listeningLeftReview, type Listening } from './listen.model'
import {
  comingIn,
  countLabel,
  importLabel,
  importRequest,
  mosaicCovers,
  reviewKicker,
  reviewName,
  rowState,
  type Rename,
  type RowState,
} from './review.model'

/** How far a row is swiped left before letting go leaves it out (or brings it back). */
const SWIPE_TO_LEAVE = 88

/**
 * Reviewing what a link holds, before any of it downloads (`/import/review`,
 * docs/ui-mock `P30` and `C14`).
 *
 * Every song is coming in unless it is left out; there are no checkboxes. A
 * song the library already has says "Yours already" and is skipped. On a phone
 * a swipe left leaves a song out and a second brings it back, and a tap opens
 * the row in place to hear it and fix its name. On a computer every row sits
 * on one grid; play and "Leave out" wait under the pointer, and the playing
 * row turns its title and artist into fields with its bar opening under it.
 *
 * A page of its own rather than a state of Import, because the review lives in
 * the draft (importDraft.ts), which outlives either page: Back keeps it, and
 * Import offers it again. With no review in the draft — a reload, an old link —
 * there is nothing to show, and it goes to Import.
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
  const key = via?.baseUrl ?? 'own'
  const [draft, patchDraft] = useImportDraft(key)
  const { review, tagIds } = draft
  const listen = useListen(via)
  const backTo = useBackTo()
  const footInset = useBottomInset()
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Imported or cancelled: the draft empties as the page leaves, which is not a reload. */
  const [leaving, setLeaving] = useState(false)

  const failed = (err: Error): void => {
    if (via && err instanceof ApiError && err.isOffline) {
      setError('Your server stopped answering. Looking for it again…')
      onUnreachable?.()
      return
    }
    setError(err.message)
  }

  /** Back to Import with the review done: imported, or cancelled with the links kept. */
  const leave = ({ keepLinks }: { keepLinks: boolean }): void => {
    setLeaving(true)
    listen.close({ resume: false })
    backTo('/import')
    patchDraft(keepLinks ? { review: null } : { review: null, links: '' })
  }

  const enqueue = useMutation({
    mutationFn: (current: Review) => source.api.importEnqueue(importRequest(current, tagIds)),
    onSuccess: () => {
      // The songs are in the queue now, which Import shows under Now.
      void source.invalidateQueue()
      leave({ keepLinks: false })
    },
    onError: failed,
  })

  // A preview whose song has left the review stops with it, and what played
  // before it stays paused: you did not ask for music, you asked for songs.
  const leftReview = listeningLeftReview(listen.listening, review?.items ?? null)
  useEffect(() => {
    if (leftReview) listen.close({ resume: false })
    // Only whether it left matters; `close` is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftReview])

  if (!review) return leaving ? null : <Redirect href="/import" />

  const count = comingIn(review)
  const tags = source.library?.tags ?? []
  const anyToHear = canListenHere && review.items.some(canListen)

  const playing = (item: ImportPreviewItem): Listening | null =>
    listen.listening?.track.url === item.url ? listen.listening : null

  /** Open a row, and play it where it can be played. */
  const openRow = (index: number, item: ImportPreviewItem): void => {
    setOpen(index)
    if (canListenHere && canListen(item) && !playing(item)) listen.toggle(item)
  }
  const closeRow = (): void => {
    setOpen(null)
    listen.close()
  }
  const leaveOut = (index: number): void => {
    if (open === index) closeRow()
    leaveOutIn(key, index)
  }
  const rename = (index: number, change: Rename): void => renameIn(key, index, change)

  const rows = review.items.map((item, index) => {
    const state = rowState(review, index)
    const shared = {
      item,
      index,
      state,
      open: open === index,
      listening: playing(item),
      canPlay: canListenHere && canListen(item),
      onLeaveOut: () => leaveOut(index),
      onRename: (change: Rename) => rename(index, change),
      onSeek: listen.seek,
    }
    return wide ? (
      <GridRow
        key={`${item.url}-${index}`}
        {...shared}
        finePointer={finePointer}
        onPlay={() => {
          if (open !== index) setOpen(index)
          listen.toggle(item)
        }}
        onOpen={() => openRow(index, item)}
      />
    ) : (
      <PhoneRow
        key={`${item.url}-${index}`}
        {...shared}
        onOpen={() => openRow(index, item)}
        onClose={closeRow}
        draftKey={key}
      />
    )
  })

  const importButton = (
    <Button
      label={importLabel(count)}
      variant="primary"
      grow={!wide}
      disabled={count === 0}
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
        <View style={styles.headPhone}>
          <Pressable
            onPress={() => {
              listen.close()
              backTo('/import')
            }}
            accessibilityRole="button"
            accessibilityLabel="Back to Import"
            hitSlop={12}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Text style={styles.back}>Back</Text>
          </Pressable>
          <Text style={styles.namePhone} numberOfLines={1} accessibilityRole="header">
            {reviewName(review)}
          </Text>
          <Text style={styles.count} testID="import-count">
            {countLabel(review, false)}
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={wide ? styles.listWide : styles.listPhone}
        keyboardShouldPersistTaps="handled"
        testID="import-review"
      >
        {wide ? null : (
          <Text style={styles.hint}>
            {anyToHear
              ? 'Everything is in unless you swipe it left. Tap a song to hear it and to fix its name.'
              : 'Everything is in unless you swipe it left. Tap a song to fix its name.'}
          </Text>
        )}
        {wide ? (
          <View style={[styles.grid, styles.gridHead]} aria-hidden>
            <View style={styles.colCover} />
            <Text style={[styles.headLabel, styles.colTitle]}>Title</Text>
            <Text style={[styles.headLabel, styles.colArtist]}>Artist</Text>
            <Text style={[styles.headLabel, styles.colEnd, styles.endText]}>Time</Text>
          </View>
        ) : null}
        <View accessibilityRole="list" accessibilityLabel="Songs to import">
          {rows}
        </View>
      </ScrollView>

      {/*
       * The foot stays put under the list, the commit always in reach however
       * long the playlist; on a phone it stands clear of the floating chrome.
       */}
      <View style={[wide ? styles.footWide : styles.footPhone, { paddingBottom: footInset + 12 }]}>
        {error ? (
          <View style={styles.error} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
            <IconButton onPress={() => setError(null)} label="Dismiss">
              <X size={15} tone="textMuted" />
            </IconButton>
          </View>
        ) : null}
        <View style={wide ? styles.footRow : styles.footColumn}>
          <View style={wide ? styles.tagsWide : null}>
            <TagThem
              tags={tags}
              selected={tagIds}
              onChange={next => patchDraft({ tagIds: next })}
            />
          </View>
          {wide ? (
            <Pressable
              onPress={() => leave({ keepLinks: true })}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          ) : null}
          {importButton}
        </View>
      </View>
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

interface RowProps {
  readonly item: ImportPreviewItem
  readonly index: number
  readonly state: RowState
  readonly open: boolean
  /** This row's preview, when it is the one playing. */
  readonly listening: Listening | null
  readonly canPlay: boolean
  readonly onLeaveOut: () => void
  readonly onRename: (change: Rename) => void
  readonly onSeek: (seconds: number) => void
}

/** What a row says at its end when nothing is asked of it. */
function EndWords({ item, state }: { item: ImportPreviewItem; state: RowState }): ReactNode {
  if (state === 'yours') return <Text style={styles.endQuiet}>Yours already</Text>
  if (state === 'out') return <Text style={styles.endOut}>Left out</Text>
  return item.duration > 0 ? (
    <Text style={styles.endTime}>{formatDuration(item.duration)}</Text>
  ) : null
}

/** A field on an open row: a title or an artist, named the way `P30` names it. */
function NameField({
  label,
  value,
  onChange,
  index,
  wide,
}: {
  label: 'Title' | 'Artist'
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
        label === 'Title' ? styles.inputTitle : styles.inputArtist,
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
function barTimes(item: ImportPreviewItem, listening: Listening | null) {
  return {
    at: formatDuration(listening?.currentTime ?? 0),
    length: formatDuration(listening?.duration || item.duration),
    trouble: listening?.status === 'error' ? listenDetail(listening) : null,
  }
}

/**
 * A row on a phone (`P30`). Closed, it is a song; a swipe left leaves it out
 * or brings it back, over the `remove` ground. Open, it is a card with Title
 * and Artist and the bar to drag; the cover closes it again.
 */
function PhoneRow({
  item,
  index,
  state,
  open,
  listening,
  canPlay,
  onLeaveOut,
  onRename,
  onSeek,
  onOpen,
  onClose,
  draftKey,
}: RowProps & {
  onOpen: () => void
  onClose: () => void
  /** Whose draft the row is in, so a swipe changes it without a callback that changes as it goes. */
  draftKey: string
}): ReactNode {
  const [offset] = useState(() => new Animated.Value(0))
  const swipeable = state !== 'yours'

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claimed only for a sideways drag, before the row's press or the
        // list's scroll can take it: a drag down the list stays a scroll.
        onMoveShouldSetPanResponderCapture: (_event, gesture) =>
          swipeable &&
          Math.abs(gesture.dx) > 12 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gesture) => offset.setValue(Math.min(0, gesture.dx)),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx <= -SWIPE_TO_LEAVE) leaveOutIn(draftKey, index)
          spring(offset, 0)
        },
        onPanResponderTerminate: () => void spring(offset, 0),
      }),
    // Nothing here changes as a preview ticks, so a swipe keeps one responder
    // from start to end: one made afresh mid-swipe would forget how far it came.
    [swipeable, offset, draftKey, index],
  )

  if (open) {
    const times = barTimes(item, listening)
    return (
      <View style={styles.openCard} testID={`import-row-${index}`}>
        <View style={styles.openTop}>
          {/* The plain cover, as `P30` draws it: here it closes the row rather than playing. */}
          <ListenCover
            item={item}
            listening={null}
            onPress={onClose}
            shown={false}
            size={56}
            label={`Close ${item.title || 'this song'}`}
          />
          <View style={styles.fields}>
            <NameField
              label="Title"
              value={item.title}
              onChange={title => onRename({ title })}
              index={index}
              wide={false}
            />
            <NameField
              label="Artist"
              value={item.artist}
              onChange={artist => onRename({ artist })}
              index={index}
              wide={false}
            />
          </View>
        </View>
        {canPlay ? (
          <View style={styles.barBlock}>
            <PatternBar
              seed={item.url}
              position={listening?.currentTime ?? 0}
              duration={listening?.duration || item.duration}
              onSeek={onSeek}
            />
            <View style={styles.times}>
              <Text style={styles.time}>{times.at}</Text>
              <Text style={[styles.time, times.trouble ? styles.trouble : null]} numberOfLines={1}>
                {times.trouble ?? 'Drag to move · tap the song again to close'}
              </Text>
              <Text style={styles.time}>{times.length}</Text>
            </View>
          </View>
        ) : null}
      </View>
    )
  }

  const out = state === 'out'
  return (
    <View style={styles.swipeGround} testID={`import-row-${index}`}>
      {swipeable ? (
        <View style={styles.swipeUnder} pointerEvents="none">
          <Text style={styles.swipeWords}>{out ? 'Bring back' : 'Leave out'}</Text>
        </View>
      ) : null}
      <Animated.View
        style={[styles.phoneRowSlide, { transform: [{ translateX: offset }] }]}
        {...responder.panHandlers}
      >
        <Pressable
          // A left-out row stays reachable, for the action that brings it back.
          onPress={state === 'in' ? onOpen : undefined}
          disabled={!swipeable}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}, ${item.artist || 'Unknown artist'}`}
          accessibilityHint={state === 'in' ? 'Opens it to hear it and fix its name' : undefined}
          accessibilityState={{ disabled: !swipeable }}
          accessibilityActions={
            swipeable ? [{ name: 'leaveOut', label: out ? 'Bring back' : 'Leave out' }] : []
          }
          onAccessibilityAction={onLeaveOut}
          style={({ pressed }) => [styles.phoneRow, pressed && styles.pressed]}
        >
          <View style={[styles.phoneRowBody, state !== 'in' && styles.dim]}>
            <Cover uri={item.thumbnail} title={item.title} size={44} />
            <View style={styles.texts}>
              <Text style={[styles.title, out && styles.struck]} numberOfLines={1}>
                {item.title || 'Untitled'}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {item.artist || 'Unknown artist'}
              </Text>
            </View>
            <EndWords item={item} state={state} />
          </View>
        </Pressable>
      </Animated.View>
    </View>
  )
}

/**
 * A row on a computer (`C14`), on the one grid every row shares so nothing
 * ever moves sideways: cover, title, artist, and a fixed end. Under the
 * pointer the cover shows play and the end says "Leave out"; both are always
 * there for a keyboard, only unseen. The playing row's title and artist are
 * fields, and its bar opens under it across those two columns.
 */
function GridRow({
  item,
  index,
  state,
  open,
  listening,
  canPlay,
  finePointer,
  onLeaveOut,
  onRename,
  onSeek,
  onPlay,
  onOpen,
}: RowProps & { finePointer: boolean; onPlay: () => void; onOpen: () => void }): ReactNode {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  // With no pointer to wait for (a tablet at this width), what hover shows is always shown.
  const reveal = hovered || focused || !finePointer
  const out = state === 'out'
  const lit = open || (hovered && state !== 'yours')
  const times = barTimes(item, listening)
  const showBar = open && canPlay && listening !== null

  return (
    // A Pressable for its hover only: the row is lit while the pointer is in it,
    // and pressing is left to the cover, the names and "Leave out" inside it.
    <Pressable
      testID={`import-row-${index}`}
      accessible={false}
      focusable={false}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.gridRowWrap, lit && styles.lit]}
    >
      <View style={[styles.grid, styles.gridRow, state !== 'in' && !open && styles.dim]}>
        <View style={styles.colCover}>
          {canPlay && state === 'in' ? (
            <ListenCover item={item} listening={listening} onPress={onPlay} shown={reveal} />
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
                onChange={title => onRename({ title })}
                index={index}
                wide
              />
            </View>
            <View style={styles.colArtist}>
              <NameField
                label="Artist"
                value={item.artist}
                onChange={artist => onRename({ artist })}
                index={index}
                wide
              />
            </View>
          </>
        ) : (
          <Pressable
            onPress={state === 'in' ? onOpen : undefined}
            disabled={state !== 'in'}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${item.title || 'this song'}`}
            style={styles.names2}
          >
            <Text style={[styles.title, styles.colTitle, out && styles.struck]} numberOfLines={1}>
              {item.title || 'Untitled'}
            </Text>
            <Text style={[styles.artist, styles.colArtist]} numberOfLines={1}>
              {item.artist || 'Unknown artist'}
            </Text>
          </Pressable>
        )}
        <View style={styles.colEnd}>
          {state === 'yours' ? (
            <EndWords item={item} state={state} />
          ) : (
            <>
              {reveal ? null : <EndWords item={item} state={state} />}
              <Pressable
                onPress={onLeaveOut}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                accessibilityRole="button"
                accessibilityLabel={`${out ? 'Bring back' : 'Leave out'} ${item.title}`}
                style={[styles.leave, !reveal && styles.unseen]}
              >
                <Text style={out ? styles.endOut : styles.leaveText}>
                  {out ? 'Bring back' : 'Leave out'}
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
      {showBar ? (
        <View style={[styles.grid, styles.barRow]}>
          <View style={styles.colCover} />
          <View style={styles.colSpan}>
            <PatternBar
              seed={item.url}
              position={listening.currentTime}
              duration={listening.duration || item.duration}
              onSeek={onSeek}
              height={30}
            />
          </View>
          <View style={styles.colEnd}>
            <Text style={[styles.endTime, times.trouble ? styles.trouble : null]} numberOfLines={2}>
              {times.trouble ?? `${times.at} / ${times.length}`}
            </Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  )
}

/** The grid's columns (`C14`: `40px minmax(0,1.2fr) minmax(0,1fr) 90px`), as flex. */
const GAP = 14

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  scroll: { flex: 1 },
  pressed: { opacity: 0.6 },
  headPhone: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 6,
    paddingHorizontal: 20,
  },
  back: { color: theme.colors.textSecondary, fontSize: 15, fontWeight: '600' },
  namePhone: {
    flex: 1,
    textAlign: 'center',
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: 17,
  },
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
    paddingBottom: 8,
  },
  listPhone: { paddingHorizontal: 20 },
  listWide: { paddingHorizontal: 28 },
  grid: { flexDirection: 'row', alignItems: 'center', gap: GAP, paddingHorizontal: 12 },
  gridHead: { paddingBottom: 6 },
  headLabel: groupLabel(theme.colors),
  colCover: { width: 40 },
  colTitle: { flex: 1.2, minWidth: 0 },
  colArtist: { flex: 1, minWidth: 0 },
  // Title and artist together, and the gap between them: where the bar goes.
  colSpan: { flex: 2.2, minWidth: 0 },
  colEnd: { width: 90, alignItems: 'flex-end', justifyContent: 'center' },
  endText: { textAlign: 'right' },
  names2: { flex: 2.2, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: GAP },
  gridRowWrap: { borderRadius: 10, marginBottom: 2 },
  gridRow: { height: 52 },
  lit: { backgroundColor: theme.colors.surface1 },
  barRow: { paddingTop: 4, paddingBottom: 14 },
  dim: { opacity: 0.38 },
  title: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  artist: { color: theme.colors.textSecondary, fontSize: 13 },
  struck: { textDecorationLine: 'line-through' },
  endTime: {
    color: theme.colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  endQuiet: { color: theme.colors.textSecondary, fontSize: 12, textAlign: 'right' },
  endOut: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600' },
  leave: { position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center' },
  leaveText: { color: theme.colors.accent, fontSize: 12, fontWeight: '600' },
  unseen: { opacity: 0 },
  trouble: { color: theme.colors.danger },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  // Behind a row being swiped: the `remove` ground, saying what letting go does.
  swipeGround: { borderRadius: radius.cover, overflow: 'hidden' },
  swipeUnder: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 16,
    backgroundColor: theme.colors.remove,
  },
  swipeWords: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  phoneRowSlide: { backgroundColor: theme.colors.surface0 },
  phoneRow: { height: 60, justifyContent: 'center' },
  phoneRowBody: { flexDirection: 'row', alignItems: 'center', gap: 12 },
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
