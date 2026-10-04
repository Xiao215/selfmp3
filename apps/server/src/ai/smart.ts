import type { DescribeRequest, DescribeResult, Song, Tag, TagSuggestions } from '@selfmp3/shared'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import { describe } from './describe.js'
import { noLlm, openAiCompatible, Remembered, type Llm } from './llm.js'
import { suggestTags } from './suggestTags.js'

/**
 * The smart features as the rest of the server sees them: one object, built
 * once in the container, with the model behind it chosen by configuration.
 */
export class SmartFeatures {
  readonly #deps: { llm: Llm; songs: () => Song[]; tags: () => Tag[]; remembered: Remembered }
  /** One Suggest tags pass at a time: a second press joins the first. */
  #suggesting: Promise<TagSuggestions> | null = null

  constructor(deps: { llm: Llm; songs: () => Song[]; tags: () => Tag[] }) {
    this.#deps = { ...deps, remembered: new Remembered() }
  }

  describe(request: DescribeRequest): Promise<DescribeResult> {
    return describe(this.#deps, request)
  }

  suggestTags(): Promise<TagSuggestions> {
    this.#suggesting ??= suggestTags(this.#deps).finally(() => {
      this.#suggesting = null
    })
    return this.#suggesting
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
