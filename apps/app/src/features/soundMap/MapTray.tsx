import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable'
import Svg, { Circle, Path } from 'react-native-svg'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { formatDuration, formatLongDuration, plural, type Song } from '@selfmp3/shared'
import { iconSize, radius, space, type } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { useLayoutValue } from '../../shell/useLayout'
import { glassBlur, glassFill } from '../../ports/glassBlur'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { Fold } from '../../ui/components/Fold'
import { IconButton } from '../../ui/components/IconButton'
import { MoreMenu } from '../../ui/components/MoreMenu'
import { Press } from '../../ui/components/Press'
import { TextField } from '../../ui/components/TextField'
import {
  ChevronDown,
  ChevronUp,
  ListMusic,
  Pencil,
  Play,
  QueueAdd,
  Shuffle,
  X,
} from '../../ui/components/Icons'
import { ScrollView } from '../../ui/components/Scroll'
import { floating, lineSub, smallTitle } from '../../ui/surfaces'
import type { MapTake } from './sky.model'
import type { TraySection } from './tray.model'

/** How far a drag on the tray's head has to go to open or fold it. */
const PULL = 24
/** A section shows this many songs until "more" opens the rest. */
const SHOWN = 8
/** The panel's width on a computer: the page lays the map out beside it. */
export const TRAY_PANEL_WIDTH = 376

/**
 * What the map has taken (A1 B1 C1 P1, docs/features/sound-map.md): every
 * line and loop drawn since it was last cleared.
 *
 * Folded, one line: the first covers, its name, how many and how long, Save
 * and Play. Open, a section a stroke, headed in the colour it is drawn in on
 * the map, with a × that drops it; its songs numbered in the order they will
 * play. On a computer it is one card down the right of the map, the map laid
 * out beside it, and a song under the pointer is ringed on the map; folded,
 * the card is its head alone (K4), the list folding up under it and back
 * down. On a phone it is a sheet half the screen high, and a row swiped left
 * leaves its song out. Play, Save, and in ⋯ Up next, Shuffle and Clear. Nothing here is a
 * playlist until Save makes one.
 */
