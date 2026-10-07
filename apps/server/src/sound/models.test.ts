import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.js'
import { SOUND_MODEL, SoundModelFiles, type ModelFile } from './models.js'

const logger = createLogger('silent')

/** Two small files standing in for the model's. */
const CONTENTS = { 'a.onnx': 'the first graph', 'tokenizer.json': '{"ids":[]}' }
const FILES: ModelFile[] = Object.entries(CONTENTS).map(([name, text]) => ({
  name,
  bytes: Buffer.byteLength(text),
  sha256: createHash('sha256').update(text).digest('hex'),
}))

describe('SoundModelFiles', () => {
  let dataDir: string
  let asked: string[]

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-models-'))
    asked = []
  })
  afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }))

  /** A release that serves the files, or the bodies given instead. */
  const release =
    (bodies: Record<string, string> = CONTENTS): typeof fetch =>
    input => {
      const name = String(input).split('/').pop()!
      asked.push(name)
      const body = bodies[name as keyof typeof bodies]
      return Promise.resolve(
        body === undefined ? new Response('gone', { status: 404 }) : new Response(body),
      )
    }

  const files = (
    fetchFn: typeof fetch,
    models = 'https://example.test/releases/m',
  ): SoundModelFiles =>
    new SoundModelFiles({
      config: { dataDir, sound: { enabled: true, models, threads: 1 } },
      logger,
      fetch: fetchFn,
      files: FILES,
    })

  it('downloads each file once, checks its hash and says where they are', async () => {
    const models = files(release())
    const dir = await models.ensure()
    expect(dir).toBe(path.join(dataDir, 'models', SOUND_MODEL.name))
    expect(fs.readFileSync(path.join(dir!, 'a.onnx'), 'utf8')).toBe('the first graph')
    expect(models.state).toBe('ready')
    expect(asked).toEqual(['a.onnx', 'tokenizer.json'])

    // A later start finds them checked already and fetches nothing.
    asked = []
    expect(await files(release()).ensure()).toBe(dir)
    expect(asked).toEqual([])
  })

  it('throws away a file that arrives different, and says so', async () => {
    const models = files(release({ ...CONTENTS, 'a.onnx': 'something else!' }))
    expect(await models.ensure()).toBeNull()
    expect(models.state).toBe('failed')
    expect(models.message).toBe('a.onnx arrived different from the file it should be')
    expect(fs.existsSync(path.join(dataDir, 'models', SOUND_MODEL.name, 'a.onnx'))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, 'models', SOUND_MODEL.name, 'a.onnx.part'))).toBe(false)
  })

  it('waits an hour after a failed download before trying again', async () => {
    const models = files(release({}))
    expect(await models.ensure()).toBeNull()
    expect(models.message).toBe('downloading a.onnx failed: 404 ')
    asked = []
    expect(await models.ensure(Date.now() + 60_000)).toBeNull()
    expect(asked).toEqual([])
    expect(models.retryAt).toBeGreaterThan(Date.now() + 59 * 60_000)
  })

  it('uses a folder that holds the files already, as an export leaves them', async () => {
    const folder = path.join(dataDir, 'export')
    fs.mkdirSync(folder)
    for (const [name, text] of Object.entries(CONTENTS))
      fs.writeFileSync(path.join(folder, name), text)
    expect(await files(release(), folder).ensure()).toBe(folder)
    expect(asked).toEqual([])

    fs.rmSync(path.join(folder, 'tokenizer.json'))
    const missing = files(release(), folder)
    expect(await missing.ensure()).toBeNull()
    expect(missing.message).toMatch(/tokenizer\.json is missing/)
  })
})
