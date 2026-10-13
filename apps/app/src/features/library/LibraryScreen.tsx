import { useOpenSearch } from '../../shell/palette'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Song } from '@selfmp3/shared'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { HIT_TARGET, isDownloaded, radius, space, type, textStyle, iconSize } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { Button, PlayButton } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { Downloaded, Play, Plus, Shuffle, SortLines } from '../../ui/components/Icons'
import { IconButton } from '../../ui/components/IconButton'
import { Sheet, SheetItem } from '../../ui/components/Sheet'
import { useListSelectionBar } from '../../ui/components/useListSelectionBar'
import { useSongRows } from '../../ui/components/useSongRows'
import { EmptyState } from '../../ui/components/EmptyState'
import { SearchField } from '../../ui/components/SearchField'
import { Select } from '../../ui/components/Select'
import { SongList } from '../../ui/components/SongList'
import { useSongRowHeight } from '../../ui/components/SongRow'
import { SyncStatus } from '../../ui/components/SyncStatus'
import { CantReach } from './CantReach'
import { GemsRow } from './GemsRow'
import { PendingImports } from './PendingImports'
import { useConnection } from '../../connection/ConnectionProvider'
import { ListenTags } from '../../ui/components/ListenTags'
import { useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { deviceWord } from '../../ports/device'
import { useDragScroll } from '../../ports/dragScroll'
import { useContentWidth } from '../../shell/contentWidth'
import { noMatchesTitle, stripTags, useLibraryModel } from './library.model'
import { noteTagUsed, useRecentTagIds } from './recentTags.store'
import { librarySource, playAlone } from '../lists/lists.model'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { usePullToRefresh } from './usePullToRefresh'
import { label, pageFrame } from '../../ui/surfaces'
import { PageHeader } from '../../ui/components/PageHeader'
import { PageLoading } from '../../ui/components/PageLoading'
import { Guide } from '../guide/Guide'
import { useGuide } from '../guide/useGuide'
import { sortLabel } from '../../ui/components/listScrollbar.model'
import { ScrollView } from '../../ui/components/Scroll'
import { Press } from '../../ui/components/Press'
import { COLUMN_WIDTH } from '../../shell/widths'

/**
 * The library, at every width.
 *
 * The header holds the title and a count, a door to Search on a line of its
 * own, then order and play sharing the next. Under it the tag strip. All of
 * the filtering runs over the full in-memory list — the whole library arrives
 * in one response, so turning a tag on costs one pass over an array and no
 * round trip.
 */
export function LibraryScreen(): ReactNode {
  const { fromCloud } = useConnection()
  const { theme } = useUnistyles()
  const { wide, dense, finePointer } = useLayout()
  // One row needs about 600 points once Shuffle is an icon: title, search, order
  // and shuffle, the search giving up width first. An iPad's column beside the
  // sidebar is 590, so there it stacks as a phone's does. Before the column is
  // measured the row is kept, so a desktop never flashes.
  const contentWidth = useContentWidth()
  const headWide = wide && (contentWidth === null || contentWidth >= COLUMN_WIDTH.libraryHeadRow)
  const shuffleIconOnly = contentWidth !== null && contentWidth < COLUMN_WIDTH.libraryShuffleLabel
  const player = usePlayerCommands()
  const { state: downloads, installed } = useDownloads()
  const openSearch = useOpenSearch()

  // Everything this screen knows is in the model, which draws nothing and is
  // tested without a simulator. What is left here is drawing.
  const model = useLibraryModel(downloads.index)
  const pull = usePullToRefresh()
  const { filter, songs, visible, songIds } = model
  // The scrollbar's bubble names the part of the sort the list is at.
  const scrollLabel = useMemo(() => sortLabel(filter.sort), [filter.sort])

  // The phone's order, chosen from a sheet.
  const [sorting, setSorting] = useState(false)
  // A mouse drags the tag strip along; a finger already flicks it.
  const stripDrag = useDragScroll()
  // Which tags to listen to — a different job from the row's tag window,
  // which puts tags on a song.
  const [choosingTags, setChoosingTags] = useState(false)
  const closeTagSearch = useCallback(() => setChoosingTags(false), [])
  const recentTagIds = useRecentTagIds()

  // Multi-select runs off the visible list, so "select all" means the songs on
  // screen and a song a search has hidden drops out of the selection rather
  // than being acted on with the rest.
  const selection = useSelection(songIds)
  const narrowed = model.tagFiltered || filter.downloadedOnly
  // The bar takes a lane above the list on a computer, so it covers no row.
  const bar = useListSelectionBar({
    songs: visible,
    selection,
    scope: narrowed ? 'in this view' : 'in your library',
    narrowed,
    wide,
    placement: 'aboveList',
  })

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

  const rowHeight = useSongRowHeight()

  // What Up next is called when this list plays: the library, or the tags
  // ticked. Saving them as a playlist happens there, after listening
  // (docs/features/lists.md).
  const transportRef = useRef<View>(null)
  const fly = useFlyToUpNext()
  const source = useMemo(
    () => librarySource(model.filter.tagIds, model.tags),
    [model.filter.tagIds, model.tags],
  )
  // Playing what the tags ticked hold, from either head's transport: its first
  // covers fly to Up next from the button, and Up next wears the tags' name.
  const playTags = (shuffled: boolean): void => {
    fly(transportRef.current, songIds)
    if (shuffled) player.playShuffled(songIds, source)
    else player.playFrom(songIds, 0, { source })
  }
  // What the list is answering: a new answer plays its first rows in
  // (`SongList`'s `arrivalKey`); scrolling, selecting and playing do not.
  const arrivalKey = [
    model.filter.tagIds.join(','),
    model.filter.sort,
    model.filter.descending ? 'desc' : 'asc',
    model.filter.downloadedOnly ? 'downloaded' : 'all',
  ].join('|')

  /*
   * Turning a tag on or off, from anywhere on this page that filters: a chip
   * in the strip, the chooser. One function, because each of them also has to
   * leave the tag in the recent list the strip and the sidebar lead with. Only
   * turning one *on* counts: dismissing a tag should not promote it. It reads
   * the model when pressed, so the chips are not drawn again for a new one.
   */
  const latestModel = useRef(model)
  useEffect(() => {
    latestModel.current = model
  })
  const chooseTag = useCallback((tagId: number) => {
    const { filter, toggleTag } = latestModel.current
    if (!filter.tagIds.includes(tagId)) noteTagUsed(tagId)
    toggleTag(tagId)
  }, [])
  const rows = useSongRows({
    songs: visible,
    selection,
    // That song and nothing after it, and whatever Up next held is gone
    // (`playAlone`). The whole list plays from Shuffle, or Play with tags on;
    // the tags ticked are not what is playing, so Up next wears no name for
    // the one song.
    onPlay: (_index, song) => playAlone(player, song.id),
    withTags: true,
    // The tags the list is filtered by are on every row: not drawn.
    hideTagIds: filter.tagIds,
  })
  /*
   * Holding a song to select it has nothing on the row to say so. A finger
   * is shown once, on the second visit, so the first look at a library is
   * left alone; a pointer has Shift and ⌘ and its own ticks.
   */
  const [guideTarget, selectGuide] = useGuide(
    'library-select',
    !finePointer && !selection.active && !model.loading && visible.length > 0,
    { afterVisits: 1 },
  )
  const { renderSong: drawRow } = rows
  const renderSong = useCallback(
    (info: { item: Song; index: number }) => {
      const row = drawRow(info)
      return info.index === 0 ? (
        <View ref={guideTarget} collapsable={false}>
          {row}
        </View>
      ) : (
        row
      )
    },
    [drawRow, guideTarget],
  )

  /*
   * What stands where the songs would. A server that did not answer gets the
   * card that can fix it; a filter that matched nothing says which tags it
   * looked inside, and offers the way out.
   */
  const emptyState =
    model.emptyReason === 'unreachable' ? (
      <View style={styles.emptyCard}>
        <CantReach error={model.failure} onRetry={model.retry} />
      </View>
    ) : model.emptyReason === 'no-library' ? (
      <EmptyState
        title="Nothing here yet"
        line="Import a song and it turns up here once it’s downloaded."
      />
    ) : (
      <EmptyState testID="library-no-matches" title={noMatchesTitle(model.tagFiltered)}>
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
        {model.tagFiltered ? <Button label="Show all songs" onPress={model.clearTags} /> : null}
      </EmptyState>
    )

  return (
    <SafeAreaView style={styles.screen} edges={['top']} testID="library-screen">
      {/*
        On a phone: the title, then the search on a line of its own, then order
        and play. At desktop width it is one row — the title on the left, and
        search, order and play along from it, with the search giving up width
        before the row wraps.
      */}
      <View style={[styles.head, wide && styles.headGutterWide, headWide && styles.headWide]}>
        {/*
          "Library" and one line under it (docs/ui-mock `P12`, `C04`): how
          many songs, how long, and on an installed app how many are here.
          The tags picked to narrow it are the strip below, not the title: a
          tag you want as a place has its own page now.
        */}
        <PageHeader
          title="Library"
          subtitle={
            <>
              {model.subtitle}
              {installed && !model.loading
                ? ` · ${hereCount} on this ${deviceWord({ wide, finePointer })}`
                : ''}
              {model.matchNote ? (
                <Text testID="library-match-note"> · {model.matchNote}</Text>
              ) : null}
            </>
          }
          subtitleTestID="library-subline"
          style={headWide ? styles.titlesWide : undefined}
          actions={
            // A phone's order, as a round button beside the title (docs/ui-mock
            // `P12`); a computer has it in its head row. No button for
            // choosing: holding a row starts it, everywhere (Xiao, 2026-09-20).
            wide ? undefined : (
              <>
                <IconButton
                  label="Sort"
                  filled
                  onPress={() => setSorting(true)}
                  testID="library-sort-phone"
                >
                  <SortLines tone="textPrimary" />
                </IconButton>
                {/* A row plays one song, so the whole list starts here. With
                    tags on, the transport row under the head does it. */}
                {model.tagFiltered ? null : (
                  <IconButton
                    label="Shuffle"
                    filled
                    disabled={visible.length === 0}
                    onPress={() => player.playShuffled(songIds, source)}
                    testID="library-shuffle-phone"
                  >
                    <Shuffle size={iconSize.item} color={theme.colors.textPrimary} />
                  </IconButton>
                )}
              </>
            )
          }
        />

        {/*
          A phone's library keeps Shuffle with its tools in the title row — a
          tap on a row plays that song alone. But tags turn this list into an
          idea, and an idea is worth starting, so the two controls a computer
          keeps in its header take a row of their own here.
        */}
        {!wide && model.tagFiltered ? (
          <View style={styles.phoneTransport} ref={transportRef} collapsable={false}>
            <PlayButton
              label="Play these tags"
              icon={<Play color={theme.colors.onPrimary} />}
              disabled={visible.length === 0}
              onPress={() => playTags(false)}
              testID="library-play-tags"
            />
            <Button
              accessibilityLabel="Shuffle these tags"
              icon={<Shuffle color={theme.colors.textPrimary} />}
              disabled={visible.length === 0}
              onPress={() => playTags(true)}
            />
          </View>
        ) : null}

        <View style={[styles.controls, headWide && styles.controlsWide]}>
          {/*
            Not a second search: a door to the one Search (docs/ui-mock `P19`,
            `C05`), which it opens on Songs — the page on a phone, the palette
            over this page on a computer. The tag strip below stays: that is a
            filter, not a search.
          */}
          <SearchField
            onPress={openSearch}
            placeholder="Search songs"
            testID="library-search"
            style={headWide ? styles.searchWide : undefined}
          />

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
              <Press
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
              </Press>

              {/*
              With no tags on, Shuffle alone — a click on a row plays that song
              alone, and "play 1,204 songs alphabetically" is not a thing
              anybody wants a button for.

              With tags on this list is an idea rather than a library, so it is
              worth a Play. Keeping it is Up next's Save, once it has been
              heard (docs/features/lists.md).
            */}
              <View
                ref={transportRef}
                collapsable={false}
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
                <Button
                  label={shuffleIconOnly || model.tagFiltered ? undefined : 'Shuffle'}
                  accessibilityLabel="Shuffle"
                  icon={<Shuffle color={theme.colors.textPrimary} />}
                  disabled={visible.length === 0}
                  testID="library-shuffle"
                  onPress={() =>
                    model.tagFiltered ? playTags(true) : player.playShuffled(songIds, source)
                  }
                />
                {model.tagFiltered ? (
                  <PlayButton
                    label="Play these tags"
                    // The size of the controls beside it, so the head stays one line.
                    size={dense ? 36 : HIT_TARGET}
                    icon={<Play color={theme.colors.onPrimary} />}
                    disabled={visible.length === 0}
                    onPress={() => playTags(false)}
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
          contentContainerStyle={[
            styles.tagStrip,
            wide && styles.gutterWide,
            headWide && styles.tagStripWide,
          ]}
          testID="library-tag-strip"
          {...stripDrag}
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
                  color={
                    filter.downloadedOnly ? theme.colors.onPrimary : theme.colors.textSecondary
                  }
                  knockout={
                    filter.downloadedOnly ? theme.colors.textPrimary : theme.colors.surface2
                  }
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
            icon={<Plus color={theme.colors.textSecondary} />}
            selected={false}
            dashed
            onPress={() => setChoosingTags(open => !open)}
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
      <Sheet
        open={sorting}
        onClose={() => setSorting(false)}
        title="Sort by"
        testID="library-sort-sheet"
      >
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
      <View style={[styles.chooser, wide && styles.gutterWide]}>
        <ListenTags
          open={choosingTags}
          onClose={closeTagSearch}
          selected={filter.tagIds}
          onToggle={chooseTag}
          summary={model.tagFiltered ? model.subtitle : undefined}
        />
      </View>

      {model.tagFiltered ? null : <GemsRow />}

      <SyncStatus />

      {/* Links asked of the server, until what they bring is published. */}
      {fromCloud ? <PendingImports /> : null}

      {/* The selection bar takes a lane above the list, so it covers no row. */}
      <View style={styles.listArea}>
        {bar.beforeList}

        {model.loading ? (
          <PageLoading />
        ) : (
          <SongList
            arrivalKey={arrivalKey}
            songs={visible}
            label={`${model.heading} songs`}
            renderSong={renderSong}
            rowHeight={rowHeight}
            scrollLabel={scrollLabel}
            onRefresh={pull.onRefresh}
            refreshing={pull.refreshing}
            contentContainerStyle={[styles.list, bar.listPadding]}
            empty={emptyState}
          />
        )}
      </View>

      {rows.menu}
      <Guide
        guide={selectGuide}
        steps={[
          {
            gesture: 'hold',
            text: 'Hold a song to select several',
            sub: 'Then add them to a playlist, or tag them',
          },
        ]}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  /* Play first, the white round one: it is what picking tags was for. */
  phoneTransport: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chooser: { paddingHorizontal: space.gutter },
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  head: { ...pageFrame(false), gap: space.md },
  // Where every page's title sits on a computer.
  headGutterWide: pageFrame(true),
  gutterWide: { paddingHorizontal: space.gutterWide },
  orderLabel: {
    ...label(theme.colors),
    paddingHorizontal: space.gutter,
    paddingTop: space.sm,
    paddingBottom: 2,
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
  /* With a mouse, the arrow 34 wide. */
  directionDense: { width: 34, height: 36 },
  searchWide: { flexGrow: 0, flexShrink: 1, flexBasis: 300, minWidth: 130 },
  // Never narrower than sort, direction and Shuffle: the search is what gives
  // up width, and with this shrinking too it held 300 while these ran off the
  // page's edge (a narrow window, or Up next open beside a long subline).
  actionsWide: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto', flexWrap: 'nowrap' },
  /* Enough for the longest option: "Recentl…" would tell you nothing. */
  sortSlotWide: { flex: 0, minWidth: 152 },
  transportWide: { marginLeft: 'auto' },
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
    ...textStyle('title'),
  },
  transport: {
    flexDirection: 'row',
    gap: space.sm,
  },
  /* When the head stacks, Shuffle and Play take a line of their own, at the end of it. */
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
    gap: space.tight,
    paddingHorizontal: space.gutter,
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
  emptyCard: { paddingHorizontal: space.gutter },
  // A line of its own in the empty state, so the way out sits under it.
  inside: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 7,
  },
}))
