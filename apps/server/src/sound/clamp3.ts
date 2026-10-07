import fsp from 'node:fs/promises'
import path from 'node:path'
import type * as OnnxRuntime from 'onnxruntime-node'
import type { InferenceSession } from 'onnxruntime-node'
import { chunks, encoderFrames, normaliseClip, SOUND_DIMENSIONS, unit } from './vectors.js'

/**
 * CLaMP 3 on onnxruntime: a clip of a song, or a sentence, to a sound vector.
 *
 * Three graphs, as `scripts/sound-models/export.py` makes them: MERT, run once
 * per 5 s chunk of the clip; the audio encoder, over those chunks; and the
 * text encoder. The runtime does its work on threads of its own, so a song
 * being heard does not hold up a request.
 *
 * The listening half (about 210 MB) and the text half (about 535 MB) load
 * separately, when first wanted, and are let go after a quiet spell: a Pi
 * should not carry 750 MB for a search made once an evening.
 */

export interface SoundModel {
  /** A clip at 24 kHz mono (the windows `windowStarts` chose, back to back) to a unit vector. */
  hearClip(pcm: Float32Array): Promise<Float32Array>
  /** A description, in English, to a unit vector in the same space. */
  readText(text: string): Promise<Float32Array>
  /** Let go of whatever is loaded. */
  close(): Promise<void>
}

/** A half that has not been used for this long is unloaded. */
const IDLE_MS = 10 * 60_000

/** A clip longer than a minute is not what this was made for; CLaMP 3 caps a pass at 128 frames. */
const MAX_FRAMES = 128

type Ort = typeof OnnxRuntime

interface Half<T> {
  value: Promise<T> | null
  timer: NodeJS.Timeout | null
}

export class Clamp3 implements SoundModel {
  readonly #dir: string
  readonly #threads: number
  readonly #ort: Promise<Ort>
  readonly #listening: Half<{ mert: InferenceSession; audio: InferenceSession }> = {
    value: null,
    timer: null,
  }
  readonly #reading: Half<{ text: InferenceSession; tokenizer: Tokenize }> = {
    value: null,
    timer: null,
  }
  /** One run at a time: the threads given are the threads used. */
  #queue: Promise<unknown> = Promise.resolve()

  constructor(dir: string, threads: number) {
    this.#dir = dir
    this.#threads = threads
    // Loaded here rather than imported at the top: a platform with no build of
    // the runtime (musl, for one) leaves sound off rather than the server down.
    this.#ort = import('onnxruntime-node')
  }

  hearClip(pcm: Float32Array): Promise<Float32Array> {
    return this.#serial(async () => {
      const ort = await this.#ort
      const { mert, audio } = await this.#use(this.#listening, () => this.#loadListening(ort))
      const perChunk: Float32Array[] = []
      for (const chunk of chunks(normaliseClip(pcm)).slice(0, MAX_FRAMES - 2)) {
        const out = await mert.run({ wav: new ort.Tensor('float32', chunk, [1, chunk.length]) })
        perChunk.push(Float32Array.from(embedding(out)))
      }
      if (perChunk.length === 0) throw new Error('the clip is shorter than a second')
      const { data, frames } = encoderFrames(perChunk)
      const out = await audio.run({
        feats: new ort.Tensor('float32', data, [1, frames, SOUND_DIMENSIONS]),
        mask: new ort.Tensor('int64', new BigInt64Array(frames).fill(1n), [1, frames]),
      })
      return unit(embedding(out))
    })
  }

  readText(text: string): Promise<Float32Array> {
    return this.#serial(async () => {
      const ort = await this.#ort
      const { text: session, tokenizer } = await this.#use(this.#reading, () =>
        this.#loadReading(ort),
      )
      const ids = tokenizer(text)
      const out = await session.run({
        ids: new ort.Tensor('int64', ids, [1, ids.length]),
        mask: new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]),
      })
      return unit(embedding(out))
    })
  }

  async close(): Promise<void> {
    await Promise.all([release(this.#listening), release(this.#reading)])
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work)
    this.#queue = run.catch(() => undefined)
    return run
  }

  /** The half, loaded if it is not, with its idle timer started again. */
  async #use<T extends Record<string, unknown>>(half: Half<T>, load: () => Promise<T>): Promise<T> {
    half.value ??= load()
    if (half.timer) clearTimeout(half.timer)
    half.timer = setTimeout(() => void release(half), IDLE_MS)
    half.timer.unref()
    try {
      return await half.value
    } catch (error) {
      half.value = null
      throw error
    }
  }

  #options(): InferenceSession.SessionOptions {
    return { intraOpNumThreads: this.#threads, interOpNumThreads: 1, executionProviders: ['cpu'] }
  }

  async #loadListening(ort: Ort): Promise<{ mert: InferenceSession; audio: InferenceSession }> {
    const [mert, audio] = await Promise.all([
      ort.InferenceSession.create(path.join(this.#dir, 'mert.onnx'), this.#options()),
      ort.InferenceSession.create(path.join(this.#dir, 'clamp3_audio.onnx'), this.#options()),
    ])
    return { mert, audio }
  }

  async #loadReading(ort: Ort): Promise<{ text: InferenceSession; tokenizer: Tokenize }> {
    const [text, tokenizer] = await Promise.all([
      ort.InferenceSession.create(path.join(this.#dir, 'clamp3_text.onnx'), this.#options()),
      loadTokenizer(this.#dir),
    ])
    return { text, tokenizer }
  }
}

type Tokenize = (text: string) => BigInt64Array

/**
 * XLM-RoBERTa's tokenizer, as CLaMP 3 reads a description: `<s> … </s>`, no
 * padding (the masked mean ignores it), cut at its 128-token limit.
 */
async function loadTokenizer(dir: string): Promise<Tokenize> {
  // The package's own declarations import without file extensions, which
  // NodeNext resolution cannot follow, so they arrive as `any`: the one call
  // made here is typed by hand instead.
  const { Tokenizer } = (await import('@huggingface/tokenizers')) as unknown as {
    Tokenizer: new (json: object, config: object) => { encode(text: string): { ids: number[] } }
  }
  const [json, config] = await Promise.all(
    ['tokenizer.json', 'tokenizer_config.json'].map(
      async name => JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8')) as object,
    ),
  )
  const tokenizer = new Tokenizer(json!, config!)
  return text => {
    const ids = tokenizer.encode(text).ids
    const kept = ids.length > 128 ? [...ids.slice(0, 127), ids[ids.length - 1]!] : ids
    return BigInt64Array.from(kept.map(id => BigInt(id)))
  }
}

function embedding(out: InferenceSession.ReturnType): Float32Array {
  const tensor = out['embedding']
  if (!tensor || !(tensor.data instanceof Float32Array)) {
    throw new Error('the model gave no embedding')
  }
  return tensor.data
}

async function release<T extends Record<string, unknown>>(half: Half<T>): Promise<void> {
  if (half.timer) clearTimeout(half.timer)
  half.timer = null
  const loading = half.value
  half.value = null
  const loaded = await loading?.catch(() => null)
  for (const value of Object.values(loaded ?? {})) {
    if (isSession(value)) await value.release()
  }
}

/** A loaded half holds sessions and, for the text half, the tokenizer function. */
function isSession(value: unknown): value is InferenceSession {
  return typeof value === 'object' && value !== null && 'release' in value
}
