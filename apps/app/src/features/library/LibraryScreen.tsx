import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { type Song } from '@selfmp3/shared'
import { useArt } from '../../offline/useArt'
import { isDownloaded, HIT_TARGET, radius, space, type, useToggleLoved } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { Downloaded, Play, Plus, Search, Shuffle, X } from '../../ui/components/Icons'
import { SELECTION_BAR_SPACE, SelectionBar } from '../../ui/components/SelectionBar'
import { SongMenu } from '../../ui/components/SongMenu'
import { Select } from '../../ui/components/Select'
import { SongList } from '../../ui/components/SongList'
import { SongRow, useSongRowHeight } from '../../ui/components/SongRow'
import { SyncStatus } from '../../ui/components/SyncStatus'
import { CantReach } from './CantReach'
import { GemsRow } from './GemsRow'
import { PendingImports } from './PendingImports'
import { useConnection } from '../../connection/ConnectionProvider'
import { ListenTags } from '../../ui/components/ListenTags'
import { TagPicker } from '../../ui/components/TagPicker'
import { modifiersOf, useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { useContentWidth } from '../../shell/contentWidth'
import { noMatchesTitle, useLibraryModel } from './library.model'
import { noteTagUsed } from './recentTags.store'
import { closeTagSearch, openTagSearch, useTagSearchOpen } from './tagSearch.store'
import { useSaveTagsAsPlaylist } from './saveTags'
import { usePullToRefresh } from './usePullToRefresh'
import { tip } from '../../ui/tip'

/**
 * The library, at every width.
 *
 * The header holds the title and a count, the search on a line of its own,
 * then order and play sharing the next. Under it the tag strip, which is the
 * sidebar's tag list folded into a row. All of the filtering runs over the
 * full in-memory list — the whole library arrives in one response, so a
 * keystroke costs one pass over an array and no round trip.
 */
export function LibraryScreen(): ReactNode {
  const { fromCloud } = useConnection()
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { wide, dense } = useLayout()
  // One row needs about 600 points once Shuffle is an icon: title, search, order
  // and shuffle, the search giving up width first. An iPad's column beside the
  // sidebar is 590, so there it stacks as a phone's does. Before the column is
  // measured the row is kept, so a desktop never flashes.
  const contentWidth = useContentWidth()
  const headWide = wide && (contentWidth === null || contentWidth >= HEAD_ROW_WIDTH)
  const shuffleIconOnly = contentWidth !== null && contentWidth < SHUFFLE_LABEL_WIDTH
  const player = usePlayer()
  const toggleLoved = useToggleLoved()
  const { state: downloads, installed } = useDownloads()

  // Everything this screen knows is in the model, which draws nothing and is
  // tested without a simulator. What is left here is drawing.
  const model = useLibraryModel(downloads.index)
  const pull = usePullToRefresh()
  const { filter, songs, visible, songIds, songTags } = model

  const [searchFocused, setSearchFocused] = useState(false)
  const [menuSong, setMenuSong] = useState<Song | null>(null)
  // The ⋯ the menu was opened from, so at desktop width it opens beside it.
  const menuAnchorRef = useRef<View | null>(null)
  // The + the tag window was opened from, for the same reason.
  const tagAnchorRef = useRef<View | null>(null)
  // Which tags to listen to — a different job from the picker above, which
  // puts tags on a song. Open/closed lives in a store, because the sidebar's
  // "All 13 tags…" opens this same panel.
  const choosingTags = useTagSearchOpen()
  useEffect(() => closeTagSearch, [])
  // The dashed + in a row's tag column opens the same picker the menu does.
  const [taggingSong, setTaggingSong] = useState<Song | null>(null)

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
  const rowHeight = useSongRowHeight()

  const saved = useSaveTagsAsPlaylist()
  // A second press would make a second copy of the same playlist, so once these
  // tags are kept the button says so instead of offering again. Changing a tag
  // changes the heading, which offers it again without anything to reset.
  const alreadySaved = saved.savedName !== null && saved.savedName === model.heading
  const saveTheseTags = useCallback(
    () =>
      saved.save({
        name: model.heading,
        tagIds: model.filter.tagIds,
        sort: model.filter.sort,
        descending: model.filter.descending,
      }),
    [saved, model.heading, model.filter.tagIds, model.filter.sort, model.filter.descending],
  )

  /*
   * A row's handlers, one of each for the whole list.
   *
   * They were closures made per row per render, over the player, the
   * selection and the ids — so no row's memo ever held, and a song change, a
   * pause or a keystroke in the search redrew every row on screen. Now each
   * is made once and handed the row's song, and reads what it needs at the
   * moment of the press from `latest`. Whether a row is the playing one the
   * row asks the player itself (`useSongPlayback`).
   */
  const { playFrom } = player
  const latest = useRef({ selection, songIds, playFrom, toggleLoved, model })
  useEffect(() => {
    latest.current = { selection, songIds, playFrom, toggleLoved, model }
  })
  /*
   * Turning a tag on or off, from anywhere: a chip in the head, a chip on a
   * row, the chooser, the sidebar. One function, because every one of them
   * also has to leave the tag in the rail's recent list — a tag chosen from a
   * song row is as much a sign of interest as one chosen from the sidebar.
   * Only turning one *on* counts: dismissing a tag should not promote it.
   *
   * Every row is handed this, so it reads the model through `latest` like the
   * handlers below: made over the model, it was remade whenever the library
   * changed, and a like redrew every row on screen to give each a new copy.
   */
  const chooseTag = useCallback((tagId: number) => {
    const { filter, toggleTag } = latest.current.model
    if (!filter.tagIds.includes(tagId)) noteTagUsed(tagId)
    toggleTag(tagId)
  }, [])
  const onRowPress = useCallback((event: GestureResponderEvent, song: Song) => {
    const now = latest.current
    // Shift and Cmd on the web, and a tap in selection mode, select; a plain
    // tap still plays.
    if (now.selection.click(song.id, modifiersOf(event))) return
    const index = now.songIds.indexOf(song.id)
    if (index >= 0) now.playFrom(now.songIds, index)
  }, [])
  const onRowMore = useCallback((anchor: View | null, song: Song) => {
    menuAnchorRef.current = anchor
    // The ⋯ again closes its own menu.
    setMenuSong(current => (current?.id === song.id ? null : song))
  }, [])
  // Holding a row selects it; the ⋯ opens the menu.
  const onRowLongPress = useCallback((song: Song) => latest.current.selection.enter(song.id), [])
  const onRowToggleLoved = useCallback(
    (song: Song) => latest.current.toggleLoved.mutate({ id: song.id, loved: !song.loved }),
    [],
  )
  const onRowToggleSelect = useCallback(
    (song: Song) => latest.current.selection.toggle(song.id),
    [],
  )
  const onRowEditTags = useCallback((anchor: View | null, song: Song) => {
    tagAnchorRef.current = anchor
    setTaggingSong(current => (current?.id === song.id ? null : song))
  }, [])

  const unreachable = model.unreachable
  const menuSongId = menuSong?.id ?? null
  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => {
      const here = downloaded(item.id)
      return (
        <SongRow
          testID={`song-row-${index}`}
          song={item}
          artUri={artFor(item)}
          downloaded={here}
          notDownloadedMark={installed && !here}
          // Not here, and nowhere to stream it from: faded, so the list says so.
          unavailable={unreachable && installed && !here}
          onPress={onRowPress}
          onMore={onRowMore}
          menuOpen={menuSongId === item.id}
          onLongPress={onRowLongPress}
          onToggleLoved={onRowToggleLoved}
          selecting={selection.active}
          selected={selection.has(item.id)}
          onToggleSelect={onRowToggleSelect}
          index={index}
          tags={songTags(item)}
          onToggleTag={chooseTag}
          onEditTags={onRowEditTags}
        />
      )
    },
    [
      installed,
      artFor,
      downloaded,
      unreachable,
      selection,
      songTags,
      chooseTag,
      menuSongId,
      onRowPress,
      onRowMore,
      onRowLongPress,
      onRowToggleLoved,
      onRowToggleSelect,
      onRowEditTags,
    ],
  )

  /*
   * What stands where the songs would. A server that did not answer gets the
   * card that can fix it; a search that found nothing names what was searched,
   * says which tags it was searched inside, and offers the way out of each.
   */
  const query = filter.query.trim()
  const emptyState =
    model.emptyReason === 'unreachable' ? (
      <View style={styles.emptyCard}>
        <CantReach onRetry={model.retry} />
      </View>
    ) : model.emptyReason === 'no-library' ? (
      <Text style={styles.empty}>{NO_LIBRARY_TEXT}</Text>
    ) : (
      <View style={styles.noMatches} testID="library-no-matches">
        <Text style={styles.noMatchesTitle}>{noMatchesTitle(query, model.tagFiltered)}</Text>
        {model.tagFiltered ? (
          <View style={styles.inside}>
            <Text style={styles.filteredBy}>You’re looking inside</Text>
            {model.chosenTags.map(tag => (
              <Chip
                key={tag.id}
                compact
                label={tag.name}
                hue={tag.hue}
                selected
                onPress={() => chooseTag(tag.id)}
              />
            ))}
          </View>
        ) : null}
        <View style={styles.noMatchesActions}>
          {model.tagFiltered ? (
            <Button
              label={query ? 'Search all songs' : 'Show all songs'}
              variant="primary"
              onPress={model.clearTags}
            />
          ) : null}
          {query ? <Button label="Clear search" onPress={model.clearQuery} /> : null}
        </View>
      </View>
    )

  return (
    <SafeAreaView style={styles.screen} edges={['top']} testID="library-screen">
      {/*
        On a phone: the title, then the search on a line of its own, then order
        and play. At desktop width it is one row — the title on the left, and
        search, order and play along from it, with the search giving up width
        before the row wraps.
      */}
      <View style={[styles.head, headWide && styles.headWide]}>
        {/*
          The tags you picked are the title. There is no text heading repeating
          them: the chips say what this list is, each carries the × that takes
          it off, and the + beside them adds another.
        */}
        <View style={headWide ? styles.titlesWide : undefined}>
          <View style={styles.titleTags} accessibilityRole="header">
            {model.tagFiltered ? (
              model.chosenTags.map(tag => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  hue={tag.hue}
                  selected
                  onPress={() => chooseTag(tag.id)}
                  onRemove={() => chooseTag(tag.id)}
                />
              ))
            ) : (
              <Text style={styles.heading} numberOfLines={1}>
                Library
              </Text>
            )}
            {/*
              The way in, at both states: a dashed + once there are chips to
              add to, and the words before there are — nobody hunts for a bare
              plus sign beside a title that does not look like a list of tags.
            */}
            <Pressable
              onPress={choosingTags ? closeTagSearch : openTagSearch}
              accessibilityRole="button"
              accessibilityLabel={model.tagFiltered ? 'Add a tag' : 'Pick tags'}
              accessibilityState={{ expanded: choosingTags }}
              {...tip(model.tagFiltered ? 'Add a tag' : undefined)}
              style={({ pressed }) => [
                styles.addTag,
                choosingTags && { borderStyle: 'solid', borderColor: accent.accentDim },
                pressed && styles.addTagPressed,
              ]}
              testID="library-add-tag"
            >
              <Plus size={14} color={choosingTags ? accent.accent : theme.colors.textMuted} />
              {model.tagFiltered ? null : <Text style={styles.addTagLabel}>Pick tags</Text>}
            </Pressable>
          </View>
          {/* How many, how long, and — with two tags or more — what leads. */}
          {model.tagFiltered ? (
            <View style={styles.subRow}>
              <Text style={styles.sub}>{model.subtitle}</Text>
              {model.matchNote ? (
                <Text style={styles.sub} testID="library-match-note">
                  · {model.matchNote}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {/*
          A phone's library carries no sort and no idle Shuffle — a tap on a
          row plays the list from there. But tags turn this list into an idea,
          and an idea is worth starting and worth keeping, so the same three
          controls a computer keeps in its header take a row of their own here.
          Without them the phone could pick tags and then had to be told to go
          somewhere else to play them.
        */}
        {!wide && model.tagFiltered ? (
          <View style={styles.phoneTransport}>
            <Button
              label="Play"
              variant="primary"
              grow
              accessibilityLabel="Play these tags"
              icon={<Play size={14} color={accent.onAccent} />}
              disabled={visible.length === 0}
              onPress={() => player.playFrom(songIds, 0)}
              testID="library-play-tags"
            />
            <Button
              accessibilityLabel="Shuffle these tags"
              icon={<Shuffle size={15} color={theme.colors.textPrimary} />}
              disabled={visible.length === 0}
              onPress={() => player.playShuffled(songIds)}
            />
            {alreadySaved ? (
              <View style={styles.savedSlot}>
                <Text style={styles.savedMark} testID="library-saved">
                  ✓ Saved
                </Text>
              </View>
            ) : (
              <Button
                label={saved.saving ? 'Saving…' : 'Save'}
                accessibilityLabel="Save these tags as a playlist"
                disabled={saved.saving || visible.length === 0}
                onPress={saveTheseTags}
                testID="library-save-tags"
              />
            )}
          </View>
        ) : null}

        <View style={[styles.controls, headWide && styles.controlsWide]}>
          <View
            style={[
              styles.searchBox,
              headWide && styles.searchWide,
              dense && styles.searchDense,
              // Focus is the box's border in the accent, and nothing else.
              searchFocused && { borderColor: accent.accent },
            ]}
          >
            <Search size={15} color={searchFocused ? accent.accent : theme.colors.textMuted} />
            <TextInput
              style={styles.search}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
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

          {/* A phone's library is the search and the list: order and play live on a computer. */}
          {wide ? (
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

            {/*
              With no tags on, Shuffle alone — a click on any row already plays
              the list from there, and "play 1,204 songs alphabetically" is not
              a thing anybody wants a button for.

              With tags on this list is an idea rather than a library, so it is
              worth a Play, and worth keeping: Save makes a playlist that
              follows these tags, and then says it did rather than offering
              again.
            */}
            <View style={[styles.transport, headWide ? styles.transportWide : styles.transportCompact]}>
              {model.tagFiltered ? (
                alreadySaved ? (
                  <Text style={styles.savedMark} testID="library-saved">
                    ✓ Saved
                  </Text>
                ) : (
                  <Button
                    label={saved.saving ? 'Saving…' : 'Save as playlist'}
                    accessibilityLabel="Save these tags as a playlist"
                    disabled={saved.saving || visible.length === 0}
                    onPress={saveTheseTags}
                    testID="library-save-tags"
                  />
                )
              ) : null}
              <Button
                label={shuffleIconOnly || model.tagFiltered ? undefined : 'Shuffle'}
                accessibilityLabel="Shuffle"
                icon={<Shuffle size={15} color={theme.colors.textPrimary} />}
                disabled={visible.length === 0}
                onPress={() => player.playShuffled(songIds)}
              />
              {model.tagFiltered ? (
                <Button
                  label="Play"
                  variant="primary"
                  accessibilityLabel="Play these tags"
                  icon={<Play size={14} color={accent.onAccent} />}
                  disabled={visible.length === 0}
                  onPress={() => player.playFrom(songIds, 0)}
                  testID="library-play-tags"
                />
              ) : null}
            </View>
          </View>
          ) : null}
        </View>
      </View>

      {/* At desktop width the sidebar carries the tags. */}
      {/* On a phone only what is on the phone; tags are not a filter here. */}
      {!wide && installed && songs.length > 0 ? (
        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tagStripFrame}
            contentContainerStyle={styles.tagStrip}
            keyboardShouldPersistTaps="handled"
          >
            {installed ? (
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
            ) : null}
          </ScrollView>
        </View>
      ) : null}

      {/*
        The picker, in the page rather than over it: the head grows, the songs
        move down, and nothing is drawn across the sidebar.
      */}
      <View style={styles.chooser}>
        <ListenTags
          open={choosingTags}
          onClose={closeTagSearch}
          selected={filter.tagIds}
          onToggle={chooseTag}
          summary={model.tagFiltered ? model.subtitle : undefined}
        />
      </View>

      {/*
        No second "Filtered by" row: the chips in the head are the filter, and
        drawing them twice made the same list look like two different states.
        Only the way out of all of them at once is left.
      */}
      {model.tagFiltered ? (
        <View style={styles.activeFilters}>
          <Pressable onPress={model.clearTags} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.clear, { color: accent.accent }]}>clear tags</Text>
          </Pressable>
        </View>
      ) : null}

      {model.tagFiltered || filter.query.trim() ? null : <GemsRow />}

      <SyncStatus />

      {/* Links asked of the server, until what they bring is published. */}
      {fromCloud ? <PendingImports /> : null}

      {/* The selection bar takes a lane above the list, so it covers no row. */}
      <View style={styles.listArea}>
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
            label={`${model.heading} songs`}
            renderSong={renderSong}
            rowHeight={rowHeight}
            onRefresh={pull.onRefresh}
            refreshing={pull.refreshing}
            contentContainerStyle={[
              styles.list,
              // On a phone the bar still floats over the foot of the list; the
              // last song can scroll out from under it.
              selection.active && !wide && { paddingBottom: SELECTION_BAR_SPACE },
            ]}
            empty={emptyState}
          />
        )}
      </View>

      <TagPicker
        song={taggingSong}
        onClose={() => setTaggingSong(null)}
        anchorRef={tagAnchorRef}
      />

      <SongMenu
        song={menuSong}
        anchorRef={menuAnchorRef}
        onClose={() => setMenuSong(null)}
        onStartSelecting={song => selection.enter(song.id)}
      />
    </SafeAreaView>
  )
}

