/** The sidebar's width on a computer (`S2`, "Gutters"). */
export const SIDEBAR_WIDTH = 244

/** Up next's rail beside the page (`S2`, "Gutters": up-next rail 288). */
export const RAIL_WIDTH = 288

/**
 * Where a part changes its shape above `BREAKPOINT` (`useLayout`), measured against the page
 * column (`useContentWidth`): the window less the sidebar and an open Up next,
 * so a part that is right with the rail closed stays right when it opens. Each
 * screen kept its own, Home's and Up next's under the same name for different
 * measures, and Settings' measured the window, so it kept its index column
 * beside a page the rail had narrowed.
 */
export const COLUMN_WIDTH = {
  /** Settings' index stands beside its panels; below, a row of chips. */
  settingsIndex: 1080 - SIDEBAR_WIDTH,
  /** Stats' three lists stand side by side. */
  statsLists: 860,
  /** Stats' three cards stand in one row; below, Listened above the other two. */
  statsCards: 700,
  /** Home's card column stands beside the tiles; below, under them. */
  homeCardsBeside: 880,
  /** The library's head keeps to one row (the rail beside a small window leaves less). */
  libraryHeadRow: 600,
  /** The library head's Shuffle says its word; below, its icon alone. */
  libraryShuffleLabel: 760,
  /** A song row's album leaves its second line for a column of its own. */
  rowAlbum: 916,
  /** A song row has room for its tags as chips (an iPad in portrait has 590). */
  rowTagChips: 520,
} as const

/**
 * The few measured against the window, because the window holds them whole:
 * the player bar spans it, onboarding has no sidebar, and the rail decides
 * the page column, so it cannot be measured by it.
 */
export const WINDOW_WIDTH = {
  /** Below this the bar's song and transport shrink, so its tools still fit. */
  barTight: 900,
  /** Below this the bar's volume folds into a popover on the speaker. */
  barCompact: 1160,
  /**
   * Up next stays beside the page: the sidebar, a page a list still reads in,
   * and the rail. Narrower (an iPad in portrait) it lies over the page.
   */
  railBeside: SIDEBAR_WIDTH + 528 + RAIL_WIDTH,
  /** Onboarding's words take their full margin. */
  welcomeRoomy: 1100,
} as const
