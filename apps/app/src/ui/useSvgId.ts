import { useId } from 'react'

/**
 * An id for an SVG definition — a gradient, a mask — that no other drawing on
 * the page shares: `prefix` and this component's own id. React's ids carry
 * colons, which a `url(#…)` reference does not take, so only letters and
 * digits are kept.
 */
export function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`
}
