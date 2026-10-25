import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { artistOr, pickResumeState, type Device } from '@selfmp3/shared'
import { handoffTarget, serverTime, shortDeviceName, useLibrary } from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { usePlaybackMemoryState } from '../../player/usePlaybackMemory'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { Cover } from '../../ui/components/Cover'
import { Play } from '../../ui/components/Icons'
import { ART, ToastButton, ToastCard } from '../../ui/components/ToastHost'
import { useDeviceContext } from './DevicesProvider'

/** How long the offer stays before it goes by itself. */
const RESUME_TOAST_MS = 12_000

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
 * with the ring round its ✕ running down so that is not a surprise. It is
 * drawn as a message is (`ToastCard`): the song's cover, where it was playing
 * over its title, and a play button.
 */
export function ResumeToast(): ReactNode {
  const { theme } = useUnistyles()
  const { deviceId, devices, heard } = useDeviceContext()
  const player = usePlayer()
  const library = useLibrary()
  const artFor = useArt(ROW_COVER_SIZE)
  const memory = usePlaybackMemoryState()
  const [offer, setOffer] = useState<{ device: Device; at: number } | null>(null)
  // Playing here is an answer. Adjusted during render, so it never draws a
  // frame beside the song that just started.
  if (offer && player.isPlaying) setOffer(null)

  // A launch-time decision: re-deciding as devices come and go would pop a
  // toast up an hour into a session.
  const decided = useRef(false)
  const playerRef = useRef(player)
  useEffect(() => {
    playerRef.current = player
  }, [player])

  useEffect(() => {
    // After this device's own coming back has settled, never before: see `PlaybackMemory`.
    if (decided.current || !heard || devices.length === 0 || !library.data || !memory.settled) {
      return undefined
    }
    // This device came back to its own last song. Offering another device's
    // on top of it asks the person to choose between two things they did not ask for.
    if (memory.restoredSongId !== null) {
      decided.current = true
      return undefined
    }
    const songs = library.data.songs
    // Decided inside the timer, not before it: a new device list or library
    // arriving in between clears this timer, and the next run must still be
    // allowed to make the decision.
    const timer = setTimeout(() => {
      decided.current = true
      const now = playerRef.current
      if (now.isPlaying) return
      // Ages are `lastSeenAt`, the server's clock, so "now" is too.
      const picked = pickResumeState(devices, {
        thisDeviceId: deviceId,
        now: serverTime(heard, Date.now()),
      })
      if (!picked) return
      if (picked.state.songId === (now.current?.id ?? null)) return
      if (!songs.some(song => song.id === picked.state.songId)) return
      setOffer({ device: picked, at: Date.now() })
    }, 0)
    return () => clearTimeout(timer)
  }, [devices, heard, library.data, deviceId, memory])

  useEffect(() => {
    if (!offer) return undefined
    const timer = setTimeout(() => setOffer(null), RESUME_TOAST_MS)
    return () => clearTimeout(timer)
  }, [offer])

  const decline = useCallback(() => setOffer(null), [])

  const candidate = offer?.device
  const song = candidate
    ? library.data?.songs.find(item => item.id === candidate.state.songId)
    : undefined
  if (!offer || !candidate || !song) return null

  const from = shortDeviceName(candidate.name)
  return (
    <View style={styles.slot} pointerEvents="box-none">
      <ToastCard
        tone="info"
        words={{ over: `Continue from ${from}`, say: song.title }}
        art={<Cover uri={artFor(song)} title={song.title} size={ART} />}
        timed={{ since: offer.at, ms: RESUME_TOAST_MS }}
        onDismiss={decline}
      >
        <ToastButton
          label={`Continue ${song.title} by ${artistOr(song.artist)}, from ${from}`}
          filled
          onPress={() => {
            const target = heard ? handoffTarget(candidate, heard, Date.now()) : null
            setOffer(null)
            if (!target) return
            player.playFrom([...target.queueIds], target.index, {
              shuffle: candidate.state.shuffle,
              position: target.position,
              autoplay: false,
            })
          }}
        >
          <Play size={16} color={theme.colors.onPrimary} />
        </ToastButton>
      </ToastCard>
    </View>
  )
}

const styles = StyleSheet.create({
  slot: { width: '100%', alignItems: 'center' },
})
