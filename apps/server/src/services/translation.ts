import type { SecretProvider, TranslatedLyrics } from '@selfmp3/shared'
import type { Logger } from '../logger.js'
import type { SecretsRepository } from '../repositories/secrets.js'
import { toLyricLines } from './romanization.js'

/**
 * Lyric translation through an optional API.
 *
 * The whole song goes in one request: every non-blank line, numbered, with an
 * instruction to return exactly the same numbered list. The response is
 * validated for count and coverage and the request is retried once, because a
 * model that merges two lines or skips a chorus repeat produces a result that
 * cannot be lined up under the original — and misaligned is worse than none.
 */

const ANTHROPIC_MODEL = 'claude-sonnet-4-5'
const OPENAI_MODEL = 'gpt-4o-mini'
const REQUEST_TIMEOUT_MS = 60_000
const MAX_LINES = 400

export class TranslationError extends Error {
  readonly code: 'no_provider' | 'no_key' | 'provider_failed' | 'bad_response'

  constructor(code: TranslationError['code'], message: string) {
    super(message)
    this.name = 'TranslationError'
    this.code = code
  }
}

/** A line worth translating: has text, and is not just a "♪" placeholder. */
export function translatableIndexes(texts: readonly string[]): number[] {
  const out: number[] = []
  texts.forEach((text, index) => {
    if (/[\p{L}\p{N}]/u.test(text)) out.push(index)
  })
  return out
}

export function buildTranslationPrompt(lines: readonly string[], lang: string): string {
  const numbered = lines.map((line, index) => `${index + 1}. ${line}`).join('\n')
  return (
    `Translate these song lyrics into the language with code "${lang}". ` +
    `There are exactly ${lines.length} numbered lines. Reply with exactly ${lines.length} lines, ` +
    `each in the form "N. translation", one per input line, in the same order, and nothing else — ` +
    `no title, no notes, no blank lines. Keep repeated lines repeated. Translate meaning naturally ` +
    `as sung lyrics; do not romanize or explain.\n\n${numbered}`
  )
}

/**
 * Parse `N. text` lines back into an array aligned with the request.
 *
 * Returns null when the reply cannot be trusted: a missing or duplicated
 * number, a count mismatch, or no numbered lines at all.
 */
export function parseTranslationResponse(text: string, expected: number): string[] | null {
  const out = new Array<string | null>(expected).fill(null)
  let seen = 0
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*(\d{1,4})\s*[.):：]\s*(.*)$/.exec(raw)
    if (!match) continue
    const index = Number(match[1]) - 1
    if (index < 0 || index >= expected || out[index] !== null) return null
    out[index] = (match[2] ?? '').trim()
    seen++
  }
  if (seen !== expected) return null
  return out.map(line => line ?? '')
}

export class TranslationService {
  readonly #secrets: SecretsRepository
  readonly #logger: Logger
  readonly #fetch: typeof fetch

  constructor(secrets: SecretsRepository, logger: Logger, fetchImpl: typeof fetch = fetch) {
    this.#secrets = secrets
    this.#logger = logger.child('translate')
    this.#fetch = fetchImpl
  }

  async translate(
    text: string,
    lang: string,
    provider: SecretProvider,
  ): Promise<TranslatedLyrics> {
    const key = this.#secrets.apiKey(provider)
    if (!key) throw new TranslationError('no_key', `no API key stored for ${provider}`)

    const { synced, lines } = toLyricLines(text)
    const texts = lines.map(line => line.text)
    const indexes = translatableIndexes(texts).slice(0, MAX_LINES)
    const source = indexes.map(index => texts[index] ?? '')

    let translated: string[] = []
    if (source.length > 0) {
      const prompt = buildTranslationPrompt(source, lang)
      let parsed: string[] | null = null
      // One retry: a count mismatch is usually a one-off, not a hard failure.
      for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
        const reply = await this.#complete(provider, key, prompt)
        parsed = parseTranslationResponse(reply, source.length)
        if (parsed === null) {
          this.#logger.warn('translation reply did not line up', { provider, attempt })
        }
      }
      if (parsed === null) {
        throw new TranslationError('bad_response', 'the translation could not be lined up')
      }
      translated = parsed
    }

    const byIndex = new Map(indexes.map((index, i) => [index, translated[i] ?? '']))
    return {
      lang,
      provider,
      synced,
      lines: lines.map((line, index) => ({
        time: line.time,
        text: line.text,
        translation: byIndex.get(index) ?? '',
      })),
    }
  }

  async #complete(provider: SecretProvider, key: string, prompt: string): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const request: { url: string; headers: Record<string, string>; body: unknown } =
        provider === 'anthropic'
          ? {
              url: 'https://api.anthropic.com/v1/messages',
              headers: {
                'content-type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
              },
              body: {
                model: ANTHROPIC_MODEL,
                max_tokens: 8_000,
                messages: [{ role: 'user', content: prompt }],
              },
            }
          : {
              url: 'https://api.openai.com/v1/chat/completions',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${key}`,
              },
              body: {
                model: OPENAI_MODEL,
                messages: [{ role: 'user', content: prompt }],
              },
            }

      const response = await this.#fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        this.#logger.warn('provider request failed', {
          provider,
          status: response.status,
          detail: detail.slice(0, 300),
        })
        throw new TranslationError('provider_failed', `${provider} returned ${response.status}`)
      }
      const payload: unknown = await response.json()
      return extractText(provider, payload)
    } catch (error) {
      if (error instanceof TranslationError) throw error
      throw new TranslationError(
        'provider_failed',
        error instanceof Error ? error.message : 'request failed',
      )
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Pull the text out of either provider's response shape. */
export function extractText(provider: SecretProvider, payload: unknown): string {
  const data = payload as Record<string, unknown>
  if (provider === 'anthropic') {
    const content = data['content']
    if (Array.isArray(content)) {
      return content
        .map(block => (block as { type?: string; text?: string }))
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
    }
    return ''
  }
  const choices = data['choices']
  if (Array.isArray(choices)) {
    const first = choices[0] as { message?: { content?: unknown } } | undefined
    const content = first?.message?.content
    return typeof content === 'string' ? content : ''
  }
  return ''
}
