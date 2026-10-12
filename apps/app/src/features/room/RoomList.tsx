import { memo, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import {
  artistOr,
  formatDuration,
  formatRoomCode,
  plural,
  type RoomAction,
  type RoomState,
} from '@selfmp3/shared'
import { HIT_TARGET, fonts, radius, roomTrackSong, space, type, withAlpha } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands, usePlayerPlaying } from '../../player/PlayerProvider'
import { roomTrack } from '../../player/roomTracks'
import { label } from '../../ui/surfaces'
import { tip } from '../../ui/tip'
import { useSongColor } from '../../ui/useSongColor'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { More, Next, People, Plus, ToTop, X } from '../../ui/components/Icons'
import { PlayPauseIcon } from '../../ui/components/PlayPauseIcon'
import { Toggle } from '../../ui/components/Toggle'
import { RoomFace, RoomFaces } from './RoomFace'
import {
  isHost,
  nameOf,
  peopleHere,
  playedRows,
  playingRow,
  positionNow,
  roomLine,
  roomTitle,
  upcomingRows,
  youMay,
  type RoomRow,
} from './room.model'
import { openRoomSheet } from './roomSheets.store'
import { sayRoomFailure } from './roomFailure'
import { currentRoom, roomAct, useRoom } from './room.store'

/** Rows of what is next drawn at once; a room's list is rarely longer. */
const SHOWN_NEXT = 40
/** Songs that played, shown under the list. */
const SHOWN_PLAYED = 5

function act(action: RoomAction): void {
  void roomAct(action).catch(sayRoomFailure)
}

/**
 * A room, as Up next draws it while you are in one (docs/features/listen-together.md,
 * mock R4): whose room and who is here, the song playing and who brought it,
 * what comes next taking turns, what played, and Add songs.
 *
 * The same on a phone's sheet, a computer's rail and the room's own page;
 * `head` leaves the room's name to a page that draws it larger.
 */
export function RoomList({ head = true }: { head?: boolean }): ReactNode {
  const { state, link } = useRoom()
  if (!state) return null
  return (
    <View style={styles.root} testID="room-list">
      {head ? <RoomHead state={state} link={link} /> : null}
      <PlayingCard state={state} />
      <Upcoming state={state} />
    </View>
  )
}

/** The room's name, its people and where it plays, with Invite and the people's sheet. */
export function RoomHead({
  state,
  link,
}: {
  state: RoomState
  link: 'connecting' | 'live' | 'offline'
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View style={styles.head}>
      <View style={styles.headText}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
          {roomTitle(state)}
        </Text>
        <View style={styles.people}>
          <RoomFaces people={peopleHere(state)} size={22} />
          <Text style={styles.line} numberOfLines={1}>
            {link === 'live' ? roomLine(state) : 'Reconnecting…'}
          </Text>
        </View>
      </View>
      <View style={styles.headButtons}>
        <Pressable
          onPress={() => openRoomSheet('people')}
          accessibilityRole="button"
          accessibilityLabel="People and room options"
          {...tip('People')}
          testID="room-people"
          style={({ pressed }) => [styles.round, pressed && styles.roundPressed]}
        >
          <More size={18} color={theme.colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  )
}

/** The song playing, who brought it, and what you may do to it. */
function PlayingCard({ state }: { state: RoomState }): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt(ROW_COVER_SIZE)
  const commands = usePlayerCommands()
  const localPlaying = usePlayerPlaying()
  const row = playingRow(state)
  const song = row ? (roomTrack(row.trackId)?.song ?? roomTrackSong(row.entry)) : null
  const art = song ? artFor(song) : null
  const tone = useSongColor(song, art)
  if (!row || !song) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Nothing playing yet</Text>
        <Text style={styles.emptyText}>
          Add a song, or share the code {formatRoomCode(state.code)}. The first one starts the room.
        </Text>
      </View>
    )
  }
  const host = isHost(state)
  const paused = state.playing?.pausedAt !== null
  const playing = host ? localPlaying : !paused
  const mayToggle = youMay(state, playing ? 'pause' : 'play')
  // The host's own player has Next; a friend's card is their only way to skip.
  const maySkip = !host && youMay(state, 'skip')
  const whose = !row.owner
    ? 'from a link'
    : row.owner.id === state.you
      ? 'yours'
      : `${row.owner.name}’s`
  return (
    <View style={[styles.card, { backgroundColor: withAlpha(tone.color, 0.2) }]}>
      <View>
        <Cover uri={art} title={song.title} size={48} />
        {row.by ? (
          <View style={styles.badge}>
            <RoomFace name={row.by.name} colour={row.by.colour} size={20} ring />
          </View>
        ) : null}
      </View>
      <View style={styles.cardText}>
        <Text style={[styles.cardLabel, { color: tone.tint }]} numberOfLines={1}>
          {paused ? 'Paused' : 'Playing'} · {whose}
        </Text>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {song.title}
        </Text>
        <RoomClock state={state} artist={artistOr(song.artist)} duration={song.duration} />
      </View>
      {mayToggle ? (
        <Pressable
          onPress={() => (host ? commands.toggle() : act({ type: playing ? 'pause' : 'play' }))}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          {...tip(playing ? 'Pause' : 'Play')}
          style={({ pressed }) => [styles.cardPlay, pressed && styles.roundPressed]}
          testID="room-toggle"
        >
          <PlayPauseIcon playing={playing} size={20} color={theme.colors.onPrimary} />
        </Pressable>
      ) : null}
      {maySkip ? (
        <Pressable
          onPress={() => act({ type: 'skip' })}
          accessibilityRole="button"
          accessibilityLabel="Skip"
          {...tip('Skip')}
          style={({ pressed }) => [styles.round, pressed && styles.roundPressed]}
          testID="room-skip"
        >
          <Next size={18} color={theme.colors.textPrimary} />
        </Pressable>
      ) : null}
    </View>
  )
}

