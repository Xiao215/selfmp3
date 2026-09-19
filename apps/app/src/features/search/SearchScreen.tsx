import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import type { LyricsSearchHit, Song, Tag } from '@selfmp3/shared'
import {
  clientApi,
  isDownloaded,
  queryKeys,
  radius,
  tagColors,
  useLibrary,
  type Artist,
} from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Chip } from '../../ui/components/Chip'
import { Cover } from '../../ui/components/Cover'
import { ChevronRight, Search, User, X } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SongList } from '../../ui/components/SongList'
import { SongMenu } from '../../ui/components/SongMenu'
import { SongRow } from '../../ui/components/SongRow'
import { useDebounced } from '../../ui/useDebounced'
import { label as labelText } from '../../ui/surfaces'
import { artistLink, tagLink } from '../tag/placeLinks'
import { noteTagUsed } from '../library/recentTags.store'
import {
  ALL_LIMITS,
  allResults,
  beforeTyping,
  lyricsQueryFor,
  parseScope,
  scopeCounts,
  searchLibrary,
  SEARCH_SCOPES,
  type SearchScope,
} from './search.model'

/**
 * Search (docs/ui-mock `P18`, `P19`): one page, whichever door it was opened
 * from. `?scope=` is the scope it starts on and `?q=` what it starts with; the
 * rest is this page's own. A computer draws the same search as the palette
 * over its page (`C05`); this page is what a phone opens, and what a computer
 * shows for anyone who types the address.
 */
export function SearchScreen(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const params = useLocalSearchParams<{ scope?: string; q?: string }>()
  const { wide } = useLayout()
  const { fromCloud } = useConnection()
  const { data: library } = useLibrary()
  const player = usePlayer()

  const [query, setQuery] = useState(() => (typeof params.q === 'string' ? params.q : ''))
  const [scope, setScope] = useState<SearchScope>(() => parseScope(params.scope))
  const [focused, setFocused] = useState(false)
  // The field keeps up with the fingers; the results, a search of the whole
  // library, follow when there is time.
  const shown = useDeferredValue(query)
  const typed = shown.trim() !== ''

  const found = useMemo(() => searchLibrary(shown, library), [shown, library])
  const currentId = player.current?.id ?? null
  const empty = useMemo(() => beforeTyping(library, currentId), [library, currentId])

  const lyricsQuery = lyricsQueryFor(useDebounced(query, 180))
  const lyrics = useQuery({
    queryKey: queryKeys.lyricsSearch(lyricsQuery),
    queryFn: () => clientApi().lyricsSearch(lyricsQuery, 20),
    // The lyrics index is the server's; a library in the cloud has no words to search.
    enabled: lyricsQuery !== '' && !fromCloud,
    retry: false,
    staleTime: 60_000,
    placeholderData: previous => previous,
  })
  const lyricHits = typed && lyricsQuery ? (lyrics.data?.hits ?? []) : []
  const counts = scopeCounts(found, lyricHits.length)

  const openArtist = useCallback(
    (artist: Artist) => router.navigate(artistLink(artist.name)),
    [router],
  )

  const close = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={[styles.page, wide && styles.pageWide]} testID="search-screen">
        <View style={styles.head}>
          <View style={[styles.field, focused && { borderColor: accent.accent }]}>
            <Search size={18} color={focused ? accent.accent : theme.colors.textSecondary} />
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Songs, tags, artists, lyrics"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="search"
              accessibilityLabel="Search"
              testID="search-field"
              style={styles.input}
            />
            {query ? (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <X size={16} tone="textMuted" />
              </Pressable>
            ) : null}
          </View>
          <Pressable onPress={close} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scopes}
          style={styles.scopesRow}
          keyboardShouldPersistTaps="handled"
        >
          {SEARCH_SCOPES.map(option => (
            <Chip
              key={option.value}
              testID={`search-scope-${option.value}`}
              label={
                typed && option.value !== 'all'
                  ? `${option.label} · ${counts[option.value]}`
                  : option.label
              }
              selected={scope === option.value}
              onPress={() => setScope(option.value)}
            />
          ))}
        </ScrollView>

        {!typed ? (
          <BeforeTyping tags={empty.tags} recent={empty.recent} />
        ) : scope === 'songs' ? (
          <SongResults songs={found.songs} query={shown} />
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.results}
          >
            {scope === 'all' ? (
              <AllResults
                found={found}
                lyricHits={lyricHits}
                onSeeAll={setScope}
                onArtist={openArtist}
                query={shown}
              />
            ) : scope === 'tags' ? (
              found.tags.map(tag => <TagResult key={tag.id} tag={tag} />)
            ) : scope === 'artists' ? (
              found.artists.map(artist => (
                <ArtistResult key={artist.key} artist={artist} onOpen={openArtist} />
              ))
            ) : (
              <LyricResults hits={lyricHits} cloud={fromCloud} />
            )}
            {counts[scope] === 0 && !(scope === 'lyrics' && fromCloud) ? (
              <Text style={styles.nothing}>Nothing matches “{shown.trim()}”.</Text>
            ) : null}
            <ChromeSpacer />
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  )
}

