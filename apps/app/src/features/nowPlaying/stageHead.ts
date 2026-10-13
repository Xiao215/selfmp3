import { titleBarInset } from '../../ports/titleBarInset'

/*
 * Where the computer's Now Playing head starts. The page covers the sidebar,
 * which is what keeps everything else clear of the Mac's traffic lights, and
 * they sit on this row's own line — so on the installed desktop app the row
 * starts to their right rather than under them. Twenty everywhere without an
 * inset title bar. The stage and its empty page both start here.
 */
export const HEAD_LEFT = titleBarInset > 0 ? 84 : 20
