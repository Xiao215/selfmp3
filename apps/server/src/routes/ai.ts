import { Router, type Response } from 'express'
import { z } from 'zod'
import {
  type AiCheck,
  type AiSetup,
  type TidyResult,
  type WrittenReport,
  WrappedRangeSchema,
  AskRequestSchema,
  DescribeRequestSchema,
  RefineRequestSchema,
  type AskAnswer,
  type AskProgress,
  type DescribeResult,
  type TagReview,
} from '@selfmp3/shared'
import { LlmError, llmFailureWords } from '../ai/llm.js'
import type { Container } from '../container.js'
import { HttpError } from '../http/errors.js'
import { route } from '../http/route.js'

/**
 * The smart features (docs/features/ai.md). Each answer is a proposal: nothing
 * here writes to the library. Taking a suggestion is the ordinary edit a device
 * already makes, so it syncs and undoes like any other.
 */
type SmartSwitch = 'smartAsk' | 'smartTidy' | 'smartTags' | 'smartWritten'

export function aiRoutes(container: Container): Router {
  const router = Router()

  /** A feature turned off in Settings › Smart features is refused before any model is asked. */
  const allowed = (feature: SmartSwitch): void => {
    if (!container.settings.get()[feature]) {
      throw new HttpError(
        403,
        'This smart feature is turned off in Settings › Smart features.',
        'ai_disabled',
      )
    }
  }

  router.get(
    '/ai',
    route({}, (): AiSetup => container.smart.setup()),
  )

  /** Settings' Test: a failed call is the answer, not an error. */
  router.post(
    '/ai/check',
    route({}, (): Promise<AiCheck> => container.smart.check()),
  )

  router.post(
    '/ai/describe',
    route({ body: DescribeRequestSchema }, ({ body }): Promise<DescribeResult> => {
      allowed('smartAsk')
      return answering(container.smart.describe(body))
    }),
  )

  router.post(
    '/ai/ask',
    route({ body: AskRequestSchema }, ({ body, res }): Promise<AskAnswer> => {
      allowed('smartAsk')
      const { smartTidy: tidy, smartTags: tags } = container.settings.get()
      return answering(
        container.smart.ask(
          body.text,
          body.playing,
          { tidy, tags },
          body.ticket,
          body.before,
          whileWaited(res),
        ),
      )
    }),
  )

  /** An answer changed after it was given: "10 首", "calmer". */
  router.post(
    '/ai/refine',
    route({ body: RefineRequestSchema }, ({ body, res }): Promise<DescribeResult> => {
      allowed('smartAsk')
      return answering(container.smart.refine(body, whileWaited(res)))
    }),
  )

  /** How an Ask is going, while the device waits for its answer. */
  router.get(
    '/ai/ask/progress',
    route({ query: z.object({ ticket: z.string().max(64) }) }, ({ query }): AskProgress => ({
      steps: [...container.smart.askProgress(query.ticket)],
    })),
  )

  router.get(
    '/ai/written',
    route(
      {
        query: z.object({
          range: WrappedRangeSchema.default('month'),
          again: z.enum(['0', '1']).default('0'),
        }),
      },
      ({ query }): Promise<WrittenReport> => {
        allowed('smartWritten')
        return answering(container.smart.written(query.range, query.again === '1'))
      },
    ),
  )

  router.get(
    '/ai/tidy',
    route({}, (): Promise<TidyResult> => {
      allowed('smartTidy')
      return container.smart.tidy()
    }),
  )

  router.get(
    '/ai/tags/untagged',
    route({}, (): Promise<TagReview> => {
      allowed('smartTags')
      return answering(container.smart.untaggedTags())
    }),
  )

  return router
}

const FAILURE_STATUS: Readonly<Record<LlmError['kind'], number>> = {
  off: 503,
  busy: 429,
  unreachable: 502,
  refused: 502,
  invalid: 502,
  // Nobody hears it: the device hung up.
  stopped: 499,
}

/** A model that could not answer, said the way a screen can show it. */
/**
 * Aborted when the device stops waiting for the answer: Stop pressed, the box
 * closed, the page gone. The model is asked no more for it.
 */
function whileWaited(res: Response): AbortSignal {
  const waiting = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) waiting.abort()
  })
  return waiting.signal
}

async function answering<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (caught) {
    if (!(caught instanceof LlmError)) throw caught
    throw new HttpError(
      FAILURE_STATUS[caught.kind],
      llmFailureWords[caught.kind],
      `ai_${caught.kind}`,
      caught.kind === 'unreachable' ? caught.message : undefined,
    )
  }
}
