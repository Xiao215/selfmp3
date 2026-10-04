import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import type { Logger } from '../logger.js'

/**
 * The one door to a language model (docs/features/ai.md).
 *
 * Any endpoint that speaks OpenAI's chat completions with
 * `response_format: json_schema` will do: the claude-api service on this Mac,
 * Anthropic's or OpenAI's own, Ollama. One `fetch`, no SDK, so changing
 * provider is a base URL and two model names.
 *
 * A task never names a model. It asks for a tier, `fast` for planning and small
 * jobs and `smart` for judging, and the settings say what each tier is.
 *
 * Every reply is parsed and checked against the task's schema here, whatever
 * the endpoint promised: asking for JSON is not receiving it. A reply that
 * fails gets one repair turn with the validation error, then the call fails.
 *
 * A task may offer tools (`LlmTool`): the model calls them, they run here and
 * their results go back, a few rounds at most, and then it answers in the
 * schema. That is OpenAI's own `tools` with `response_format`, so any
 * endpoint that takes both will do. `webSearch` asks the endpoint to let the
 * model search the web itself (`web_search_options`); one that cannot ignores it.
 *
 * Schemas are zod v4 (`zod/v4`, shipped inside the zod already installed),
 * because v4 turns a schema into the JSON Schema the request carries; the rest
 * of the server stays on v3. Only this folder sees them.
 */

type Tier = 'fast' | 'smart'

interface LlmSettings {
  /** Up to and including `/v1`. */
  readonly baseUrl: string
  readonly apiKey: string | null
  readonly models: Readonly<Record<Tier, string>>
  readonly timeoutMs: number
}

export interface GenerateRequest<T> {
  /** Names the call in logs and in the request's schema name. */
  readonly task: string
  readonly tier: Tier
  /** The same text on every call of a task, so a provider can cache it. */
  readonly system: string
  readonly prompt: string
  readonly schema: z.ZodType<T>
  /** Shorter than the settings' for a call someone is watching, like Settings' test. */
  readonly timeoutMs?: number
  /** What the model may look up before it answers, run here (`tool`). */
  readonly tools?: readonly LlmTool[]
  /** Rounds of tool calls before it must answer. */
  readonly maxRounds?: number
  /** Let the model search and read the web itself for this call. */
  readonly webSearch?: boolean
}

/** Something the model may call: its arguments are checked against `parameters` before `run`. */
export interface LlmTool {
  readonly name: string
  readonly description: string
  readonly parameters: z.ZodType
  readonly run: (args: never) => unknown
}

/** A tool, with its arguments' type read off its schema. */
export function tool<A>(entry: {
  name: string
  description: string
  parameters: z.ZodType<A>
  run: (args: A) => unknown
}): LlmTool {
  return entry as LlmTool
}

const DEFAULT_ROUNDS = 6
/** The most of one tool result sent back, so one big answer cannot fill the context. */
const RESULT_CHARS = 24_000

interface Generated<T> {
  readonly value: T
  readonly ms: number
}

export interface Llm {
  readonly generate: <T>(request: GenerateRequest<T>) => Promise<Generated<T>>
}

/**
 * Why a call did not produce an answer, in the words a screen needs.
 *
 * `off`: nothing is set up. `unreachable`: the endpoint did not answer.
 * `busy`: it answered with a rate or usage limit. `refused`: the key was not
 * accepted. `invalid`: it answered, twice, with something the schema rejects.
 */
type LlmFailure = 'off' | 'unreachable' | 'busy' | 'refused' | 'invalid'

export class LlmError extends Error {
  readonly kind: LlmFailure
  constructor(kind: LlmFailure, message: string) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
  }
}

/** Why a model did not answer, the way a screen can show it. */
export const llmFailureWords: Readonly<Record<LlmFailure, string>> = {
  off: 'Smart features aren’t set up on your server.',
  busy: 'The model is over its limit for now. Try again later.',
  unreachable: 'Your server couldn’t reach the model.',
  refused: 'The model’s endpoint refused your server’s key.',
  invalid: 'The model’s answer didn’t make sense. Try again.',
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function').optional(),
  function: z.object({ name: z.string(), arguments: z.string() }),
})
type ToolCall = z.infer<typeof ToolCallSchema>

type ChatMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | {
      readonly role: 'assistant'
      readonly content: string | null
      readonly tool_calls?: ToolCall[]
    }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string }

const ChatReplySchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable(),
          tool_calls: z.array(ToolCallSchema).nullable().optional(),
        }),
      }),
    )
    .min(1),
})

/** One call run: its arguments checked, its answer as JSON, a failure said as an error. */
async function runCall(tools: readonly LlmTool[], call: ToolCall): Promise<string> {
  const found = tools.find(each => each.name === call.function.name)
  if (!found) return JSON.stringify({ error: `There is no tool called ${call.function.name}.` })
  let args: unknown
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    return JSON.stringify({ error: 'The arguments were not JSON.' })
  }
  const parsed = found.parameters.safeParse(args)
  if (!parsed.success)
    return JSON.stringify({ error: `Wrong arguments: ${issuesOf(parsed.error)}` })
  try {
    const result = JSON.stringify(await found.run(parsed.data as never))
    return result.length > RESULT_CHARS
      ? `${result.slice(0, RESULT_CHARS)}… (cut short: ask for less)`
      : result
  } catch (caught) {
    return JSON.stringify({ error: caught instanceof Error ? caught.message : String(caught) })
  }
}

/** The JSON Schema a request carries: no `$schema` key, which some endpoints refuse. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  return rest
}

/**
 * A reply's text as JSON. Models asked for JSON alone still sometimes wrap it
 * in a code fence, and that is not worth a repair turn.
 */
