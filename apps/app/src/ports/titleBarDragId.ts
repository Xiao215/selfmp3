/**
 * What the draggable title-bar strips are called, where there are any: this, or
 * this and a suffix where there is more than one kind.
 *
 * Its own file, with no `.web` twin, because the sidebar and the web half of
 * `titleBarInset` both need it. Importing it from `./titleBarInset` would not
 * work: TypeScript resolves that to the native file and Metro — preferring
 * `.web` — to the web file, which then imports itself.
 */
export const TITLE_BAR_DRAG_ID = 'selfmp3-titlebar-drag'
