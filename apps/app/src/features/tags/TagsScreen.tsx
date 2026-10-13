import { useEffect, useCallback, memo, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import type { Tag } from '@selfmp3/shared'
import { radius, space, type, useLibrary, textStyle, iconSize } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useOpenSearch } from '../../shell/palette'
import { useLayout } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
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
import { TagEditor } from '../../ui/components/TagEditor'
import { usePressScale } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { rightClick } from '../../ui/rightClick'
import { GridTile, TileGrid, useTileGrid, type TileFocus } from '../../ui/components/TileGrid'
import { card, label, pageFrame, rowTitle, hint, textColumn } from '../../ui/surfaces'
import { tip } from '../../ui/tip'
import { noteTagUsed } from '../library/recentTags.store'
import { artistLink } from '../tag/placeLinks'
import { useOpenTag } from '../tag/useOpenTag'
import {
  noTagsLine,
  tagLine,
  tagsMostPlayed,
  untaggedCardTitle,
  type TagStanding,
} from '../tag/tag.model'
import { usePlayAndTag } from '../tag/usePlayAndTag'
import { useSmartSwitches } from '../smart/useSmartSwitches'
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
import { NEW_TAG_FAILED, TagNameField, useNewTagForm } from './useNewTagForm'
import { ScrollView } from '../../ui/components/Scroll'
import { TagDot } from '../../ui/components/TagDot'

/** Tiles at least this wide on a computer, as many as fit; two across on a phone. */
const TILE_MIN_WIDTH = 220
const GAP = 16
const ROW_GAP = 24
/** How many artists the untagged card names on a computer, and on a phone. */
const WAITING_SHOWN = 3
const PHONE_WAITING_SHOWN = 2
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
 * of whose songs another tag carries is drawn inside that tag (E), and tags
 * with a song or two wait at the end (L), so the page opens on the ones in
 * use. Picking tags to combine is not here: a tag's page has Add for that.
 *
 * At the top, only while some songs have no tag, a card that says who they
 * are by and tags them one at a time while they play (K2).
 */
