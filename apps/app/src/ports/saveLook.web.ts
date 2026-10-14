import type { View } from 'react-native'
import { downloadPicture, drawPicture } from './sharePicture.web'

/**
 * The month as a page, saved as the picture on screen, in a browser and the
 * desktop app (docs/ui-mock `C16`).
 *
 * The look is drawn into a canvas from the page's own markup at `width`
 * pixels across, whatever size it is shown at (ports/sharePicture), and
 * downloaded as a PNG named after the period.
 */
export const canSaveLook = true

export async function saveLook(view: View | null, fileName: string, width = 1080): Promise<void> {
  downloadPicture(await drawPicture(view, width), fileName)
}
