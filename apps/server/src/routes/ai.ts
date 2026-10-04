import { Router } from 'express'
import { DescribeRequestSchema, type DescribeResult, type TagSuggestions } from '@selfmp3/shared'
import { LlmError } from '../ai/llm.js'
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

  router.post(
    '/ai/describe',
    route({ body: DescribeRequestSchema }, ({ body }): Promise<DescribeResult> =>
      answering(container.smart.describe(body)),
    ),
  )

  router.get(
    '/ai/tag-suggestions',
    route({}, (): Promise<TagSuggestions> => answering(container.smart.suggestTags())),
  )

  return router
}

/** A model that could not answer, said the way a screen can show it. */
async function answering<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (caught) {
    if (!(caught instanceof LlmError)) throw caught
    switch (caught.kind) {
      case 'off':
        throw new HttpError(503, 'Smart features aren’t set up on your server.', 'ai_off')
      case 'busy':
        throw new HttpError(429, 'The model is over its limit for now. Try again later.', 'ai_busy')
      case 'unreachable':
        throw new HttpError(
          502,
          'Your server couldn’t reach the model.',
          'ai_unreachable',
          caught.message,
        )
      case 'refused':
        throw new HttpError(502, 'The model’s endpoint refused your server’s key.', 'ai_refused')
      case 'invalid':
        throw new HttpError(502, 'The model’s answer didn’t make sense. Try again.', 'ai_invalid')
    }
  }
}
