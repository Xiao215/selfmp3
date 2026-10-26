import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, type TextInput, useWindowDimensions, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { artistOr, clipText, formatDuration, plural } from '@selfmp3/shared'
import {
  clientApi,
  radius,
  space,
  type,
  useLibrary,
  useScanLibrary,
  iconSize,
  coverSize,
} from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { useConnection } from '../../connection/ConnectionProvider'
import { isComposing } from '../../shell/composing'
import { enterFromSidebar } from '../../shell/sidebarEntry'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Dialog } from '../../ui/components/Dialog'
import {
  BarChart,
  Download,
  ListMusic,
  Mic,
  Music,
  Refresh,
  Settings,
  Shuffle,
  Sparkle,
  Tag,
} from '../../ui/components/Icons'
import { label as labelText, dialogPanel, menuItem, menuItemDense } from '../../ui/surfaces'
import { ASK_SUB, askable } from '../smart/smart.model'
import { useSmartSwitches } from '../smart/useSmartSwitches'
import { playAlone } from '../lists/lists.model'
import { placesOf } from '../search/search.model'
import { useLibrarySearch } from '../search/useLibrarySearch'
import { artistLink } from '../tag/placeLinks'
import { useOpenTag } from '../tag/useOpenTag'
import { usePlayAndTag } from '../tag/usePlayAndTag'
import {
  PALETTE_LYRICS,
  paletteMatches,
  paletteResults,
  stepIndex,
  type PaletteCommandId,
  type PaletteResults,
  type RecentItem,
} from './commandPalette.model'
import { EmptyState } from '../../ui/components/EmptyState'
import { SearchField } from '../../ui/components/SearchField'
import { PlaceLine } from '../../ui/components/PlaceLine'
import { SongLine } from '../../ui/components/SongLine'
import { ScrollView } from '../../ui/components/Scroll'
import { Kbd } from '../../ui/components/Kbd'
import { Press } from '../../ui/components/Press'

/** One selectable row: what it is drawn as, what it is read out as, and what Enter does. */
interface Row {
  readonly key: string
  readonly label: string
  readonly run: () => void
  readonly node: ReactNode
}

interface RowGroup {
  readonly title: string
  readonly rows: readonly Row[]
  /** What its head counts, where that is more than its rows say: "8 of 93". */
  readonly count?: string
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
  const { fromCloud } = useConnection()
  // Offered only to a device that talks to its server, which is then what answers it.
  const scan = useScanLibrary(fromCloud ? null : clientApi())
  const artFor = useArt(ROW_COVER_SIZE)
  // The app's own width for the box; the window's height, which no split lies about.
  const { finePointer, width } = useLayout()
  const window = useWindowDimensions()
  const playAndTag = usePlayAndTag()
  const switches = useSmartSwitches()
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const input = useRef<TextInput>(null)
  // The list's id and its rows' ids, for the field to say which row is lit:
  // focus stays in the field, so a screen reader hears the row only through
  // `aria-activedescendant`.
  const listId = useId()
  const optionId = (index: number): string => `${listId}-${index}`

  const openTag = useOpenTag()
  const songs = useMemo(() => library.data?.songs ?? [], [library.data])
  const songIds = useMemo(() => songs.map(song => song.id), [songs])
  const currentSongId = player.current?.id ?? null
  // Search's search, with the palette's commands and playlists beside it.
  const search = useLibrarySearch(query, {
    search: useCallback(
      (text: string): PaletteResults =>
        paletteResults(text, library.data, fromCloud, { pathname, currentSongId }),
      [library.data, fromCloud, pathname, currentSongId],
    ),
    matches: paletteMatches,
  })
  const shownQuery = search.shown
  const lyricHits = search.lyricHits.slice(0, PALETTE_LYRICS)

