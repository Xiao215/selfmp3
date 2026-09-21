import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { fuzzyRank, type Playlist, type Tag } from '@selfmp3/shared'
import {
  downloadTally,
  radius,
  railTags,
  space,
  tagColors,
  type,
  useAddToPlaylist,
  useCreateTag,
  useLibrary,
} from '@selfmp3/client'
import { noteTagUsed, useRecentTagIds } from '../features/library/recentTags.store'
import { NewPlaylist } from '../features/playlists/NewPlaylist'
import { PlaylistCover } from '../features/playlists/PlaylistCover'
import { isLive, listedPlaylists } from '../features/playlists/playlists.model'
import { useSongDragActive, useSongDropTarget } from '../ports/songDrag'
import { menuCommands } from '../ports/menuKeys'
import { TITLE_BAR_DRAG_ID } from '../ports/titleBarDragId'
import { titleBarInset } from '../ports/titleBarInset'
import { acceleratorKeys } from '../features/settings/shortcuts.model'
import { showToast } from '../ui/toast'
import { useDownloads } from '../offline/DownloadsProvider'
import { tagLink } from '../features/tag/placeLinks'
import { onTagPage } from '../features/tag/placePath.model'
import { useArtistNudge } from '../features/tag/useArtistNudge'
import { useConnection } from '../connection/ConnectionProvider'
import { BrandMark } from '../ui/components/BrandMark'
import {
  BarChart,
  Download,
  Home,
  Live,
  More,
  Music,
  Plus,
  Search,
  Tag as TagIcon,
} from '../ui/components/Icons'
import { TagEditor } from '../ui/components/TagEditor'
import { tip } from '../ui/tip'
import { Avatar } from '../ui/components/Avatar'
import { useAccount } from '../features/profile/useAccount'
import { useSlidingHighlight } from '../ui/components/SlidingHighlight'
import { MOVE_MS } from '../ui/motion.model'
import { setPaletteOpen } from './palette'
import { label as labelText } from '../ui/surfaces'

/**
 * The desktop's left rail.
 *
 * The same destinations the tab bar carries, in the same order, from the same
 * route files — `docs/ARCHITECTURE.md` foundation 5. Only the arrangement differs,
 * which is what a breakpoint is for: a row of icons along the bottom under 820,
 * a column with words beside them above it.
 *
 * At the top, under the brand, a Search row that opens the command palette —
 * the one way to it in a browser tab, which has no ⌘K of its own.
 *
 * Playlists are a section whose header is itself the way to the playlists
 * page, with the count and a ＋ that makes any of the three kinds; the few
 * played last sit under it, and a song dragged from the library drops onto
 * one. There are no pins (docs/UI-MIGRATION.md, Phase 5), and an empty
 * playlist is not listed.
 *
 * Below them, the tags reached for last: a click opens the tag's page, the ⋯
 * edits it, and the TAGS header opens all of them. At the foot, a status
 * line: reachable or not, and what is offline.
 */
const DESTINATIONS: {
  href: '/' | '/library' | '/import' | '/stats'
  label: string
  Icon: typeof Music
}[] = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/library', label: 'Library', Icon: Music },
  // Import and Stats both need the server itself. A cloud library reaches it by
  // the addresses in its last sync and says so when it cannot, which is the
  // page's business — leaving the row out instead said the feature did not exist.
  // Stats keeps a row of its own on a computer; on a phone it is under You
  // (docs/UI-MIGRATION.md, Open question 7).
  { href: '/import', label: 'Import', Icon: Download },
  { href: '/stats', label: 'Stats', Icon: BarChart },
]

/** How many playlists the rail lists: the ones played last. The header opens them all. */
const RAIL_PLAYLISTS = 4

export const SIDEBAR_WIDTH = 244

/** A pointer can hover here, so a row's controls wait for it. A tablet shows them. */
const HOVERS = Platform.OS === 'web'

