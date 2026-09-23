import { useEffect, useCallback, memo, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { TAG_NAME_MAX, type Tag } from '@selfmp3/shared'
import {
  fonts,
  HIT_TARGET,
  radius,
  space,
  tagColors,
  type,
  useCreateTag,
  useLibrary,
} from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { setPaletteOpen } from '../../shell/palette'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Plus,
  Search,
  Tag as TagIcon,
  X,
} from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { HueSwatches, autoTagHue } from '../../ui/components/HueSwatches'
import { TagEditor } from '../../ui/components/TagEditor'
import { usePressScale } from '../../ui/motion'
import { card, label, pageTitle } from '../../ui/surfaces'
import { noteTagUsed } from '../library/recentTags.store'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { tagLink } from '../tag/placeLinks'
import {
  existingTag,
  tagLine,
  tagsMostPlayed,
  untaggedCardTitle,
  type TagStanding,
} from '../tag/tag.model'
import { useArtistNudge } from '../tag/useArtistNudge'
import { usePlayAndTag } from '../tag/usePlayAndTag'
import { tagsHeadline } from './tags.model'

/**
 * All tags (docs/ui-mock `P07`): every tag as a place to go, most played
 * first.
 *
 * A row opens the tag's page, and its round Play plays the tag where it
 * stands. The housekeeping that used to be this whole page — renaming,
 * recolouring, deleting — is what holding a row does now, so the page reads
 * as the tags you listen to rather than a settings list of them. Picking tags
 * to combine is not here either: a tag's page has Add for that.
 *
 * At the top, only while some songs have no tag, one card that tags them one
 * at a time while they play (docs/UI-MIGRATION.md, Open question 1).
 */
export function TagsScreen(): ReactNode {
  const { wide } = useLayout()
  const router = useRouter()
  const player = usePlayer()
  const { data: library } = useLibrary()
  const playAndTag = usePlayAndTag()
  const [adding, setAdding] = useState(false)
  /*
   * The row handlers are made once and take the row they act on. As arrows in
   * the list below they were new on every render, so every tag row — and the
   * four covers in each one's mosaic — redrew whenever the screen did, which
   * on this page is every play, pause and skip (`usePlayer` above).
   */
  const latest = useRef({ player, router })
  useEffect(() => {
    latest.current = { player, router }
  })
  const holdRowRef = useCallback((tagId: number, node: View | null) => {
    if (node) rowRefs.current.set(tagId, node)
    else rowRefs.current.delete(tagId)
  }, [])
  const openTag = useCallback((standing: TagStanding) => {
    noteTagUsed(standing.tag.id)
    latest.current.router.navigate(tagLink(standing.tag.name))
  }, [])
  const playTag = useCallback((standing: TagStanding) => {
    const ids = standing.songs.map(song => song.id)
    if (ids.length === 0) return
    noteTagUsed(standing.tag.id)
    latest.current.player.playFrom(ids, 0)
  }, [])
  const [editing, setEditing] = useState<Tag | null>(null)
  // The editor is anchored to the row that was held. One anchor for the page,
  // pointed at that row as it opens, so the page keeps a single editor.
  const editorAnchor = useRef<View | null>(null)
  const rowRefs = useRef(new Map<number, View>())

  const tags = useMemo<readonly Tag[]>(() => library?.tags ?? [], [library?.tags])
  const standings = useMemo(
    () => (library ? tagsMostPlayed(library.tags, library.songs) : []),
    [library],
  )

  const back = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }
  // The one Search, on its Tags scope: the page on a phone, the palette over
  // this page on a computer (docs/ui-mock `P18`, `C05`).
  const openSearch = (): void => {
    if (wide) setPaletteOpen(true)
    else router.navigate({ pathname: '/search', params: { scope: 'tags' } })
  }
  // Stable, because a row is memoised and this is the prop every one of them holds.
  const edit = useCallback((tag: Tag) => {
    editorAnchor.current = rowRefs.current.get(tag.id) ?? null
    setEditing(tag)
  }, [])

  return (
    <SafeAreaView style={styles.screen} edges={['top']} testID="tags-screen">
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <IconButton label="Back" filled onPress={back} testID="tags-back">
            <ChevronLeft size={18} tone="textPrimary" />
          </IconButton>
          <View style={styles.titles}>
            <Text style={styles.heading} accessibilityRole="header">
              Tags
            </Text>
            {library ? <Text style={styles.sub}>{tagsHeadline(tags.length)}</Text> : null}
          </View>
          <IconButton
            label="New tag"
            filled
            active={adding}
            onPress={() => setAdding(open => !open)}
            testID="tags-new"
          >
            <Plus size={18} tone="textPrimary" />
          </IconButton>
          <IconButton label="Search tags" filled onPress={openSearch} testID="tags-search">
            <Search size={18} tone="textPrimary" />
          </IconButton>
        </View>

        {adding ? (
          <NewTag
            tags={tags}
            onExisting={tag => {
              // Choosing the tag that exists beats silently making a twin of it:
              // its editor opens, on its row.
              edit(tag)
            }}
            onClose={() => setAdding(false)}
          />
        ) : null}

        {playAndTag.count > 0 ? (
          <UntaggedCard count={playAndTag.count} onPress={playAndTag.start} />
        ) : null}

        {!library ? (
          <Text style={styles.hint}>Tags load with your library.</Text>
        ) : standings.length === 0 ? (
          <Text style={styles.hint}>
            No tags yet. Tags are how this library is browsed — make one with the +, or put one on a
            song from its ⋯ while it plays.
          </Text>
        ) : (
          <View style={styles.rows}>
            {standings.map((standing, index) => (
              <TagRow
                key={standing.tag.id}
                standing={standing}
                index={index}
                rowRef={holdRowRef}
                onOpen={openTag}
                onPlay={playTag}
                onHold={edit}
              />
            ))}
            <Text style={styles.footer}>Hold a tag to rename, recolour or delete it.</Text>
          </View>
        )}
        <ChromeSpacer />
      </ScrollView>

      <TagEditor tag={editing} anchorRef={editorAnchor} onClose={() => setEditing(null)} />
    </SafeAreaView>
  )
}

