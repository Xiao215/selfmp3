import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PlaybackState } from '@selfmp3/shared'
import { startLibrary, type TestLibrary } from '../fixtures/library.js'

/**
 * The command channel carries a handoff and nothing more: "Play there instead"
 * sends `playSong`, "Play here" sends `pause`. Remote control — playing,
 * skipping or seeking another device in place — is not something the app does,
 * so the wire refuses it rather than forwarding commands nobody sends.
 */
describe('POST /api/devices/:id/command', () => {
  let library: TestLibrary

  const STATE: PlaybackState = {
    songId: null,
    position: 0,
    playing: false,
    queueIds: [],
    queueIndex: -1,
    shuffle: false,
    repeat: 'off',
    updatedAt: 0,
  }

  beforeAll(async () => {
    library = await startLibrary()
  })

  afterAll(() => library.close())

  const auth = (): Record<string, string> => ({
    Authorization: `Bearer ${library.container.config.authToken}`,
  })

  const post = (url: string, body: unknown): Promise<Response> => library.send('POST', url, body)

  const heartbeat = (deviceId: string): Promise<Response> =>
    post('/api/devices/heartbeat', { deviceId, name: deviceId, kind: 'desktop', state: STATE })

  it('forwards a playSong down the target device’s stream', async () => {
    expect((await heartbeat('laptop-0001')).status).toBe(200)

    const stream = new AbortController()
    const events = await fetch(`${library.origin}/api/events?deviceId=laptop-0001`, {
      headers: auth(),
      signal: stream.signal,
    })
    expect(events.status).toBe(200)
    // Gzipped, the stream would be held back in the compressor until it filled.
    expect(events.headers.get('content-encoding')).toBeNull()
    const reader = events.body!.getReader()
    const decoder = new TextDecoder()

    const sent = await post('/api/devices/laptop-0001/command', {
      type: 'playSong',
      songId: 3,
      queueIds: [1, 3],
      queueIndex: 1,
      position: 42,
    })
    expect(sent.status).toBe(200)
    expect(await sent.json()).toEqual({ ok: true, delivered: 1 })

    let text = ''
    while (!text.includes('"type":"command"')) {
      const { value, done } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    stream.abort()

    expect(text).toContain(
      '"command":{"type":"playSong","songId":3,"queueIds":[1,3],"queueIndex":1,"position":42}',
    )
    expect(text).not.toContain('fromDeviceId')
  })

  it('carries every device named on one stream, which is how a browser’s tabs share one', async () => {
    expect((await heartbeat('browser-tab-1')).status).toBe(200)
    expect((await heartbeat('browser-tab-2')).status).toBe(200)

    const stream = new AbortController()
    const events = await fetch(
      `${library.origin}/api/events?deviceId=browser-tab-1&deviceId=browser-tab-2`,
      { headers: auth(), signal: stream.signal },
    )
    expect(events.status).toBe(200)

    for (const id of ['browser-tab-1', 'browser-tab-2']) {
      const sent = await post(`/api/devices/${id}/command`, { type: 'pause' })
      expect(await sent.json()).toEqual({ ok: true, delivered: 1 })
    }
    stream.abort()
  })

  it('says a known device with no stream open is not connected', async () => {
    expect((await heartbeat('phone-00001')).status).toBe(200)
    const response = await post('/api/devices/phone-00001/command', { type: 'pause' })
    expect(response.status).toBe(409)
  })

  it('refuses the remote-control commands nothing sends', async () => {
    expect((await heartbeat('tablet-0001')).status).toBe(200)
    for (const command of [
      { type: 'play' },
      { type: 'toggle' },
      { type: 'next' },
      { type: 'prev' },
      { type: 'seek', position: 12 },
      { type: 'setVolume', volume: 0.5 },
      { type: 'transfer', fromDeviceId: 'phone-00001' },
    ]) {
      const response = await post('/api/devices/tablet-0001/command', command)
      expect(response.status, command.type).toBe(400)
    }
  })
})
