import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { tagArgs, TagWriter } from './tagWriter.js'

const TAGS = { title: '晴天', artist: '周杰倫', album: '葉惠美', date: '2003-07-29' }

describe('tagArgs', () => {
  it('copies the audio and names every tag it has', () => {
    const args = tagArgs('in.m4a', 'out.m4a', TAGS, null)
    expect(args).toEqual(expect.arrayContaining(['-c:a', 'copy', '-map', '0:a', '-f', 'mp4']))
    expect(args).toEqual(
      expect.arrayContaining(['title=晴天', 'artist=周杰倫', 'album=葉惠美', 'date=2003-07-29']),
    )
    expect(args.at(-1)).toBe('out.m4a')
  })

  it('leaves out a tag it has nothing for', () => {
    const args = tagArgs('in.m4a', 'out.m4a', { ...TAGS, album: '', date: null }, null)
    expect(args.some(arg => arg.startsWith('album='))).toBe(false)
    expect(args.some(arg => arg.startsWith('date='))).toBe(false)
  })

  it('puts the cover in as the file’s picture, made a JPEG', () => {
    const args = tagArgs('in.m4a', 'out.m4a', TAGS, 'cover.webp')
    expect(args).toEqual(
      expect.arrayContaining([
        '-i',
        'cover.webp',
        '-map',
        '1:v',
        '-c:v',
        'mjpeg',
        '-disposition:v:0',
        'attached_pic',
      ]),
    )
  })
})

/** Whether ffmpeg and ffprobe are on this machine; the file tests need both. */
function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!hasFfmpeg())('TagWriter, with ffmpeg', () => {
  let dir: string
  let song: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-tags-'))
    song = path.join(dir, 'song.m4a')
    execFileSync('ffmpeg', [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', song],
    ])
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** The file's tags and whether it carries a picture, as ffprobe reads them. */
  function probe(file: string): { tags: Record<string, string>; picture: boolean } {
    const out = execFileSync('ffprobe', [
      ...['-v', 'error', '-of', 'json'],
      ...['-show_entries', 'format_tags:stream=codec_type:stream_disposition=attached_pic', file],
    ])
    const parsed = JSON.parse(out.toString()) as {
      format: { tags?: Record<string, string> }
      streams: { codec_type: string; disposition?: { attached_pic?: number } }[]
    }
    return {
      tags: parsed.format.tags ?? {},
      picture: parsed.streams.some(stream => stream.disposition?.attached_pic === 1),
    }
  }

  it('writes the tags and the cover into the file', async () => {
    const cover = path.join(dir, 'cover.png')
    execFileSync('ffmpeg', [
      ...['-hide_banner', '-loglevel', 'error', '-y'],
      ...['-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1', cover],
    ])
    const bytes = fs.readFileSync(cover)
    const fetch = (() => Promise.resolve(new Response(bytes))) as typeof globalThis.fetch
    const writer = new TagWriter({ fetch, logger: createLogger('silent') })

    expect(await writer.write(song, TAGS, 'https://lh3.googleusercontent.com/abc=w544')).toBe(true)

    const { tags, picture } = probe(song)
    expect(tags).toMatchObject({
      title: '晴天',
      artist: '周杰倫',
      album: '葉惠美',
      date: '2003-07-29',
    })
    expect(picture).toBe(true)
    // Nothing left beside it.
    expect(fs.readdirSync(dir).sort()).toEqual(['cover.png', 'song.m4a'])
  })

  it('tags the file without a cover that did not come', async () => {
    const fetch = (() =>
      Promise.resolve(new Response('', { status: 404 }))) as typeof globalThis.fetch
    const writer = new TagWriter({ fetch, logger: createLogger('silent') })

    expect(await writer.write(song, TAGS, 'https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe(true)

    const { tags, picture } = probe(song)
    expect(tags.title).toBe('晴天')
    expect(picture).toBe(false)
  })

  it('does not read a cover larger than any cover', async () => {
    const big = new Response(new Uint8Array(16), {
      headers: { 'content-length': String(64 * 1024 * 1024) },
    })
    let read = false
    Object.defineProperty(big, 'arrayBuffer', {
      value: () => ((read = true), Promise.reject(new Error('read'))),
    })
    const fetch = (() => Promise.resolve(big)) as typeof globalThis.fetch
    const writer = new TagWriter({ fetch, logger: createLogger('silent') })

    expect(await writer.write(song, TAGS, 'https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe(true)
    expect(probe(song).picture).toBe(false)
    expect(read).toBe(false)
  })

  it('leaves a file it cannot read as it was, and says so', async () => {
    fs.writeFileSync(song, 'not audio')
    const writer = new TagWriter({ logger: createLogger('silent') })
    expect(await writer.write(song, TAGS, null)).toBe(false)
    expect(fs.readFileSync(song, 'utf8')).toBe('not audio')
  })
})
