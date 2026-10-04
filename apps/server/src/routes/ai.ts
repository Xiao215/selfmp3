import { Router } from 'express'
import { z } from 'zod'
import {
  type AiCheck,
  type AiSetup,
  type TidyResult,
  type WrittenReport,
  WrappedRangeSchema,
  AskRequestSchema,
  DescribeRequestSchema,
  type AskAnswer,
  type DescribeResult,
  type TagSuggestions,
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
export function aiRoutes(container: Container): Router {
  const router = Router()

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
    route({ body: DescribeRequestSchema }, ({ body }): Promise<DescribeResult> =>
      answering(container.smart.describe(body)),
    ),
  )

  router.post(
    '/ai/ask',
    route({ body: AskRequestSchema }, ({ body }): Promise<AskAnswer> =>
      answering(container.smart.ask(body.text, body.playing)),
    ),
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
      ({ query }): Promise<WrittenReport> =>
        answering(container.smart.written(query.range, query.again === '1')),
    ),
  )

  router.get(
    '/ai/tidy',
    route({}, (): Promise<TidyResult> => container.smart.tidy()),
  )

  router.get(
    '/ai/tag-suggestions',
    route({}, (): Promise<TagSuggestions> => answering(container.smart.suggestTags())),
  )

  return router
}

const FAILURE_STATUS: Readonly<Record<LlmError['kind'], number>> = {
  off: 503,
  busy: 429,
  unreachable: 502,
  refused: 502,
  invalid: 502,
}

/** A model that could not answer, said the way a screen can show it. */
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
