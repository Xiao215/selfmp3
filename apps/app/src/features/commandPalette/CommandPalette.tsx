import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { formatDuration } from '@selfmp3/shared'
import {
  clientApi,
  oklchToHexAlpha,
  queryKeys,
  radius,
  tagColors,
  useLibrary,
  useScanLibrary,
} from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { useConnection } from '../../connection/ConnectionProvider'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Cover } from '../../ui/components/Cover'
import {
  BarChart,
  Download,
  ListMusic,
  Mic,
  Music,
  Refresh,
  Search,
  Settings,
  Shuffle,
  Tag,
  User,
} from '../../ui/components/Icons'
import { useDebounced } from '../../ui/useDebounced'
import { floating, label as labelText } from '../../ui/surfaces'
import { noteTagUsed } from '../library/recentTags.store'
import { lyricsQueryFor } from '../search/search.model'
import { artistLink, tagLink } from '../tag/placeLinks'
import { usePlayAndTag } from '../tag/usePlayAndTag'
import {
  paletteResults,
  stepIndex,
  type PaletteCommandId,
  type PaletteResults,
  type RecentItem,
} from './commandPalette.model'

interface Entry {
  readonly key: string
  readonly run: () => void
}

/**
 * The command palette.
 *
 * One box that searches songs, playlists, tags and lyrics and also runs
 * commands. Arrow keys move through every group as one list, Enter takes the
 * highlighted row, Escape closes. It is the fastest way to anything on a big
 * library, which is why it exists at all. The sidebar's Search row opens it,
 * and in the installed app so does ⌘K; a browser tab leaves ⌘K to the browser.
 *
 * Opened with nothing typed it leads with what was played lately, since the
 * thing most often looked for is the thing just heard.
 */
