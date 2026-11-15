import { oklchToHex, roomFace } from '@selfmp3/client'
import { formatRoomCode, roomTitle, type RoomState } from '@selfmp3/shared'
import { initialOf, isHost, peopleHere, playingRow } from './room.model'

/**
 * The room on the Lock Screen and in the Dynamic Island (an iPhone's Live
 * Activity): who is in it, and what is playing.
 *
 * Shaped as the Live Activity's Swift types are (`RoomActivityAttributes` in
 * modules/room-activity and targets/widget): plain values, colours as hex,
 * times in seconds on this device's clock, so the system can move the
 * progress bar by itself and the app sends something only when there is news.
 */

/** What stays the same for the life of one room: the attributes. */
interface RoomActivityHead {
  /** Which room, so a new one replaces the old one rather than updating it. */
  readonly code: string
  /** "Xiao's room". */
  readonly title: string
  /** "KQ7 482", as the room's sheet shows it. */
  readonly codeLine: string
}

/** A face in the row: their letter on their colour, as the room's sheet draws it. */
interface RoomActivityFace {
  readonly letter: string
  readonly fill: string
  readonly ink: string
}

/** What changes as the room goes on: the content state. */
interface RoomActivityState {
  readonly title: string
  readonly artist: string
  /** "Mia added it", "You added it"; '' with nothing playing. */
  readonly by: string
  readonly playing: boolean
  /** When its first second played, on this device's clock, in seconds since 1970. */
  readonly startedAt: number
  /** Seconds; 0 when it is not known. */
  readonly duration: number
  /** Seconds in, while paused. */
  readonly position: number
  /** How many are in the room, you included. */
  readonly here: number
  /** Up to three faces, everyone else before you, the host first. */
  readonly faces: readonly RoomActivityFace[]
  /** The cover's colour, for a song whose picture this device does not have. */
  readonly tone: string
  /** A line in place of the song's, when the room has something to say. */
  readonly status: string
}

export interface RoomActivity {
  readonly head: RoomActivityHead
  readonly state: RoomActivityState
  /** The cover as a file on this device, for the module to make small; null for none. */
  readonly cover: string | null
}

/** As many faces as the Dynamic Island has room for beside the song. */
const FACES = 3

/** The cover's tone when the song has none: the app's own card. */
const NO_TONE = '#2a2d36'

/** How far the start of a song may move before the Lock Screen is told: the clock's own jitter. */
const START_SLACK_SECONDS = 1.5

/**
 * The Live Activity for the room this device is in, or null when it is in none.
 *
 * `offset` is the doorman's clock minus this device's, as the room store keeps
 * it; `coverOf` finds the playing song's cover as a file here, or null.
 */
export function roomActivity(input: {
  readonly state: RoomState | null
  readonly offset: number
  readonly link: 'connecting' | 'live' | 'offline'
  readonly coverOf: (state: RoomState) => string | null
}): RoomActivity | null {
  const { state, offset, link } = input
  if (!state || state.endedAt !== null) return null

  const people = peopleHere(state)
  // Everyone else first: your own face is the one you know is here.
  const others = people.filter(member => member.id !== state.you)
  const you = people.filter(member => member.id === state.you)
  const faces = [...others, ...you].slice(0, FACES).map(member => {
    const face = roomFace(member.colour, 'dark')
    return { letter: initialOf(member.name), fill: face.fill, ink: face.ink }
  })

  const row = playingRow(state)
  const song = row?.entry.song
  const playing = state.playing
  const tone = song?.coverTone
  const status =
    link !== 'live'
      ? 'Reconnecting…'
      : !song
        ? isHost(state)
          ? 'Nothing playing. Add songs to start.'
          : 'Nothing playing yet'
        : ''

  return {
    head: { code: state.code, title: roomTitle(state), codeLine: formatRoomCode(state.code) },
    state: {
      title: song?.title ?? roomTitle(state),
      artist: song?.artist ?? '',
      // A shared playlist's song is its owner's, who may not be here to have added it.
      by: !row ? '' : row.entry.from ? `From ${row.who}` : `${row.who} added it`,
      playing: playing !== null && playing.pausedAt === null,
      startedAt: playing ? (playing.startedAt - offset) / 1000 : 0,
      duration: song?.duration ?? 0,
      position: playing?.pausedAt ?? 0,
      here: people.length,
      faces,
      tone: tone ? oklchToHex(0.45, Math.min(tone.chroma, 0.12), tone.hue) : NO_TONE,
      status,
    },
    cover: song ? input.coverOf(state) : null,
  }
}

/**
 * Whether the Lock Screen needs telling: another room, another song or
 * state, someone came or went, or the song's start moved by more than the
 * clock's jitter (a seek). The playhead itself is never news: the system
 * moves the bar from `startedAt`.
 */
export function activityChanged(sent: RoomActivity | null, next: RoomActivity | null): boolean {
  if (sent === null || next === null) return sent !== next
  if (sent.head.code !== next.head.code || sent.cover !== next.cover) return true
  const { startedAt: was, ...before } = sent.state
  const { startedAt: now, ...after } = next.state
  if (Math.abs(was - now) > START_SLACK_SECONDS) return true
  return JSON.stringify(before) !== JSON.stringify(after)
}
