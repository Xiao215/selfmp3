import type { View } from 'react-native'
import { sharePicture } from './sharePicture'

/**
 * The month as a page, saved as the picture on screen (docs/ui-mock `P33`–`P37`).
 *
 * On a phone the look is photographed where it is drawn — at the screen's own
 * pixel density, so a page three points to the pixel saves sharp — and handed
 * to the share sheet, where Save Image puts it in Photos (ports/sharePicture).
 */
export const canSaveLook = true

export async function saveLook(
  view: View | null,
  fileName: string,
  // The web draws at a width; a phone photographs at its own density.
  _width?: number,
): Promise<void> {
  await sharePicture(view, fileName)
}
