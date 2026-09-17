import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { fuzzyRank, type Playlist, type Tag } from '@selfmp3/shared'
import {
  clearTagFilter,
  downloadTally,
  oklchToHexAlpha,
  radius,
  railTags,
  space,
  tagFiltered,
  tagSelected,
  toggleTag,
  type,
  useAddToPlaylist,
  useCreateTag,
  useLibrary,
} from '@selfmp3/client'
import { useLibraryTagFilter } from '../features/library/libraryFilter'
import { noteTagUsed, useRecentTagIds } from '../features/library/recentTags.store'
import { openTagSearch } from '../features/library/tagSearch.store'
import { NewPlaylist } from '../features/playlists/NewPlaylist'
import { PlaylistCover } from '../features/playlists/PlaylistCover'
import { isLive, pinnedPlaylists } from '../features/playlists/playlists.model'
import { useSongDragActive, useSongDropTarget } from '../ports/songDrag'
import { menuCommands } from '../ports/menuKeys'
import { TITLE_BAR_DRAG_ID } from '../ports/titleBarDragId'
import { titleBarInset } from '../ports/titleBarInset'
import { acceleratorKeys } from '../features/settings/shortcuts.model'
import { showToast } from '../ui/toast'
import { useDownloads } from '../offline/DownloadsProvider'
import { isUntagged } from '../features/inbox/inbox.model'
import { useConnection } from '../connection/ConnectionProvider'
import { BrandMark } from '../ui/components/BrandMark'
import {
  BarChart,
  Download,
  Inbox,
  ListMusic,
  Live,
  More,
  Music,
  Plus,
  Search,
  Settings,
  Tag as TagIcon,
  X,
} from '../ui/components/Icons'
import { TagEditor } from '../ui/components/TagEditor'
import { tip } from '../ui/tip'
import { setPaletteOpen } from './palette'

/**
 * The desktop's left rail.
 *
 * The same destinations the tab bar carries, in the same order, from the same
 * route files — `docs/UNIVERSAL.md` foundation 5. Only the arrangement differs,
 * which is what a breakpoint is for: a row of icons along the bottom under 820,
 * a column with words beside them above it.
 *
 * At the top, under the brand, a Search row that opens the command palette —
 * the one way to it in a browser tab, which has no ⌘K of its own.
 *
 * Playlists are a section whose header is itself the way to the playlists
 * page, with the count and a ＋ that makes any of the three kinds; the ones
 * you pinned sit under it. A song dragged from the library drops onto a
 * pinned playlist.
 *
 * Below them, a tag list, which is how a desktop filters the library: a click
 * shows only a tag, the − beside it hides the tag, the ⋯ edits it. At
 * the foot, a status line: reachable or not, and what is offline.
 */
const DESTINATIONS: {
  href: '/' | '/import' | '/stats' | '/settings'
  label: string
  Icon: typeof Music
}[] = [
  { href: '/', label: 'Library', Icon: Music },
  // Import and Stats both need the server itself. A cloud library reaches it by
  // the addresses in its last sync and says so when it cannot, which is the
  // page's business — leaving the row out instead said the feature did not exist.
  { href: '/import', label: 'Import', Icon: Download },
  { href: '/stats', label: 'Stats', Icon: BarChart },
  { href: '/settings', label: 'Settings', Icon: Settings },
]

export const SIDEBAR_WIDTH = 244

/** A pointer can hover here, so a row's controls wait for it. A tablet shows them. */
const HOVERS = Platform.OS === 'web'

