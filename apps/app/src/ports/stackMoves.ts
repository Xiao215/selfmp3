/**
 * Whether the navigator moves a pushed page itself.
 *
 * A native stack does: a page pushed within a tab crossfades in
 * (`shell/pageStep.ts`). A browser's stack plays nothing at all, so there the
 * shell's own step has to carry every page change, not only a change of tab.
 */
export const stackMoves = true
