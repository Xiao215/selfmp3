import { StyleSheet } from 'react-native-unistyles'

/**
 * Unistyles configuration for the spike (check 2).
 *
 * Deliberately thin: the real theme is built from the OKLCH token file in
 * phase 2, and foundation 4 says there is exactly one source for it. What the
 * spike needs to prove is narrower — that Unistyles 3 runs on RN 0.86, that a
 * `:hover` variant reaches the browser as real CSS, and that the 820-point
 * breakpoint from docs/UNIVERSAL.md switches the layout.
 *
 * 820 is the number the whole plan turns on: below it the phone layout, at and
 * above it the desktop. Naming it here rather than in each component is what
 * keeps foundation 5 ("layout responds to width") enforceable.
 */
const breakpoints = {
  phone: 0,
  desktop: 820,
} as const

const dark = {
  colors: {
    // Stand-ins with the shape the real tokens have. The values come from the
    // OKLCH file in phase 2; nothing should read these two beyond the spike.
    surface: '#14121a',
    raised: '#221f2b',
    hover: '#3a3448',
    text: '#f2eef8',
  },
  gap: (n: number) => n * 4,
} as const

type AppBreakpoints = typeof breakpoints
type AppThemes = { dark: typeof dark }

declare module 'react-native-unistyles' {
  // Declaration merging is how Unistyles learns the app's themes and
  // breakpoints; an empty body is the documented shape, not an oversight.
  /* eslint-disable @typescript-eslint/no-empty-object-type */
  export interface UnistylesBreakpoints extends AppBreakpoints {}
  export interface UnistylesThemes extends AppThemes {}
  /* eslint-enable @typescript-eslint/no-empty-object-type */
}

StyleSheet.configure({
  themes: { dark },
  breakpoints,
  settings: { initialTheme: 'dark' },
})
