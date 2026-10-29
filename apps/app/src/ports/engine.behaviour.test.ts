import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackEngine } from '@selfmp3/client'

/*
 * One set of cases, run against both engines: the phone's over a stand-in for
 * react-native-track-player, the browser's over a stand-in `<audio>` element.
 * Those are the only fakes; everything on this side of them is the engines'
 * own code.
 *
 * Each case is a rule one engine had and the other did not. A song with
 * nowhere to play from stops the one before it (the phone's kept sounding,
 * saying it was playing). A song lined up to repeat is said to end (the
 * phone's lent itself a second copy and never said so, so no play was counted
 * and "end of this song" never stopped). Loading the song already there
 * carries on with it (the browser's started it again from 0:00). Pause is said
 * at once, and moving the level unmutes, on both.
 */

// --- the phone's player ------------------------------------------------------

interface FakeTrack {
  readonly songId: number
  readonly url: string
}

const player = {
  queue: [] as FakeTrack[],
  active: -1,
  playing: false,
  volume: 1,
  resets: 0,
  handlers: new Map<string, (event: Record<string, unknown>) => void>(),
  emit(event: string, payload: Record<string, unknown>): void {
    player.handlers.get(event)?.(payload)
  },
}

vi.mock('react-native-track-player', () => {
  const api = {
    addEventListener: (event: string, handler: (payload: Record<string, unknown>) => void) => {
      player.handlers.set(event, handler)
      return { remove: () => player.handlers.delete(event) }
    },
    reset: async () => {
      player.queue = []
      player.active = -1
      player.playing = false
      player.resets += 1
    },
    add: async (track: FakeTrack) => {
      player.queue.push(track)
      if (player.active === -1) player.active = 0
    },
    skipToNext: async () => {
      player.active += 1
    },
    removeUpcomingTracks: async () => {
      player.queue = player.queue.slice(0, player.active + 1)
    },
    play: async () => {
      player.playing = true
      // Said by the player a moment later, as the real one does.
      queueMicrotask(() => player.emit('PlaybackState', { state: 'Playing' }))
    },
    pause: async () => {
      player.playing = false
      queueMicrotask(() => player.emit('PlaybackState', { state: 'Paused' }))
    },
    seekTo: async () => undefined,
    setVolume: async (level: number) => {
      player.volume = level
    },
    getActiveTrackIndex: async () => player.active,
    getActiveTrack: async () => player.queue[player.active],
    updateMetadataForTrack: async () => undefined,
  }
  const names = new Proxy({}, { get: (_target, name: string) => name })
  return { default: api, Event: names, State: names }
})
vi.mock('../player/setup', () => ({ ensurePlayer: () => Promise.resolve() }))

// Who this device is reads React Native, which a node test cannot load. Each
// rig says which it is: a phone, or a computer for the browser.
const device = vi.hoisted(() => ({ kind: 'phone' as 'phone' | 'desktop' }))
vi.mock('./device', () => ({ deviceKind: () => device.kind, deviceModel: () => 'iphone' }))

// --- the browser's element ---------------------------------------------------

class FakeAudio extends EventTarget {
  preload = 'auto'
  crossOrigin: string | null = null
  src = ''
  currentTime = 0
  duration = Number.NaN
  volume = 1
  paused = true
  error: { code: number } | null = null
  loads = 0
  load(): void {
    this.loads += 1
  }
  play(): Promise<void> {
    this.paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
    // Queued, as a browser queues it.
    queueMicrotask(() => this.dispatchEvent(new Event('pause')))
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = ''
  }
}

let elements: FakeAudio[] = []

// --- the two, behind one face ------------------------------------------------

interface Rig {
  readonly engine: PlaybackEngine
  /** Whether anything can be heard. */
  sounding(): boolean
  /** The level the platform was told to play at. */
  level(): number
  /** How many times a song was put in front from scratch. */
  fresh(): number
  /** Near the end of the song, where a handover gets ready. */
  nearEnd(): void
  /** The song runs out on its own. */
  end(): void
  /**
   * The song fails, told as the platform tells it: the phone's player says so
   * twice and moves on to the song lent behind it; the browser's element
   * fires its error twice.
   */
  fail(): void
  /** What this device is called in the app's words. */
  readonly place: 'phone' | 'computer'
}

const rigs: Record<string, () => Promise<Rig>> = {
  phone: async () => {
    device.kind = 'phone'
    const { createEngine } = await import('./engine')
    const engine = createEngine()
    // The player's listeners are attached after its setup resolves.
    await vi.waitFor(() => expect(player.handlers.size).toBeGreaterThan(0))
    return {
      engine,
      place: 'phone',
      sounding: () => player.playing,
      level: () => player.volume,
      fresh: () => player.resets,
      nearEnd: () => undefined,
      end() {
        const next = player.queue[player.active + 1]
        if (next) {
          player.active += 1
          player.emit('PlaybackActiveTrackChanged', { track: next, index: player.active })
        } else {
          player.playing = false
          player.emit('PlaybackQueueEnded', {})
        }
      },
      fail() {
        player.emit('PlaybackError', { message: 'The operation couldn’t be completed' })
        const next = player.queue[player.active + 1]
        if (next) {
          player.active += 1
          player.emit('PlaybackActiveTrackChanged', { track: next, index: player.active })
        }
        player.emit('PlaybackError', { message: 'The operation couldn’t be completed' })
      },
    }
  },

  browser: async () => {
    device.kind = 'desktop'
    const { createEngine } = await import('./engine.web')
    const engine = createEngine()
    const playing = (): FakeAudio | undefined => elements.find(element => !element.paused)
    return {
      engine,
      place: 'computer',
      sounding: () => playing() !== undefined,
      level: () => elements.find(element => element.src !== '')?.volume ?? elements[0]?.volume ?? 1,
      fresh: () => elements.reduce((sum, element) => sum + element.loads, 0),
      nearEnd() {
        const element = playing()
        if (!element) return
        element.duration = 200
        element.currentTime = 195
        element.dispatchEvent(new Event('timeupdate'))
      },
      end() {
        const element = playing()
        if (!element) return
        element.paused = true
        element.dispatchEvent(new Event('ended'))
      },
      fail() {
        const element = elements.find(candidate => candidate.src !== '')
        if (!element) return
        element.paused = true
        element.error = { code: 2 }
        element.dispatchEvent(new Event('error'))
        element.dispatchEvent(new Event('error'))
      },
    }
  },
}