export function parseReply(text: string): unknown {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text)
  return JSON.parse(fenced ? fenced[1]! : text)
}

function issuesOf(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

export function openAiCompatible(
  settings: LlmSettings,
  deps: { readonly fetch?: FetchLike; readonly logger: Logger },
): Llm {
  const fetchImpl = deps.fetch ?? fetch
  const logger = deps.logger.child('ai')
  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`

  async function ask(
    task: string,
    model: string,
    messages: readonly ChatMessage[],
    schema: Record<string, unknown>,
    timeoutMs: number,
    offer: { tools: readonly LlmTool[]; callable: boolean; webSearch: boolean },
  ): Promise<{ content: string; calls: ToolCall[] }> {
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: {
            type: 'json_schema',
            json_schema: { name: task.replace(/[^a-zA-Z0-9_-]/g, '_'), strict: true, schema },
          },
          ...(offer.tools.length > 0
            ? {
                tools: offer.tools.map(each => ({
                  type: 'function',
                  function: {
                    name: each.name,
                    description: each.description,
                    parameters: jsonSchemaOf(each.parameters),
                  },
                })),
                tool_choice: offer.callable ? 'auto' : 'none',
              }
            : {}),
          ...(offer.webSearch ? { web_search_options: {} } : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (caught) {
      throw new LlmError(
        'unreachable',
        `The model at ${settings.baseUrl} did not answer: ${caught instanceof Error ? caught.message : String(caught)}`,
      )
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300)
      if (response.status === 429)
        throw new LlmError('busy', `The model is over a limit: ${detail}`)
      if (response.status === 401 || response.status === 403) {
        throw new LlmError('refused', `The model's endpoint refused the key: ${detail}`)
      }
      throw new LlmError('unreachable', `The model answered ${response.status}: ${detail}`)
    }
    const reply = ChatReplySchema.safeParse(await response.json().catch(() => null))
    if (!reply.success)
      throw new LlmError('invalid', 'The model sent something that is not a chat reply')
    const { message } = reply.data.choices[0]!
    return { content: message.content ?? '', calls: message.tool_calls ?? [] }
  }

  return {
    async generate<T>(request: GenerateRequest<T>): Promise<Generated<T>> {
      const started = Date.now()
      const model = settings.models[request.tier]
      const schema = jsonSchemaOf(request.schema)
      const messages: ChatMessage[] = [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ]
      const tools = request.tools ?? []
      const maxRounds = request.maxRounds ?? DEFAULT_ROUNDS
      let rounds = 0
      let called = 0
      for (let attempt = 1; attempt <= 2; attempt++) {
        let text: string
        // The model's tool calls, run and answered, until it replies or runs out of rounds.
        for (;;) {
          const reply = await ask(
            request.task,
            model,
            messages,
            schema,
            request.timeoutMs ?? settings.timeoutMs,
            { tools, callable: rounds < maxRounds, webSearch: request.webSearch === true },
          )
          if (reply.calls.length === 0 || rounds >= maxRounds) {
            text = reply.content
            break
          }
          rounds++
          called += reply.calls.length
          messages.push({
            role: 'assistant',
            content: reply.content || null,
            tool_calls: reply.calls,
          })
          for (const call of reply.calls) {
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: await runCall(tools, call),
            })
          }
        }
        let problem: string
        try {
          const parsed = request.schema.safeParse(parseReply(text))
          if (parsed.success) {
            const ms = Date.now() - started
            // What was asked and how long it took, never what was said: both
            // sides of the conversation are your library.
            logger.info('model call', {
              task: request.task,
              model,
              ms,
              attempts: attempt,
              ...(tools.length > 0 ? { rounds, toolCalls: called } : {}),
            })
            return { value: parsed.data, ms }
          }
          problem = issuesOf(parsed.error)
        } catch {
          problem = 'the reply was not JSON'
        }
        logger.warn('model reply did not fit', { task: request.task, model, attempt, problem })
        messages.push(
          { role: 'assistant', content: text },
          {
            role: 'user',
            content: `That reply does not match the required JSON schema (${problem}). Reply again with only the corrected JSON.`,
          },
        )
      }
      throw new LlmError('invalid', `The model's answer to ${request.task} did not fit, twice`)
    },
  }
}

/** Stands in when no endpoint is set: every call says so. */
export const noLlm: Llm = {
  generate: () =>
    Promise.reject(
      new LlmError('off', 'Smart features are off: set SELFMP3_AI_BASE_URL on the server'),
    ),
}

/**
 * Answers kept against their exact input, for a while.
 *
 * Opening Suggest tags twice should cost one call, and an unchanged library
 * should get the same suggestions back rather than a fresh roll of the dice.
 * In memory: a restart costs one call per question, which is fine.
 */
export class Remembered {
  readonly #entries = new Map<string, { at: number; value: unknown }>()
  constructor(
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly max = 64,
  ) {}

  static key(...parts: readonly unknown[]): string {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  }

  async get<T>(key: string, make: () => Promise<T>, now = Date.now()): Promise<T> {
    const hit = this.#entries.get(key)
    if (hit && now - hit.at < this.ttlMs) return hit.value as T
    return this.put(key, make, now)
  }

  /** A fresh answer, kept in place of the one before: "write it again". */
  async put<T>(key: string, make: () => Promise<T>, now = Date.now()): Promise<T> {
    const value = await make()
    this.#entries.delete(key)
    this.#entries.set(key, { at: now, value })
    if (this.#entries.size > this.max) {
      const oldest = this.#entries.keys().next().value
      if (oldest !== undefined) this.#entries.delete(oldest)
    }
    return value
  }
}