/**
 * Making a tag, in the page: the card the rest of the app makes things in — a
 * label, a field that shows its focus the way every other field does, and the
 * button that does it beside it, disabled until there is a name to give. A
 * name that is an artist's asks first (`P11`).
 */
function NewTag({
  tags,
  onExisting,
  onClose,
}: {
  tags: readonly Tag[]
  onExisting: (tag: Tag) => void
  onClose: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const createTag = useCreateTag()
  const nudge = useArtistNudge()
  const [name, setName] = useState('')
  // A colour picked for the new tag; left alone, the name chooses one.
  const [hue, setHue] = useState<number | undefined>(undefined)
  const [focused, setFocused] = useState(false)
  const trimmed = name.trim()
  const autoHue = autoTagHue(trimmed)

  const make = async (wanted: string): Promise<void> => {
    const tag = { name: wanted, ...(hue === undefined ? {} : { hue }) }
    if (!(await createTag.mutateAsync(tag).catch(() => null))) return
    // The field stays open and empty: tags arrive in handfuls, and a second
    // one should not cost another trip to the +. The colour goes too: the
    // next tag is its own, not a twin of this one.
    setName('')
    setHue(undefined)
  }

  const submit = (): void => {
    if (!trimmed) return
    const already = existingTag(tags, trimmed)
    if (already) {
      setName('')
      onExisting(already)
      return
    }
    nudge.check(trimmed, () => void make(trimmed))
  }

  const close = (): void => {
    createTag.reset()
    onClose()
  }

  return (
    <View style={styles.newCard} testID="tags-new-form">
      <View style={styles.newHeadRow}>
        <Text style={styles.fieldLabel}>New tag</Text>
        <Pressable
          onPress={close}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close new tag"
        >
          <X size={14} color={theme.colors.textMuted} />
        </Pressable>
      </View>
      <View style={styles.newRow}>
        <TextInput
          style={[styles.input, focused && { borderColor: accent.accent }]}
          value={name}
          onChangeText={text => {
            setName(text)
            createTag.reset()
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={submit}
          placeholder="chill, 中文, gym…"
          placeholderTextColor={theme.colors.textMuted}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          // Enter makes the tag and stays in the field: tags arrive in
          // handfuls, and dismissing the keyboard after each one costs a tap
          // to get it back.
          submitBehavior="submit"
          returnKeyType="done"
          maxLength={TAG_NAME_MAX}
          accessibilityLabel="New tag name"
          testID="tags-new-name"
        />
        <Button
          label="Create"
          variant="primary"
          disabled={trimmed.length === 0}
          busy={createTag.isPending}
          onPress={submit}
          testID="tags-create"
        />
      </View>
      <View style={styles.newColour}>
        <Text style={styles.fieldLabel}>Colour</Text>
        <HueSwatches value={hue ?? autoHue} first={autoHue} onChange={setHue} />
      </View>
      {createTag.isError ? (
        <Text style={styles.error}>Couldn’t make that tag. Try a different name.</Text>
      ) : (
        <Text style={styles.newHint}>
          A tag is a word or two. Put it on songs from a song’s ⋯, or while one is playing.
        </Text>
      )}
      {nudge.nudge}
    </View>
  )
}

/** "2 songs have no tag yet": tapping it plays them and opens Now Playing to tag them. */
function UntaggedCard({ count, onPress }: { count: number; onPress: () => void }): ReactNode {
  const press = usePressScale(0.98)
  return (
    <Animated.View style={press.style}>
      <Pressable
        {...press.handlers}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${untaggedCardTitle(count)}. Tag them one at a time, while they play`}
        testID="tags-untagged"
        style={styles.untagged}
      >
        <View style={styles.untaggedIcon}>
          <TagIcon size={17} tone="textPrimary" />
        </View>
        <View style={styles.untaggedText}>
          <Text style={styles.untaggedTitle} numberOfLines={1}>
            {untaggedCardTitle(count)}
          </Text>
          <Text style={styles.untaggedSub} numberOfLines={1}>
            Tag them one at a time, while they play
          </Text>
        </View>
        <ChevronRight size={16} tone="textMuted" />
      </Pressable>
    </Animated.View>
  )
}

/** How long a row is held before its editor opens, as a song row's hold selects. */
const HOLD_MS = 450

/**
 * One tag's row. Memoised, and handed handlers that take the row they act on
 * rather than closing over it: this page reads the player, so without both of
 * those every row and every cover in its mosaic redrew on every pause.
 */
const TagRow = memo(function TagRow({
  standing,
  index,
  rowRef,
  onOpen,
  onPlay,
  onHold,
}: {
  standing: TagStanding
  index: number
  rowRef: (tagId: number, node: View | null) => void
  onOpen: (standing: TagStanding) => void
  onPlay: (standing: TagStanding) => void
  onHold: (tag: Tag) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const { tag } = standing
  const songIds = useMemo(() => standing.songs.map(song => song.id), [standing.songs])
  const line = tagLine(standing)
  return (
    <View ref={node => rowRef(tag.id, node)} collapsable={false} style={styles.rowWrap}>
      <Pressable
        onPress={() => onOpen(standing)}
        onLongPress={() => onHold(standing.tag)}
        delayLongPress={HOLD_MS}
        accessibilityRole="link"
        accessibilityLabel={`${tag.name}, ${line}`}
        accessibilityHint="Hold to rename, recolour or delete"
        testID={`tags-row-${index}`}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.colors.surface2 }]}
      >
        <PlaylistCover songIds={songIds} size={COVER} />
        <View style={styles.rowText}>
          <View style={styles.nameRow}>
            <View style={[styles.dot, { backgroundColor: tagColors(tag.hue).dot }]} />
            <Text style={styles.rowName} numberOfLines={1}>
              {tag.name}
            </Text>
          </View>
          <Text style={styles.rowLine} numberOfLines={1}>
            {line}
          </Text>
        </View>
        <IconButton
          label={`Play ${tag.name}`}
          filled
          disabled={songIds.length === 0}
          onPress={() => onPlay(standing)}
          testID={`tags-play-${index}`}
        >
          <Play size={16} tone="textPrimary" />
        </IconButton>
      </Pressable>
    </View>
  )
})

/** The side of a row's cover mosaic. */
const COVER = 52

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { gap: space.lg },
  contentNarrow: { paddingTop: 10, paddingHorizontal: 20 },
  contentWide: { paddingTop: 40, paddingHorizontal: 48, maxWidth: 760, width: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titles: { flex: 1, minWidth: 0, gap: 2 },
  heading: pageTitle(theme.colors),
  sub: { color: theme.colors.textSecondary, fontSize: 13 },
  hint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  newCard: { gap: space.sm, padding: space.md, ...card(theme.colors) },
  newHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: label(theme.colors),
  newRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  newColour: { gap: 6 },
  newHint: { color: theme.colors.textMuted, fontSize: type.small, lineHeight: 16 },
  error: { color: theme.colors.danger, fontSize: type.small },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: HIT_TARGET,
    paddingHorizontal: space.md,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    // A control on a card, one step up from it. The edge is there only to
    // carry the focus ring: at rest it is the fill's own colour, so nothing
    // outlines the field until it has focus.
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    borderRadius: radius.pill,
    _web: { outlineStyle: 'none' },
  },
  untagged: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...card(theme.colors, 16),
  },
  untaggedIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
  },
  untaggedText: { flex: 1, minWidth: 0, gap: 2 },
  untaggedTitle: { color: theme.colors.textPrimary, fontSize: type.row, fontWeight: '600' },
  untaggedSub: { color: theme.colors.textSecondary, fontSize: type.rowSub },
  rows: { gap: 2 },
  rowWrap: { marginHorizontal: -space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 68,
    paddingHorizontal: space.sm,
    borderRadius: 14,
  },
  rowText: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowName: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: 20,
    letterSpacing: -0.2,
  },
  rowLine: {
    color: theme.colors.textSecondary,
    fontSize: type.rowSub,
    fontVariant: ['tabular-nums'],
  },
  footer: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    textAlign: 'center',
    paddingTop: space.lg,
  },
}))
