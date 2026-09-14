/**
 * How much room the window's own chrome takes at the top of the page, and the
 * id of the strip that may be dragged to move the window.
 *
 * Zero everywhere but the installed desktop app, where `titleBarStyle:
 * 'hiddenInset'` puts the traffic lights over the top of the sidebar instead of
 * in a bar above the app. The sidebar pads itself by this much so nothing sits
 * under them, and renders a strip of exactly that height which the window can
 * be dragged by.
 *
 * A number rather than a boolean, and asked for rather than assumed, because
 * only the shell knows whether it drew an inset title bar — and it is the one
 * deliberate way the installed app looks different from the browser.
 */
export const titleBarInset = 0

export { TITLE_BAR_DRAG_ID } from './titleBarDragId'
