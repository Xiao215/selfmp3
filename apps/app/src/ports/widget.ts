import type { WidgetSnapshot } from '../features/widget/widget.model'

/**
 * The home-screen widget, where there is one. Android and a browser have none
 * (docs/UI-MIGRATION.md, Phase 11: iOS first), so these do nothing there.
 */

/** Whether this device has a widget to feed. */
export const hasWidget = false

/** Hand the widget a new snapshot and ask the system to redraw it. */
export function sendWidgetSnapshot(_snapshot: WidgetSnapshot): void {}

/** A cover small enough to hand the widget, as base64, or '' when there is none. */
export function widgetCover(_uri: string | undefined): string {
  return ''
}
