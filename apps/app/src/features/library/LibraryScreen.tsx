import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { type Song, type Tag } from '@selfmp3/shared'
import { useToggleLoved } from '../../api/queries'
import { useArt } from '../../offline/useArt'
import { isDownloaded, HIT_TARGET, radius, space, type } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { CheckSquare, Downloaded, Play, Search, Shuffle, X } from '../../ui/components/Icons'
import { SelectionBar } from '../../ui/components/SelectionBar'
import { SongMenu } from '../../ui/components/SongMenu'
import { Select } from '../../ui/components/Select'
import { SongList } from '../../ui/components/SongList'
import { SongRow } from '../../ui/components/SongRow'
import { SyncStatus } from '../../ui/components/SyncStatus'
import { GemsRow } from './GemsRow'
import { TagEditor } from '../../ui/components/TagEditor'
import { TagPicker } from '../../ui/components/TagPicker'
import { modifiersOf, useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { useContentWidth } from '../../shell/contentWidth'
import { useLibraryModel } from './library.model'

/**
 * The library: the web's phone layout, on the phone.
 *
 * The header is the web's `.view-head`: the title and a count, the search on
 * a line of its own, then order and play sharing the next. Under it the tag
 * strip, which is the sidebar's tag list folded into a row. All of the
 * filtering runs over the full in-memory list, exactly as on the web — the
 * whole library arrives in one response, so a keystroke costs one pass over
 * an array and no round trip.
 */
export function LibraryScreen(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { wide, dense } = useLayout()
  // One row needs about 760 points: title, search, order and play. An iPad's
  // column beside the sidebar is 590, so there it stacks as a phone's does.
  // Before the column is measured the row is kept, so a desktop never flashes.
  const contentWidth = useContentWidth()
  const headWide = wide && (contentWidth === null || contentWidth >= HEAD_ROW_WIDTH)
  const player = usePlayer()
  const toggleLoved = useToggleLoved()
  const { state: downloads, installed } = useDownloads()

  // Everything this screen knows is in the model, which draws nothing and is
  // tested without a simulator. What is left here is drawing.
  const model = useLibraryModel(downloads.index)
  const { filter, songs, visible, songIds, tags, heading, includeTag } = model

  const [menuSong, setMenuSong] = useState<Song | null>(null)
  // The ⋯ the menu was opened from, so at desktop width it opens beside it.
  const menuAnchorRef = useRef<View | null>(null)
  // The dashed + in a row's tag column opens the same picker the menu does.
  const [taggingSong, setTaggingSong] = useState<Song | null>(null)
  const tagById = useMemo(() => new Map(tags.map(tag => [tag.id, tag])), [tags])
  // Holding a chip opens its editor, as on the web's phone strip. A sheet on a
  // phone; above the breakpoint it opens beside the strip.
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const stripRef = useRef<View>(null)

  // Multi-select runs off the visible list, so "select all" means the songs on
  // screen and a song a search has hidden drops out of the selection rather
  // than being acted on with the rest.
  const selection = useSelection(songIds)
  const selectedSongs = useMemo(
    () => visible.filter(song => selection.has(song.id)),
    [visible, selection],
  )
  const narrowed = model.tagFiltered || filter.query.trim().length > 0 || filter.downloadedOnly

  const downloaded = useCallback(
    (songId: number) => isDownloaded(downloads.index, songId),
    [downloads.index],
  )

  const artFor = useArt()
  const currentId = player.current?.id ?? null
  const playing = player.isPlaying

  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <SongRow
        testID={`song-row-${index}`}
        song={item}
        artUri={artFor(item)}
        active={currentId === item.id}
        playing={playing}
        downloaded={downloaded(item.id)}
        notDownloadedMark={installed && !downloaded(item.id)}
        onPress={event => {
          // Shift and Cmd on the web, and a tap in selection mode, select; a
          // plain tap still plays.
          if (selection.click(item.id, modifiersOf(event))) return
          player.playFrom(songIds, index)
        }}
        onMore={anchor => {
          menuAnchorRef.current = anchor
          setMenuSong(item)
        }}
        onToggleLoved={() => toggleLoved.mutate({ id: item.id, loved: !item.loved })}
        selecting={selection.active}
        selected={selection.has(item.id)}
        onToggleSelect={() => selection.toggle(item.id)}
        index={index}
        tags={item.tagIds.flatMap(id => {
          const tag = tagById.get(id)
          return tag ? [tag] : []
        })}
        onToggleTag={includeTag}
        onEditTags={() => setTaggingSong(item)}
      />
    ),
    [
      installed,
      artFor,
      currentId,
      playing,
      songIds,
      downloaded,
      player,
      toggleLoved,
      selection,
      tagById,
      includeTag,
    ],
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']} testID="library-screen">
      {/*
        The web's `.view-head`. On a phone: the title, then the search on a line
        of its own, then order and play. At desktop width it is one row — the
        title on the left, and search, order and play along from it, with the
        search giving up width before the row wraps.
      */}
      <View style={[styles.head, headWide && styles.headWide]}>
        <View style={headWide ? styles.titlesWide : undefined}>
          <Text style={styles.heading} numberOfLines={1} accessibilityRole="header">
            {heading}
          </Text>
          <Text style={styles.sub}>{model.subtitle}</Text>
        </View>

        <View style={[styles.controls, headWide && styles.controlsWide]}>
          <View style={[styles.searchBox, headWide && styles.searchWide, dense && styles.searchDense]}>
            <Search size={15} color={theme.colors.textMuted} />
            <TextInput
              style={styles.search}
              value={filter.query}
              onChangeText={model.setQuery}
              placeholder="Search"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search library"
            />
            {filter.query ? (
              <Pressable
                onPress={model.clearQuery}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <X size={13} color={theme.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <View style={[styles.actions, headWide && styles.actionsWide]}>
            <View style={[styles.sortSlot, headWide && styles.sortSlotWide]}>
              <Select
                value={filter.sort}
                options={model.sortOptions.map(option => ({
                  value: option.field,
                  label: option.label,
                }))}
                onChange={model.setSort}
                label="Sort by"
                testID="library-sort"
              />
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.direction,
                dense && styles.directionDense,
                pressed && styles.sortButtonPressed,
              ]}
              onPress={model.toggleDirection}
              accessibilityRole="button"
              accessibilityLabel={filter.descending ? 'Sort ascending' : 'Sort descending'}
            >
              <Text style={styles.directionArrow}>{filter.descending ? '↓' : '↑'}</Text>
            </Pressable>

            <View style={[styles.transport, headWide ? styles.transportWide : styles.transportCompact]}>
              {/*
              The way in, on every device: multi-select used to be reachable
              only by knowing that Cmd-click did something.
            */}
              <Button
                label={selection.active ? 'Done' : 'Select'}
                active={selection.active}
                icon={<CheckSquare size={15} color={theme.colors.textPrimary} />}
                disabled={visible.length === 0}
                onPress={() => (selection.active ? selection.clear() : selection.enter())}
                testID="library-select"
              />
              <Button
                label="Play"
                icon={<Play size={15} color={theme.colors.onAccent} />}
                variant="primary"
                disabled={visible.length === 0}
                onPress={() => player.playFrom(songIds, 0, false)}
              />
              {/* Worded at desktop width, as on the web; an icon on a phone. */}
              <Button
                label={wide ? 'Shuffle' : undefined}
                icon={<Shuffle size={15} color={theme.colors.textPrimary} />}
                disabled={visible.length === 0}
                onPress={() => player.playShuffled(songIds)}
              />
            </View>
          </View>
        </View>
      </View>

      {/* At desktop width the sidebar carries the tags, as on the web. */}
      {!wide && (tags.length > 0 || songs.length > 0) ? (
        <View ref={stripRef} collapsable={false}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tagStripFrame}
            contentContainerStyle={styles.tagStrip}
            keyboardShouldPersistTaps="handled"
          >
            <Chip
              label="On this phone"
              selected={filter.downloadedOnly}
              icon={
                <Downloaded
                  size={12}
                  color={
                    filter.downloadedOnly ? theme.colors.textPrimary : theme.colors.textSecondary
                  }
                  knockout={theme.colors.surface1}
                />
              }
              onPress={model.toggleDownloadedOnly}
            />
            {tags.map((tag, index) => {
              const state = model.tagFilter(tag.id)
              return (
                <Chip
                  key={tag.id}
                  testID={`tag-chip-${index}`}
                  label={tag.name}
                  hue={tag.hue}
                  selected={state === 'include'}
                  excluded={state === 'exclude'}
                  // A tap on a hidden tag stops hiding it; otherwise a tap shows
                  // only it — the web's strip.
                  onPress={() =>
                    state === 'exclude' ? model.excludeTag(tag.id) : model.includeTag(tag.id)
                  }
                  onLongPress={() => setEditingTag(tag)}
                />
              )
            })}
          </ScrollView>
        </View>
      ) : null}

      {model.tagFiltered ? (
        <View style={styles.activeFilters}>
          <Text style={styles.filteredBy}>Filtered by</Text>
          {model.includedTags.map(tag => (
            <Chip
              key={tag.id}
              compact
              label={tag.name}
              hue={tag.hue}
              selected
              onPress={() => model.excludeTag(tag.id)}
              onRemove={() => model.includeTag(tag.id)}
            />
          ))}
          {model.excludedTags.map(tag => (
            <Chip
              key={tag.id}
              compact
              label={tag.name}
              hue={tag.hue}
              selected={false}
              excluded
              onPress={() => model.includeTag(tag.id)}
              onRemove={() => model.excludeTag(tag.id)}
            />
          ))}
          <Pressable onPress={model.clearTags} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.clear, { color: accent.accent }]}>clear</Text>
          </Pressable>
        </View>
      ) : null}

      {model.tagFiltered || filter.query.trim() ? null : <GemsRow />}

      <SyncStatus />

      {selection.active ? (
        <SelectionBar
          songs={selectedSongs}
          total={visible.length}
          narrowed={narrowed}
          scope={narrowed ? 'in this view' : 'in your library'}
          allSelected={selection.allSelected}
          onSelectAll={selection.selectAll}
          onDeselectAll={selection.deselectAll}
          onDone={selection.clear}
        />
      ) : null}

      {model.loading ? (
        <ActivityIndicator style={styles.spinner} color={accent.accent} />
      ) : (
        <SongList
          songs={visible}
          label={`${heading} songs`}
          renderSong={renderSong}
          contentContainerStyle={styles.list}
          empty={<Text style={styles.empty}>{EMPTY_TEXT[model.emptyReason ?? 'no-matches']}</Text>}
        />
      )}

      <TagEditor
        tag={editingTag}
        anchorRef={stripRef}
        filter={editingTag ? model.tagFilter(editingTag.id) : 'off'}
        onInclude={() => editingTag && model.includeTag(editingTag.id)}
        onExclude={() => editingTag && model.excludeTag(editingTag.id)}
        onDeleted={() => {
          if (!editingTag) return
          const state = model.tagFilter(editingTag.id)
          if (state === 'include') model.includeTag(editingTag.id)
          if (state === 'exclude') model.excludeTag(editingTag.id)
        }}
        onClose={() => setEditingTag(null)}
      />

      <TagPicker song={taggingSong} onClose={() => setTaggingSong(null)} />

      <SongMenu
        song={menuSong}
        anchorRef={menuAnchorRef}
        onClose={() => setMenuSong(null)}
        onStartSelecting={song => selection.enter(song.id)}
      />
    </SafeAreaView>
  )
}

