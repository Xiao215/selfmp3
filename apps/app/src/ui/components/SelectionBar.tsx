import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { plural } from '@selfmp3/shared'
import type { Song, Tag } from '@selfmp3/shared'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  clientApi,
  failureText,
  isDownloaded,
  motion,
  queryKeys,
  radius,
  space,
  useAddToPlaylist,
  useBulkDeleteSongs,
  useBulkLoved,
  useBulkTag,
  useLibrary,
  useRemoveManyFromPlaylist,
} from '@selfmp3/client'
import { playlistsToAddTo } from '../../features/playlists/playlists.model'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { ease, timing, usePresence } from '../motion'
import { MOVE_MS, overshootRange } from '../motion.model'
import { showToast } from '../toast'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { ConfirmRemoveSongs } from './ConfirmRemoveSongs'
import { IconButton } from './IconButton'
import {
  CheckSquare,
  CloudDownload,
  Heart,
  ListMusic,
  More,
  Play,
  Plus,
  Queue,
  Tag as TagIcon,
  Trash,
  X,
} from './Icons'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'
import { floating } from '../surfaces'
import { useFloatingChrome } from '../../shell/bottomInset'

/**
 * How much room a phone's list leaves under its last row while the bar is up,
 * so the last song can still be scrolled out from under it.
 */
export const SELECTION_BAR_SPACE = 72

/**
 * How far above its place a computer's bar starts, in points: the same six the
 * pages settle in by (`M3`, 5). Not its own height, which would draw it over
 * whatever the page keeps above the list while it came down.
 */
const LANE_SETTLE = 6

/*
 * Whether a phone's bar is up, for the shell's toast row. The toasts sit at the
 * foot of the page column, which is where the bar floats on a phone, and they
 * are drawn later: a "Continue from Mac" over the bar took the presses meant
 * for its More. Counted rather than a flag, so a screen leaving as the next
 * one's bar arrives cannot switch it off under the new one.
 */
let floatingOnPhone = 0

/**
 * How far a phone's bar is up: 0 with no bar, 1 with one landed, and the rise
 * and the sink in between. The bar plays its own rise from its own value; this
 * is the same move published for anything that has to step aside for it — the
 * shell's toast row (`Shell`). Started here rather than by the bar so that two screens
 * overlapping mid-transition cannot fight over it, and on the same lengths and
 * curves as the bar's own, so the two are in step.
 *
 * On the native driver, as everything that moves in space is: ride it with a
 * `translateY`, not with a `bottom`, which cannot be driven from there.
 */
export const selectionBarLift = new Animated.Value(0)

const setFloating = (change: 1 | -1): void => {
  const was = floatingOnPhone
  floatingOnPhone += change
  if (was === 0 && floatingOnPhone > 0) {
    timing(selectionBarLift, 1, MOVE_MS.sheetUp, undefined, { easing: ease.overshoot })
  } else if (was > 0 && floatingOnPhone === 0) {
    timing(selectionBarLift, 0, MOVE_MS.sheetDown, undefined, { easing: ease.in })
  }
}

/**
 * The bar that runs a multi-selection.
 *
 * On a computer it takes a lane of its own at the top of the list area: the
 * list below it is that much shorter, so at no scroll position does the bar
 * cover a row. It floated over the list once, to keep the rows still as it
 * arrived — but the row it landed on was the one you had just ticked, which
 * you could then neither read nor untick, so overlaying the list is not on
 * offer. What is on offer is the lane opening rather than appearing: the room
 * grows from nothing to the bar's height over `motion.base` and closes again
 * over `motion.fast`, and the bar comes down into it. The room is a height, so
 * it is the one thing here on the JavaScript side (as the up-next rail's room
 * is, and for the same reason); the bar's own fade and settle are transforms
 * and opacity, on the native driver. The lane is measured rather than guessed,
 * so it is always exactly as tall as the bar really is.
 *
 * It sits where the eye already is while ticking and where nothing else
 * competes (the foot of the window has the player bar and the toasts). It is
 * anchored by the count,
 * because the count is what you have to be sure of before pressing anything
 * else, and by a tri-state checkbox beside a line that says in words what
 * "all" currently means. Select-all while a search or filter is on selects the
 * filtered set, and the bar says so.
 *
 * On a phone it still floats, at the bottom, above the mini player or the tabs, where
 * a thumb is: the count, then Play, Queue, More and Done as icons on one line.
 * Select all and a playlist's Remove move into More there.
 *
 * It rises from under its place there with the same four points of overshoot
 * every sheet has, sinks back on `ease.in`, and is kept up until the sink has
 * landed (`usePresence`): a bar that pops in and out reads as a mistake rather
 * than as an answer to what was just ticked.
 *
 * Play and Queue are in the bar because they are harmless and frequent.
 * Everything that edits the library sits behind More — a popover at desktop
 * width, a sheet on a phone — with "remove from library" last and in red, and
 * behind a confirmation.
 */
