import { router } from 'expo-router'
import { putAwayForLink } from '../src/features/nowPlaying/leaveNowPlaying'

/**
 * Each link the system hands the app while it runs (`selfmp3:///settings`, a
 * playlist's link), before Expo Router follows it: the phone's Now Playing is
 * put away first, so the page opens over the app rather than inside the
 * modal (`putAwayForLink`). The link that launched the app has nothing up to
 * put away.
 */
export async function redirectSystemPath({
  path,
  initial,
}: {
  path: string
  initial: boolean
}): Promise<string> {
  if (!initial) await putAwayForLink(router, path)
  return path
}
