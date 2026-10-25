import { memo, useMemo, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import { Guide } from '../features/guide/Guide'
import { useGuideAsked } from '../features/guide/guideMemory'
import { useGuide } from '../features/guide/useGuide'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLayoutValue } from './useLayout'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter } from 'expo-router'
import { plural, fuzzyRank, type Playlist, type Tag } from '@selfmp3/shared'
import {
  downloadTally,
  radius,
  railTags,
  space,
  type,
  useAddToPlaylist,
  useLibrary,
  iconSize,
} from '@selfmp3/client'
import { footNotice, footSummary } from '../features/library/library.model'
import { profileName } from '../features/profile/profile.model'
import { library as cloudLibrary } from '../replica'
import { useBucketHold } from '../features/profile/useBucketHold'
import { useRecentTagIds } from '../features/library/recentTags.store'
import { NewPlaylist } from '../features/playlists/NewPlaylist'
import { enterFromSidebar, useRecordSidebarEntry } from './sidebarEntry'
import { PlaylistCover } from '../features/playlists/PlaylistCover'
import { isLive, listedPlaylists } from '../features/playlists/playlists.model'
import { useSongDragActive, useSongDropTarget } from '../ports/songDrag'
import { useMenuCommands } from '../ports/menuKeys'
import { TITLE_BAR_DRAG_ID } from '../ports/titleBarDragId'
import { titleBarInset } from '../ports/titleBarInset'
import { acceleratorKeys } from '../features/settings/shortcuts.model'
import { showToast } from '../ui/toast'
import { useDownloads } from '../offline/DownloadsProvider'
import { useOpenTag } from '../features/tag/useOpenTag'
import { onTagPage } from '../features/tag/placePath.model'
import { existingTag, noTagsLine } from '../features/tag/tag.model'
import { NEW_TAG_FAILED, TagNameField, useNewTagForm } from '../features/tags/useNewTagForm'
import { StatusLine } from '../ui/components/StatusLine'
import { NoticeCard } from '../ui/components/NoticeCard'
import { useConnection } from '../connection/ConnectionProvider'
import { BrandMark } from '../ui/components/BrandMark'
import { Live, More, Plus, Search, Tag as TagIcon } from '../ui/components/Icons'
import { HueSwatches } from '../ui/components/HueSwatches'
import { TagEditor } from '../ui/components/TagEditor'
import { tip } from '../ui/tip'
import { rightClick } from '../ui/rightClick'
import { Avatar } from '../ui/components/Avatar'
import { useAccount } from '../features/profile/useAccount'
import { activeDestination, NAV, navGoes, navItemProps } from './nav.model'
import { NAV_ICON } from './navIcons'
import { useSlidingHighlight } from '../ui/components/SlidingHighlight'
import { useFade } from '../ui/motion'
import { EASE_OUT_CSS, MOVE_MS } from '../ui/motion.model'
import { setPaletteOpen } from './palette'
import { label, serif } from '../ui/surfaces'
import { ScrollView } from '../ui/components/Scroll'
import { TagDot } from '../ui/components/TagDot'
import { Bone, Skeleton } from '../ui/components/Skeleton'
import { ResumeCard } from '../features/devices/ResumeToast'
import { FOCUS_INSIDE } from './tabbing'
import { Press } from '../ui/components/Press'
import { IconButton } from '../ui/components/IconButton'
import { SIDEBAR_WIDTH } from './widths'
import { thisPlace } from '../ports/place'
import { tabbing } from './tabbing'

/**
 * The desktop's left rail.
 *
 * The tab bar's places and two more (`NAV`): a computer reaches Import and
 * Stats from the rail, where a phone reaches them through Profile. Which one a
 * page belongs to is `activeDestination`, and a lit one pressed goes back to
 * its first page, as a tab does (`navGoes`).
 *
 * At the top, under the brand, a Search row that opens the command palette —
 * the one way to it in a browser tab, which has no ⌘K of its own.
 *
 * Playlists are a section whose quiet header is itself the way to the
 * playlists page, with a ＋ that makes any of the three kinds (shown while the
 * pointer is over the header; a right-click on it offers the same); the few
 * played last sit under it, and a song dragged from the library drops onto
 * one. There are no pins (docs/UI-MIGRATION.md, Phase 5), and an empty
 * playlist is not listed.
 *
 * Below them, the tags reached for last: a click opens the tag's page, the ⋯
 * edits it, and the Tags header (or "3 more" under the list) opens all of
 * them. At the foot, you, and a card only when something needs you.
 */