export function TagsScreen(): ReactNode {
  const { wide, finePointer } = useLayout()
  const router = useRouter()
  const player = usePlayerCommands()
  const { data: library } = useLibrary()
  const playAndTag = usePlayAndTag()
  const [adding, setAdding] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const switches = useSmartSwitches()
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
    })
  }, [])
  const openArtist = useCallback((name: string) => {
    latest.current.router.navigate(artistLink(name))
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
  // A phone names fewer, so what its "and others" counts is the rest after those.
  const phoneRest = useMemo(
    () => (library && !wide ? waitingArtists(library.songs, PHONE_WAITING_SHOWN).rest : 0),
    [library, wide],
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
      // A tag that holds others stands with its panel beside it, a tile wide.
      spanOf={entry => (entry.inside.length > 0 ? 2 : 1)}
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
      >
        <PageHeader
          title="Tags"
          subtitle={library ? tagsHeadline(tags.length) : undefined}
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
            onClose={() => setAdding(false)}
          />
        ) : null}

        {playAndTag.count > 0 ? (
          <UntaggedCard
            count={playAndTag.count}
            artists={waiting.artists}
            rest={wide ? waiting.rest : phoneRest}
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
          <Text style={styles.hint}>No tags yet. {noTagsLine(finePointer)}</Text>
        ) : (
          <View style={styles.runs}>
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
  // The field stays open and empty once a tag is made: tags arrive in
  // handfuls, and a second one should not cost another trip to the +.
  const form = useNewTagForm({ tags, onExisting })

  return (
    <View style={styles.newCard} testID="tags-new-form">
      <View style={styles.newHeadRow}>
        <Text style={styles.fieldLabel}>New tag</Text>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close new tag"
        >
          <X size={14} color={theme.colors.textMuted} />
        </Pressable>
      </View>
      <TagNameField
        form={form}
        placeholder="chill, 中文, gym…"
        autoFocus
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
      {form.failed ? (
        <StatusLine>{NEW_TAG_FAILED}</StatusLine>
      ) : (
        <Text style={styles.newHint}>
          A tag is a word or two. Put it on songs from a song’s ⋯, or while one is playing.
        </Text>
      )}
      {form.nudge}
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
  /** The songs by none of the artists named. */
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
  const named = wide ? artists : artists.slice(0, PHONE_WAITING_SHOWN)
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
        <TagIcon size={iconSize.medium} tone="textPrimary" />
      </View>
    )

  // The same words a screen reader is given; a computer draws the names as links.
  const line = waitingLine(named, rest, wide ? 'count' : 'others')
  const who =
    named.length === 0 || !wide ? (
      line
    ) : (
      <>
        {named.map((artist, index) => (
          <Text key={artist.name}>
            {index > 0 ? ' · ' : ''}
            {artist.count.toLocaleString()} by{' '}
            <Text
              style={styles.artistLink}
              onPress={() => onArtist(artist.name)}
              accessibilityRole="link"
              {...tip(`Open ${artist.name}`)}
            >
              {artist.name}
            </Text>
          </Text>
        ))}
        {rest > 0 ? ` · and ${rest.toLocaleString()} more` : ''}
      </>
    )
  const words = (
    <View style={styles.untaggedText}>
      <Text style={styles.untaggedTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.untaggedSub} numberOfLines={1}>
        {who}
      </Text>
    </View>
  )
  const suggest = (variant: 'secondary' | 'text'): ReactNode =>
    onSuggest ? (
      <Button
        label="Suggest tags"
        icon={<Sparkle />}
        variant={variant}
        onPress={onSuggest}
        testID="tags-untagged-suggest"
      />
    ) : null

  if (wide) {
    return (
      <View style={styles.untagged} testID="tags-untagged">
        {covers}
        {words}
        {suggest('secondary')}
        <Button
          label="Tag while they play"
          icon={<TagIcon color={theme.colors.textPrimary} />}
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
        accessibilityLabel={`${title}. ${line}`}
        accessibilityHint={UNTAGGED_HINT}
        testID="tags-untagged"
        style={styles.untagged}
      >
        {covers}
        {words}
        <ChevronRight size={iconSize.item} tone="textMuted" />
      </Pressable>
      {onSuggest ? <View style={styles.untaggedSuggest}>{suggest('text')}</View> : null}
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
          {/* The record itself is Play: what is out of the sleeve, right of it. */}
          <Pressable
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
            <Pressable
              onPress={() => onEdit(tag)}
              {...focus}
              accessibilityRole="button"
              accessibilityLabel={`Rename, recolour or delete ${tag.name}`}
              {...tip('Edit tag')}
              testID={`tags-more-${index}`}
              hitSlop={6}
              style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
            >
              <More size={iconSize.item} tone="textPrimary" />
            </Pressable>
          </View>
        </>
      )}
    />
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
                  {...rightClick(() => onEdit(tag))}
                >
                  <Cover
                    uri={lead ? art(lead) : null}
                    title={lead ? lead.album || lead.title : tag.name}
                    size={compact ? 20 : INSIDE_COVER}
                    radius={compact ? 5 : 7}
                  />
                  <TagDot hue={tag.hue} />
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
  contentNarrow: pageFrame(false),
  contentWide: { ...pageFrame(true), width: '100%' },
  hint: { color: theme.colors.textMuted, ...textStyle('sub') },
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
  untaggedSuggest: { flexDirection: 'row', justifyContent: 'flex-end' },
  untaggedTitle: rowTitle(theme.colors),
  untaggedSub: { color: theme.colors.textSecondary, fontSize: type.sub },
  artistLink: {
    color: theme.colors.textPrimary,
    fontWeight: '500',
    textDecorationLine: 'underline',
    textDecorationColor: theme.colors.borderStrong,
  },
  runs: { gap: ROW_GAP },
  runLabel: { ...label(theme.colors), marginBottom: -space.sm },
  runLabelSub: { fontSize: type.small, fontWeight: '400', letterSpacing: 0, textTransform: 'none' },
  holder: { flexDirection: 'row', gap: GAP },
  pressed: { opacity: 0.75 },
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
    padding: space.md,
    gap: space.xs,
  },
  insideCompact: { padding: space.tight, gap: 0, justifyContent: 'center' },
  insideLabel: { ...label(theme.colors), paddingHorizontal: space.xs, paddingBottom: 2 },
  insideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: space.xs,
    paddingHorizontal: space.xs,
    borderRadius: 10,
  },
  insideRowCompact: { gap: 7, paddingVertical: 2 },
  insideRowOn: { backgroundColor: theme.colors.surface2 },
  insideName: {
    flex: 1,
    minWidth: 0,
    ...rowTitle(theme.colors),
  },
  insideNameCompact: { fontSize: type.sub },
  insideCount: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    fontVariant: ['tabular-nums'],
  },
  insideCountCompact: { fontSize: type.tiny },
  insideNote: {
    marginTop: 11,
    ...hint(theme.colors),
  },
  footer: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    textAlign: 'center',
    paddingTop: space.sm,
  },
}))
