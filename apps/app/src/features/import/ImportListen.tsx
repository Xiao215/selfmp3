import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  View,
  type LayoutChangeEvent,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { ImportPreviewItem } from '@selfmp3/shared'
import { radius, withAlpha, type ServerConnection } from '@selfmp3/client'
import { mediaUrlFor } from '../../api/client'
import { usePlayer } from '../../player/PlayerProvider'
import { createListenAudio } from '../../ports/listen'
import { useConnection } from '../../connection/ConnectionProvider'
import { Cover } from '../../ui/components/Cover'
import { Equalizer } from '../../ui/components/Equalizer'
import { Play } from '../../ui/components/Icons'
import {
  followAudio,
  listenLabel,
  playedRatio,
  seekAt,
  startListening,
  type Listening,
  type ListenTrack,
} from './listen.model'

/**
 * Listening to a track on the review, before it is imported.
 *
 * Whatever was playing pauses while you listen and carries on when the preview
 * is closed, unless you went back to it yourself in the meantime, which the
 * preview makes way for.
 */
export function useListen(via?: ServerConnection) {
  const player = usePlayer()
  const { connection: own } = useConnection()
  // A cloud library previews through the server it reached (ImportViaServer), not
  // through whatever address this device happens to have stored.
  const connection = via ?? own
  const [audio] = useState(() => createListenAudio())
  const [listening, setListening] = useState<Listening | null>(null)
  /** Something was playing when previewing began; it carries on when the preview closes. */
  const resume = useRef(false)

  useEffect(() => {
    if (!audio) return
    const unsubscribe = audio.subscribe(state =>
      setListening(current => (current ? followAudio(current, state) : current)),
    )
    return () => {
      unsubscribe()
      audio.dispose()
    }
  }, [audio])

  // Pressing play on the song itself ends the interlude.
  const wasPlaying = useRef(player.isPlaying)
  useEffect(() => {
    if (player.isPlaying && !wasPlaying.current) {
      audio?.pause()
      resume.current = false
    }
    wasPlaying.current = player.isPlaying
  }, [audio, player.isPlaying])

  const makeRoom = (): void => {
    if (!player.isPlaying) return
    resume.current = true
    player.toggle()
  }

  /** Play a track, or pause and resume the one already loaded. */
  const toggle = (track: ListenTrack): void => {
    if (!audio || !connection) return
    if (listening?.track.url === track.url) {
      if (listening.status === 'playing' || listening.status === 'loading') {
        audio.pause()
      } else {
        makeRoom()
        audio.resume()
      }
      return
    }
    makeRoom()
    setListening(startListening(track))
    audio.play(mediaUrlFor(connection).importListen(track.url))
  }

  const seek = (seconds: number): void => {
    if (!audio || !listening) return
    audio.seek(seconds)
    setListening({ ...listening, currentTime: seconds })
  }

  /**
   * Stop the preview. What was playing before it carries on when you close
   * the preview yourself; not when the review went — imported, cancelled, a
   * new link fetched — since then nothing asked for music.
   */
  const close = (options: { resume?: boolean } = {}): void => {
    audio?.stop()
    setListening(null)
    const carryOn = resume.current && (options.resume ?? true)
    resume.current = false
    if (carryOn && !player.isPlaying) player.toggle()
  }

  return { listening, toggle, seek, close }
}

/**
 * A review row's cover, which is also its play button (`C14`). Under the
 * pointer the cover dims a little and a plain play glyph sits on it, no chip
 * and no wash. While it plays, the library's own mark for a playing song, the
 * equaliser, sits there in the accent instead; paused, the glyph is back and
 * stays, so the row you were hearing is still the one with a glyph on it.
 * `shown` is whether the glyph is drawn when nothing is playing — under the
 * pointer, or always where there is no pointer to wait for. The button is
 * there either way, so a keyboard reaches it.
 */
