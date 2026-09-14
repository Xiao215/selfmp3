import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { GestureResponderEvent } from 'react-native'
import { usePathname, useRouter } from 'expo-router'
import { fuzzyRank, type Tag } from '@selfmp3/shared'
import {
  clearTagFilter,
  downloadedCount,
  excludeTag,
  includeTag,
  oklchToHexAlpha,
  radius,
  space,
  tagFilterState,
  tagFiltered,
  type,
  type TagFilterState,
} from '@selfmp3/client'
import { useCreateTag, useLibrary } from '../api/queries'
import { useLibraryFilter } from '../features/library/libraryFilter'
import { useDownloads } from '../offline/DownloadsProvider'
import { isUntagged } from '../features/inbox/inbox.model'
import { useConnection } from '../server/ConnectionProvider'
import { useAccent } from '../ui/accent'
import { BrandMark } from '../ui/components/BrandMark'
import {
  BarChart,
  Download,
  Inbox,
  ListMusic,
  Minus,
  More,
  Music,
  Plus,
  Settings,
  Tag as TagIcon,
  X,
} from '../ui/components/Icons'
import { TagEditor } from '../ui/components/TagEditor'
import { tip } from '../ui/tip'

/**
 * The desktop's left rail: the web app's `.sidebar`.
 *
 * The same destinations the tab bar carries, in the same order, from the same
 * route files — `docs/UNIVERSAL.md` foundation 5. Only the arrangement differs,
 * which is what a breakpoint is for: a row of icons along the bottom under 820,
 * a column with words beside them above it.
 *
 * Below the destinations, the web's tag list, which is how a desktop filters
 * the library: a click shows only a tag, the − beside it hides the tag, the ⋯
 * edits it. At the foot, a status line: reachable or not, and what is offline.
 */
const DESTINATIONS: {
  href: '/' | '/playlists' | '/import' | '/stats' | '/settings'
  label: string
  Icon: typeof Music
  /** Needs the Mac's own tools: a cloud library has none, as on the web. */
  mac?: boolean
}[] = [
  { href: '/', label: 'Library', Icon: Music },
  { href: '/playlists', label: 'Playlists', Icon: ListMusic },
  // A cloud library imports too: the link waits in the bucket for the Mac.
  { href: '/import', label: 'Import', Icon: Download },
  { href: '/stats', label: 'Stats', Icon: BarChart, mac: true },
  { href: '/settings', label: 'Settings', Icon: Settings },
]

export const SIDEBAR_WIDTH = 244

/** A pointer can hover here, so a row's controls wait for it. A tablet shows them. */
const HOVERS = Platform.OS === 'web'

export function Sidebar(): ReactNode {
  // On an iPad the rail runs up under the status bar, which a phone's tab bar never did.
  const insets = useSafeAreaInsets()
  const { theme } = useUnistyles()
  const router = useRouter()
  const pathname = usePathname()
  const accent = useAccent()
  const { fromCloud } = useConnection()

  return (
    <View style={[styles.rail, { paddingTop: space.xl + insets.top }]} testID="sidebar">
      <View style={styles.brand}>
        <BrandMark size={20} />
        <Text style={styles.wordmark}>self.mp3</Text>
      </View>

      <View accessibilityRole="tablist" style={styles.nav}>
        {DESTINATIONS.filter(destination => !fromCloud || !destination.mac).map(destination => {
          const active =
            destination.href === '/' ? pathname === '/' : pathname.startsWith(destination.href)
          return (
            <Pressable
              key={destination.href}
              style={[styles.item, active && { backgroundColor: accent.accentPill }]}
              onPress={() => {
                if (!active) router.navigate(destination.href)
              }}
              accessibilityRole="tab"
              accessibilityLabel={destination.label}
              accessibilityState={{ selected: active }}
              testID={`nav-${destination.label.toLowerCase()}`}
            >
              <destination.Icon size={18} color={active ? accent.accent : theme.colors.textMuted} />
              <Text
                style={[styles.label, active && { color: accent.accent, fontWeight: '600' }]}
                numberOfLines={1}
              >
                {destination.label}
              </Text>
            </Pressable>
          )
        })}
      </View>

      <Tags />
      <Foot />
    </View>
  )
}

