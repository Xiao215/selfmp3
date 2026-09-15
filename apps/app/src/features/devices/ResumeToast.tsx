import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { Circle, Svg } from 'react-native-svg'
import { pickResumeState, type Device } from '@selfmp3/shared'
import { handoffTarget, shortDeviceName, useLibrary } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { usePlaybackMemoryState } from '../../player/usePlaybackMemory'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { IconButton } from '../../ui/components/IconButton'
import { X } from '../../ui/components/Icons'
import { useDeviceContext } from './DevicesProvider'

/** How long the offer stays before it goes by itself. */
export const RESUME_TOAST_MS = 12_000

/**
 * "Continue where you left off on your phone".
 *
 * Offered once per launch, and only when it tells you something: nothing is
 * playing here, this device did not come back to a song of its own, and the
 * freshest state elsewhere is a song this device does not already have
 * loaded. Taking it loads that song **paused** — starting audio on its own is
 * what every music app gets shouted at for.
 *
 * It does not outstay the question. Playing anything here answers it, so it
 * goes the moment playback starts; left alone it goes after twelve seconds,
 * with a thin ring around its ✕ running down so that is not a surprise.
 */
export function ResumeToast(): ReactNode {
  const { theme } = useUnistyles()
  const { deviceId, devices } = useDeviceContext()
  const player = usePlayer()
  const library = useLibrary()
  const accent = useAccent()
  const { finePointer } = useLayout()
  const memory = usePlaybackMemoryState()
  const [candidate, setCandidate] = useState<Device | null>(null)
  const [hovered, setHovered] = useState(false)
  // Playing here is an answer. Adjusted during render, so it never draws a
  // frame beside the song that just started.
  if (candidate && player.isPlaying) setCandidate(null)

  // A launch-time decision: re-deciding as devices come and go would pop a
  // toast up an hour into a session.
  const decided = useRef(false)
  const playerRef = useRef(player)
  useEffect(() => {
    playerRef.current = player
  }, [player])

  useEffect(() => {
    // After this device's own coming back has settled, never before: see `PlaybackMemory`.
    if (decided.current || devices.length === 0 || !library.data || !memory.settled) {
      return undefined
    }
    decided.current = true
    // This device came back to its own last song. Offering another device's
    // on top of it asks the person to choose between two things they did not ask for.
    if (memory.restoredSongId !== null) return undefined
    const songs = library.data.songs
    const timer = setTimeout(() => {
      const now = playerRef.current
      if (now.isPlaying) return
      const picked = pickResumeState(devices, { thisDeviceId: deviceId, now: Date.now() })
      if (!picked) return
      if (picked.state.songId === (now.current?.id ?? null)) return
      if (!songs.some(song => song.id === picked.state.songId)) return
      setCandidate(picked)
    }, 0)
    return () => clearTimeout(timer)
  }, [devices, library.data, deviceId, memory])

  useEffect(() => {
    if (!candidate) return undefined
    const timer = setTimeout(() => setCandidate(null), RESUME_TOAST_MS)
    return () => clearTimeout(timer)
  }, [candidate])

  const song = candidate
    ? library.data?.songs.find(item => item.id === candidate.state.songId)
    : undefined
  if (!candidate || !song) return null

  return (
    <View style={styles.toast} role="status">
      <Pressable
        onPress={() => {
          const target = handoffTarget(candidate.state, Date.now())
          setCandidate(null)
          if (!target) return
          player.playFrom(
            [...target.queueIds],
            target.index,
            candidate.state.shuffle,
            target.position,
            false,
          )
        }}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        style={[styles.main, !finePointer && styles.mainTouch, hovered && styles.mainHovered]}
      >
        <Text style={[styles.label, { color: accent.accent }]}>Continue</Text>
        <Text style={styles.song} numberOfLines={1}>
          {song.title} — {song.artist || 'Unknown artist'}
        </Text>
        <Text style={styles.from} numberOfLines={1}>
          from {shortDeviceName(candidate.name)}
        </Text>
      </Pressable>
      <View>
        <IconButton onPress={() => setCandidate(null)} label="Dismiss" size={finePointer ? 32 : 40}>
          <X size={15} color={theme.colors.textMuted} />
        </IconButton>
        <CountdownRing size={finePointer ? 32 : 40} color={theme.colors.textMuted} />
      </View>
    </View>
  )
}

/**
 * The time the offer has left, as a ring around its ✕ that empties clockwise.
 * Mounted with the offer, so its clock starts when the toast appears.
 */
function CountdownRing({ size, color }: { size: number; color: string }): ReactNode {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    // A quarter of a second is smooth enough for a ring this thin.
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  const left = Math.max(0, 1 - (now - startedAt) / RESUME_TOAST_MS)
  const radius = size / 2 - 2
  const circumference = 2 * Math.PI * radius
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeOpacity={0.55}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - left)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 460,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 7,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    minWidth: 0,
    flexShrink: 1,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  mainTouch: { paddingVertical: 10 },
  mainHovered: { backgroundColor: theme.colors.surface3 },
  label: { fontSize: 13, fontWeight: '600' },
  song: { color: theme.colors.textPrimary, fontSize: 13, flexShrink: 1 },
  from: { color: theme.colors.textMuted, fontSize: 11 },
}))