/**
 * One sentence per reason the list is empty. The model decides which; this only
 * knows how to say it.
 */
const EMPTY_TEXT = {
  unreachable: 'Could not reach the server, and nothing is cached yet.',
  'no-library': 'Nothing here yet. Import a song on the Mac and it turns up here.',
  'no-matches': 'Nothing matches.',
} as const

/** The narrowest page column that takes the header on one row. */
const HEAD_ROW_WIDTH = 760

const styles = StyleSheet.create(theme => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  head: {
    paddingHorizontal: space.lg,
    paddingTop: 18,
    gap: space.md,
  },
  heading: {
    color: theme.colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sub: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: 3,
  },
  headWide: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 20,
    paddingBottom: space.md,
  },
  titlesWide: { flexShrink: 0 },
  controls: { gap: space.md },
  /* `.library-actions`: one line, the search shrinking first. */
  controlsWide: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
  /* With a mouse, the web's control heights: the box 36, the arrow 34 wide. */
  searchDense: { minHeight: 36 },
  directionDense: { width: 34, height: 36 },
  searchWide: { flexGrow: 0, flexShrink: 1, flexBasis: 300, minWidth: 130 },
  actionsWide: { flex: 1, flexWrap: 'nowrap' },
  /* Enough for the longest option: "Recentl…" would tell you nothing. */
  sortSlotWide: { flex: 0, minWidth: 152 },
  transportWide: { marginLeft: 'auto' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
    paddingLeft: 10,
    paddingRight: 10,
    minHeight: HIT_TARGET,
  },
  search: {
    flex: 1,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    paddingVertical: 8,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
  /* The Select fills the space the old sort button had. */
  sortSlot: {
    flex: 1,
    minWidth: 0,
  },
  sortButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    minHeight: HIT_TARGET,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  sortButtonPressed: {
    backgroundColor: theme.colors.surface3,
  },
  sortLabel: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  direction: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  directionArrow: {
    color: theme.colors.textPrimary,
    fontSize: 17,
    lineHeight: 20,
  },
  transport: {
    flexDirection: 'row',
    gap: space.sm,
  },
  /* At phone width Select, Play and Shuffle take a line of their own, at the end of it. */
  transportCompact: {
    flexBasis: '100%',
    justifyContent: 'flex-end',
  },
  // A ScrollView shrinks like anything else in a column; next to a list that
  // takes all the room it was squeezed to nothing, and the chips with it.
  tagStripFrame: {
    flexGrow: 0,
    flexShrink: 0,
  },
  tagStrip: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  /* `.active-filters`: the chips that are filtering, each removable, and clear. */
  activeFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  filteredBy: {
    color: theme.colors.textMuted,
    fontSize: type.small,
  },
  clear: {
    fontSize: type.small,
    textDecorationLine: 'underline',
  },
  list: {
    paddingTop: space.xs,
    paddingBottom: space.md,
  },
  spinner: {
    marginTop: space.xl,
  },
  empty: {
    color: theme.colors.textMuted,
    fontSize: type.body,
    textAlign: 'center',
    marginTop: space.xl,
    paddingHorizontal: space.xl,
    lineHeight: 20,
  },
}))
