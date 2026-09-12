import type { ReactNode } from 'react'

/**
 * A hint that appears when a pointer rests on something.
 *
 * Hover-only, and so web-only: `docs/UNIVERSAL.md` lists tooltips under what
 * does not port one-to-one, with "a `Tooltip` that renders its child and
 * nothing else on native". This is that file. `Tooltip.web.tsx` is the one
 * that draws.
 *
 * It exists on both platforms so that a screen can be written once and say
 * what a control is for, without asking whether anything will read it. On a
 * phone nothing does, and nothing is drawn.
 */
export function Tooltip({ children }: { label: string; children: ReactNode }): ReactNode {
  return children
}