export function Sidebar(): ReactNode {
  // On an iPad the rail runs up under the status bar, which a phone's tab bar never did.
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const pathname = usePathname()
  // The lit destination's fill slides to the next one, 180 ms, as the page
  // changes beside it (docs/ui-mock `M3`, 5). Within these four rows only: a
  // playlist or a tag further down is lit in place.
  const lit =
    DESTINATIONS.find(destination =>
      destination.href === '/' ? pathname === '/' : pathname.startsWith(destination.href),
    )?.href ?? null
  const slide = useSlidingHighlight(lit, MOVE_MS.page, styles.itemOn)

  return (
    <View
      style={[styles.rail, { paddingTop: space.xl + insets.top + titleBarInset }]}
      testID="sidebar"
    >
      {/*
        The installed desktop app's traffic lights sit over this corner. The strip
        is what the window is dragged by, since there is no title bar above it
        any more; it is nothing at all in a browser, where the inset is zero.
      */}
      {titleBarInset > 0 ? (
        <View
          nativeID={TITLE_BAR_DRAG_ID}
          style={[styles.titleBarDrag, { height: titleBarInset }]}
        />
      ) : null}
      <View style={styles.brand}>
        <BrandMark size={20} />
        <Text style={styles.wordmark}>self.mp3</Text>
      </View>

      <SearchRow />

      <View accessibilityRole="tablist" style={styles.nav}>
        {slide.highlight}
        {DESTINATIONS.map(destination => {
          const active = destination.href === lit
          return (
            <Pressable
              key={destination.href}
              onLayout={slide.measure(destination.href)}
              style={[styles.item, active && !slide.placed && styles.itemOn]}
              onPress={() => {
                if (!active) router.navigate(destination.href)
              }}
              accessibilityRole="tab"
              accessibilityLabel={destination.label}
              accessibilityState={{ selected: active }}
              testID={`nav-${destination.label.toLowerCase()}`}
            >
              <destination.Icon size={18} tone={active ? 'textPrimary' : 'textMuted'} />
              <Text style={[styles.label, active && styles.labelOn]} numberOfLines={1}>
                {destination.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <Playlists />
      <Tags />
      <Foot />
    </View>
  )
}

/**
 * The key the installed app's menu gives Search, drawn beside the row. Only
 * there: a browser tab has no ⌘K (its ⌘K is the browser's), and a row that
 * named a key that does nothing would teach the wrong thing.
 */
const SEARCH_KEYS = (() => {
  const accelerator = menuCommands?.find(item => item.command === 'search')?.accelerator
  if (!accelerator) return null
  const { modifiers, key } = acceleratorKeys(accelerator)
  return [...modifiers, key]
})()

/**
 * Search, at the top of the rail: opens the command palette. A button rather
 * than a field, because the palette is where the typing happens — a second
 * box here would be two places to type the same thing.
 *
 * Under the title-bar strip in the installed app, which the rail's padding
 * already clears, so the window's drag region never covers it.
 */
function SearchRow(): ReactNode {
  const { theme } = useUnistyles()
  const [hovered, setHovered] = useState(false)
  return (
    <Pressable
      onPress={() => setPaletteOpen(true)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel="Search"
      testID="nav-search"
      style={({ pressed }) => [styles.search, (pressed || hovered) && styles.searchHovered]}
    >
      <Search size={15} color={theme.colors.textMuted} />
      <Text style={styles.searchText}>Search</Text>
      {SEARCH_KEYS ? (
        <View style={styles.searchKeys}>
          {SEARCH_KEYS.map(key => (
            <Text key={key} style={styles.searchKey}>
              {key}
            </Text>
          ))}
        </View>
      ) : null}
    </Pressable>
  )
}

function Playlists(): ReactNode {
  const router = useRouter()
  const pathname = usePathname()
  const { data: library } = useLibrary()
  const [newOpen, setNewOpen] = useState(false)
  const plusRef = useRef<View>(null)

  const all = library?.playlists
  // The ones the playlists page lists: an empty playlist is in neither.
  const listed = useMemo(() => listedPlaylists(all ?? [], 'recent'), [all])
  const recent = listed.slice(0, RAIL_PLAYLISTS)
  // Lit on a playlist's own page too: that page is inside this section.
  const onPage = pathname === '/playlists' || pathname.startsWith('/playlists/')

  return (
    <View style={styles.section} testID="sidebar-playlists">
      {/*
        A section, as Tags is: its header opens every playlist ("All 4"), and
        the few under it are the ones played last. The ＋ beside the header makes
        any of the three kinds.
      */}
      <View style={styles.groupTitle}>
        <Pressable
          onPress={() => {
            if (pathname !== '/playlists') router.navigate('/playlists')
          }}
          accessibilityRole="tab"
          accessibilityLabel="Playlists"
          accessibilityState={{ selected: onPage }}
          testID="nav-playlists"
          style={styles.groupTitleMain}
        >
          <Text style={[styles.groupTitleText, onPage && styles.groupTitleOn]}>PLAYLISTS</Text>
          {listed.length > 0 ? <Text style={styles.groupAll}>All {listed.length}</Text> : null}
        </Pressable>
        <View ref={plusRef} collapsable={false}>
          <Pressable
            style={styles.tinyButton}
            onPress={() => setNewOpen(open => !open)}
            accessibilityRole="button"
            accessibilityLabel="New playlist"
            {...tip('New playlist')}
          >
            <Plus size={14} tone="textMuted" />
          </Pressable>
        </View>
      </View>

      {recent.map(playlist => (
        <RailPlaylist
          key={playlist.id}
          playlist={playlist}
          active={pathname === `/playlists/${playlist.id}`}
          onOpen={() =>
            router.navigate({ pathname: '/playlists/[id]', params: { id: String(playlist.id) } })
          }
        />
      ))}

      <NewPlaylist open={newOpen} onClose={() => setNewOpen(false)} anchorRef={plusRef} />
    </View>
  )
}

/**
 * A playlist in the rail. Songs dragged from a list drop onto it; a live one
 * dims while they are dragged, because its rules decide what is in it.
 */
function RailPlaylist({
  playlist,
  active,
  onOpen,
}: {
  playlist: Playlist
  active: boolean
  onOpen: () => void
}): ReactNode {
  const ref = useRef<View>(null)
  const live = isLive(playlist)
  const dragging = useSongDragActive()
  const addToPlaylist = useAddToPlaylist()
  const over = useSongDropTarget(ref, {
    enabled: !live,
    onDrop: songIds => {
      addToPlaylist.mutate({ playlistId: playlist.id, songIds })
      showToast(
        `Added ${songIds.length} ${songIds.length === 1 ? 'song' : 'songs'} to ${playlist.name}`,
        'good',
      )
    },
  })

  return (
    <View ref={ref} collapsable={false} style={dragging && live ? styles.dim : undefined}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={playlist.name}
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [
          styles.playlistRow,
          active && styles.itemOn,
          pressed && !active && styles.rowPressed,
          over && styles.dropping,
        ]}
      >
        <PlaylistCover playlist={playlist} size={22} />
        <Text style={[styles.playlistName, active && styles.labelOn]} numberOfLines={1}>
          {playlist.name}
        </Text>
        {live ? <Live size={13} tone="textMuted" /> : null}
      </Pressable>
      {over ? <Text style={[styles.dropHint, styles.labelOn]}>Drop to add</Text> : null}
    </View>
  )
}

function Tags(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const pathname = usePathname()
  const { data: library } = useLibrary()
  const createTag = useCreateTag()
  const nudge = useArtistNudge()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const tags = useMemo<readonly Tag[]>(() => library?.tags ?? [], [library?.tags])
  const recentIds = useRecentTagIds()
  /*
   * Four tags, not two hundred.
   *
   * A rail that lists every tag is a scroll nobody reaches the bottom of, and
   * the ones that matter are somewhere in the middle of it. These four are the
   * ones this device reached for last — no pinning, nothing to maintain —
   * and the rest are one press away on All tags, which the header opens.
   */
  const rail = useMemo(() => railTags(recentIds, tags), [recentIds, tags])
  const trimmed = name.trim()
  const suggestions = trimmed ? fuzzyRank(name, tags, tag => tag.name).slice(0, 3) : []
  const exact = suggestions.find(match => match.exact)

  // A tag is a place (docs/UI-MIGRATION.md, Phase 4): choosing one opens its page.
  const open = (tag: Tag): void => {
    noteTagUsed(tag.id)
    if (!onTagPage(pathname, tag.name)) router.navigate(tagLink(tag.name))
  }

  const closeForm = (): void => {
    setName('')
    setAdding(false)
  }

  const submit = (): void => {
    if (!trimmed) {
      setAdding(false)
      return
    }
    // Opening the tag that exists beats silently making a near-duplicate.
    if (exact) open(exact.item)
    else nudge.check(trimmed, () => void createTag.mutateAsync(trimmed).catch(() => undefined))
    closeForm()
  }

  return (
    <View style={styles.group}>
      <View style={styles.groupTitle}>
        <Pressable
          onPress={() => router.navigate('/tags')}
          accessibilityRole="link"
          accessibilityLabel={`All ${tags.length} tags`}
          testID="sidebar-tags"
          style={styles.groupTitleMain}
        >
          <Text style={[styles.groupTitleText, pathname === '/tags' && styles.groupTitleOn]}>
            TAGS
          </Text>
          {tags.length > 0 ? <Text style={styles.groupAll}>All {tags.length}</Text> : null}
        </Pressable>
        <Pressable
          style={styles.tinyButton}
          onPress={() => setAdding(isOpen => !isOpen)}
          accessibilityRole="button"
          accessibilityLabel="New tag"
          {...tip('New tag')}
        >
          <Plus size={14} color={theme.colors.textMuted} />
        </Pressable>
      </View>

      {adding ? (
        <View style={styles.tagForm}>
          <TextInput
            style={styles.tagInput}
            value={name}
            onChangeText={setName}
            onSubmitEditing={submit}
            onBlur={() => {
              if (!name) setAdding(false)
            }}
            placeholder="tag name"
            placeholderTextColor={theme.colors.textMuted}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="New tag name"
          />
          {suggestions.length > 0 ? (
            <View style={styles.suggestions}>
              <Text style={styles.hint}>{exact ? 'already exists:' : 'similar:'}</Text>
              {suggestions.map(({ item }) => (
                <Pressable
                  key={item.id}
                  style={styles.suggestion}
                  onPress={() => {
                    open(item)
                    closeForm()
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggestionText}>{item.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <ScrollView style={styles.tagList} contentContainerStyle={styles.tagListContent}>
        {rail.map(tag => (
          <TagRow
            key={tag.id}
            tag={tag}
            active={onTagPage(pathname, tag.name)}
            onOpen={() => open(tag)}
          />
        ))}
        {!library && !adding ? (
          // Not "no tags yet": with the library unreachable or still coming,
          // this device does not know whether there are any.
          <Text style={[styles.hint, styles.pinHint]}>Tags load with your library.</Text>
        ) : null}
        {library && tags.length === 0 && !adding ? (
          <View style={styles.tagEmpty}>
            <TagIcon size={16} color={theme.colors.textMuted} />
            <Text style={styles.hint}>
              No tags yet. Tags are how you find things later — try “chill”.
            </Text>
            <Pressable onPress={() => setAdding(true)} accessibilityRole="button">
              <Text style={styles.link}>Add your first tag</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      {nudge.nudge}
    </View>
  )
}

/**
 * One tag in the sidebar: a click opens its page, which lights the row while
 * you are on it, and the ⋯ the pointer reveals edits it.
 */
function TagRow({
  tag,
  active,
  onOpen,
}: {
  tag: Tag
  active: boolean
  onOpen: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const moreRef = useRef<View>(null)
  const revealed = !HOVERS || hovered || editing

  return (
    <View
      style={[
        styles.tagRow,
        hovered && { backgroundColor: theme.colors.surface2 },
        active && styles.itemOn,
      ]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Pressable
        style={styles.tagMain}
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={tag.name}
        accessibilityState={{ selected: active }}
      >
        <View style={[styles.dot, { backgroundColor: tagColors(tag.hue).dot }]} />
        <Text style={[styles.tagName, active && styles.labelOn]} numberOfLines={1}>
          {tag.name}
        </Text>
        <Text style={styles.count}>{tag.songCount}</Text>
      </Pressable>

      <View ref={moreRef} collapsable={false}>
        <Pressable
          style={[styles.tagAction, styles.tagActionLast, { opacity: revealed ? 1 : 0 }]}
          onPress={() => setEditing(isOpen => !isOpen)}
          accessibilityRole="button"
          accessibilityLabel={`Edit tag ${tag.name}`}
          {...tip('Rename, recolour or delete')}
          accessibilityState={{ expanded: editing }}
        >
          <More size={13} color={theme.colors.textMuted} />
        </Pressable>
      </View>

      <TagEditor tag={editing ? tag : null} anchorRef={moreRef} onClose={() => setEditing(false)} />
    </View>
  )
}

/**
 * The foot: you (`C03`), with one line under that answers the glance down —
 * can this app reach its library, and how much of it is kept offline. It
 * opens Profile. Rescanning the folder lives in Settings and in ⌘K; a task needed
 * once in a while does not want a permanent place under the tags.
 */
function Foot(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const pathname = usePathname()
  const account = useAccount()
  const library = useLibrary()
  const { state } = useDownloads()
  const { fromCloud } = useConnection()
  /*
   * Of this library, what is here — not how many files the device is keeping.
   * The index holds an entry for every song ever downloaded, a replaced
   * library's included, so counting entries can say more are saved than exist.
   */
  const songIds = library.data?.songs.map(song => song.id) ?? []
  const { songs, here: saved } = downloadTally(state.index, songIds)

  // A failed refetch keeps the cached library, so an error wins over the data.
  const [dot, label] = library.isError
    ? [theme.colors.danger, fromCloud ? 'Can’t reach the cloud' : 'Can’t reach your server']
    : library.isPending
      ? [theme.colors.warning, 'Connecting…']
      : [theme.colors.good, fromCloud ? 'Cloud library' : 'Connected to your server']
  const detail = `${songs} ${songs === 1 ? 'song' : 'songs'} · ${
    saved > 0 ? `${saved} saved offline` : 'none saved offline'
  }`

  return (
    <View style={styles.foot}>
      <Pressable
        style={({ pressed }) => [
          styles.status,
          pathname === '/profile' && styles.itemOn,
          pressed && { backgroundColor: theme.colors.surface2 },
        ]}
        onPress={() => router.navigate('/profile')}
        accessibilityRole="button"
        accessibilityLabel={library.data ? `Profile. ${label}, ${detail}` : `Profile. ${label}`}
        testID="sidebar-status"
        {...tip('Profile, your connection and offline songs')}
      >
        <Avatar account={account} size={AVATAR}>
          <View style={[styles.statusDot, { backgroundColor: dot }]} />
        </Avatar>
        <View style={styles.statusText}>
          <Text style={styles.footLabel} numberOfLines={1}>
            {label}
          </Text>
          {library.data ? (
            <Text style={styles.statusDetail} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  )
}

/** The round mark on the rail's own row. */
const AVATAR = 30

const styles = StyleSheet.create(theme => ({
  titleBarDrag: { position: 'absolute', top: 0, left: 0, right: 0 },
  rail: {
    width: SIDEBAR_WIDTH,
    // The page's own ground (`C03`): the rail is told apart by what is in it,
    // not by a tone or a rule down its edge.
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: space.md,
    paddingTop: space.xl,
    paddingBottom: space.md,
    gap: space.xl,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
  },
  wordmark: {
    color: theme.colors.textPrimary,
    fontSize: type.title,
    fontWeight: '700',
  },
  nav: {
    gap: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: 12,
  },
  label: {
    color: theme.colors.textSecondary,
    fontSize: type.body,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
    paddingHorizontal: space.sm,
    marginTop: -space.sm,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  // Pointed at, a step lighter: tone, where it used to gain an edge.
  searchHovered: { backgroundColor: theme.colors.surface3 },
  searchText: { flex: 1, color: theme.colors.textMuted, fontSize: 13 },
  searchKeys: { flexDirection: 'row', gap: 3 },
  searchKey: {
    minWidth: 18,
    paddingHorizontal: 4,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    backgroundColor: theme.colors.surface1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  section: { gap: 1 },
  playlistsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
    borderRadius: 12,
  },
  playlistsHeadMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: 12,
  },
  playlistsHeadLabel: { flex: 1 },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
    paddingHorizontal: 6,
    borderRadius: 12,
    // Clear until a song is dragged over: then the dashed edge is the drop
    // target itself.
    borderWidth: 1,
    borderColor: 'transparent',
  },
  playlistName: { flex: 1, color: theme.colors.textSecondary, fontSize: 13 },
  pinHint: { paddingHorizontal: 10, paddingVertical: 4 },
  dropping: {
    borderStyle: 'dashed',
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.accent,
  },
  // Where you are: a lighter surface and full-strength ink, not the accent,
  // which is kept for the button that commits something (`S2`). Raised rather
  // than `surfaceSelected`, which is white on Paper, as the rail is.
  itemOn: { backgroundColor: theme.colors.surface3 },
  labelOn: { color: theme.colors.textPrimary, fontWeight: '600' },
  rowPressed: { backgroundColor: theme.colors.surface2 },
  dropHint: { fontSize: 11, paddingHorizontal: 10, paddingBottom: 2 },
  dim: { opacity: 0.35 },
  /* `.nav-group-grow`: the tag list takes what is left, and scrolls in it. */
  group: { flex: 1, minHeight: 0, gap: 1 },
  groupTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  groupTitleMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: space.sm,
  },
  groupTitleText: labelText(theme.colors),
  groupTitleOn: { color: theme.colors.textPrimary },
  groupAll: { color: theme.colors.textMuted, fontSize: 11, fontWeight: '600' },
  tinyButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  tagForm: { paddingTop: 4, paddingHorizontal: 10, paddingBottom: space.sm },
  tagInput: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 9,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  suggestion: {
    backgroundColor: theme.colors.surface3,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
  },
  suggestionText: { color: theme.colors.textSecondary, fontSize: 11 },
  tagList: { flex: 1 },
  tagListContent: { gap: 1 },
  tagRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12 },
  tagMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: 6,
    paddingRight: 4,
    paddingBottom: 6,
    paddingLeft: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tagName: { flex: 1, color: theme.colors.textSecondary, fontSize: 13 },
  not: { color: theme.colors.danger, fontWeight: '600' },
  count: { color: theme.colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  tagAction: { paddingVertical: 6, paddingHorizontal: 5 },
  tagActionLast: { paddingRight: space.sm },
  tagEmpty: {
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 10,
    marginTop: 2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.card,
  },
  hint: { color: theme.colors.textMuted, fontSize: 12 },
  link: { color: theme.colors.textSecondary, fontSize: 12, textDecorationLine: 'underline' },
  foot: { paddingTop: 10, gap: 1 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  // Whether the library can be reached, as a dot on the avatar's shoulder.
  statusDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    borderWidth: 2,
    borderColor: theme.colors.surface0,
  },
  statusText: { flex: 1, minWidth: 0, gap: 1 },
  statusDetail: { color: theme.colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  footLabel: { color: theme.colors.textSecondary, fontSize: 13 },
}))
