/**
 * The ground the app is painted on, before anything of the app is running.
 *
 * The dark theme's `surface0` (packages/client's `tokens.ts` reads it from
 * here), which is what a window, a splash screen and an Android launcher icon
 * have to be filled with so the first painted frame is already the app's own
 * colour rather than a near-miss that shifts tone a moment later.
 *
 * It lives in the contract package rather than beside the rest of the theme
 * because three toolchains that share nothing else need it: Expo's plain-Node
 * `app.config.js`, which `require`s it at prebuild time, the Electron main
 * process, which sets the window's background before it loads a page, and the
 * app itself. This is the only package all three already load.
 */
export const NATIVE_BACKGROUND = '#0b0d13'

/**
 * The dark theme's card (`surface1`), which the home-screen widget is filled
 * with: its Xcode target's colours are written at prebuild time, by the same
 * plain-Node config that reads `NATIVE_BACKGROUND`.
 */
export const NATIVE_CARD = '#151821'

/**
 * The dark theme's ink, its quieter ink and a raised control's tone
 * (`textPrimary`, `textSecondary`, `surface3`): the widget's words and the
 * square standing in for a missing cover, coloured at prebuild as the card
 * is. The widget's Swift used to carry its own copies of them.
 */
export const NATIVE_TEXT_PRIMARY = '#f4f5f9'
export const NATIVE_TEXT_SECONDARY = '#aeb1b9'
export const NATIVE_RAISED = '#1f2330'

/**
 * The accent at its default hue in the dark theme, for the widget's tint.
 * packages/client works the accent out from the hue; its tests hold the two
 * to the same colour.
 */
export const NATIVE_ACCENT = '#7a9eff'
