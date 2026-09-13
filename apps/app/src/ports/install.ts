/**
 * Whether this is an installed app, which keeps songs, or a browser, which
 * streams.
 *
 * The phone is installed. It downloads by default and plays from the files,
 * which is what keeps music going with no signal. A browser tab always streams
 * (decided 2026-09-12), so the same code in one asks nothing about downloading.
 */
export const installedApp = true
