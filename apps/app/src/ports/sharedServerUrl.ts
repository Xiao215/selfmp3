import { DEFAULT_SERVER_URL } from '@selfmp3/shared'
import Constants from 'expo-constants'

/**
 * The server this build offers to an account whose bucket names none of its
 * own (docs/features/shared-server.md): the build's own (`extra.serverUrl` in
 * app.config.js), or the one in packages/shared. Checked for being a string,
 * as the doorman's address is (doormanUrl.ts), and for the same reason.
 */
const configured = (Constants.expoConfig?.extra as { serverUrl?: unknown } | undefined)?.serverUrl

export const sharedServerUrl =
  typeof configured === 'string' && configured.length > 0 ? configured : DEFAULT_SERVER_URL