export function MapTray({
  name,
  sections,
  open,
  wide,
  saving,
  onOpen,
  onRename,
  onRemove,
  onBringBack,
  onDrop,
  onShow,
  onLight,
  onClear,
  onPlay,
  onShuffle,
  onSave,
  onUpNext,
}: {
  name: string
  sections: readonly TraySection[]
  open: boolean
  /** A computer's panel rather than a phone's sheet. */
  wide: boolean
  saving: boolean
  onOpen: (open: boolean) => void
  /** A name of its own, or null for the strokes' names again. */
  onRename: (name: string | null) => void
  onRemove: (id: number) => void
  onBringBack: (ids: readonly number[]) => void
  onDrop: (take: MapTake) => void
  /** A row pressed: its star on the map. */
  onShow: (id: number) => void
  /** The pointer on a row, or off it. */
  onLight: (id: number | null) => void
  onClear: () => void
  onPlay: () => void
  onShuffle: () => void
  onSave: () => void
  onUpNext: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const art = useArt()
  const songs = useMemo(() => sections.flatMap(section => section.songs), [sections])
  const empty = songs.length === 0
  const seconds = songs.reduce((sum, song) => sum + song.duration, 0)
  const count = empty
    ? 'No songs there'
    : `${plural(songs.length, 'song', 'songs')}, ${formatLongDuration(seconds)}`
  const [renaming, setRenaming] = useState(false)
  const [more, setMore] = useState<ReadonlySet<number>>(new Set())
  // A computer's column, and its head: the list takes what is between.
  const [room, setRoom] = useState(0)
  const [headRoom, setHeadRoom] = useState(0)
  const pull = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetY([-8, 8])
        .onEnd(event => {
          if (event.translationY < -PULL) onOpen(true)
          else if (event.translationY > PULL) onOpen(false)
        }),
    [onOpen],
  )

  const actions = (
    <View style={styles.actions}>
      <View style={styles.grow}>
        <Button
          label="Play"
          variant="primary"
          grow
          icon={<Play size={iconSize.item} color={theme.colors.onPrimary} />}
          disabled={empty}
          onPress={onPlay}
          testID="sound-map-play"
        />
      </View>
      <Button
        label={saving ? 'Saving…' : 'Save'}
        variant="secondary"
        icon={<ListMusic size={iconSize.item} tone="textPrimary" />}
        disabled={saving || empty}
        accessibilityLabel="Save as playlist"
        onPress={onSave}
        testID="sound-map-save"
      />
      <MoreMenu
        name={name}
        title={name}
        testID="sound-map-more"
        items={[
          {
            key: 'up-next',
            label: 'Add to Up next',
            icon: <QueueAdd size={iconSize.item} tone="textPrimary" />,
            disabled: empty,
            onPress: onUpNext,
            testID: 'sound-map-up-next',
          },
          {
            key: 'shuffle',
            label: 'Shuffle',
            icon: <Shuffle size={iconSize.item} tone="textPrimary" />,
            disabled: empty,
            onPress: onShuffle,
            testID: 'sound-map-shuffle',
          },
          {
            key: 'clear',
            label: 'Clear what’s drawn',
            icon: <X size={iconSize.item} tone="danger" />,
            danger: true,
            apart: true,
            onPress: onClear,
            testID: 'sound-map-clear',
          },
        ]}
      />
    </View>
  )

  if (!open && !wide) {
    return (
      <View style={[styles.tray, glassBlur]} testID="sound-map-tray">
        <GestureDetector gesture={pull}>
          <View style={styles.head}>
            <View style={styles.grab} />
            <View style={styles.row}>
              <Press
                feedback="dim"
                onPress={() => onOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Show the songs in ${name}`}
                accessibilityState={{ expanded: false }}
                style={styles.open}
                wrap={styles.grow}
                testID="sound-map-tray-head"
              >
                <View style={styles.stack}>
                  {songs.slice(0, 3).map((song, index) => (
                    <View key={song.id} style={[styles.stacked, index > 0 && styles.overlap]}>
                      <Cover uri={art(song)} title={song.title} size={STACK} radius={6} />
                    </View>
                  ))}
                </View>
                <View style={styles.words}>
                  <Text style={styles.name} numberOfLines={1} testID="sound-map-tray-name">
                    {name}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {count}
                  </Text>
                </View>
              </Press>
              <IconButton
                label={saving ? 'Saving…' : 'Save as playlist'}
                filled
                disabled={saving || empty}
                onPress={onSave}
                testID="sound-map-save"
              >
                <ListMusic size={iconSize.item} tone="textPrimary" />
              </IconButton>
              <IconButton
                label="Play"
                filled="primary"
                disabled={empty}
                onPress={onPlay}
                testID="sound-map-play"
              >
                <Play size={iconSize.item} color={theme.colors.onPrimary} />
              </IconButton>
            </View>
          </View>
        </GestureDetector>
      </View>
    )
  }

  const title = renaming ? (
    <NameField
      name={name}
      onDone={next => {
        setRenaming(false)
        if (next !== undefined) onRename(next)
      }}
    />
  ) : (
    <View style={styles.nameRow}>
      <Text style={styles.title} numberOfLines={1} testID="sound-map-tray-name">
        {name}
      </Text>
      {open ? (
        <IconButton
          label="Rename"
          size={32}
          onPress={() => setRenaming(true)}
          testID="sound-map-rename"
        >
          <Pencil size={iconSize.small} tone="textSecondary" />
        </IconButton>
      ) : null}
    </View>
  )
  const sub = (
    <View style={styles.subRow}>
      {sections.map(section => (
        <View
          key={section.take.id}
          style={[styles.dot, { backgroundColor: section.take.tone }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ))}
      <Text style={styles.sub} numberOfLines={1}>
        {count}
      </Text>
    </View>
  )
  const list = (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {sections.map(section => (
        <Section
          key={section.take.id}
          section={section}
          all={more.has(section.take.id)}
          onAll={() => setMore(before => new Set(before).add(section.take.id))}
          onDrop={() => onDrop(section.take)}
          onBringBack={() => onBringBack(section.left)}
          onRemove={onRemove}
          onShow={onShow}
          onLight={onLight}
        />
      ))}
    </ScrollView>
  )

  if (wide) {
    // One card down the right (K4): its head stays where it is, and the list
    // folds up under it, or down out of it, taking the rest of the column.
    return (
      <View
        style={styles.column}
        pointerEvents="box-none"
        onLayout={event => setRoom(event.nativeEvent.layout.height)}
      >
        <View style={[styles.tray, styles.panel, glassBlur]} testID="sound-map-tray">
          <View
            style={styles.headWide}
            onLayout={event => setHeadRoom(event.nativeEvent.layout.height)}
          >
            <View style={styles.row}>
              {open ? (
                <View style={styles.words}>
                  {title}
                  {sub}
                </View>
              ) : (
                <Press
                  feedback="dim"
                  onPress={() => onOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show the songs in ${name}`}
                  accessibilityState={{ expanded: false }}
                  style={styles.words}
                  wrap={styles.grow}
                  testID="sound-map-tray-words"
                >
                  {title}
                  {sub}
                </Press>
              )}
              {open ? null : (
                <IconButton
                  label="Play"
                  filled="primary"
                  disabled={empty}
                  onPress={onPlay}
                  testID="sound-map-play"
                >
                  <Play size={iconSize.item} color={theme.colors.onPrimary} />
                </IconButton>
              )}
              <IconButton
                label={open ? 'Fold the list' : 'Show the list'}
                filled
                onPress={() => onOpen(!open)}
                testID="sound-map-tray-head"
              >
                {open ? (
                  <ChevronUp size={iconSize.item} tone="textSecondary" />
                ) : (
                  <ChevronDown size={iconSize.item} tone="textSecondary" />
                )}
              </IconButton>
            </View>
          </View>
          <Fold open={open}>
            <View style={[styles.body, { height: Math.max(0, room - headRoom) }]}>
              {list}
              <View style={styles.foot}>{actions}</View>
            </View>
          </Fold>
        </View>
      </View>
    )
  }

  return (
    <View style={[styles.tray, styles.opened, glassBlur]} testID="sound-map-tray">
      <GestureDetector gesture={pull}>
        <View style={styles.head}>
          <View style={styles.grab} />
          <View style={styles.row}>
            <View style={styles.words}>
              {title}
              {sub}
            </View>
            <IconButton
              label="Fold the list"
              filled
              onPress={() => onOpen(false)}
              testID="sound-map-tray-head"
            >
              <ChevronDown size={iconSize.item} tone="textSecondary" />
            </IconButton>
          </View>
          {actions}
        </View>
      </GestureDetector>
      {list}
    </View>
  )
}