const ROWS = NAV.filter(place => place.rail === 'row')

/** How many playlists the rail lists: the ones played last. The header opens them all. */
const RAIL_PLAYLISTS = 4

/** How many tags the rail lists before "N more". */
const RAIL_TAGS = 8

function SidebarInner(): ReactNode {
  // On an iPad the rail runs up under the status bar, which a phone's tab bar never did.
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const pathname = usePathname()
  // The lit destination's fill slides to the next one, on the spring, as the
  // page changes beside it (docs/ui-mock `M3`, 5). Within these four rows
  // only: Playlists' header, a playlist or a tag further down is lit in place.
  const destination = activeDestination(pathname)
  const lit = ROWS.some(row => row.href === destination) ? destination : null
  const slide = useSlidingHighlight(lit, styles.itemOn)
  // What a press here opens is a place of its own, with no ‹ (J1).
  useRecordSidebarEntry()

  return (
    <View
      style={[styles.rail, { paddingTop: space.xl + insets.top + titleBarInset }]}
      testID="sidebar"
      {...FOCUS_INSIDE}
    >
      {/*
        The installed desktop app's traffic lights sit over this corner. The strip
        is what the window is dragged by, since the window has no title bar of
        its own; it is nothing at all in a browser, where the inset is zero.
      */}
      {titleBarInset > 0 ? (
        <View
          nativeID={TITLE_BAR_DRAG_ID}
          style={[styles.titleBarDrag, { height: titleBarInset }]}
        />
      ) : null}
      {/*
        Everything above the foot scrolls, so on a short window (a 720 p laptop's
        browser) the foot stays in reach rather than going under the player bar.
      */}
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <View style={styles.brand}>
          <BrandMark size={20} />
          <Text style={styles.wordmark}>self.mp3</Text>
        </View>

        <SearchRow />

        <View accessibilityRole="tablist" style={styles.nav}>
          {slide.highlight}
          {ROWS.map(row => {
            const active = row.href === lit
            const Icon = NAV_ICON[row.id]
            return (
              <Press
                key={row.href}
                feedback="wash"
                onLayout={slide.measure(row.href)}
                style={[styles.item, active && !slide.placed && styles.itemOn]}
                onPress={() => {
                  if (!navGoes(pathname, row.href)) return
                  enterFromSidebar()
                  router.navigate(row.href)
                }}
                accessibilityLabel={row.label}
                {...navItemProps(active)}
                testID={`nav-${row.id}`}
              >
                <Icon size={iconSize.medium} tone={active ? 'textPrimary' : 'textMuted'} />
                <Text style={[styles.label, active && styles.labelOn]} numberOfLines={1}>
                  {row.label}
                </Text>
              </Press>
            )
          })}
        </View>

        <Playlists />
        <Tags />
      </ScrollView>
      <Foot />
    </View>
  )
}

/**
 * The key the menu gives Search, drawn beside the row: the installed app's, or
 * an iPad's while a keyboard is attached. Only there: a browser tab has no ⌘K
 * (its ⌘K is the browser's), and a row that named a key that does nothing
 * would teach the wrong thing.
 */
function useSearchKeys(): readonly string[] | null {
  const accelerator = useMenuCommands()?.find(item => item.command === 'search')?.accelerator
  if (!accelerator) return null
  const { modifiers, key } = acceleratorKeys(accelerator)
  return [...modifiers, key]
}

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
  const searchKeys = useSearchKeys()
  return (
    <Press
      feedback="wash"
      onPress={() => setPaletteOpen(true)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel="Search"
      testID="nav-search"
      style={[styles.search, hovered && styles.searchHovered]}
    >
      <Search size={iconSize.button} color={theme.colors.textMuted} />
      <Text style={styles.searchText}>Search</Text>
      {searchKeys ? (
        <View style={styles.searchKeys}>
          {searchKeys.map(key => (
            <Text key={key} style={styles.searchKey}>
              {key}
            </Text>
          ))}
        </View>
      ) : null}
    </Press>
  )
}

