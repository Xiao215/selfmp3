import type { LIST_SEMANTICS as SameShape } from './listSemantics'

/**
 * A song list's own box in a browser: a grid, one Tab stop whose rows the
 * arrows move between (`useListKeys.web.ts`), which a screen reader hands its
 * arrow keys to.
 *
 * Never a Tab stop itself. Chrome stops on a scrolling box with nothing in it
 * that takes Tab, which is what a list is for the moment Tab leaves it
 * (`placeStop`): Shift+Tab from a row's ⋯ would land on the list's own box.
 */
export const LIST_SEMANTICS: typeof SameShape = { role: 'grid', tabIndex: -1 }