function Tags(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const pathname = usePathname()
  const { data: library } = useLibrary()
  const [filter, setFilter] = useLibraryFilter()
  const createTag = useCreateTag()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const tags = library?.tags ?? []
  const untaggedCount = (library?.songs ?? []).filter(isUntagged).length
  const { fromCloud } = useConnection()
  const trimmed = name.trim()
  const suggestions = trimmed ? fuzzyRank(name, tags, tag => tag.name).slice(0, 3) : []
  const exact = suggestions.find(match => match.exact)

  // A tag filters the library, so choosing one from elsewhere goes there.
  const toLibrary = (): void => {
    if (pathname !== '/') router.navigate('/')
  }
  const include = (tagId: number): void => {
    setFilter(current => includeTag(current, tagId))
    toLibrary()
  }
  const exclude = (tagId: number): void => {
    setFilter(current => excludeTag(current, tagId))
    toLibrary()
  }
  const showOnly = (tagId: number): void => {
    if (tagFilterState(filter, tagId) !== 'include') include(tagId)
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
        {untaggedCount > 0 && !fromCloud ? (
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
        {tags.map(tag => (
          <TagRow
            key={tag.id}
            tag={tag}
            state={tagFilterState(filter, tag.id)}
            onInclude={() => include(tag.id)}
            onExclude={() => exclude(tag.id)}
          />
        ))}
        {tags.length === 0 && !adding ? (
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
 * One tag in the sidebar. A click shows only it (⌥-click hides it instead);
 * the two controls the pointer reveals hide it and edit it. Hiding stays
 * visible while it is on, so a hidden tag always shows how to stop hiding it.
 */
function TagRow({
  tag,
  state,
  onInclude,
  onExclude,
}: {
  tag: Tag
  state: TagFilterState
  onInclude: () => void
  onExclude: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const [hovered, setHovered] = useState(false)
  const [editing, setEditing] = useState(false)
  const moreRef = useRef<View>(null)
  const revealed = !HOVERS || hovered || editing
  const excluded = state === 'exclude'
  const included = state === 'include'

  return (
    <View
      style={[
        styles.tagRow,
        (hovered || excluded) && { backgroundColor: theme.colors.surface2 },
        included && { backgroundColor: oklchToHexAlpha(0.35, 0.09, tag.hue, 0.32) },
      ]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Pressable
        style={styles.tagMain}
        onPress={(event: GestureResponderEvent) => {
          const alt = (event.nativeEvent as unknown as { altKey?: boolean }).altKey === true
          if (alt) onExclude()
          else onInclude()
        }}
        accessibilityRole="button"
        accessibilityLabel={tag.name}
        accessibilityState={{ selected: included }}
      >
        <View
          style={[
            styles.dot,
            excluded
              ? { borderWidth: 1.5, borderColor: oklchToHexAlpha(0.68, 0.15, tag.hue, 1) }
              : { backgroundColor: oklchToHexAlpha(0.68, 0.15, tag.hue, 1) },
          ]}
        />
        <Text style={[styles.tagName, included && styles.tagNameIncluded]} numberOfLines={1}>
          {excluded ? <Text style={styles.not}>not </Text> : null}
          {tag.name}
        </Text>
        <Text style={styles.count}>{tag.songCount}</Text>
      </Pressable>

      <Pressable
        style={[styles.tagAction, { opacity: revealed || excluded ? 1 : 0 }]}
        onPress={onExclude}
        accessibilityRole="button"
        accessibilityLabel={excluded ? `Stop hiding ${tag.name}` : `Hide songs tagged ${tag.name}`}
        {...tip(excluded ? 'Stop hiding' : 'Hide these songs')}
        accessibilityState={{ selected: excluded }}
      >
        <Minus size={13} color={excluded ? theme.colors.danger : theme.colors.textMuted} />
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
        filter={state}
        onInclude={onInclude}
        onExclude={onExclude}
        onDeleted={() => {
          if (included) onInclude()
          if (excluded) onExclude()
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
  const saved = downloadedCount(state.index)
  const songs = library.data?.songs.length ?? 0

  // A failed refetch keeps the cached library, so an error wins over the data.
  const [dot, label] = library.isError
    ? [theme.colors.danger, fromCloud ? 'Can’t reach the cloud' : 'Can’t reach your Mac']
    : library.isPending
      ? [theme.colors.warning, 'Connecting…']
      : [theme.colors.good, fromCloud ? 'Cloud library' : 'Connected to your Mac']
  const detail = `${songs} ${songs === 1 ? 'song' : 'songs'} · ${
    saved > 0 ? `${saved} saved offline` : 'none saved offline'
  }`

  return (
    <View style={styles.foot}>
      <Pressable
        style={({ pressed }) => [styles.status, pressed && { backgroundColor: theme.colors.surface2 }]}
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
