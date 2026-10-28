import { Router } from 'express'
import { z } from 'zod'
import {
  type AiSetup,
  type TidyResult,
  type WrittenReport,
  BooleanQuerySchema,
  WrappedRangeSchema,
  AskRequestSchema,
  AskTicketSchema,
  DescribeRequestSchema,
  ImportNamesRequestSchema,
  type ImportNames,
  RefineRequestSchema,
  type AskReply,
  type AskProgress,
  type DescribeResult,
  type Ok,
  type MetadataSuggestion,
  type TagReview,
  AI_ERROR,
} from '@selfmp3/shared'
import { LlmError, llmFailureWords } from '../ai/llm.js'
import type { Container } from '../container.js'
import { abortOnClose } from '../http/abortOnClose.js'
import { HttpError } from '../http/errors.js'
import { ParamsWithId, requireSong } from '../http/params.js'
import { route } from '../http/route.js'

/**
 * The smart features (docs/features/ai.md). Each answer is a proposal: nothing
 * here writes to the library. Taking a suggestion is the ordinary edit a device
 * already makes, so it syncs and undoes like any other.
 */
export function aiRoutes(container: Container): Router {
  const router = Router()

  /**
   * Smart features turned off in Settings › Smart features are refused before
   * any model is asked.
   */
  const allowed = (): void => {
    if (!container.settings.get().smartFeatures) {
      throw new HttpError(
        403,
        'Smart features are turned off in Settings › Smart features.',
        'ai_disabled',
      )
    }
  }

  router.get(
    '/ai',
    route({}, (): AiSetup => container.smart.setup()),
  )

  router.post(
    '/ai/describe',
    route({ body: DescribeRequestSchema }, ({ body, res }): Promise<DescribeResult> => {
      allowed()
      return answering(container.smart.describe(body, whileWaited(res)))
    }),
  )

  router.post(
    '/ai/ask',
    route({ body: AskRequestSchema }, ({ body, res }): Promise<AskReply> => {
      allowed()
      return answering(
        container.smart.ask(body.text, body.context, body.ticket, body.before, whileWaited(res)),
      )
    }),
  )

  /** An answer changed after it was given: "10 首", "calmer". */
  router.post(
    '/ai/refine',
    route({ body: RefineRequestSchema }, ({ body, res }): Promise<DescribeResult> => {
      allowed()
      return answering(container.smart.refine(body, whileWaited(res)))
    }),
  )

  /**
   * How an Ask is going, while the device waits for its answer; asking keeps
   * it going after the device's connection closed. `answer=1` collects the
   * answer once it is done, for a device that lost the response.
   */
  router.get(
    '/ai/ask/progress',
    route(
      { query: z.object({ ticket: z.string().max(64), answer: BooleanQuerySchema }) },
      ({ query }): AskProgress => {
        const { steps, known, outcome } = container.smart.askProgress(query.ticket)
        return {
          steps: [...steps],
          known,
          done: outcome !== null,
          answer: query.answer && outcome && 'answer' in outcome ? outcome.answer : null,
          failed: outcome && 'failed' in outcome ? failureOf(outcome.failed) : null,
        }
      },
    ),
  )

  /** Stop: the Ask goes no further, though its connection may already have closed. */
  router.post(
    '/ai/ask/stop',
    route({ body: z.object({ ticket: AskTicketSchema }) }, ({ body }): Ok => {
      container.smart.stopAsk(body.ticket)
      return { ok: true }
    }),
  )

  router.get(
    '/ai/written',
    route(
      {
        query: z.object({
          range: WrappedRangeSchema.default('month'),
          again: BooleanQuerySchema,
        }),
      },
      ({ query, res }): Promise<WrittenReport> => {
        allowed()
        return answering(container.smart.written(query.range, query.again, whileWaited(res)))
      },
    ),
  )

  /** Fix metadata's Suggested card: one song's names, read from the catalogues' listings. */
  router.get(
    '/ai/songs/:id/metadata',
    route(
      {
        params: ParamsWithId,
        query: z.object({ again: BooleanQuerySchema }),
      },
      ({ params, query, res }): Promise<MetadataSuggestion> => {
        allowed()
        const song = requireSong(container.songs, params.id)
        return answering(container.smart.fixSong(song, query.again, whileWaited(res)))
      },
    ),
  )

  router.get(
    '/ai/tidy',
    route({}, ({ res }): Promise<TidyResult> => {
      allowed()
      return answering(container.smart.tidy(whileWaited(res)))
    }),
  )

  /** A9 · an import review's names, read by the model: suggestions for the rows that look wrong. */
  router.post(
    '/ai/import/names',
    route({ body: ImportNamesRequestSchema }, ({ body, res }): Promise<ImportNames> => {
      allowed()
      return answering(container.smart.importNames(body, whileWaited(res)))
    }),
  )

  router.get(
    '/ai/tags/untagged',
    route({}, (): Promise<TagReview> => {
      allowed()
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

/**
 * Aborted when the device stops waiting for the answer: Stop pressed, the box
 * closed, the page gone. The model is asked no more for it.
 */
const whileWaited = (res: Parameters<typeof abortOnClose>[0]): AbortSignal =>
  abortOnClose(res).signal

/** A model that could not answer, said the way a screen can show it. */
async function answering<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (caught) {
    throw caught instanceof LlmError ? modelFailure(caught) : caught
  }
}

function modelFailure(caught: LlmError): HttpError {
  return new HttpError(
    FAILURE_STATUS[caught.kind],
    llmFailureWords[caught.kind],
    AI_ERROR[caught.kind],
    caught.kind === 'unreachable' ? caught.message : undefined,
  )
}

/** An Ask's failure kept under its ticket, as the response that lost it would have said it. */
function failureOf(caught: unknown): AskProgress['failed'] {
  const failure = caught instanceof LlmError ? modelFailure(caught) : caught
  if (failure instanceof HttpError) {
    return { status: failure.status, error: failure.message, code: failure.code }
  }
  return { status: 500, error: 'Something went wrong answering that.', code: 'internal' }
}