export function ListenCover({
  item,
  listening,
  onPress,
  shown,
  size = 40,
  label,
}: {
  item: Pick<ImportPreviewItem, 'title' | 'thumbnail'>
  /** This row's preview, when it is the one playing; null otherwise. */
  listening: Listening | null
  onPress: () => void
  shown: boolean
  size?: number
  /** What the button says, when it does something other than play: "Close 群青". */
  label?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const status = listening?.status ?? null
  const on = status !== null
  const glyph = size >= 56 ? 22 : 18
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? listenLabel(item.title, status)}
      style={({ pressed }) => [
        styles.cover,
        { width: size, height: size },
        pressed && styles.pressed,
      ]}
    >
      <Cover uri={item.thumbnail} title={item.title} size={size} />
      <View pointerEvents="none" style={[styles.over, !on && !shown && styles.hidden]}>
        {status === 'loading' ? (
          <ActivityIndicator size="small" color={theme.colors.textPrimary} />
        ) : status === 'playing' ? (
          <Equalizer size={glyph - 2} />
        ) : (
          <Play size={glyph} tone="textPrimary" />
        )}
      </View>
    </Pressable>
  )
}

/** How thick the track is, and how wide the knob that rides it. */
const TRACK = 4
const KNOB = 14

/**
 * The seek bar of a song not yet imported: a thin track filled in the accent
 * to where the song is, with a round knob to drag.
 *
 * A plain bar, not a waveform: the audio is not downloaded yet, so there are
 * no peaks to draw, and a made-up shape only pretended to be one. Hand-built
 * on PanResponder for the reason `SeekBar` is: it keeps showing the dragged
 * place while the finger is down instead of fighting the audio's own reports
 * of where it is. `height` is the hit area, taller than the track it holds.
 */
export function ListenBar({
  position,
  duration,
  onSeek,
  height = 34,
}: {
  position: number
  duration: number
  onSeek: (seconds: number) => void
  height?: number
}): ReactNode {
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState<number | null>(null)

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // A drag along the bar that wanders is still a drag, not the list's scroll.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: event =>
          setDragging(seekAt(event.nativeEvent.locationX, width, duration)),
        onPanResponderMove: event =>
          setDragging(seekAt(event.nativeEvent.locationX, width, duration)),
        onPanResponderRelease: event => {
          setDragging(null)
          onSeek(seekAt(event.nativeEvent.locationX, width, duration))
        },
        onPanResponderTerminate: () => setDragging(null),
      }),
    // Made afresh as the preview ticks, which a drag survives: every handler
    // reads only where the finger is along the bar, never how far it has come.
    [width, duration, onSeek],
  )

  const shown = dragging ?? position
  const ratio = playedRatio(shown, duration)

  return (
    <View
      style={[styles.bar, { height }]}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
      accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shown) }}
      // As SeekBar does: react-native-web drops `accessibilityValue` from a slider.
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(shown)}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={event => {
        const step = event.nativeEvent.actionName === 'increment' ? 10 : -10
        onSeek(Math.max(0, Math.min(duration, position + step)))
      }}
      testID="listen-bar"
      {...responder.panHandlers}
    >
      {/* Draws only: every touch belongs to the bar, so locationX is always along it. */}
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.played, { width: `${ratio * 100}%` }]} />
      </View>
      <View
        pointerEvents="none"
        style={[styles.knob, { left: width * ratio - KNOB / 2 }, dragging !== null && styles.held]}
      />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  cover: { borderRadius: radius.coverSm, overflow: 'hidden' },
  pressed: { opacity: 0.85 },
  over: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    // The cover dims just enough for a glyph to read on it, whatever the art.
    backgroundColor: withAlpha(theme.colors.surface0, 0.55),
  },
  hidden: { opacity: 0 },
  // A pointing hand where there is a mouse: the bar is a control, not a picture.
  bar: { justifyContent: 'center', alignSelf: 'stretch', cursor: 'pointer' },
  track: {
    height: TRACK,
    borderRadius: TRACK / 2,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceSelected,
  },
  played: { height: '100%', backgroundColor: theme.colors.accent },
  // The knob rides the track, with a soft ring to find it by; it grows a little under a drag.
  knob: {
    position: 'absolute',
    top: '50%',
    marginTop: -KNOB / 2,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: theme.colors.textPrimary,
    boxShadow: `0 0 0 4px ${withAlpha(theme.colors.textPrimary, 0.18)}`,
  },
  held: { transform: [{ scale: 1.15 }] },
}))
