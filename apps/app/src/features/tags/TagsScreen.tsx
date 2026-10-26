import { useEffect, useCallback, memo, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import type { Tag } from '@selfmp3/shared'
import { hitSlopFor, radius, space, type, useLibrary, iconSize } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useOpenSearch } from '../../shell/palette'
import { useEscape } from '../../shell/useEscape'
import { useLayoutFlags } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { EmptyState } from '../../ui/components/EmptyState'
import { Bone, Skeleton } from '../../ui/components/Skeleton'
import { IconButton } from '../../ui/components/IconButton'
import {
  ChevronRight,
  More,
  Plus,
  Search,
  Sparkle,
  Tag as TagIcon,
  X,
} from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { HueSwatches } from '../../ui/components/HueSwatches'
import { Guide } from '../guide/Guide'
import { useGuide } from '../guide/useGuide'
import { TagEditor } from '../../ui/components/TagEditor'
import { Press } from '../../ui/components/Press'
import { MOVE_MS } from '../../ui/motion.model'
import { rightClick } from '../../ui/rightClick'
import { GridTile, TileGrid, useTileGrid, type TileFocus } from '../../ui/components/TileGrid'
import { card, label, pageFrame, rowTitle, hint, textColumn } from '../../ui/surfaces'
import { tip } from '../../ui/tip'
import { noteTagUsed } from '../library/recentTags.store'
import { Menu } from '../../ui/components/MoreMenu'
import { useOpenTag } from '../tag/useOpenTag'
import { tagLine, tagsMostPlayed, untaggedCardTitle, type TagStanding } from '../tag/tag.model'
import { usePlayAndTag } from '../tag/usePlayAndTag'
import { useSmartOn } from '../smart/useSmartOn'
import { SuggestTagsSheet } from '../smart/SuggestTagsSheet'
import { SLEEVE_ASPECT, TagSleeve } from './TagSleeve'
import {
  leadSong,
  tagsHeadline,
  tagsLayout,
  UNTAGGED_HINT,
  waitingArtists,
  waitingLine,
  type TagEntry,
  type WaitingArtist,
} from './tags.model'
import { PageHeader } from '../../ui/components/PageHeader'
import { StatusLine } from '../../ui/components/StatusLine'
import { TagNameField, useNewTagForm } from './useNewTagForm'
import { ScrollView } from '../../ui/components/Scroll'
import { useDrawnAhead } from '../../ui/useDrawnAhead'
import { TagDot } from '../../ui/components/TagDot'

/** Tiles at least this wide on a computer, as many as fit; two across on a phone. */
const TILE_MIN_WIDTH = 220
const GAP = 16
const ROW_GAP = 24
/** How many artists' covers the untagged card stands up. */
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
 * (G, H); on a phone a tap opens and holding edits. A tag every one
 * of whose songs another tag carries hangs off that tag's tile as a chip
 * (AG1), and tags
 * with a song or two wait at the end (L), so the page opens on the ones in
 * use. Picking tags to combine is not here: a tag's page has Add for that.
 *
 * At the top, only while some songs have no tag, a card that says who they
 * are by and tags them one at a time while they play (K2).
 */
