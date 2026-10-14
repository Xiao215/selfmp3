import { DEFAULT_APP_URL } from '@selfmp3/shared'
import { Platform, Share } from 'react-native'

/**
 * Hand a link to someone: the phone's own share sheet (Messages, WeChat, a
 * copy). What a room's invite uses (features/room). `copied` never happens
 * here — the share sheet has a Copy of its own.
 *
 * The link goes out once. iOS takes the words and the link apart and gives
 * each app both, so a link written into the words as well arrived twice
 * (Discord showed it twice). Android has no place for a link but the words.
 */
export async function shareLink(
  text: string,
  url: string,
): Promise<'shared' | 'copied' | 'failed'> {
  try {
    const result = await Share.share(
      Platform.OS === 'ios' ? { message: text, url } : { message: `${text} ${url}` },
    )
    return result.action === Share.dismissedAction ? 'failed' : 'shared'
  } catch {
    return 'failed'
  }
}

/** Where a link to the app opens for someone else: the web app, which a phone without self.mp3 can open. */
export function appAddress(): string {
  return DEFAULT_APP_URL
}
