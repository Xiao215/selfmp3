import { DEFAULT_DOORMAN_URL } from '@selfmp3/shared'
import Constants from 'expo-constants'

/**
 * The doorman this build signs in through: the build's own (`extra.doormanUrl`
 * in app.config.js, which Expo inlines on the web too), or the one in
 * packages/shared.
 *
 * Checked for being a string rather than merely present, because Expo turns a
 * null in `extra` into `{}` on the way through — which is not null, so a `??`
 * fallback keeps it, and the address silently becomes "[object Object]".
 */
const configured = (Constants.expoConfig?.extra as { doormanUrl?: unknown } | undefined)?.doormanUrl

export const doormanUrl =
  typeof configured === 'string' && configured.length > 0 ? configured : DEFAULT_DOORMAN_URL