export function TagsScreen(): ReactNode {
  const { wide, finePointer } = useLayoutFlags()
  const router = useRouter()
  const player = usePlayerCommands()
  const { data: library } = useLibrary()
  const playAndTag = usePlayAndTag()
  const [adding, setAdding] = useState(false)
  // The form put away from inside it — Escape, its × — gives focus back to the
  // + that opened it: the form went with the focus in it, and left it on the page.
  const newButton = useRef<View>(null)
  const focusBack = useRef(false)
  const closeNew = useCallback(() => {
    focusBack.current = true
    setAdding(false)
  }, [])
  useEffect(() => {
    if (adding || !focusBack.current) return
    focusBack.current = false
    newButton.current?.focus()
  }, [adding])
  const [suggesting, setSuggesting] = useState(false)
  const smartOn = useSmartOn()
  const { columns, tileWidth } = useTileGrid({ minTile: TILE_MIN_WIDTH, gap: GAP })
  /*
   * The tile handlers are made once and take the tag they act on, so a render
   * of the screen redraws no tile and no cover in one.
   */
  const open = useOpenTag()
  const latest = useRef({ player, router, open })
  useEffect(() => {
    latest.current = { player, router, open }
  })
  const rowRefs = useRef(new Map<number, View>())
  const holdRowRef = useCallback<HoldRef>((tagId, node) => {
    if (node) rowRefs.current.set(tagId, node)
    else rowRefs.current.delete(tagId)
  }, [])
  const openTag = useCallback((standing: TagStanding) => latest.current.open(standing.tag), [])
  const playTag = useCallback((standing: TagStanding) => {
    const ids = standing.songs.map(song => song.id)
    if (ids.length === 0) return
    noteTagUsed(standing.tag.id)
    latest.current.player.playFrom(ids, 0, {
      source: { kind: 'tag', tagId: standing.tag.id, name: standing.tag.name },
      whole: true,
    })
  }, [])
  const [editing, setEditing] = useState<Tag | null>(null)
  // The editor is anchored to the tile that asked for it. One anchor for the
  // page, pointed at that tile as it opens, so the page keeps a single editor.
  const editorAnchor = useRef<View | null>(null)

  const tags = useMemo<readonly Tag[]>(() => library?.tags ?? [], [library?.tags])
  const standings = useMemo(
    () => (library ? tagsMostPlayed(library.tags, library.songs) : []),
    [library],
  )
  const laidOut = useMemo(() => tagsLayout(standings), [standings])
  // A screenful or two of tiles, and more as the scroll nears the end.
  const { drawn, ...ahead } = useDrawnAhead(
    laidOut.main.length + laidOut.justStarted.length + laidOut.empty.length,
  )
  const layout = useMemo(() => {
    const main = laidOut.main.slice(0, drawn)
    const justStarted = laidOut.justStarted.slice(0, drawn - main.length)
    const empty = laidOut.empty.slice(0, drawn - main.length - justStarted.length)
    return { main, justStarted, empty }
  }, [laidOut, drawn])
  /*
   * A pointer has the ⋯ and right-click; a finger has only the hold, which
   * nothing on a tile says, so it is shown once on the first tile.
   */
  const firstTagId = (layout.main[0] ?? layout.justStarted[0] ?? layout.empty[0])?.standing.tag.id
  // Not while the editor a hold opens is up: the guide came over it, and the
  // finger letting go of the hold closed the guide unread.
  const [lightTile, holdGuide] = useGuide(
    'tag-hold',
    !finePointer && firstTagId !== undefined && editing === null,
  )
  useEffect(() => {
    lightTile(firstTagId === undefined ? null : (rowRefs.current.get(firstTagId) ?? null))
  })
  // Each tag keeps its place in the most-played order as its index, wherever
  // it is drawn, so the first tile is always the most played.
  const order = useMemo(
    () => new Map(standings.map((standing, index) => [standing.tag.id, index])),
    [standings],
  )
  const waiting = useMemo(
    () => (library ? waitingArtists(library.songs, WAITING_SHOWN, library) : NOTHING_WAITING),
    [library],
  )

  // The one Search, on its Tags scope: the page on a phone, the palette over
  // this page on a computer (docs/ui-mock `P18`, `C05`).
  const openSearch = useOpenSearch()
  // Stable, because a tile is memoised and this is the prop every one of them holds.
  const edit = useCallback<EditTag>(tag => {
    editorAnchor.current = rowRefs.current.get(tag.id) ?? null
    setEditing(tag)
  }, [])

  const grid = (entries: readonly TagEntry[]): ReactNode => (
    <TileGrid
      items={entries}
      columns={columns}
      gap={GAP}
      rowGap={ROW_GAP}
      keyOf={entry => entry.standing.tag.id}
      renderItem={entry => (
        <Entry
          entry={entry}
          order={order}
          width={tileWidth}
          finePointer={finePointer}
          rowRef={holdRowRef}
          onOpen={openTag}
          onPlay={playTag}
          onEdit={edit}
        />
      )}
    />
  )

  const actions = (
    <>
      <IconButton
        ref={newButton}
        label="New tag"
        filled
        active={adding}
        onPress={() => setAdding(open => !open)}
        testID="tags-new"
      >
        <Plus tone="textPrimary" />
      </IconButton>
      <IconButton label="Search tags" filled onPress={openSearch} testID="tags-search">
        <Search tone="textPrimary" />
      </IconButton>
    </>
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']} testID="tags-screen">
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        {...ahead}
      >
        <PageHeader
          title="Tags"
          // With no tags the empty state below says so; the head says it once (Z1).
          subtitle={library && tags.length > 0 ? tagsHeadline(tags.length) : undefined}
          back={{ to: '/', testID: 'tags-back' }}
          actions={actions}
        />

        {adding ? (
          <NewTag
            tags={tags}
            onExisting={tag => {
              // Choosing the tag that exists beats silently making a twin of it:
              // its editor opens, on its tile.
              edit(tag)
            }}
            onClose={closeNew}
          />
        ) : null}

        {playAndTag.count > 0 ? (
          <UntaggedCard
            count={playAndTag.count}
            artists={waiting.artists}
            wide={wide}
            onStart={playAndTag.start}
            onSuggest={smartOn ? () => setSuggesting(true) : undefined}
          />
        ) : null}
        <SuggestTagsSheet open={suggesting} onClose={() => setSuggesting(false)} />

        {!library ? (
          <TilesWaiting columns={columns} width={tileWidth} />
        ) : standings.length === 0 ? (
          // The form above is already the way out while it is open.
          adding ? null : (
            <EmptyState
              testID="tags-empty"
              icon={<TagIcon size={30} tone="textMuted" />}
              title="No tags yet"
              line="Your own words for songs: night, gym, from 2014."
            >
              <Button
                label="New tag"
                icon={<Plus tone="textPrimary" />}
                onPress={() => setAdding(true)}
                testID="tags-empty-new"
              />
            </EmptyState>
          )
        ) : (
          <View style={styles.runs}>
            {tileWidth > 0 ? (
              <>
                {grid(layout.main)}
                {layout.justStarted.length > 0 ? (
                  <>
                    {layout.main.length > 0 ? (
                      <Text style={styles.runLabel}>
                        Just started{' '}
                        <Text style={styles.runLabelSub}>two songs or fewer so far</Text>
                      </Text>
                    ) : null}
                    {grid(layout.justStarted)}
                  </>
                ) : null}
                {layout.empty.length > 0 ? (
                  <>
                    {layout.main.length + layout.justStarted.length > 0 ? (
                      <Text style={styles.runLabel}>Nothing in them yet</Text>
                    ) : null}
                    {grid(layout.empty)}
                  </>
                ) : null}
              </>
            ) : null}
          </View>
        )}
        <ChromeSpacer />
      </ScrollView>

      <TagEditor tag={editing} anchorRef={editorAnchor} onClose={() => setEditing(null)} />
      <Guide
        guide={holdGuide}
        at={{ x: 0.5, y: 0.45 }}
        radius={16}
        steps={[{ gesture: 'hold', text: 'Hold a tag to rename, recolour or delete it' }]}
      />
    </SafeAreaView>
  )
}

