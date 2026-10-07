import type { Response } from 'express'

/**
 * Aborted when the response closes before it was finished: the device that
 * asked has gone — a seek, another track picked, Stop pressed, the page
 * closed — so whatever is still working for it can stop.
 */
export function abortOnClose(res: Response): AbortController {
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })
  return controller
}
