import { useEffect, useCallback, memo, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Animated,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native'
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
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { tabbing } from '../../shell/FocusStyle'
import { setPaletteOpen } from '../../shell/palette'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import {
  ChevronLeft,
  ChevronRight,
  More,
  Plus,
  Search,
  Sparkle,
  Tag as TagIcon,
  X,
} from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { HueSwatches, autoTagHue } from '../../ui/components/HueSwatches'
import { TagEditor } from '../../ui/components/TagEditor'
import { useFade, usePressScale } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { card, label, pageTitle } from '../../ui/surfaces'
import { tip } from '../../ui/tip'
import { noteTagUsed } from '../library/recentTags.store'
import { artistLink, tagLink } from '../tag/placeLinks'
import {
  existingTag,
  tagLine,
  tagsMostPlayed,
  untaggedCardTitle,
  type TagStanding,
} from '../tag/tag.model'
import { useArtistNudge } from '../tag/useArtistNudge'
import { usePlayAndTag } from '../tag/usePlayAndTag'
import { useSmartSwitches } from '../smart/useSmartSwitches'
import { SuggestTagsSheet } from '../smart/SuggestTagsSheet'
import { SLEEVE_ASPECT, TagSleeve } from './TagSleeve'
import {
  leadSong,
  tagsHeadline,
  tagsLayout,
  waitingArtists,
  type TagEntry,
  type WaitingArtist,
} from './tags.model'

/** Tiles at least this wide on a computer, as many as fit; two across on a phone. */
const TILE_MIN_WIDTH = 220
const PHONE_COLUMNS = 2
const GAP = 16
const ROW_GAP = 24
/** The page's side margins: a phone's, and a computer's. */
const NARROW_GUTTER = 20
const WIDE_GUTTER = 48
/** How many artists the untagged card names on a computer; a phone names two. */
const WAITING_SHOWN = 3
const NOTHING_WAITING = { artists: [], rest: 0 } as const

type EditTag = (tag: Tag) => void
type HoldRef = (tagId: number, node: View | null) => void

/**
 * All tags (docs/ui-mock `P07`; Xiao's picks of 2026-10-02): every tag as a
 * place to go, most played first, laid out as records rather than as the
 * square covers Playlists uses (A3).
 *
 * A tile opens the tag's page. With a pointer, the tag's record slides out
 * and Play waits on its label, and a ⋯ and right-click open the tag's editor
 * (G, H); on a phone a tap opens and holding edits, as before. A tag every one
 * of whose songs another tag carries is drawn inside that tag (E), and tags
 * with a song or two wait at the end (L), so the page opens on the ones in
 * use. Picking tags to combine is not here: a tag's page has Add for that.
 *
 * At the top, only while some songs have no tag, a card that says who they
 * are by and tags them one at a time while they play (K2).
 */
export function TagsScreen(): ReactNode {
  const { wide, width, finePointer } = useLayout()
  const router = useRouter()
  const player = usePlayer()
  const { data: library } = useLibrary()
  const playAndTag = usePlayAndTag()
  const [adding, setAdding] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const switches = useSmartSwitches()
  const [gridWidth, setGridWidth] = useState(0)
  /*
   * The tile handlers are made once and take the tag they act on. As arrows in
   * the grid below they were new on every render, so every tile — and the
   * cover in each — redrew whenever the screen did, which on this page is
   * every play, pause and skip (`usePlayer` above).
   */
  const latest = useRef({ player, router })
  useEffect(() => {
    latest.current = { player, router }
  })
  const holdRowRef = useCallback<HoldRef>((tagId, node) => {
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
    latest.current.player.playFrom(ids, 0, {
      source: { kind: 'tag', tagId: standing.tag.id, name: standing.tag.name },
    })
  }, [])
  const openArtist = useCallback((name: string) => {
    latest.current.router.navigate(artistLink(name))
  }, [])
  const [editing, setEditing] = useState<Tag | null>(null)
  // The editor is anchored to the tile that asked for it. One anchor for the
  // page, pointed at that tile as it opens, so the page keeps a single editor.
  const editorAnchor = useRef<View | null>(null)
  const rowRefs = useRef(new Map<number, View>())

  const tags = useMemo<readonly Tag[]>(() => library?.tags ?? [], [library?.tags])
  const standings = useMemo(
    () => (library ? tagsMostPlayed(library.tags, library.songs) : []),
    [library],
  )
  const layout = useMemo(() => tagsLayout(standings), [standings])
  // Each tag keeps its place in the most-played order as its index, wherever
  // it is drawn, so the first tile is always the most played.
  const order = useMemo(
    () => new Map(standings.map((standing, index) => [standing.tag.id, index])),
    [standings],
  )
  const waiting = useMemo(
    () => (library ? waitingArtists(library.songs, WAITING_SHOWN) : NOTHING_WAITING),
    [library],
  )

  const measured = wide ? gridWidth : width - NARROW_GUTTER * 2
  const columns = wide
    ? Math.max(PHONE_COLUMNS, Math.floor((measured + GAP) / (TILE_MIN_WIDTH + GAP)))
    : PHONE_COLUMNS
  const tileWidth = measured > 0 ? Math.floor((measured - GAP * (columns - 1)) / columns) : 0

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
  // Stable, because a tile is memoised and this is the prop every one of them holds.
  const edit = useCallback<EditTag>(tag => {
    editorAnchor.current = rowRefs.current.get(tag.id) ?? null
    setEditing(tag)
  }, [])

  const grid = (entries: readonly TagEntry[]): ReactNode => (
    <View style={styles.grid}>
      {entries.map(entry => (
        <Entry
          key={entry.standing.tag.id}
          entry={entry}
          order={order}
          width={tileWidth}
          finePointer={finePointer}
          rowRef={holdRowRef}
          onOpen={openTag}
          onPlay={playTag}
          onEdit={edit}
        />
      ))}
    </View>
  )

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
              // its editor opens, on its tile.
              edit(tag)
            }}
            onClose={() => setAdding(false)}
          />
        ) : null}

        {playAndTag.count > 0 ? (
          <UntaggedCard
            count={playAndTag.count}
            artists={waiting.artists}
            rest={waiting.rest}
            wide={wide}
            onStart={playAndTag.start}
            onSuggest={switches.tags ? () => setSuggesting(true) : undefined}
            onArtist={openArtist}
          />
        ) : null}
        <SuggestTagsSheet open={suggesting} onClose={() => setSuggesting(false)} />

        {!library ? (
          <Text style={styles.hint}>Tags load with your library.</Text>
        ) : standings.length === 0 ? (
          <Text style={styles.hint}>
            No tags yet. Tags are how this library is browsed — make one with the +, or put one on a
            song from its ⋯ while it plays.
          </Text>
        ) : (
          <View
            style={styles.runs}
            onLayout={(event: LayoutChangeEvent) => setGridWidth(event.nativeEvent.layout.width)}
          >
            {tileWidth > 0 ? (
              <>
                {grid(layout.main)}
                {layout.justStarted.length > 0 ? (
                  <>
                    {layout.main.length > 0 ? (
                      <Text style={styles.runLabel}>
                        Just started <Text style={styles.runLabelSub}>a song or two so far</Text>
                      </Text>
                    ) : null}
                    {grid(layout.justStarted)}
                  </>
                ) : null}
              </>
            ) : null}
            {/* A pointer has the ⋯ and right-click; a finger has only the hold, so it is told. */}
            {finePointer ? null : (
              <Text style={styles.footer}>Hold a tag to rename, recolour or delete it.</Text>
            )}
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

/**
 * "111 songs have no tag yet", and who they are by (K2): the artists with the
 * most of them, newest cover first. On a computer each name opens that
 * artist's page, where Select all and Tag do a batch at once, and the button
 * tags them one at a time while they play. On a phone the whole card is that
 * button, with two names to say what is waiting.
 *
 * Suggest tags (A7, docs/features/ai.md) sits beside it: the same songs, a tag
 * proposed for each, taken a tag at a time.
 */
function UntaggedCard({
  count,
  artists,
  rest,
  wide,
  onStart,
  onSuggest,
  onArtist,
}: {
  count: number
  artists: readonly WaitingArtist[]
  rest: number
  wide: boolean
  onStart: () => void
  /** Absent while Suggest tags is turned off in Settings › Smart features. */
  onSuggest?: () => void
  onArtist: (name: string) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const press = usePressScale(0.98)
  const art = useArt(COVER_STACK)
  const named = wide ? artists : artists.slice(0, 2)
  const more = wide ? rest : count - named.reduce((sum, artist) => sum + artist.count, 0)
  const title = untaggedCardTitle(count)

  const covers =
    artists.length > 0 ? (
      <View style={styles.stack}>
        {artists.map((artist, index) => (
          <View key={artist.name} style={[styles.stackCover, index > 0 && styles.stackOverlap]}>
            <Cover
              uri={art(artist.song)}
              title={artist.song.album || artist.song.title}
              size={COVER_STACK}
              radius={9}
            />
          </View>
        ))}
      </View>
    ) : (
      <View style={styles.untaggedIcon}>
        <TagIcon size={17} tone="textPrimary" />
      </View>
    )

  const who =
    named.length === 0 ? (
      'Tag them one at a time, while they play'
    ) : (
      <>
        {named.map((artist, index) => (
          <Text key={artist.name}>
            {index > 0 ? ' · ' : ''}
            {artist.count.toLocaleString()} by{' '}
            {wide ? (
              <Text
                style={styles.artistLink}
                onPress={() => onArtist(artist.name)}
                accessibilityRole="link"
                {...tip(`Open ${artist.name}`)}
              >
                {artist.name}
              </Text>
            ) : (
              artist.name
            )}
          </Text>
        ))}
        {more > 0 ? (wide ? ` · and ${more.toLocaleString()} more` : ' · and others') : ''}
      </>
    )

  if (wide) {
    return (
      <View style={styles.untagged} testID="tags-untagged">
        {covers}
        <View style={styles.untaggedText}>
          <Text style={styles.untaggedTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.untaggedSub} numberOfLines={1}>
            {who}
          </Text>
        </View>
        {onSuggest ? (
          <Button
            label="Suggest tags"
            icon={<Sparkle size={15} />}
            onPress={onSuggest}
            testID="tags-untagged-suggest"
          />
        ) : null}
        <Button
          label="Tag while they play"
          icon={<TagIcon size={15} color={theme.colors.textPrimary} />}
          onPress={onStart}
          testID="tags-untagged-start"
        />
      </View>
    )
  }
  return (
    <Animated.View style={press.style}>
      <Pressable
        {...press.handlers}
        onPress={onStart}
        accessibilityRole="button"
        accessibilityLabel={`${title}. Tag them one at a time, while they play`}
        testID="tags-untagged"
        style={styles.untagged}
      >
        {covers}
        <View style={styles.untaggedText}>
          <Text style={styles.untaggedTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.untaggedSub} numberOfLines={1}>
            {who}
          </Text>
        </View>
        <ChevronRight size={16} tone="textMuted" />
      </Pressable>
      {onSuggest ? (
        <View style={styles.untaggedSuggest}>
          <Button
            label="Suggest tags"
            icon={<Sparkle size={15} />}
            variant="text"
            onPress={onSuggest}
            testID="tags-untagged-suggest"
          />
        </View>
      ) : null}
    </Animated.View>
  )
}

/** One tag in the grid: its tile, and, when it holds other tags, the panel listing them beside it. */
function Entry({
  entry,
  order,
  width,
  finePointer,
  rowRef,
  onOpen,
  onPlay,
  onEdit,
}: {
  entry: TagEntry
  order: ReadonlyMap<number, number>
  width: number
  finePointer: boolean
  rowRef: HoldRef
  onOpen: (standing: TagStanding) => void
  onPlay: (standing: TagStanding) => void
  onEdit: EditTag
}): ReactNode {
  const { standing, inside } = entry
  const tile = (
    <TagTile
      standing={standing}
      index={order.get(standing.tag.id) ?? 0}
      width={width}
      finePointer={finePointer}
      rowRef={rowRef}
      onOpen={onOpen}
      onPlay={onPlay}
      onEdit={onEdit}
    />
  )
  if (inside.length === 0) return tile
  return (
    <View style={styles.holder}>
      {tile}
      <InsidePanel
        holder={standing}
        inside={inside}
        order={order}
        width={width}
        rowRef={rowRef}
        onOpen={onOpen}
        onEdit={onEdit}
      />
    </View>
  )
}

/**
 * One tag's tile: its record (`TagSleeve`), then its name and size. Memoised,
 * and handed handlers that take the tag they act on rather than closing over
 * it: this page reads the player, so without both every tile and every cover
 * redrew on every pause.
 */
const TagTile = memo(function TagTile({
  standing,
  index,
  width,
  finePointer,
  rowRef,
  onOpen,
  onPlay,
  onEdit,
}: {
  standing: TagStanding
  /** Its place in the most-played order. */
  index: number
  width: number
  finePointer: boolean
  rowRef: HoldRef
  onOpen: (standing: TagStanding) => void
  onPlay: (standing: TagStanding) => void
  onEdit: EditTag
}): ReactNode {
  const { tag } = standing
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const lead = useMemo(() => leadSong(standing.songs), [standing.songs])
  const out = finePointer && (hovered || focused)
  const controls = useFade(out, MOVE_MS.hoverIn, MOVE_MS.hoverOut)
  const controlsStyle = useMemo(() => ({ opacity: controls }), [controls])
  const line = tagLine(standing)
  const height = Math.round(width / SLEEVE_ASPECT)
  const web = {
    onContextMenu: (event: { preventDefault: () => void }) => {
      event.preventDefault()
      onEdit(tag)
    },
  }
  return (
    <View
      ref={node => rowRef(tag.id, node)}
      collapsable={false}
      style={{ width }}
      onPointerEnter={finePointer ? () => setHovered(true) : undefined}
      onPointerLeave={finePointer ? () => setHovered(false) : undefined}
    >
      <Pressable
        onPress={() => onOpen(standing)}
        onLongPress={() => onEdit(tag)}
        // The app's one hold, as a song row's is (`HoldToReorder`): a page
        // where holding takes half again as long as it does on the next page
        // is two gestures wearing one name.
        delayLongPress={MOVE_MS.hold}
        onFocus={() => setFocused(tabbing())}
        onBlur={() => setFocused(false)}
        accessibilityRole="link"
        accessibilityLabel={`${tag.name}, ${line}`}
        accessibilityHint={
          finePointer
            ? 'Right-click to rename, recolour or delete'
            : 'Hold to rename, recolour or delete'
        }
        testID={`tags-row-${index}`}
        style={({ pressed }) => pressed && styles.pressed}
        {...web}
      >
        <TagSleeve song={lead} hue={tag.hue} name={tag.name} width={width} out={out} />
        <View style={styles.nameRow}>
          <View style={[styles.dot, { backgroundColor: tagColors(tag.hue).dot }]} />
          <Text style={styles.tileName} numberOfLines={1}>
            {tag.name}
          </Text>
        </View>
        <Text style={styles.tileSub} numberOfLines={1}>
          {line}
        </Text>
      </Pressable>

      {finePointer ? (
        <>
          {/* The record itself is Play: what is out of the sleeve, right of it. */}
          <Pressable
            onPress={() => onPlay(standing)}
            onFocus={() => setFocused(tabbing())}
            onBlur={() => setFocused(false)}
            disabled={standing.songs.length === 0}
            accessibilityRole="button"
            accessibilityLabel={`Play ${tag.name}`}
            {...tip('Play')}
            testID={`tags-play-${index}`}
            style={[styles.playZone, { left: height, width: width - height, height }]}
          />
          <Animated.View
            style={[styles.more, controlsStyle]}
            pointerEvents={out ? 'box-none' : 'none'}
          >
            <Pressable
              onPress={() => onEdit(tag)}
              onFocus={() => setFocused(tabbing())}
              onBlur={() => setFocused(false)}
              accessibilityRole="button"
              accessibilityLabel={`Rename, recolour or delete ${tag.name}`}
              {...tip('Edit tag')}
              testID={`tags-more-${index}`}
              hitSlop={6}
              style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
            >
              <More size={16} tone="textPrimary" />
            </Pressable>
          </Animated.View>
        </>
      ) : null}
    </View>
  )
})

/**
 * What a holder holds (E), beside its tile and as tall as its record: each
 * inside tag as a row that opens it, holds or right-clicks to edit it, and
 * scrolls when there are more than fit. Under it, the one line that says why
 * they are here.
 */
function InsidePanel({
  holder,
  inside,
  order,
  width,
  rowRef,
  onOpen,
  onEdit,
}: {
  holder: TagStanding
  inside: readonly TagStanding[]
  order: ReadonlyMap<number, number>
  width: number
  rowRef: HoldRef
  onOpen: (standing: TagStanding) => void
  onEdit: EditTag
}): ReactNode {
  const height = Math.round(width / SLEEVE_ASPECT)
  const compact = width < COMPACT_PANEL
  const art = useArt(INSIDE_COVER)
  return (
    <View style={{ width }}>
      <View style={[styles.inside, compact && styles.insideCompact, { height }]}>
        {compact ? null : <Text style={styles.insideLabel}>Inside it</Text>}
        <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {inside.map(standing => {
            const { tag } = standing
            const lead = leadSong(standing.songs)
            const index = order.get(tag.id) ?? 0
            return (
              <View key={tag.id} ref={node => rowRef(tag.id, node)} collapsable={false}>
                <Pressable
                  onPress={() => onOpen(standing)}
                  onLongPress={() => onEdit(tag)}
                  delayLongPress={MOVE_MS.hold}
                  accessibilityRole="link"
                  accessibilityLabel={`${tag.name}, ${tagLine(standing)}`}
                  testID={`tags-row-${index}`}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    styles.insideRow,
                    compact && styles.insideRowCompact,
                    (pressed || hovered) && styles.insideRowOn,
                  ]}
                  {...{
                    onContextMenu: (event: { preventDefault: () => void }) => {
                      event.preventDefault()
                      onEdit(tag)
                    },
                  }}
                >
                  <Cover
                    uri={lead ? art(lead) : null}
                    title={lead ? lead.album || lead.title : tag.name}
                    size={compact ? 20 : INSIDE_COVER}
                    radius={compact ? 5 : 7}
                  />
                  <View style={[styles.dot, { backgroundColor: tagColors(tag.hue).dot }]} />
                  <Text
                    style={[styles.insideName, compact && styles.insideNameCompact]}
                    numberOfLines={1}
                  >
                    {tag.name}
                  </Text>
                  <Text style={[styles.insideCount, compact && styles.insideCountCompact]}>
                    {standing.songs.length.toLocaleString()}
                  </Text>
                </Pressable>
              </View>
            )
          })}
        </ScrollView>
      </View>
      <Text style={styles.insideNote} numberOfLines={2}>
        Every song in these is also in {holder.tag.name}.
      </Text>
    </View>
  )
}

/** The side of each cover in the untagged card's stack. */
const COVER_STACK = 40
/** The side of an inside tag's cover in a holder's panel. */
const INSIDE_COVER = 30
/** A holder's panel narrower than this (a phone's) drops its label and tightens its rows. */
const COMPACT_PANEL = 200

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { gap: space.lg },
  contentNarrow: { paddingTop: 10, paddingHorizontal: NARROW_GUTTER },
  contentWide: { paddingTop: 40, paddingHorizontal: WIDE_GUTTER, width: '100%' },
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
  stack: { flexDirection: 'row' },
  // A ring of the card's own colour, so each cover sits on top of the one before.
  stackCover: { borderRadius: 11, borderWidth: 2, borderColor: theme.colors.surface1 },
  stackOverlap: { marginLeft: -16 },
  untaggedText: { flex: 1, minWidth: 0, gap: 2 },
  untaggedSuggest: { flexDirection: 'row', justifyContent: 'flex-end' },
  untaggedTitle: { color: theme.colors.textPrimary, fontSize: type.row, fontWeight: '600' },
  untaggedSub: { color: theme.colors.textSecondary, fontSize: type.rowSub },
  artistLink: {
    color: theme.colors.textPrimary,
    fontWeight: '500',
    textDecorationLine: 'underline',
    textDecorationColor: theme.colors.borderStrong,
  },
  runs: { gap: ROW_GAP },
  runLabel: { ...label(theme.colors), marginBottom: -space.sm },
  runLabelSub: { fontSize: type.small, fontWeight: '400', letterSpacing: 0, textTransform: 'none' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: GAP, rowGap: ROW_GAP },
  holder: { flexDirection: 'row', gap: GAP },
  pressed: { opacity: 0.75 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tileName: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  tileSub: {
    marginTop: 3,
    color: theme.colors.textMuted,
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
  },
  playZone: { position: 'absolute', top: 0, borderRadius: radius.pill },
  more: { position: 'absolute', top: 8, right: 8 },
  moreButton: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.glass,
  },
  inside: {
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface1,
    padding: 12,
    gap: 4,
  },
  insideCompact: { padding: 6, gap: 0, justifyContent: 'center' },
  insideLabel: { ...label(theme.colors), paddingHorizontal: 4, paddingBottom: 2 },
  insideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 10,
  },
  insideRowCompact: { gap: 7, paddingVertical: 2 },
  insideRowOn: { backgroundColor: theme.colors.surface2 },
  insideName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  insideNameCompact: { fontSize: 12.5 },
  insideCount: { color: theme.colors.textMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  insideCountCompact: { fontSize: 11 },
  insideNote: { marginTop: 11, color: theme.colors.textMuted, fontSize: 12.5, lineHeight: 17 },
  footer: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    textAlign: 'center',
    paddingTop: space.sm,
  },
}))