/** A row of records' shapes, each with its name under it, while the library is on its way (AA1). */
function TilesWaiting({ columns, width }: { columns: number; width: number }): ReactNode {
  const cells = useMemo(() => Array.from({ length: columns }, (_, index) => index), [columns])
  if (width === 0) return null
  return (
    <Skeleton label="Loading tags" testID="tags-loading">
      <TileGrid
        items={cells}
        columns={columns}
        gap={GAP}
        keyOf={cell => cell}
        renderItem={() => (
          <View style={styles.tileWaiting}>
            <Bone height={Math.round(width / SLEEVE_ASPECT)} radius={radius.cover} />
            <Bone width="50%" height={14} radius={radius.pill} />
            <Bone width="30%" height={10} radius={radius.pill} />
          </View>
        )}
      />
    </Skeleton>
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
  // The field stays open and empty once a tag is made: tags arrive in
  // handfuls, and a second one should not cost another trip to the +.
  const form = useNewTagForm({ tags, onExisting })
  // Escape puts the card away, as its × does, from the field as well.
  useEscape(true, onClose)

  return (
    <View style={styles.newCard} testID="tags-new-form">
      <View style={styles.newHeadRow}>
        <Text style={styles.fieldLabel}>New tag</Text>
        <Press
          feedback="dim"
          onPress={onClose}
          hitSlop={hitSlopFor(14)}
          accessibilityRole="button"
          accessibilityLabel="Close new tag"
        >
          <X size={iconSize.field} color={theme.colors.textMuted} />
        </Press>
      </View>
      <TagNameField
        form={form}
        placeholder="chill, 中文, gym…"
        autoFocus
        onEscape={onClose}
        testID="tags-new-name"
        action={
          <Button
            label="Create"
            variant="primary"
            disabled={!form.ready}
            busy={form.busy}
            onPress={form.submit}
            testID="tags-create"
          />
        }
      />
      <View style={styles.newColour}>
        <Text style={styles.fieldLabel}>Colour</Text>
        <HueSwatches value={form.hue} first={form.autoHue} onChange={form.setHue} />
      </View>
      {form.failure ? (
        <StatusLine>{form.failure}</StatusLine>
      ) : (
        <Text style={styles.newHint}>A word or two.</Text>
      )}
      {form.nudge}
    </View>
  )
}

/**
 * "62 songs without a tag", and in a word who they are by ("Mostly
 * Yorushika"), over the newest of their covers; and one "Tag them", which
 * offers the two ways to: Suggest tags (A7, docs/features/ai.md), the same
 * songs with a tag proposed for each, and Tag while they play, one at a time
 * (I1, 2026-10-25). On a phone the whole card is that button.
 */
function UntaggedCard({
  count,
  artists,
  wide,
  onStart,
  onSuggest,
}: {
  count: number
  artists: readonly WaitingArtist[]
  wide: boolean
  onStart: () => void
  /** Absent while Suggest tags is turned off in Settings › Smart features. */
  onSuggest?: () => void
}): ReactNode {
  const art = useArt(COVER_STACK)
  const title = untaggedCardTitle(count)
  const line = waitingLine(artists, count)
  const anchor = useRef<View>(null)
  const [choosing, setChoosing] = useState(false)
  // With Suggest tags off there is one way left, and the button takes it.
  const tag = (): void => (onSuggest ? setChoosing(true) : onStart())

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
        <TagIcon size={iconSize.medium} tone="textPrimary" />
      </View>
    )
  const words = (
    <View style={styles.untaggedText}>
      <Text style={styles.untaggedTitle} numberOfLines={1}>
        {title}
      </Text>
      {line ? (
        <Text style={styles.untaggedSub} numberOfLines={1}>
          {line}
        </Text>
      ) : null}
    </View>
  )
  const menu = (
    <Menu
      open={choosing}
      onClose={() => setChoosing(false)}
      anchorRef={anchor}
      title={title}
      testID="tags-untagged-menu"
      items={[
        ...(onSuggest
          ? [
              {
                key: 'suggest',
                label: 'Suggest tags',
                icon: <Sparkle />,
                onPress: onSuggest,
                testID: 'tags-untagged-suggest',
              },
            ]
          : []),
        {
          key: 'play',
          label: 'Tag while they play',
          icon: <TagIcon tone="textSecondary" />,
          onPress: onStart,
          testID: 'tags-untagged-start',
        },
      ]}
    />
  )

  if (wide) {
    return (
      <View style={styles.untagged} testID="tags-untagged">
        {covers}
        {words}
        <View ref={anchor} collapsable={false}>
          <Button
            label="Tag them"
            icon={<Sparkle />}
            onPress={tag}
            active={choosing}
            testID="tags-untagged-tag"
          />
        </View>
        {menu}
      </View>
    )
  }
  return (
    <View ref={anchor} collapsable={false}>
      <Press
        depth="row"
        onPress={tag}
        accessibilityRole="button"
        accessibilityLabel={line ? `${title}. ${line}` : title}
        accessibilityHint={UNTAGGED_HINT}
        testID="tags-untagged"
        style={styles.untagged}
      >
        {covers}
        {words}
        <ChevronRight size={iconSize.item} tone="textMuted" />
      </Press>
      {menu}
    </View>
  )
}