beforeEach(() => {
  vi.resetModules()
  player.queue = []
  player.active = -1
  player.playing = false
  player.volume = 1
  player.resets = 0
  player.handlers.clear()
  elements = []
  vi.stubGlobal(
    'Audio',
    class extends FakeAudio {
      constructor() {
        super()
        elements.push(this)
      }
    },
  )
  // Nothing answers: what a failed song's address is asked comes back with no answer.
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
  vi.stubGlobal('MediaError', {
    MEDIA_ERR_SRC_NOT_SUPPORTED: 4,
    MEDIA_ERR_NETWORK: 2,
    MEDIA_ERR_DECODE: 3,
  })
})

const address = (songId: number): string => `https://music.example/api/stream/${songId}`

describe.each(Object.keys(rigs))('the %s engine', name => {
  const rig = (): Promise<Rig> => (rigs[name] as () => Promise<Rig>)()

  it('stops the song before one it has nowhere to play from, and says so', async () => {
    const { engine, sounding, place } = await rig()
    engine.connect({ streamUrl: songId => (songId === 2 ? '' : address(songId)) })
    await engine.load(1)
    expect(sounding()).toBe(true)

    await engine.load(2)

    expect(engine.state.error).toBe(`This song can’t be played on this ${place} yet.`)
    expect(engine.state.playing).toBe(false)
    expect(sounding()).toBe(false)
  })

  it('names a song it has nowhere to play from, when it knows the title', async () => {
    const { engine, place } = await rig()
    engine.connect({
      streamUrl: () => '',
      trackMetadata: songId => ({ title: `Evening ${songId}` }),
    })

    await expect(engine.load(3)).resolves.toBeUndefined()

    expect(engine.state.error).toBe(`“Evening 3” can’t be played on this ${place} yet.`)
    expect(engine.state.playing).toBe(false)
  })

  it('says a song repeated on its own has ended, each time round', async () => {
    const { engine, nearEnd, end } = await rig()
    let ended = 0
    engine.connect({
      streamUrl: address,
      // Repeat-one: the song after this one is this one.
      nextTrackId: () => 1,
      onTrackEnd: () => {
        ended += 1
      },
    })
    await engine.load(1)

    nearEnd()
    end()

    expect(ended).toBe(1)
  })

  it('carries on with the song it already has, rather than starting it again', async () => {
    const { engine, fresh } = await rig()
    engine.connect({ streamUrl: address })
    await engine.load(1)
    const loaded = fresh()

    await engine.load(1)

    expect(fresh()).toBe(loaded)
    expect(engine.state.playing).toBe(true)
  })

  it('loads a song afresh after it failed', async () => {
    const { engine, fresh } = await rig()
    let url = ''
    engine.connect({ streamUrl: () => url })
    await engine.load(1)
    url = address(1)
    const before = fresh()

    await engine.load(1)

    expect(fresh()).toBeGreaterThan(before)
    expect(engine.state.error).toBeNull()
  })

  it('says paused the moment it is told, not when the platform gets round to it', async () => {
    const { engine } = await rig()
    engine.connect({ streamUrl: address })
    await engine.load(1)
    await vi.waitFor(() => expect(engine.state.playing).toBe(true))

    engine.pause()

    expect(engine.state.playing).toBe(false)
  })

  it('unmutes when the level is moved, and plays at that level', async () => {
    const { engine, level } = await rig()
    engine.setMuted(true)
    expect(level()).toBe(0)

    engine.setVolume(0.5)

    expect(engine.state).toMatchObject({ volume: 0.5, muted: false })
    expect(level()).toBe(0.5)
  })

  it('stays muted when the level is moved to nothing', async () => {
    const { engine, level } = await rig()
    engine.setMuted(true)

    engine.setVolume(0)

    expect(engine.state).toMatchObject({ volume: 0, muted: true })
    expect(level()).toBe(0)
  })

  it('tells a failure once, and never takes the player moving past it as the song ending', async () => {
    const { engine, fail } = await rig()
    let ended = 0
    engine.connect({
      streamUrl: address,
      nextTrackId: () => 2,
      onTrackEnd: () => {
        ended += 1
      },
    })
    const told: string[] = []
    engine.subscribe(state => {
      if (state.error !== null && told.at(-1) !== state.error) told.push(state.error)
    })
    await engine.load(1)

    fail()

    // Nothing answered: said in the words that stop the run (`isUnreachable`).
    await vi.waitFor(() => expect(told).toEqual(['Lost connection to the library']))
    expect(ended).toBe(0)
    expect(engine.state.playing).toBe(false)
  })
})
