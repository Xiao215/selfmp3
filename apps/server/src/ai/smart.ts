import { z } from 'zod/v4'
import type {
  AiCheck,
  AiSetup,
  AskAnswer,
  TidyResult,
  Wrapped,
  WrappedRange,
  WrittenReport,
  DescribeResult,
  MetadataSuggestion,
  RefineRequest,
  Stats,
  Song,
  Tag,
  TagReview,
} from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { LyricsSearchRepository } from '../repositories/lyricsSearch.js'
import type { PlaylistRepository } from '../repositories/playlists.js'
import type { SettingsRepository } from '../repositories/settings.js'
import type { SongRepository } from '../repositories/songs.js'
import type { StatsRepository } from '../repositories/stats.js'
import type { TagRepository } from '../repositories/tags.js'
import type { WrappedRepository } from '../repositories/wrapped.js'
import type { MetadataLookupService } from '../services/lookup.js'
import type { NeteaseMusic } from '../services/netease.js'
import { ask } from './ask.js'
import type { AskDeps } from './askActions.js'
import type { AskPlaylist } from './askLibrary.js'
import { AskProgress, type Step } from './progress.js'
import { describe, type DescribeInput } from './describe.js'
import { fixSong } from './fixSong.js'
import { refine } from './refine.js'
import {
  LlmError,
  llmFailureWords,
  noLlm,
  openAiCompatible,
  Remembered,
  type GenerateRequest,
  type Llm,
} from './llm.js'
import { catalogueFinder, type FindNames, type MetadataLookup } from './names.js'
import { tidy } from './tidy.js'
import { written } from './written.js'
import { tagReview } from './tagReview.js'

type SmartDeps = AskDeps & {
  remembered: Remembered
  setup: AiSetup
  wrapped: (range: WrappedRange) => Wrapped
  lookup?: MetadataLookup
}

/**
 * The smart features as the rest of the server sees them: one object, built
 * once in the container, with the model behind it chosen by configuration.
 */
export class SmartFeatures {
  readonly #deps: SmartDeps
  readonly #progress = new AskProgress()
  /** One pass over the untagged songs at a time: a second press joins the first. */
  #untagged: Promise<TagReview> | null = null

  constructor(deps: {
    llm: Llm
    setup: AiSetup
    songs: () => Song[]
    tags: () => Tag[]
    sound?: AskDeps['sound']
    stats: (range: Stats['range']) => Stats
    lyrics: (query: string) => { songId: number; line: string }[]
    wrapped: (range: WrappedRange) => Wrapped
    playlists?: () => readonly AskPlaylist[]
    findNames?: FindNames
    notes?: () => readonly string[]
    catalogue?: AskDeps['catalogue']
    web?: () => boolean
    music?: AskDeps['music']
    lookup?: MetadataLookup
  }) {
    this.#deps = { ...deps, remembered: new Remembered() }
  }

  describe(request: DescribeInput): Promise<DescribeResult> {
    return describe(this.#deps, request)
  }

  ask(
    text: string,
    playing: number | null = null,
    allowed: { tidy: boolean; tags: boolean } = { tidy: true, tags: true },
    ticket?: string,
    before: readonly string[] = [],
    signal?: AbortSignal,
  ): Promise<AskAnswer> {
    return ask(
      this.#stoppedBy(signal),
      text,
      playing,
      allowed,
      this.#progress.track(ticket),
      before,
    )
  }

  /** An answer changed after it was given (`refine.ts`). */
  refine(request: RefineRequest, signal?: AbortSignal): Promise<DescribeResult> {
    return refine(this.#stoppedBy(signal), request, this.#progress.track(request.ticket))
  }

  /** The model, for one answer: no more calls once nobody waits for it. */
  #stoppedBy(signal: AbortSignal | undefined): SmartDeps {
    if (!signal) return this.#deps
    const { llm } = this.#deps
    return {
      ...this.#deps,
      llm: { generate: <T>(request: GenerateRequest<T>) => llm.generate({ ...request, signal }) },
    }
  }

  /** How the Ask a ticket names is going (`progress.ts`). */
  askProgress(ticket: string): readonly Step[] {
    return this.#progress.steps(ticket)
  }

  /** Where the server asks, for Settings: no call is made. */
  setup(): AiSetup {
    return this.#deps.setup
  }

  /**
   * Settings' Test: the smallest call that goes the whole way — the fast tier,
   * a JSON schema, the reply checked — so passing means the features can run.
   */
  async check(): Promise<AiCheck> {
    try {
      const { ms } = await this.#deps.llm.generate({
        task: 'check',
        tier: 'fast',
        system: 'You check that a connection works. Reply with JSON only.',
        prompt: 'Reply {"ok": true}.',
        schema: CheckReplySchema,
        timeoutMs: CHECK_TIMEOUT_MS,
      })
      return { ok: true, model: this.#deps.setup.models.fast, ms }
    } catch (caught) {
      // Nothing stops a check: it has no signal.
      if (!(caught instanceof LlmError) || caught.kind === 'stopped') throw caught
      return {
        ok: false,
        failure: caught.kind,
        message: llmFailureWords[caught.kind],
        detail: caught.message,
      }
    }
  }

