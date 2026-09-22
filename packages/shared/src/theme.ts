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
