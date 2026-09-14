import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { formatDuration } from '@selfmp3/shared'
import {
  clearTagFilter,
  clientApi,
  includeTag,
  oklchToHexAlpha,
  queryKeys,
  radius,
  useLibrary,
  useScanLibrary,
} from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { useConnection } from '../../server/ConnectionProvider'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Cover } from '../../ui/components/Cover'
import {
  BarChart,
  Inbox,
  ListMusic,
  Mic,
  Music,
  Refresh,
  Search,
  Settings,
  Shuffle,
  Tag,
} from '../../ui/components/Icons'
import { useDebounced } from '../../ui/useDebounced'
import { useSetLibraryFilter } from '../library/libraryFilter'
import {
  lyricsQueryFor,
  paletteResults,
  stepIndex,
  type PaletteCommandId,
  type PaletteResults,
} from './palette.model'

interface Entry {
  readonly key: string
  readonly run: () => void
}

/**
 * The ⌘K palette: the web's `CommandPalette`.
 *
 * One box that searches songs, playlists, tags and lyrics and also runs
 * commands. Arrow keys move through every group as one list, Enter takes the
 * highlighted row, Escape closes. It is the fastest way to anything on a big
 * library, which is why it exists at all.
 */
export function CommandPalette({ onClose }: { onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const player = usePlayer()
  const library = useLibrary()
  const scan = useScanLibrary()
  const artFor = useArt()
  const { fromCloud } = useConnection()
  const { finePointer } = useLayout()
  const window = useWindowDimensions()
  const setFilter = useSetLibraryFilter()
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  useEscape(true, onClose, { layer: true })

  const songs = useMemo(() => library.data?.songs ?? [], [library.data])
  const songIds = useMemo(() => songs.map(song => song.id), [songs])
  // The box keeps up with the fingers; the results, a search of the whole
  // library, follow when there is time, and are skipped for letters typed
  // faster than they can be drawn.
  const shownQuery = useDeferredValue(query)
  const resultsFor = (text: string) => paletteResults(text, library.data, fromCloud)
  const results = useMemo(
    () => paletteResults(shownQuery, library.data, fromCloud),
    [shownQuery, library.data, fromCloud],
  )

  const lyricsQuery = lyricsQueryFor(useDebounced(query, 180))
  const lyrics = useQuery({
    queryKey: queryKeys.lyricsSearch(lyricsQuery),
    queryFn: () => clientApi().lyricsSearch(lyricsQuery, 6),
    // The lyrics index is the Mac's; a library in the cloud has no words to search.
    enabled: lyricsQuery !== '' && !fromCloud,
    retry: false,
    staleTime: 60_000,
    placeholderData: previous => previous,
  })
  const lyricHits = lyricsQuery ? (lyrics.data?.hits ?? []) : []

  const runCommand = (id: PaletteCommandId): void => {
    switch (id) {
      case 'nav-library':
        router.navigate('/')
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
      case 'nav-inbox':
        router.navigate('/inbox')
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

  /** One flat list of everything selectable, so arrow keys work across groups. */
  const entriesFor = (found: PaletteResults): Entry[] => [
    ...found.commands.map(command => ({ key: command.id, run: () => runCommand(command.id) })),
    ...found.songs.map(song => ({ key: `song-${song.id}`, run: () => playSong(song.id) })),
    ...found.playlists.map(playlist => ({
      key: `playlist-${playlist.id}`,
      run: () => router.navigate(`/playlists/${playlist.id}`),
    })),
    ...found.tags.map(tag => ({
      key: `tag-${tag.id}`,
      run: () => {
        setFilter(current => includeTag(clearTagFilter(current), tag.id))
        router.navigate('/')
      },
    })),
    ...lyricHits.map(hit => ({ key: `lyric-${hit.songId}`, run: () => playSong(hit.songId) })),
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
        style={[styles.item, on && [styles.itemOn, { borderLeftColor: accent.accent }]]}
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
    'nav-import': icon(Search),
    'nav-stats': icon(BarChart),
    'nav-inbox': icon(Inbox),
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
            'Tags',
            results.tags.length,
            results.tags.map(tag =>
              item(
                <>
                  {icon(Tag)}
                  <Text style={styles.label} numberOfLines={1}>
                    {tag.name}
                  </Text>
                  <Text style={styles.hint}>{tag.songCount} songs</Text>
                </>,
                `tag-${tag.id}`,
                tag.name,
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
          {trimmed && entries.length === 0 ? (
            <Text style={styles.empty}>
              Nothing matches “{trimmed}”.{'\n'}Try fewer letters, or part of a lyric.
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
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 20 },
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 15,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
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
  groupText: { color: theme.colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  groupCount: { opacity: 0.75, letterSpacing: 0 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  itemOn: { backgroundColor: theme.colors.surface3 },
  labelBox: { flex: 1, minWidth: 0 },
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
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  footText: { color: theme.colors.textMuted, fontSize: 11 },
  kbd: {
    fontSize: 10,
    color: theme.colors.textPrimary,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 5,
  },
}))