export function SelectionBar({
  songs,
  total,
  narrowed = false,
  scope,
  allSelected,
  onSelectAll,
  onDeselectAll,
  onDone,
  playlist,
  shown = true,
}: {
  /** The selected songs, in the order the list has them. */
  songs: readonly Song[]
  /** How many rows the list is showing right now. */
  total: number
  /** A search or filter is narrowing the list. */
  narrowed?: boolean
  /** What "all" means here, in words: "in this view", "in your library". */
  scope: string
  allSelected: boolean
  onSelectAll: () => void
  onDeselectAll: () => void
  onDone: () => void
  /** Set in a playlist, which offers removing from it without deleting. */
  playlist?: { readonly id: number; readonly name: string }
  /**
   * Whether the bar belongs on screen. Left out it is simply on screen for as
   * long as it is drawn, which is how a screen that puts it up and takes it
   * down again by mounting it reads; a screen that keeps it mounted and turns
   * this off instead gets the sink as well, because nothing can leave a screen
   * it has already been cut from.
   */
  shown?: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const { wide } = useLayout()
  // Above the tab bar and the mini player, which float over the page on a phone.
  const chrome = useFloatingChrome()
  const { data: library } = useLibrary()
  const player = usePlayer()
  const { state: downloads, queue: downloadQueue, dropDownloads } = useDownloads()

  const bulkTag = useBulkTag()
  const bulkLoved = useBulkLoved()
  const bulkDelete = useBulkDeleteSongs()
  const addToPlaylist = useAddToPlaylist()
  const removeFromPlaylist = useRemoveManyFromPlaylist()

  const [menuOpen, setMenuOpen] = useState(false)
  const [nested, setNested] = useState<'playlists' | 'tag' | 'untag' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const moreRef = useRef<View>(null)

  /*
   * Up while it is asked for, and kept up until the sink has landed. The
   * lengths differ by surface — a computer's lane opens and closes with the
   * page's own `motion.base` and `motion.fast`, a phone's bar rises and sinks
   * like the sheet it is one of — and `usePresence` starts where `shown` says
   * and moves only when it changes, so a screen that draws this already shown
   * gets no rise at all: it has to keep the bar and turn `shown` off and on.
   */
  const { mounted, progress } = usePresence(
    shown,
    wide ? motion.base : MOVE_MS.sheetUp,
    wide ? motion.fast : MOVE_MS.sheetDown,
    wide ? { easeIn: ease.out, easeOut: ease.in } : { easeIn: ease.overshoot, easeOut: ease.in },
  )

  /*
   * How tall the bar is, as laid out: a phone's rise is its own height plus
   * the chrome it comes up from behind, and a computer's lane is exactly it.
   * Until it is known, a phone falls back on the room its list already leaves
   * for it, and a computer opens from nothing and catches up in the same move.
   */
  const [measured, setMeasured] = useState(0)
  const travel = (measured || SELECTION_BAR_SPACE) + chrome + space.sm
  // Rebuilt only when the distance changes, never in the render.
  const rise = useMemo(
    () => ({ transform: [{ translateY: progress.interpolate(overshootRange(travel, 4)) }] }),
    [progress, travel],
  )
  // The lane's fade and its six points of settle: it comes down from under the
  // head, not from its own height above it, which would draw it over whatever
  // the page has above the list.
  const [lane] = useState(() => ({
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-LANE_SETTLE, 0] }) },
    ],
  }))

  /*
   * The room the lane takes from the list. A height is beyond the native
   * driver, and one value cannot be native for the bar's fade and not for this,
   * so the room is a value of its own (`QueueRail` splits the same move the
   * same way). It stays shut while the bar floats instead.
   */
  const [room] = useState(() => new Animated.Value(0))
  useEffect(() => {
    if (!wide) return
    if (shown) timing(room, 1, motion.base, undefined, { easing: ease.out, native: false })
    else timing(room, 0, motion.fast, undefined, { easing: ease.in, native: false })
  }, [wide, shown, room])
  const roomStyle = useMemo(
    () => ({
      height: room.interpolate({
        inputRange: [0, 1],
        outputRange: [0, measured],
        extrapolate: 'clamp' as const,
      }),
    }),
    [room, measured],
  )

  // The toasts step up above the bar while it floats at a phone's foot, and
  // ride `selectionBarLift` down again when it sinks.
  useEffect(() => {
    if (wide || !shown) return undefined
    setFloating(1)
    return () => setFloating(-1)
  }, [wide, shown])

  const count = songs.length
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  const tags = library?.tags ?? []
  // Pinned first; not the playlist this is, and never a live one.
  const manualPlaylists = playlistsToAddTo(library?.playlists ?? []).filter(
    list => list.id !== playlist?.id,
  )
  const router = useRouter()
  const queryClient = useQueryClient()

  /** A playlist of exactly these songs, opened with its name ready to type. */
  const newPlaylistWithSelection = async (): Promise<void> => {
    const taken = new Set((library?.playlists ?? []).map(list => list.name))
    let name = 'New playlist'
    for (let n = 2; taken.has(name); n++) name = `New playlist ${n}`
    try {
      const created = await clientApi().createPlaylist({
        name,
        description: '',
        kind: 'manual',
        rules: null,
      })
      await clientApi().addToPlaylist(created.id, { songIds: ids })
      void queryClient.invalidateQueries({ queryKey: queryKeys.library })
      onDone()
      router.push({ pathname: '/playlists/[id]', params: { id: String(created.id), rename: '1' } })
    } catch (caught) {
      showToast(failureText('Couldn’t make the playlist', caught), 'error')
    }
  }

  /** Only tags actually on the selection can be taken off it. */
  const tagsOnSelection = useMemo<Tag[]>(() => {
    const present = new Set<number>()
    for (const song of songs) for (const tagId of song.tagIds) present.add(tagId)
    return (library?.tags ?? []).filter(tag => present.has(tag.id))
  }, [songs, library?.tags])

  const lovedCount = songs.filter(song => song.loved).length
  const held = songs.filter(song => isDownloaded(downloads.index, song.id))
  const songWord = count === 1 ? 'song' : 'songs'
  const totalWord = total === 1 ? 'song' : 'songs'

  const closeMenu = (): void => {
    setMenuOpen(false)
    setNested(null)
  }
  /** Run a menu action, close the menu, and say what happened. */
  const act = (run: () => void, message?: string) => (): void => {
    run()
    closeMenu()
    if (message) showToast(message, 'good')
  }
  const toggleNested = (which: 'playlists' | 'tag' | 'untag') => (): void =>
    setNested(open => (open === which ? null : which))
  const removeSelectedFromPlaylist = (): void => {
    if (!playlist) return
    removeFromPlaylist.mutate({ playlistId: playlist.id, songIds: ids })
    showToast(`Removed ${count} ${songWord} from ${playlist.name}`, 'good')
  }

  const done = (
    <IconButton onPress={onDone} label="Done selecting" testID="selection-done">
      <X size={16} color={theme.colors.textSecondary} />
    </IconButton>
  )
  const countWords = count === 0 ? 'None selected' : `${count} selected`
  const countText = (
    <Text
      style={styles.count}
      accessibilityLiveRegion="polite"
      numberOfLines={1}
      aria-label={countWords}
    >
      {countWords}
    </Text>
  )
  /*
   * The same count on a phone, where the bar is icons and the number is the
   * only word in it: the figure in an accent pill with "selected" beside it,
   * rather than one small grey line adrift in the bar's left half. It is what
   * you check before pressing anything, so it is what the bar is anchored by
   * (Xiao, 2026-09-22).
   */
  const countBadge = (
    // One phrase to anything that reads or looks for it — a screen reader, and
    // the flow that checks the count — while the eye gets the figure and the
    // word as two things.
    <View
      style={styles.countRow}
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={countWords}
      aria-label={countWords}
    >
      {count === 0 ? (
        <Text style={styles.countWord}>None selected</Text>
      ) : (
        <>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{count}</Text>
          </View>
          <Text style={styles.countWord}>selected</Text>
        </>
      )}
    </View>
  )

  const bar = wide ? (
    <>
      {/* The room, which is all that moves the list: the bar itself is over it. */}
      <Animated.View style={roomStyle} />
      <Animated.View
        style={[styles.laneOver, lane]}
        pointerEvents={shown ? 'box-none' : 'none'}
        onLayout={event => setMeasured(event.nativeEvent.layout.height)}
      >
        <View style={styles.lane}>
          <View
            style={styles.bar}
            role="toolbar"
            aria-label="Selection actions"
            testID="selection-bar"
          >
            <View style={styles.anchor}>
              <Pressable
                style={styles.all}
                onPress={() => (allSelected ? onDeselectAll() : onSelectAll())}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: allSelected ? true : count > 0 ? 'mixed' : false }}
                accessibilityLabel={`${allSelected ? 'Deselect' : 'Select'} all ${total} ${totalWord} ${scope}`}
              >
                <Checkbox checked={allSelected} mixed={!allSelected && count > 0} />
              </Pressable>
              <View style={styles.counts}>
                {countText}
                {allSelected ? (
                  <Text style={styles.scope}>
                    {narrowed ? `every song ${scope}` : `everything ${scope}`}
                  </Text>
                ) : (
                  <Pressable onPress={onSelectAll} accessibilityRole="button">
                    <Text style={[styles.scope, styles.scopeLink]}>
                      Select all {total} {scope}
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>

            <View style={styles.actions}>
              <Button
                label="Play"
                icon={<Play size={13} color={theme.colors.textPrimary} />}
                onPress={() => player.playFrom(ids, 0)}
                disabled={count === 0}
              />
              <Button
                label="Queue"
                icon={<Queue size={13} color={theme.colors.textPrimary} />}
                onPress={() => player.addToQueue(ids)}
                disabled={count === 0}
              />
              {playlist ? (
                <Button
                  label="Remove from playlist"
                  icon={<X size={13} color={theme.colors.textPrimary} />}
                  onPress={removeSelectedFromPlaylist}
                  disabled={count === 0}
                />
              ) : null}
              <View ref={moreRef} collapsable={false}>
                <Button
                  label="More"
                  icon={<More size={13} color={theme.colors.textPrimary} />}
                  onPress={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
                  disabled={count === 0}
                  testID="selection-more"
                />
              </View>
            </View>

            <View style={styles.doneWide}>{done}</View>
          </View>
        </View>
      </Animated.View>
    </>
  ) : (
    <Animated.View
      style={[styles.float, styles.floatBottom, { bottom: chrome + space.sm }, rise]}
      pointerEvents={shown ? 'box-none' : 'none'}
    >
      <View
        style={[styles.bar, styles.barCompact]}
        role="toolbar"
        aria-label="Selection actions"
        testID="selection-bar"
        onLayout={event => setMeasured(event.nativeEvent.layout.height)}
      >
        <View style={styles.countCompact}>{countBadge}</View>
        <IconButton
          onPress={() => player.playFrom(ids, 0)}
          label="Play"
          disabled={count === 0}
          filled
        >
          <Play size={18} color={theme.colors.textPrimary} />
        </IconButton>
        <IconButton onPress={() => player.addToQueue(ids)} label="Queue" disabled={count === 0}>
          <Queue size={18} color={theme.colors.textPrimary} />
        </IconButton>
        <View ref={moreRef} collapsable={false}>
          <IconButton
            onPress={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
            label="More"
            active={menuOpen}
            testID="selection-more"
          >
            <More size={18} color={theme.colors.textPrimary} />
          </IconButton>
        </View>
        {/* Done is leaving, not another thing to do to the songs. */}
        <View style={styles.leave} />
        {done}
      </View>
    </Animated.View>
  )

  // Nothing at all once it has sunk: until then `usePresence` keeps it up, so
  // the sink has somewhere to play.
  if (!mounted) return null

  return (
    <>
      {bar}

      <Popover
        open={menuOpen}
        onClose={closeMenu}
        anchorRef={moreRef}
        title={`${count} ${songWord} selected`}
        width={280}
        testID="selection-menu"
      >
        {/* A sheet carries the count as its title; an anchored panel has none. */}
        {wide ? (
          <Text style={styles.menuTitle} numberOfLines={1}>
            {count} {songWord} selected
          </Text>
        ) : null}
        {count > 0 ? (
          <Text style={styles.summary} numberOfLines={1}>
            {summarise(songs)}
          </Text>
        ) : null}

        {/* On a phone the bar has no room for the checkbox, so all is chosen here. */}
        {wide ? null : (
          <>
            <SheetItem
              icon={<CheckSquare size={15} color={theme.colors.textSecondary} />}
              label={
                allSelected
                  ? `Deselect all ${total} ${totalWord}`
                  : `Select all ${total} ${totalWord} ${scope}`
              }
              onPress={act(allSelected ? onDeselectAll : onSelectAll)}
            />
            {playlist && count > 0 ? (
              <SheetItem
                icon={<X size={15} color={theme.colors.textSecondary} />}
                label="Remove from playlist"
                onPress={act(removeSelectedFromPlaylist)}
              />
            ) : null}
            {count > 0 ? <View style={styles.groupGap} /> : null}
          </>
        )}

        {count === 0 ? null : (
          <>
            {lovedCount < count ? (
              <SheetItem
                icon={<Heart size={15} color={theme.colors.textSecondary} />}
                label={`Love ${count - lovedCount === count ? 'all' : 'the rest'}`}
                onPress={act(
                  () => bulkLoved.mutate({ songIds: ids, loved: true }),
                  `Loved ${plural(count - lovedCount, 'song', 'songs')}`,
                )}
              />
            ) : null}
            {lovedCount > 0 ? (
              <SheetItem
                icon={<Heart size={15} filled color={theme.colors.danger} />}
                label={`Remove ${lovedCount === count ? 'all' : lovedCount} from loved`}
                onPress={act(
                  () => bulkLoved.mutate({ songIds: ids, loved: false }),
                  `Removed ${lovedCount} from loved`,
                )}
              />
            ) : null}

            <View style={styles.groupGap} />

            <SheetItem
              icon={<ListMusic size={15} color={theme.colors.textSecondary} />}
              label="Add to playlist…"
              active={nested === 'playlists'}
              onPress={toggleNested('playlists')}
            />
            {nested === 'playlists' ? (
              <View style={styles.nested}>
                <SheetItem
                  icon={<Plus size={15} color={theme.colors.textSecondary} />}
                  label={`New playlist with ${count} ${songWord}`}
                  onPress={() => {
                    closeMenu()
                    void newPlaylistWithSelection()
                  }}
                />
                {manualPlaylists.map(list => (
                  <SheetItem
                    key={list.id}
                    label={list.name}
                    onPress={act(
                      () => addToPlaylist.mutate({ playlistId: list.id, songIds: ids }),
                      `Added ${count} ${songWord} to ${list.name}`,
                    )}
                  />
                ))}
              </View>
            ) : null}

            {tags.length > 0 ? (
              <SheetItem
                icon={<TagIcon size={15} color={theme.colors.textSecondary} />}
                label="Add tag…"
                active={nested === 'tag'}
                onPress={toggleNested('tag')}
              />
            ) : null}
            {nested === 'tag' ? (
              <View style={styles.nested}>
                {tags.map(tag => (
                  <SheetItem
                    key={tag.id}
                    label={tag.name}
                    onPress={act(
                      () => bulkTag.mutate({ songIds: ids, tagId: tag.id, action: 'add' }),
                      `Tagged ${count} ${songWord} “${tag.name}”`,
                    )}
                  />
                ))}
              </View>
            ) : null}

            {tagsOnSelection.length > 0 ? (
              <SheetItem
                icon={<TagIcon size={15} color={theme.colors.textSecondary} />}
                label="Remove tag…"
                active={nested === 'untag'}
                onPress={toggleNested('untag')}
              />
            ) : null}
            {nested === 'untag' ? (
              <View style={styles.nested}>
                {tagsOnSelection.map(tag => (
                  <SheetItem
                    key={tag.id}
                    label={tag.name}
                    onPress={act(
                      () => bulkTag.mutate({ songIds: ids, tagId: tag.id, action: 'remove' }),
                      `Removed “${tag.name}” from ${count} ${songWord}`,
                    )}
                  />
                ))}
              </View>
            ) : null}

            <View style={styles.groupGap} />

            {held.length < count ? (
              <SheetItem
                icon={<CloudDownload size={15} color={theme.colors.textSecondary} />}
                label={`Download ${held.length > 0 ? 'the rest' : 'all'}`}
                onPress={act(() => downloadQueue.enqueue(ids))}
              />
            ) : null}
            {held.length > 0 ? (
              <SheetItem
                icon={<X size={15} color={theme.colors.textSecondary} />}
                label={`Remove ${held.length === count ? '' : `${held.length} `}${
                  held.length === 1 ? 'download' : 'downloads'
                }`}
                onPress={act(() => {
                  const removing = held.length
                  void downloadQueue
                    .remove(held.map(song => song.id))
                    .then(() =>
                      showToast(`Removed ${plural(removing, 'download', 'downloads')}`, 'good'),
                    )
                })}
              />
            ) : null}

            <View style={styles.groupGap} />

            <SheetItem
              icon={<Trash size={15} color={theme.colors.danger} />}
              label={`Remove ${count} ${songWord} from library…`}
              danger
              onPress={() => {
                closeMenu()
                setDeleteError(null)
                setConfirming(true)
              }}
            />
          </>
        )}
      </Popover>

      {confirming ? (
        <ConfirmRemoveSongs
          songs={songs}
          pending={bulkDelete.isPending}
          error={deleteError}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            // The copies here go now rather than after the answer: the counts
            // that name these songs are drawn from the library and the index,
            // and both have to lose them at the same moment.
            void dropDownloads(ids)
            bulkDelete.mutate(
              { songIds: ids },
              {
                onSuccess: result => {
                  setConfirming(false)
                  onDone()
                  // The summary: what went, and what did not.
                  const parts = [`Removed ${plural(result.removed, 'song', 'songs')}`]
                  const trouble = result.failed.length
                  if (trouble > 0) parts.push(`${trouble} needed attention`)
                  showToast(
                    trouble > 0
                      ? `${parts.join(', ')} — ${result.failed[0]?.reason ?? 'see the server log'}`
                      : parts.join(', '),
                    trouble > 0 ? 'warn' : 'good',
                  )
                },
                onError: error => setDeleteError(error.message),
              },
            )
          }}
        />
      ) : null}
    </>
  )
}

