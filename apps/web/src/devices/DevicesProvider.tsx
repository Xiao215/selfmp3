import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  DEVICE_HEARTBEAT_MS,
  playbackStateChanged,
  type Device,
  type DeviceCommand,
  type PlaybackState,
  type ServerEvent,
} from '@selfmp3/shared'
import { api } from '../lib/api.js'
import { queryKeys, useDevices } from '../lib/queries.js'
import { detectDevice, getDeviceId, getDeviceName, setDeviceName } from '../lib/device.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { useServerEvents } from './useServerEvents.js'
import { useRemoteCommands } from './useRemoteCommands.js'
import { handoffTarget } from './handoff.js'

/**
 * Presence, handoff and remote control, as one context.
 *
 * It lives *inside* `PlayerProvider` rather than around it, which is what
 * keeps the player untouched by any of this: the provider reads the player
 * through `usePlayer()` to build heartbeats, and calls back into it to
 * execute commands. The player itself has no idea other devices exist.
 *
 * Two things flow in opposite directions here and it is worth being clear
 * about which is which. *Out*: a heartbeat, sent on a timer and immediately
 * whenever the local playback state materially changes. *In*: server events —
 * the device list (which is written straight into the query cache, so the
 * polling fallback and the stream share one source of truth) and commands
 * addressed to this device.
 */

interface DevicesContextValue {
  readonly deviceId: string
  readonly name: string
  readonly rename: (name: string) => void

  /** Everything the server knows about, this device included. */
  readonly devices: readonly Device[]
  /** Online devices other than this one — what the popover lists. */
  readonly others: readonly Device[]
  /** True while the event stream is up; false means the app is polling. */
  readonly connected: boolean

  /** Another device that is playing while this one is not, if any. */
  readonly playingElsewhere: Device | null
  /** The device this one's transport controls are driving, if any. */
  readonly remote: Device | null
  readonly setRemoteId: (deviceId: string | null) => void

  readonly send: (deviceId: string, command: DeviceCommand) => void
  /** Pull that device's queue and position over here, and stop it there. */
  readonly playHere: (device: Device) => void
  /** Push this device's queue and position there, and stop here. */
  readonly playOn: (device: Device) => void
}

const DevicesContext = createContext<DevicesContextValue | null>(null)

export function useDeviceContext(): DevicesContextValue {
  const context = useContext(DevicesContext)
  if (!context) throw new Error('useDeviceContext must be used inside <DevicesProvider>')
  return context
}

