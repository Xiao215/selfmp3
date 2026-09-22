import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { plural } from '@selfmp3/shared'
import type { Song, Tag } from '@selfmp3/shared'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import {
  clientApi,
  isDownloaded,
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
import { removingTakesTheCopy } from '../../ports/device'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
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

/*
 * Whether a phone's bar is up, for the shell's toast row. The toasts sit at the
 * foot of the page column, which is where the bar floats on a phone, and they
 * are drawn later: a "Continue from Mac" over the bar took the presses meant
 * for its More. Counted rather than a flag, so a screen leaving as the next
 * one's bar arrives cannot switch it off under the new one.
 */
let floatingOnPhone = 0
const floatingListeners = new Set<() => void>()
const subscribeFloating = (listener: () => void): (() => void) => {
  floatingListeners.add(listener)
  return () => floatingListeners.delete(listener)
}
const setFloating = (change: 1 | -1): void => {
  floatingOnPhone += change
  for (const listener of floatingListeners) listener()
}

/** True while a selection bar floats at the foot of a phone's page. */
export function useSelectionBarFloating(): boolean {
  return useSyncExternalStore(
    subscribeFloating,
    () => floatingOnPhone > 0,
    () => false,
  )
}

/**
 * The bar that runs a multi-selection.
 *
 * On a computer it takes a lane of its own at the top of the list area: the
 * list below it is that much shorter, so at no scroll position does the bar
 * cover a row. It floated over the list once, to keep the rows still as it
 * arrived — but the row it landed on was the one you had just ticked, which
 * you could then neither read nor untick. The rows move down by the bar's
 * height, once, when the first row is ticked; the bar is a plain block above
 * the list, so the lane is always exactly as tall as the bar really is.
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

  // The toasts step up above the bar while it floats at a phone's foot.
  useEffect(() => {
    if (wide) return undefined
    setFloating(1)
    return () => setFloating(-1)
  }, [wide])

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
      showToast(`Couldn’t make the playlist: ${(caught as Error).message}`, 'error')
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
    <View style={styles.lane}>
      <View style={styles.bar} role="toolbar" aria-label="Selection actions" testID="selection-bar">
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
  ) : (
    <View
      style={[styles.float, styles.floatBottom, { bottom: chrome + space.sm }]}
      pointerEvents="box-none"
    >
      <View
        style={[styles.bar, styles.barCompact]}
        role="toolbar"
        aria-label="Selection actions"
        testID="selection-bar"
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
    </View>
  )

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
          takesTheCopy={removingTakesTheCopy}
          onCancel={() => setConfirming(false)}
          onConfirm={deleteFile => {
            // Where removing takes the copy with it, it goes now rather than
            // after the answer: the counts that name these songs are drawn
            // from the library and the index, and both have to lose them at
            // the same moment.
            if (removingTakesTheCopy) void dropDownloads(ids)
            bulkDelete.mutate(
              { songIds: ids, deleteFile },
              {
                onSuccess: result => {
                  setConfirming(false)
                  onDone()
                  // The summary: what went, what was deleted, what did not.
                  const parts = [`Removed ${plural(result.removed, 'song', 'songs')}`]
                  if (result.filesDeleted > 0) {
                    parts.push(`deleted ${plural(result.filesDeleted, 'file', 'files')}`)
                  }
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
  /* A phone's bar floats instead, over the foot of the list, where a thumb is. */
  float: {
    position: 'absolute',
    zIndex: 5,
  },
  floatBottom: { bottom: space.sm, left: space.sm, right: space.sm },
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
