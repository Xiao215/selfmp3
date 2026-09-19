import { ExtensionStorage } from '@bacons/apple-targets'
import { File } from 'expo-file-system'
import { WIDGET_KEY, type WidgetSnapshot } from '../features/widget/widget.model'

/**
 * The home-screen widget on an iPhone (docs/ui-mock `P28`).
 *
 * The widget runs in its own process and reads the App Group the app and it
 * share; the snapshot is written there as one JSON string, and then the
 * system is asked to redraw. The group is the one `app.config.js` and
 * `targets/widget/expo-target.config.js` both name.
 */
const APP_GROUP = 'group.com.selfmp3.app'

const storage = new ExtensionStorage(APP_GROUP)

export const hasWidget = true

export function sendWidgetSnapshot(snapshot: WidgetSnapshot): void {
  storage.set(WIDGET_KEY, JSON.stringify(snapshot))
  ExtensionStorage.reloadWidget()
}

/**
 * Covers are kept at 640 points, which is far more than a widget draws and
 * too much to pass through shared preferences for five of them at once. So a
 * cover goes along only when its file is small; otherwise the tile is drawn
 * in its colours alone, as it is before any cover has arrived.
 */
const WIDGET_COVER_BYTES = 120_000

export function widgetCover(uri: string | undefined): string {
  if (!uri || !uri.startsWith('file:')) return ''
  try {
    const file = new File(uri)
    if (!file.exists || (file.size ?? Infinity) > WIDGET_COVER_BYTES) return ''
    return file.base64Sync()
  } catch {
    // A cover that cannot be read is a tile without one, not a failed widget.
    return ''
  }
}
