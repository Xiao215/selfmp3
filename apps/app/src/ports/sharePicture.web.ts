import type { View } from 'react-native'
import html2canvas from 'html2canvas'

/**
 * A picture handed to someone, from a browser or the desktop app: the share
 * card a link makes for WeChat (features/share/SharePoster.tsx).
 *
 * Drawn as the month's page is saved (ports/saveLook): into a canvas from the
 * page's own markup at `width` pixels across. A phone's browser that can share
 * a file hands it to its share sheet; anything else downloads it, as does a
 * browser that would not share it this long after the press.
 */
export async function sharePicture(
  view: View | null,
  fileName: string,
  { width }: { width: number; height: number },
): Promise<'shared' | 'saved' | 'dismissed'> {
  const picture = await drawPicture(view, width)
  const file = new File([picture], fileName, { type: 'image/png' })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'dismissed'
      // NotAllowedError: the press is too long ago by the time it is drawn. Saved instead.
    }
  }
  downloadPicture(picture, fileName)
  return 'saved'
}

/**
 * The view as a PNG, `width` pixels across whatever size it is shown at.
 * Covers come from this device's server or bucket, which answer with CORS
 * headers, or from the service worker on the app's own address, so the
 * canvas can be read back.
 */
export async function drawPicture(view: View | null, width: number): Promise<Blob> {
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
  return blob
}

/** A picture saved to Downloads, by the name given. */
export function downloadPicture(picture: Blob, fileName: string): void {
  const url = URL.createObjectURL(picture)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking at once can cancel the download in Safari; a moment is enough.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