/** One tag in the grid: its tile, and, when it holds other tags, a chip for each under it. */
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
    // The tile's width, so a long name's chip is cut at the tile's edge.
    <View style={{ width }}>
      {tile}
      <InsideChips inside={inside} order={order} rowRef={rowRef} onOpen={onOpen} onEdit={onEdit} />
    </View>
  )
}

/**
 * One tag's tile: its record (`TagSleeve`), then its name and size. Memoised,
 * and handed handlers that take the tag they act on rather than closing over
 * it, so a render of the page redraws no tile and no cover.
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
  const lead = useMemo(() => leadSong(standing.songs), [standing.songs])
  const line = tagLine(standing)
  const height = Math.round(width / SLEEVE_ASPECT)
  return (
    <GridTile
      tileRef={node => rowRef(tag.id, node)}
      cover={out => <TagSleeve song={lead} hue={tag.hue} name={tag.name} width={width} out={out} />}
      look="display"
      titleLead={<TagDot hue={tag.hue} />}
      title={tag.name}
      sub={line}
      onPress={() => onOpen(standing)}
      onMenu={() => onEdit(tag)}
      role="link"
      label={`${tag.name}, ${line}`}
      hint={
        finePointer
          ? 'Right-click to rename, recolour or delete'
          : 'Hold to rename, recolour or delete'
      }
      testID={`tags-row-${index}`}
      overlay={(focus: TileFocus) => (
        <>
          {/* The record itself is Play: what is out of the sleeve, right of it.
            Laid over the record and drawing nothing itself, so no sink. */}
          <Press
            feedback="dim"
            onPress={() => onPlay(standing)}
            {...focus}
            disabled={standing.songs.length === 0}
            accessibilityRole="button"
            accessibilityLabel={`Play ${tag.name}`}
            {...tip('Play')}
            testID={`tags-play-${index}`}
            style={[styles.playZone, { left: height, width: width - height, height }]}
          />
          <View style={styles.more}>
            <Press
              onPress={() => onEdit(tag)}
              {...focus}
              accessibilityRole="button"
              accessibilityLabel={`Rename, recolour or delete ${tag.name}`}
              {...tip('Edit tag')}
              testID={`tags-more-${index}`}
              hitSlop={hitSlopFor(MORE_BUTTON)}
              style={styles.moreButton}
            >
              <More size={iconSize.item} tone="textPrimary" />
            </Press>
          </View>
        </>
      )}
    />
  )
})

