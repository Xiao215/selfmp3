/**
 * Whether this device's connection can cost money by the megabyte.
 *
 * True on a phone, which is the whole reason the 500 MB question exists:
 * downloading a library over somebody's data allowance because they opened the
 * app on a train is the kind of thing an app gets to do once.
 *
 * A capability rather than a platform, so `connectionKind` asks this instead of
 * asking what it is running on.
 */
export const meteredConnections = true