export function DevicesProvider({ children }: { children: ReactNode }): ReactNode {
  const player = usePlayer()
  const client = useQueryClient()

  // Identity is fixed for the life of the tab; the name is editable.
  const [deviceId] = useState(getDeviceId)
  const [kind] = useState(() => detectDevice().kind)
  const [name, setName] = useState(getDeviceName)

  const [remoteId, setRemoteIdState] = useState<string | null>(null)

  // The player object changes identity on every progress tick, so everything
  // below reads it through a ref rather than depending on it.
  const playerRef = useRef(player)
  playerRef.current = player

  const identityRef = useRef({ deviceId, name, kind })
  identityRef.current = { deviceId, name, kind }

  // --- outgoing: heartbeats --------------------------------------------------

  const lastSentRef = useRef<PlaybackState | null>(null)

  const beat = useCallback(
    (state: PlaybackState): void => {
      lastSentRef.current = state
      const { deviceId, name, kind } = identityRef.current
      void api
        .heartbeat({ deviceId, name, kind, state })
        .then(list => client.setQueryData(queryKeys.devices, list))
        .catch(() => {
          // The Mac is asleep or the tab is offline. The next beat will do.
        })
    },
    [client],
  )

  /*
   * Announce a material change immediately.
   *
   * This effect has no dependency array on purpose: it runs after every
   * render, and `playbackStateChanged` — not a hand-maintained dependency
   * list — decides whether anything worth announcing happened. Listing the
   * six fields instead would be one more place to forget to update, and the
   * comparison is a handful of scalar checks.
   */
  useEffect(() => {
    const state = snapshot(playerRef.current)
    if (playbackStateChanged(lastSentRef.current, state)) beat(state)
  })

  // The steady beat, so this device stays "online" and its position stays
  // roughly right on everyone else's screen.
  useEffect(() => {
    const timer = setInterval(() => beat(snapshot(playerRef.current)), DEVICE_HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [beat])

  // --- incoming: the event stream --------------------------------------------

  const send = useCallback((target: string, command: DeviceCommand): void => {
    void api.deviceCommand(target, command, identityRef.current.deviceId).catch(() => {
      // Target went away between the listing and the tap; the next device
      // event corrects the list.
    })
  }, [])

  // Declared before the query that fills it: everything that reads this ref
  // does so from a callback, long after the assignment below has run.
  const devicesRef = useRef<readonly Device[]>([])

  const execute = useRemoteCommands({ devicesRef, send })
  const executeRef = useRef(execute)
  executeRef.current = execute

  // The version this client already has. Seeded by the first `library` event
  // on connect, which is a statement of fact rather than a change.
  const libraryVersionRef = useRef<number | null>(null)

  const onEvent = useCallback(
    (event: ServerEvent): void => {
      switch (event.type) {
        case 'devices':
          client.setQueryData(queryKeys.devices, { devices: event.devices, now: event.now })
          return
        case 'command':
          if (event.deviceId === identityRef.current.deviceId) executeRef.current(event.command)
          return
        case 'library': {
          const known = libraryVersionRef.current
          libraryVersionRef.current = event.version
          if (known !== null && known !== event.version) {
            void client.invalidateQueries({ queryKey: queryKeys.library })
          }
          return
        }
      }
    },
    [client],
  )

  const { connected } = useServerEvents(deviceId, onEvent)

  // One query, two ways of being kept fresh: the stream writes into its cache
  // entry, and the query polls only while the stream is down.
  const devicesQuery = useDevices(connected)
  const list = useMemo(() => devicesQuery.data?.devices ?? [], [devicesQuery.data])
  devicesRef.current = list

  // --- derived -------------------------------------------------------------

  const others = useMemo(
    () => list.filter(device => device.online && device.id !== deviceId),
    [list, deviceId],
  )

  const localPlaying = player.playing
  const playingElsewhere = useMemo(
    () => (localPlaying ? null : (others.find(device => device.state.playing) ?? null)),
    [others, localPlaying],
  )

  const remote = useMemo(
    () => (remoteId === null ? null : (others.find(device => device.id === remoteId) ?? null)),
    [others, remoteId],
  )

  // Remote control is for when this device is idle. The moment music starts
  // here, the transport belongs to this device again.
  useEffect(() => {
    if (localPlaying) setRemoteIdState(null)
  }, [localPlaying])

  // Stop pointing at a device that dropped off.
  useEffect(() => {
    if (remoteId !== null && remote === null) setRemoteIdState(null)
  }, [remoteId, remote])

  // --- handoff -------------------------------------------------------------

  const playHere = useCallback(
    (device: Device): void => {
      const target = handoffTarget(device.state, Date.now())
      if (!target) return
      void playerRef.current.playQueue(target.queueIds, target.index, {
        position: target.position,
        autoplay: true,
        shuffle: device.state.shuffle,
        repeat: device.state.repeat,
      })
      send(device.id, { type: 'pause' })
      setRemoteIdState(null)
    },
    [send],
  )

  const playOn = useCallback(
    (device: Device): void => {
      const state = snapshot(playerRef.current)
      if (state.songId === null) return
      send(device.id, {
        type: 'playSong',
        songId: state.songId,
        queueIds: [...state.queueIds],
        queueIndex: Math.max(0, state.queueIndex),
        position: state.position,
        play: true,
      })
      playerRef.current.pause()
      // Handing playback over is exactly when you want the controls to follow.
      setRemoteIdState(device.id)
    },
    [send],
  )

  const rename = useCallback((next: string): void => setName(setDeviceName(next)), [])

  const value = useMemo<DevicesContextValue>(
    () => ({
      deviceId,
      name,
      rename,
      devices: list,
      others,
      connected,
      playingElsewhere,
      remote,
      setRemoteId: setRemoteIdState,
      send,
      playHere,
      playOn,
    }),
    [
      deviceId,
      name,
      rename,
      list,
      others,
      connected,
      playingElsewhere,
      remote,
      send,
      playHere,
      playOn,
    ],
  )

  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>
}

/** The local playback state, as the wire format describes it. */
function snapshot(player: ReturnType<typeof usePlayer>): PlaybackState {
  return {
    songId: player.current?.id ?? null,
    position: player.currentTime,
    playing: player.playing,
    queueIds: [...player.queue.items],
    queueIndex: player.queue.index,
    shuffle: player.queue.shuffle,
    repeat: player.queue.repeat,
    volume: player.muted ? 0 : player.volume,
    updatedAt: Date.now(),
  }
}

const NOTHING = (): void => undefined

/**
 * Devices without a Mac: this one, alone.
 *
 * Presence and handoff travel through the Mac's event stream, and the web
 * build has no Mac behind it — so it gets a context with this device in it and
 * nothing to hand off to, and every control that would reach for another
 * device finds none and stays out of the way.
 */
export function LoneDevicesProvider({ children }: { children: ReactNode }): ReactNode {
  const [deviceId] = useState(getDeviceId)
  const [name, setName] = useState(getDeviceName)
  const rename = useCallback((next: string): void => setName(setDeviceName(next)), [])

  const value = useMemo<DevicesContextValue>(
    () => ({
      deviceId,
      name,
      rename,
      devices: [],
      others: [],
      connected: false,
      playingElsewhere: null,
      remote: null,
      setRemoteId: NOTHING,
      send: NOTHING,
      playHere: NOTHING,
      playOn: NOTHING,
    }),
    [deviceId, name, rename],
  )

  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>
}
