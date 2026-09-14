/**
 * Whether this device can be pointed at a server by typing its address.
 *
 * A capability, not a platform — the rule `docs/UNIVERSAL.md` foundation 2 sets
 * and this file exists to keep: Settings asks "can I do this here?" rather than
 * "am I on a Mac?".
 *
 * False on a phone. Every device starts with Google sign-in and the library is
 * the bucket's; "No more connecting by address" took this away from the phone
 * deliberately, and it is not coming back there.
 */
export const canConnectByAddress = false
