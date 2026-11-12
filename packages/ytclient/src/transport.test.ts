import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, type YtProxyPageMessage } from '@selfmp3/shared'
import { portFetch, type PagePort } from './transport.js'

/** A port whose other end is the test: it sees what the page sent and answers by hand. */
function fakeExtension() {
  const sent: YtProxyPageMessage[] = []
  let deliver: (message: unknown) => void = () => undefined
  let hangUp: () => void = () => undefined
  let connects = 0
  const connect = (): PagePort => {
    connects++
    return {
      postMessage: message => sent.push(message),
      disconnect: () => undefined,
      onMessage: { addListener: listener => (deliver = listener) },
      onDisconnect: { addListener: listener => (hangUp = listener) },
    }
  }
  return {
    fetch: portFetch(connect),
    sent,
    answer: (message: unknown) => deliver(message),
    hangUp: () => hangUp(),
    connects: () => connects,
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('portFetch', () => {
  it('sends the request down the port and builds the response from what comes back', async () => {
    const extension = fakeExtension()
    const pending = extension.fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"videoId":"x"}',
    })
    await tick()

    const request = extension.sent[0]
    expect(request).toMatchObject({
      type: 'request',
      id: 0,
      url: 'https://www.youtube.com/youtubei/v1/player',
      method: 'POST',
    })
    expect(request?.type === 'request' && request.headers).toContainEqual([
      'content-type',
      'application/json',
    ])
    const body = request?.type === 'request' ? request.body : null
    expect(new TextDecoder().decode(base64ToBytes(body ?? ''))).toBe('{"videoId":"x"}')

    extension.answer({
      type: 'head',
      id: 0,
      status: 200,
      statusText: 'OK',
      headers: [['x-a', '1']],
    })
    extension.answer({
      type: 'chunk',
      id: 0,
      data: bytesToBase64(new TextEncoder().encode('{"a":')),
    })
    extension.answer({ type: 'chunk', id: 0, data: bytesToBase64(new TextEncoder().encode('1}')) })
    extension.answer({ type: 'end', id: 0 })

    const response = await pending
    expect(response.status).toBe(200)
    expect(response.headers.get('x-a')).toBe('1')
    expect(await response.json()).toEqual({ a: 1 })
  })

  it('sends no body with a GET', async () => {
    const extension = fakeExtension()
    void extension.fetch('https://rr1---sn-x.googlevideo.com/videoplayback?range=0-1')
    await tick()
    expect(extension.sent[0]).toMatchObject({ method: 'GET', body: null })
  })

  it('rejects with what the extension said when it could not fetch', async () => {
    const extension = fakeExtension()
    const pending = extension.fetch('https://example.com/')
    await tick()
    extension.answer({ type: 'error', id: 0, message: 'only YouTube addresses are carried' })
    await expect(pending).rejects.toThrow(/only YouTube addresses/)
  })

  it('fails what was in flight when the port closes, and opens a new one for the next', async () => {
    const extension = fakeExtension()
    const pending = extension.fetch('https://www.youtube.com/')
    await tick()
    extension.hangUp()
    await expect(pending).rejects.toThrow(/closed the connection/)

    void extension.fetch('https://www.youtube.com/')
    await tick()
    expect(extension.connects()).toBe(2)
  })

  it('tells the extension to stop when the page aborts', async () => {
    const extension = fakeExtension()
    const controller = new AbortController()
    const pending = extension.fetch('https://www.youtube.com/', { signal: controller.signal })
    await tick()
    controller.abort()
    await expect(pending).rejects.toThrow(/aborted/)
    expect(extension.sent.at(-1)).toEqual({ type: 'abort', id: 0 })
  })

  it('ignores a message for a request it is not waiting on', async () => {
    const extension = fakeExtension()
    const pending = extension.fetch('https://www.youtube.com/')
    await tick()
    extension.answer({ type: 'end', id: 99 })
    extension.answer({ nonsense: true })
    extension.answer({ type: 'head', id: 0, status: 204, statusText: '', headers: [] })
    extension.answer({ type: 'end', id: 0 })
    expect((await pending).status).toBe(204)
  })
})
