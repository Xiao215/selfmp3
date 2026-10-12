import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The phone's engine over a stand-in for react-native-track-player that
 * records what it was told. What is pinned: the song lent to the player as
 * the next one is lent again when it comes from somewhere new — a copy kept
 * on the disk since it was lent as a stream — so it plays from the file and
 * does not stream from the bucket. The same song from the same place is left
 * alone, which keeps whatever the player has buffered of it.
 */

const told: { method: string; args: unknown[] }[] = []
/** Set to keep the player's `reset` waiting, as a slow one does. */
let resetWaits: Promise<void> | null = null

vi.mock('react-native-track-player', () => {
  const player = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        (...args: unknown[]) => {
          told.push({ method, args })
          if (method === 'addEventListener') return { remove: () => undefined }
          if (method === 'reset' && resetWaits) return resetWaits
          return Promise.resolve(undefined)
        },
    },
  )
  const names = new Proxy({}, { get: (_target, name: string) => name })
  return { default: player, Event: names, State: names }
})

vi.mock('../player/setup', () => ({ ensurePlayer: () => Promise.resolve() }))

beforeEach(() => {
  told.length = 0
  resetWaits = null
})

const lent = (): string[] =>
  told.filter(call => call.method === 'add').map(call => (call.args[0] as { url: string }).url)

describe('the phone engine', () => {
  it('lends the next song again once it is on the disk, and not otherwise', async () => {
    const { createEngine } = await import('./engine')
    const engine = createEngine()
    const urls = new Map<number, string>([
      [1, 'https://doorman.test/v1/files/audio/one.m4a'],
      [2, 'https://doorman.test/v1/files/audio/two.m4a'],
    ])
    engine.connect({ nextTrackId: () => 2, streamUrl: songId => urls.get(songId) ?? '' })

    await engine.load(1)
    expect(lent()).toEqual([urls.get(1), urls.get(2)])

    // Asked again with nothing changed: left as it is.
    engine.refreshLookahead?.()
    await vi.waitFor(() => expect(told.at(-1)?.method).not.toBe('removeUpcomingTracks'))
    expect(lent()).toHaveLength(2)

    // Kept on the disk meanwhile: lent again, from the file.
    urls.set(2, 'file:///recent-songs/two.m4a')
    engine.refreshLookahead?.()
    await vi.waitFor(() => expect(lent()).toHaveLength(3))
    expect(lent().at(-1)).toBe('file:///recent-songs/two.m4a')
  })

  it('puts the song back when it is asked for while another load is moving the player', async () => {
    const { createEngine } = await import('./engine')
    const engine = createEngine()
    const urls = new Map<number, string>([
      [1, 'file:///one.m4a'],
      [2, 'file:///two.m4a'],
      [3, 'file:///three.m4a'],
    ])
    engine.connect({ nextTrackId: () => 3, streamUrl: songId => urls.get(songId) ?? '' })
    await engine.load(1)

    // Song 2 is on its way in, the player still resetting for it, when song
    // 1 is asked for again: the reset is about to clear song 1 out.
    let release = (): void => undefined
    resetWaits = new Promise(resolve => {
      release = resolve
    })
    const leaving = engine.load(2)
    await vi.waitFor(() => expect(told.at(-1)?.method).toBe('reset'))
    const back = engine.load(1)
    release()
    resetWaits = null
    await Promise.all([leaving, back])

    const methods = told.map(call => call.method)
    const afterLastReset = told.slice(methods.lastIndexOf('reset') + 1)
    const added = afterLastReset.filter(call => call.method === 'add')
    expect((added[0]?.args[0] as { url: string } | undefined)?.url).toBe(urls.get(1))
  })
})
