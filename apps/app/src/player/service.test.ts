import { describe, expect, it, vi } from 'vitest'

/*
 * The playback service over a stand-in for react-native-track-player that
 * keeps the handlers it is given. What is pinned: a call, an alarm or Siri
 * ending never sets a song playing from here. The native player decides that,
 * from whether it was playing when the interruption began; this handler
 * playing on every end started a song paused before the call (bug bash r3
 * L5b-phone, round 5).
 */

const handlers = new Map<string, (event: Record<string, unknown>) => void>()
const told: string[] = []

vi.mock('react-native-track-player', () => {
  const player = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        (...args: unknown[]) => {
          if (method === 'addEventListener') {
            handlers.set(args[0] as string, args[1] as (event: Record<string, unknown>) => void)
            return { remove: () => undefined }
          }
          told.push(method)
          return Promise.resolve(undefined)
        },
    },
  )
  const names = new Proxy({}, { get: (_target, name: string) => name })
  return { default: player, Event: names }
})

describe('the playback service', () => {
  it('leaves an interruption to the native player, so a paused song stays paused', async () => {
    const { playbackService } = await import('./service')
    await playbackService()

    handlers.get('RemoteDuck')?.({ paused: true })
    handlers.get('RemoteDuck')?.({ paused: false })
    handlers.get('RemoteDuck')?.({ paused: true, permanent: true })
    expect(told).not.toContain('play')

    // The lock screen's own Play still plays.
    handlers.get('RemotePlay')?.({})
    expect(told).toEqual(['play'])
  })
})
