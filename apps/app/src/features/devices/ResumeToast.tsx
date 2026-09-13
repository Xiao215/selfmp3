import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { pickResumeState, type Device } from '@selfmp3/shared'
import { colors, handoffTarget, shortDeviceName, useLibrary } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { IconButton } from '../../ui/components/IconButton'
import { X } from '../../ui/components/Icons'
import { useDeviceContext } from './DevicesProvider'

/**
 * "Continue where you left off on your phone": the web's `ResumeToast`.
 *
 * Offered once per launch, and only when it tells you something: nothing is
 * playing here, and the freshest state elsewhere is a song this device does
 * not already have loaded. Taking it loads that song **paused** — starting
 * audio on its own is what every music app gets shouted at for.
 */
export function ResumeToast(): ReactNode {
  const { deviceId, devices } = useDeviceContext()
  const player = usePlayer()
  const library = useLibrary()
  const accent = useAccent()
  const { finePointer } = useLayout()
  const [candidate, setCandidate] = useState<Device | null>(null)
  const [hovered, setHovered] = useState(false)

  // A launch-time decision: re-deciding as devices come and go would pop a
  // toast up an hour into a session.
  const decided = useRef(false)
  const playerRef = useRef(player)
  useEffect(() => {
    playerRef.current = player
  }, [player])

  useEffect(() => {
    if (decided.current || devices.length === 0 || !library.data) return undefined
    decided.current = true
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
  }, [devices, library.data, deviceId])

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
      <IconButton onPress={() => setCandidate(null)} label="Dismiss" size={finePointer ? 32 : 40}>
        <X size={15} color={colors.textMuted} />
      </IconButton>
    </View>
  )
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 460,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 7,
    borderRadius: 999,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
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
  mainHovered: { backgroundColor: colors.surface3 },
  label: { fontSize: 13, fontWeight: '600' },
  song: { color: colors.textPrimary, fontSize: 13, flexShrink: 1 },
  from: { color: colors.textMuted, fontSize: 11 },
})