/** Before anything is typed: your tags and what you played last. No history is kept. */
function BeforeTyping({
  tags,
  recent,
}: {
  tags: readonly Tag[]
  recent: readonly Song[]
}): ReactNode {
  const openTag = useOpenTag()
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.results}>
      {tags.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.label}>Your tags</Text>
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
          <Text style={styles.label}>Recently played</Text>
          <SongRows songs={recent} testPrefix="search-recent" />
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
  onSeeAll,
  onArtist,
  query,
}: {
  found: ReturnType<typeof searchLibrary>
  lyricHits: readonly LyricsSearchHit[]
  onSeeAll: (scope: SearchScope) => void
  onArtist: (artist: Artist) => void
  query: string
}): ReactNode {
  const { places, songs } = allResults(found)
  return (
    <>
      {places.length > 0 ? (
        <View style={styles.section}>
          {places.map(place =>
            place.kind === 'artist' ? (
              <ArtistResult
                key={`artist-${place.artist.key}`}
                artist={place.artist}
                onOpen={onArtist}
              />
            ) : (
              <TagResult key={`tag-${place.tag.id}`} tag={place.tag} />
            ),
          )}
        </View>
      ) : null}
      {songs.length > 0 ? (
        <View style={styles.section}>
          <SectionHead
            title="Songs"
            more={found.songs.length > songs.length ? () => onSeeAll('songs') : null}
          />
          <SongRows songs={songs} testPrefix="search-song" query={query} />
        </View>
      ) : null}
      {lyricHits.length > 0 ? (
        <View style={styles.section}>
          <SectionHead
            title="Lyrics"
            more={lyricHits.length > ALL_LIMITS.lyrics ? () => onSeeAll('lyrics') : null}
          />
          <LyricResults hits={lyricHits.slice(0, ALL_LIMITS.lyrics)} cloud={false} />
        </View>
      ) : null}
    </>
  )
}

function SectionHead({ title, more }: { title: string; more: (() => void) | null }): ReactNode {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.label}>{title}</Text>
      {more ? (
        <Pressable onPress={more} accessibilityRole="button" hitSlop={8} style={styles.seeAll}>
          <Text style={styles.seeAllText}>See all</Text>
          <ChevronRight size={12} tone="accent" />
        </Pressable>
      ) : null}
    </View>
  )
}

/** A tag opens its page. */
function useOpenTag(): (tag: Tag) => void {
  const router = useRouter()
  return useCallback(
    (tag: Tag) => {
      noteTagUsed(tag.id)
      router.navigate(tagLink(tag.name))
    },
    [router],
  )
}

function TagResult({ tag }: { tag: Tag }): ReactNode {
  const openTag = useOpenTag()
  return (
    <Pressable
      onPress={() => openTag(tag)}
      accessibilityRole="button"
      accessibilityLabel={`${tag.name}, tag, ${tag.songCount} songs`}
      style={({ pressed }) => [styles.place, pressed && styles.pressed]}
    >
      <View style={styles.figure}>
        <View style={[styles.dot, { backgroundColor: tagColors(tag.hue).dot }]} />
      </View>
      <Text style={styles.placeName} numberOfLines={1}>
        {tag.name}
      </Text>
      <Text style={styles.placeHint}>
        {tag.songCount} {tag.songCount === 1 ? 'song' : 'songs'} · tag
      </Text>
    </Pressable>
  )
}

/** An artist: a figure where a tag has its dot. */
function ArtistResult({
  artist,
  onOpen,
}: {
  artist: Artist
  onOpen: (artist: Artist) => void
}): ReactNode {
  const count = artist.songIds.length
  return (
    <Pressable
      onPress={() => onOpen(artist)}
      accessibilityRole="button"
      accessibilityLabel={`${artist.name}, artist, ${count} songs`}
      style={({ pressed }) => [styles.place, pressed && styles.pressed]}
    >
      <View style={styles.figure}>
        <User size={15} tone="textSecondary" />
      </View>
      <Text style={styles.placeName} numberOfLines={1}>
        {artist.name}
      </Text>
      <Text style={styles.placeHint}>
        {count} {count === 1 ? 'song' : 'songs'} · artist
      </Text>
    </Pressable>
  )
}

/** The Songs scope: every match, in a list that only draws what is on screen. */
function SongResults({ songs, query }: { songs: readonly Song[]; query: string }): ReactNode {
  const rows = useSongRows(songs, 'search-song', query)
  return (
    <>
      <SongList
        songs={songs}
        label="Search songs"
        renderSong={rows.renderSong}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.songList}
        empty={<Text style={styles.nothing}>Nothing matches “{query.trim()}”.</Text>}
      />
      {rows.menu}
    </>
  )
}