  const runCommand = (id: PaletteCommandId): void => {
    // Go to Library, Stats…: the sidebar's places, opened as the sidebar opens them (J1).
    if (id.startsWith('nav-')) enterFromSidebar()
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
        player.playShuffled(songIds, { kind: 'library' })
        return
      case 'rescan-library':
        scan.mutate()
        return
    }
  }
  /**
   * A song row, a lyric hit or a recent song: that song alone, Up next cleared,
   * as a Library row plays it (`playAlone`). The palette is a search of the
   * whole library, not a place, so there is no list around the song to play.
   * A lyric hit the library no longer holds is left alone.
   */
  const playSong = (songId: number): void => {
    if (songIds.includes(songId)) playAlone(player, songId)
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

  /**
   * The rows in the order they are drawn (`C05`): what was played lately, then
   * artists and tags, songs, lines of lyrics, playlists, and the commands last.
   * One list carrying both what a row does and what it looks like, so the
   * arrow keys, Enter, the count and the drawing all follow the same order
   * rather than two kept in step by hand.
   */
  const groupsFor = (found: PaletteResults, text: string): RowGroup[] => {
    const groups = matchedGroups(found)
    const words = text.trim()
    if (!switches.ask || !askable(words)) return groups
    const ask: RowGroup = {
      title: 'Ask',
      rows: [
        {
          key: 'ask',
          label: `Ask: ${words}`,
          // Ask is a page of its own (A1, 2026-10-24): the palette closes, as for any page.
          run: () => router.push({ pathname: '/ask', params: { q: words } }),
          node: (
            <>
              <View style={styles.figure}>
                <Sparkle size={iconSize.item} />
              </View>
              <View style={styles.labelBox}>
                <Text style={styles.label} numberOfLines={1}>
                  {words}
                </Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {ASK_SUB}
                </Text>
              </View>
              <Text style={styles.hint}>ask</Text>
            </>
          ),
        },
      ],
    }
    // First when nothing on the device matches, so ↵ asks; after the matches
    // otherwise, so ↵ still opens the song or tag that was typed.
    return search.asks(found, text) ? [ask, ...groups] : [...groups, ask]
  }

  const matchedGroups = (found: PaletteResults): RowGroup[] => [
    {
      title: 'Recent',
      rows: found.recent.map(recent =>
        recent.kind === 'song'
          ? {
              key: recentKey(recent),
              label: `${recent.song.title}, ${artistOr(recent.song.artist)}`,
              run: () => runRecent(recent),
              node: (
                <SongLine
                  style={styles.songLine}
                  artUri={artFor(recent.song)}
                  coverTitle={recent.song.album || recent.song.title}
                  title={recent.song.title}
                  sub={artistOr(recent.song.artist)}
                  trailing={
                    <Text style={styles.hint}>
                      {recent.song.id === currentSongId ? 'playing now' : 'song'}
                    </Text>
                  }
                />
              ),
            }
          : {
              key: recentKey(recent),
              label: recent.playlist.name,
              run: () => runRecent(recent),
              node: (
                <>
                  {icon(ListMusic)}
                  <Text style={styles.label} numberOfLines={1}>
                    {recent.playlist.name}
                  </Text>
                  <Text style={styles.hint}>playlist</Text>
                </>
              ),
            },
      ),
    },
    {
      title: 'Artists and tags',
      // Search's order: a place named exactly what was typed leads (D1).
      rows: placesOf(found).map(place =>
        place.kind === 'artist'
          ? {
              key: `artist-${place.artist.key}`,
              label: `${place.artist.name}, artist`,
              run: () => router.navigate(artistLink(place.artist.name)),
              node: <PlaceLine place={place} style={styles.songLine} />,
            }
          : {
              key: `tag-${place.tag.id}`,
              label: `${place.tag.name}, tag`,
              // A tag is a place (docs/UI-MIGRATION.md, Phase 4): the hit opens its page.
              run: () => openTag(place.tag),
              node: <PlaceLine place={place} style={styles.songLine} />,
            },
      ),
    },
    {
      title: 'Songs',
      count:
        found.songsFound > found.songs.length
          ? `${found.songs.length} of ${found.songsFound}`
          : undefined,
      rows: [
        ...found.songs.map(song => ({
          key: `song-${song.id}`,
          label: `${song.title}, ${artistOr(song.artist)}`,
          run: () => playSong(song.id),
          node: (
            <SongLine
              style={styles.songLine}
              artUri={artFor(song)}
              coverTitle={song.album || song.title}
              title={song.title}
              sub={artistOr(song.artist)}
              trailing={<Text style={styles.hint}>{formatDuration(song.duration)}</Text>}
            />
          ),
        })),
        // The rest are on Search's Songs, every one of them.
        ...(found.songsFound > found.songs.length
          ? [
              {
                key: 'songs-all',
                label: `See all ${found.songsFound} songs`,
                run: () =>
                  router.push({
                    pathname: '/search',
                    params: { q: query.trim(), section: 'songs' },
                  }),
                node: (
                  <View style={styles.labelBox}>
                    <Text style={styles.sub}>See all {found.songsFound} songs</Text>
                  </View>
                ),
              },
            ]
          : []),
      ],
    },
    {
      title: 'Lyrics',
      // One song can have several lines that match, so a hit's key is its place too.
      rows: lyricHits.map((hit, index) => ({
        key: `lyric-${hit.songId}-${index}`,
        label: `${hit.title}: ${hit.before}${hit.match}${hit.after}`,
        run: () => playSong(hit.songId),
        node: (
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
          </>
        ),
      })),
    },
    {
      title: 'Playlists',
      rows: found.playlists.map(playlist => ({
        key: `playlist-${playlist.id}`,
        label: playlist.name,
        run: () => openPlaylist(playlist.id),
        node: (
          <>
            {icon(ListMusic)}
            <Text style={styles.label} numberOfLines={1}>
              {playlist.name}
            </Text>
            <Text style={styles.hint}>{plural(playlist.songCount, 'song', 'songs')}</Text>
          </>
        ),
      })),
    },
    {
      title: 'Actions',
      rows: found.commands.map(command => ({
        key: command.id,
        label: command.label,
        run: () => runCommand(command.id),
        node: (
          <>
            {commandIcon[command.id]}
            <Text style={styles.label} numberOfLines={1}>
              {command.label}
            </Text>
            {command.hint ? <Text style={styles.hint}>{command.hint}</Text> : null}
          </>
        ),
      })),
    },
  ]
  const groups = groupsFor(search.found, shownQuery)
  const rows = groups.flatMap(group => group.rows)
  const active = Math.min(highlighted, Math.max(0, rows.length - 1))
  // Keep the highlighted row in view as the arrow keys move through a long list.
  const rowNodes = useRef(new Map<number, unknown>())
  useEffect(() => {
    const row = rowNodes.current.get(active) as
      { scrollIntoView?: (options: { block: 'nearest' }) => void } | undefined
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const activate = (index: number): void => {
    const row = rows[index]
    row?.run()
    onClose()
  }

  const drawRow = (row: Row, index: number): ReactNode => {
    const on = index === active
    return (
      <Press
        feedback="wash"
        key={row.key}
        ref={node => {
          rowNodes.current.set(index, node)
        }}
        role="option"
        nativeID={optionId(index)}
        aria-selected={on}
        accessibilityLabel={row.label}
        onHoverIn={() => setHighlighted(index)}
        onPress={() => activate(index)}
        style={[styles.item, on && styles.itemOn]}
      >
        {row.node}
      </Press>
    )
  }
  // Each group's rows are numbered on from the last group's, so a row's index
  // here is its index in `rows`.
  const drawnGroups: ReactNode[] = []
  let from = 0
  for (const group of groups) {
    if (group.rows.length > 0) {
      const first = from
      drawnGroups.push(
        <View style={styles.group} key={group.title}>
          <View style={styles.groupTitle}>
            <Text style={styles.groupText}>{group.title}</Text>
            <Text style={[styles.groupText, styles.groupCount]}>
              {group.count ?? group.rows.length}
            </Text>
          </View>
          {group.rows.map((row, offset) => drawRow(row, first + offset))}
        </View>,
      )
    }
    from += group.rows.length
  }

  // What the results below were found for, so the count and "nothing matches"
  // never describe a query the list has not caught up with.
  const trimmed = shownQuery.trim()

  return (
    <Dialog
      onDismiss={onClose}
      onEscape={onClose}
      label="Command palette"
      frameStyle={[styles.frame, { paddingTop: window.height * (finePointer ? 0.14 : 0.06) }]}
      style={[
        styles.panel,
        { width: Math.min(620, width * 0.92), maxHeight: window.height * 0.66 },
      ]}
    >
      <View style={styles.inputRow}>
        <SearchField
          raised
          inputRef={input}
          autoFocus
          value={query}
          onChangeText={text => {
            setQuery(text)
            setHighlighted(0)
          }}
          onKeyPress={event => {
            const key = event.nativeEvent.key
            if (key !== 'ArrowDown' && key !== 'ArrowUp') return
            // The arrows move between an input method's candidates while
            // one is composing; the rows are not theirs to move.
            if (isComposing(event.nativeEvent as { isComposing?: boolean })) return
            ;(event as unknown as { preventDefault: () => void }).preventDefault()
            setHighlighted(stepIndex(active, key === 'ArrowDown' ? 1 : -1, rows.length))
          }}
          onSubmitEditing={() => {
            // Enter straight after a letter can beat the deferred results to
            // the screen. It means what was typed, so it takes the first row
            // of that — the highlight is back at the top after any letter.
            if (shownQuery === query) activate(active)
            else {
              const first = groupsFor(search.foundNow(), query).flatMap(group => group.rows)[0]
              first?.run()
              onClose()
            }
          }}
          placeholder="Search songs, playlists, tags — or type a command"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={rows.length > 0 ? optionId(active) : undefined}
          aria-autocomplete="list"
          accessibilityLabel="Search songs, playlists and tags, or type a command"
          trailing={
            trimmed ? (
              <Text style={styles.count} accessibilityLiveRegion="polite">
                {plural(rows.length, 'result', 'results')}
              </Text>
            ) : null
          }
        />
      </View>

      <ScrollView
        // A listbox, so its options read as one list's choices. React
        // Native's Role type has no "listbox"; react-native-web renders it.
        {...({ role: 'listbox', 'aria-label': 'Results' } as object)}
        nativeID={listId}
        contentContainerStyle={styles.results}
      >
        {drawnGroups}
        {trimmed && rows.length === 0 ? (
          <EmptyState
            compact
            title={`Nothing matches “${clipText(trimmed)}”`}
            // Lyrics are searched on your library's computer, out of reach now.
            line={
              search.lyricsAway ? 'Try fewer letters.' : 'Try fewer letters, or part of a lyric.'
            }
          />
        ) : null}
      </ScrollView>

      {finePointer ? (
        <View style={styles.foot}>
          <Text style={styles.footText}>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </Text>
          <Text style={styles.footText}>
            <Kbd>↵</Kbd> open
          </Text>
          <Text style={styles.footText}>
            <Kbd>esc</Kbd> close
          </Text>
        </View>
      ) : null}
    </Dialog>
  )
}

const styles = StyleSheet.create(theme => ({
  // Near the top rather than the middle, where the eye already is.
  frame: { padding: 0, justifyContent: 'flex-start' },
  panel: dialogPanel(theme.colors),
  // Rows to choose, not words to copy; the field keeps its own selection.
  inputRow: { padding: space.md, paddingBottom: space.sm, userSelect: 'none' },
  count: { color: theme.colors.textMuted, fontSize: type.tiny, fontVariant: ['tabular-nums'] },
  results: { padding: space.tight, userSelect: 'none' },
  group: { marginBottom: space.tight },
  groupTitle: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: space.sm,
    paddingHorizontal: space.snug,
    paddingBottom: 5,
  },
  groupText: labelText(theme.colors),
  groupCount: { opacity: 0.75, letterSpacing: 0 },
  item: { ...menuItem, ...menuItemDense, minHeight: 40 },
  // The highlighted row is a lighter surface; it no longer has an accent bar.
  itemOn: { backgroundColor: theme.colors.surface3 },
  labelBox: { flex: 1, minWidth: 0 },
  // The row around it has the room; the line brings none of its own.
  songLine: { flex: 1, minWidth: 0, paddingVertical: 0, paddingHorizontal: 0 },
  // The Ask's sparkle, in a round the size of a row's cover, as a place's figure is.
  figure: {
    width: coverSize.line,
    height: coverSize.line,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, minWidth: 0, color: theme.colors.textSecondary, fontSize: type.sub },
  mark: { fontWeight: '700' },
  sub: { color: theme.colors.textMuted, fontSize: type.tiny },
  hint: { color: theme.colors.textMuted, fontSize: type.tiny },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    // Set down a step from the panel: tone, not a rule.
    backgroundColor: theme.colors.surface0,
  },
  footText: { color: theme.colors.textMuted, fontSize: type.tiny },
}))