function Playlists(): ReactNode {
  const router = useRouter()
  const pathname = usePathname()
  const { data: library } = useLibrary()
  const [newOpen, setNewOpen] = useState(false)

  const all = library?.playlists
  // The ones the playlists page lists: an empty playlist is in neither.
  const listed = useMemo(() => listedPlaylists(all ?? [], 'recent'), [all])
  const recent = listed.slice(0, RAIL_PLAYLISTS)
  // Lit on a playlist's own page too: that page is inside this section.
  const onPage = activeDestination(pathname) === '/playlists'
  /*
   * Songs drop onto these from any list, which nothing says until a song is
   * already being dragged. Shown once, after a song first goes into a
   * playlist from its ⋯ menu: the slow way, just used.
   */
  const dense = useLayoutValue(layout => layout.dense)
  const asked = useGuideAsked('sidebar-drop')
  const [dropTarget, dropGuide] = useGuide(
    'sidebar-drop',
    asked && dense && recent.some(p => p.kind === 'manual'),
  )

  return (
    <View style={styles.section} testID="sidebar-playlists">
      {/*
        A section, as Tags is: its header opens every playlist, and the few
        under it are the ones played last. The ＋ beside the header makes any of
        the three kinds.
      */}
      <GroupHead
        title="Playlists"
        on={onPage}
        onOpen={() => {
          if (!navGoes(pathname, '/playlists')) return
          enterFromSidebar()
          router.navigate('/playlists')
        }}
        openProps={{ accessibilityLabel: 'Playlists', ...navItemProps(onPage) }}
        testID="nav-playlists"
        newLabel="New playlist"
        onNew={() => setNewOpen(open => !open)}
        newShown={newOpen}
      />

      <View ref={dropTarget} collapsable={false}>
        {library ? null : <RailWaiting kind="playlists" />}
        {recent.map(playlist => (
          <RailPlaylist
            key={playlist.id}
            playlist={playlist}
            active={pathname === `/playlists/${playlist.id}`}
            onOpen={() => {
              enterFromSidebar()
              router.navigate({ pathname: '/playlists/[id]', params: { id: String(playlist.id) } })
            }}
          />
        ))}
      </View>

      <NewPlaylist open={newOpen} onClose={() => setNewOpen(false)} />
      <Guide
        guide={dropGuide}
        radius={10}
        steps={[
          {
            gesture: 'drag-to',
            text: 'Drag songs onto a playlist to add them',
            sub: 'Several at once, if you’ve selected them',
          },
        ]}
      />
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
  // A live playlist cannot take a dropped song, and says so by dimming while
  // one is carried: a fade, so the whole column does not blink as the drag
  // begins.
  const dimmed = useFade(dragging && live, MOVE_MS.hoverIn, MOVE_MS.hoverOut)
  const [dim] = useState(() => ({
    opacity: dimmed.interpolate({ inputRange: [0, 1], outputRange: [1, DIM_WHILE_DRAGGING] }),
  }))
  const addToPlaylist = useAddToPlaylist()
  const over = useSongDropTarget(ref, {
    enabled: !live,
    onDrop: songIds => {
      addToPlaylist.mutate({ playlistId: playlist.id, songIds })
      showToast(
        { over: `Added to ${playlist.name}`, say: plural(songIds.length, 'song', 'songs') },
        'good',
      )
    },
  })

  return (
    <Animated.View ref={ref} collapsable={false} style={dim}>
      <Press
        feedback="wash"
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={playlist.name}
        accessibilityState={{ selected: active }}
        style={[styles.playlistRow, active && styles.itemOn, over && styles.dropping]}
      >
        <PlaylistCover playlist={playlist} size={22} />
        <Text style={[styles.playlistName, active && styles.labelOn]} numberOfLines={1}>
          {playlist.name}
        </Text>
        {live ? <Live size={iconSize.sub} tone="textMuted" /> : null}
      </Press>
      {over ? <Text style={[styles.dropHint, styles.labelOn]}>Drop to add</Text> : null}
    </Animated.View>
  )
}

function Tags(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const pathname = usePathname()
  const { data: library } = useLibrary()
  const [adding, setAdding] = useState(false)

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
  const rail = useMemo(() => railTags(recentIds, tags, RAIL_TAGS), [recentIds, tags])
  const more = tags.length - rail.length
  const openAll = (): void => {
    enterFromSidebar()
    router.navigate('/tags')
  }

  // A tag is a place (docs/UI-MIGRATION.md, Phase 4): choosing one opens its
  // page, which is already open when its row is lit.
  const openTag = useOpenTag()
  const open = (tag: Tag): void => {
    if (!onTagPage(pathname, tag.name)) openTag(tag, { from: 'sidebar' })
  }

  // Made, or already there and opened: the form has done its job and closes.
  const form = useNewTagForm({
    tags,
    onExisting: tag => {
      open(tag)
      setAdding(false)
    },
    onMade: () => setAdding(false),
  })
  const trimmed = form.name.trim()
  const suggestions = trimmed ? fuzzyRank(trimmed, tags, tag => tag.name).slice(0, 3) : []
  const exact = existingTag(tags, trimmed)

  return (
    <View style={styles.group}>
      <GroupHead
        title="Tags"
        on={pathname === '/tags'}
        onOpen={openAll}
        openProps={{
          accessibilityRole: 'link',
          accessibilityLabel: `All ${plural(tags.length, 'tag', 'tags')}`,
        }}
        testID="sidebar-tags"
        newLabel="New tag"
        onNew={() => setAdding(isOpen => !isOpen)}
        newShown={adding}
      />

      {adding ? (
        <View style={styles.tagForm} testID="sidebar-new-tag">
          <TagNameField
            form={form}
            size="small"
            placeholder="tag name"
            autoFocus
            onBlur={() => {
              if (!form.name) setAdding(false)
            }}
            testID="sidebar-new-tag-name"
          />
          <View style={styles.tagHues}>
            <HueSwatches value={form.hue} first={form.autoHue} onChange={form.setHue} size={16} />
          </View>
          {form.failed ? <StatusLine>{NEW_TAG_FAILED}</StatusLine> : null}
          {suggestions.length > 0 ? (
            <View style={styles.suggestions}>
              <Text style={styles.hint}>{exact ? 'already exists:' : 'similar:'}</Text>
              {suggestions.map(({ item }) => (
                <Press
                  key={item.id}
                  style={styles.suggestion}
                  onPress={() => {
                    open(item)
                    setAdding(false)
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.suggestionText}>{item.name}</Text>
                </Press>
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
        {more > 0 ? (
          <Press
            feedback="dim"
            onPress={openAll}
            accessibilityRole="link"
            accessibilityLabel={`All ${plural(tags.length, 'tag', 'tags')}`}
            style={styles.moreTags}
            testID="sidebar-more-tags"
          >
            <Text style={styles.hint}>{more} more</Text>
          </Press>
        ) : null}
        {!library && !adding ? (
          // Not "no tags yet": with the library unreachable or still coming,
          // this device does not know whether there are any.
          <RailWaiting kind="tags" />
        ) : null}
        {library && tags.length === 0 && !adding ? (
          <View style={styles.tagEmpty}>
            <TagIcon size={iconSize.item} color={theme.colors.textMuted} />
            <Text style={styles.hint}>{noTagsLine()}</Text>
            <Press feedback="dim" onPress={() => setAdding(true)} accessibilityRole="button">
              <Text style={styles.link}>Add your first tag</Text>
            </Press>
          </View>
        ) : null}
      </ScrollView>
      {form.nudge}
    </View>
  )
}

/** The names whose shapes the rail draws while the library is on its way, as shares of a row. */
const RAIL_WAITING = ['64%', '48%', '72%', '40%'] as const

/**
 * A rail section's rows while the library is on its way (AA1): a playlist's
 * cover or a tag's dot, and a name, at the rows' own size and inset.
 */
function RailWaiting({ kind }: { kind: 'playlists' | 'tags' }): ReactNode {
  const shown = kind === 'playlists' ? RAIL_WAITING.slice(0, 3) : RAIL_WAITING
  return (
    <Skeleton label={kind === 'playlists' ? 'Loading playlists' : 'Loading tags'}>
      {shown.map(width => (
        <View key={width} style={kind === 'playlists' ? styles.playlistWaiting : styles.tagWaiting}>
          {kind === 'playlists' ? (
            <Bone width={22} height={22} radius={radius.coverSm - 2} />
          ) : (
            <Bone width={8} height={8} radius={radius.pill} />
          )}
          <Bone width={width} height={10} radius={radius.pill} />
        </View>
      ))}
    </Skeleton>
  )
}

/**
 * A section's header in the rail: its name, quiet and in sentence case, which
 * opens the whole page; and a ＋ that makes a new one. With a mouse the ＋
 * waits for the pointer to come over the header, as a tag row's ⋯ does, and a
 * right-click on the header makes a new one too; a finger sees it always.
 */
function GroupHead({
  title,
  on,
  onOpen,
  openProps,
  testID,
  newLabel,
  onNew,
  newShown,
}: {
  title: string
  on: boolean
  onOpen: () => void
  openProps: Partial<ComponentProps<typeof Press>>
  testID: string
  newLabel: string
  onNew: () => void
  /** The new form is open, so the ＋ that closes it stays. */
  newShown: boolean
}): ReactNode {
  const finePointer = useLayoutValue(layout => layout.finePointer)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const reveal = useFade(
    !finePointer || hovered || focused || newShown,
    MOVE_MS.hoverIn,
    MOVE_MS.hoverOut,
  )
  return (
    <View
      style={styles.groupTitle}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      {...rightClick(onNew)}
    >
      <Press
        feedback="dim"
        onPress={onOpen}
        {...openProps}
        testID={testID}
        style={styles.groupTitleMain}
      >
        <Text style={[styles.groupTitleText, on && styles.groupTitleOn]}>{title}</Text>
      </Press>
      <Animated.View style={{ opacity: reveal }}>
        <IconButton
          size={TINY_BUTTON}
          onPress={onNew}
          label={newLabel}
          onFocus={() => setFocused(tabbing())}
          onBlur={() => setFocused(false)}
        >
          <Plus size={iconSize.field} tone="textMuted" />
        </IconButton>
      </Animated.View>
    </View>
  )
}

/**
 * One tag in the sidebar: a click opens its page, which lights the row while
 * you are on it, and the ⋯ the pointer reveals edits it, as a right-click does.
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
  // A pointer can hover, so the row's controls wait for it; a finger cannot,
  // so they are simply there. Asked of the pointer and not of the platform —
  // a touch-screen browser never hovers, and an iPad with a trackpad does.
  const finePointer = useLayoutValue(layout => layout.finePointer)
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const moreRef = useRef<View>(null)
  const revealed = !finePointer || hovered || editing
  // The ⋯ fades in as the pointer arrives and out as it leaves, on the same
  // clocks as a song row's controls (`M3`, 3).
  const reveal = useFade(revealed, MOVE_MS.hoverIn, MOVE_MS.hoverOut)

  return (
    <View
      style={[styles.tagRow, hovered && styles.tagRowHovered, active && styles.itemOn]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // A right-click opens the same editor, from the row's ⋯ (B1).
      {...rightClick(() => setEditing(true))}
    >
      <Press
        feedback="dim"
        style={styles.tagMain}
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={tag.name}
        accessibilityState={{ selected: active }}
      >
        <TagDot hue={tag.hue} />
        <Text style={[styles.tagName, active && styles.labelOn]} numberOfLines={1}>
          {tag.name}
        </Text>
        <Text style={styles.count}>{tag.songCount}</Text>
      </Press>

      <Animated.View ref={moreRef} collapsable={false} style={{ opacity: reveal }}>
        <Press
          feedback="dim"
          style={[styles.tagAction, styles.tagActionLast]}
          onPress={() => setEditing(isOpen => !isOpen)}
          accessibilityRole="button"
          accessibilityLabel={`Edit tag ${tag.name}`}
          {...tip('Rename, recolour or delete')}
          accessibilityState={{ expanded: editing }}
        >
          <More size={iconSize.sub} color={theme.colors.textMuted} />
        </Press>
      </Animated.View>

      <TagEditor tag={editing ? tag : null} anchorRef={moreRef} onClose={() => setEditing(false)} />
    </View>
  )
}

/**
 * The foot: you (`C03`) — your first name, or "Profile" when Google gave none —
 * with a dot on the avatar. It opens Profile.
 *
 * On a normal day that is all it says: where the library is kept only matters
 * when something stops working, and a status line read on every page said
 * "Connected to your server" to nobody. Hovering says "All saved" and how
 * much is on this computer. When something needs you — offline, the library
 * out of reach, the storage's allowance used up — a card above the name says
 * what still works and what to do (G1).
 */
function Foot(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const pathname = usePathname()
  const account = useAccount()
  const library = useLibrary()
  const { state, installed } = useDownloads()
  const { fromCloud } = useConnection()
  const held = useBucketHold() !== null
  /*
   * Of this library, what is here — not how many files the device is keeping.
   * The index holds an entry for every song ever downloaded, a replaced
   * library's included, so counting entries can say more are saved than exist.
   */
  const librarySongs = library.data?.songs
  const { songs, here } = useMemo(
    () => downloadTally(state.index, librarySongs?.map(song => song.id) ?? []),
    [state.index, librarySongs],
  )

  const name = profileName(account?.name)
  const place = thisPlace()
  // A failed refetch keeps the cached library, so an error wins over the data.
  // Edits a cloud library is still holding are read as the foot draws, which
  // it does again whenever the library's answer changes.
  const notice = footNotice({
    error: library.isError ? library.error : null,
    held,
    fromCloud,
    keepsSongs: installed,
    place,
    unsent: fromCloud && library.isError ? cloudLibrary.pendingCloudChanges() : 0,
  })
  const dot = notice
    ? theme.colors.warning
    : library.isPending
      ? theme.colors.textMuted
      : theme.colors.good
  const summary = library.data ? footSummary({ songs, here, place }) : null

  return (
    <View style={styles.foot}>
      {notice ? (
        <NoticeCard
          tone="warn"
          wash
          compact
          live
          title={notice.title}
          style={styles.notice}
          testID="sidebar-notice"
        >
          {notice.body}
        </NoticeCard>
      ) : null}
      {/* Another device's song, waiting to be picked up here (AE1). */}
      <ResumeCard />
      <Press
        feedback="wash"
        style={[styles.status, pathname === '/profile' && styles.itemOn]}
        onPress={() => {
          enterFromSidebar()
          router.navigate('/profile')
        }}
        accessibilityRole="button"
        accessibilityLabel={!notice && summary ? `${name}. ${summary}` : name}
        testID="sidebar-status"
        {...tip(notice ? null : summary)}
      >
        <Avatar account={account} size={AVATAR}>
          <View style={[styles.statusDot, { backgroundColor: dot }]} />
        </Avatar>
        <Text style={styles.footLabel} numberOfLines={1}>
          {name}
        </Text>
      </Press>
    </View>
  )
}

/** The ＋ beside a section's header. */
const TINY_BUTTON = 24

/** The round mark on the rail's own row. */
const AVATAR = 30

/** The type of a row's name in the rail, and of its search and new-tag fields. */
const ITEM_TEXT = type.sub

/** How dim a playlist that cannot take the song goes while one is carried. */
const DIM_WHILE_DRAGGING = 0.35

/**
 * A row warming under a pointer and cooling as it leaves (`M3`, 3), which a
 * browser moves itself: the colour cannot go on the native driver, and only
 * a browser has a pointer to warm under.
 */
const HOVER_TRANSITION = {
  transitionProperty: 'background-color, border-color',
  transitionDuration: `${MOVE_MS.hoverOut}ms`,
  transitionTimingFunction: EASE_OUT_CSS,
} as const

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
  // Out to the rail's edges, so a focus ring or a dragged-over row's edge is
  // not clipped by the scroller; the rail's own margin is put back inside.
  body: { flex: 1, minHeight: 0, marginHorizontal: -space.md },
  bodyContent: { flexGrow: 1, gap: space.xl, paddingHorizontal: space.md },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
  },
  // The name in the serif, as the install page and the welcome screen set it.
  wordmark: serif(theme.colors, 'large'),
  nav: {
    gap: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.item,
  },
  label: {
    color: theme.colors.textSecondary,
    fontSize: type.body,
  },
  search: {
    _web: HOVER_TRANSITION,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
    paddingHorizontal: space.sm,
    marginTop: -space.sm,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  // Pointed at, a step lighter in tone, with no edge.
  searchHovered: {
    backgroundColor: theme.colors.surface3,
    _web: { transitionDuration: `${MOVE_MS.hoverIn}ms` },
  },
  searchText: { flex: 1, color: theme.colors.textMuted, fontSize: ITEM_TEXT },
  searchKeys: { flexDirection: 'row', gap: 3 },
  searchKey: {
    minWidth: 18,
    paddingHorizontal: space.xs,
    textAlign: 'center',
    fontSize: type.tiny,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    backgroundColor: theme.colors.surface1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  section: { gap: 1 },
  playlistRow: {
    _web: HOVER_TRANSITION,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
    paddingHorizontal: space.tight,
    borderRadius: radius.item,
    // Clear until a song is dragged over: then the dashed edge is the drop
    // target itself.
    borderWidth: 1,
    borderColor: 'transparent',
  },
  playlistName: { flex: 1, color: theme.colors.textSecondary, fontSize: ITEM_TEXT },
  dropping: {
    borderStyle: 'dashed',
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.accent,
  },
  // Where you are: a lighter surface and full-strength ink, not the accent,
  // which is kept for the button that commits something (`S2`). Raised rather
  // than `surfaceSelected`, which is white on Paper, as the rail is.
  // The radius is the highlight's own: the sliding fill is a view behind the
  // rows, not the row itself, so without it the lit destination would have
  // square corners while every row it slid between was rounded.
  itemOn: { backgroundColor: theme.colors.surface3, borderRadius: radius.item },
  labelOn: { color: theme.colors.textPrimary, fontWeight: '600' },
  dropHint: { fontSize: type.tiny, paddingHorizontal: space.snug, paddingBottom: 2 },
  /* `.nav-group-grow`: the tag list takes what is left; short of room, the rail scrolls. */
  group: { flexGrow: 1, gap: 1 },
  groupTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.tight,
    paddingHorizontal: space.snug,
  },
  groupTitleMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: space.sm,
  },
  groupTitleText: label(theme.colors),
  groupTitleOn: { color: theme.colors.textPrimary },
  moreTags: { paddingVertical: space.tight, paddingHorizontal: space.snug },
  tagForm: {
    gap: space.tight,
    paddingTop: space.xs,
    paddingHorizontal: space.snug,
    paddingBottom: space.sm,
  },
  tagHues: { marginHorizontal: -4 },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    marginTop: space.tight,
  },
  suggestion: {
    backgroundColor: theme.colors.surface3,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
  },
  suggestionText: { color: theme.colors.textSecondary, fontSize: type.tiny },
  tagList: { flexGrow: 1 },
  tagListContent: { gap: 1 },
  tagRow: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.item },
  playlistWaiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
    paddingHorizontal: space.tight + 1,
  },
  tagWaiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 30,
    paddingLeft: space.snug,
  },
  tagMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.tight,
    paddingRight: space.xs,
    paddingBottom: space.tight,
    paddingLeft: space.snug,
  },
  tagName: { flex: 1, color: theme.colors.textSecondary, fontSize: ITEM_TEXT },
  count: { color: theme.colors.textMuted, fontSize: type.tiny, fontVariant: ['tabular-nums'] },
  tagAction: { paddingVertical: space.tight, paddingHorizontal: 5 },
  tagRowHovered: {
    backgroundColor: theme.colors.surface2,
    _web: { transitionDuration: `${MOVE_MS.hoverIn}ms` },
  },
  tagActionLast: { paddingRight: space.sm },
  tagEmpty: {
    alignItems: 'flex-start',
    gap: space.tight,
    paddingVertical: space.roomy,
    paddingHorizontal: space.snug,
    marginTop: 2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.card,
  },
  hint: { color: theme.colors.textMuted, fontSize: type.small },
  link: {
    color: theme.colors.textSecondary,
    fontSize: type.small,
    textDecorationLine: 'underline',
  },
  foot: { paddingTop: space.snug, gap: 1 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    paddingVertical: space.tight,
    paddingHorizontal: space.snug,
    borderRadius: radius.item,
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
  // Something needs you: what still works, and what to do. The warning's own
  // tone on a quiet ground, the way a toast says "warn".
  notice: { marginHorizontal: 2, marginBottom: space.sm },
  footLabel: { flex: 1, minWidth: 0, color: theme.colors.textSecondary, fontSize: ITEM_TEXT },
}))

/**
 * The rail is the same on every page, and the frame around it is rebuilt
 * several times on a single step between pages: without this the playlists,
 * the tags and the status row would be reconciled every one of those times.
 */
export const Sidebar = memo(SidebarInner)