export function Sidebar(): ReactNode {
  // On an iPad the rail runs up under the status bar, which a phone's tab bar never did.
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const pathname = usePathname()

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
        {DESTINATIONS.map(destination => {
          const active =
            destination.href === '/' ? pathname === '/' : pathname.startsWith(destination.href)
          return (
            <Pressable
              key={destination.href}
              style={[styles.item, active && styles.itemOn]}
              onPress={() => {
                if (!active) router.navigate(destination.href)
              }}
              accessibilityRole="tab"
              accessibilityLabel={destination.label}
              accessibilityState={{ selected: active }}
              testID={`nav-${destination.label.toLowerCase()}`}
            >
              <destination.Icon size={18} tone={active ? 'accent' : 'textMuted'} />
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
      style={({ pressed }) => [
        styles.search,
        (pressed || hovered) && { borderColor: theme.colors.borderStrong },
      ]}
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
  const pinned = useMemo(() => pinnedPlaylists(all ?? []), [all])
  // Lit on a playlist's own page too: that page is inside this section.
  const onPage = pathname === '/playlists' || pathname.startsWith('/playlists/')

  return (
    <View style={styles.playlists} testID="sidebar-playlists">
      {/*
        The header is the row: "Show all" under the pins was a second name for
        the same page, and the header above it did nothing when clicked. The ＋
        sits beside the row rather than inside it, so it is its own button.
      */}
      <View style={[styles.playlistsHead, onPage && styles.itemOn]}>
        <Pressable
          onPress={() => {
            if (pathname !== '/playlists') router.navigate('/playlists')
          }}
          accessibilityRole="tab"
          accessibilityLabel="Playlists"
          accessibilityState={{ selected: onPage }}
          testID="nav-playlists"
          style={({ pressed }) => [
            styles.playlistsHeadMain,
            pressed && !onPage && styles.rowPressed,
          ]}
        >
          <ListMusic size={18} tone={onPage ? 'accent' : 'textMuted'} />
          <Text
            style={[styles.label, styles.playlistsHeadLabel, onPage && styles.labelOn]}
            numberOfLines={1}
          >
            Playlists
          </Text>
          <Text style={styles.count}>{all?.length ?? ''}</Text>
        </Pressable>
        <View ref={plusRef} collapsable={false}>
          <Pressable
            style={styles.tinyButton}
            onPress={() => setNewOpen(open => !open)}
            accessibilityRole="button"
            accessibilityLabel="New playlist"
            {...tip('New playlist')}
          >
            <Plus size={14} tone={onPage ? 'accent' : 'textMuted'} />
          </Pressable>
        </View>
      </View>

      {pinned.map(playlist => (
        <PinnedPlaylist
          key={playlist.id}
          playlist={playlist}
          active={pathname === `/playlists/${playlist.id}`}
          onOpen={() =>
            router.navigate({ pathname: '/playlists/[id]', params: { id: String(playlist.id) } })
          }
        />
      ))}
      {pinned.length === 0 && (all?.length ?? 0) > 0 ? (
        <Text style={[styles.hint, styles.pinHint]}>Pin a playlist from its ⋯ menu.</Text>
      ) : null}

      <NewPlaylist open={newOpen} onClose={() => setNewOpen(false)} anchorRef={plusRef} />
    </View>
  )
}

/**
 * A pinned playlist. Songs dragged from a list drop onto it; a live one
 * dims while they are dragged, because its rules decide what is in it.
 */
function PinnedPlaylist({
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
  // The tag half only: the search shares this filter, and a letter typed there
  // changes nothing this list shows.
  const [filter, setFilter] = useLibraryTagFilter()
  const createTag = useCreateTag()
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
   * and the rest are one press away in the library's own tag search.
   */
  const rail = useMemo(() => railTags(recentIds, tags), [recentIds, tags])
  // A pass over the whole library; its answer only changes when the library does.
  const untaggedCount = useMemo(() => (library?.songs ?? []).filter(isUntagged).length, [library])
  const trimmed = name.trim()
  const suggestions = trimmed ? fuzzyRank(name, tags, tag => tag.name).slice(0, 3) : []
  const exact = suggestions.find(match => match.exact)

  // A tag filters the library, so choosing one from elsewhere goes there.
  const toLibrary = (): void => {
    if (pathname !== '/') router.navigate('/')
  }
  const choose = (tagId: number): void => {
    if (!tagSelected(filter, tagId)) noteTagUsed(tagId)
    setFilter(current => toggleTag(current, tagId))
    toLibrary()
  }
  const showOnly = (tagId: number): void => {
    if (!tagSelected(filter, tagId)) choose(tagId)
  }

  const submit = async (): Promise<void> => {
    if (!trimmed) {
      setAdding(false)
      return
    }
    // Choosing the tag that exists beats silently making a near-duplicate.
    if (exact) showOnly(exact.item.id)
    else await createTag.mutateAsync(trimmed).catch(() => undefined)
    setName('')
    setAdding(false)
  }

  return (
    <View style={styles.group}>
      <View style={styles.groupTitle}>
        <Text style={styles.groupTitleText}>TAGS</Text>
        <View style={styles.groupActions}>
          {tagFiltered(filter) ? (
            <Pressable
              style={styles.tinyButton}
              onPress={() => setFilter(clearTagFilter)}
              accessibilityRole="button"
              accessibilityLabel="Clear tag filters"
              {...tip('Clear filters')}
            >
              <X size={13} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
          <Pressable
            style={styles.tinyButton}
            onPress={() => setAdding(open => !open)}
            accessibilityRole="button"
            accessibilityLabel="New tag"
            {...tip('New tag')}
          >
            <Plus size={14} color={theme.colors.textMuted} />
          </Pressable>
        </View>
      </View>

      {adding ? (
        <View style={styles.tagForm}>
          <TextInput
            style={styles.tagInput}
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => void submit()}
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
                    showOnly(item.id)
                    setName('')
                    setAdding(false)
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
        {untaggedCount > 0 ? (
          <Pressable
            onPress={() => router.navigate('/inbox')}
            accessibilityRole="link"
            accessibilityLabel={`Untagged, ${untaggedCount}`}
            testID="nav-inbox"
            style={({ pressed }) => [
              styles.inboxRow,
              (pressed || pathname === '/inbox') && { backgroundColor: theme.colors.surface2 },
            ]}
          >
            <Inbox size={14} color={theme.colors.textSecondary} />
            <Text style={[styles.inboxName, pathname === '/inbox' && styles.inboxNameOn]}>
              Untagged
            </Text>
            <Text style={styles.inboxCount}>{untaggedCount}</Text>
          </Pressable>
        ) : null}
        {rail.map(tag => (
          <TagRow
            key={tag.id}
            tag={tag}
            chosen={tagSelected(filter, tag.id)}
            onChoose={() => choose(tag.id)}
          />
        ))}
        {/*
          Every tag chosen is shown even when it is not one of the four, or a
          tag turned on from the library's own search would be filtering a list
          while the rail said nothing was on.
        */}
        {tags
          .filter(tag => tagSelected(filter, tag.id) && !rail.some(shown => shown.id === tag.id))
          .map(tag => (
            <TagRow key={tag.id} tag={tag} chosen onChoose={() => choose(tag.id)} />
          ))}
        {tags.length > rail.length ? (
          <Pressable
            onPress={() => {
              toLibrary()
              openTagSearch()
            }}
            accessibilityRole="button"
            accessibilityLabel={`Search all ${tags.length} tags`}
            style={({ pressed }) => [
              styles.allTags,
              pressed && { backgroundColor: theme.colors.surface2 },
            ]}
            testID="sidebar-all-tags"
          >
            <Search size={12} color={theme.colors.textMuted} />
            <Text style={styles.hint}>All {tags.length} tags…</Text>
          </Pressable>
        ) : null}
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
    </View>
  )
}

/**
 * One tag in the sidebar: a click puts it in the filter, a second click takes
 * it out, and the ⋯ the pointer reveals edits it. There is no third state —
 * every tag you turn on adds its songs to the list, so "hide these" has
 * nowhere to fit and nothing to mean.
 */
function TagRow({
  tag,
  chosen,
  onChoose,
}: {
  tag: Tag
  chosen: boolean
  onChoose: () => void
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
        chosen && { backgroundColor: oklchToHexAlpha(0.35, 0.09, tag.hue, 0.32) },
      ]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Pressable
        style={styles.tagMain}
        onPress={onChoose}
        accessibilityRole="button"
        accessibilityLabel={tag.name}
        accessibilityState={{ selected: chosen }}
      >
        <View style={[styles.dot, { backgroundColor: oklchToHexAlpha(0.68, 0.15, tag.hue, 1) }]} />
        <Text style={[styles.tagName, chosen && styles.tagNameIncluded]} numberOfLines={1}>
          {tag.name}
        </Text>
        <Text style={styles.count}>{tag.songCount}</Text>
      </Pressable>

      <View ref={moreRef} collapsable={false}>
        <Pressable
          style={[styles.tagAction, styles.tagActionLast, { opacity: revealed ? 1 : 0 }]}
          onPress={() => setEditing(open => !open)}
          accessibilityRole="button"
          accessibilityLabel={`Edit tag ${tag.name}`}
          {...tip('Rename, recolour or delete')}
          accessibilityState={{ expanded: editing }}
        >
          <More size={13} color={theme.colors.textMuted} />
        </Pressable>
      </View>

      <TagEditor
        tag={editing ? tag : null}
        anchorRef={moreRef}
        chosen={chosen}
        onChoose={onChoose}
        onDeleted={() => {
          if (chosen) onChoose()
        }}
        onClose={() => setEditing(false)}
      />
    </View>
  )
}

/**
 * The foot: one line that answers the glance down — can this app reach its
 * library, and how much of it is kept offline. It opens Settings, where both
 * are managed. Rescanning the folder lives there and in ⌘K; a task needed once
 * in a while does not want a permanent place under the tags.
 */
function Foot(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
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
          pressed && { backgroundColor: theme.colors.surface2 },
        ]}
        onPress={() => router.navigate('/settings')}
        accessibilityRole="button"
        accessibilityLabel={library.data ? `${label}, ${detail}` : label}
        testID="sidebar-status"
        {...tip('Connection and offline songs')}
      >
        <View style={[styles.statusDot, { backgroundColor: dot }]} />
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

const styles = StyleSheet.create(theme => ({
  titleBarDrag: { position: 'absolute', top: 0, left: 0, right: 0 },
  rail: {
    width: SIDEBAR_WIDTH,
    backgroundColor: theme.colors.surface1,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
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
    borderRadius: radius.md,
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
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
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
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  playlists: { gap: 1, marginTop: -space.sm },
  playlistsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
    borderRadius: radius.md,
  },
  playlistsHeadMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.md,
  },
  playlistsHeadLabel: { flex: 1 },
  playlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
    paddingHorizontal: 6,
    borderRadius: radius.sm,
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
  // Where you are, in the accent, and the press behind it. All from the
  // palette, so the accent picker recolours the whole rail without
  // re-rendering any of it.
  itemOn: { backgroundColor: theme.colors.accentPill },
  labelOn: { color: theme.colors.accent, fontWeight: '600' },
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
  groupTitleText: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.77,
  },
  groupActions: { flexDirection: 'row', gap: 2 },
  tinyButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  tagForm: { paddingTop: 4, paddingHorizontal: 10, paddingBottom: space.sm },
  tagInput: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.sm,
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
    borderRadius: 20,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
  },
  suggestionText: { color: theme.colors.textSecondary, fontSize: 11 },
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
  },
  inboxName: { flex: 1, color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  inboxNameOn: { fontWeight: '700' },
  inboxCount: { color: theme.colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  tagList: { flex: 1 },
  tagListContent: { gap: 1 },
  allTags: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  tagRow: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.sm },
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
  tagNameIncluded: { color: theme.colors.textPrimary, fontWeight: '500' },
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
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  hint: { color: theme.colors.textMuted, fontSize: 12 },
  link: { color: theme.colors.textSecondary, fontSize: 12, textDecorationLine: 'underline' },
  foot: { borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 10, gap: 1 },
  status: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.md,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  statusText: { flex: 1, minWidth: 0, gap: 1 },
  statusDetail: { color: theme.colors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  footLabel: { color: theme.colors.textSecondary, fontSize: 13 },
}))