/** "ヨルシカ · 1:52 of 4:23", on the room's clock, ticking on its own. */
function RoomClock({
  state,
  artist,
  duration,
}: {
  state: RoomState
  artist: string
  duration: number
}): ReactNode {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const position = Math.min(
    positionNow(state, currentRoom().offset, now),
    duration > 0 ? duration : Number.POSITIVE_INFINITY,
  )
  return (
    <Text style={styles.cardSub} numberOfLines={1}>
      {artist} · {formatDuration(position)}
      {duration > 0 ? ` of ${formatDuration(duration)}` : ''}
    </Text>
  )
}

function Upcoming({ state }: { state: RoomState }): ReactNode {
  const { theme } = useUnistyles()
  const next = upcomingRows(state)
  const played = playedRows(state).slice(0, SHOWN_PLAYED)
  const host = isHost(state)
  const mayAdd = youMay(state, 'again') || youMay(state, 'add') || youMay(state, 'addLink')
  return (
    <View style={styles.list}>
      {next.length > 0 ? (
        <Text style={styles.label}>
          Next · taking turns · {plural(next.length, 'song', 'songs')}
        </Text>
      ) : null}
      {next.slice(0, SHOWN_NEXT).map((row, index) => (
        <EntryRow
          key={row.entry.id}
          state={state}
          row={row}
          action={
            host && index > 0 ? (
              <RowButton
                label={`Play ${row.entry.song.title} next`}
                tipText="Play next"
                onPress={() => act({ type: 'move', entryId: row.entry.id, to: 0 })}
              >
                <ToTop size={16} color={theme.colors.textSecondary} />
              </RowButton>
            ) : null
          }
          remove={row.removable}
        />
      ))}
      {next.length > SHOWN_NEXT ? (
        <Text style={styles.more}>
          and {plural(next.length - SHOWN_NEXT, 'song', 'songs')} after that
        </Text>
      ) : null}

      <View style={styles.actions}>
        {mayAdd ? (
          <Button
            label="Add songs"
            icon={<Plus size={16} color={theme.colors.textPrimary} />}
            onPress={() => openRoomSheet('add')}
            grow
            testID="room-add"
          />
        ) : null}
        <Button
          label="Invite"
          variant={next.length === 0 ? 'primary' : 'secondary'}
          onPress={() => openRoomSheet('together')}
          grow
          testID="room-invite"
        />
      </View>

      {played.length > 0 ? (
        <>
          <Text style={[styles.label, styles.playedLabel]}>Played</Text>
          {played.map(row => (
            <EntryRow
              key={row.entry.id}
              state={state}
              row={row}
              dim
              action={
                youMay(state, 'again') ? (
                  <RowButton
                    label={`Play ${row.entry.song.title} again later`}
                    tipText="Again"
                    onPress={() => act({ type: 'again', entryId: row.entry.id })}
                  >
                    <Plus size={16} color={theme.colors.textSecondary} />
                  </RowButton>
                ) : null
              }
            />
          ))}
        </>
      ) : null}

      {host ? (
        <View style={styles.keepGoing}>
          <Toggle
            value={state.keepGoing}
            onChange={keepGoing => act({ type: 'settings', keepGoing })}
            label="Keep it going"
            testID="room-keep-going"
          />
          <View style={styles.keepGoingText}>
            <Text style={styles.keepGoingTitle}>Keep it going</Text>
            <Text style={styles.keepGoingHint} numberOfLines={3}>
              Near the end, adds songs from what people brought, taking turns
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  )
}

const EntryRow = memo(function EntryRow({
  state,
  row,
  action,
  remove = false,
  dim = false,
}: {
  state: RoomState
  row: RoomRow
  action?: ReactNode
  remove?: boolean
  dim?: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt(ROW_COVER_SIZE)
  const song = roomTrack(row.trackId)?.song ?? roomTrackSong(row.entry)
  return (
    <View style={[styles.row, dim && styles.dim]} testID={`room-row-${row.entry.id}`}>
      <View>
        <Cover uri={artFor(song)} title={song.title} size={44} />
        {row.by ? (
          <View style={styles.badge}>
            <RoomFace name={row.by.name} colour={row.by.colour} size={20} ring />
          </View>
        ) : null}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {song.title}
        </Text>
        <Text style={styles.rowSub} numberOfLines={1}>
          {artistOr(song.artist)} · {nameOf(state, row.by)}
          {row.entry.song.link ? ' · from a link' : ''}
        </Text>
      </View>
      {action}
      {remove ? (
        <RowButton
          label={`Take ${song.title} out`}
          tipText="Take out"
          onPress={() => act({ type: 'remove', entryId: row.entry.id })}
        >
          <X size={16} color={theme.colors.textSecondary} />
        </RowButton>
      ) : null}
    </View>
  )
})

function RowButton({
  label: spoken,
  tipText,
  onPress,
  children,
}: {
  label: string
  tipText: string
  onPress: () => void
  children: ReactNode
}): ReactNode {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      {...tip(tipText)}
      hitSlop={6}
      style={({ pressed }) => [styles.rowButton, pressed && styles.roundPressed]}
    >
      {children}
    </Pressable>
  )
}

/**
 * Together, in Up next's head (E1): opens a room from what is playing, or its
 * invite once you are in one. Round beside the title on a computer's rail;
 * on a phone, where Shuffle and Clear the rest fill the title's line, it sits
 * on the line under it with its name (`labelled`).
 */
export function TogetherButton({ labelled = false }: { labelled?: boolean }): ReactNode {
  const { theme } = useUnistyles()
  if (labelled) {
    return (
      <Button
        label="Together"
        icon={<People size={16} color={theme.colors.textPrimary} />}
        onPress={() => openRoomSheet('together')}
        testID="queue-together"
      />
    )
  }
  return (
    <IconButton
      label="Listen together"
      caption="Together"
      filled
      onPress={() => openRoomSheet('together')}
      testID="queue-together"
    >
      <People size={18} color={theme.colors.textPrimary} />
    </IconButton>
  )
}

const styles = StyleSheet.create(theme => ({
  root: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  headText: { flex: 1, minWidth: 0, gap: 6 },
  title: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: type.large,
    letterSpacing: -0.2,
  },
  people: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { flexShrink: 1, color: theme.colors.textSecondary, fontSize: type.sub },
  headButtons: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  round: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface3,
  },
  roundPressed: { transform: [{ scale: 0.96 }] },
  empty: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.mini,
    backgroundColor: theme.colors.surface2,
  },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  emptyText: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: 18 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.mini,
  },
  badge: { position: 'absolute', right: -5, bottom: -5 },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  cardLabel: label(theme.colors),
  cardTitle: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  cardSub: { color: theme.colors.textSecondary, fontSize: type.sub, fontVariant: ['tabular-nums'] },
  cardPlay: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.textPrimary,
  },
  list: { gap: 2 },
  actions: { flexDirection: 'row', gap: space.sm, paddingTop: space.sm },
  label: { ...label(theme.colors), paddingBottom: space.xs },
  playedLabel: { paddingTop: space.lg },
  more: { color: theme.colors.textMuted, fontSize: type.sub, paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60 },
  dim: { opacity: 0.55 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  rowSub: { color: theme.colors.textSecondary, fontSize: type.sub },
  rowButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
  },
  keepGoing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.mini,
    backgroundColor: theme.colors.surface2,
  },
  keepGoingText: { flex: 1, minWidth: 0, gap: 2 },
  keepGoingTitle: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  keepGoingHint: { color: theme.colors.textSecondary, fontSize: type.small },
}))
