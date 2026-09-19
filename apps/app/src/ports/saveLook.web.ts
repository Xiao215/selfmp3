import type { View } from 'react-native'
import html2canvas from 'html2canvas'

/**
 * The month as a page, saved as the picture on screen, in a browser and the
 * desktop app (docs/ui-mock `C16`).
 *
 * The look is drawn into a canvas from the page's own markup at `width`
 * pixels across, whatever size it is shown at, and downloaded as a PNG named
 * after the period. Covers come from this device's server or bucket, which
 * answer with CORS headers, so the canvas can be read back.
 */
export const canSaveLook = true

export async function saveLook(view: View | null, fileName: string, width = 1080): Promise<void> {
  const element = view as unknown as HTMLElement | null
  if (!element) throw new Error('The page is not drawn yet.')
  const shown = element.getBoundingClientRect().width || width
  const canvas = await html2canvas(element, {
    useCORS: true,
    backgroundColor: null,
    scale: Math.max(2, width / shown),
    logging: false,
  })
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not make the image.')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking at once can cancel the download in Safari; a moment is enough.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
