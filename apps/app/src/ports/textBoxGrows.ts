/**
 * Whether a multiline text box grows with its lines by itself. A phone's does:
 * the field measures what it holds. A height given to it would stop that, and
 * the size it reports comes only when its frame changes, so a box sized from
 * that report could grow once and then never again.
 */
export const textBoxGrows = true
