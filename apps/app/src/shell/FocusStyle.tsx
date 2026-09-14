import type { ReactNode } from 'react'

/**
 * A focused text field's look, where the platform would otherwise draw its
 * own. A phone draws nothing but the caret, which is right; the browser's
 * answer is `FocusStyle.web.tsx`.
 */
export function FocusStyle(): ReactNode {
  return null
}
