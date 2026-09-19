import { router } from 'expo-router'
import { setPaletteOpen } from '../../shell/palette'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { type Song } from '@selfmp3/shared'
import { useArt } from '../../offline/useArt'
import { isDownloaded, HIT_TARGET, radius, space, type } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayer } from '../../player/PlayerProvider'
import { useAccent } from '../../ui/accent'
import { Button, PlayButton } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import {
  Check,
  Downloaded,
  Play,
  Plus,
  Search,
  Shuffle,
  SortLines,
} from '../../ui/components/Icons'
import { IconButton } from '../../ui/components/IconButton'
import { Sheet, SheetItem } from '../../ui/components/Sheet'
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
import { deviceWord } from '../../ports/device'
import { useContentWidth } from '../../shell/contentWidth'
import { noMatchesTitle, stripTags, useLibraryModel } from './library.model'
import { noteTagUsed, useRecentTagIds } from './recentTags.store'
import { closeTagSearch, openTagSearch, useTagSearchOpen } from './tagSearch.store'
import { useSaveTagsAsPlaylist } from './saveTags'
import { usePullToRefresh } from './usePullToRefresh'
import { label, pageTitle } from '../../ui/surfaces'

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
  const { wide, dense, finePointer } = useLayout()
  // One row needs about 600 points once Shuffle is an icon: title, search, order
  // and shuffle, the search giving up width first. An iPad's column beside the
  // sidebar is 590, so there it stacks as a phone's does. Before the column is
  // measured the row is kept, so a desktop never flashes.
  const contentWidth = useContentWidth()
  const headWide = wide && (contentWidth === null || contentWidth >= HEAD_ROW_WIDTH)
  const shuffleIconOnly = contentWidth !== null && contentWidth < SHUFFLE_LABEL_WIDTH
  const player = usePlayer()
  const { state: downloads, installed } = useDownloads()

  // Everything this screen knows is in the model, which draws nothing and is
  // tested without a simulator. What is left here is drawing.
  const model = useLibraryModel(downloads.index)
  const pull = usePullToRefresh()
  const { filter, songs, visible, songIds, songTags } = model

  const [menuSong, setMenuSong] = useState<Song | null>(null)
  // The phone's order, chosen from a sheet.
  const [sorting, setSorting] = useState(false)
  // The ⋯ the menu was opened from, so at desktop width it opens beside it.
  const menuAnchorRef = useRef<View | null>(null)
  // The + the tag window was opened from, for the same reason.
  const tagAnchorRef = useRef<View | null>(null)
  // Which tags to listen to — a different job from the picker above, which
  // puts tags on a song. Open/closed lives in a store, because the sidebar's
  // "All 13 tags…" opens this same panel.
  const choosingTags = useTagSearchOpen()
  const recentTagIds = useRecentTagIds()
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
  // "31 on this phone", in the line under the title.
  const hereCount = useMemo(
    () => (installed ? songs.filter(song => downloaded(song.id)).length : 0),
    [installed, songs, downloaded],
  )
  const strip = useMemo(
    () => stripTags(model.tags, filter.tagIds, recentTagIds),
    [model.tags, filter.tagIds, recentTagIds],
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
  const latest = useRef({ selection, songIds, playFrom, model })
  useEffect(() => {
    latest.current = { selection, songIds, playFrom, model }
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
          "Library" and one line under it (docs/ui-mock `P12`, `C04`): how
          many songs, how long, and on an installed app how many are here.
          The tags picked to narrow it are the strip below, not the title: a
          tag you want as a place has its own page now.
        */}
        <View style={headWide ? styles.titlesWide : wide ? undefined : styles.phoneTitles}>
          <View style={wide ? undefined : styles.phoneTitleRow}>
          <Text style={[styles.heading, !wide && styles.phoneHeading]} numberOfLines={1} accessibilityRole="header">
            Library
          </Text>
          {/*
            A phone's order and choosing, as two round buttons beside the title
            (docs/ui-mock `P12`); a computer has them in its head row.
          */}
          {wide ? null : (
            <View style={styles.phoneTools}>
              <IconButton
                label="Sort"
                filled
                onPress={() => setSorting(true)}
                testID="library-sort-phone"
              >
                <SortLines size={18} tone="textPrimary" />
              </IconButton>
              <IconButton
                label="Select songs"
                filled
                active={selection.mode}
                onPress={() => (selection.mode ? selection.clear() : selection.enter())}
                testID="library-select-phone"
              >
                <Check size={18} tone="textPrimary" />
              </IconButton>
            </View>
          )}
          </View>
          <View style={styles.subRow}>
            <Text style={styles.sub} testID="library-subline">
              {model.subtitle}
              {installed && !model.loading ? ` · ${hereCount} on this ${deviceWord({ wide, finePointer })}` : ''}
            </Text>
            {model.matchNote ? (
              <Text style={styles.sub} testID="library-match-note">
                · {model.matchNote}
              </Text>
            ) : null}
          </View>
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
            <PlayButton
              label="Play these tags"
              icon={<Play size={20} color={theme.colors.onPrimary} />}
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
          {/*
            Not a second search: a door to the one Search (docs/ui-mock `P19`,
            `C05`), which it opens on Songs — the page on a phone, the palette
            over this page on a computer. The tag strip below stays: that is a
            filter, not a search.
          */}
          <Pressable
            onPress={() =>
              wide
                ? setPaletteOpen(true)
                : router.navigate({ pathname: '/search', params: { scope: 'songs' } })
            }
            accessibilityRole="search"
            accessibilityLabel="Search songs"
            testID="library-search"
            style={[
              styles.searchBox,
              headWide && styles.searchWide,
              dense && styles.searchDense,
            ]}
          >
            <Search size={15} color={theme.colors.textMuted} />
            <Text style={styles.searchHint} numberOfLines={1}>
              Search songs
            </Text>
          </Pressable>

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
              <View
                style={[
                  styles.transport,
                  // A row of its own only for the three a tag brings; Shuffle alone
                  // stays beside the order (an iPad in portrait).
                  headWide
                    ? styles.transportWide
                    : model.tagFiltered
                      ? styles.transportCompact
                      : undefined,
                ]}
              >
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
                  <PlayButton
                    label="Play these tags"
                    // The size of the controls beside it, so the head stays one line.
                    size={dense ? 36 : HIT_TARGET}
                    icon={<Play size={16} color={theme.colors.onPrimary} />}
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

      {/*
        The strip (docs/ui-mock `P12`, `C04`): All, then tags as a filter —
        every one turned on adds its songs — the chosen ones first, then the
        ones used lately, then the biggest. The + at its end searches every
        tag, for a library with more than a strip holds. On an installed
        phone, "On this phone" narrows to what is here.
      */}
      {songs.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tagStripFrame}
          contentContainerStyle={[styles.tagStrip, headWide && styles.tagStripWide]}
          keyboardShouldPersistTaps="handled"
          testID="library-tag-strip"
        >
          <Chip
            testID="library-tag-all"
            label="All"
            selected={!model.tagFiltered && !filter.downloadedOnly}
            onPress={() => {
              model.clearTags()
              if (filter.downloadedOnly) model.toggleDownloadedOnly()
            }}
          />
          {!wide && installed ? (
            <Chip
              testID="library-on-this-phone"
              label="On this phone"
              selected={filter.downloadedOnly}
              icon={
                <Downloaded
                  size={12}
                  color={filter.downloadedOnly ? theme.colors.onPrimary : theme.colors.textSecondary}
                  knockout={filter.downloadedOnly ? theme.colors.textPrimary : theme.colors.surface2}
                />
              }
              onPress={model.toggleDownloadedOnly}
            />
          ) : null}
          {strip.map(tag => (
            <Chip
              key={tag.id}
              label={tag.name}
              hue={tag.hue}
              selected={filter.tagIds.includes(tag.id)}
              onPress={() => chooseTag(tag.id)}
            />
          ))}
          <Chip
            testID="library-add-tag"
            label={choosingTags ? 'Done' : 'More tags'}
            icon={<Plus size={13} color={theme.colors.textSecondary} />}
            selected={false}
            dashed
            onPress={choosingTags ? closeTagSearch : openTagSearch}
          />
        </ScrollView>
      ) : null}

      {/* On a phone the list is headed by its order: "RECENTLY ADDED" (`P12`). */}
      {!wide && songs.length > 0 ? (
        <Text style={styles.orderLabel} testID="library-order-label">
          {model.sortLabel}
          {filter.descending ? '' : ' · reversed'}
        </Text>
      ) : null}
      <Sheet open={sorting} onClose={() => setSorting(false)} title="Sort by" testID="library-sort-sheet">
        {model.sortOptions.map(option => (
          <SheetItem
            key={option.field}
            role="option"
            label={option.label}
            active={filter.sort === option.field}
            onPress={() => {
              model.setSort(option.field)
              setSorting(false)
            }}
          />
        ))}
        <SheetItem
          label={filter.descending ? 'Reverse the order' : 'Put the order back'}
          icon={<Text style={styles.directionArrow}>{filter.descending ? '↑' : '↓'}</Text>}
          onPress={() => {
            model.toggleDirection()
            setSorting(false)
          }}
        />
      </Sheet>

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

      <TagPicker song={taggingSong} onClose={() => setTaggingSong(null)} anchorRef={tagAnchorRef} />

      <SongMenu
        song={menuSong}
        anchorRef={menuAnchorRef}
        onClose={() => setMenuSong(null)}
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
  subRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  /* Play first, the white round one: it is what picking tags was for. */
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
  heading: pageTitle(theme.colors),
  phoneTitles: { alignSelf: 'stretch' },
  phoneTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  phoneHeading: { flex: 1 },
  phoneTools: { flexDirection: 'row', gap: space.sm },
  orderLabel: {
    ...label(theme.colors),
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: 2,
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
  // Never narrower than sort, direction and Shuffle: the search is what gives
  // up width, and with this shrinking too it held 300 while these ran off the
  // page's edge (a narrow window, or Up next open beside a long subline).
  actionsWide: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', flexWrap: 'nowrap' },
  /* Enough for the longest option: "Recentl…" would tell you nothing. */
  sortSlotWide: { flex: 0, minWidth: 152 },
  transportWide: { marginLeft: 'auto' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    // A control on the ground, drawn as a field; pressing it opens Search.
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.pill,
    paddingLeft: 10,
    paddingRight: 10,
    minHeight: HIT_TARGET,
  },
  searchHint: {
    flex: 1,
    color: theme.colors.textMuted,
    fontSize: type.body,
    paddingVertical: 8,
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
  sortButtonPressed: {
    backgroundColor: theme.colors.surface3,
  },
  direction: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
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
  tagStripWide: { paddingTop: 0 },
  tagStrip: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  /* `.active-filters`: the chips that are filtering, each removable, and clear. */
  filteredBy: {
    color: theme.colors.textMuted,
    fontSize: type.small,
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