export function CommandPalette({ onClose }: { onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const pathname = usePathname()
  const player = usePlayer()
  const library = useLibrary()
  const scan = useScanLibrary()
  const artFor = useArt()
  const { fromCloud } = useConnection()
  const { finePointer } = useLayout()
  const window = useWindowDimensions()
  const playAndTag = usePlayAndTag()
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  useEscape(true, onClose, { layer: true })

  const songs = useMemo(() => library.data?.songs ?? [], [library.data])
  const songIds = useMemo(() => songs.map(song => song.id), [songs])
  // The box keeps up with the fingers; the results, a search of the whole
  // library, follow when there is time, and are skipped for letters typed
  // faster than they can be drawn.
  const shownQuery = useDeferredValue(query)
  const currentSongId = player.current?.id ?? null
  const resultsFor = (text: string) =>
    paletteResults(text, library.data, fromCloud, { pathname, currentSongId })
  const results = useMemo(
    () => paletteResults(shownQuery, library.data, fromCloud, { pathname, currentSongId }),
    [shownQuery, library.data, fromCloud, pathname, currentSongId],
  )

  const lyricsQuery = lyricsQueryFor(useDebounced(query, 180))
  const lyrics = useQuery({
    queryKey: queryKeys.lyricsSearch(lyricsQuery),
    queryFn: () => clientApi().lyricsSearch(lyricsQuery, 6),
    // The lyrics index is the server's; a library in the cloud has no words to search.
    enabled: lyricsQuery !== '' && !fromCloud,
    retry: false,
    staleTime: 60_000,
    placeholderData: previous => previous,
  })
  const lyricHits = lyricsQuery ? (lyrics.data?.hits ?? []) : []

  const runCommand = (id: PaletteCommandId): void => {
    switch (id) {
      case 'nav-library':
        router.navigate('/library')
        return
      case 'nav-playlists':
        router.navigate('/playlists')
        return
      case 'nav-import':
        router.navigate('/import')
        return
      case 'nav-stats':
        router.navigate('/stats')
        return
      case 'tag-untagged':
        playAndTag.start()
        return
      case 'nav-settings':
        router.navigate('/settings')
        return
      case 'shuffle-all':
        player.playShuffled(songIds)
        return
      case 'rescan-library':
        scan.mutate()
        return
    }
  }
  const playSong = (songId: number): void => {
    const index = songIds.indexOf(songId)
    if (index >= 0) player.playFrom(songIds, index)
  }
  const openPlaylist = (playlistId: number): void => router.navigate(`/playlists/${playlistId}`)
  /** The loaded song carries on where it is rather than starting again. */
  const runRecent = (recent: RecentItem): void => {
    if (recent.kind === 'playlist') openPlaylist(recent.playlist.id)
    else if (recent.song.id === currentSongId) {
      if (!player.isPlaying) player.toggle()
    } else playSong(recent.song.id)
  }
  const recentKey = (recent: RecentItem): string =>
    recent.kind === 'song'
      ? `recent-song-${recent.song.id}`
      : `recent-playlist-${recent.playlist.id}`

  /** One flat list of everything selectable, so arrow keys work across groups. */
  /**
   * One flat list of everything selectable, so arrow keys work across groups,
   * in the order the groups are drawn (`C05`): what was played lately, then
   * artists and tags, songs, lines of lyrics, playlists, and the commands last.
   */
  const entriesFor = (found: PaletteResults): Entry[] => [
    ...found.recent.map(recent => ({ key: recentKey(recent), run: () => runRecent(recent) })),
    ...found.artists.map(artist => ({
      key: `artist-${artist.key}`,
      run: () => router.navigate(artistLink(artist.name)),
    })),
    ...found.tags.map(tag => ({
      key: `tag-${tag.id}`,
      // A tag is a place (docs/UI-MIGRATION.md, Phase 4): the hit opens its
      // page, and counts as a use so the rail keeps it near the top.
      run: () => {
        noteTagUsed(tag.id)
        router.navigate(tagLink(tag.name))
      },
    })),
    ...found.songs.map(song => ({ key: `song-${song.id}`, run: () => playSong(song.id) })),
    ...lyricHits.map(hit => ({ key: `lyric-${hit.songId}`, run: () => playSong(hit.songId) })),
    ...found.playlists.map(playlist => ({
      key: `playlist-${playlist.id}`,
      run: () => openPlaylist(playlist.id),
    })),
    ...found.commands.map(command => ({ key: command.id, run: () => runCommand(command.id) })),
  ]
  const entries = entriesFor(results)
  const active = Math.min(highlighted, Math.max(0, entries.length - 1))
  // Keep the highlighted row in view as the arrow keys move through a long list.
  const rows = useRef(new Map<number, unknown>())
  useEffect(() => {
    const row = rows.current.get(active) as
      { scrollIntoView?: (options: { block: 'nearest' }) => void } | undefined
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const activate = (index: number): void => {
    entries[index]?.run()
    onClose()
  }

  let cursor = 0
  const item = (content: ReactNode, key: string, label: string): ReactNode => {
    const index = cursor++
    const on = index === active
    return (
      <Pressable
        key={key}
        ref={node => {
          rows.current.set(index, node)
        }}
        role="option"
        aria-selected={on}
        accessibilityLabel={label}
        onHoverIn={() => setHighlighted(index)}
        onPress={() => activate(index)}
        style={[styles.item, on && styles.itemOn]}
      >
        {content}
      </Pressable>
    )
  }
  const group = (title: string, count: number, children: ReactNode): ReactNode =>
    count > 0 ? (
      <View style={styles.group} key={title}>
        <View style={styles.groupTitle}>
          <Text style={styles.groupText}>{title.toUpperCase()}</Text>
          <Text style={[styles.groupText, styles.groupCount]}>{count}</Text>
        </View>
        {children}
      </View>
    ) : null

  const icon = (Glyph: typeof Music): ReactNode => (
    <Glyph size={16} color={theme.colors.textSecondary} />
  )
  const commandIcon: Record<PaletteCommandId, ReactNode> = {
    'nav-library': icon(Music),
    'nav-playlists': icon(ListMusic),
    'nav-import': icon(Download),
    'nav-stats': icon(BarChart),
    'tag-untagged': icon(Tag),
    'nav-settings': icon(Settings),
    'shuffle-all': icon(Shuffle),
    'rescan-library': icon(Refresh),
  }
  // What the results below were found for, so the count and "nothing matches"
  // never describe a query the list has not caught up with.
  const trimmed = shownQuery.trim()

  useOverlay(
    <View
      style={[
        styles.backdrop,
        {
          paddingTop: window.height * (finePointer ? 0.14 : 0.06),
          backgroundColor: oklchToHexAlpha(0.1, 0.02, accent.hue, 0.6),
        },
      ]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View
        role="dialog"
        aria-label="Command palette"
        style={[
          styles.panel,
          { width: Math.min(620, window.width * 0.92), maxHeight: window.height * 0.66 },
        ]}
      >
        <View style={styles.inputRow}>
          <Search size={18} color={theme.colors.textMuted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={text => {
              setQuery(text)
              setHighlighted(0)
            }}
            onKeyPress={event => {
              const key = event.nativeEvent.key
              if (key !== 'ArrowDown' && key !== 'ArrowUp') return
              ;(event as unknown as { preventDefault: () => void }).preventDefault()
              setHighlighted(stepIndex(active, key === 'ArrowDown' ? 1 : -1, entries.length))
            }}
            onSubmitEditing={() => {
              // Enter straight after a letter can beat the deferred results to
              // the screen. It means what was typed, so it takes the first row
              // of that — the highlight is back at the top after any letter.
              if (shownQuery === query) activate(active)
              else {
                entriesFor(resultsFor(query))[0]?.run()
                onClose()
              }
            }}
            placeholder="Search songs, playlists, tags — or type a command"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            role="combobox"
            aria-expanded
            aria-label="Search songs, playlists and tags, or type a command"
            style={styles.input}
          />
          {trimmed ? (
            <Text style={styles.count} accessibilityLiveRegion="polite">
              {entries.length} {entries.length === 1 ? 'result' : 'results'}
            </Text>
          ) : null}
        </View>

        <ScrollView
          // A listbox, so its options read as one list's choices. React
          // Native's Role type has no "listbox"; react-native-web renders it.
          {...({ role: 'listbox' } as object)}
          contentContainerStyle={styles.results}
          keyboardShouldPersistTaps="handled"
        >
          {group(
            'Recent',
            results.recent.length,
            results.recent.map(recent =>
              recent.kind === 'song'
                ? item(
                    <>
                      <Cover
                        uri={artFor(recent.song)}
                        title={recent.song.album || recent.song.title}
                        size={28}
                      />
                      <View style={styles.labelBox}>
                        <Text style={styles.label} numberOfLines={1}>
                          {recent.song.title}
                        </Text>
                        <Text style={styles.sub} numberOfLines={1}>
                          {recent.song.artist || 'Unknown artist'}
                        </Text>
                      </View>
                      <Text style={styles.hint}>
                        {recent.song.id === currentSongId ? 'playing now' : 'song'}
                      </Text>
                    </>,
                    recentKey(recent),
                    `${recent.song.title}, ${recent.song.artist || 'Unknown artist'}`,
                  )
                : item(
                    <>
                      {icon(ListMusic)}
                      <Text style={styles.label} numberOfLines={1}>
                        {recent.playlist.name}
                      </Text>
                      <Text style={styles.hint}>playlist</Text>
                    </>,
                    recentKey(recent),
                    recent.playlist.name,
                  ),
            ),
          )}
          {group(
            'Artists and tags',
            results.artists.length + results.tags.length,
            <>
              {results.artists.map(artist =>
                item(
                  <>
                    <View style={styles.figure}>{icon(User)}</View>
                    <Text style={styles.label} numberOfLines={1}>
                      {artist.name}
                    </Text>
                    <Text style={styles.hint}>
                      {artist.songIds.length} {artist.songIds.length === 1 ? 'song' : 'songs'} ·
                      artist
                    </Text>
                  </>,
                  `artist-${artist.key}`,
                  `${artist.name}, artist`,
                ),
              )}
              {results.tags.map(tag =>
                item(
                  <>
                    <View style={styles.figure}>
                      <View style={[styles.dot, { backgroundColor: tagColors(tag.hue).dot }]} />
                    </View>
                    <Text style={styles.label} numberOfLines={1}>
                      {tag.name}
                    </Text>
                    <Text style={styles.hint}>
                      {tag.songCount} {tag.songCount === 1 ? 'song' : 'songs'} · tag
                    </Text>
                  </>,
                  `tag-${tag.id}`,
                  `${tag.name}, tag`,
                ),
              )}
            </>,
          )}
          {group(
            'Songs',
            results.songs.length,
            results.songs.map(song =>
              item(
                <>
                  <Cover uri={artFor(song)} title={song.album || song.title} size={28} />
                  <View style={styles.labelBox}>
                    <Text style={styles.label} numberOfLines={1}>
                      {song.title}
                    </Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {song.artist || 'Unknown artist'}
                    </Text>
                  </View>
                  <Text style={styles.hint}>{formatDuration(song.duration)}</Text>
                </>,
                `song-${song.id}`,
                `${song.title}, ${song.artist || 'Unknown artist'}`,
              ),
            ),
          )}
          {group(
            'Lyrics',
            lyricHits.length,
            lyricHits.map(hit =>
              item(
                <>
                  {icon(Mic)}
                  <View style={styles.labelBox}>
                    <Text style={styles.label} numberOfLines={1}>
                      {hit.before}
                      {hit.match ? (
                        <Text style={[styles.mark, { color: accent.accent }]}>{hit.match}</Text>
                      ) : null}
                      {hit.after}
                    </Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {hit.title}
                      {hit.artist ? ` · ${hit.artist}` : ''}
                    </Text>
                  </View>
                </>,
                `lyric-${hit.songId}`,
                `${hit.title}: ${hit.before}${hit.match}${hit.after}`,
              ),
            ),
          )}
          {group(
            'Playlists',
            results.playlists.length,
            results.playlists.map(playlist =>
              item(
                <>
                  {icon(ListMusic)}
                  <Text style={styles.label} numberOfLines={1}>
                    {playlist.name}
                  </Text>
                  <Text style={styles.hint}>{playlist.songCount} songs</Text>
                </>,
                `playlist-${playlist.id}`,
                playlist.name,
              ),
            ),
          )}
          {group(
            'Actions',
            results.commands.length,
            results.commands.map(command =>
              item(
                <>
                  {commandIcon[command.id]}
                  <Text style={styles.label} numberOfLines={1}>
                    {command.label}
                  </Text>
                  {command.hint ? <Text style={styles.hint}>{command.hint}</Text> : null}
                </>,
                command.id,
                command.label,
              ),
            ),
          )}
          {trimmed && entries.length === 0 ? (
            <Text style={styles.empty}>
              Nothing matches “{trimmed}”.{'\n'}
              {/* A cloud library has no lyric index to search. */}
              {fromCloud ? 'Try fewer letters.' : 'Try fewer letters, or part of a lyric.'}
            </Text>
          ) : null}
        </ScrollView>

        {finePointer ? (
          <View style={styles.foot}>
            <Text style={styles.footText}>
              <Text style={styles.kbd}> ↑ </Text> <Text style={styles.kbd}> ↓ </Text> move
            </Text>
            <Text style={styles.footText}>
              <Text style={styles.kbd}> ↵ </Text> open
            </Text>
            <Text style={styles.footText}>
              <Text style={styles.kbd}> esc </Text> close
            </Text>
          </View>
        ) : null}
      </View>
    </View>,
    true,
  )

  return null
}

const styles = StyleSheet.create(theme => ({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  panel: {
    backgroundColor: theme.colors.surface1,
    borderRadius: radius.sheet,
    overflow: 'hidden',
    ...floating(theme.colors),
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 15,
    paddingHorizontal: 18,
  },
  input: { flex: 1, minWidth: 0, fontSize: 16, color: theme.colors.textPrimary, padding: 0 },
  count: { color: theme.colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  results: { padding: 6 },
  group: { marginBottom: 6 },
  groupTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingHorizontal: 10,
    paddingBottom: 5,
  },
  groupText: labelText(theme.colors),
  groupCount: { opacity: 0.75, letterSpacing: 0 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  // The highlighted row is a lighter surface; it no longer has an accent bar.
  itemOn: { backgroundColor: theme.colors.surface3 },
  labelBox: { flex: 1, minWidth: 0 },
  // An artist's figure or a tag's dot, in a round the size of a row's cover.
  figure: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { flex: 1, minWidth: 0, color: theme.colors.textSecondary, fontSize: 13 },
  mark: { fontWeight: '700' },
  sub: { color: theme.colors.textMuted, fontSize: 11 },
  hint: { color: theme.colors.textMuted, fontSize: 11 },
  empty: {
    color: theme.colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    padding: 20,
    lineHeight: 20,
  },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    // Set down a step from the panel: tone, not a rule.
    backgroundColor: theme.colors.surface0,
  },
  footText: { color: theme.colors.textMuted, fontSize: 11 },
  kbd: {
    fontSize: 10,
    color: theme.colors.textPrimary,
    backgroundColor: theme.colors.surface2,
    borderRadius: 5,
  },
}))
