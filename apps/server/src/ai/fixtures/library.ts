import type { Song, Tag } from '@selfmp3/shared'
import { createLogger } from '../../logger.js'
import { openAiCompatible, type GenerateRequest, type Llm } from '../llm.js'

/**
 * A small library shaped like a real one, and a model that answers from a
 * script, for the smart features' tests.
 */

export function song(
  id: number,
  overrides: Partial<Song> & { energy?: number | null; bpm?: number | null } = {},
): Song {
  const { energy = null, bpm = null, ...rest } = overrides
  return {
    id,
    path: `song-${id}.m4a`,
    title: `Song ${id}`,
    artist: 'Someone',
    album: '',
    albumArtist: '',
    trackNo: null,
    year: null,
    duration: 200,
    sizeBytes: 1000,
    mime: 'audio/mp4',
    hasArt: false,
    coverTone: null,
    rev: '1',
    lyricsKind: 'none',
    instrumental: false,
    playCount: 0,
    loved: false,
    restUntil: null,
    sourceUrl: null,
    lastPlayedAt: null,
    addedAt: '2026-09-01 10:00:00',
    tagIds: [],
    audioFeatures:
      energy === null && bpm === null
        ? null
        : {
            bpm,
            energy,
            loudnessLufs: null,
            key: null,
            camelot: null,
            danceability: null,
            analyzedAt: '2026-09-02 10:00:00',
            version: 1,
          },
    ...rest,
  }
}

export const TAGS: Tag[] = [
  { id: 1, name: '古典', hue: 92, songCount: 3 },
  { id: 2, name: '原神纯音乐', hue: 28, songCount: 3 },
  { id: 3, name: 'jpop', hue: 231, songCount: 3 },
  { id: 4, name: '中文流行', hue: 85, songCount: 1 },
]

export const SONGS: Song[] = [
  song(1, {
    title: 'Nocturne Op. 27 No. 1',
    artist: 'Vitaly Margulis, Frédéric Chopin',
    album: 'Best of Chopin',
    tagIds: [1],
    energy: 0.1,
    bpm: 112,
  }),
  song(2, {
    title: 'Prelude Op. 28 No. 15 “Raindrop”',
    artist: 'Henrik Måwe, Frédéric Chopin',
    album: 'Best of Chopin',
    tagIds: [1],
    energy: 0.44,
    bpm: 118,
  }),
  song(3, {
    title: 'Polonaise “Heroic”',
    artist: 'Henrik Måwe, Frédéric Chopin',
    album: 'Best of Chopin',
    tagIds: [1],
    energy: 0.56,
    bpm: 143,
  }),
  song(4, {
    title: 'Dream Aria',
    year: 2020,
    artist: 'Yu-Peng Chen, HOYO-MiX',
    album: 'The Wind and the Star Traveler',
    tagIds: [2],
    energy: 0.37,
    bpm: 123,
    lastPlayedAt: '2026-10-01 10:00:00',
    playCount: 1,
  }),
  song(5, {
    title: 'Liyue',
    year: 2020,
    artist: 'Yu-Peng Chen, HOYO-MiX',
    album: 'Jade Moon Upon a Sea of Clouds',
    tagIds: [2],
    energy: 0.61,
    bpm: 112,
  }),
  song(6, {
    title: 'Light Glimmers as Shadows Shift',
    year: 2024,
    artist: 'HOYO-MiX',
    album: 'Where Mercy Endures',
    tagIds: [2],
    energy: 0.5,
    bpm: 120,
  }),
  song(7, {
    title: 'アイドル',
    year: 2023,
    artist: 'YOASOBI',
    album: 'アイドル',
    tagIds: [3],
    lyricsKind: 'synced',
    energy: 0.9,
    bpm: 166,
  }),
  song(8, {
    title: '夜に駆ける',
    year: 2021,
    artist: 'YOASOBI',
    album: 'THE BOOK',
    tagIds: [3],
    lyricsKind: 'synced',
    energy: 0.85,
    bpm: 130,
  }),
  song(9, {
    title: 'アポリア',
    year: 2023,
    artist: 'Yorushika',
    album: 'second person',
    tagIds: [3],
    lyricsKind: 'synced',
    energy: 0.7,
    bpm: 140,
  }),
  song(10, {
    title: '丑八怪',
    artist: '甘世佳, 李荣浩, 薛之谦',
    album: '意外',
    tagIds: [4],
    lyricsKind: 'synced',
    energy: 0.63,
  }),
  // Untagged.
  song(11, {
    title: 'Watashino Uso - PianoSolo',
    artist: 'Masaru Yokoyama',
    album: 'Your Lie in April',
    energy: 0.31,
    bpm: 89,
  }),
  song(12, {
    title: 'Grande valse brilliante',
    artist: 'Henrik Måwe',
    album: 'Best of Chopin',
    energy: 0.53,
  }),
  song(13, {
    title: 'Prostitution',
    artist: 'Yorushika',
    album: 'Plagiarism',
    lyricsKind: 'synced',
  }),
  song(14, {
    title: '七里香',
    artist: '周杰倫',
    album: '七里香',
    lyricsKind: 'synced',
    energy: 0.5,
  }),
  song(15, { title: '外婆', artist: '周杰倫', album: '七里香', lyricsKind: 'synced', energy: 0.7 }),
  song(16, {
    title: '晴天',
    artist: '周杰倫, 周杰倫',
    album: '葉惠美',
    lyricsKind: 'synced',
    energy: 0.55,
  }),
  song(17, { title: 'Cantata of Fontaine', artist: 'HOYO-MiX', album: '枫丹', energy: 0.4 }),
]

