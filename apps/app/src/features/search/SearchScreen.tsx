import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, type TextInput, View, type ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  clipText,
  type LyricsSearchHit,
  type RoomState,
  type Song,
  type Tag,
  type Artist,
} from '@selfmp3/shared'
import {
  hitSlopFor,
  leading,
  space,
  type,
  useLibrary,
  iconSize,
  coverSize,
  radius,
} from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayer, usePlayerCommands } from '../../player/PlayerProvider'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { isComposing } from '../../shell/composing'
import { focusNextStop } from '../../shell/focusNext'
import { useEscape } from '../../shell/useEscape'
import { NarrowerContentWidth } from '../../shell/contentWidth'
import { useLayoutFlags } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Chip } from '../../ui/components/Chip'
import { Cover } from '../../ui/components/Cover'
import { Press } from '../../ui/components/Press'
import { ChevronLeft, Sparkle } from '../../ui/components/Icons'
import { EmptyState } from '../../ui/components/EmptyState'
import { SearchField } from '../../ui/components/SearchField'
import { SectionHead } from '../../ui/components/SectionHead'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SongList } from '../../ui/components/SongList'
import { useListSelectionBar } from '../../ui/components/useListSelectionBar'
import { useSelection, type Selection } from '../../selection/useSelection'
import { useSongRows } from '../../ui/components/useSongRows'
import { PlaceLine } from '../../ui/components/PlaceLine'
import { artistLink } from '../tag/placeLinks'
import { useOpenTag } from '../tag/useOpenTag'
import { ASK_SUB, askable } from '../smart/smart.model'
import { useSmartSwitches } from '../smart/useSmartSwitches'
import { useLibrarySearch } from './useLibrarySearch'
import {
  ALL_LIMITS,
  allResults,
  beforeTyping,
  isSearchSection,
  placesOf,
  searchLibrary,
  SECTION_TITLES,
  sectionCounts,
  type SearchPlace,
  type SearchSection,
} from './search.model'
import { useSongsById } from '../../ui/songsById'
import { showToast } from '../../ui/toast'
import { playableLink } from '../room/linkSong'
import { roomTitle, youMay } from '../room/room.model'
import { useRoom } from '../room/room.store'
import {
  AddingToRoom,
  LinkPick,
  MySongPick,
  RoomShelves,
  useRoomAdds,
  type RoomAdds,
} from '../room/RoomPicks'
import { useGoBack } from '../../ui/useBackTo'
import { PAGE_TOP_PHONE, PAGE_TOP_WIDE, rowTitle, textColumn } from '../../ui/surfaces'
import { NavRow } from '../../ui/components/NavRow'
import { ScrollView } from '../../ui/components/Scroll'
import { countUse } from '../usage/usage'

/** What a song played from Search names Up next: the rows and the lyric hits alike. */
const FROM_SEARCH = { kind: 'songs', origin: 'search', name: 'Search' } as const

const NO_SONGS: readonly Song[] = []

/** How long typing has to stop before the words go into the address. */
const WORDS_SETTLE_MS = 400

/**
 * Search (docs/ui-mock `P18`, `P19`): one page, whichever door it was opened
 * from. `?q=` is what it starts with; the rest is this page's own. A computer draws the same search as the palette
 * over its page (`C05`); this page is what a phone opens, and what a computer
 * shows for anyone who types the address.
 *
 * `?to=room` is the same page adding to the room you are in (A2, Xiao
 * 2026-10-14), from Up next's Add songs, on every device: a bar says where
 * songs go, a song's line adds it, Ask's songs are added rather than played,
 * a link pasted in is looked up, and before typing are what the room's people
 * brought. One box to find songs and ask for them, in a room as everywhere:
 * asking opens the Ask page (`AskScreen`) over this one, for the room too.
 */
