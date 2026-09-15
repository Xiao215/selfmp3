import { desktop } from './desktop/bridge'
import { TITLE_BAR_DRAG_ID } from './titleBarDragId'

/** See `titleBarInset.ts`. Zero in a tab, which has no title bar of its own. */
export const titleBarInset: number = desktop?.info.titleBarInset ?? 0

/*
 * `-webkit-app-region: drag` cannot be written as a React Native style: it is
 * not a property the web renderer knows, and unknown properties are dropped. So
 * the strip is styled by id, once, when this module first loads — which is when
 * the sidebar that renders it is imported. Guarded on the inset so an ordinary
 * tab never grows a rule it has no use for.
 */
if (titleBarInset > 0 && typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = `#${TITLE_BAR_DRAG_ID} { -webkit-app-region: drag; }`
  document.head.appendChild(style)
}
