import { z } from 'zod/v4'
import type {
  AiCheck,
  AiSetup,
  AskAnswer,
  TidyResult,
  Wrapped,
  WrappedRange,
  WrittenReport,
  DescribeRequest,
  DescribeResult,
  Stats,
  Song,
  Tag,
  TagSuggestions,
} from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import { ask, type AskDeps } from './ask.js'
import { describe } from './describe.js'
import { LlmError, llmFailureWords, noLlm, openAiCompatible, Remembered, type Llm } from './llm.js'
import { tidy } from './tidy.js'
import { written } from './written.js'
import { suggestTags } from './suggestTags.js'

/**
 * The smart features as the rest of the server sees them: one object, built
 * once in the container, with the model behind it chosen by configuration.
 */
export class SmartFeatures {
  readonly #deps: AskDeps & {
    remembered: Remembered
    setup: AiSetup
    wrapped: (range: WrappedRange) => Wrapped
  }
  /** One Suggest tags pass at a time: a second press joins the first. */
  #suggesting: Promise<TagSuggestions> | null = null

  constructor(deps: {
    llm: Llm
    setup: AiSetup
    songs: () => Song[]
    tags: () => Tag[]
    stats: (range: Stats['range']) => Stats
    lyrics: (query: string) => { songId: number; line: string }[]
    wrapped: (range: WrappedRange) => Wrapped
  }) {
    this.#deps = { ...deps, remembered: new Remembered() }
  }

  describe(request: DescribeRequest): Promise<DescribeResult> {
    return describe(this.#deps, request)
  }

  ask(
    text: string,
    playing: number | null = null,
    allowed: { tidy: boolean } = { tidy: true },
  ): Promise<AskAnswer> {
    return ask(this.#deps, text, playing, allowed)
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
      if (!(caught instanceof LlmError)) throw caught
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

  /** A4 · Tidy up: the names that look wrong, as changes to approve. */
  tidy(): Promise<TidyResult> {
    return tidy(this.#deps)
  }

  suggestTags(): Promise<TagSuggestions> {
    this.#suggesting ??= suggestTags(this.#deps).finally(() => {
      this.#suggesting = null
    })
    return this.#suggesting
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