/** The name, typed over: Return or leaving keeps it, an empty field goes back to the strokes' names. */
function NameField({
  name,
  onDone,
}: {
  name: string
  /** The new name, null for none of its own, undefined for unchanged. */
  onDone: (name: string | null | undefined) => void
}): ReactNode {
  // Uncontrolled, so a pinyin or kana composition is never cut short by a render.
  const text = useRef(name)
  const done = useRef(false)
  const finish = (): void => {
    if (done.current) return
    done.current = true
    const next = text.current.trim()
    onDone(next === name ? undefined : next || null)
  }
  return (
    <TextField
      size="small"
      defaultValue={name}
      autoFocus
      selectTextOnFocus
      returnKeyType="done"
      accessibilityLabel="Name"
      onChangeText={value => {
        text.current = value
      }}
      onSubmitEditing={finish}
      onBlur={finish}
      testID="sound-map-name-field"
    />
  )
}

/** One stroke: its colour and kind, its name, its songs and what was left out of them. */
function Section({
  section,
  all,
  onAll,
  onDrop,
  onBringBack,
  onRemove,
  onShow,
  onLight,
}: {
  section: TraySection
  all: boolean
  onAll: () => void
  onDrop: () => void
  onBringBack: () => void
  onRemove: (id: number) => void
  onShow: (id: number) => void
  onLight: (id: number | null) => void
}): ReactNode {
  const art = useArt()
  const { take, songs, first, left } = section
  const shown = all ? songs : songs.slice(0, SHOWN)
  const hidden = songs.length - shown.length
  return (
    <View style={styles.section} testID={`sound-map-section-${take.id}`}>
      <View style={styles.sectionHead}>
        <StrokeMark kind={take.kind} tone={take.tone} />
        <Text style={styles.sectionName} numberOfLines={1}>
          {take.name || (take.kind === 'loop' ? 'Loop' : 'Line')}
          <Text style={styles.sectionKind}>{` · ${take.kind} · ${songs.length}`}</Text>
        </Text>
        <IconButton
          label={`Drop this ${take.kind}`}
          size={36}
          onPress={onDrop}
          testID={`sound-map-drop-${take.id}`}
        >
          <X size={iconSize.small} tone="textMuted" />
        </IconButton>
      </View>
      {shown.map((song, index) => (
        <TrayRow
          key={song.id}
          song={song}
          number={first + index}
          uri={art(song)}
          onRemove={() => onRemove(song.id)}
          onShow={() => onShow(song.id)}
          onLight={onLight}
        />
      ))}
      {hidden > 0 || left.length > 0 ? (
        <View style={styles.sectionFoot}>
          {hidden > 0 ? (
            <Button
              label={`${hidden} more`}
              variant="text"
              size="small"
              onPress={onAll}
              testID={`sound-map-more-${take.id}`}
            />
          ) : null}
          {left.length > 0 ? (
            <>
              <Text style={styles.leftOut}>{`${left.length} left out`}</Text>
              <Button
                label="Bring back"
                variant="text"
                size="small"
                onPress={onBringBack}
                testID={`sound-map-bring-back-${take.id}`}
              />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** A stroke's mark, in its colour: a dashed ring for a loop, a curve between two dots for a line. */
function StrokeMark({ kind, tone }: { kind: MapTake['kind']; tone: string }): ReactNode {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      {kind === 'loop' ? (
        <Circle cx={12} cy={12} r={8} stroke={tone} strokeWidth={2.2} strokeDasharray="3 3" />
      ) : (
        <>
          <Path d="M4 17C8 15 10 9 20 7" stroke={tone} strokeWidth={2.2} strokeLinecap="round" />
          <Circle cx={4} cy={17} r={1.8} fill={tone} />
          <Circle cx={20} cy={7} r={1.8} fill={tone} />
        </>
      )}
    </Svg>
  )
}

/** A press this soon after a swipe began is the swipe letting go. */
const SWIPE_PRESS_MS = 800

/** The row swiped open, if any: opening another closes it, as Mail's rows do. */
let swipedOpen: SwipeableMethods | null = null

/**
 * A song in the tray: pressed, its star on the map. Leaving it out is a × on
 * hover where there is a pointer (it stands where the length was), and a
 * swipe left where there is not, with the row's own action for a screen reader.
 */
function TrayRow({
  song,
  number,
  uri,
  onRemove,
  onShow,
  onLight,
}: {
  song: Song
  number: number
  uri: string | null | undefined
  onRemove: () => void
  onShow: () => void
  onLight: (id: number | null) => void
}): ReactNode {
  // A pointer to hover with; a phone or an iPad swipes a row instead.
  const hover = useLayoutValue(layout => layout.finePointer)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const swipeable = useRef<SwipeableMethods>(null)
  // When a swipe last began: letting go of one is not a press on the row.
  const swipedAt = useRef(0)
  const press = (): void => {
    if (Date.now() - swipedAt.current < SWIPE_PRESS_MS) return
    // A row swiped open closes at a tap, as Mail's does.
    if (swipeable.current && swipedOpen === swipeable.current) {
      swipeable.current.close()
      return
    }
    onShow()
  }
  useEffect(() => {
    const mine = swipeable.current
    return () => {
      if (swipedOpen === mine) swipedOpen = null
    }
  }, [])
  const near = hovered || focused
  // The row is a container with its press target under the words and the ×
  // beside it, as a song row is: in a browser a button is a <button>, and a ×
  // inside the row's would be a <button> in a <button>.
  const row = (
    <View
      role="row"
      onPointerEnter={
        hover
          ? () => {
              setHovered(true)
              onLight(song.id)
            }
          : undefined
      }
      onPointerLeave={
        hover
          ? () => {
              setHovered(false)
              onLight(null)
            }
          : undefined
      }
      style={[styles.song, !hover && styles.songSolid, hover && hovered && styles.songHovered]}
      testID={`sound-map-song-${song.id}`}
    >
      <Press
        feedback="dim"
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel={`${song.title}, ${song.artist}: show it on the map`}
        accessibilityActions={[{ name: 'leaveOut', label: 'Leave out' }]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'leaveOut') onRemove()
        }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.rowBody} pointerEvents="none">
        <Text style={styles.number}>{number}</Text>
        <Cover uri={uri} title={song.title} size={ROW_COVER} radius={6} />
        <View style={styles.words}>
          <Text style={styles.songTitle} numberOfLines={1}>
            {song.title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {song.artist}
          </Text>
        </View>
      </View>
      <View style={styles.end} pointerEvents="box-none">
        <Text style={[styles.length, hover && near && styles.gone]} pointerEvents="none">
          {formatDuration(song.duration)}
        </Text>
        {hover ? (
          <View style={[styles.leave, !near && styles.gone]}>
            <IconButton
              label={`Leave out ${song.title}`}
              size={32}
              onPress={onRemove}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              testID={`sound-map-leave-${song.id}`}
            >
              <X size={iconSize.small} tone="textPrimary" />
            </IconButton>
          </View>
        ) : null}
      </View>
    </View>
  )
  if (hover) return row
  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={1.6}
      rightThreshold={40}
      overshootRight={false}
      onSwipeableOpenStartDrag={() => {
        swipedAt.current = Date.now()
      }}
      onSwipeableCloseStartDrag={() => {
        swipedAt.current = Date.now()
      }}
      onSwipeableWillOpen={() => {
        const opening = swipeable.current
        if (swipedOpen !== opening) swipedOpen?.close()
        swipedOpen = opening
      }}
      onSwipeableClose={() => {
        if (swipedOpen === swipeable.current) swipedOpen = null
      }}
      renderRightActions={(_progress, _translation, methods) => (
        <Press
          feedback="dim"
          onPress={() => {
            methods.close()
            onRemove()
          }}
          accessibilityRole="button"
          accessibilityLabel={`Leave out ${song.title}`}
          style={styles.swipeAction}
          testID={`sound-map-leave-${song.id}`}
        >
          <Text style={styles.swipeActionText}>Leave out</Text>
        </Press>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  )
}

const STACK = 32
const ROW_COVER = 40

const styles = StyleSheet.create(theme => ({
  tray: {
    backgroundColor: glassFill(theme.colors),
    borderRadius: radius.sheet,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    overflow: 'hidden',
    ...floating(theme.colors),
  },
  opened: { flex: 1, paddingHorizontal: space.xs, paddingBottom: 0 },
  column: { flex: 1 },
  panel: { paddingHorizontal: space.xs, paddingBottom: 0 },
  body: { minHeight: 0 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: space.tight },
  dot: { width: 8, height: 8, borderRadius: 4 },
  head: { paddingTop: space.xs, paddingHorizontal: space.sm, gap: space.xs },
  headWide: {
    paddingTop: space.md,
    paddingBottom: space.sm,
    paddingLeft: space.md,
    paddingRight: space.sm,
  },
  grab: {
    alignSelf: 'center',
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.borderStrong,
    marginBottom: space.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  open: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
  },
  stack: { flexDirection: 'row' },
  stacked: { borderRadius: 7, borderWidth: 2, borderColor: theme.colors.glassSolid },
  overlap: { marginLeft: -14 },
  words: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.tight },
  name: smallTitle(theme.colors),
  title: { ...smallTitle(theme.colors), fontSize: type.body, flexShrink: 1 },
  sub: lineSub(theme.colors),
  list: { flex: 1, marginTop: space.xs },
  listContent: { paddingBottom: space.md, gap: space.sm },
  section: { gap: 2 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.sm,
    minHeight: 40,
  },
  sectionName: { flex: 1, minWidth: 0, ...smallTitle(theme.colors), fontSize: type.sub },
  sectionKind: { color: theme.colors.textSecondary, fontWeight: '400' },
  sectionFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: 30 + space.sm,
  },
  leftOut: { ...lineSub(theme.colors), color: theme.colors.textMuted },
  song: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 52,
    paddingHorizontal: space.sm,
    borderRadius: radius.row,
  },
  // Solid where a swipe slides it over its Leave out.
  songSolid: { backgroundColor: theme.colors.glassSolid },
  rowBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  songHovered: { backgroundColor: theme.colors.veil },
  number: {
    width: 22,
    textAlign: 'right',
    fontSize: type.small,
    color: theme.colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  songTitle: { ...smallTitle(theme.colors), fontSize: type.sub },
  end: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  length: { fontSize: type.small, color: theme.colors.textMuted, fontVariant: ['tabular-nums'] },
  leave: { position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' },
  gone: { opacity: 0 },
  swipeAction: {
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    backgroundColor: theme.colors.danger,
    borderRadius: radius.row,
  },
  swipeActionText: { color: theme.colors.textPrimary, fontSize: type.sub, fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  foot: { paddingHorizontal: space.sm, paddingBottom: space.xs },
  grow: { flex: 1, minWidth: 0 },
}))
