import { memo, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import {
  artistOr,
  formatDuration,
  formatRoomCode,
  plural,
  type RoomAction,
  type RoomState,
} from '@selfmp3/shared'
import {
  HIT_TARGET,
  fonts,
  radius,
  roomTrackSong,
  space,
  type,
  tracking,
  iconSize,
} from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands, usePlayerPlaying } from '../../player/PlayerProvider'
import { roomTrack } from '../../player/roomTracks'
import { label, rowTitle, lineSub } from '../../ui/surfaces'
import { tip } from '../../ui/tip'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { More, Next, Plus, ToTop } from '../../ui/components/Icons'
import { PlayingCard } from '../../ui/components/PlayingCard'
import { PlayPauseButton } from '../../ui/components/PlayPauseButton'
import { ToggleRow } from '../../ui/components/Toggle'
import { RoomFace, RoomFaces } from './RoomFace'
import { RoomEntryLine } from './RoomEntryLine'
import {
  isHost,
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
import { Press } from '../../ui/components/Press'
import { SONG_ACTION_LABELS } from '../../ui/songActions.model'

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
      <RoomPlaying state={state} />
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
        <Press
          onPress={() => openRoomSheet('people')}
          accessibilityRole="button"
          accessibilityLabel="People and room options"
          {...tip('People')}
          testID="room-people"
          style={styles.round}
        >
          <More size={iconSize.medium} color={theme.colors.textPrimary} />
        </Press>
      </View>
    </View>
  )
}

/** The song playing, who brought it, and what you may do to it. */
function RoomPlaying({ state }: { state: RoomState }): ReactNode {
  const { theme } = useUnistyles()
  const commands = usePlayerCommands()
  const localPlaying = usePlayerPlaying()
  const row = playingRow(state)
  const song = row ? (roomTrack(row.trackId)?.song ?? roomTrackSong(row.entry)) : null
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
    ? row.entry.from
      ? `${row.entry.from}’s`
      : 'from a link'
    : row.owner.id === state.you
      ? 'yours'
      : `${row.owner.name}’s`
  return (
    <PlayingCard
      song={song}
      label={`${paused ? 'Paused' : 'Playing'} · ${whose}`}
      line={<RoomClock state={state} artist={artistOr(song.artist)} duration={song.duration} />}
      playing={playing}
      badge={
        row.face ? <RoomFace name={row.face.name} colour={row.face.colour} size={20} ring /> : null
      }
    >
      {mayToggle ? (
        <PlayPauseButton
          size={44}
          glyph={iconSize.nav}
          playing={playing}
          onPress={() => (host ? commands.toggle() : act({ type: playing ? 'pause' : 'play' }))}
          testID="room-toggle"
        />
      ) : null}
      {maySkip ? (
        <Press
          onPress={() => act({ type: 'skip' })}
          accessibilityRole="button"
          accessibilityLabel="Skip"
          {...tip('Skip')}
          style={styles.round}
          testID="room-skip"
        >
          <Next size={iconSize.medium} color={theme.colors.textPrimary} />
        </Press>
      ) : null}
    </PlayingCard>
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
  return `${artist} · ${formatDuration(position)}${duration > 0 ? ` of ${formatDuration(duration)}` : ''}`
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
          row={row}
          action={
            host && index > 0 ? (
              <IconButton
                label={`Play ${row.entry.song.title} next`}
                caption={SONG_ACTION_LABELS.playNext}
                filled
                onPress={() => act({ type: 'move', entryId: row.entry.id, to: 0 })}
              >
                <ToTop size={iconSize.item} color={theme.colors.textSecondary} />
              </IconButton>
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
            icon={<Plus color={theme.colors.textPrimary} />}
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
              row={row}
              dim
              action={
                youMay(state, 'again') ? (
                  <IconButton
                    label={`Play ${row.entry.song.title} again later`}
                    caption="Again"
                    filled
                    onPress={() => act({ type: 'again', entryId: row.entry.id })}
                  >
                    <Plus size={iconSize.item} color={theme.colors.textSecondary} />
                  </IconButton>
                ) : null
              }
            />
          ))}
        </>
      ) : null}

      {host ? (
        <ToggleRow
          label="Keep it going"
          hint="Near the end, adds songs from what people brought, taking turns"
          hintLines={3}
          value={state.keepGoing}
          onChange={keepGoing => act({ type: 'settings', keepGoing })}
          testID="room-keep-going"
          style={styles.keepGoing}
        />
      ) : null}
    </View>
  )
}

const EntryRow = memo(function EntryRow({
  row,
  action,
  remove = false,
  dim = false,
}: {
  row: RoomRow
  action?: ReactNode
  remove?: boolean
  dim?: boolean
}): ReactNode {
  const artFor = useArt(ROW_COVER_SIZE)
  const song = roomTrack(row.trackId)?.song ?? roomTrackSong(row.entry)
  return (
    <RoomEntryLine
      song={song}
      uri={artFor(song)}
      face={row.face}
      who={row.who}
      note={row.entry.song.link ? 'from a link' : undefined}
      trailing={action}
      onRemove={remove ? () => act({ type: 'remove', entryId: row.entry.id }) : undefined}
      dim={dim}
      testID={`room-row-${row.entry.id}`}
    />
  )
})

const styles = StyleSheet.create(theme => ({
  root: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  headText: { flex: 1, minWidth: 0, gap: space.tight },
  title: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: type.large,
    letterSpacing: tracking.heading,
  },
  people: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { flexShrink: 1, color: theme.colors.textSecondary, fontSize: type.sub },
  headButtons: { flexDirection: 'row', alignItems: 'center', gap: space.tight },
  round: {
    width: HIT_TARGET,
    height: HIT_TARGET,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface3,
  },
  empty: {
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.mini,
    backgroundColor: theme.colors.surface2,
  },
  emptyTitle: rowTitle(theme.colors),
  emptyText: lineSub(theme.colors),
  list: { gap: 2 },
  actions: { flexDirection: 'row', gap: space.sm, paddingTop: space.sm },
  label: { ...label(theme.colors), paddingBottom: space.xs },
  playedLabel: { paddingTop: space.lg },
  more: { color: theme.colors.textMuted, fontSize: type.sub, paddingVertical: space.snug },
  keepGoing: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.mini,
    backgroundColor: theme.colors.surface2,
  },
}))