/** A short list of songs, drawn in place: the recent few, All's best five. */
function SongRows({
  songs,
  testPrefix,
  query = '',
}: {
  songs: readonly Song[]
  testPrefix: string
  query?: string
}): ReactNode {
  const rows = useSongRows(songs, testPrefix, query)
  return (
    <>
      {songs.map((song, index) => rows.renderSong({ item: song, index }))}
      {rows.menu}
    </>
  )
}

/** Rows that play from this list, with the song's own ⋯ menu. */
function useSongRows(
  songs: readonly Song[],
  testPrefix: string,
  query: string,
): {
  renderSong: (info: { item: Song; index: number }) => ReactElement
  menu: ReactNode
} {
  const player = usePlayer()
  const artFor = useArt()
  const { state: downloads } = useDownloads()
  const [menuSong, setMenuSong] = useState<Song | null>(null)
  const anchor = useRef<View | null>(null)
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  // What a row plays from, read when it is pressed, so the handler handed to
  // every row stays the same one and the rows are not redrawn for a new list.
  const latest = useRef({ ids, playFrom: player.playFrom })
  useEffect(() => {
    latest.current = { ids, playFrom: player.playFrom }
  }, [ids, player.playFrom])

  const onPress = useCallback((_event: GestureResponderEvent, song: Song) => {
    const { ids: now, playFrom } = latest.current
    const index = now.indexOf(song.id)
    if (index >= 0) playFrom(now, index)
  }, [])
  const onMore = useCallback((node: View | null, song: Song) => {
    anchor.current = node
    setMenuSong(current => (current?.id === song.id ? null : song))
  }, [])

  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <SongRow
        key={item.id}
        testID={`${testPrefix}-${index}`}
        song={item}
        artUri={artFor(item)}
        downloaded={isDownloaded(downloads.index, item.id)}
        onPress={onPress}
        onMore={onMore}
        menuOpen={menuSong?.id === item.id}
        index={index}
      />
    ),
    // The query is not drawn, but a new one is a new list: rows re-key with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [artFor, downloads.index, onPress, onMore, menuSong, testPrefix, query],
  )

  return {
    renderSong,
    menu: <SongMenu song={menuSong} anchorRef={anchor} onClose={() => setMenuSong(null)} />,
  }
}

/** Lines of lyrics: the words around the match, and the song they are in. */
function LyricResults({
  hits,
  cloud,
}: {
  hits: readonly LyricsSearchHit[]
  cloud: boolean
}): ReactNode {
  const { data: library } = useLibrary()
  const player = usePlayer()
  const artFor = useArt()
  const accent = useAccent()
  if (cloud) {
    return (
      <Text style={styles.nothing}>
        Lyrics are searched on your server, which a cloud library does not reach from here.
      </Text>
    )
  }
  return (
    <>
      {hits.map((hit, index) => {
        const song = library?.songs.find(entry => entry.id === hit.songId)
        return (
          <Pressable
            key={`${hit.songId}-${index}`}
            testID={`search-lyric-${index}`}
            onPress={() => player.playFrom([hit.songId], 0)}
            accessibilityRole="button"
            accessibilityLabel={`${hit.title}: ${hit.line}`}
            style={({ pressed }) => [styles.lyric, pressed && styles.pressed]}
          >
            <Cover uri={song ? artFor(song) : null} title={hit.title} size={40} />
            <View style={styles.lyricText}>
              <Text style={styles.lyricLine} numberOfLines={2}>
                {hit.before}
                <Text style={{ color: accent.accent }}>{hit.match}</Text>
                {hit.after}
              </Text>
              <Text style={styles.placeHint} numberOfLines={1}>
                {hit.title}
                {hit.artist ? ` · ${hit.artist}` : ''}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { flex: 1 },
  pageWide: { maxWidth: 760, width: '100%', alignSelf: 'center', paddingTop: 24 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  field: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface1,
    // Clear at rest, the accent while typing: the focus ring, not a hairline.
    borderWidth: 1.5,
    borderColor: theme.colors.surface1,
  },
  input: { flex: 1, minWidth: 0, color: theme.colors.textPrimary, fontSize: 16 },
  cancel: { color: theme.colors.accent, fontSize: 15, fontWeight: '600' },
  scopesRow: { flexGrow: 0 },
  scopes: { gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  results: { paddingHorizontal: 8, gap: 18 },
  songList: { paddingHorizontal: 0 },
  section: { gap: 4 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  label: { ...labelText(theme.colors), paddingHorizontal: 8, paddingBottom: 6 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingBottom: 6 },
  seeAllText: { color: theme.colors.accent, fontSize: 13, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 8 },
  place: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  pressed: { backgroundColor: theme.colors.surface1 },
  figure: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  placeName: { flex: 1, color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  placeHint: { color: theme.colors.textSecondary, fontSize: 13 },
  lyric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  lyricText: { flex: 1, minWidth: 0, gap: 2 },
  lyricLine: { color: theme.colors.textPrimary, fontSize: 15 },
  nothing: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
}))
