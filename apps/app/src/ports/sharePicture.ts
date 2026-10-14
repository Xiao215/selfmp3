import type { View } from 'react-native'
import { captureRef } from 'react-native-view-shot'
import * as Sharing from 'expo-sharing'
import { File, Paths } from 'expo-file-system'

/**
 * A picture handed to someone: the share card a link makes for WeChat
 * (features/share/SharePoster.tsx), and the month's page (ports/saveLook).
 *
 * On a phone the view is photographed where it is drawn and handed to the
 * share sheet, where WeChat, Messages and Save Image are. `size` is the
 * picture's in pixels; without one it is the screen's own density.
 */
export async function sharePicture(
  view: View | null,
  fileName: string,
  size?: { width: number; height: number },
): Promise<'shared' | 'saved' | 'dismissed'> {
  if (!view) throw new Error('The page is not drawn yet.')
  const shot = new File(
    await captureRef(view, { format: 'png', result: 'tmpfile', ...(size ?? {}) }),
  )
  // Named for what it is, as the web's download is: the capture's own name is an id.
  const named = new File(Paths.cache, fileName)
  if (named.exists) named.delete()
  await shot.move(named)
  if (!(await Sharing.isAvailableAsync())) throw new Error('This device cannot share an image.')
  await Sharing.shareAsync(named.uri, { mimeType: 'image/png', UTI: 'public.png' })
  return 'shared'
}
