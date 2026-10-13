import type { ReactNode } from 'react'
import { useUnistyles } from 'react-native-unistyles'
import {
  usePlayerCommands,
  usePlayerPlaying,
  usePlayerStalled,
  usePlayingSongId,
} from '../../player/PlayerProvider'
import { PlayButton } from './Button'
import { IconButton } from './IconButton'
import { PlayPauseIcon } from './PlayPauseIcon'

/**
 * Play and pause for the player: the one button every place that plays or
 * pauses the song draws — the player bar, the mini player, Now Playing's two
 * views, a song's page, Up next's card and a room's.
 *
 * It reads whether the player is playing and whether it is waiting on the
 * network (`usePlayerStalled`) itself, so no caller can forget the stall
 * spinner: "One play button everywhere" (0eee99e5) wired it into three of
 * them by hand and left the rest showing a pause glyph over silence. Its own
 * component, too, so the pair of events a stall is — a few times a song on a
 * bad link — redraws this button and not the page around it.
 *
 * The round white Play (`S2`) by default; `bare` is an icon button for a
 * card's row of icons (the mini player).
 */
export function PlayPauseButton({
  size = 56,
  glyph = Math.round(size * 0.43),
  bare = false,
  songId,
  playing: given,
  onPress,
  playLabel = 'Play',
  disabled = false,
  testID,
}: {
  /** The round button's side; a bare one takes `IconButton`'s. */
  size?: number
  /** The glyph's size. */
  glyph?: number
  bare?: boolean
  /**
   * A song's own Play (its page): playing or paused only while that song is
   * the one loaded, and waiting only for it. `onPress` then decides what a
   * press on another song does.
   */
  songId?: number
  /** Whose play state it shows, when it is not this player's: a friend's room. */
  playing?: boolean
  /** What a press does; the player's own play and pause when left out. */
  onPress?: () => void
  /** What a screen reader says for Play: "Play Nocturne". Pause is always "Pause". */
  playLabel?: string
  disabled?: boolean
  /** The id, or one for each state: a flow reads which it is from the id (the mini player). */
  testID?: string | ((playing: boolean) => string)
}): ReactNode {
  const { theme } = useUnistyles()
  const player = usePlayerCommands()
  const playerPlaying = usePlayerPlaying()
  const loaded = usePlayingSongId()
  const stalled = usePlayerStalled()
  const ours = songId === undefined || loaded === songId
  const playing = given ?? (ours && playerPlaying)
  // Waiting on the track only means something for the song this player has.
  const busy = ours && stalled
  const label = playing ? 'Pause' : playLabel
  const id = typeof testID === 'function' ? testID(playing) : testID
  const press = onPress ?? player.toggle

  if (bare) {
    return (
      <IconButton testID={id} onPress={press} label={label} disabled={disabled}>
        <PlayPauseIcon
          playing={playing}
          busy={busy}
          size={glyph}
          color={theme.colors.textPrimary}
        />
      </IconButton>
    )
  }
  return (
    <PlayButton
      testID={id}
      label={label}
      size={size}
      onPress={press}
      disabled={disabled}
      busy={busy}
      icon={
        // Streaming, the first second is silence, and a pause glyph through it
        // reads as "already playing" — so the button says it is working.
        <PlayPauseIcon playing={playing} busy={busy} size={glyph} color={theme.colors.onPrimary} />
      }
    />
  )
}
