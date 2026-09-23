import type { View } from 'react-native'
import { captureRef } from 'react-native-view-shot'
import * as Sharing from 'expo-sharing'
import { File, Paths } from 'expo-file-system'

/**
 * The month as a page, saved as the picture on screen (docs/ui-mock `P33`–`P37`).
 *
 * On a phone the look is photographed where it is drawn — at the screen's own
 * pixel density, so a page three points to the pixel saves sharp — and handed
 * to the share sheet, where Save Image puts it in Photos.
 */
export const canSaveLook = true

export async function saveLook(
  view: View | null,
  fileName: string,
  // The web draws at a width; a phone photographs at its own density.
  _width?: number,
): Promise<void> {
  if (!view) throw new Error('The page is not drawn yet.')
  const shot = new File(await captureRef(view, { format: 'png', result: 'tmpfile' }))
  // Named after the period, as the web's download is: the capture's own name is an id.
  const named = new File(Paths.cache, fileName)
  if (named.exists) named.delete()
  await shot.move(named)
  if (!(await Sharing.isAvailableAsync())) throw new Error('This device cannot share an image.')
  await Sharing.shareAsync(named.uri, { mimeType: 'image/png', UTI: 'public.png' })
}
