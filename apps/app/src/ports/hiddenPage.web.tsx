import { Activity } from 'react'
import type { ReactNode } from 'react'

/**
 * A page kept in the stack under the one on top, in a browser: one the
 * browser is not drawing (`display: none`), whose updates React puts off
 * until it is shown again and whose effects it stops meanwhile. Kept pages
 * had been drawn again for every pixel a window was dragged, a resize sweep
 * running at 36 frames where a fresh tab ran 172 (bug bash F056). Its state
 * stays, so Back finds it as it was.
 */
export function HiddenPage({
  hidden,
  children,
}: {
  hidden: boolean
  children: ReactNode
}): ReactNode {
  return <Activity mode={hidden ? 'hidden' : 'visible'}>{children}</Activity>
}
