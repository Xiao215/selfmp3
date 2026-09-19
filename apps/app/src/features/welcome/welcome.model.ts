/**
 * Welcome, without the screen (docs/ui-mock `P01`, `P02`, `C01`): what is drawn
 * above the one button, and the line under it.
 *
 * A device that has never signed in has nothing of the person's to show, so it
 * shows what a library here looks like: a few tag tiles with everyday names,
 * made up, in the hues a tag gets. A device that signed in before still holds
 * the covers it kept, and those are the person's own music, which is a warmer
 * way back in than anything invented. Whichever it is, the page has one button.
 */

/** An invented tag, drawn as Home draws a real one. */
export interface WelcomeTile {
  readonly name: string
  /** Where on the colour wheel the tile sits, as a tag's hue does. */
  readonly hue: number
  /** Degrees, so the tiles lie like cards dropped on a table rather than a grid. */
  readonly tilt: number
  /** Points up or down from the row, for the same reason. */
  readonly lift: number
}

/**
 * The names `P01` draws, in its order and at its angles. Everyday words on
 * purpose: a tag here is what a song is for, not a genre, and a first launch
 * should say so before anything else does.
 */
export const WELCOME_TILES: readonly WelcomeTile[] = [
  { name: 'night drive', hue: 268, tilt: -5, lift: 10 },
  { name: 'rainy', hue: 200, tilt: 3, lift: -8 },
  { name: 'gym', hue: 30, tilt: -2, lift: 6 },
  { name: 'piano', hue: 75, tilt: 4, lift: 4 },
  { name: 'from 2014', hue: 340, tilt: -3, lift: -6 },
  { name: 'study', hue: 138, tilt: 2, lift: 8 },
]

/** How many covers the fan holds (`P02`). */
export const WELCOME_FAN = 3

/** Each cover's lie in the fan, as `P02` draws it. */
export const FAN_POSES: readonly { readonly tilt: number; readonly lift: number }[] = [
  { tilt: -6, lift: 0 },
  { tilt: 4, lift: -14 },
  { tilt: -3, lift: 0 },
]

export type WelcomeArt =
  | { readonly kind: 'tiles'; readonly tiles: readonly WelcomeTile[] }
  | {
      readonly kind: 'covers'
      /** The three held up in front. */
      readonly fan: readonly string[]
      /** The one blurred behind the page, as light rather than a picture. */
      readonly backdrop: string
    }

/**
 * Covers when this device kept enough of them to fill the fan, and the tiles
 * otherwise.
 *
 * Fewer than three is treated as none: a fan of one or two looks like a page
 * that failed to load the rest, and the tiles never look unfinished. The
 * backdrop is a fourth cover where there is one, so it is not a blur of a
 * picture standing right in front of it.
 */
export function welcomeArt(kept: readonly string[]): WelcomeArt {
  const unique = [...new Set(kept)]
  if (unique.length < WELCOME_FAN) return { kind: 'tiles', tiles: WELCOME_TILES }
  const fan = unique.slice(0, WELCOME_FAN)
  return { kind: 'covers', fan, backdrop: unique[WELCOME_FAN] ?? fan[0] ?? '' }
}

/**
 * The line under the button. A phone is told the library is not on it; a
 * computer is told it could be (`C01`), because a computer is where the server
 * runs if anywhere does.
 */
export function welcomeFootnote(wide: boolean): string {
  return wide
    ? 'This computer can also hold the library itself: the server runs here and the phone plays from it. Signing in tells both where it is.'
    : 'Your library lives in your own storage. Signing in only tells this phone where it is.'
}
