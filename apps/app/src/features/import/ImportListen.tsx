import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import {
  formatDuration,
  type CoverTone,
  type ImportCoverTone,
  type ImportPreviewItem,
} from '@selfmp3/shared'
import { radius, withAlpha, type ServerConnection } from '@selfmp3/client'
import { mediaUrlFor } from '../../api/client'
import { usePlayerCommands, usePlayerPlaying } from '../../player/PlayerProvider'
import { createValueStore } from '../../state/valueStore.model'
import { createListenAudio } from '../../ports/listen'
import { useConnection } from '../../connection/ConnectionProvider'
import { Cover } from '../../ui/components/Cover'
import { useToneColors } from '../../ui/useSongColor'
import { Scrubber } from '../../ui/components/Scrubber'
import { SEEK_STEP_SECONDS } from '../../player/progress.model'
import { Equalizer } from '../../ui/components/Equalizer'
import { Play } from '../../ui/components/Icons'
import {
  followAudio,
  listenLabel,
  startListening,
  type Listening,
  type ListenTrack,
} from './listen.model'
import { Press } from '../../ui/components/Press'
import { Spinner } from '../../ui/components/Spinner'
import { listenSource } from './deviceImports'

/** The colour of each cover the server has read this session, by the cover's address. */
const tonesByCover = new Map<string, CoverTone | null>()

/**
 * Listening to a track on the review, before it is imported.
 *
 * Whatever was playing pauses while you listen and carries on when the preview
 * is closed, unless you went back to it yourself in the meantime, which the
 * preview makes way for.
 *
 * The row that plays is drawn in its cover's colour, as the library's playing
 * row is. The server reads it (`api.importCoverTone`) when the song starts,
 * since a phone cannot read a picture's pixels, and the answer is kept for
 * the session so a song played twice is asked about once.
 *
 * `toggle`, `seek` and `close` keep their identity from render to render: the
 * review's rows are memoised, and a new function each tick would redraw every
 * row of a long playlist four times a second. For the same reason where the
 * song is, which moves at each of those ticks, is not part of `listening`: it
 * is `position`, which only the bar and its times read (`useValueStore`).
 */
export function useListen(
  via: ServerConnection | undefined,
  api: { importCoverTone: (url: string) => Promise<ImportCoverTone> },
) {
  const player = usePlayerCommands()
  const playerPlaying = usePlayerPlaying()
  const { connection: own } = useConnection()
  // A cloud library previews through the server it reached (ImportViaServer).
  const connection = via ?? own
  const [audio] = useState(() => createListenAudio())
  const [listening, setListening] = useState<Listening | null>(null)
  const [position] = useState(() => createValueStore(0))
  /** Something was playing when previewing began; it carries on when the preview closes. */
  const resume = useRef(false)
  /** The song last asked to play: where its audio comes from may take a moment to know. */
  const wanted = useRef<string | null>(null)
  /**
   * This device's download of the song asked for, still on its way: nothing
   * is loaded to pause yet, so a tap meanwhile is kept here — and the song,
   * once it comes, waits for the next tap rather than starting by itself.
   */
  const pending = useRef<{ url: string; paused: boolean; source: string | null } | null>(null)

  /** Ask the server what colour the track's cover is, and colour the preview in once it says. */
  const colourIn = (track: ListenTrack): void => {
    const cover = track.thumbnail
    if (!cover || tonesByCover.has(cover)) return
    api.importCoverTone(cover).then(
      ({ tone }) => {
        tonesByCover.set(cover, tone)
        setListening(current =>
          current && current.track.url === track.url ? { ...current, tone } : current,
        )
      },
      // No colour is the accent, which the row already wears.
      () => undefined,
    )
  }

  useEffect(() => {
    if (!audio) return
    const unsubscribe = audio.subscribe(state => {
      // While this device's download is on its way nothing of it is loaded:
      // what the player says is of the song before, or of stopping it.
      if (pending.current) return
      position.set(state.currentTime)
      setListening(current => (current ? followAudio(current, state) : current))
    })
    return () => {
      unsubscribe()
      audio.dispose()
    }
  }, [audio, position])

  // Pressing play on the song itself ends the interlude.
  const wasPlaying = useRef(playerPlaying)
  useEffect(() => {
    if (playerPlaying && !wasPlaying.current) {
      audio?.pause()
      resume.current = false
    }
    wasPlaying.current = playerPlaying
  }, [audio, playerPlaying])

  const makeRoom = (): void => {
    if (!playerPlaying) return
    resume.current = true
    player.toggle()
  }

  /** Play a track, or pause and resume the one already loaded. */
  const toggle = (track: ListenTrack): void => {
    if (!audio || !connection) return
    const waiting = pending.current
    if (listening?.track.url === track.url && waiting?.url === track.url) {
      if (waiting.paused && waiting.source) {
        // It came while paused: this tap is the one that plays it.
        pending.current = null
        makeRoom()
        audio.play(waiting.source)
        return
      }
      waiting.paused = !waiting.paused
      setListening(current =>
        current ? { ...current, status: waiting.paused ? 'paused' : 'loading' } : current,
      )
      return
    }
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
    position.set(0)
    setListening(startListening(track, tonesByCover.get(track.thumbnail ?? '') ?? null))
    // From this device's own download where it can make one (deviceImports.ts),
    // so the song heard is the song imported without asking YouTube again.
    wanted.current = track.url
    const server = mediaUrlFor(connection)
    const source = listenSource(track.url, () => server.importListen(track.url))
    if (typeof source === 'string') {
      pending.current = null
      audio.play(source)
    } else {
      const coming = { url: track.url, paused: false, source: null as string | null }
      pending.current = coming
      // The song previewing before is not heard over the wait for this one.
      audio.stop()
      void source.then(own => {
        if (wanted.current !== track.url || pending.current !== coming) return
        if (coming.paused) {
          coming.source = own
          return
        }
        pending.current = null
        audio.play(own)
      })
    }
    colourIn(track)
  }

  const seek = (seconds: number): void => {
    if (!audio || !listening) return
    audio.seek(seconds)
    position.set(seconds)
  }

  /**
   * Stop the preview. What was playing before it carries on when you close
   * the preview yourself; not when the review went — imported, cancelled, a
   * new link fetched — since then nothing asked for music.
   */
  const close = (options: { resume?: boolean } = {}): void => {
    wanted.current = null
    pending.current = null
    audio?.stop()
    setListening(null)
    position.set(0)
    const carryOn = resume.current && (options.resume ?? true)
    resume.current = false
    if (carryOn && !playerPlaying) player.toggle()
  }

  const latest = useRef({ toggle, seek, close })
  useEffect(() => {
    latest.current = { toggle, seek, close }
  })
  const steady = useMemo(
    () => ({
      toggle: (track: ListenTrack) => latest.current.toggle(track),
      seek: (seconds: number) => latest.current.seek(seconds),
      close: (options?: { resume?: boolean }) => latest.current.close(options),
    }),
    [],
  )

  return { listening, position, ...steady }
}

