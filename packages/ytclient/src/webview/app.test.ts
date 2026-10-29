import { describe, expect, it } from 'vitest'
import { bytesToBase64 } from '@selfmp3/shared'
import { createWebViewCore } from './app.js'
import type { AppMessage, PageMessage } from './protocol.js'

const META = { description: '', title: 'Song', author: 'Artist', durationSeconds: 3 }

function page() {
  const asked: AppMessage[] = []
  const core = createWebViewCore(message => asked.push(message))
  const say = (message: PageMessage) => core.receive(JSON.stringify(message))
  return { core, asked, say }
}

describe('the phone’s side of its YouTube page', () => {
  it('is ready once the page says so', async () => {
    const { core, say } = page()
    say({ kind: 'ready' })
    await expect(core.ready).resolves.toBeUndefined()
  })

  it('puts a file back together from its chunks, and follows its progress', async () => {
    const { core, asked, say } = page()
    const seen: number[] = []
    const coming = core.download('https://www.youtube.com/watch?v=aaaaaaaaaaa', p => seen.push(p))
    expect(asked).toEqual([
      { kind: 'download', id: 0, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' },
    ])
    say({ kind: 'progress', id: 0, percent: 50 })
    say({ kind: 'chunk', id: 0, data: bytesToBase64(new Uint8Array([1, 2, 3])) })
    say({ kind: 'chunk', id: 0, data: bytesToBase64(new Uint8Array([4, 5])) })
    say({ kind: 'downloaded', id: 0, size: 5, sha256: 'abc', meta: META })
    const file = await coming
    expect([...file.bytes]).toEqual([1, 2, 3, 4, 5])
    expect(file).toMatchObject({ mimeType: 'audio/mp4', sha256: 'abc', meta: META })
    expect(seen).toEqual([50])
  })

  it('refuses a file that came short', async () => {
    const { core, say } = page()
    const coming = core.download('https://www.youtube.com/watch?v=aaaaaaaaaaa', () => undefined)
    say({ kind: 'chunk', id: 0, data: bytesToBase64(new Uint8Array([1])) })
    say({ kind: 'downloaded', id: 0, size: 5, sha256: 'abc', meta: META })
    await expect(coming).rejects.toThrow(/1 of the song's 5 bytes/)
  })

  it('answers a description, and a failure, each to its own question', async () => {
    const { core, say } = page()
    const facts = core.describe('https://www.youtube.com/watch?v=aaaaaaaaaaa')
    const broken = core.describe('https://www.youtube.com/watch?v=bbbbbbbbbbb')
    say({ kind: 'failed', id: 1, message: 'Video unavailable' })
    say({
      kind: 'described',
      id: 0,
      facts: { title: 'Song', author: 'A', durationSeconds: 3, description: '', thumbnail: null },
    })
    await expect(facts).resolves.toMatchObject({ title: 'Song' })
    await expect(broken).rejects.toThrow('Video unavailable')
  })

  it('fails everything waiting when the page goes', async () => {
    const { core } = page()
    const coming = core.download('https://www.youtube.com/watch?v=aaaaaaaaaaa', () => undefined)
    core.lost('the page closed')
    await expect(coming).rejects.toThrow('the page closed')
    await expect(core.ready).rejects.toThrow('the page closed')
  })

  it('ignores what is not a message', () => {
    const { core } = page()
    expect(() => core.receive('not json')).not.toThrow()
  })
})