  /** A5 · the Report in a few sentences; `again` writes it afresh. */
  written(range: WrappedRange, again = false): Promise<WrittenReport> {
    return written(this.#deps, range, again)
  }

  /** Fix metadata's Suggested card: one song's names from the catalogues (`fixSong.ts`). */
  fixSong(song: Song, again = false, signal?: AbortSignal): Promise<MetadataSuggestion> {
    return fixSong(this.#stoppedBy(signal), song, again)
  }

  /** A4 · Tidy up: the names that look wrong, as changes to approve. */
  tidy(): Promise<TidyResult> {
    return tidy(this.#deps)
  }

  /** Tags for the songs without one, as changes to approve (Tags' untagged card). */
  untaggedTags(): Promise<TagReview> {
    this.#untagged ??= tagReview(this.#deps, { text: null }).finally(() => {
      this.#untagged = null
    })
    return this.#untagged
  }
}

/** Long enough for the claude CLI to start a process; short enough to be watched. */
const CHECK_TIMEOUT_MS = 60_000

const CheckReplySchema = z.object({ ok: z.boolean() })

/**
 * The server's settings as Settings shows them. A base URL can carry a user and
 * password, or a key in its query: only the scheme, host and path are shown.
 */
export function setupFor(config: Pick<Config, 'ai'>): AiSetup {
  const { ai } = config
  const models = { fast: ai.modelFast, smart: ai.modelSmart }
  if (!ai.baseUrl) return { address: null, models }
  const url = new URL(ai.baseUrl)
  return { address: `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, ''), models }
}

/**
 * The smart features over this library, wired the one way the server runs
 * them. `eval.ts` builds them here too, so what it prints is what a device
 * would be answered — catalogues, standing notes and the web switch included.
 */
export function smartFeaturesFor(sources: {
  readonly config: Pick<Config, 'ai'>
  readonly logger: Logger
  readonly songs: Pick<SongRepository, 'all'>
  readonly tags: Pick<TagRepository, 'all'>
  /** The listening model, for Ask's songs in the order they sound (sound/sound.ts). */
  readonly sound?: AskDeps['sound']
  readonly stats: Pick<StatsRepository, 'build'>
  readonly wrapped: Pick<WrappedRepository, 'build'>
  readonly playlists: Pick<PlaylistRepository, 'all' | 'songIds'>
  readonly lyricsSearch: Pick<LyricsSearchRepository, 'search'>
  readonly settings: Pick<SettingsRepository, 'get'>
  readonly netease: Pick<NeteaseMusic, 'search' | 'searchAlbums' | 'albumTracks'>
  readonly lookup: Pick<MetadataLookupService, 'lookup'>
}): SmartFeatures {
  const { config, logger, songs, tags, stats, wrapped, playlists, settings, netease } = sources
  const lookup: MetadataLookup = query => sources.lookup.lookup(query)
  const catalogue = (words: string) => netease.search(words)
  return new SmartFeatures({
    llm: llmFor(config, logger),
    setup: setupFor(config),
    songs: () => songs.all(),
    tags: () => tags.all(),
    sound: sources.sound,
    stats: range => stats.build(range),
    lyrics: query =>
      sources.lyricsSearch.search(query).map(row => ({ songId: row.song_id, line: row.line })),
    wrapped: range => wrapped.build(range),
    playlists: () =>
      playlists.all().map(playlist => ({
        name: playlist.name,
        kind: playlist.kind,
        songIds: () => playlists.songIds(playlist),
      })),
    notes: () => settings.get().smartNotes,
    catalogue,
    web: () => settings.get().smartWeb,
    music: {
      albums: words => netease.searchAlbums(words),
      albumTracks: id => netease.albumTracks(id),
      songs: catalogue,
    },
    findNames: catalogueFinder({ netease: catalogue, lookup }),
    lookup,
  })
}

/** The configured model, or the stand-in that says smart features are off. */
export function llmFor(config: Pick<Config, 'ai'>, logger: Logger): Llm {
  const { ai } = config
  if (!ai.baseUrl) return noLlm
  return openAiCompatible(
    {
      baseUrl: ai.baseUrl,
      apiKey: ai.apiKey || null,
      models: { fast: ai.modelFast, smart: ai.modelSmart },
      timeoutMs: ai.timeoutSeconds * 1000,
    },
    { logger },
  )
}
