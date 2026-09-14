/**
 * Whether this device's connection can cost money by the megabyte.
 *
 * False on a computer — an installed app or a tab alike. Every connection a
 * computer has counts as Wi-Fi (decided 2026-09-12): a desk, a café, a laptop
 * tethered to a phone for ten minutes. None of them is the case the 500 MB ask
 * was written for.
 *
 * A phone's *browser* is a computer for this purpose too, and always has been:
 * the web app has never asked about data, because the Network Information API
 * is Chromium-only and says almost nothing where it exists. So this is not a
 * behaviour the desktop changes — it is the browser's, stated out loud now that
 * a port has to answer it.
 */
export const meteredConnections = false
