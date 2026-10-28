import type {
  AiSetup,
  ArtistJoinNames,
  AskReply,
  AskRequest,
  ImportNames,
  ImportNamesRequest,
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
  AskTurn,
} from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { LyricsSearchRepository } from '../repositories/lyricsSearch.js'
import type { NamesRepository } from '../repositories/names.js'
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
import { AskProgress, type Seen } from './progress.js'
import { describe, type DescribeInput } from './describe.js'
import { fixSong } from './fixSong.js'
import { refine } from './refine.js'
import { noLlm, openAiCompatible, Remembered, type GenerateRequest, type Llm } from './llm.js'
import { importNames } from './importNames.js'
import {
  catalogueFinder,
  listingFinder,
  type FindListings,
  type FindNames,
  type MetadataLookup,
} from './names.js'
import { tidy } from './tidy.js'
import { written } from './written.js'
import { tagReview } from './tagReview.js'
import { METRIC, type ServerMetrics } from '../services/metrics.js'

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
    artistNames?: () => ArtistJoinNames
    spellings?: AskDeps['spellings']
    sound?: AskDeps['sound']
    stats: (range: Stats['range'], top?: number) => Stats
    lyrics: (query: string) => { songId: number; line: string }[]
    wrapped: (range: WrappedRange) => Wrapped
    playlists?: () => readonly AskPlaylist[]
    findNames?: FindNames
    findListings?: FindListings
    notes?: () => readonly string[]
    catalogue?: AskDeps['catalogue']
    web?: () => boolean
    music?: AskDeps['music']
    lookup?: MetadataLookup
    /** Whether answers are kept a while for the same question; the eval asks afresh each time. */
    remember?: boolean
  }) {
    const { remember = true, ...rest } = deps
    this.#deps = { ...rest, remembered: new Remembered(remember ? undefined : 0) }
  }

  describe(request: DescribeInput, signal?: AbortSignal): Promise<DescribeResult> {
    return describe(this.#stoppedBy(signal), request)
  }

  ask(
    text: string,
    where: AskRequest['context'] = { playing: null, screen: null },
    ticket?: string,
    before: readonly AskTurn[] = [],
    /** Fires when the device's connection closes: with a ticket, the answer goes on a while without it. */
    signal?: AbortSignal,
  ): Promise<AskReply> {
    return this.#progress.outlast(ticket, signal, (steps, stop) =>
      ask(this.#stoppedBy(stop), text, where, steps, before),
    )
  }

  /** Stop pressed on an Ask that may have outlasted its connection. */
  stopAsk(ticket: string): void {
    this.#progress.stop(ticket)
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
  askProgress(ticket: string): Seen {
    return this.#progress.seen(ticket)
  }

  /** Where the server asks, for Settings: no call is made. */
  setup(): AiSetup {
    return this.#deps.setup
  }

  /** A5 · the Report in a few sentences; `again` writes it afresh. */
  written(range: WrappedRange, again = false, signal?: AbortSignal): Promise<WrittenReport> {
    return written(this.#stoppedBy(signal), range, again)
  }

  /** Fix metadata's Suggested card: one song's names from the catalogues (`fixSong.ts`). */
  fixSong(song: Song, again = false, signal?: AbortSignal): Promise<MetadataSuggestion> {
    return fixSong(this.#stoppedBy(signal), song, again)
  }

  /** A4 · Tidy up: the names that look wrong, as changes to approve. */
  tidy(signal?: AbortSignal): Promise<TidyResult> {
    return tidy(this.#stoppedBy(signal))
  }

  /** A9 · an import review's rows read for names that look wrong (`importNames.ts`). */
  importNames(request: ImportNamesRequest, signal?: AbortSignal): Promise<ImportNames> {
    return importNames(this.#stoppedBy(signal), request)
  }

  /** Tags for the songs without one, as changes to approve (Tags' untagged card). */
  untaggedTags(): Promise<TagReview> {
    this.#untagged ??= tagReview(this.#deps, { text: null }).finally(() => {
      this.#untagged = null
    })
    return this.#untagged
  }
}

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
 * them. The eval harness (`eval/run.ts`) builds them here too, so what it
 * measures is what a device would be answered — catalogues, standing notes
 * and the web included.
 */
export function smartFeaturesFor(sources: {
  readonly config: Pick<Config, 'ai'>
  readonly logger: Logger
  readonly songs: Pick<SongRepository, 'all'>
  readonly tags: Pick<TagRepository, 'all'>
  /** Artists' other names, which join one artist's spellings. */
  readonly names?: Pick<NamesRepository, 'joinNames' | 'spellings'>
  /** The listening model, for Ask's songs in the order they sound (sound/sound.ts). */
  readonly sound?: AskDeps['sound']
  readonly stats: Pick<StatsRepository, 'build'>
  readonly wrapped: Pick<WrappedRepository, 'build'>
  readonly playlists: Pick<PlaylistRepository, 'all' | 'songIds'>
  readonly lyricsSearch: Pick<LyricsSearchRepository, 'search'>
  readonly settings: Pick<SettingsRepository, 'get'>
  readonly netease: Pick<NeteaseMusic, 'search' | 'searchAlbums' | 'albumTracks'>
  readonly lookup: Pick<MetadataLookupService, 'lookup'>
  /** Where each request is counted for the owner's admin page; left out by the eval. */
  readonly metrics?: Pick<ServerMetrics, 'count'>
  /** The model in place of the configured one: the eval's, watched for its calls, or a test's. */
  readonly llm?: Llm
  /** False for the eval, so a question asked again is answered again (`Remembered`). */
  readonly remember?: boolean
}): SmartFeatures {
  const { config, logger, songs, tags, stats, wrapped, playlists, settings, netease } = sources
  const lookup: MetadataLookup = query => sources.lookup.lookup(query)
  const catalogue = (words: string) => netease.search(words)
  const llm = sources.llm ?? llmFor(config, logger)
  return new SmartFeatures({
    llm: sources.metrics ? counted(llm, sources.metrics) : llm,
    remember: sources.remember ?? true,
    setup: setupFor(config),
    songs: () => songs.all(),
    tags: () => tags.all(),
    artistNames: sources.names ? () => sources.names!.joinNames() : undefined,
    spellings: sources.names ? () => sources.names!.spellings() : undefined,
    sound: sources.sound,
    stats: (range, top) => stats.build(range, undefined, top ?? null),
    lyrics: query =>
      sources.lyricsSearch.search(query).map(row => ({ songId: row.song_id, line: row.line })),
    wrapped: range => wrapped.build(range),
    playlists: () =>
      playlists.all().map(playlist => ({
        name: playlist.name,
        kind: playlist.kind,
        rules: playlist.rules,
        songIds: () => playlists.songIds(playlist),
      })),
    notes: () => settings.get().smartNotes,
    catalogue,
    // Smart features include the web: the model looks there when the library and catalogues don't say.
    web: () => true,
    music: {
      albums: words => netease.searchAlbums(words),
      albumTracks: id => netease.albumTracks(id),
      songs: catalogue,
    },
    findNames: catalogueFinder({ netease: catalogue, lookup }),
    findListings: listingFinder({ netease: catalogue, lookup }),
    lookup,
  })
}

/**
 * The model, with every request counted for the admin page: by feature (a
 * task's first word: `ask-route` is Ask), how long it took, and whether it
 * failed. Counted, not logged: nothing of what was asked is kept.
 */
function counted(llm: Llm, metrics: Pick<ServerMetrics, 'count'>): Llm {
  return {
    generate: async request => {
      const feature = request.task.split('-')[0] ?? request.task
      metrics.count(METRIC.smart(feature))
      const started = Date.now()
      try {
        return await llm.generate(request)
      } catch (error) {
        metrics.count(METRIC.smartFailed)
        throw error
      } finally {
        metrics.count(METRIC.smartMs, Date.now() - started)
      }
    },
  }
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
