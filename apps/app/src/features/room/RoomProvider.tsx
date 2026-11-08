import { useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import {
  clientApi,
  publicServerBase,
  queryKeys,
  roomTrackId,
  shouldResync,
  yoursOf,
} from '@selfmp3/client'
import {
  ROOM_VECTORS_AT_ONCE,
  packVector,
  soundCloseness,
  unpackVector,
  type RoomState,
} from '@selfmp3/shared'
import type { RoomPass } from '@selfmp3/client'
import { mediaUrlFor } from '../../api/client'
import { library as cloudLibrary, session as cloudSession } from '../../replica'
import { useServerDirect } from '../../connection/useServerDirect'
import {
  usePlayer,
  usePlayerCommands,
  usePlayerPlaying,
  usePlayingSongId,
} from '../../player/PlayerProvider'
import { roomTrack, setRoomTracks } from '../../player/roomTracks'
import { setRoomTransport } from '../../player/roomTransport'
import { holdPictures, keepLent } from '../../offline/covers'
import { lentCoverKey, rememberPastRoom, usePastRooms } from './pastRooms.store'
import { lightTap } from '../../ports/haptics'
import { showToast } from '../../ui/toast'
import { ART } from '../../ui/components/ToastHost'
import { RoomFaces } from './RoomFace'
import { useLibraryIndex } from '../../ui/songsById'
import {
  arrivals,
  entryOfTrack,
  followPlan,
  followerPress,
  freshWant,
  hostPlan,
  isHost,
  keepGoingPicks,
  libraryPicks,
  namesOf,
  needsReport,
  endedLine,
  pastRoomOf,
  positionNow,
  roomTracks,
  soundTarget,
} from './room.model'
import {
  connectRoom,
  currentRoom,
  keptAsOf,
  onRoomEnded,
  roomAct,
  roomApi,
  roomMayTakeOver,
  takeRoomStartHint,
  useRoom,
} from './room.store'
import { sayRoomFailure } from './roomFailure'

/**
 * The room this device is in, kept in step with its player
 * (docs/features/listen-together.md). Drawn as nothing.
 *
 * - The room's songs become tracks the player can play (player/roomTracks.ts).
 * - The host's player plays the room: it starts when the first song comes in,
 *   keeps what comes next the room's list, says what it is on, does what a
 *   friend asked of it (skip, pause), and keeps the list going near its end.
 * - On everyone's phone, everyone else's player follows the host's: the same
 *   song, at the same place on the doorman's clock.
 * - A room that ends is remembered for Recently played.
 */

/** How often a follower checks that it is still in step, and the host that the room has its place. */
const CHECK_MS = 3000

/** Songs Autoplay (`keepGoing`) makes sure are waiting. */
const KEEP_WAITING = 2

export function RoomProvider({ children }: { children: ReactNode }): ReactNode {
  const room = useRoom()
  const state = room.state
  const pass = room.pass
  const commands = usePlayerCommands()
  const { ranOut, queue } = usePlayer()
  const playingId = usePlayingSongId()
  const playing = usePlayerPlaying()
  const index = useLibraryIndex()
  const host = state ? isHost(state) : false
  // One tab of a browser plays the room (`leadRoom`); the others leave their player be.
  const plays = room.lead === 'here'
  const driving = host && plays

  // A link plays through the host's server: looked for only by a host with a link to play.
  const hasLinks = state?.entries.some(entry => entry.song.link !== null) ?? false
  const server = useServerDirect({ enabled: host && hasLinks })
  const serverConnection = server.state === 'reachable' ? server.connection : null
  const linkStream = useCallback(
    (url: string): string | null =>
      serverConnection ? mediaUrlFor(serverConnection).importListen(url) : null,
    [serverConnection],
  )

  // Links for everyone: the host tells the room where its server answers from
  // the internet, once, the first time a link comes in.
  const { data: cloudServer } = useQuery({
    queryKey: queryKeys.cloudServer,
    queryFn: () => clientApi().cloudServer(),
    enabled: host && hasLinks,
  })
  const toldLinkServer = useRef<string | null>(null)
  useEffect(() => {
    if (!state || !pass || !host || !hasLinks || state.linkRelay) return
    if (toldLinkServer.current === state.code) return
    const said = cloudServer?.server
    const base = said ? publicServerBase(said.addresses) : null
    if (!said || !base) return
    toldLinkServer.current = state.code
    void roomApi.linkServer(pass, { base, token: said.token }).catch(() => {
      toldLinkServer.current = null
    })
  }, [state, pass, host, hasLinks, cloudServer])

  // What the engine's callbacks and the timers read, current without re-wiring.
  const live = useRef({ playingId, playing, ranOut, queueIndex: queue.index })
  useEffect(() => {
    live.current = { playingId, playing, ranOut, queueIndex: queue.index }
  }, [playingId, playing, ranOut, queue.index])

  // A friend coming in: a tap on the phone and their name, wherever you are (M2).
  const seen = useRef<{ code: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!state) {
      seen.current = null
      return
    }
    const before = seen.current?.code === state.code ? seen.current.ids : null
    const came = arrivals(before, state)
    seen.current = { code: state.code, ids: new Set(state.members.map(member => member.id)) }
    if (came.length === 0) return
    lightTap()
    showToast(`${namesOf(came.map(member => member.name))} joined`, 'info', {
      art: <RoomFaces people={came.slice(0, 3)} size={came.length === 1 ? ART : 32} />,
    })
  }, [state])

  // Back into the room this device was in when the app last closed.
  useEffect(() => {
    if (currentRoom().pass) connectRoom()
  }, [])

  // A room that ended: kept for Recently played, and the host's player let go of it.
  useEffect(
    () =>
      onRoomEnded((ended, how) => {
        const past = pastRoomOf(ended, Date.now())
        if (past) rememberPastRoom({ ...past, shared: keptAsOf(ended.code) })
        // Leaving says so where it was pressed (RoomSheets); the room ending
        // under you, or being taken out of it, is said here.
        if (how !== 'left') {
          showToast(endedLine(ended, how), 'info', {
            actions: past
              ? [
                  {
                    label: 'See what played',
                    onPress: () =>
                      router.push({ pathname: '/past-room/[code]', params: { code: ended.code } }),
                  },
                ]
              : [],
          })
        }
        if (roomTrack(live.current.playingId ?? 0)) {
          commands.setUpcoming([])
          if (live.current.playing) commands.toggle()
        }
        setRoomTracks(new Map())
      }),
    [commands],
  )

  // The room's songs, as tracks. First, so the plans below find them.
  useEffect(() => {
    if (!state || !pass) {
      setRoomTracks(new Map())
      return
    }
    setRoomTracks(
      roomTracks(state, {
        file: (entryId, part) => roomApi.fileUrl(pass, entryId, part),
        link: host ? linkStream : () => null,
        library: index,
      }),
    )
  }, [state, pass, host, linkStream, index])

  // A friend's cover, kept on this device once their song has played: the
  // room lends it only while it is open, and the room's page in Recently
  // played draws it after (pastRooms.store). Held, with every past room's,
  // so the library's sweep of pictures it does not name leaves them.
  const keptCovers = useRef<{ code: string; keys: Set<string> }>({ code: '', keys: new Set() })
  useEffect(() => {
    if (!state || !pass) {
      holdPictures('room', [])
      return
    }
    if (keptCovers.current.code !== state.code) {
      keptCovers.current = { code: state.code, keys: new Set() }
    }
    const kept = keptCovers.current.keys
    for (const entry of state.entries) {
      const cover = entry.song.cover
      const heard = entry.playedAt !== null || entry.id === state.playing?.entryId
      if (!cover || !heard || kept.has(cover.key) || yoursOf(entry.song, index) !== null) continue
      kept.add(cover.key)
      void keepLent(cover.key, roomApi.fileUrl(pass, entry.id, 'cover'))
    }
    holdPictures('room', kept)
  }, [state, pass, index])
  const pastRooms = usePastRooms()
  useEffect(() => {
    holdPictures(
      'past-rooms',
      pastRooms.flatMap(room => room.songs.flatMap(lentCoverKey)),
    )
  }, [pastRooms])

  // Another tab of this browser plays the room: said once, as this one comes in.
  const saidElsewhere = useRef<string | null>(null)
  useEffect(() => {
    if (!state || room.lead !== 'elsewhere' || saidElsewhere.current === state.code) return
    saidElsewhere.current = state.code
    showToast({
      say: 'The room plays in your other tab',
      under: 'This one takes over if you close it.',
    })
  }, [state, room.lead])

  // --- the host ---------------------------------------------------------------

  // A tab that waited on another of the host's and now plays the room: it
  // takes the room's song up, whatever of its own it had on, before it
  // reports anything (`hostPlan`).
  const tookLead = useRef(false)
  useEffect(() => {
    if (room.lead === 'elsewhere') tookLead.current = true
  }, [room.lead])

  useEffect(() => {
    if (!state || !driving) return
    const plan = hostPlan(state, {
      currentId: playingId,
      playing,
      ranOut,
      takeOver: roomMayTakeOver(),
      tookLead: tookLead.current,
    })
    if (plan.kind !== 'resume') tookLead.current = false
    switch (plan.kind) {
      case 'start': {
        const hint = takeRoomStartHint()
        commands.playFrom(
          plan.ids,
          0,
          hint ? { position: hint.position, autoplay: hint.autoplay } : {},
        )
        return
      }
      case 'follow':
        commands.setUpcoming(plan.upcoming)
        return
      case 'advance':
        commands.setUpcoming(plan.upcoming)
        commands.jumpTo(live.current.queueIndex + 1)
        return
      case 'resume': {
        const room = currentRoom()
        commands.playFrom(plan.ids, 0, {
          position: positionNow(state, room.offset, Date.now()),
          autoplay: state.playing?.pausedAt === null,
        })
        return
      }
      case 'none':
        return
    }
  }, [state, driving, playingId, playing, ranOut, commands])

  // What the host's player is on, told to the room whenever it differs from what the room says.
  const reporting = useRef(false)
  const report = useCallback(() => {
    const now = currentRoom()
    if (!now.state || !isHost(now.state) || now.lead !== 'here' || reporting.current) return
    if (tookLead.current) return
    // Nothing loaded yet (the app just opened): the plan takes the room's
    // song up, and the room hears once it plays, not that nothing does.
    if (live.current.playingId === null && now.state.playing) return
    const position = commands.getPosition()
    const entryId = entryOfTrack(now.state, live.current.playingId)
    const facts = { entryId, playing: live.current.playing, position }
    if (!needsReport(now.state, now.offset, Date.now(), facts)) return
    reporting.current = true
    void roomAct({ type: 'report', ...facts })
      .catch(() => undefined)
      .finally(() => {
        reporting.current = false
      })
  }, [commands])
  useEffect(() => {
    if (driving) report()
  }, [driving, state, playingId, playing, report])

  // What a friend asked of the host's player: each once, and none from before this device heard the room.
  const lastWant = useRef<{ code: string; seq: number } | null>(null)
  useEffect(() => {
    if (!state || !driving) return
    if (lastWant.current?.code !== state.code) {
      lastWant.current = { code: state.code, seq: state.want?.seq ?? 0 }
      return
    }
    const now = currentRoom()
    const fresh = freshWant(state, lastWant.current.seq, {
      offset: now.offset,
      now: Date.now(),
      heard: now.link === 'live',
    })
    if (!fresh) return
    const { want } = fresh
    lastWant.current = { code: state.code, seq: want.seq }
    if (!fresh.act) return
    if (want.kind === 'skip') commands.next()
    else if ((want.kind === 'pause') === live.current.playing) commands.toggle()
  }, [state, driving, commands])

  // Autoplay (`keepGoing`): a couple of songs always waiting, while something plays.
  const keptFor = useRef<string | null>(null)
  useEffect(() => {
    if (!state || !driving || !state.keepGoing || !state.playing) return
    if (state.order.length >= KEEP_WAITING || keptFor.current === state.playing.entryId) return
    keptFor.current = state.playing.entryId
    const wanted = KEEP_WAITING - state.order.length
    void (async () => {
      // By sound where the room knows how its songs sound; by turns alone otherwise.
      const closeness = await closenessTo(state, pass).catch(() => undefined)
      const picks = keepGoingPicks(
        state,
        wanted,
        closeness ? { closeness: song => (song.audio ? closeness(song.audio.key) : null) } : {},
      )
      for (const action of picks) await roomAct(action).catch(() => undefined)
      // A young room has nothing of its own to bring back yet: the host's
      // library keeps it going rather than letting it run dry.
      if (picks.length >= wanted) return
      const yours = libraryPicks(state, index.byAudio, wanted - picks.length, {
        ...(closeness ? { closeness } : {}),
      })
      for (const id of yours) {
        const song = cloudLibrary.cloudRoomSongNow(id)
        if (song) await roomAct({ type: 'add', song }).catch(() => undefined)
      }
    })()
  }, [state, driving, pass, index])

  // How your own songs in the room sound, told to the room once each: what
  // the host's Autoplay ranks by. Read from your bucket's pack.
  const toldVectors = useRef<{ code: string; keys: Set<string> }>({ code: '', keys: new Set() })
  useEffect(() => {
    if (!state || !pass) return
    const you = state.members.find(member => member.id === state.you)
    if (!you || you.kind === 'guest') return
    if (toldVectors.current.code !== state.code) {
      toldVectors.current = { code: state.code, keys: new Set() }
    }
    const told = toldVectors.current.keys
    const yours = new Set<string>()
    for (const entry of state.entries) {
      if (entry.owner === state.you && entry.song.audio) yours.add(entry.song.audio.key)
    }
    for (const shelf of state.shelves) {
      if (shelf.member !== state.you) continue
      for (const song of shelf.songs) if (song.audio) yours.add(song.audio.key)
    }
    const missing = [...yours].filter(key => !told.has(key)).slice(0, ROOM_VECTORS_AT_ONCE)
    if (missing.length === 0) return
    for (const key of missing) told.add(key)
    void (async () => {
      const session = await cloudSession.loadSession()
      const pack = session ? await cloudLibrary.cloudSoundVectors(session) : null
      if (!pack) return
      const vectors: Record<string, string> = {}
      for (const key of missing) {
        const vector = pack.vectors.get(key)
        if (vector) vectors[key] = packVector(vector)
      }
      if (Object.keys(vectors).length > 0) {
        await roomApi.addVectors(pass, { model: pack.model, vectors })
      }
    })().catch(() => {
      // Told again with the next change to the room.
      for (const key of missing) told.delete(key)
    })
  }, [state, pass])

  // --- everyone else, on everyone's phone ----------------------------------------

  // A friend's own Previous, play/pause and Next: the room's, not this player's.
  useEffect(() => {
    setRoomTransport(step => {
      const room = currentRoom().state
      if (!room) return false
      const press = followerPress(room, step, roomTrack(live.current.playingId ?? 0) !== undefined)
      if (!press) return false
      if ('say' in press) showToast(press.say, 'info')
      else void roomAct({ type: press.act }).catch(sayRoomFailure)
      return true
    })
    return () => setRoomTransport(null)
  }, [])

  // The song a follower last said it waits on the host for, so it is said once;
  // since when it has waited on this play of it (`followPlan`'s `outSince`,
  // keyed by the song and when it started); and where the room was when this
  // player left its song: ran out on it, or went on by itself to what the
  // room has next (`leftAt`).
  const saidWaiting = useRef<string | null>(null)
  const waitingSince = useRef<{ play: string; at: number } | null>(null)
  const leftSong = useRef<{ entryId: string; position: number } | null>(null)
  const noteLeft = useCallback(() => {
    const now = currentRoom()
    const room = now.state
    const entryId = room?.playing?.entryId ?? null
    if (!room || entryId === null) {
      leftSong.current = null
      return
    }
    const onIt = live.current.playingId === roomTrackId(entryId)
    const next = room.order[0]
    const onNext = next !== undefined && live.current.playingId === roomTrackId(next)
    if (!((onIt && live.current.ranOut) || onNext)) leftSong.current = null
    else if (leftSong.current?.entryId !== entryId) {
      leftSong.current = { entryId, position: positionNow(room, now.offset, Date.now()) }
    }
  }, [])
  const follow = useCallback(() => {
    const now = currentRoom()
    const room = now.state
    if (!room || isHost(room) || room.mode !== 'everyone' || now.lead !== 'here') return
    // Reconnecting, what the room last said goes stale: the song this device
    // has goes on as it is, and is put in step once the room is back.
    if (now.link !== 'live') return
    const onRoomSong = roomTrack(live.current.playingId ?? 0) !== undefined
    const entryId = room.playing?.entryId ?? null
    const at = Date.now()
    noteLeft()
    const play = room.playing && `${room.playing.entryId} ${room.playing.startedAt}`
    const since = waitingSince.current?.play === play ? waitingSince.current.at : null
    const plan = followPlan(
      room,
      now.offset,
      at,
      {
        currentId: live.current.playingId,
        leftAt: leftSong.current?.position ?? null,
        playsHere: entryId !== null && commands.mayPlay(roomTrackId(entryId)),
      },
      since,
    )
    if (plan.kind !== 'wait') waitingSince.current = null
    else if (play && since === null) waitingSince.current = { play, at }
    switch (plan.kind) {
      case 'stop':
        if (onRoomSong && live.current.playing) commands.toggle()
        return
      case 'wait': {
        if (!plan.away) return
        if (onRoomSong && live.current.playing) commands.toggle()
        const waiting = `${room.code} ${room.playing?.entryId ?? ''}`
        if (saidWaiting.current !== waiting) {
          saidWaiting.current = waiting
          showToast({ say: plan.away, under: 'The room goes on when they’re back.' })
        }
        return
      }
      case 'load':
        commands.playFrom(plan.ids, 0, { position: plan.position, autoplay: plan.autoplay })
        return
      case 'keep':
        commands.setUpcoming(plan.upcoming)
        if (plan.playing !== live.current.playing) commands.toggle()
        if (shouldResync(commands.getPosition(), plan.position)) commands.seekTo(plan.position)
        return
    }
  }, [commands, noteLeft])

  useEffect(() => {
    follow()
  }, [state, plays, follow])
  // Where the room was as the player left its song is noted then, not after
  // the host has moved it (`leftAt`); the plan itself waits for the room or
  // the next check, so a song this player starts is not planned again while
  // it loads.
  useEffect(() => {
    if (plays) noteLeft()
  }, [plays, ranOut, playingId, noteLeft])

  // The steady checks: a follower's drift, and a host's seek the room has not heard of.
  const inRoom = state !== null
  useEffect(() => {
    if (!inRoom || !plays) return
    const timer = setInterval(() => (host ? report() : follow()), CHECK_MS)
    return () => clearInterval(timer)
  }, [inRoom, plays, host, report, follow])

  return children
}

/**
 * How near a song, by its audio key, sounds to what the room just played:
 * from the vectors the room keeps, and the host's own pack for the songs of
 * its library the room has not heard (`libraryPicks`). Undefined when the
 * room has none for what played.
 */
async function closenessTo(
  state: RoomState,
  pass: RoomPass | null,
): Promise<((audioKey: string) => number | null) | undefined> {
  if (!pass) return undefined
  const kept = await roomApi.vectors(pass)
  const vectors = new Map<string, Int8Array>()
  for (const [key, text] of Object.entries(kept.vectors)) {
    const vector = unpackVector(text)
    if (vector) vectors.set(key, vector)
  }
  const target = soundTarget(state, vectors)
  if (!target) return undefined
  const session = await cloudSession.loadSession().catch(() => null)
  const pack = session ? await cloudLibrary.cloudSoundVectors(session).catch(() => null) : null
  // Another model's vectors are not comparable with the room's.
  const own = pack && pack.model === kept.model ? pack.vectors : null
  return key => {
    const mine = own?.get(key)
    const vector = vectors.get(key) ?? (mine ? unpackVector(packVector(mine)) : null)
    return vector ? soundCloseness(vector, target) : null
  }
}
