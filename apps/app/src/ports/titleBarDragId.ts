/**
 * What the draggable title-bar strip is called, where there is one.
 *
 * Its own file, with no `.web` twin, because both halves of `titleBarInset`
 * need it. `titleBarInset.web.ts` used to import it from `./titleBarInset`,
 * which TypeScript resolves to the native file and Metro — preferring `.web` —
 * resolves to the web file itself. The re-export became a getter that read
 * itself until the stack ran out, and only where the inset is not zero: the
 * installed desktop app, which opened to an empty window.
 */
export const TITLE_BAR_DRAG_ID = 'selfmp3-titlebar-drag'