export function SearchScreen(): ReactNode {
  const router = useRouter()
  const params = useLocalSearchParams<{ q?: string; to?: string; section?: string }>()
  const { state: room } = useRoom()
  const adding = params.to === 'room' ? room : null
  const adds = useRoomAdds()
  const addingTo = useMemo(() => (adding ? { title: roomTitle(adding) } : null), [adding])
  const { wide } = useLayoutFlags()
  const { data: library } = useLibrary()
  const player = usePlayer()

  const [query, setQuery] = useState(() => (typeof params.q === 'string' ? params.q : ''))
  // A search counted as it starts: the field going from empty to something.
  const searching = query.trim() !== ''
  useEffect(() => {
    if (searching) countUse('search')
  }, [searching])
  /**
   * The section a "See all" opened alone, or null for All. See all is a page
   * of its own (`?section=`), so Back comes back to All with the words still
   * there, and a browser's Back did too: it had been this page's own state,
   * and Back left Search altogether (bug bash F073).
   */
  const opened = isSearchSection(params.section) ? params.section : null
  const [section, setSection] = useState<SearchSection | null>(opened)
  const seeAll = useCallback(
    (next: SearchSection) =>
      router.push({
        pathname: '/search',
        params: { ...(params.to ? { to: params.to } : null), q: query.trim(), section: next },
      }),
    [router, params.to, query],
  )
  // Back to All: the page All was, where See all came from one; a See all
  // opened from its address becomes All itself.
  const backToAll = (): void => {
    if (opened !== null && router.canGoBack()) {
      router.back()
      return
    }
    setSection(null)
    if (opened !== null) router.setParams({ section: undefined })
  }
  // The words in the address once typing stops, so a reload, or Back to
  // here, finds them.
  const typing = query.trim()
  useEffect(() => {
    if ((params.q ?? '') === typing) return undefined
    const timer = setTimeout(() => router.setParams({ q: typing || undefined }), WORDS_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [router, params.q, typing])
  const field = useRef<TextInput>(null)
  // Cancel, the last thing in the head: what ↓ moves on from into the results.
  const cancelRef = useRef<View>(null)
  // The palette's search too, so the two find the same and Enter decides alike.
  const search = useLibrarySearch(query, {
    search: useCallback((text: string) => searchLibrary(text, library), [library]),
    matches: (them, lyricCount) => sectionCounts(them, lyricCount).all,
  })
  const { shown, found, lyricHits, lyricsAway } = search
  const typed = shown.trim() !== ''

  const currentId = player.current?.id ?? null
  const empty = useMemo(() => beforeTyping(library, currentId), [library, currentId])
  const counts = sectionCounts(found, lyricHits.length)
  const words = shown.trim()
  const switches = useSmartSwitches()
  const offerAsk = switches.ask && section === null && askable(words)
  // A YouTube or 网易云 link typed while adding: looked up, not searched for.
  const link = adding && youMay(adding, 'addLink') ? playableLink(words) : null
  // Ask is a page of its own (A1, 2026-10-24): Search stays under it, words and all, for Back.
  const ask = useCallback(
    (text: string) =>
      router.push({ pathname: '/ask', params: adding ? { q: text, to: 'room' } : { q: text } }),
    [router, adding],
  )

  const openArtist = useCallback(
    (artist: Artist) => router.navigate(artistLink(artist.name)),
    [router],
  )

  const close = useGoBack('/')

  // The song rows on the page now, which are what selecting runs over: the
  // recent few before typing, every match once Songs is opened, All's best few.
  const rowSongs = useMemo(
    () =>
      !typed
        ? empty.recent
        : section === 'songs'
          ? found.songs
          : section === null
            ? allResults(found).songs
            : NO_SONGS,
    [typed, section, found, empty.recent],
  )
  const rowIds = useMemo(() => rowSongs.map(song => song.id), [rowSongs])
  // The page's one selection, for every song row on it: holding a row starts
  // selecting here as it does in Library (D1, 2026-10-08).
  const selection = useSelection(rowIds)
  // Escape is Cancel, as it closes the palette a computer draws instead; a
  // selection takes it first, and clears.
  useEscape(!selection.active, close)
  const bar = useListSelectionBar({
    songs: rowSongs,
    selection,
    scope: 'in these results',
    wide,
    placement: 'aboveList',
  })

  return (
    <AddingToRoom.Provider value={addingTo}>
      <NarrowerContentWidth max={COLUMN}>
        <SafeAreaView style={styles.screen} edges={['top']}>
          <View style={[styles.page, wide && styles.pageWide]} testID="search-screen">
            <View style={styles.head}>
              <SearchField
                inputRef={field}
                // A See all page is for reading what was found: no keyboard over it.
                autoFocus={opened === null}
                value={query}
                // A cleared field is a fresh search, back on All.
                onChangeText={text => {
                  setQuery(text)
                  if (text.trim() === '') setSection(null)
                }}
                // Enter asks only when nothing matches (I1); with matches it puts
                // the keyboard away and the results stay where they are.
                onSubmitEditing={() => {
                  if (search.enterAsks()) ask(query.trim())
                  else field.current?.blur()
                }}
                placeholder={
                  adding ? 'Songs, a link, or ask for some' : 'Songs, tags, artists, lyrics'
                }
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="search"
                // ↓ goes from the field down into the results, as the
                // palette's does: Tab past Cancel was the only way in.
                onKeyPress={event => {
                  const key = event.nativeEvent.key
                  if (isComposing(event.nativeEvent as { isComposing?: boolean })) return
                  // The field keeps its keys from the page, so Escape is
                  // answered here as well as by the page's own (`useEscape`).
                  if (key === 'Escape' && !selection.active) close()
                  if (key !== 'ArrowDown') return
                  if (focusNextStop(cancelRef.current)) {
                    ;(event as unknown as { preventDefault: () => void }).preventDefault()
                  }
                }}
                accessibilityLabel="Search"
                testID="search-field"
                style={styles.field}
              />
              <Press
                ref={cancelRef}
                feedback="dim"
                onPress={close}
                accessibilityRole="button"
                hitSlop={hitSlopFor(leading.body)}
              >
                <Text style={styles.cancel}>{adding ? 'Done' : 'Cancel'}</Text>
              </Press>
            </View>
            {adding ? (
              <View style={styles.adding} testID="search-adding">
                <Text style={styles.addingText} numberOfLines={1}>
                  Adding to {roomTitle(adding)}
                </Text>
              </View>
            ) : null}

            {typed && section !== null ? (
              <Press
                feedback="wash"
                onPress={backToAll}
                accessibilityRole="button"
                accessibilityLabel={`${SECTION_TITLES[section]}, ${counts[section]}. Back to all results`}
                style={styles.back}
                hitSlop={hitSlopFor(leading.body + space.sm * 2)}
                testID="search-back"
              >
                <ChevronLeft size={iconSize.medium} tone="textSecondary" />
                <Text style={styles.backTitle} numberOfLines={1}>
                  {SECTION_TITLES[section]}
                </Text>
                <Text style={styles.backCount}>{counts[section]}</Text>
              </Press>
            ) : (
              <View style={styles.headGap} />
            )}

            {bar.beforeList}

            {!typed ? (
              adding ? (
                <BeforeAdding room={adding} recent={empty.recent} adds={adds} />
              ) : (
                <BeforeTyping
                  tags={empty.tags}
                  recent={empty.recent}
                  selection={selection}
                  listPadding={bar.listPadding}
                />
              )
            ) : section === 'songs' ? (
              <SongResults
                songs={found.songs}
                query={shown}
                selection={selection}
                listPadding={bar.listPadding}
                adds={adding ? adds : null}
              />
            ) : (
              <ScrollView contentContainerStyle={[styles.results, bar.listPadding]}>
                {!link && offerAsk && counts.all === 0 ? (
                  <AskCard words={words} first onAsk={() => ask(words)} />
                ) : null}
                {adding && link ? <LinkPick state={adding} url={link} /> : null}
                {link ? null : section === null ? (
                  <AllResults
                    found={found}
                    lyricHits={lyricHits}
                    selection={selection}
                    onSeeAll={seeAll}
                    onArtist={openArtist}
                    adds={adding ? adds : null}
                  />
                ) : section === 'places' ? (
                  <View style={styles.section}>
                    <Places places={placesOf(found)} onArtist={openArtist} />
                  </View>
                ) : (
                  <LyricResults hits={lyricHits} away={lyricsAway} adds={adding ? adds : null} />
                )}
                {!link && offerAsk && counts.all > 0 ? (
                  <AskCard words={words} first={false} onAsk={() => ask(words)} />
                ) : null}
                {!link &&
                counts[section ?? 'all'] === 0 &&
                !(section === 'lyrics' && lyricsAway) ? (
                  <NothingMatches words={shown.trim()} />
                ) : null}
                <ChromeSpacer />
              </ScrollView>
            )}
          </View>
        </SafeAreaView>
      </NarrowerContentWidth>
    </AddingToRoom.Provider>
  )
}

/**
 * Before anything is typed while adding to a room: what you played last,
 * each a + away, then what the room's people brought.
 */
function BeforeAdding({
  room,
  recent,
  adds,
}: {
  room: RoomState
  recent: readonly Song[]
  adds: RoomAdds
}): ReactNode {
  return (
    <ScrollView contentContainerStyle={styles.results}>
      {recent.length > 0 && youMay(room, 'add') ? (
        <View style={styles.section}>
          <SectionHead title="Recently played" style={styles.sectionHead} />
          {recent.map((song, index) => (
            <MySongPick key={song.id} song={song} adds={adds} testID={`search-recent-${index}`} />
          ))}
        </View>
      ) : null}
      <View style={styles.section}>
        <RoomShelves state={room} />
      </View>
      <ChromeSpacer />
    </ScrollView>
  )
}

/**
 * The Ask (S1, I1, docs/features/ai.md): what was typed, offered as a request.
 * At the top when nothing on the device matches, so it is the obvious next
 * step and what Enter does; under the matches otherwise, out of the way of a
 * plain search.
 */
function AskCard({
  words,
  first,
  onAsk,
}: {
  words: string
  first: boolean
  onAsk: () => void
}): ReactNode {
  return (
    <NavRow
      card
      icon={<Sparkle />}
      accent
      title={`Ask for “${words}”`}
      hint={ASK_SUB}
      role="button"
      accessibilityLabel={`Ask: ${words}`}
      onPress={onAsk}
      style={[styles.ask, !first && styles.askAfter]}
      testID="search-ask"
    />
  )
}

/** Before anything is typed: your tags and what you played last. No history is kept. */
function BeforeTyping({
  tags,
  recent,
  selection,
  listPadding,
}: {
  tags: readonly Tag[]
  recent: readonly Song[]
  selection: Selection
  /** Room under the last row for a phone's selection bar. */
  listPadding: ViewStyle | undefined
}): ReactNode {
  const openTag = useOpenTag()
  return (
    <ScrollView contentContainerStyle={[styles.results, listPadding]}>
      {tags.length > 0 ? (
        <View style={styles.section}>
          <SectionHead title="Your tags" style={styles.sectionHead} />
          <View style={styles.chips}>
            {tags.map(tag => (
              <Chip
                key={tag.id}
                label={tag.name}
                hue={tag.hue}
                selected={false}
                onPress={() => openTag(tag)}
              />
            ))}
          </View>
        </View>
      ) : null}
      {recent.length > 0 ? (
        <View style={styles.section}>
          <SectionHead title="Recently played" style={styles.sectionHead} />
          <SongRows songs={recent} selection={selection} testPrefix="search-recent" />
        </View>
      ) : null}
      <ChromeSpacer />
    </ScrollView>
  )
}

/** All: artists and tags, then songs, then lyric lines, a few of each (`S3`). */
function AllResults({
  found,
  lyricHits,
  selection,
  onSeeAll,
  onArtist,
  adds,
}: {
  found: ReturnType<typeof searchLibrary>
  lyricHits: readonly LyricsSearchHit[]
  selection: Selection
  onSeeAll: (section: SearchSection) => void
  onArtist: (artist: Artist) => void
  /** Adding to a room: songs are added, and tags and artists, which open pages, are left out. */
  adds: RoomAdds | null
}): ReactNode {
  const all = allResults(found)
  const places = adds ? [] : all.places
  const songs = all.songs
  return (
    <>
      {places.length > 0 ? (
        <View style={styles.section}>
          <SectionHead
            title={SECTION_TITLES.places}
            style={styles.sectionHead}
            action={
              found.artists.length + found.tags.length > places.length
                ? { label: 'See all', onPress: () => onSeeAll('places') }
                : null
            }
            testID="search-see-all-places"
          />
          <Places places={places} onArtist={onArtist} />
        </View>
      ) : null}
      {songs.length > 0 ? (
        <View style={styles.section}>
          <SectionHead
            title={SECTION_TITLES.songs}
            style={styles.sectionHead}
            action={
              found.songs.length > songs.length
                ? { label: 'See all', onPress: () => onSeeAll('songs') }
                : null
            }
            testID="search-see-all-songs"
          />
          <SongRows songs={songs} selection={selection} testPrefix="search-song" adds={adds} />
        </View>
      ) : null}
      {lyricHits.length > 0 ? (
        <View style={styles.section}>
          <SectionHead
            title={SECTION_TITLES.lyrics}
            style={styles.sectionHead}
            action={
              lyricHits.length > ALL_LIMITS.lyrics
                ? { label: 'See all', onPress: () => onSeeAll('lyrics') }
                : null
            }
            testID="search-see-all-lyrics"
          />
          <LyricResults hits={lyricHits.slice(0, ALL_LIMITS.lyrics)} away={false} adds={adds} />
        </View>
      ) : null}
    </>
  )
}

/** Artists and tags, each opening its page. */
function Places({
  places,
  onArtist,
}: {
  places: readonly SearchPlace[]
  onArtist: (artist: Artist) => void
}): ReactNode {
  const openTag = useOpenTag()
  return places.map(place =>
    place.kind === 'artist' ? (
      <PlaceLine
        key={`artist-${place.artist.key}`}
        place={place}
        onPress={() => onArtist(place.artist)}
        style={styles.place}
      />
    ) : (
      <PlaceLine
        key={`tag-${place.tag.id}`}
        place={place}
        onPress={() => openTag(place.tag)}
        style={styles.place}
      />
    ),
  )
}

/** What a search with no results says. */
function NothingMatches({ words }: { words: string }): ReactNode {
  return (
    <EmptyState
      compact
      testID="search-nothing"
      title={`Nothing matches “${clipText(words)}”`}
      // Fewer letters than two is nothing left to search with.
      line={[...words].length > 2 ? 'Try fewer letters.' : 'Try other words.'}
    />
  )
}

/** Songs opened alone: every match, in a list that only draws what is on screen. */
function SongResults({
  songs,
  query,
  selection,
  listPadding,
  adds,
}: {
  songs: readonly Song[]
  query: string
  selection: Selection
  listPadding: ViewStyle | undefined
  adds: RoomAdds | null
}): ReactNode {
  const rows = useSearchRows(songs, selection, 'search-song')
  const renderPick = useCallback(
    ({ item, index }: { item: Song; index: number }) =>
      adds ? <MySongPick song={item} adds={adds} testID={`search-song-${index}`} /> : <></>,
    [adds],
  )
  return (
    <>
      <SongList
        arrivalKey={query.trim()}
        songs={songs}
        label="Search songs"
        renderSong={adds ? renderPick : rows.renderSong}
        listRef={rows.listRef}
        contentContainerStyle={[styles.songList, listPadding]}
        empty={<NothingMatches words={query.trim()} />}
      />
      {rows.menu}
    </>
  )
}

/** A short list of songs, drawn in place: the recent few, All's best five. */
function SongRows({
  songs,
  selection,
  testPrefix,
  adds = null,
}: {
  songs: readonly Song[]
  selection: Selection
  testPrefix: string
  adds?: RoomAdds | null
}): ReactNode {
  const rows = useSearchRows(songs, selection, testPrefix)
  if (adds) {
    return songs.map((song, index) => (
      <MySongPick key={song.id} song={song} adds={adds} testID={`${testPrefix}-${index}`} />
    ))
  }
  return (
    <>
      {songs.map((song, index) => rows.renderSong({ item: song, index }))}
      {rows.menu}
    </>
  )
}

/**
 * Search's rows: a row plays the songs it is among, from itself, and Up next
 * says they came from Search. Search is one of the lists that shows tags on
 * its rows (`S3`).
 */
function useSearchRows(
  songs: readonly Song[],
  selection: Selection,
  testPrefix: string,
): ReturnType<typeof useSongRows> {
  const player = usePlayerCommands()
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  return useSongRows({
    songs,
    selection,
    onPlay: index => player.playFrom(ids, index, { source: FROM_SEARCH }),
    testPrefix,
    withTags: true,
  })
}

/** Lines of lyrics: the words around the match, and the song they are in. */
function LyricResults({
  hits,
  away,
  adds,
}: {
  hits: readonly LyricsSearchHit[]
  /** A cloud library whose server is out of reach, so there are no lines to show. */
  away: boolean
  /** Adding to a room: a line adds its song rather than playing it. */
  adds: RoomAdds | null
}): ReactNode {
  const player = usePlayerCommands()
  const artFor = useArt(ROW_COVER_SIZE)
  const accent = useAccent()
  const byId = useSongsById()
  if (away) {
    return (
      <EmptyState
        compact
        title="Lyrics can’t be searched right now"
        line="Searching lyrics needs your library’s computer, which this device can’t reach right now."
      />
    )
  }
  return (
    <>
      {hits.map((hit, index) => {
        const song = byId.get(hit.songId)
        return (
          <Press
            feedback="wash"
            key={`${hit.songId}-${index}`}
            testID={`search-lyric-${index}`}
            onPress={() => {
              if (!adds) player.playFrom([hit.songId], 0, { source: FROM_SEARCH })
              else if (song) {
                adds.add(song)
                showToast({ over: 'Added', say: hit.title }, 'good', {
                  songs: [song],
                  group: 'search-added',
                })
              }
            }}
            accessibilityRole="button"
            accessibilityLabel={`${hit.title}: ${hit.line}`}
            style={styles.lyric}
          >
            <Cover uri={song ? artFor(song) : null} title={hit.title} size={coverSize.line} />
            <View style={styles.lyricText}>
              <Text style={styles.lyricLine} numberOfLines={2}>
                {hit.before}
                <Text style={{ color: accent.accent }}>{hit.match}</Text>
                {hit.after}
              </Text>
              <Text style={styles.lyricSong} numberOfLines={1}>
                {hit.title}
                {hit.artist ? ` · ${hit.artist}` : ''}
              </Text>
            </View>
          </Press>
        )
      })}
    </>
  )
}

/** The column a computer's Search keeps to, whatever the page's width. */
const COLUMN = 760

const styles = StyleSheet.create(theme => ({
  // In from the results' edge as far as the rows' own inset, so its sides
  // meet the field's and the rows' rather than standing 8 px out past them.
  ask: { marginHorizontal: space.sm },
  askAfter: { marginTop: space.md },
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { flex: 1 },
  // The field's row starts where every page's first row does (`PAGE_TOP_WIDE`).
  pageWide: {
    maxWidth: COLUMN,
    width: '100%',
    alignSelf: 'center',
    paddingTop: PAGE_TOP_WIDE - PAGE_TOP_PHONE,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: PAGE_TOP_PHONE,
  },
  field: { flex: 1 },
  cancel: { color: theme.colors.accent, fontSize: type.body, fontWeight: '600' },
  // Where the songs found here go, while adding to a room (A2).
  adding: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.item,
    backgroundColor: theme.colors.accentPill,
  },
  addingText: { color: theme.colors.accent, fontSize: type.sub, fontWeight: '600' },
  headGap: { height: 14 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.tight,
    marginHorizontal: space.sm,
    marginVertical: space.tight,
    paddingVertical: space.sm,
    paddingLeft: space.tight,
    paddingRight: space.md,
    borderRadius: radius.item,
  },
  backTitle: rowTitle(theme.colors),
  backCount: { color: theme.colors.textMuted, fontSize: type.body },
  results: { paddingHorizontal: space.sm, gap: 18 },
  songList: { paddingHorizontal: 0 },
  section: { gap: space.xs },
  sectionHead: { paddingHorizontal: space.sm, paddingBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.sm },
  // A place's line, the height of a lyric's beside it.
  place: { paddingVertical: space.sm },
  lyricSong: { color: theme.colors.textSecondary, fontSize: type.sub },
  lyric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.item,
  },
  lyricText: textColumn,
  lyricLine: { color: theme.colors.textPrimary, fontSize: type.body },
}))
