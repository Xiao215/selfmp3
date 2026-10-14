import * as Clipboard from 'expo-clipboard'

/** Some words on the clipboard, for pasting: a share link, the server's token. */
export async function copyText(text: string): Promise<boolean> {
  try {
    return await Clipboard.setStringAsync(text)
  } catch {
    return false
  }
}
