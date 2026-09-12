import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Song, Tag } from '@selfmp3/shared'
import { colors, isDownloaded, oklchToHexAlpha, radius, space } from '@selfmp3/client'
import {
  useAddToPlaylist,
  useBulkDeleteSongs,
  useBulkLoved,
  useBulkTag,
  useLibrary,
  useRemoveManyFromPlaylist,
} from '../../api/queries'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../accent'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { ConfirmRemoveSongs } from './ConfirmRemoveSongs'
import { IconButton } from './IconButton'
import {
  CloudDownload,
  Heart,
  ListMusic,
  More,
  Play,
  Queue,
  Tag as TagIcon,
  Trash,
  X,
} from './Icons'
import { Popover } from './Popover'
import { SheetItem } from './Sheet'

/**
 * The bar that runs a multi-selection: the web's `SelectionBar`.
 *
 * Anchored by the count, because the count is what you have to be sure of
 * before pressing anything else, and by a tri-state checkbox beside a line
 * that says in words what "all" currently means. Select-all while a search or
 * filter is on selects the filtered set, and the bar says so.
 *
 * Play and Queue are in the bar because they are harmless and frequent.
 * Everything that edits the library sits behind More — a popover at desktop
 * width, a sheet on a phone — with "remove from library" last and in red, and
 * behind a confirmation.
 *
 * At phone width it is exactly two lines, as on the web: what is selected and
 * Done, then what can be done to it, every button keeping its label.
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
  const { wide } = useLayout()
  const accent = useAccent()
  const { data: library } = useLibrary()
  const player = usePlayer()
  const { state: downloads, queue: downloadQueue } = useDownloads()

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

  const count = songs.length
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  const tags = library?.tags ?? []
  const manualPlaylists = (library?.playlists ?? []).filter(list => list.kind === 'manual')

  /** Only tags actually on the selection can be taken off it. */
  const tagsOnSelection = useMemo<Tag[]>(() => {
    const present = new Set<number>()
    for (const song of songs) for (const tagId of song.tagIds) present.add(tagId)
    return (library?.tags ?? []).filter(tag => present.has(tag.id))
  }, [songs, library?.tags])

  const lovedCount = songs.filter(song => song.loved).length
  const held = songs.filter(song => isDownloaded(downloads.index, song.id))
  const songWord = count === 1 ? 'song' : 'songs'
  const accentDim = oklchToHexAlpha(0.42, 0.1, accent.hue, 1)

  const closeMenu = (): void => {
    setMenuOpen(false)
    setNested(null)
  }
  const act = (run: () => void) => (): void => {
    run()
    closeMenu()
  }
  const toggleNested = (which: 'playlists' | 'tag' | 'untag') => (): void =>
    setNested(open => (open === which ? null : which))

  const done = (
    <IconButton onPress={onDone} label="Done selecting" testID="selection-done">
      <X size={16} color={colors.textSecondary} />
    </IconButton>
  )

  return (
    <>
      <View
        style={[styles.bar, { borderColor: accentDim }]}
        role="toolbar"
        aria-label="Selection actions"
        testID="selection-bar"
      >
        <View style={[styles.anchor, !wide && styles.anchorCompact]}>
          <Pressable
            style={styles.all}
            onPress={() => (allSelected ? onDeselectAll() : onSelectAll())}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: allSelected ? true : count > 0 ? 'mixed' : false }}
            accessibilityLabel={`${allSelected ? 'Deselect' : 'Select'} all ${total} ${
              total === 1 ? 'song' : 'songs'
            } ${scope}`}
          >
            <Checkbox checked={allSelected} mixed={!allSelected && count > 0} />
          </Pressable>
          <View style={styles.counts}>
            <Text style={styles.count} accessibilityLiveRegion="polite">
              {count === 0 ? 'None selected' : `${count} selected`}
            </Text>
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

        {wide ? null : done}

        <View style={[styles.actions, !wide && styles.actionsCompact]}>
          <Button
            label="Play"
            icon={<Play size={13} color={colors.textPrimary} />}
            onPress={() => player.playFrom(ids, 0)}
            disabled={count === 0}
            grow={!wide}
          />
          <Button
            label="Queue"
            icon={<Queue size={13} color={colors.textPrimary} />}
            onPress={() => player.addToQueue(ids)}
            disabled={count === 0}
            grow={!wide}
          />
          {playlist ? (
            <Button
              label={wide ? 'Remove from playlist' : 'Remove'}
              icon={<X size={13} color={colors.textPrimary} />}
              onPress={() => removeFromPlaylist.mutate({ playlistId: playlist.id, songIds: ids })}
              disabled={count === 0}
              grow={!wide}
            />
          ) : null}
          <View ref={moreRef} collapsable={false} style={!wide && styles.grow}>
            <Button
              label="More"
              icon={<More size={13} color={colors.textPrimary} />}
              onPress={() => (menuOpen ? closeMenu() : setMenuOpen(true))}
              disabled={count === 0}
              grow={!wide}
              testID="selection-more"
            />
          </View>
        </View>

        {wide ? <View style={styles.doneWide}>{done}</View> : null}
      </View>

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
        <Text style={styles.summary} numberOfLines={1}>
          {summarise(songs)}
        </Text>

        {lovedCount < count ? (
          <SheetItem
            icon={<Heart size={15} color={colors.textSecondary} />}
            label={`Love ${count - lovedCount === count ? 'all' : 'the rest'}`}
            onPress={act(() => bulkLoved.mutate({ songIds: ids, loved: true }))}
          />
        ) : null}
        {lovedCount > 0 ? (
          <SheetItem
            icon={<Heart size={15} filled color={colors.danger} />}
            label={`Remove ${lovedCount === count ? 'all' : lovedCount} from loved`}
            onPress={act(() => bulkLoved.mutate({ songIds: ids, loved: false }))}
          />
        ) : null}

        <View style={styles.divider} />

        <SheetItem
          icon={<ListMusic size={15} color={colors.textSecondary} />}
          label="Add to playlist…"
          active={nested === 'playlists'}
          onPress={toggleNested('playlists')}
        />
        {nested === 'playlists' ? (
          <View style={styles.nested}>
            {manualPlaylists.length === 0 ? (
              <Text style={styles.hint}>No playlists yet.</Text>
            ) : (
              manualPlaylists.map(list => (
                <SheetItem
                  key={list.id}
                  label={list.name}
                  onPress={act(() => addToPlaylist.mutate({ playlistId: list.id, songIds: ids }))}
                />
              ))
            )}
          </View>
        ) : null}

        {tags.length > 0 ? (
          <SheetItem
            icon={<TagIcon size={15} color={colors.textSecondary} />}
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
                onPress={act(() => bulkTag.mutate({ songIds: ids, tagId: tag.id, action: 'add' }))}
              />
            ))}
          </View>
        ) : null}

        {tagsOnSelection.length > 0 ? (
          <SheetItem
            icon={<TagIcon size={15} color={colors.textSecondary} />}
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
                onPress={act(() =>
                  bulkTag.mutate({ songIds: ids, tagId: tag.id, action: 'remove' }),
                )}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.divider} />

        {held.length < count ? (
          <SheetItem
            icon={<CloudDownload size={15} color={colors.textSecondary} />}
            label={`Download ${held.length > 0 ? 'the rest' : 'all'} for offline`}
            onPress={act(() => downloadQueue.enqueue(ids))}
          />
        ) : null}
        {held.length > 0 ? (
          <SheetItem
            icon={<X size={15} color={colors.textSecondary} />}
            label={`Remove ${held.length === count ? '' : `${held.length} `}${
              held.length === 1 ? 'download' : 'downloads'
            }`}
            onPress={act(() => void downloadQueue.remove(held.map(song => song.id)))}
          />
        ) : null}

        <View style={styles.divider} />

        <SheetItem
          icon={<Trash size={15} color={colors.danger} />}
          label={`Remove ${count} ${songWord} from library…`}
          danger
          onPress={() => {
            closeMenu()
            setDeleteError(null)
            setConfirming(true)
          }}
        />
      </Popover>

      {confirming ? (
        <ConfirmRemoveSongs
          songs={songs}
          pending={bulkDelete.isPending}
          error={deleteError}
          onCancel={() => setConfirming(false)}
          onConfirm={deleteFile =>
            bulkDelete.mutate(
              { songIds: ids, deleteFile },
              {
                onSuccess: () => {
                  setConfirming(false)
                  onDone()
                },
                onError: error => setDeleteError(error.message),
              },
            )
          }
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

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.sm,
    padding: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  anchor: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  anchorCompact: { flexGrow: 1, flexShrink: 1 },
  all: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  counts: { minWidth: 0 },
  count: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  scope: { color: colors.textMuted, fontSize: 11 },
  scopeLink: { textDecorationLine: 'underline' },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 },
  actionsCompact: { flexBasis: '100%', flexGrow: 1 },
  /* The same basis as the buttons beside it, so the three share the line evenly. */
  grow: { flex: 1 },
  doneWide: { marginLeft: 'auto' },
  menuTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: space.md,
    paddingTop: space.xs,
  },
  summary: {
    color: colors.textMuted,
    fontSize: 12,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space.xs },
  nested: { paddingLeft: space.lg },
  hint: { color: colors.textMuted, fontSize: 12, padding: space.md },
})
