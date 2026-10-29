import { ApiError, type Api } from '@selfmp3/client'
import { showFailure } from '../../ui/toast'

/** The devices being forgotten now: a second press while the first is on its way sends nothing. */
const forgetting = new Set<string>()

/**
 * Forgets each device, all of them tried even when one is refused, and says
 * so when any was: Remove is pressed, and a row that stays put is no answer.
 * A device the server no longer has is forgotten already, not refused: a
 * double click sent the second removal after the first had worked, and the
 * row went with "Couldn't remove that device" under it.
 */
export async function forgetEach(
  api: Pick<Api, 'forgetDevice'>,
  ids: readonly string[],
): Promise<void> {
  const fresh = ids.filter(id => !forgetting.has(id))
  for (const id of fresh) forgetting.add(id)
  const results = await Promise.allSettled(
    fresh.map(id =>
      api.forgetDevice(id).finally(() => {
        forgetting.delete(id)
      }),
    ),
  )
  const refused = results.find(
    (result): result is PromiseRejectedResult =>
      result.status === 'rejected' &&
      !(result.reason instanceof ApiError && result.reason.status === 404),
  )
  if (refused) {
    const what = ids.length > 1 ? 'Couldn’t remove them all' : 'Couldn’t remove that device'
    showFailure(what, refused.reason)
  }
}
