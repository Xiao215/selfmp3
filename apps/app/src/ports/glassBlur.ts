/**
 * The blur behind glass (docs/ui-mock `S2`, "Glass"): the floating bar, the
 * search circle, controls over artwork.
 *
 * A phone draws the translucent fill alone. The blur would need `expo-blur`,
 * a native module, and the fill reads well without it (docs/UI-MIGRATION.md,
 * Open question 6).
 */
export const glassBlur = {} as const