/** A library with no songs in it: an invitation, not an error. */
const NO_LIBRARY_TEXT =
  'Nothing here yet. Import a song and it turns up here once your server has it.'

/**
 * The narrowest page column that takes the header on one row. The practice
 * panel's 340 beside a 1280 window leaves about 700, and a head that stacked
 * into three rows there pushed the songs down each time practice opened.
 */
const HEAD_ROW_WIDTH = 600
/** Below this the head's Shuffle is its icon alone, with the word as its caption. */
const SHUFFLE_LABEL_WIDTH = 760

const styles = StyleSheet.create(theme => ({
  titleTags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
  addTag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 28,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  addTagPressed: { backgroundColor: theme.colors.surface2 },
  addTagLabel: { color: theme.colors.textMuted, fontSize: type.small },
  subRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  /* Play first and widest: it is what picking tags was for. */
  phoneTransport: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  savedSlot: { justifyContent: 'center', paddingHorizontal: space.sm },
  chooser: { paddingHorizontal: space.lg },
  savedMark: { color: theme.colors.good, fontSize: type.small, fontWeight: '600' },
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
  /* With a mouse, the box 36, the arrow 34 wide. */
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
    // The box's accent border says it has focus. The browser's own ring drew a
    // second outline inside it, and Chrome draws an `auto` ring at any width.
    _web: { outlineStyle: 'none' },
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
  },
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
  /* A box over which the selection bar is laid; the list fills it. */
  listArea: {
    flex: 1,
    minHeight: 0,
  },
  list: {
    paddingTop: space.xs,
    paddingBottom: space.md,
  },
  emptyCard: { paddingHorizontal: space.lg },
  noMatches: {
    alignItems: 'center',
    gap: space.md,
    marginTop: space.xl,
    paddingHorizontal: space.xl,
  },
  noMatchesTitle: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  inside: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
  },
  noMatchesActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.sm,
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
