import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import type { ImportPreviewItem } from '@selfmp3/shared'
import { radius, type ServerConnection } from '@selfmp3/client'
import { mediaUrlFor } from '../../api/client'
import { usePlayer } from '../../player/PlayerProvider'
import { createListenAudio } from '../../ports/listen'
import { useConnection } from '../../connection/ConnectionProvider'
import { useAccent } from '../../ui/accent'
import { IconButton } from '../../ui/components/IconButton'
import { Pause, Play, X } from '../../ui/components/Icons'
import { SeekBar } from '../../ui/components/SeekBar'
import { isSquareCover } from './import.model'
import {
  followAudio,
  listenDetail,
  listenLabel,
  startListening,
  type Listening,
  type ListenTrack,
} from './listen.model'

/**
 * Listening to a track on the review, before it is imported: the web's
 * `ImportListen`.
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

/** The play button in a review row, drawn over the track's thumbnail. */
export function ListenButton({
  item,
  listening,
  onToggle,
}: {
  item: ImportPreviewItem
  listening: Listening | null
  onToggle: () => void
}): ReactNode {
  const status = listening?.track.url === item.url ? listening.status : null
  const square = isSquareCover(item.thumbnail)

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={listenLabel(item.title, status)}
      style={({ pressed }) => [styles.thumb, square && styles.thumbSquare, pressed && styles.thumbPressed]}
    >
      {item.thumbnail ? (
        <Image source={{ uri: item.thumbnail }} style={styles.fill} />
      ) : null}
      <View style={[styles.cover, status ? styles.coverOn : null]}>
        {status === 'loading' ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : status === 'playing' ? (
          <Pause size={14} color="#fff" />
        ) : (
          <Play size={14} color="#fff" />
        )}
      </View>
    </Pressable>
  )
}

/** What is being previewed, with a playhead to drag anywhere in it. */
export function ListenBar({
  listening,
  onToggle,
  onSeek,
  onClose,
}: {
  listening: Listening
  onToggle: () => void
  onSeek: (seconds: number) => void
  onClose: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { track, status, duration } = listening

  return (
    <View
      style={[styles.bar, { borderColor: accent.accentDim }]}
      role="region"
      aria-label="Listening before import"
      testID="listen-bar"
    >
      <IconButton onPress={onToggle} label={status === 'playing' ? 'Pause' : 'Play'}>
        {status === 'loading' ? (
          <ActivityIndicator size="small" color={accent.accent} />
        ) : status === 'playing' ? (
          <Pause size={16} color={theme.colors.textPrimary} />
        ) : (
          <Play size={16} color={theme.colors.textPrimary} />
        )}
      </IconButton>
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>
          {track.title || 'Untitled'}
        </Text>
        <Text
          style={[styles.detail, status === 'error' && { color: theme.colors.danger }]}
          numberOfLines={1}
        >
          {listenDetail(listening)}
        </Text>
      </View>
      <View style={styles.progress}>
        <SeekBar position={listening.currentTime} duration={duration} onSeek={onSeek} inline />
      </View>
      <IconButton onPress={onClose} label="Stop listening">
        <X size={15} color={theme.colors.textMuted} />
      </IconButton>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  thumb: {
    width: 56,
    height: 34,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  // Album art is square; a video's still is not. The column stays 56 wide either way.
  thumbSquare: { width: 40, height: 40, marginHorizontal: 8 },
  thumbPressed: { opacity: 0.85 },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  cover: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  coverOn: { backgroundColor: 'rgba(0,0,0,0.55)' },
  // Drawn in the list, under its song's row: tight to it, a little air below.
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
    marginBottom: 8,
    marginHorizontal: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    backgroundColor: theme.colors.surface0,
  },
  meta: { width: 180, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  detail: { color: theme.colors.textMuted, fontSize: 11, marginTop: 1 },
  progress: { flex: 1, minWidth: 0 },
}))