/** "Aurora Lane · Klara Feld and 2 more" — enough to recognise the selection. */
function summarise(songs: readonly Song[]): string {
  const artists = [...new Set(songs.map(song => song.artist || 'Unknown artist'))]
  if (artists.length <= 2) return artists.join(' · ')
  return `${artists.slice(0, 2).join(' · ')} and ${artists.length - 2} more`
}

const styles = StyleSheet.create(theme => ({
  /* A computer's lane: above the list, so the list is shorter and nothing is covered. */
  lane: { paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.sm },
  /*
   * Where the lane is drawn: over the head of the list area, while the room
   * below it opens to exactly its height. Absolute so that the room's height is
   * the only thing that moves the list, and so the lane can be measured at its
   * own size rather than at whatever the room has opened to so far. Above the
   * rows it is briefly over on the first selection of a session, before the
   * room it will sit in has been measured.
   */
  laneOver: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 4 },
  /* A phone's bar floats instead, over the foot of the list, where a thumb is. */
  float: {
    position: 'absolute',
    zIndex: 5,
  },
  /* The foot itself is worked out per screen, above the player bar and the tab bar. */
  floatBottom: { left: space.sm, right: space.sm },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.card,
    // Lifted off the rows it covers, so it reads as over them rather than one of them.
    ...floating(theme.colors),
  },
  // Room between the icons, and a tone of its own: at `surface2` the bar and
  // the mini player under it were two identical slabs.
  barCompact: {
    gap: 6,
    paddingVertical: 7,
    paddingLeft: space.sm,
    paddingRight: 6,
    backgroundColor: theme.colors.surface3,
  },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 },
  countPill: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillText: {
    color: theme.colors.onAccent,
    fontSize: 12.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  countWord: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '500' },
  leave: { width: 1, height: 20, backgroundColor: theme.colors.border, marginHorizontal: 1 },
  anchor: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0, flexShrink: 1 },
  all: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  counts: { minWidth: 0 },
  countCompact: { flex: 1, minWidth: 0 },
  count: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  scope: { color: theme.colors.textMuted, fontSize: 11 },
  scopeLink: { textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 },
  doneWide: { marginLeft: 'auto' },
  menuTitle: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: space.md,
    paddingTop: space.xs,
  },
  summary: {
    color: theme.colors.textMuted,
    fontSize: 12,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  // The menu's groups are set apart by room, not a rule.
  groupGap: { height: space.sm },
  nested: { paddingLeft: space.lg },
}))
