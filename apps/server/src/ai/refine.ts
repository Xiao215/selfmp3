import type { DescribeResult, RefineRequest } from '@selfmp3/shared'
import {
  DEFAULT_SIZE,
  FILTERS_GUIDE,
  PlanOut,
  groundPlan,
  narrowAndPick,
  songsFitting,
  type DescribeDeps,
} from './describe.js'
import { libraryShape } from './library.js'
import { Remembered } from './llm.js'
import { NO_STEPS, type Steps } from './progress.js'

/**
 * Changing an answer after it is given (docs/features/ai.md, "Change it"):
 * "10 首", "不要动漫的", "calmer". The answer is kept and changed, never
 * asked again from nothing.
 *
 * One model call reads the change against the filters as they stand and
 * returns them changed; everything it was not asked to change stays. Then the
 * songs already shown that still fit stay where they are, and only the rest
 * is picked — so "10 首" after two songs keeps those two and adds eight. A
 * change to what the filters cannot say (the brief) is a change of taste, and
 * picks again from the start.
 */

const VERSION = 1

const REFINE_SYSTEM = `You change the filters of a playlist someone already asked for, after they say what to change about it.

You are given the library's shape, what they first asked, the filters as they stand now (JSON), and what they want changed. Reply with JSON only, in the schema given: the whole set of filters after the change.

Keep every filter the change does not touch exactly as it is, name included. Change only what their words ask: a number of songs is size; calmer or livelier moves energy; "no X" puts X in noTags when X is a tag, otherwise says it in brief; "more like Y" or "add some Y" adds a place. A change to the brief keeps what the brief already said unless the change contradicts it.

${FILTERS_GUIDE}`

export async function refine(
  deps: DescribeDeps,
  request: Pick<RefineRequest, 'text' | 'understanding' | 'change' | 'shown'>,
  steps: Steps = NO_STEPS,
): Promise<DescribeResult> {
  const remembered = deps.remembered ?? new Remembered()
  const songs = deps.songs()
  const tags = deps.tags()
  const now = deps.now?.() ?? Date.now()

  steps.begin('Reading what to change')
  const prompt = [
    libraryShape(songs, tags),
    `What they first asked:\n${request.text}`,
    `The filters now:\n${JSON.stringify(request.understanding)}`,
    `What to change:\n${request.change}`,
  ].join('\n\n')
  const plan = await remembered.get(
    Remembered.key('refine-plan', VERSION, prompt),
    async () =>
      (
        await deps.llm.generate({
          task: 'refine-plan',
          tier: 'fast',
          system: REFINE_SYSTEM,
          prompt,
          schema: PlanOut,
        })
      ).value,
  )
  steps.done('Read what to change')
  const { understanding, unknown } = groundPlan(plan, songs, tags)
  // The songs shown that the changed filters still let in, while the taste is
  // the same: as many as the count asked for, or as long as the length.
  const sameTaste = (understanding.brief ?? '') === (request.understanding.brief ?? '')
  const fitting = new Set(songsFitting(songs, tags, understanding, now).map(song => song.id))
  const duration = new Map(songs.map(song => [song.id, song.duration]))
  const stillFit = sameTaste ? request.shown.filter(id => fitting.has(id)) : []
  const target = understanding.minutes === null ? null : understanding.minutes * 60
  const size = understanding.size ?? DEFAULT_SIZE
  const kept: number[] = []
  let keptSeconds = 0
  for (const id of stillFit) {
    if (target === null ? kept.length >= size : keptSeconds >= target) break
    kept.push(id)
    keptSeconds += duration.get(id) ?? 0
  }
  const enough = target === null ? kept.length >= size : keptSeconds >= target - 30
  if (enough) {
    steps.begin('Keeping the ones that still fit')
    steps.done(`Kept ${kept.length}`)
    return {
      understanding,
      fit: fitting.size,
      loosened: [],
      unknown,
      picks: kept.map(songId => ({ songId, why: null })),
    }
  }

  // Only what is missing is picked: the rest of the count, or of the length.
  const rest =
    target === null
      ? { ...understanding, size: size - kept.length }
      : {
          ...understanding,
          size: null,
          minutes: Math.max(1, Math.ceil((target - keptSeconds) / 60)),
        }
  const more = await narrowAndPick(
    deps,
    `${request.text}\n${request.change}`,
    rest,
    unknown,
    kept,
    steps,
  )
  const added = more.picks.filter(pick => !kept.includes(pick.songId))
  return {
    ...more,
    understanding: {
      ...more.understanding,
      size: understanding.size,
      minutes: understanding.minutes,
    },
    picks: [...kept.map(songId => ({ songId, why: null })), ...added],
  }
}