/**
 * What a holder holds (AG1): each tag whose songs are all in this one, as a
 * small chip under the holder's tile — "Inside: ● late night drives… 3" — so
 * it reads as part of the tag it is in rather than as a tag beside it. A chip
 * opens its tag, and holding it or a right-click edits it, as a tile does.
 */
function InsideChips({
  inside,
  order,
  rowRef,
  onOpen,
  onEdit,
}: {
  inside: readonly TagStanding[]
  order: ReadonlyMap<number, number>
  rowRef: HoldRef
  onOpen: (standing: TagStanding) => void
  onEdit: EditTag
}): ReactNode {
  return (
    <View style={styles.insideChips}>
      {inside.map((standing, at) => {
        const { tag } = standing
        return (
          <View
            key={tag.id}
            ref={node => rowRef(tag.id, node)}
            collapsable={false}
            style={styles.insideSlot}
          >
            <Press
              feedback="dim"
              onPress={() => onOpen(standing)}
              onLongPress={() => onEdit(tag)}
              delayLongPress={MOVE_MS.hold}
              accessibilityRole="link"
              accessibilityLabel={`${tag.name}, ${tagLine(standing)}, inside the tag above`}
              testID={`tags-row-${order.get(tag.id) ?? 0}`}
              style={styles.insideChip}
              {...rightClick(() => onEdit(tag))}
            >
              {at === 0 ? <Text style={styles.insideLabel}>Inside:</Text> : null}
              <TagDot hue={tag.hue} size={7} />
              <Text style={styles.insideName} numberOfLines={1}>
                {tag.name}
              </Text>
              <Text style={styles.insideCount}>{standing.songs.length.toLocaleString()}</Text>
            </Press>
          </View>
        )
      })}
    </View>
  )
}

/** The side of each cover in the untagged card's stack. */
const COVER_STACK = 40
/** A tile's ⋯, round on its glass. */
const MORE_BUTTON = 30

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { gap: space.lg },
  contentNarrow: pageFrame(false),
  contentWide: { ...pageFrame(true), width: '100%' },
  tileWaiting: { gap: space.sm },
  newCard: { gap: space.sm, padding: space.md, ...card(theme.colors) },
  newHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: label(theme.colors),
  newColour: { gap: space.tight },
  newHint: hint(theme.colors),
  untagged: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.roomy,
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
  untaggedText: textColumn,
  // Wraps rather than squeezing the words to nothing: under about 220 px for
  // them, the buttons take a row of their own.
  untaggedTitle: rowTitle(theme.colors),
  untaggedSub: { color: theme.colors.textSecondary, fontSize: type.sub },
  runs: { gap: ROW_GAP },
  runLabel: { ...label(theme.colors), marginBottom: -space.sm },
  runLabelSub: { fontSize: type.small, fontWeight: '400', letterSpacing: 0, textTransform: 'none' },
  playZone: { position: 'absolute', top: 0, borderRadius: radius.pill },
  more: { position: 'absolute', top: 8, right: 8 },
  moreButton: {
    width: MORE_BUTTON,
    height: MORE_BUTTON,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.glass,
  },
  insideChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.tight,
    marginTop: space.sm,
  },
  // No wider than the tile: a long name is cut, and the chip stays its tag's.
  insideSlot: { maxWidth: '100%' },
  insideChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
    paddingVertical: space.xs,
    paddingHorizontal: space.snug,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  insideLabel: { color: theme.colors.textMuted, fontSize: type.small },
  insideName: {
    flexShrink: 1,
    color: theme.colors.textPrimary,
    fontSize: type.sub,
    fontWeight: '500',
  },
  insideCount: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    fontVariant: ['tabular-nums'],
  },
}))