/**
 * A model that answers each task from a list, in order, and records what it
 * was asked. A reply that is an Error is thrown.
 */
export function scriptedLlm(
  replies: Record<string, unknown[]>,
): Llm & { asked: GenerateRequest<unknown>[] } {
  const asked: GenerateRequest<unknown>[] = []
  return {
    asked,
    async generate<T>(request: GenerateRequest<T>) {
      asked.push(request as GenerateRequest<unknown>)
      const next = replies[request.task]?.shift()
      if (next === undefined) throw new Error(`nothing scripted for ${request.task}`)
      if (next instanceof Error) throw next
      return { value: request.schema.parse(next), ms: 1 }
    },
  }
}

/** A scripted reply that calls tools instead of answering: each call's tool name and arguments. */
interface ScriptedCalls {
  readonly calls: readonly { readonly name: string; readonly args: unknown }[]
}

/** How many fake endpoints there have been, for each its own address. */
let fakes = 0

/** What one request to the fake endpoint carried. */
interface Sent {
  readonly messages: { role: string; content: string | null; tool_call_id?: string }[]
  readonly tool_choice?: string
}

/**
 * A model behind a real OpenAI-style endpoint, faked only at its HTTP door:
 * each request is answered with the next reply scripted for its task (the
 * schema's name), as chat-completion JSON, so `llm.ts` parses and checks it
 * exactly as it would a real one's. A number answers with that HTTP status;
 * `{ calls }` answers with tool calls, all in one reply. `prompts` keeps what
 * each task was asked, in order, and `sent` every request whole, tool results
 * and all. `concurrency` is the endpoint's gate (`llm.ts`).
 */
export function endpointLlm(
  replies: Record<string, (unknown | ScriptedCalls)[]>,
  options: { concurrency?: number; delayMs?: number } = {},
): Llm & { prompts: Record<string, string[]>; sent: Record<string, Sent[]>; most: () => number } {
  const prompts: Record<string, string[]> = {}
  const sent: Record<string, Sent[]> = {}
  let inFlight = 0
  let most = 0
  const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as Sent & {
      response_format: { json_schema: { name: string } }
    }
    const task = body.response_format.json_schema.name
    ;(prompts[task] ??= []).push(body.messages.find(each => each.role === 'user')?.content ?? '')
    ;(sent[task] ??= []).push(body)
    inFlight++
    most = Math.max(most, inFlight)
    try {
      if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs))
      const next = replies[task]?.shift()
      if (next === undefined) return new Response(`nothing scripted for ${task}`, { status: 500 })
      if (typeof next === 'number') return new Response('scripted failure', { status: next })
      const message =
        next !== null && typeof next === 'object' && 'calls' in next
          ? {
              content: null,
              tool_calls: (next as ScriptedCalls).calls.map((call, index) => ({
                id: `call-${index}`,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }
          : { content: JSON.stringify(next) }
      return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 })
    } finally {
      inFlight--
    }
  }
  const llm = openAiCompatible(
    {
      // Its own address per fake, so each has a gate of its own.
      baseUrl: `http://127.0.0.1:9/${++fakes}/v1`,
      apiKey: null,
      models: { fast: 'fast', smart: 'smart' },
      timeoutMs: 5000,
      ...(options.concurrency ? { concurrency: options.concurrency } : {}),
    },
    { fetch, logger: createLogger('silent') },
  )
  return { ...llm, prompts, sent, most: () => most }
}
