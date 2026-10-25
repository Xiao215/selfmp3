import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { artistOr, pickResumeState, type Device, type Song } from '@selfmp3/shared'
import {
  handoffTarget,
  hitSlopFor,
  iconSize,
  radius,
  serverTime,
  shortDeviceName,
  space,
  type,
  useLibrary,
} from '@selfmp3/client'
import { usePlayer } from '../../player/PlayerProvider'
import { usePlaybackMemoryState } from '../../player/usePlaybackMemory'
import { useArt } from '../../offline/useArt'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { Cover } from '../../ui/components/Cover'
import { Play, X } from '../../ui/components/Icons'
import { PlayButton } from '../../ui/components/Button'
import { Press } from '../../ui/components/Press'
import { useLayoutValue } from '../../shell/useLayout'
import { useFade } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { ART, ToastButton, ToastCard } from '../../ui/components/ToastHost'
import { useDeviceContext } from './DevicesProvider'

/** How long the offer stays as a toast before it goes by itself. */
const RESUME_TOAST_MS = 12_000

interface Offer {
  readonly device: Device
  readonly at: number
}

/*
 * The offer, once decided: one for the app, read by whichever of the two
 * draws it. A phone shows it as a toast above the tab bar; a computer as a
 * card at the foot of the sidebar (AE1), where it covers nothing.
 */
let current: Offer | null = null
const listeners = new Set<() => void>()
function setOffer(next: Offer | null): void {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const snapshot = (): Offer | null => current

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
 * goes the moment playback starts. On a phone it is drawn as a message is
 * (`ToastCard`): the song's cover, where it was playing over its title, and a
 * play button; left alone it goes after twelve seconds, with the ring round
 * its ✕ running down so that is not a surprise. On a computer the toast sat
 * over the list's columns until it went (AE1), so there it waits in the
 * sidebar instead (`ResumeCard`) until something plays or it is dismissed,
 * and this draws nothing.
 *
 * Mounted once, in the shell: this is where the offer is decided.
 */
export function ResumeToast(): ReactNode {
  const { theme } = useUnistyles()
  const { deviceId, devices, heard } = useDeviceContext()
  const player = usePlayer()
  const library = useLibrary()
  const memory = usePlaybackMemoryState()
  const wide = useLayoutValue(layout => layout.wide)
  const resume = useResumeOffer()
  const offer = useSyncExternalStore(subscribe, snapshot, snapshot)
  // Playing here is an answer.
  const playing = player.isPlaying
  useLayoutEffect(() => {
    if (playing) setOffer(null)
  }, [playing])

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

  // Only the toast runs out: the sidebar's card covers nothing, and waits.
  useEffect(() => {
    if (!offer || wide) return undefined
    const timer = setTimeout(() => setOffer(null), offer.at + RESUME_TOAST_MS - Date.now())
    return () => clearTimeout(timer)
  }, [offer, wide])

  if (!resume || !offer || wide) return null
  const { song, from } = resume
  return (
    <View style={styles.slot} pointerEvents="box-none">
      <ToastCard
        tone="info"
        words={{ over: `Continue from ${from}`, say: song.title }}
        art={<Cover uri={resume.art} title={song.title} size={ART} />}
        timed={{ since: offer.at, ms: RESUME_TOAST_MS }}
        onDismiss={resume.decline}
      >
        <ToastButton label={resume.label} tone="info" filled onPress={resume.take}>
          <Play size={16} color={theme.colors.onPrimary} />
        </ToastButton>
      </ToastCard>
    </View>
  )
}

/**
 * The offer on a computer (AE1): a small card at the foot of the sidebar,
 * above the person — the song's cover, "From Mac" over its title, and a play
 * button; the ✕ waits for the pointer, as a sidebar row's ⋯ does. Gone once
 * anything plays.
 */
export function ResumeCard(): ReactNode {
  const { theme } = useUnistyles()
  const resume = useResumeOffer()
  const finePointer = useLayoutValue(layout => layout.finePointer)
  const [hovered, setHovered] = useState(false)
  // Tabbed to, it shows as it does under the pointer.
  const [focused, setFocused] = useState(false)
  const close = useFade(!finePointer || hovered || focused, MOVE_MS.hoverIn, MOVE_MS.hoverOut)
  if (!resume) return null
  const { song, from } = resume
  return (
    <View
      style={styles.card}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      testID="sidebar-resume"
    >
      <Cover uri={resume.art} title={song.album || song.title} size={CARD_ART} />
      <View style={styles.cardWords}>
        <Text style={styles.cardFrom} numberOfLines={1}>
          From {from}
        </Text>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {song.title}
        </Text>
      </View>
      <PlayButton
        size={CARD_PLAY}
        label={resume.label}
        icon={<Play size={14} color={theme.colors.onPrimary} />}
        onPress={resume.take}
        testID="sidebar-resume-play"
      />
      <Animated.View style={[styles.close, { opacity: close }]}>
        <Press
          feedback="dim"
          onPress={resume.decline}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityRole="button"
          accessibilityLabel={`Don't continue from ${from}`}
          hitSlop={hitSlopFor(CLOSE)}
          style={styles.closeButton}
          testID="sidebar-resume-dismiss"
        >
          <X size={iconSize.tiny} tone="textSecondary" />
        </Press>
      </Animated.View>
    </View>
  )
}

/** The offer as either place draws it: the song, where it played, and what taking it does. */
function useResumeOffer(): {
  song: Song
  from: string
  art: string | null | undefined
  label: string
  take: () => void
  decline: () => void
} | null {
  const { heard } = useDeviceContext()
  const player = usePlayer()
  const library = useLibrary()
  const artFor = useArt(ROW_COVER_SIZE)
  const offer = useSyncExternalStore(subscribe, snapshot, snapshot)
  const decline = useCallback(() => setOffer(null), [])
  const candidate = offer?.device
  const song = candidate
    ? library.data?.songs.find(item => item.id === candidate.state.songId)
    : undefined
  if (!candidate || !song) return null
  const from = shortDeviceName(candidate.name)
  return {
    song,
    from,
    art: artFor(song),
    label: `Continue ${song.title} by ${artistOr(song.artist)}, from ${from}`,
    decline,
    take: () => {
      const target = heard ? handoffTarget(candidate, heard, Date.now()) : null
      setOffer(null)
      if (!target) return
      player.playFrom([...target.queueIds], target.index, {
        shuffle: candidate.state.shuffle,
        position: target.position,
        autoplay: false,
      })
    },
  }
}

/** The card's cover and play button, and the ✕ in its corner. */
const CARD_ART = 38
const CARD_PLAY = 30
const CLOSE = 20

const styles = StyleSheet.create(theme => ({
  slot: { width: '100%', alignItems: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    padding: space.snug,
    borderRadius: radius.row,
    backgroundColor: theme.colors.surface2,
    marginBottom: space.sm,
  },
  cardWords: { flex: 1, minWidth: 0, gap: 1 },
  cardFrom: { color: theme.colors.textMuted, fontSize: type.small },
  cardTitle: { color: theme.colors.textPrimary, fontSize: type.sub, fontWeight: '600' },
  close: { position: 'absolute', top: -6, right: -6 },
  closeButton: {
    width: CLOSE,
    height: CLOSE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface3,
  },
}))