/**
 * A review row's cover, which is also its play button (`C14`). Under the
 * pointer the cover dims a little and a plain play glyph sits on it, no chip
 * and no wash. While it plays, the library's own mark for a playing song, the
 * equaliser, sits there in the cover's own colour instead, as the library's
 * playing row wears it; paused, the glyph is back and stays, so the row you
 * were hearing is still the one with a glyph on it.
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
  const status = listening?.status ?? null
  const on = status !== null
  const glyph = size >= 56 ? 22 : 18
  const colors = useToneColors(listening?.tone ?? null)
  return (
    <Press
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label ?? listenLabel(item.title, status)}
      style={[styles.cover, { width: size, height: size }]}
    >
      <Cover uri={item.thumbnail} title={item.title} size={size} />
      <View pointerEvents="none" style={[styles.over, !on && !shown && styles.hidden]}>
        {status === 'loading' ? (
          <Spinner tone="textPrimary" />
        ) : status === 'playing' ? (
          <Equalizer size={glyph - 2} color={colors.tint} />
        ) : (
          <Play size={glyph} tone="textPrimary" />
        )}
      </View>
    </Press>
  )
}

/**
 * The seek bar of a song not yet imported: a thin track filled to where the
 * song is in its cover's colour — the accent until that is known — with a
 * round thumb to drag. Let go, it holds where it was left while the preview
 * still reports the old place, as the song's own bar does (`Scrubber`).
 *
 * A plain bar, not a waveform: the audio is not downloaded yet, so there are
 * no peaks to draw, and a made-up shape only pretended to be one. `height` is
 * the hit area, taller than the track it holds.
 */
export function ListenBar({
  position,
  duration,
  onSeek,
  color,
  height = 34,
}: {
  position: number
  duration: number
  onSeek: (seconds: number) => void
  /** What the played part is filled in; the accent when not given. */
  color?: string
  height?: number
}): ReactNode {
  return (
    <Scrubber
      value={position}
      max={duration}
      onCommit={onSeek}
      hold
      label="Seek"
      step={SEEK_STEP_SECONDS}
      valueText={at => `${formatDuration(at)} of ${formatDuration(duration)}`}
      color={color}
      testID="listen-bar"
      style={[styles.bar, { height }]}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  cover: { borderRadius: radius.coverSm, overflow: 'hidden' },
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
  // The row's width, and no room above and below the track but the hit height's.
  bar: { alignSelf: 'stretch', paddingVertical: 0 },
}))
